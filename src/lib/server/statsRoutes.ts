import type { Express, Response } from "express";
import type { Pool } from "pg";
import type { AuthRequest } from "../../../server.js";

export function registerStatsRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  // Dashboard summary for logged-in user
  app.get("/api/dashboard", requireAuth, async (req: AuthRequest, res) => {
    try {
      // Get roles
      const userResult = await pool.query(
        "SELECT roles FROM users WHERE id = $1",
        [req.userId]
      );
      const roles: string[] = userResult.rows[0]?.roles ?? [];

      const data: Record<string, unknown> = { roles };

      if (roles.includes("FAHRER")) {
        // Open claims (what others owe me)
        const claimsResult = await pool.query(
          `SELECT COALESCE(SUM(d.open_amount), 0) AS total_open,
                  COUNT(DISTINCT d.debtor_id) AS debtor_count
           FROM debts d
           JOIN carpool_groups cg ON cg.id = d.group_id AND cg.owner_id = $1
           WHERE d.open_amount > 0.005`,
          [req.userId]
        );

        // Per-debtor breakdown
        const debtorsResult = await pool.query(
          `SELECT d.open_amount, d.total_amount,
                  u.id, u.first_name, u.last_name, u.avatar_url,
                  cg.name AS group_name, cg.id AS group_id
           FROM debts d
           JOIN users u ON u.id = d.debtor_id
           JOIN carpool_groups cg ON cg.id = d.group_id AND cg.owner_id = $1
           WHERE d.open_amount > 0.005
           ORDER BY d.open_amount DESC LIMIT 20`,
          [req.userId]
        );

        // Pending payments to confirm
        const pendingResult = await pool.query(
          `SELECT COUNT(*) FROM payments p
           JOIN carpool_groups cg ON cg.id = p.group_id AND cg.owner_id = $1
           WHERE p.status = 'GEMELDET'`,
          [req.userId]
        );

        // Recent trips
        const recentTripsResult = await pool.query(
          `SELECT t.id, t.trip_date, t.outbound_km, t.return_km, t.fuel_price_used,
                  cg.name AS group_name,
                  (SELECT SUM(tp.amount_owed) FROM trip_participations tp WHERE tp.trip_id = t.id) AS total_cost
           FROM trips t
           JOIN carpool_groups cg ON cg.id = t.group_id
           WHERE t.driver_id = $1
           ORDER BY t.trip_date DESC, t.created_at DESC
           LIMIT 5`,
          [req.userId]
        );

        // Fuel price status per vehicle
        const vehiclesResult = await pool.query(
          `SELECT id, name, current_fuel_price, fuel_price_updated_at
           FROM vehicles WHERE user_id = $1 AND is_default = true
           UNION
           SELECT id, name, current_fuel_price, fuel_price_updated_at
           FROM vehicles WHERE user_id = $1 AND is_default = false
           LIMIT 5`,
          [req.userId]
        );

        data.driver = {
          totalOpenAmount: parseFloat(claimsResult.rows[0].total_open),
          debtorCount: parseInt(claimsResult.rows[0].debtor_count),
          pendingConfirmations: parseInt(pendingResult.rows[0].count),
          debtors: debtorsResult.rows.map((r) => ({
            userId: r.id,
            firstName: r.first_name,
            lastName: r.last_name,
            avatarUrl: r.avatar_url,
            groupName: r.group_name,
            groupId: r.group_id,
            openAmount: parseFloat(r.open_amount),
          })),
          recentTrips: recentTripsResult.rows.map((t) => ({
            id: t.id,
            tripDate: t.trip_date,
            outboundKm: t.outbound_km ? parseFloat(t.outbound_km) : null,
            returnKm: t.return_km ? parseFloat(t.return_km) : null,
            groupName: t.group_name,
            totalCost: t.total_cost ? parseFloat(t.total_cost) : 0,
          })),
          vehicles: vehiclesResult.rows.map((v) => ({
            id: v.id,
            name: v.name,
            currentFuelPrice: v.current_fuel_price ? parseFloat(v.current_fuel_price) : null,
            fuelPriceUpdatedAt: v.fuel_price_updated_at,
          })),
        };
      }

      if (roles.includes("MITFAHRER")) {
        // My debts
        const myDebtsResult = await pool.query(
          `SELECT COALESCE(SUM(d.open_amount), 0) AS total_open,
                  COUNT(DISTINCT d.group_id) AS group_count
           FROM debts d WHERE d.debtor_id = $1 AND d.open_amount > 0.005`,
          [req.userId]
        );

        const myDebtsByGroupResult = await pool.query(
          `SELECT d.open_amount, d.total_amount, cg.name AS group_name, cg.id AS group_id,
                  u.first_name AS creditor_first, u.last_name AS creditor_last
           FROM debts d
           JOIN carpool_groups cg ON cg.id = d.group_id
           JOIN users u ON u.id = d.creditor_id
           WHERE d.debtor_id = $1 AND d.open_amount > 0.005
           ORDER BY d.open_amount DESC`,
          [req.userId]
        );

        // Recent trips I was part of
        const recentMyTripsResult = await pool.query(
          `SELECT t.id, t.trip_date, cg.name AS group_name,
                  u.first_name AS driver_first, u.last_name AS driver_last,
                  SUM(tp.amount_owed) AS my_cost
           FROM trip_participations tp
           JOIN trips t ON t.id = tp.trip_id
           JOIN carpool_groups cg ON cg.id = t.group_id
           JOIN users u ON u.id = t.driver_id
           WHERE tp.user_id = $1
           GROUP BY t.id, cg.name, u.first_name, u.last_name
           ORDER BY t.trip_date DESC LIMIT 5`,
          [req.userId]
        );

        data.passenger = {
          totalDebt: parseFloat(myDebtsResult.rows[0].total_open),
          groupCount: parseInt(myDebtsResult.rows[0].group_count),
          debtsByGroup: myDebtsByGroupResult.rows.map((r) => ({
            groupId: r.group_id,
            groupName: r.group_name,
            creditorName: `${r.creditor_first} ${r.creditor_last}`,
            openAmount: parseFloat(r.open_amount),
          })),
          recentTrips: recentMyTripsResult.rows.map((t) => ({
            id: t.id,
            tripDate: t.trip_date,
            groupName: t.group_name,
            driverName: `${t.driver_first} ${t.driver_last}`,
            myCost: parseFloat(t.my_cost),
          })),
        };
      }

      res.json(data);
    } catch (err) {
      console.error("Dashboard error:", err);
      res.status(500).json({ error: "Dashboard konnte nicht geladen werden" });
    }
  });

  // Driver statistics
  app.get(
    "/api/groups/:groupId/stats",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.groupId);
      const { year, month } = req.query as { year?: string; month?: string };

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
        if (year) { conditions.push(`EXTRACT(YEAR FROM t.trip_date) = $${idx++}`); values.push(parseInt(year)); }
        if (month) { conditions.push(`EXTRACT(MONTH FROM t.trip_date) = $${idx++}`); values.push(parseInt(month)); }

        const whereClause = conditions.join(" AND ");

        // Km stats
        const kmResult = await pool.query(
          `SELECT
             COALESCE(SUM(COALESCE(t.outbound_km, 0) + COALESCE(t.return_km, 0)), 0) AS total_km,
             COUNT(*) AS trip_count,
             AVG(COALESCE(t.outbound_km, 0) + COALESCE(t.return_km, 0)) AS avg_km_per_trip
           FROM trips t WHERE ${whereClause}`,
          values
        );

        // Cost stats
        const costResult = await pool.query(
          `SELECT
             COALESCE(SUM(tp.amount_owed), 0) AS total_income,
             COUNT(DISTINCT tp.user_id) AS unique_passengers
           FROM trip_participations tp
           JOIN trips t ON t.id = tp.trip_id
           WHERE ${whereClause} AND t.driver_id = $${idx}`,
          [...values, req.userId]
        );
        idx++;

        // Monthly breakdown (last 24 months, km per trip counted once)
        const monthlyResult = await pool.query(
          `SELECT
             TO_CHAR(t.trip_date, 'YYYY-MM') AS month,
             COUNT(*) AS trips,
             COALESCE(SUM(COALESCE(t.outbound_km, 0) + COALESCE(t.return_km, 0)), 0) AS km,
             COALESCE(SUM(inc.income), 0) AS income
           FROM trips t
           LEFT JOIN (
             SELECT trip_id, SUM(amount_owed) AS income
             FROM trip_participations
             GROUP BY trip_id
           ) inc ON inc.trip_id = t.id
           WHERE t.group_id = $1
             AND t.trip_date >= (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '23 months')
           GROUP BY TO_CHAR(t.trip_date, 'YYYY-MM')
           ORDER BY month ASC`,
          [groupId]
        );

        // Weekday heatmap
        const weekdayResult = await pool.query(
          `SELECT
             EXTRACT(DOW FROM t.trip_date) AS dow,
             COUNT(*) AS trip_count
           FROM trips t WHERE ${whereClause}
           GROUP BY dow ORDER BY dow`,
          values
        );

        // Fuel price history
        const fuelResult = await pool.query(
          `SELECT t.trip_date, t.fuel_price_used
           FROM trips t WHERE ${whereClause}
           ORDER BY t.trip_date ASC`,
          values
        );

        res.json({
          totalKm: parseFloat(kmResult.rows[0].total_km),
          tripCount: parseInt(kmResult.rows[0].trip_count),
          avgKmPerTrip: kmResult.rows[0].avg_km_per_trip
            ? parseFloat(kmResult.rows[0].avg_km_per_trip)
            : 0,
          totalIncome: parseFloat(costResult.rows[0].total_income),
          uniquePassengers: parseInt(costResult.rows[0].unique_passengers),
          monthlyBreakdown: monthlyResult.rows.map((r) => ({
            month: r.month,
            trips: parseInt(r.trips),
            km: parseFloat(r.km),
            income: parseFloat(r.income),
          })),
          weekdayHeatmap: weekdayResult.rows.map((r) => ({
            dayOfWeek: parseInt(r.dow),
            tripCount: parseInt(r.trip_count),
          })),
          fuelPriceHistory: fuelResult.rows.map((r) => ({
            date: r.trip_date,
            price: parseFloat(r.fuel_price_used),
          })),
        });
      } catch (err) {
        console.error("Stats error:", err);
        res.status(500).json({ error: "Statistiken konnten nicht geladen werden" });
      }
    }
  );
}
