import type { Express, Response } from "express";
import type { Pool } from "pg";
import type { AuthRequest } from "../../../server.js";
import PDFDocument from "pdfkit";

export function registerExportRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  // CSV Export: trips for a group
  app.get(
    "/api/groups/:groupId/export/csv",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.groupId);
      if (isNaN(groupId)) { res.status(400).json({ error: "Ungültige ID" }); return; }
      const { from, to } = req.query as { from?: string; to?: string };

      try {
        const memberCheck = await pool.query(
          "SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true",
          [groupId, req.userId]
        );
        if ((memberCheck.rowCount ?? 0) === 0) {
          res.status(403).json({ error: "Kein Zugriff" });
          return;
        }

        const groupResult = await pool.query(
          "SELECT name FROM carpool_groups WHERE id = $1",
          [groupId]
        );
        const groupName = groupResult.rows[0]?.name ?? "Gruppe";

        const conditions: string[] = ["t.group_id = $1"];
        const values: unknown[] = [groupId];
        let idx = 2;
        if (from) { conditions.push(`t.trip_date >= $${idx++}`); values.push(from); }
        if (to) { conditions.push(`t.trip_date <= $${idx++}`); values.push(to); }

        const result = await pool.query(
          `SELECT t.trip_date, t.outbound_km, t.return_km, t.fuel_price_used, t.comment,
                  u.first_name AS driver_first, u.last_name AS driver_last,
                  v.name AS vehicle_name,
                  string_agg(DISTINCT pu.first_name || ' ' || pu.last_name, '; ') AS passengers,
                  SUM(tp.amount_owed) AS total_cost
           FROM trips t
           JOIN users u ON u.id = t.driver_id
           LEFT JOIN vehicles v ON v.id = t.vehicle_id
           LEFT JOIN trip_participations tp ON tp.trip_id = t.id
           LEFT JOIN users pu ON pu.id = tp.user_id
           WHERE ${conditions.join(" AND ")}
           GROUP BY t.id, u.first_name, u.last_name, v.name
           ORDER BY t.trip_date DESC`,
          values
        );

        const rows = [
          ["Datum", "Hinweg (km)", "Rückweg (km)", "Kraftstoffpreis (€/L)", "Fahrer", "Fahrzeug", "Mitfahrer", "Gesamtkosten (€)", "Kommentar"],
          ...result.rows.map((r) => [
            r.trip_date ? new Date(r.trip_date).toLocaleDateString("de-DE") : "",
            r.outbound_km ?? "",
            r.return_km ?? "",
            r.fuel_price_used ? parseFloat(r.fuel_price_used).toFixed(4) : "",
            `${r.driver_first} ${r.driver_last}`,
            r.vehicle_name ?? "",
            r.passengers ?? "",
            r.total_cost ? parseFloat(r.total_cost).toFixed(2) : "0.00",
            r.comment ?? "",
          ]),
        ];

        const csv = rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        ).join("\n");

        const filename = `mitfahr_${groupName.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send("\uFEFF" + csv); // BOM for Excel
      } catch (err) {
        console.error("CSV export error:", err);
        res.status(500).json({ error: "Export fehlgeschlagen" });
      }
    }
  );

    // PDF Export: monthly report for a passenger
  app.get(
    "/api/groups/:groupId/export/pdf/:passengerId",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.groupId);
      const passengerId = parseInt(req.params.passengerId);
      const { month, year } = req.query as { month?: string; year?: string };

      if (isNaN(groupId) || isNaN(passengerId)) {
        res.status(400).json({ error: "Ungültige ID" });
        return;
      }

      try {
        // Only group owner or the passenger themselves
        const groupResult = await pool.query(
          "SELECT name, owner_id FROM carpool_groups WHERE id = $1",
          [groupId]
        );
        if ((groupResult.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Gruppe nicht gefunden" });
          return;
        }
        const group = groupResult.rows[0];
        if (group.owner_id !== req.userId && passengerId !== req.userId) {
          res.status(403).json({ error: "Kein Zugriff" });
          return;
        }

        const m = month && !isNaN(parseInt(month)) ? parseInt(month) : new Date().getMonth() + 1;
        const y = year && !isNaN(parseInt(year)) ? parseInt(year) : new Date().getFullYear();

        const passengerResult = await pool.query(
          "SELECT first_name, last_name, email FROM users WHERE id = $1",
          [passengerId]
        );
        if ((passengerResult.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Mitfahrer nicht gefunden" });
          return;
        }
        const passenger = passengerResult.rows[0];

        const tripsResult = await pool.query(
          `SELECT t.trip_date, t.outbound_km, t.return_km, t.fuel_price_used,
                  u.first_name AS driver_first, u.last_name AS driver_last,
                  SUM(tp.amount_owed) AS my_cost
           FROM trip_participations tp
           JOIN trips t ON t.id = tp.trip_id
           JOIN users u ON u.id = t.driver_id
           WHERE tp.user_id = $1 AND t.group_id = $2
             AND EXTRACT(MONTH FROM t.trip_date) = $3
             AND EXTRACT(YEAR FROM t.trip_date) = $4
           GROUP BY t.id, u.first_name, u.last_name
           ORDER BY t.trip_date`,
          [passengerId, groupId, m, y]
        );

        const debtResult = await pool.query(
          "SELECT open_amount FROM debts WHERE group_id = $1 AND debtor_id = $2",
          [groupId, passengerId]
        );

        const doc = new PDFDocument({ margin: 50 });
        const monthNames = ["Januar", "Februar", "März", "April", "Mai", "Juni",
          "Juli", "August", "September", "Oktober", "November", "Dezember"];

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="mitfahr_abrechnung_${monthNames[m - 1]}_${y}.pdf"`
        );
        doc.pipe(res);

        // Header
        doc.fontSize(22).font("Helvetica-Bold").text("MitFahr.io", { align: "center" });
        doc.fontSize(14).font("Helvetica").text("Monatliche Abrechnung", { align: "center" });
        doc.moveDown();

        doc.fontSize(12).text(`Gruppe: ${group.name}`);
        doc.text(`Zeitraum: ${monthNames[m - 1]} ${y}`);
        doc.text(`Mitfahrer: ${passenger.first_name} ${passenger.last_name}`);
        doc.text(`Erstellt am: ${new Date().toLocaleDateString("de-DE")}`);
        doc.moveDown();

        doc.fontSize(14).font("Helvetica-Bold").text("Fahrtenübersicht");
        doc.fontSize(10).font("Helvetica");

        let totalCost = 0;
        if (tripsResult.rows.length === 0) {
          doc.text("Keine Fahrten in diesem Monat.");
        } else {
          tripsResult.rows.forEach((trip) => {
            const cost = parseFloat(trip.my_cost);
            totalCost += cost;
            const km =
              (trip.outbound_km ? parseFloat(trip.outbound_km) : 0) +
              (trip.return_km ? parseFloat(trip.return_km) : 0);
            doc.text(
              `${new Date(trip.trip_date).toLocaleDateString("de-DE")}  |  ${km.toFixed(1)} km  |  ${parseFloat(trip.fuel_price_used).toFixed(3)} €/L  |  ${cost.toFixed(2)} €`
            );
          });
        }

        doc.moveDown();
        doc.fontSize(12).font("Helvetica-Bold")
          .text(`Gesamtkosten ${monthNames[m - 1]}: ${totalCost.toFixed(2)} €`);

        const openDebt = debtResult.rows[0]
          ? parseFloat(debtResult.rows[0].open_amount)
          : 0;
        doc.text(`Aktuell offener Betrag: ${openDebt.toFixed(2)} €`);

        doc.end();
      } catch (err) {
        console.error("PDF export error:", err);
        res.status(500).json({ error: "PDF-Export fehlgeschlagen" });
      }
    }
  );
}
