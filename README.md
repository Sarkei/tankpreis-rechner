# MitFahr.io 2.0 – Fahrgemeinschaft abrechnen

Eine Seite, zwei Tabs. Jeder legt ein Konto an, trägt seine Fahrten ein, und unter
„Zahlungen" steht in einer Matrix, wer wem wie viel schuldet. Den Spritpreis holt die
App automatisch von clever-tanken.de (Daten der MTS-K).

## Was die App macht

- **Konten**: Registrierung mit Vorname, Nachname, E-Mail und Passwort (mind. 8 Zeichen,
  Großbuchstabe, Zahl, Sonderzeichen). Jedes Konto hängt an einer Person aus der
  Fahrten-Liste; eine bestehende Person kann bei der Registrierung übernommen werden.
  `ADMIN_EMAIL` (Standard `nagraszust@gmail.com`) wird beim Registrieren automatisch Admin.
- **Fahrten**: Datum, Fahrer, Mitfahrer, Richtung (Hinfahrt / Rückfahrt / beides),
  Kilometer hin und zurück. Kosten je Fahrt = `km / 100 × Verbrauch × Tankpreis`,
  geteilt durch alle Insassen (Fahrer + Mitfahrer). Der Tankpreis wird beim
  Speichern festgeschrieben, alte Fahrten ändern sich also nicht mehr.
- **Zahlungen**: Matrix mit Fahrern in den Zeilen und Mitfahrern in den Spalten.
  Roter Betrag = offen, `0,00 €` grün = ausgeglichen. Häkchen in der Zelle bestätigt
  eine einzelne Zahlung (mit Rückfrage), der Button unter der Spalte begleicht alle
  offenen Beträge eines Mitfahrers (mit Rückfrage).
- **Einstellungen**: Zuhause-Adresse je Konto (per Ortssuche, im Fahrt-Dialog als
  Schnellwahl für Start und Ziel) und – nur für Admins – PLZ, Kraftstoff, Verbrauch und
  wahlweise ein manueller Literpreis statt der Automatik.
- **Admin-Dashboard**: alle Konten mit letztem Login und Fahrten-Zähler, Passwort direkt
  neu setzen, Konto löschen (die Person bleibt, wenn noch Fahrten daran hängen).
- **Passwort vergessen**: 6-stelliger Code per Mail (15 Minuten gültig, 5 Versuche),
  danach neues Passwort.

## Rechte

| Aktion | Nutzer | Admin |
| --- | --- | --- |
| Fahrten sehen, Preise holen | ✓ | ✓ |
| Fahrt eintragen | nur als eigener Fahrer | für alle Personen |
| Fahrt löschen | nur eigene | alle |
| Schulden begleichen | nur eigene | alle |
| Zuhause-Adresse | eigene | eigene |
| PLZ, Kraftstoff, Verbrauch, Preis | – | ✓ |
| Kontenliste, Passwort setzen, Konto löschen | – | ✓ |

Die Session liegt in einem `httpOnly`-Cookie (JWT, 30 Tage). Login und „Passwort vergessen"
sind auf 10 bzw. 5 Versuche pro Viertelstunde gedrosselt.

## Tankpreis

`GET /api/fuel-price` holt `https://www.clever-tanken.de/tankstelle_liste?ort=<PLZ>&spritsorte=<Code>&r=10`,
liest die Preise der Tankstellen im 10-km-Umkreis aus und nimmt den Durchschnitt der
fünf günstigsten. Ergebnis wird 6 Stunden gecacht (Tabelle `fuel_price_cache`) und
alle 3 Stunden im Hintergrund erneuert. Fällt die Quelle aus, gilt der letzte
bekannte Preis als „veraltet".

## Aufbau

- **Frontend**: React 19 + Vite 6 + Tailwind 4, dunkles UI, mobil zuerst,
  eine Seite mit zwei Tabs (`Fahrten`, `Zahlungen`).
- **Backend**: Express 4 in TypeScript, liefert API und Frontend aus einem Prozess.
- **Datenbank**: PostgreSQL 16, Schema beim Start idempotent angelegt.
  Tabellen: `users`, `reset_codes`, `mail_queue`, `persons`, `trips`,
  `trip_passengers`, `payments`, `settings`, `fuel_price_cache`.

### API

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/public/persons` | offene Personen für die Registrierung (ohne Konto) |
| POST | `/api/auth/register` | `{firstName, lastName, email, password, personId?}` |
| POST | `/api/auth/login` | `{email, password}` → Session-Cookie |
| POST | `/api/auth/logout` | Session beenden |
| GET | `/api/auth/me` | eigenes Konto |
| POST | `/api/auth/forgot` | Code anfordern `{email}` (immer 200) |
| POST | `/api/auth/verify-code` | `{email, code}` → kurzlebiger `resetToken` |
| POST | `/api/auth/reset-password` | `{resetToken, password}` |
| PUT | `/api/me/home` | eigene Zuhause-Adresse `{home: {label, lat, lon} \| null}` |
| GET | `/api/admin/users` | Kontenliste (Admin) |
| POST | `/api/admin/users/:id/password` | Passwort setzen `{password}` (Admin) |
| DELETE | `/api/admin/users/:id` | Konto löschen (Admin) |
| GET | `/api/state` | Personen, Fahrten, Matrix, Einstellungen, Preis, eigenes Konto |
| POST | `/api/trips` | Fahrt anlegen `{date, driverId, passengerIds, direction, km, kmReturn}` |
| DELETE | `/api/trips/:id` | Fahrt löschen (eigene oder Admin) |
| POST | `/api/payments/settle` | `{debtorId, creditorId?}` – eigene Schulden oder Admin |
| GET | `/api/fuel-price` | aktuellen Preis lesen (`?refresh=1` erzwingt neu) |
| PUT | `/api/settings` | `{plz, fuelType, consumption, priceMode, manualPrice}` (Admin) |
| GET | `/api/geo/search` | Ortssuche (Photon, PLZ-gewichtet) |
| GET | `/api/geo/route` | Strecke zwischen zwei Punkten (OSRM) |

## Starten

```bash
cp .env.example .env        # POSTGRES_PASSWORD setzen
docker compose up -d --build
```

Danach läuft die App unter `http://<host>:22225`.

Lokal ohne Docker:

```bash
npm install
npm run dev                 # API auf :3000, Vite separat mit `npm run preview` bzw. Proxy
```

## Sicherheit

Passwörter liegen als bcrypt-Hash (Kosten 12) in der Datenbank, Sessions als
`httpOnly`-Cookie, damit JavaScript sie nicht auslesen kann. Der Reset-Code wird nur
gehasht gespeichert und ist nach 15 Minuten oder 5 Fehlversuchen ungültig. Mails gehen
nicht direkt aus der App: sie landen in `mail_queue` und werden von einem Cronjob des
Agenten über Gmail verschickt (kein Mail-Zugang im App-Container).
