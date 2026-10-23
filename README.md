# MitFahr.io – Fahrgemeinschafts-Abrechnung

Web-App zur Abrechnung von Fahrgemeinschaften: Fahrer legen Fahrzeuge und Fahrten an,
Mitfahrer treten per Einladungscode bei, die App rechnet aus Strecke, Verbrauch und
Kraftstoffpreis die Anteile aus und führt daraus Schulden und Zahlungen. Ein
Express-Server liefert API und Frontend, PostgreSQL speichert, die Preise kommen
optional von der Tankerkoenig-API.

## Funktionen

- **Konten und Rollen**: Registrierung als `FAHRER` oder `MITFAHRER` (Rollen als Array),
  Login per E-Mail und Passwort, JWT mit 7 Tagen (`rememberMe` 30), Passwort-Reset per
  Mail-Token, optionale E-Mail-Verifizierung, Profil mit Avatar-Upload (max. 5 MB),
  IBAN und PLZ. Admin ist, wessen Adresse `ADMIN_EMAIL` entspricht: Benutzerliste und
  Zwangs-Passwortwechsel (`POST /api/admin/users/:id/require-password`).
- **Fahrzeuge**: `BENZIN`, `DIESEL`, `ELEKTRO`, `HYBRID`, Verbrauch je 100 km,
  Tankinhalt, Kennzeichen, Standardfahrzeug, Tankprotokoll (Datum, Liter, €/Liter).
- **Automatische Preise**: pro Fahrzeug aktivierbar, PLZ am Fahrzeug oder Benutzer;
  Abruf bei Tankerkoenig (`list.php`, 10 km Umkreis, nach Preis sortiert), PLZ zu
  Koordinaten über zippopotam.us. Übernommen wird der Durchschnitt der fünf günstigsten
  Tankstellen (`BENZIN`/`HYBRID` → `e5`, `DIESEL` → `diesel`, `ELEKTRO` übersprungen).
  Cache 6 h, täglicher Lauf 06:10–06:40 Uhr (Europe/Berlin, mit Jitter), manuell über
  `POST /api/fuel-prices/refresh` (nur Rolle `FAHRER`).
- **Gruppen**: 6-stelliger Einladungscode, Beitritt per Code, Mitglieder entfernen, Code
  erneuern, archivieren, Standardstrecke und Standardpreis je Gruppe.
- **Fahrten**: Fahrer, Fahrzeug, Datum, getrennte Kilometer für Hin- und Rückweg,
  Mitfahrer je Richtung, Kommentar. Kosten je Richtung `(km × Verbrauch/100) × Preis`;
  `WITHOUT_DRIVER` teilt die vollen Kosten auf die Mitfahrer, `WITH_DRIVER` auf
  Mitfahrer plus Fahrer, der Rundungsrest geht an den letzten Mitfahrer alphabetisch.
  Vorschau vor dem Speichern, Ändern und Löschen mit Neuberechnung, Kalender und Liste.
- **Schulden und Zahlungen**: aggregierte Schulden je Schuldner, Gläubiger und Gruppe,
  Zahlung melden (`OFFEN` → `GEMELDET`), vom Fahrer bestätigen (`BESTAETIGT`) oder
  ablehnen, Zahlungseintrag durch den Fahrer, Schuldenhistorie, IBAN kopieren.
  In-App-Benachrichtigungen zu Gruppeneintritt, neuer Fahrt sowie gemeldeter und
  bestätigter Zahlung, mit Ungelesen-Zähler und „alle gelesen".
- **Statistik und Export**: Dashboard je Rolle (offene Forderungen, zu bestätigende
  Zahlungen, letzte Fahrten), Gruppenstatistik mit Monats- und Preisverlauf (recharts),
  CSV-Export der Fahrten einer Gruppe, PDF-Monatsbericht je Mitfahrer.

## Technik

- **Frontend**: React 19, React Router 7, Vite 6, TypeScript 5.8, Tailwind CSS 4,
  recharts, lucide-react, motion, date-fns; dunkles UI, mobil zuerst.
- **Backend**: Express 4 in TypeScript, ein Prozess für API und Frontend. In
  Entwicklung hängt Vite als Middleware im Server, in Produktion liefert er `dist/` und
  fällt auf `index.html` zurück (SPA).
- **Datenbank**: PostgreSQL 16 über `pg`; das Schema entsteht beim Start idempotent
  (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`), ohne
  Migrationswerkzeug. Tabellen: `users`, `password_reset_tokens`,
  `email_verification_tokens`, `vehicles`, `fuel_logs`, `carpool_groups`,
  `group_memberships`, `trips`, `trip_participations`, `debts`, `payments`, `debt_entries`,
  `notifications`.
- **Auth**: `jsonwebtoken` (HS256, `JWT_SECRET`) und `bcryptjs` (Kosten 12); das Token
  liegt im `localStorage` und geht als `Authorization: Bearer …` mit, `requireAuth`
  prüft zusätzlich `is_active`.
- **Weiteres**: `express-rate-limit` (20 Anfragen/15 min auf Auth-Routen), `nodemailer`
  (ohne `SMTP_HOST` still nichts), `multer` für Avatare, `pdfkit` für PDF, `zod` für Checks.

## Projektstruktur

```
tankpreis-rechner/
├── server.ts            # Express-App, Auth, Admin, DB-Schema, Mailer
├── Dockerfile           # zweistufiger Build (Vite + esbuild)
├── docker-compose.yaml  # Produktion · dev-Variante · .env.example
└── src/
    ├── main.tsx, App.tsx, AppRoot.tsx, types.ts
    ├── lib/             # api.ts, AuthContext, ToastContext, tripCost.ts, iban.ts
    │   └── server/      # Routen-Module, fuelPriceService, Helpers
    ├── components/      # Modals, Karten, Kalender; layout/, ui/
    └── pages/           # Dashboard, Fahrten, Gruppen, Fahrzeuge, Schulden,
                         # Statistik, Einstellungen, Auth
```

## Start

### Lokal mit npm

```bash
npm install --legacy-peer-deps
cp .env.example .env      # Werte anpassen
npm run dev               # tsx server.ts → http://localhost:3000

npm run lint          # tsc --noEmit
npm run build         # vite build → dist/
npm run build:server  # esbuild → server.js
npm start             # node server.js (NODE_ENV=production)
```

`npm run dev` startet API und Frontend auf einem Port (3000, Vite als Middleware);
PostgreSQL muss erreichbar sein (`POSTGRES_*`), alternativ nur die DB aus dem Dev-Compose.

### Docker

```bash
docker network create cloudflare-tunnel-net   # falls externes Netz fehlt
cp .env.example .env
docker compose up -d --build

docker compose -f docker-compose.dev.yaml up   # Dev: App 3000, DB 5433
docker compose logs -f mitfahr-io
docker compose up -d --build mitfahr-io        # nach Code-Änderungen
```

App auf `${APP_PORT}` (Standard `22225`) gegen internen Port 3000, PostgreSQL 16 mit
Volume `postgres_data`, Uploads in `uploads_data`, Healthcheck über `/api/health`;
zusätzlich hängt der Container im externen Netz `cloudflare-tunnel-net`.

## Konfiguration

Variablen aus `.env.example`:

`APP_PORT`, `APP_BASE_URL`, `POSTGRES_PASSWORD`, `JWT_SECRET`,
`REGISTRATION_ENABLED`, `EMAIL_VERIFICATION_REQUIRED`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALLOW_DEV_RESET_LINK`,
`ADMIN_EMAIL`, `DEBT_OVERDUE_DAYS`, `TANKERKOENIG_API_KEY`, `CRON_SECRET`

Das Produktions-Compose setzt zusätzlich `NODE_ENV`, `PORT`, `TRUST_PROXY`,
`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB` und `POSTGRES_USER`.

## Hinweise

- `DEBT_OVERDUE_DAYS` steht in `.env.example` und im Compose, wird im Code aber
  nirgends gelesen – eine Überfällig-Markierung gibt es nicht.
- `CRON_SECRET` schützt `POST /api/internal/cron/fuel-prices` per Bearer-Vergleich; ohne
  gesetztes Secret antwortet der Endpunkt immer mit 401. Er ist der einzige
  API-Endpunkt ohne `requireAuth`.
- Die freie Tankerkoenig-Stufe erlaubt rund eine Anfrage pro Minute, deshalb wartet der
  Service 65 s zwischen zwei PLZ-Gruppen. Viele verschiedene PLZ dauern entsprechend.
- `JWT_SECRET` und `POSTGRES_PASSWORD` haben im Code und im Compose Fallbacks – ohne
  gesetzte Werte startet die App mit bekanntem Secret. `.env.example` enthält statt
  Platzhaltern ein konkretes Passwort und eine echte Admin-Adresse; vor Weitergabe des
  Repos ersetzen.
- Die `.env` wird im Produktions-Compose doppelt eingebunden (`env_file` plus
  Volume-Mount), damit auch `dotenv` sie liest. Der Kommentar in `docker-compose.dev.yaml`
  nennt Port 5173 für Vite; tatsächlich lauscht alles auf 3000 (Vite als Middleware).
- Schemaänderungen laufen nur über `initDb()` beim Start: neue Spalten dort als
  idempotentes `ALTER TABLE … ADD COLUMN IF NOT EXISTS` ergänzen, ein Rollback-Pfad
  existiert nicht. Backup:
  `docker exec mitfahr-db pg_dump -U mitfahr mitfahr_io > backup.sql`.
