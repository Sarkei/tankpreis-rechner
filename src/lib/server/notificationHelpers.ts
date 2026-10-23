import type { Pool } from "pg";

export async function createNotification(
  pool: Pool,
  opts: {
    userId: number;
    type: string;
    title: string;
    message: string;
    referenceId?: number;
    referenceType?: string;
  }
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, reference_id, reference_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        opts.userId,
        opts.type,
        opts.title,
        opts.message,
        opts.referenceId ?? null,
        opts.referenceType ?? null,
      ]
    );
  } catch (err) {
    console.error("Create notification error:", err);
  }
}
