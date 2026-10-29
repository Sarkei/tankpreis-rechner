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
      CREATE TABLE IF NOT EXISTS persons (
        id SERIAL PRIMARY KEY,
        name VARCHAR(60) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trips (
        id SERIAL PRIMARY KEY,
        trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
        direction VARCHAR(10) NOT NULL CHECK (direction IN ('HIN', 'RUECK')),
        km NUMERIC(7,2) NOT NULL CHECK (km > 0),
        driver_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        fuel_price NUMERIC(6,3) NOT NULL CHECK (fuel_price > 0),
        consumption NUMERIC(5,2) NOT NULL CHECK (consumption > 0),
        from_label VARCHAR(200),
        to_label VARCHAR(200),
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS trip_passengers (
        trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
        person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        PRIMARY KEY (trip_id, person_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        debtor_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        creditor_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE RESTRICT,
        amount NUMERIC(8,2) NOT NULL CHECK (amount > 0),
        paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key VARCHAR(40) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fuel_price_cache (
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

    await client.query(`
      ALTER TABLE trips
        ADD COLUMN IF NOT EXISTS from_label VARCHAR(200),
        ADD COLUMN IF NOT EXISTS to_label VARCHAR(200)
    `);


    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(80) NOT NULL,
        last_name VARCHAR(80) NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT false,
        is_active BOOLEAN NOT NULL DEFAULT true,
        person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        home_label VARCHAR(200),
        home_lat NUMERIC(9,6),
        home_lon NUMERIC(9,6),
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reset_codes (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        code_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS mail_queue (
        id SERIAL PRIMARY KEY,
        to_email VARCHAR(255) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        error TEXT
      )
    `);

    await client.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS home_label VARCHAR(200),
        ADD COLUMN IF NOT EXISTS home_lat NUMERIC(9,6),
        ADD COLUMN IF NOT EXISTS home_lon NUMERIC(9,6),
        ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ
    `);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mail_queue_pending ON mail_queue(sent_at) WHERE sent_at IS NULL`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(trip_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_pair ON payments(debtor_id, creditor_id)`);

    console.log("✅ Datenbankschema bereit");
  } finally {
    client.release();
  }
}
