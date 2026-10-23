import type { Express, Response } from "express";
import type { Pool } from "pg";
import type { AuthRequest } from "../../../server.js";
import { updateAutoFuelPrices, updateAutoFuelPricesForUser } from "./fuelPriceService.js";

export function registerFuelPriceRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  app.post("/api/fuel-prices/refresh", requireAuth, async (req: AuthRequest, res) => {
    if (!req.userId) {
      res.status(401).json({ error: "Nicht autorisiert" });
      return;
    }
    try {
      const roles = await pool.query("SELECT roles FROM users WHERE id = $1", [req.userId]);
      if (!roles.rows[0]?.roles?.includes("FAHRER")) {
        res.status(403).json({ error: "Nur Fahrer können Preise aktualisieren" });
        return;
      }

      const stats = await updateAutoFuelPricesForUser(pool, req.userId);
      if (stats.updated === 0 && stats.errors > 0) {
        res.status(400).json({
          error: "Preise konnten nicht geladen. PLZ prüfen und TANKERKOENIG_API_KEY in .env setzen.",
          ...stats,
        });
        return;
      }
      res.json({
        message: stats.updated > 0
          ? `${stats.updated} Fahrzeug(e) aktualisiert`
          : "Keine Fahrzeuge mit Auto-Preis aktualisiert",
        ...stats,
      });
    } catch (err) {
      console.error("Manual fuel refresh error:", err);
      res.status(500).json({ error: "Preisaktualisierung fehlgeschlagen" });
    }
  });

  app.post("/api/internal/cron/fuel-prices", async (req, res) => {
    const secret = process.env.CRON_SECRET?.trim();
    const auth = req.headers.authorization?.replace("Bearer ", "");
    if (!secret || auth !== secret) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const stats = await updateAutoFuelPrices(pool);
      res.json(stats);
    } catch (err) {
      console.error("Cron fuel refresh error:", err);
      res.status(500).json({ error: "Cron failed" });
    }
  });
}
