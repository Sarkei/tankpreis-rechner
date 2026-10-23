import type { Pool, PoolClient } from "pg";

/** Gruppen-Fahrer = Besitzer oder Nutzer mit Rolle FAHRER */
export async function getGroupDrivers(pool: Pool, groupId: number) {
  const result = await pool.query(
    `SELECT u.id, u.first_name, u.last_name, u.avatar_url,
            (u.id = cg.owner_id) AS is_owner
     FROM group_memberships gm
     JOIN users u ON u.id = gm.user_id
     JOIN carpool_groups cg ON cg.id = gm.group_id
     WHERE gm.group_id = $1 AND gm.is_active = true
       AND (u.id = cg.owner_id OR 'FAHRER' = ANY(u.roles))
     ORDER BY (u.id = cg.owner_id) DESC, u.first_name`,
    [groupId]
  );
  return result.rows.map((r) => ({
    id: r.id as number,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    avatarUrl: r.avatar_url as string | null,
    isOwner: r.is_owner as boolean,
  }));
}

export async function isGroupDriver(
  pool: Pool | PoolClient,
  groupId: number,
  userId: number
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM group_memberships gm
     JOIN users u ON u.id = gm.user_id
     JOIN carpool_groups cg ON cg.id = gm.group_id
     WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.is_active = true
       AND (u.id = cg.owner_id OR 'FAHRER' = ANY(u.roles))`,
    [groupId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Verrechnet gegenseitige Schulden zwischen zwei Nutzern (nur Nettosaldo bleibt) */
export async function netBilateralDebts(
  client: PoolClient,
  groupId: number,
  userA: number,
  userB: number
): Promise<void> {
  const ab = await client.query(
    `SELECT open_amount FROM debts
     WHERE group_id = $1 AND debtor_id = $2 AND creditor_id = $3`,
    [groupId, userA, userB]
  );
  const ba = await client.query(
    `SELECT open_amount FROM debts
     WHERE group_id = $1 AND debtor_id = $2 AND creditor_id = $3`,
    [groupId, userB, userA]
  );

  const openAB = ab.rows[0] ? parseFloat(ab.rows[0].open_amount) : 0;
  const openBA = ba.rows[0] ? parseFloat(ba.rows[0].open_amount) : 0;
  const offset = Math.round(Math.min(openAB, openBA) * 100) / 100;
  if (offset <= 0.005) return;

  await client.query(
    `UPDATE debts SET
       open_amount = GREATEST(0, open_amount - $1),
       paid_amount = paid_amount + $1,
       last_updated = NOW()
     WHERE group_id = $2 AND debtor_id = $3 AND creditor_id = $4`,
    [offset, groupId, userA, userB]
  );
  await client.query(
    `UPDATE debts SET
       open_amount = GREATEST(0, open_amount - $1),
       paid_amount = paid_amount + $1,
       last_updated = NOW()
     WHERE group_id = $2 AND debtor_id = $3 AND creditor_id = $4`,
    [offset, groupId, userB, userA]
  );

  await client.query(
    `INSERT INTO debt_entries (group_id, debtor_id, creditor_id, amount, entry_type, description)
     VALUES ($1,$2,$3,$4,'NETTING','Gegenverrechnung mit anderem Fahrer')`,
    [groupId, userA, userB, -offset]
  );
  await client.query(
    `INSERT INTO debt_entries (group_id, debtor_id, creditor_id, amount, entry_type, description)
     VALUES ($1,$2,$3,$4,'NETTING','Gegenverrechnung mit anderem Fahrer')`,
    [groupId, userB, userA, -offset]
  );
}

export async function netBilateralDebtsIfDrivers(
  client: PoolClient,
  pool: Pool,
  groupId: number,
  userA: number,
  userB: number
): Promise<void> {
  const aIsDriver = await isGroupDriver(pool, groupId, userA);
  const bIsDriver = await isGroupDriver(pool, groupId, userB);
  if (aIsDriver && bIsDriver) {
    await netBilateralDebts(client, groupId, userA, userB);
  }
}

export async function addTripDebt(
  client: PoolClient,
  pool: Pool,
  opts: {
    groupId: number;
    debtorId: number;
    creditorId: number;
    amount: number;
    tripId: number;
    tripDate: string;
  }
): Promise<void> {
  const { groupId, debtorId, creditorId, amount, tripId, tripDate } = opts;
  if (amount <= 0.005) return;

  await client.query(
    `INSERT INTO debts (group_id, debtor_id, creditor_id, total_amount, open_amount)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (group_id, debtor_id, creditor_id)
     DO UPDATE SET
       total_amount = debts.total_amount + EXCLUDED.total_amount,
       open_amount = debts.open_amount + EXCLUDED.open_amount,
       last_updated = NOW()`,
    [groupId, debtorId, creditorId, amount]
  );

  await client.query(
    `INSERT INTO debt_entries (group_id, debtor_id, creditor_id, trip_id, amount, entry_type, description)
     VALUES ($1, $2, $3, $4, $5, 'TRIP', $6)`,
    [groupId, debtorId, creditorId, tripId, amount, `Fahrt am ${tripDate}`]
  );

  await netBilateralDebtsIfDrivers(client, pool, groupId, debtorId, creditorId);
}
