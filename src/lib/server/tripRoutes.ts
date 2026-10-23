import type { Express, Response } from "express";
import type { Pool, PoolClient } from "pg";
import type { AuthRequest } from "../../../server.js";
import { createNotification } from "./notificationHelpers.js";
import { isGroupDriver, addTripDebt, netBilateralDebtsIfDrivers } from "./groupHelpers.js";
import { computeTripFuelCost } from "../tripCost.js";

type CostSplitMode = "WITH_DRIVER" | "WITHOUT_DRIVER";

interface DirectionCosts {
  costs: Map<number, number>; // userId → amount
  costPerPassenger: number;   // for preview
}

interface CostCalculationResult {
  outbound: DirectionCosts;
  return: DirectionCosts;
  /** Total per passenger (outbound + return combined) */
  participantCosts: { userId: number; amount: number }[];
}

/**
 * Berechnet die Kosten pro Mitfahrer korrekt.
 *
 * Formel: Streckenkosten = (km × Verbrauch/100) × Kraftstoffpreis
 * - WITHOUT_DRIVER: Mitfahrer teilen 100% der Kosten
 * - WITH_DRIVER: alle (Mitfahrer + Fahrer) teilen, Mitfahrer zahlen n/(n+1)
 *
 * Rundungsdifferenz geht an den letzten Mitfahrer (alphabetisch).
 */
function calculateTripCosts(opts: {
  outboundKm: number | null;
  returnKm: number | null;
  consumptionPer100km: number;
  fuelPrice: number;
  costSplitMode: CostSplitMode;
  outboundPassengers: number[];
  returnPassengers: number[];
  names: Map<number, string>;
}): CostCalculationResult {
  const {
    outboundKm, returnKm, consumptionPer100km, fuelPrice,
    costSplitMode, outboundPassengers, returnPassengers, names,
  } = opts;

  function calcDirection(km: number | null, passengers: number[]): DirectionCosts {
    if (!km || km <= 0 || passengers.length === 0) {
      return { costs: new Map(), costPerPassenger: 0 };
    }

    const totalCost = (km * consumptionPer100km) / 100 * fuelPrice;
    const divisor = costSplitMode === "WITH_DRIVER"
      ? passengers.length + 1
      : passengers.length;

    const costPerPerson = totalCost / divisor;
    const rounded = Math.round(costPerPerson * 100) / 100;

    // Total passengers actually pay (not necessarily the full trip cost with WITH_DRIVER)
    const targetPassengerTotal = Math.round((totalCost * passengers.length / divisor) * 100) / 100;
    let remainder = Math.round((targetPassengerTotal - rounded * passengers.length) * 100) / 100;

    // Alphabetical sort for deterministic rounding assignment
    const sorted = [...passengers].sort((a, b) => {
      const na = names.get(a) ?? String(a);
      const nb = names.get(b) ?? String(b);
      return na.localeCompare(nb);
    });

    const costs = new Map<number, number>();
    sorted.forEach((userId, i) => {
      const isLast = i === sorted.length - 1;
      const amount = isLast ? Math.round((rounded + remainder) * 100) / 100 : rounded;
      costs.set(userId, amount);
      if (isLast) remainder = 0;
    });

    return { costs, costPerPassenger: rounded };
  }

  const outbound = calcDirection(outboundKm, outboundPassengers);
  const ret = calcDirection(returnKm, returnPassengers);

  // Aggregate totals per passenger
  const allIds = new Set([...outbound.costs.keys(), ...ret.costs.keys()]);
  const participantCosts = Array.from(allIds).map((userId) => ({
    userId,
    amount: Math.round(((outbound.costs.get(userId) ?? 0) + (ret.costs.get(userId) ?? 0)) * 100) / 100,
  }));

  return { outbound, return: ret, participantCosts };
}

type ParticipationRow = {
  trip_id: number; user_id: number; direction: string;
  amount_owed: string; first_name: string; last_name: string;
};

function mapTripFromRow(
  t: Record<string, unknown>,
  participations: ParticipationRow[]
) {
  const tParts = participations.filter((p) => p.trip_id === t.id);
  const outboundKm = t.outbound_km ? parseFloat(t.outbound_km as string) : null;
  const returnKm = t.return_km ? parseFloat(t.return_km as string) : null;
  const fuelPriceUsed = parseFloat(t.fuel_price_used as string);
  const consumptionPer100km = t.consumption_per_100km
    ? parseFloat(t.consumption_per_100km as string)
    : 8;
  const totalFuelCost = computeTripFuelCost({
    outboundKm,
    returnKm,
    fuelPriceUsed,
    consumptionPer100km,
  });

  return {
    id: t.id,
    groupId: t.group_id ?? undefined,
    groupName: t.group_name ?? undefined,
    tripDate: t.trip_date,
    outboundKm,
    returnKm,
    fuelPriceUsed,
    comment: t.comment,
    createdAt: t.created_at,
    vehicleId: t.vehicle_id ?? null,
    driver: { id: t.driver_id, firstName: t.driver_first, lastName: t.driver_last },
    vehicle: t.vehicle_name ? { name: t.vehicle_name, fuelType: t.fuel_type } : null,
    consumptionPer100km,
    totalFuelCost,
    participations: tParts.map((p) => ({
      userId: p.user_id,
      firstName: p.first_name,
      lastName: p.last_name,
      direction: p.direction,
      amountOwed: parseFloat(p.amount_owed),
    })),
  };
}

async function reverseTripFinancials(
  client: PoolClient,
  pool: Pool,
  groupId: number,
  tripId: number
): Promise<{ blocked: boolean }> {
  const paymentsCheck = await client.query(
    `SELECT p.id FROM payments p
     JOIN debt_entries de ON de.payment_id = p.id
     WHERE de.trip_id = $1 AND p.status = 'BESTAETIGT'`,
    [tripId]
  );
  if ((paymentsCheck.rowCount ?? 0) > 0) {
    return { blocked: true };
  }

  const debtEntries = await client.query(
    "SELECT debtor_id, creditor_id, amount FROM debt_entries WHERE trip_id = $1",
    [tripId]
  );
  for (const entry of debtEntries.rows) {
    await client.query(
      `UPDATE debts SET
         total_amount = GREATEST(0, total_amount - $1),
         open_amount = GREATEST(0, open_amount - $1),
         last_updated = NOW()
       WHERE group_id = $2 AND debtor_id = $3 AND creditor_id = $4`,
      [entry.amount, groupId, entry.debtor_id, entry.creditor_id]
    );
    await netBilateralDebtsIfDrivers(
      client, pool, groupId, entry.debtor_id, entry.creditor_id
    );
  }
  await client.query("DELETE FROM debt_entries WHERE trip_id = $1", [tripId]);
  await client.query("DELETE FROM trip_participations WHERE trip_id = $1", [tripId]);
  return { blocked: false };
}

async function applyTripFinancials(
  client: PoolClient,
  pool: Pool,
  opts: {
    groupId: number;
    tripId: number;
    tripDriverId: number;
    tripDate: string;
    costs: CostCalculationResult;
    outIds: number[];
    retIds: number[];
  }
): Promise<void> {
  const { groupId, tripId, tripDriverId, tripDate, costs, outIds, retIds } = opts;

  for (const userId of outIds) {
    const amount = costs.outbound.costs.get(userId) ?? 0;
    await client.query(
      `INSERT INTO trip_participations (trip_id, user_id, direction, amount_owed)
       VALUES ($1, $2, 'OUTBOUND', $3)`,
      [tripId, userId, amount]
    );
  }
  for (const userId of retIds) {
    const amount = costs.return.costs.get(userId) ?? 0;
    await client.query(
      `INSERT INTO trip_participations (trip_id, user_id, direction, amount_owed)
       VALUES ($1, $2, 'RETURN', $3)`,
      [tripId, userId, amount]
    );
  }
  for (const { userId, amount } of costs.participantCosts) {
    if (userId === tripDriverId) continue;
    await addTripDebt(client, pool, {
      groupId,
      debtorId: userId,
      creditorId: tripDriverId,
      amount,
      tripId,
      tripDate,
    });
  }
}

export function registerTripRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  // ── Preview cost calculation (no DB write) ────────────────────────────────
  app.post("/api/trips/preview", requireAuth, async (req: AuthRequest, res) => {
    const {
      groupId, vehicleId, outboundKm, returnKm, fuelPrice,
      outboundPassengerIds, returnPassengerIds,
    } = req.body as {
      groupId: number;
      vehicleId?: number;
      outboundKm?: number;
      returnKm?: number;
      fuelPrice: number;
      outboundPassengerIds: number[];
      returnPassengerIds: number[];
    };

    if (!groupId || !fuelPrice || fuelPrice <= 0) {
      res.status(400).json({ error: "Gruppe und Kraftstoffpreis erforderlich" });
      return;
    }

    const outIds = Array.isArray(outboundPassengerIds) ? outboundPassengerIds : [];
    const retIds = Array.isArray(returnPassengerIds) ? returnPassengerIds : [];

    try {
      let consumption = 8.0;
      if (vehicleId) {
        const v = await pool.query("SELECT consumption_per_100km FROM vehicles WHERE id = $1", [vehicleId]);
        if (v.rows[0]) consumption = parseFloat(v.rows[0].consumption_per_100km);
      }

      const group = await pool.query("SELECT cost_split_mode FROM carpool_groups WHERE id = $1", [groupId]);
      const costSplitMode: CostSplitMode =
        group.rows[0]?.cost_split_mode === "WITH_DRIVER" ? "WITH_DRIVER" : "WITHOUT_DRIVER";

      const allIds = [...new Set([...outIds, ...retIds])];
      const names = new Map<number, string>();
      if (allIds.length > 0) {
        const users = await pool.query(
          `SELECT id, first_name || ' ' || last_name AS name FROM users WHERE id = ANY($1)`,
          [allIds]
        );
        users.rows.forEach((u: { id: number; name: string }) => names.set(u.id, u.name));
      }

      const result = calculateTripCosts({
        outboundKm: outboundKm ?? null,
        returnKm: returnKm ?? null,
        consumptionPer100km: consumption,
        fuelPrice,
        costSplitMode,
        outboundPassengers: outIds,
        returnPassengers: retIds,
        names,
      });

      res.json({
        outboundCostPerPassenger: result.outbound.costPerPassenger,
        returnCostPerPassenger: result.return.costPerPassenger,
        consumptionPer100km: consumption,
        costSplitMode,
        totalFuelCost: computeTripFuelCost({
          outboundKm: outboundKm ?? null,
          returnKm: returnKm ?? null,
          fuelPriceUsed: fuelPrice,
          consumptionPer100km: consumption,
        }),
        participantCosts: result.participantCosts.map((pc) => ({
          ...pc,
          name: names.get(pc.userId) ?? `User ${pc.userId}`,
        })),
      });
    } catch (err) {
      console.error("Trip preview error:", err);
      res.status(500).json({ error: "Fehler bei der Vorschau" });
    }
  });

  // ── Calendar: trips per month (all groups of user) ────────────────────────
  app.get("/api/calendar", requireAuth, async (req: AuthRequest, res) => {
    const year = parseInt(String(req.query.year ?? ""));
    const month = parseInt(String(req.query.month ?? ""));
    if (!req.userId || isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      res.status(400).json({ error: "Jahr und Monat erforderlich" });
      return;
    }

    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const to = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;

    try {
      const result = await pool.query(
        `SELECT t.id, t.trip_date, t.outbound_km, t.return_km, t.group_id,
                cg.name AS group_name,
                u.id AS driver_id, u.first_name AS driver_first, u.last_name AS driver_last
         FROM trips t
         JOIN carpool_groups cg ON cg.id = t.group_id
         JOIN group_memberships gm ON gm.group_id = cg.id AND gm.user_id = $1 AND gm.is_active = true
         JOIN users u ON u.id = t.driver_id
         WHERE t.trip_date >= $2::date AND t.trip_date < $3::date
         ORDER BY t.trip_date, t.created_at`,
        [req.userId, from, to]
      );

      res.json({
        year,
        month,
        trips: result.rows.map((r) => ({
          id: r.id,
          groupId: r.group_id,
          groupName: r.group_name,
          tripDate: r.trip_date,
          outboundKm: r.outbound_km ? parseFloat(r.outbound_km) : null,
          returnKm: r.return_km ? parseFloat(r.return_km) : null,
          driver: {
            id: r.driver_id,
            firstName: r.driver_first,
            lastName: r.driver_last,
          },
        })),
      });
    } catch (err) {
      console.error("Calendar error:", err);
      res.status(500).json({ error: "Kalender konnte nicht geladen werden" });
    }
  });

  // ── Get trips for a group ─────────────────────────────────────────────────
  app.get("/api/groups/:groupId/trips", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.groupId);
    if (isNaN(groupId)) { res.status(400).json({ error: "Ungültige Gruppen-ID" }); return; }

    const { from, to, vehicleId, limit = "50", offset = "0" } = req.query as {
      from?: string; to?: string; vehicleId?: string; limit?: string; offset?: string;
    };

    try {
      const memberCheck = await pool.query(
        "SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true",
        [groupId, req.userId]
      );
      if ((memberCheck.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff" });
        return;
      }

      const conditions: string[] = ["t.group_id = $1"];
      const values: unknown[] = [groupId];
      let idx = 2;

      if (from) { conditions.push(`t.trip_date >= $${idx++}`); values.push(from); }
      if (to) { conditions.push(`t.trip_date <= $${idx++}`); values.push(to); }
      if (vehicleId && !isNaN(parseInt(vehicleId))) {
        conditions.push(`t.vehicle_id = $${idx++}`);
        values.push(parseInt(vehicleId));
      }

      const result = await pool.query(
        `SELECT t.id, t.trip_date, t.outbound_km, t.return_km, t.fuel_price_used,
                t.comment, t.created_at, t.group_id, t.vehicle_id,
                u.id AS driver_id, u.first_name AS driver_first, u.last_name AS driver_last,
                v.name AS vehicle_name, v.fuel_type, v.consumption_per_100km
         FROM trips t
         JOIN users u ON u.id = t.driver_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY t.trip_date DESC, t.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...values, parseInt(limit), parseInt(offset)]
      );

      const countResult = await pool.query(
        `SELECT COUNT(*) FROM trips t WHERE ${conditions.join(" AND ")}`,
        values
      );

      const tripIds = result.rows.map((r: { id: number }) => r.id);
      let participations: {
        trip_id: number; user_id: number; direction: string;
        amount_owed: string; first_name: string; last_name: string;
      }[] = [];
      if (tripIds.length > 0) {
        const partResult = await pool.query(
          `SELECT tp.trip_id, tp.user_id, tp.direction, tp.amount_owed,
                  u.first_name, u.last_name
           FROM trip_participations tp
           JOIN users u ON u.id = tp.user_id
           WHERE tp.trip_id = ANY($1)`,
          [tripIds]
        );
        participations = partResult.rows;
      }

      const trips = result.rows.map((t: Record<string, unknown>) =>
        mapTripFromRow(t, participations)
      );

      res.json({ trips, total: parseInt(countResult.rows[0].count) });
    } catch (err) {
      console.error("Get trips error:", err);
      res.status(500).json({ error: "Fahrten konnten nicht geladen werden" });
    }
  });

  // ── Get single trip ───────────────────────────────────────────────────────
  app.get("/api/groups/:groupId/trips/:tripId", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.groupId);
    const tripId = parseInt(req.params.tripId);
    if (isNaN(groupId) || isNaN(tripId)) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }

    try {
      const memberCheck = await pool.query(
        "SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true",
        [groupId, req.userId]
      );
      if ((memberCheck.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff" });
        return;
      }

      const result = await pool.query(
        `SELECT t.id, t.trip_date, t.outbound_km, t.return_km, t.fuel_price_used,
                t.comment, t.created_at, t.group_id, t.vehicle_id,
                cg.name AS group_name,
                u.id AS driver_id, u.first_name AS driver_first, u.last_name AS driver_last,
                v.name AS vehicle_name, v.fuel_type, v.consumption_per_100km
         FROM trips t
         JOIN carpool_groups cg ON cg.id = t.group_id
         JOIN users u ON u.id = t.driver_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         WHERE t.id = $1 AND t.group_id = $2`,
        [tripId, groupId]
      );
      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Fahrt nicht gefunden" });
        return;
      }

      const partResult = await pool.query(
        `SELECT tp.trip_id, tp.user_id, tp.direction, tp.amount_owed,
                u.first_name, u.last_name
         FROM trip_participations tp
         JOIN users u ON u.id = tp.user_id
         WHERE tp.trip_id = $1`,
        [tripId]
      );

      res.json(mapTripFromRow(result.rows[0], partResult.rows));
    } catch (err) {
      console.error("Get trip error:", err);
      res.status(500).json({ error: "Fahrt konnte nicht geladen werden" });
    }
  });

  // ── Create trip ───────────────────────────────────────────────────────────
  app.post("/api/groups/:groupId/trips", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.groupId);
    if (isNaN(groupId)) { res.status(400).json({ error: "Ungültige Gruppen-ID" }); return; }

    const {
      vehicleId, tripDate, outboundKm, returnKm, fuelPrice,
      outboundPassengerIds, returnPassengerIds, comment, driverId,
    } = req.body as {
      vehicleId?: number; tripDate: string; outboundKm?: number; returnKm?: number;
      fuelPrice: number; outboundPassengerIds?: number[]; returnPassengerIds?: number[];
      comment?: string; driverId?: number;
    };

    const outIdsRaw = Array.isArray(outboundPassengerIds) ? outboundPassengerIds : [];
    const retIdsRaw = Array.isArray(returnPassengerIds) ? returnPassengerIds : [];

    if (!tripDate || !fuelPrice || fuelPrice <= 0) {
      res.status(400).json({ error: "Datum und Kraftstoffpreis sind Pflichtfelder" });
      return;
    }
    if ((!outboundKm || outboundKm <= 0) && (!returnKm || returnKm <= 0)) {
      res.status(400).json({ error: "Mindestens eine Strecke (Hin- oder Rückweg) ist erforderlich" });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: "Nicht autorisiert" });
      return;
    }
    const currentUserId = req.userId;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const groupResult = await client.query(
        "SELECT owner_id, cost_split_mode FROM carpool_groups WHERE id = $1 AND is_archived = false",
        [groupId]
      );
      if ((groupResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Gruppe nicht gefunden" });
        await client.query("ROLLBACK");
        return;
      }

      const canLog = await isGroupDriver(client, groupId, currentUserId);
      if (!canLog) {
        res.status(403).json({ error: "Nur Fahrer in dieser Gruppe können Fahrten eintragen" });
        await client.query("ROLLBACK");
        return;
      }

      const tripDriverId = driverId ?? currentUserId;
      if (!(await isGroupDriver(client, groupId, tripDriverId))) {
        res.status(400).json({ error: "Ungültiger Fahrer für diese Gruppe" });
        await client.query("ROLLBACK");
        return;
      }

      const outIds = outIdsRaw.filter((id) => id !== tripDriverId);
      const retIds = retIdsRaw.filter((id) => id !== tripDriverId);

      const costSplitMode: CostSplitMode =
        groupResult.rows[0].cost_split_mode === "WITH_DRIVER" ? "WITH_DRIVER" : "WITHOUT_DRIVER";

      let consumption = 8.0;
      if (vehicleId) {
        const v = await client.query(
          "SELECT consumption_per_100km FROM vehicles WHERE id = $1 AND user_id = $2",
          [vehicleId, tripDriverId]
        );
        if (v.rows[0]) consumption = parseFloat(v.rows[0].consumption_per_100km);
      }

      const allIds = [...new Set([...outIds, ...retIds])];
      const names = new Map<number, string>();
      if (allIds.length > 0) {
        const users = await client.query(
          `SELECT id, first_name || ' ' || last_name AS name FROM users WHERE id = ANY($1)`,
          [allIds]
        );
        users.rows.forEach((u: { id: number; name: string }) => names.set(u.id, u.name));
      }

      const costs = calculateTripCosts({
        outboundKm: outboundKm && outboundKm > 0 ? outboundKm : null,
        returnKm: returnKm && returnKm > 0 ? returnKm : null,
        consumptionPer100km: consumption,
        fuelPrice,
        costSplitMode,
        outboundPassengers: outIds,
        returnPassengers: retIds,
        names,
      });

      // Insert trip
      const tripResult = await client.query(
        `INSERT INTO trips (group_id, driver_id, vehicle_id, trip_date, fuel_price_used,
                            outbound_km, return_km, comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          groupId, tripDriverId, vehicleId ?? null, tripDate, fuelPrice,
          outboundKm && outboundKm > 0 ? outboundKm : null,
          returnKm && returnKm > 0 ? returnKm : null,
          comment?.trim() ?? null,
        ]
      );
      const tripId = tripResult.rows[0].id as number;

      await applyTripFinancials(client, pool, {
        groupId,
        tripId,
        tripDriverId,
        tripDate,
        costs,
        outIds,
        retIds,
      });

      await client.query("COMMIT");

      // Notify all passengers
      for (const userId of allIds) {
        if (userId === tripDriverId) continue;
        const entry = costs.participantCosts.find((c) => c.userId === userId);
        await createNotification(pool, {
          userId,
          type: "TRIP_CREATED",
          title: "Neue Fahrt eingetragen",
          message: `Eine Fahrt am ${tripDate} wurde eingetragen. Dein Anteil: ${entry?.amount?.toFixed(2) ?? "0.00"} €`,
          referenceId: tripId,
          referenceType: "TRIP",
        });
      }

      res.status(201).json({ tripId, message: "Fahrt erfolgreich eingetragen" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Create trip error:", err);
      res.status(500).json({ error: "Fehler beim Eintragen der Fahrt" });
    } finally {
      client.release();
    }
  });

  // ── Update trip ───────────────────────────────────────────────────────────
  app.put("/api/groups/:groupId/trips/:tripId", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.groupId);
    const tripId = parseInt(req.params.tripId);
    if (isNaN(groupId) || isNaN(tripId)) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }

    const {
      vehicleId, tripDate, outboundKm, returnKm, fuelPrice,
      outboundPassengerIds, returnPassengerIds, comment, driverId,
    } = req.body as {
      vehicleId?: number; tripDate: string; outboundKm?: number; returnKm?: number;
      fuelPrice: number; outboundPassengerIds?: number[]; returnPassengerIds?: number[];
      comment?: string; driverId?: number;
    };

    const outIdsRaw = Array.isArray(outboundPassengerIds) ? outboundPassengerIds : [];
    const retIdsRaw = Array.isArray(returnPassengerIds) ? returnPassengerIds : [];

    if (!tripDate || !fuelPrice || fuelPrice <= 0) {
      res.status(400).json({ error: "Datum und Kraftstoffpreis sind Pflichtfelder" });
      return;
    }
    if ((!outboundKm || outboundKm <= 0) && (!returnKm || returnKm <= 0)) {
      res.status(400).json({ error: "Mindestens eine Strecke ist erforderlich" });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: "Nicht autorisiert" });
      return;
    }
    const currentUserId = req.userId;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const tripResult = await client.query(
        `SELECT t.id, t.driver_id, cg.owner_id, cg.cost_split_mode
         FROM trips t
         JOIN carpool_groups cg ON cg.id = t.group_id
         WHERE t.id = $1 AND t.group_id = $2 AND cg.is_archived = false`,
        [tripId, groupId]
      );
      if ((tripResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Fahrt nicht gefunden" });
        await client.query("ROLLBACK");
        return;
      }
      const tripRow = tripResult.rows[0];
      const canEdit =
        tripRow.owner_id === currentUserId ||
        tripRow.driver_id === currentUserId ||
        (await isGroupDriver(client, groupId, currentUserId));
      if (!canEdit) {
        res.status(403).json({ error: "Kein Zugriff" });
        await client.query("ROLLBACK");
        return;
      }

      const tripDriverId = driverId ?? tripRow.driver_id;
      if (!(await isGroupDriver(client, groupId, tripDriverId))) {
        res.status(400).json({ error: "Ungültiger Fahrer" });
        await client.query("ROLLBACK");
        return;
      }

      const reverse = await reverseTripFinancials(client, pool, groupId, tripId);
      if (reverse.blocked) {
        res.status(400).json({
          error: "Fahrt kann nicht bearbeitet werden – es existieren bestätigte Zahlungen",
        });
        await client.query("ROLLBACK");
        return;
      }

      const outIds = outIdsRaw.filter((id) => id !== tripDriverId);
      const retIds = retIdsRaw.filter((id) => id !== tripDriverId);
      const costSplitMode: CostSplitMode =
        tripRow.cost_split_mode === "WITH_DRIVER" ? "WITH_DRIVER" : "WITHOUT_DRIVER";

      let consumption = 8.0;
      if (vehicleId) {
        const v = await client.query(
          "SELECT consumption_per_100km FROM vehicles WHERE id = $1 AND user_id = $2",
          [vehicleId, tripDriverId]
        );
        if (v.rows[0]) consumption = parseFloat(v.rows[0].consumption_per_100km);
      }

      const allIds = [...new Set([...outIds, ...retIds])];
      const names = new Map<number, string>();
      if (allIds.length > 0) {
        const users = await client.query(
          `SELECT id, first_name || ' ' || last_name AS name FROM users WHERE id = ANY($1)`,
          [allIds]
        );
        users.rows.forEach((u: { id: number; name: string }) => names.set(u.id, u.name));
      }

      const costs = calculateTripCosts({
        outboundKm: outboundKm && outboundKm > 0 ? outboundKm : null,
        returnKm: returnKm && returnKm > 0 ? returnKm : null,
        consumptionPer100km: consumption,
        fuelPrice,
        costSplitMode,
        outboundPassengers: outIds,
        returnPassengers: retIds,
        names,
      });

      await client.query(
        `UPDATE trips SET
           driver_id = $1, vehicle_id = $2, trip_date = $3, fuel_price_used = $4,
           outbound_km = $5, return_km = $6, comment = $7, updated_at = NOW()
         WHERE id = $8`,
        [
          tripDriverId,
          vehicleId ?? null,
          tripDate,
          fuelPrice,
          outboundKm && outboundKm > 0 ? outboundKm : null,
          returnKm && returnKm > 0 ? returnKm : null,
          comment?.trim() ?? null,
          tripId,
        ]
      );

      await applyTripFinancials(client, pool, {
        groupId,
        tripId,
        tripDriverId,
        tripDate,
        costs,
        outIds,
        retIds,
      });

      await client.query("COMMIT");
      res.json({ message: "Fahrt aktualisiert" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Update trip error:", err);
      res.status(500).json({ error: "Fehler beim Aktualisieren" });
    } finally {
      client.release();
    }
  });

  // ── Delete trip ───────────────────────────────────────────────────────────
  app.delete("/api/groups/:groupId/trips/:tripId", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.groupId);
    const tripId = parseInt(req.params.tripId);
    if (isNaN(groupId) || isNaN(tripId)) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }
    if (!req.userId) {
      res.status(401).json({ error: "Nicht autorisiert" });
      return;
    }
    const currentUserId = req.userId;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const tripResult = await client.query(
        `SELECT t.id, t.driver_id, cg.owner_id
         FROM trips t
         JOIN carpool_groups cg ON cg.id = t.group_id
         WHERE t.id = $1 AND t.group_id = $2`,
        [tripId, groupId]
      );
      if ((tripResult.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff oder Fahrt nicht gefunden" });
        await client.query("ROLLBACK");
        return;
      }
      const tripRow = tripResult.rows[0];
      const canDelete =
        tripRow.owner_id === currentUserId ||
        tripRow.driver_id === currentUserId ||
        (await isGroupDriver(client, groupId, currentUserId));
      if (!canDelete) {
        res.status(403).json({ error: "Kein Zugriff" });
        await client.query("ROLLBACK");
        return;
      }

      const reverse = await reverseTripFinancials(client, pool, groupId, tripId);
      if (reverse.blocked) {
        res.status(400).json({
          error: "Fahrt kann nicht gelöscht werden – es existieren bestätigte Zahlungen",
        });
        await client.query("ROLLBACK");
        return;
      }

      await client.query("DELETE FROM trips WHERE id = $1", [tripId]);
      await client.query("COMMIT");
      res.json({ message: "Fahrt gelöscht" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Delete trip error:", err);
      res.status(500).json({ error: "Fehler beim Löschen" });
    } finally {
      client.release();
    }
  });

  // ── My trip participations (MITFAHRER) ────────────────────────────────────
  app.get("/api/my-trips", requireAuth, async (req: AuthRequest, res) => {
    const { limit = "20", offset = "0" } = req.query as { limit?: string; offset?: string };
    try {
      const result = await pool.query(
        `SELECT t.id, t.trip_date, t.outbound_km, t.return_km, t.fuel_price_used,
                t.comment, cg.name AS group_name, cg.id AS group_id,
                u.first_name AS driver_first, u.last_name AS driver_last,
                SUM(tp.amount_owed) AS total_owed
         FROM trip_participations tp
         JOIN trips t ON t.id = tp.trip_id
         JOIN carpool_groups cg ON cg.id = t.group_id
         JOIN users u ON u.id = t.driver_id
         WHERE tp.user_id = $1
         GROUP BY t.id, cg.id, cg.name, u.first_name, u.last_name
         ORDER BY t.trip_date DESC
         LIMIT $2 OFFSET $3`,
        [req.userId, parseInt(limit), parseInt(offset)]
      );
      res.json(
        result.rows.map((r: Record<string, unknown>) => ({
          id: r.id,
          tripDate: r.trip_date,
          outboundKm: r.outbound_km ? parseFloat(r.outbound_km as string) : null,
          returnKm: r.return_km ? parseFloat(r.return_km as string) : null,
          fuelPriceUsed: parseFloat(r.fuel_price_used as string),
          comment: r.comment,
          groupName: r.group_name,
          groupId: r.group_id,
          driverName: `${r.driver_first} ${r.driver_last}`,
          totalOwed: parseFloat(r.total_owed as string),
        }))
      );
    } catch (err) {
      console.error("My trips error:", err);
      res.status(500).json({ error: "Fahrten konnten nicht geladen werden" });
    }
  });
}
