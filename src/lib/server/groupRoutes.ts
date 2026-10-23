import type { Express, Response } from "express";
import type { Pool } from "pg";
import type { AuthRequest } from "../../../server.js";
import { createNotification } from "./notificationHelpers.js";
import {
  getGroupDrivers,
  isGroupDriver,
  addTripDebt,
  netBilateralDebtsIfDrivers,
} from "./groupHelpers.js";

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function registerGroupRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  // Get all groups the user is part of
  app.get("/api/groups", requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await pool.query(
        `SELECT cg.id, cg.name, cg.description, cg.invite_code, cg.cost_split_mode,
                cg.is_archived, cg.created_at, cg.owner_id,
                cg.default_outbound_km, cg.default_return_km, cg.default_fuel_price,
                u.first_name AS owner_first, u.last_name AS owner_last,
                gm.joined_at,
                (SELECT COUNT(*) FROM group_memberships WHERE group_id = cg.id AND is_active = true) AS member_count
         FROM carpool_groups cg
         JOIN group_memberships gm ON gm.group_id = cg.id AND gm.user_id = $1 AND gm.is_active = true
         JOIN users u ON u.id = cg.owner_id
         ORDER BY cg.is_archived, cg.name`,
        [req.userId]
      );
      res.json(result.rows.map(mapGroup));
    } catch (err) {
      console.error("Get groups error:", err);
      res.status(500).json({ error: "Gruppen konnten nicht geladen werden" });
    }
  });

  // Get single group with members
  app.get("/api/groups/:id", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.id);
    try {
      const memberCheck = await pool.query(
        `SELECT gm.id FROM group_memberships gm
         WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.is_active = true`,
        [groupId, req.userId]
      );
      if ((memberCheck.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff auf diese Gruppe" });
        return;
      }

      const groupResult = await pool.query(
        `SELECT cg.*, u.first_name AS owner_first, u.last_name AS owner_last
         FROM carpool_groups cg
         JOIN users u ON u.id = cg.owner_id
         WHERE cg.id = $1`,
        [groupId]
      );
      if ((groupResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Gruppe nicht gefunden" });
        return;
      }

      const membersResult = await pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.email, u.avatar_url, u.roles,
                gm.joined_at, gm.is_active,
                COALESCE((
                  SELECT SUM(d.open_amount) FROM debts d
                  WHERE d.group_id = $1 AND d.debtor_id = u.id
                ), 0) AS debt_amount
         FROM group_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1
         ORDER BY gm.is_active DESC, u.first_name`,
        [groupId]
      );

      const ownerId = groupResult.rows[0].owner_id as number;
      res.json({
        ...mapGroup(groupResult.rows[0]),
        members: membersResult.rows.map((m) => ({
          id: m.id,
          firstName: m.first_name,
          lastName: m.last_name,
          email: m.email,
          avatarUrl: m.avatar_url,
          roles: m.roles ?? [],
          joinedAt: m.joined_at,
          isActive: m.is_active,
          debtAmount: parseFloat(m.debt_amount),
          isOwner: m.id === ownerId,
        })),
      });
    } catch (err) {
      console.error("Get group error:", err);
      res.status(500).json({ error: "Gruppe konnte nicht geladen werden" });
    }
  });

  // List drivers in a group (owner + members with FAHRER role)
  app.get("/api/groups/:id/drivers", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.id);
    if (isNaN(groupId)) { res.status(400).json({ error: "Ungültige ID" }); return; }
    try {
      const memberCheck = await pool.query(
        `SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true`,
        [groupId, req.userId]
      );
      if ((memberCheck.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff" });
        return;
      }
      const drivers = await getGroupDrivers(pool, groupId);
      res.json(drivers);
    } catch (err) {
      console.error("Get group drivers error:", err);
      res.status(500).json({ error: "Fahrer konnten nicht geladen werden" });
    }
  });

  // Vehicles of a group driver (for trip logging)
  app.get("/api/groups/:id/drivers/:driverId/vehicles", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.id);
    const driverId = parseInt(req.params.driverId);
    if (isNaN(groupId) || isNaN(driverId)) {
      res.status(400).json({ error: "Ungültige ID" });
      return;
    }
    try {
      const memberCheck = await pool.query(
        `SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true`,
        [groupId, req.userId]
      );
      if ((memberCheck.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff" });
        return;
      }
      if (!(await isGroupDriver(pool, groupId, driverId))) {
        res.status(400).json({ error: "Kein gültiger Fahrer in dieser Gruppe" });
        return;
      }
      const result = await pool.query(
        `SELECT id, name, fuel_type, consumption_per_100km, is_default, current_fuel_price
         FROM vehicles WHERE user_id = $1 ORDER BY is_default DESC, name`,
        [driverId]
      );
      res.json(result.rows.map((v) => ({
        id: v.id,
        name: v.name,
        fuelType: v.fuel_type,
        consumptionPer100km: parseFloat(v.consumption_per_100km),
        isDefault: v.is_default,
        currentFuelPrice: v.current_fuel_price ? parseFloat(v.current_fuel_price) : null,
      })));
    } catch (err) {
      console.error("Get driver vehicles error:", err);
      res.status(500).json({ error: "Fahrzeuge konnten nicht geladen werden" });
    }
  });

  // Group overview: trips, debts, participation per member
  app.get("/api/groups/:id/overview", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.id);
    if (isNaN(groupId)) { res.status(400).json({ error: "Ungültige ID" }); return; }

    try {
      const memberCheck = await pool.query(
        `SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true`,
        [groupId, req.userId]
      );
      if ((memberCheck.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff" });
        return;
      }

      const groupResult = await pool.query(
        `SELECT cg.*, u.first_name AS owner_first, u.last_name AS owner_last
         FROM carpool_groups cg
         JOIN users u ON u.id = cg.owner_id
         WHERE cg.id = $1`,
        [groupId]
      );
      if ((groupResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Gruppe nicht gefunden" });
        return;
      }
      const groupRow = groupResult.rows[0];
      const ownerId = groupRow.owner_id as number;

      const summaryResult = await pool.query(
        `SELECT
           COUNT(*)::int AS trip_count,
           COALESCE(SUM(COALESCE(outbound_km, 0) + COALESCE(return_km, 0)), 0) AS total_km
         FROM trips WHERE group_id = $1`,
        [groupId]
      );

      const debtSummary = await pool.query(
        `SELECT
           COALESCE(SUM(open_amount), 0) AS total_open,
           COALESCE(SUM(total_amount), 0) AS total_charged
         FROM debts WHERE group_id = $1`,
        [groupId]
      );

      const membersResult = await pool.query(
        `SELECT
           u.id, u.first_name, u.last_name, u.avatar_url, u.roles,
           COUNT(DISTINCT tp.trip_id)::int AS trips_as_passenger,
           COUNT(*) FILTER (WHERE tp.direction = 'OUTBOUND')::int AS outbound_rides,
           COUNT(*) FILTER (WHERE tp.direction = 'RETURN')::int AS return_rides,
           COALESCE(SUM(tp.amount_owed), 0) AS participation_total,
           COALESCE((
             SELECT SUM(d.open_amount) FROM debts d
             WHERE d.group_id = $1 AND d.debtor_id = u.id
           ), 0) AS open_debt,
           COALESCE((
             SELECT SUM(d.paid_amount) FROM debts d
             WHERE d.group_id = $1 AND d.debtor_id = u.id
           ), 0) AS paid_amount,
           (SELECT COUNT(*)::int FROM trips t2 WHERE t2.group_id = $1 AND t2.driver_id = u.id) AS trips_as_driver,
           (u.id = $2 OR 'FAHRER' = ANY(u.roles)) AS is_group_driver
         FROM group_memberships gm
         JOIN users u ON u.id = gm.user_id
         LEFT JOIN trip_participations tp ON tp.user_id = u.id
         LEFT JOIN trips t ON t.id = tp.trip_id AND t.group_id = $1
         WHERE gm.group_id = $1 AND gm.is_active = true
         GROUP BY u.id, u.first_name, u.last_name, u.avatar_url, u.roles
         ORDER BY (u.id = $2) DESC, u.first_name`,
        [groupId, ownerId]
      );

      const entriesResult = await pool.query(
        `SELECT de.id, de.debtor_id, de.amount, de.entry_type, de.description, de.created_at,
                t.trip_date
         FROM debt_entries de
         LEFT JOIN trips t ON t.id = de.trip_id
         WHERE de.group_id = $1
         ORDER BY de.created_at DESC`,
        [groupId]
      );

      const entriesByUser = new Map<number, {
        id: number; amount: number; entryType: string; description: string | null;
        createdAt: string; tripDate: string | null;
      }[]>();
      for (const e of entriesResult.rows) {
        const list = entriesByUser.get(e.debtor_id) ?? [];
        list.push({
          id: e.id,
          amount: parseFloat(e.amount),
          entryType: e.entry_type,
          description: e.description,
          createdAt: e.created_at,
          tripDate: e.trip_date ?? null,
        });
        entriesByUser.set(e.debtor_id, list);
      }

      res.json({
        group: mapGroup(groupRow),
        summary: {
          tripCount: summaryResult.rows[0].trip_count,
          totalKm: parseFloat(summaryResult.rows[0].total_km),
          totalOpenDebt: parseFloat(debtSummary.rows[0].total_open),
          totalCharged: parseFloat(debtSummary.rows[0].total_charged),
        },
        members: membersResult.rows.map((m) => ({
          id: m.id,
          firstName: m.first_name,
          lastName: m.last_name,
          avatarUrl: m.avatar_url,
          roles: m.roles ?? [],
          isOwner: m.id === ownerId,
          isGroupDriver: m.is_group_driver,
          tripsAsPassenger: m.trips_as_passenger,
          outboundRides: m.outbound_rides,
          returnRides: m.return_rides,
          tripsAsDriver: m.trips_as_driver,
          totalCharged: parseFloat(m.participation_total),
          openDebt: parseFloat(m.open_debt),
          paidAmount: parseFloat(m.paid_amount),
          entries: entriesByUser.get(m.id) ?? [],
        })),
      });
    } catch (err) {
      console.error("Group overview error:", err);
      res.status(500).json({ error: "Gruppenübersicht konnte nicht geladen werden" });
    }
  });

  // Create group (FAHRER only)
  app.post("/api/groups", requireAuth, async (req: AuthRequest, res) => {
    const { name, description, costSplitMode, defaultOutboundKm, defaultReturnKm, defaultFuelPrice } = req.body as {
      name: string;
      description?: string;
      costSplitMode?: string;
      defaultOutboundKm?: number | null;
      defaultReturnKm?: number | null;
      defaultFuelPrice?: number | null;
    };
    if (!name) {
      res.status(400).json({ error: "Gruppenname ist Pflichtfeld" });
      return;
    }
    try {
      // Check FAHRER role
      const userResult = await pool.query(
        "SELECT roles FROM users WHERE id = $1",
        [req.userId]
      );
      if (!userResult.rows[0]?.roles?.includes("FAHRER")) {
        // Auto-add FAHRER role when creating a group
        await pool.query(
          "UPDATE users SET roles = array_append(roles, 'FAHRER'), updated_at = NOW() WHERE id = $1 AND NOT ('FAHRER' = ANY(roles))",
          [req.userId]
        );
      }

      let inviteCode: string;
      let tries = 0;
      do {
        inviteCode = generateInviteCode();
        const check = await pool.query(
          "SELECT id FROM carpool_groups WHERE invite_code = $1",
          [inviteCode]
        );
        if ((check.rowCount ?? 0) === 0) break;
        tries++;
      } while (tries < 10);

      const validModes = ["WITH_DRIVER", "WITHOUT_DRIVER"];
      const splitMode = validModes.includes(costSplitMode ?? "")
        ? costSplitMode
        : "WITHOUT_DRIVER";

      const result = await pool.query(
        `INSERT INTO carpool_groups (
           owner_id, name, description, invite_code, cost_split_mode,
           default_outbound_km, default_return_km, default_fuel_price
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          req.userId,
          name.trim(),
          description?.trim() ?? null,
          inviteCode!,
          splitMode,
          defaultOutboundKm && defaultOutboundKm > 0 ? defaultOutboundKm : null,
          defaultReturnKm && defaultReturnKm > 0 ? defaultReturnKm : null,
          defaultFuelPrice && defaultFuelPrice > 0 ? defaultFuelPrice : null,
        ]
      );
      const group = result.rows[0];

      // Owner is also a member
      await pool.query(
        `INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [group.id, req.userId]
      );

      res.status(201).json(mapGroup(group));
    } catch (err) {
      console.error("Create group error:", err);
      res.status(500).json({ error: "Gruppe konnte nicht erstellt werden" });
    }
  });

  // Join group via invite code
  app.post("/api/groups/join", requireAuth, async (req: AuthRequest, res) => {
    const { inviteCode } = req.body as { inviteCode: string };
    if (!inviteCode) {
      res.status(400).json({ error: "Einladecode erforderlich" });
      return;
    }
    try {
      const groupResult = await pool.query(
        `SELECT id, name, owner_id, is_archived FROM carpool_groups
         WHERE UPPER(invite_code) = UPPER($1)`,
        [inviteCode.trim()]
      );
      if ((groupResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "Ungültiger Einladecode" });
        return;
      }
      const group = groupResult.rows[0];
      if (group.is_archived) {
        res.status(400).json({ error: "Diese Gruppe ist archiviert" });
        return;
      }
      if (group.owner_id === req.userId) {
        res.status(400).json({ error: "Du bist bereits der Besitzer dieser Gruppe" });
        return;
      }

      // Check already member
      const existing = await pool.query(
        "SELECT id, is_active FROM group_memberships WHERE group_id = $1 AND user_id = $2",
        [group.id, req.userId]
      );
      if ((existing.rowCount ?? 0) > 0) {
        if (existing.rows[0].is_active) {
          res.status(409).json({ error: "Du bist bereits Mitglied dieser Gruppe" });
          return;
        }
        // Reactivate
        await pool.query(
          "UPDATE group_memberships SET is_active = true, joined_at = NOW() WHERE group_id = $1 AND user_id = $2",
          [group.id, req.userId]
        );
      } else {
        await pool.query(
          "INSERT INTO group_memberships (group_id, user_id) VALUES ($1, $2)",
          [group.id, req.userId]
        );
      }

      // Notify group owner
      const joiner = await pool.query(
        "SELECT first_name, last_name FROM users WHERE id = $1",
        [req.userId]
      );
      const { first_name, last_name } = joiner.rows[0];
      await createNotification(pool, {
        userId: group.owner_id,
        type: "GROUP_JOIN",
        title: "Neues Mitglied",
        message: `${first_name} ${last_name} ist der Gruppe "${group.name}" beigetreten.`,
        referenceId: group.id,
        referenceType: "GROUP",
      });

      res.json({ message: "Erfolgreich beigetreten", groupId: group.id, groupName: group.name });
    } catch (err) {
      console.error("Join group error:", err);
      res.status(500).json({ error: "Fehler beim Beitreten" });
    }
  });

  // Update group (owner only)
  app.put("/api/groups/:id", requireAuth, async (req: AuthRequest, res) => {
    const groupId = parseInt(req.params.id);
    const { name, description, costSplitMode, defaultOutboundKm, defaultReturnKm, defaultFuelPrice } = req.body as {
      name?: string;
      description?: string;
      costSplitMode?: string;
      defaultOutboundKm?: number | null;
      defaultReturnKm?: number | null;
      defaultFuelPrice?: number | null;
    };
    try {
      const check = await pool.query(
        "SELECT id FROM carpool_groups WHERE id = $1 AND owner_id = $2",
        [groupId, req.userId]
      );
      if ((check.rowCount ?? 0) === 0) {
        res.status(403).json({ error: "Kein Zugriff" });
        return;
      }
      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name.trim()); }
      if (description !== undefined) {
        updates.push(`description = $${idx++}`);
        values.push(typeof description === "string" ? description.trim() || null : null);
      }
      if (costSplitMode !== undefined) {
        const validModes = ["WITH_DRIVER", "WITHOUT_DRIVER"];
        if (!validModes.includes(costSplitMode)) {
          res.status(400).json({ error: "Ungültiger Aufteilungsmodus" });
          return;
        }
        updates.push(`cost_split_mode = $${idx++}`);
        values.push(costSplitMode);
      }
      if (defaultOutboundKm !== undefined) {
        updates.push(`default_outbound_km = $${idx++}`);
        values.push(defaultOutboundKm && defaultOutboundKm > 0 ? defaultOutboundKm : null);
      }
      if (defaultReturnKm !== undefined) {
        updates.push(`default_return_km = $${idx++}`);
        values.push(defaultReturnKm && defaultReturnKm > 0 ? defaultReturnKm : null);
      }
      if (defaultFuelPrice !== undefined) {
        updates.push(`default_fuel_price = $${idx++}`);
        values.push(defaultFuelPrice && defaultFuelPrice > 0 ? defaultFuelPrice : null);
      }
      if (updates.length === 0) {
        res.status(400).json({ error: "Keine Änderungen" });
        return;
      }
      updates.push(`updated_at = NOW()`);
      values.push(groupId);
      const result = await pool.query(
        `UPDATE carpool_groups SET ${updates.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      res.json(mapGroup(result.rows[0]));
    } catch (err) {
      console.error("Update group error:", err);
      res.status(500).json({ error: "Fehler beim Aktualisieren" });
    }
  });

  // Renew invite code
  app.post(
    "/api/groups/:id/renew-code",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.id);
      try {
        const check = await pool.query(
          "SELECT id FROM carpool_groups WHERE id = $1 AND owner_id = $2",
          [groupId, req.userId]
        );
        if ((check.rowCount ?? 0) === 0) {
          res.status(403).json({ error: "Kein Zugriff" });
          return;
        }
        let inviteCode: string;
        let tries = 0;
        do {
          inviteCode = generateInviteCode();
          const c = await pool.query(
            "SELECT id FROM carpool_groups WHERE invite_code = $1",
            [inviteCode]
          );
          if ((c.rowCount ?? 0) === 0) break;
          tries++;
        } while (tries < 10);

        await pool.query(
          "UPDATE carpool_groups SET invite_code = $1, updated_at = NOW() WHERE id = $2",
          [inviteCode!, groupId]
        );
        res.json({ inviteCode: inviteCode! });
      } catch (err) {
        console.error("Renew code error:", err);
        res.status(500).json({ error: "Fehler beim Erneuern" });
      }
    }
  );

  // Archive/unarchive group
  app.patch(
    "/api/groups/:id/archive",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.id);
      const { archived } = req.body as { archived: boolean };
      try {
        const result = await pool.query(
          `UPDATE carpool_groups SET is_archived = $1, updated_at = NOW()
           WHERE id = $2 AND owner_id = $3 RETURNING *`,
          [archived, groupId, req.userId]
        );
        if ((result.rowCount ?? 0) === 0) {
          res.status(403).json({ error: "Kein Zugriff" });
          return;
        }
        res.json(mapGroup(result.rows[0]));
      } catch (err) {
        console.error("Archive group error:", err);
        res.status(500).json({ error: "Fehler beim Archivieren" });
      }
    }
  );

  // Remove member (owner only)
  app.delete(
    "/api/groups/:id/members/:userId",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.id);
      const targetUserId = parseInt(req.params.userId);
      try {
        const check = await pool.query(
          "SELECT id FROM carpool_groups WHERE id = $1 AND owner_id = $2",
          [groupId, req.userId]
        );
        if ((check.rowCount ?? 0) === 0) {
          res.status(403).json({ error: "Kein Zugriff" });
          return;
        }
        if (targetUserId === req.userId) {
          res.status(400).json({ error: "Du kannst dich nicht selbst entfernen" });
          return;
        }
        await pool.query(
          "UPDATE group_memberships SET is_active = false WHERE group_id = $1 AND user_id = $2",
          [groupId, targetUserId]
        );
        res.json({ message: "Mitglied entfernt" });
      } catch (err) {
        console.error("Remove member error:", err);
        res.status(500).json({ error: "Fehler beim Entfernen" });
      }
    }
  );
}

function mapGroup(r: Record<string, unknown>) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    inviteCode: r.invite_code,
    costSplitMode: r.cost_split_mode,
    isArchived: r.is_archived,
    ownerId: r.owner_id,
    ownerName: r.owner_first
      ? `${r.owner_first} ${r.owner_last}`
      : undefined,
    memberCount: r.member_count ? parseInt(r.member_count as string) : undefined,
    joinedAt: r.joined_at,
    createdAt: r.created_at,
    defaultOutboundKm: r.default_outbound_km != null ? parseFloat(r.default_outbound_km as string) : null,
    defaultReturnKm: r.default_return_km != null ? parseFloat(r.default_return_km as string) : null,
    defaultFuelPrice: r.default_fuel_price != null ? parseFloat(r.default_fuel_price as string) : null,
  };
}
