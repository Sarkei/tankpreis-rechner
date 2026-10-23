import type { Express, Response } from "express";
import type { Pool } from "pg";
import type { AuthRequest } from "../../../server.js";

export function registerNotificationRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  app.get("/api/notifications", requireAuth, async (req: AuthRequest, res) => {
    const { unreadOnly } = req.query as { unreadOnly?: string };
    try {
      const query = unreadOnly === "true"
        ? `SELECT * FROM notifications WHERE user_id = $1 AND is_read = false ORDER BY created_at DESC LIMIT 50`
        : `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`;
      const result = await pool.query(query, [req.userId]);
      res.json(
        result.rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          isRead: n.is_read,
          referenceId: n.reference_id,
          referenceType: n.reference_type,
          createdAt: n.created_at,
        }))
      );
    } catch (err) {
      console.error("Get notifications error:", err);
      res.status(500).json({ error: "Fehler beim Laden" });
    }
  });

  app.get(
    "/api/notifications/count",
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const result = await pool.query(
          "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
          [req.userId]
        );
        res.json({ unread: parseInt(result.rows[0].count) });
      } catch (err) {
        console.error("Notification count error:", err);
        res.status(500).json({ error: "Fehler beim Laden" });
      }
    }
  );

  app.post(
    "/api/notifications/:id/read",
    requireAuth,
    async (req: AuthRequest, res) => {
      const notifId = parseInt(req.params.id);
      try {
        await pool.query(
          "UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2",
          [notifId, req.userId]
        );
        res.json({ message: "Gelesen" });
      } catch (err) {
        console.error("Mark read error:", err);
        res.status(500).json({ error: "Fehler" });
      }
    }
  );

  app.post(
    "/api/notifications/read-all",
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        await pool.query(
          "UPDATE notifications SET is_read = true WHERE user_id = $1",
          [req.userId]
        );
        res.json({ message: "Alle gelesen" });
      } catch (err) {
        console.error("Mark all read error:", err);
        res.status(500).json({ error: "Fehler" });
      }
    }
  );
}
