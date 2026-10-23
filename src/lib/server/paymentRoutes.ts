import type { Express, Response } from "express";
import type { Pool } from "pg";
import type { AuthRequest } from "../../../server.js";
import { createNotification } from "./notificationHelpers.js";
import { netBilateralDebtsIfDrivers, isGroupDriver } from "./groupHelpers.js";

export function registerPaymentRoutes(
  app: Express,
  pool: Pool,
  requireAuth: (req: AuthRequest, res: Response, next: () => void) => void
) {
  // Pending payment count for dashboard
  app.get("/api/payments/pending-count", requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM payments p
         WHERE p.receiver_id = $1 AND p.status = 'GEMELDET'`,
        [req.userId]
      );
      res.json({ count: result.rows[0].cnt });
    } catch (err) {
      console.error("Pending count error:", err);
      res.status(500).json({ error: "Fehler" });
    }
  });

  // Get debts for current user (as debtor or creditor)
  app.get("/api/debts", requireAuth, async (req: AuthRequest, res) => {
    try {
      const result = await pool.query(
        `SELECT d.id, d.group_id, d.total_amount, d.paid_amount, d.open_amount, d.last_updated,
                cg.name AS group_name,
                debtor.id AS debtor_id, debtor.first_name AS debtor_first, debtor.last_name AS debtor_last,
                creditor.id AS creditor_id, creditor.first_name AS creditor_first, creditor.last_name AS creditor_last,
                creditor.iban AS creditor_iban
         FROM debts d
         JOIN carpool_groups cg ON cg.id = d.group_id
         JOIN users debtor ON debtor.id = d.debtor_id
         JOIN users creditor ON creditor.id = d.creditor_id
         WHERE (d.debtor_id = $1 OR d.creditor_id = $1) AND d.open_amount > 0.005
         ORDER BY d.open_amount DESC`,
        [req.userId]
      );

      res.json(
        result.rows.map((r) => ({
          id: r.id,
          groupId: r.group_id,
          groupName: r.group_name,
          totalAmount: parseFloat(r.total_amount),
          paidAmount: parseFloat(r.paid_amount),
          openAmount: parseFloat(r.open_amount),
          lastUpdated: r.last_updated,
          debtor: {
            id: r.debtor_id,
            firstName: r.debtor_first,
            lastName: r.debtor_last,
          },
          creditor: {
            id: r.creditor_id,
            firstName: r.creditor_first,
            lastName: r.creditor_last,
            iban: r.creditor_iban ?? null,
          },
          isMyDebt: r.debtor_id === req.userId,
        }))
      );
    } catch (err) {
      console.error("Get debts error:", err);
      res.status(500).json({ error: "Schulden konnten nicht geladen werden" });
    }
  });

  // Get debt history (entries)
  app.get(
    "/api/groups/:groupId/debt-history",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.groupId);
      const { filter = "all" } = req.query as { filter?: string };

      try {
        const memberCheck = await pool.query(
          "SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true",
          [groupId, req.userId]
        );
        if ((memberCheck.rowCount ?? 0) === 0) {
          res.status(403).json({ error: "Kein Zugriff" });
          return;
        }

        let query = `
          SELECT de.id, de.amount, de.entry_type, de.description, de.created_at,
                 de.trip_id, de.payment_id,
                 debtor.first_name AS debtor_first, debtor.last_name AS debtor_last,
                 creditor.first_name AS creditor_first, creditor.last_name AS creditor_last,
                 p.status AS payment_status
          FROM debt_entries de
          JOIN users debtor ON debtor.id = de.debtor_id
          JOIN users creditor ON creditor.id = de.creditor_id
          LEFT JOIN payments p ON p.id = de.payment_id
          WHERE de.group_id = $1
            AND (de.debtor_id = $2 OR de.creditor_id = $2)
        `;

        if (filter === "open") query += ` AND (p.id IS NULL OR p.status != 'BESTAETIGT')`;
        if (filter === "paid") query += ` AND p.status = 'BESTAETIGT'`;

        query += " ORDER BY de.created_at DESC LIMIT 100";

        const result = await pool.query(query, [groupId, req.userId]);

        res.json(
          result.rows.map((r) => ({
            id: r.id,
            amount: parseFloat(r.amount),
            entryType: r.entry_type,
            description: r.description,
            createdAt: r.created_at,
            tripId: r.trip_id,
            paymentId: r.payment_id,
            debtorName: `${r.debtor_first} ${r.debtor_last}`,
            creditorName: `${r.creditor_first} ${r.creditor_last}`,
            paymentStatus: r.payment_status,
          }))
        );
      } catch (err) {
        console.error("Debt history error:", err);
        res.status(500).json({ error: "Schuldenhistorie konnte nicht geladen werden" });
      }
    }
  );

  // Get payments for a group
  app.get(
    "/api/groups/:groupId/payments",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.groupId);
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
          `SELECT p.id, p.amount, p.status, p.note, p.reported_at, p.confirmed_at, p.created_at,
                  payer.id AS payer_id, payer.first_name AS payer_first, payer.last_name AS payer_last,
                  recv.id AS recv_id, recv.first_name AS recv_first, recv.last_name AS recv_last
           FROM payments p
           JOIN users payer ON payer.id = p.payer_id
           JOIN users recv ON recv.id = p.receiver_id
           WHERE p.group_id = $1
           ORDER BY p.created_at DESC LIMIT 100`,
          [groupId]
        );

        res.json(
          result.rows.map((r) => ({
            id: r.id,
            amount: parseFloat(r.amount),
            status: r.status,
            note: r.note,
            reportedAt: r.reported_at,
            confirmedAt: r.confirmed_at,
            createdAt: r.created_at,
            payer: { id: r.payer_id, firstName: r.payer_first, lastName: r.payer_last },
            receiver: { id: r.recv_id, firstName: r.recv_first, lastName: r.recv_last },
          }))
        );
      } catch (err) {
        console.error("Get payments error:", err);
        res.status(500).json({ error: "Zahlungen konnten nicht geladen werden" });
      }
    }
  );

  // Report payment (MITFAHRER marks as sent)
  app.post(
    "/api/groups/:groupId/payments/report",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.groupId);
      const { receiverId, amount, note } = req.body as {
        receiverId: number;
        amount: number;
        note?: string;
      };

      if (!receiverId || !amount || amount <= 0) {
        res.status(400).json({ error: "Empfänger und Betrag erforderlich" });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const memberCheck = await client.query(
          "SELECT id FROM group_memberships WHERE group_id = $1 AND user_id = $2 AND is_active = true",
          [groupId, req.userId]
        );
        if ((memberCheck.rowCount ?? 0) === 0) {
          res.status(403).json({ error: "Kein Zugriff" });
          await client.query("ROLLBACK");
          return;
        }

        const debtCheck = await client.query(
          "SELECT open_amount FROM debts WHERE group_id = $1 AND debtor_id = $2 AND creditor_id = $3",
          [groupId, req.userId, receiverId]
        );
        if ((debtCheck.rowCount ?? 0) === 0 || parseFloat(debtCheck.rows[0].open_amount) <= 0) {
          res.status(400).json({ error: "Keine offenen Schulden bei diesem Fahrer" });
          await client.query("ROLLBACK");
          return;
        }

        const paymentResult = await client.query(
          `INSERT INTO payments (group_id, payer_id, receiver_id, amount, status, note, reported_at)
           VALUES ($1,$2,$3,$4,'GEMELDET',$5,NOW()) RETURNING id`,
          [groupId, req.userId, receiverId, amount, note ?? null]
        );

        await client.query("COMMIT");

        // Notify driver
        const payer = await pool.query(
          "SELECT first_name, last_name FROM users WHERE id = $1",
          [req.userId]
        );
        const { first_name, last_name } = payer.rows[0];
        await createNotification(pool, {
          userId: receiverId,
          type: "PAYMENT_REPORTED",
          title: "Zahlung gemeldet",
          message: `${first_name} ${last_name} hat eine Zahlung von ${amount.toFixed(2)} € gemeldet.`,
          referenceId: paymentResult.rows[0].id,
          referenceType: "PAYMENT",
        });

        res.status(201).json({ paymentId: paymentResult.rows[0].id, message: "Zahlung gemeldet" });
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("Report payment error:", err);
        res.status(500).json({ error: "Fehler beim Melden der Zahlung" });
      } finally {
        client.release();
      }
    }
  );

  // Record payment directly (FAHRER records received payment)
  app.post(
    "/api/groups/:groupId/payments/record",
    requireAuth,
    async (req: AuthRequest, res) => {
      const groupId = parseInt(req.params.groupId);
      const { payerId, amount, note, paymentDate } = req.body as {
        payerId: number;
        amount: number;
        note?: string;
        paymentDate?: string;
      };

      if (!payerId || !amount || amount <= 0) {
        res.status(400).json({ error: "Zahler und Betrag erforderlich" });
        return;
      }
      if (!req.userId) {
        res.status(401).json({ error: "Nicht autorisiert" });
        return;
      }
      const receiverId = req.userId;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Any group driver who is the payment receiver can record
        const canRecord = await isGroupDriver(client, groupId, receiverId);
        if (!canRecord) {
          res.status(403).json({ error: "Nur Fahrer in dieser Gruppe können Zahlungen erfassen" });
          await client.query("ROLLBACK");
          return;
        }

        const paymentResult = await client.query(
          `INSERT INTO payments (group_id, payer_id, receiver_id, amount, status, note, reported_at, confirmed_at)
           VALUES ($1,$2,$3,$4,'BESTAETIGT',$5,NOW(),NOW()) RETURNING id`,
          [groupId, payerId, receiverId, amount, note ?? null]
        );
        const paymentId = paymentResult.rows[0].id;

        // Update debt
        await client.query(
          `UPDATE debts SET
             paid_amount = paid_amount + $1,
             open_amount = GREATEST(0, open_amount - $1),
             last_updated = NOW()
           WHERE group_id = $2 AND debtor_id = $3 AND creditor_id = $4`,
          [amount, groupId, payerId, receiverId]
        );

        // Debt entry
        await client.query(
          `INSERT INTO debt_entries (group_id, debtor_id, creditor_id, payment_id, amount, entry_type, description)
           VALUES ($1,$2,$3,$4,$5,'PAYMENT','Zahlung bestätigt')`,
          [groupId, payerId, receiverId, paymentId, -amount]
        );

        await netBilateralDebtsIfDrivers(client, pool, groupId, payerId, receiverId);

        await client.query("COMMIT");

        // Notify payer
        await createNotification(pool, {
          userId: payerId,
          type: "PAYMENT_CONFIRMED",
          title: "Zahlung bestätigt",
          message: `Deine Zahlung von ${amount.toFixed(2)} € wurde vom Fahrer bestätigt.`,
          referenceId: paymentId,
          referenceType: "PAYMENT",
        });

        res.status(201).json({ paymentId, message: "Zahlung erfasst und bestätigt" });
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("Record payment error:", err);
        res.status(500).json({ error: "Fehler beim Erfassen" });
      } finally {
        client.release();
      }
    }
  );

  // Confirm reported payment (FAHRER confirms)
  app.post(
    "/api/payments/:paymentId/confirm",
    requireAuth,
    async (req: AuthRequest, res) => {
      const paymentId = parseInt(req.params.paymentId);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const paymentResult = await client.query(
          `SELECT p.*, cg.owner_id FROM payments p
           JOIN carpool_groups cg ON cg.id = p.group_id
           WHERE p.id = $1 AND p.status = 'GEMELDET'`,
          [paymentId]
        );
        if ((paymentResult.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Zahlung nicht gefunden oder bereits bearbeitet" });
          await client.query("ROLLBACK");
          return;
        }
        const payment = paymentResult.rows[0];
        if (payment.receiver_id !== req.userId) {
          res.status(403).json({ error: "Nur der Empfänger kann Zahlungen bestätigen" });
          await client.query("ROLLBACK");
          return;
        }

        await client.query(
          "UPDATE payments SET status = 'BESTAETIGT', confirmed_at = NOW(), updated_at = NOW() WHERE id = $1",
          [paymentId]
        );

        // Update debt
        await client.query(
          `UPDATE debts SET
             paid_amount = paid_amount + $1,
             open_amount = GREATEST(0, open_amount - $1),
             last_updated = NOW()
           WHERE group_id = $2 AND debtor_id = $3 AND creditor_id = $4`,
          [payment.amount, payment.group_id, payment.payer_id, payment.receiver_id]
        );

        // Debt entry
        await client.query(
          `INSERT INTO debt_entries (group_id, debtor_id, creditor_id, payment_id, amount, entry_type, description)
           VALUES ($1,$2,$3,$4,$5,'PAYMENT','Zahlung bestätigt')`,
          [payment.group_id, payment.payer_id, payment.receiver_id, paymentId, -payment.amount]
        );

        await netBilateralDebtsIfDrivers(
          client,
          pool,
          payment.group_id,
          payment.payer_id,
          payment.receiver_id
        );

        await client.query("COMMIT");

        // Notify payer
        await createNotification(pool, {
          userId: payment.payer_id,
          type: "PAYMENT_CONFIRMED",
          title: "Zahlung bestätigt",
          message: `Deine Zahlung von ${parseFloat(payment.amount).toFixed(2)} € wurde bestätigt.`,
          referenceId: paymentId,
          referenceType: "PAYMENT",
        });

        res.json({ message: "Zahlung bestätigt" });
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("Confirm payment error:", err);
        res.status(500).json({ error: "Fehler beim Bestätigen" });
      } finally {
        client.release();
      }
    }
  );

  // Reject reported payment
  app.post(
    "/api/payments/:paymentId/reject",
    requireAuth,
    async (req: AuthRequest, res) => {
      const paymentId = parseInt(req.params.paymentId);
      try {
        const result = await pool.query(
          `UPDATE payments SET status = 'OFFEN', reported_at = NULL, updated_at = NOW()
           WHERE id = $1 AND receiver_id = $2 AND status = 'GEMELDET'
           RETURNING id`,
          [paymentId, req.userId]
        );
        if ((result.rowCount ?? 0) === 0) {
          res.status(404).json({ error: "Zahlung nicht gefunden" });
          return;
        }
        res.json({ message: "Zahlung abgelehnt" });
      } catch (err) {
        console.error("Reject payment error:", err);
        res.status(500).json({ error: "Fehler beim Ablehnen" });
      }
    }
  );
}
