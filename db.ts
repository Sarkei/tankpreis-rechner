import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL?.trim();
const poolSize = Number(process.env.PG_POOL_MAX ?? 5);

export const pool = connectionString
  ? new Pool({ connectionString, max: poolSize })
  : new Pool({
      host: process.env.POSTGRES_HOST ?? "localhost",
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      database: process.env.POSTGRES_DB ?? "mitfahr_io",
      user: process.env.POSTGRES_USER ?? "mitfahr",
      password: process.env.POSTGRES_PASSWORD ?? "",
      max: poolSize,
    });

pool.on("error", (err) => {
  console.error("❌ PostgreSQL Pool-Fehler:", err.message);
});

/** Legt das komplette Schema an – idempotent, keine Migration nötig. */
export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS mf_persons (
        id SERIAL PRIMARY KEY,
        name VARCHAR(60) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mf_trips (
        id SERIAL PRIMARY KEY,
        trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('HIN', 'RUECK')),
        km NUMERIC(7,2) NOT NULL CHECK (km > 0),
        driver_id INTEGER NOT NULL REFERENCES mf_persons(id) ON DELETE RESTRICT,
        fuel_price NUMERIC(6,3) NOT NULL CHECK (fuel_price > 0),
        consumption NUMERIC(5,2) NOT NULL CHECK (consumption > 0),
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mf_trip_passengers (
        trip_id INTEGER NOT NULL REFERENCES mf_trips(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES mf_persons(id) ON DELETE RESTRICT,
        PRIMARY KEY (trip_id, person_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mf_payments (
        id SERIAL PRIMARY KEY,
        debtor_id INTEGER NOT NULL REFERENCES mf_persons(id) ON DELETE RESTRICT,
        creditor_id INTEGER NOT NULL REFERENCES mf_persons(id) ON DELETE RESTRICT,
        amount NUMERIC(8,2) NOT NULL CHECK (amount > 0),
        paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mf_settings (
        key VARCHAR(40) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mf_fuel_price_cache (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        price NUMERIC(6,3),
        fuel_type VARCHAR(20) NOT NULL,
        plz VARCHAR(5) NOT NULL,
        source VARCHAR(40) NOT NULL,
        stations INTEGER,
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        error TEXT
      )
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_mf_trips_date ON mf_trips(trip_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mf_trips_driver ON mf_trips(driver_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mf_payments_pair ON mf_payments(debtor_id, creditor_id)`);

    console.log("✅ Datenbankschema bereit");
  } finally {
    client.release();
  }
}
