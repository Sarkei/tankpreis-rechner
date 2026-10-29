# MitFahr.io 2.0 – Fahrgemeinschaft abrechnen

Eine Seite, zwei Tabs, keine Anmeldung. Wer fährt und wer mitfährt wird eingetragen,
den Spritpreis holt die App automatisch von clever-tanken.de (Daten der MTS-K),
und unter „Zahlungen" steht in einer Matrix, wer wem wie viel schuldet.

## Was die App macht

- **Personen**: auf der Seite anlegen und löschen (Name genügt, kein Konto).
- **Fahrten**: Datum, Fahrer, Mitfahrer, Richtung (Hinfahrt / Rückfahrt / beides),
  Kilometer hin und zurück. Kosten je Fahrt = `km / 100 × Verbrauch × Tankpreis`,
  geteilt durch alle Insassen (Fahrer + Mitfahrer). Der Tankpreis wird beim
  Speichern festgeschrieben, alte Fahrten ändern sich also nicht mehr.
- **Zahlungen**: Matrix mit Fahrern in den Zeilen und Mitfahrern in den Spalten.
  Roter Betrag = offen, `0,00 €` grün = ausgeglichen. Häkchen in der Zelle bestätigt
  eine einzelne Zahlung (mit Rückfrage), der Button unter der Spalte begleicht alle
  offenen Beträge eines Mitfahrers (mit Rückfrage).
- **Einstellungen**: PLZ, Kraftstoff (Super E10, Diesel, SuperPlus), Verbrauch und
  wahlweise ein manueller Literpreis statt der Automatik.

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
  Tabellen: `persons`, `trips`, `trip_passengers`, `payments`, `settings`, `fuel_price_cache`.

### API

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/state` | Personen, Fahrten, Matrix, Einstellungen, Preis |
| POST | `/api/persons` | Person anlegen `{name}` |
| PATCH | `/api/persons/:id` | Person umbenennen `{name}` |
| DELETE | `/api/persons/:id` | Person löschen (nur ohne Fahrten/Zahlungen) |
| POST | `/api/trips` | Fahrt anlegen `{date, driverId, passengerIds, direction, km, kmReturn}` |
| DELETE | `/api/trips/:id` | Fahrt löschen |
| POST | `/api/payments/settle` | `{debtorId, creditorId?}` – mit `creditorId` ein Paar, ohne alle offenen Beträge |
| GET | `/api/fuel-price` | aktuellen Preis lesen (`?refresh=1` erzwingt neu) |
| PUT | `/api/settings` | `{plz, fuelType, consumption, priceMode, manualPrice}` |

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

Es gibt bewusst keine Anmeldung – wer die URL kennt, kann Einträge ändern. Für den
Betrieb von außen gehört deshalb eine Cloudflare-Access-Regel davor (wie bei den
anderen Diensten auf dem NAS).
