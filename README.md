# 🚗 MitFahr.io – Fahrgemeinschaft Abrechnung

Eine vollständige Web-App zur Kostenabrechnung für Fahrgemeinschaften. Basiert auf React 19 + Express + PostgreSQL, läuft als Docker-Stack.

---

## 🚀 Setup (Produktion / NAS)

### Voraussetzungen
- Docker & Docker Compose installiert
- Cloudflare Tunnel eingerichtet (optional, für öffentlichen Zugriff)
- Docker-Netzwerk `cloudflare-tunnel-net` existiert (oder anpassen)

### 1. Projekt klonen / kopieren

```bash
cd /volume1/docker/mitfahr-io   # oder beliebiger Pfad auf dem NAS
```

### 2. `.env`-Datei anlegen

```bash
cp .env.example .env
nano .env
```

Mindestens diese Werte setzen:
```env
POSTGRES_PASSWORD=sicheres-passwort-aendern
JWT_SECRET=min-32-zeichen-zufaellig-generiert
APP_BASE_URL=https://mitfahr.deine-domain.de
```

JWT_SECRET generieren:
```bash
openssl rand -hex 32
```

### 3. Docker-Netzwerk erstellen (falls nicht vorhanden)

```bash
docker network create cloudflare-tunnel-net
```

### 4. Container starten

```bash
docker compose up -d
```

Der erste Start dauert etwas länger (Build + npm install).

### 5. App aufrufen

- Direkt: `http://NAS-IP:22225`
- Via Cloudflare Tunnel: konfigurierter Domain-Name

---

## 🛠️ Lokale Entwicklung

```bash
# Dependencies installieren
npm install --legacy-peer-deps

# Dev-Server starten (Vite + tsx, kein Docker nötig)
npm run dev

# ODER: Mit Docker (Hot Reload)
docker compose -f docker-compose.dev.yaml up
```

Dev läuft auf `http://localhost:3000`.

---

## ☁️ Cloudflare Tunnel Konfiguration

Im Cloudflare Tunnel Dashboard:
- **Service**: `http://mitfahr-io:3000`  (Container-Name im Docker-Netz)
- **Domain**: Deine konfigurierte Domain
- **Network**: Container muss im `cloudflare-tunnel-net`-Netzwerk sein (bereits konfiguriert)

In der `.env`:
```env
APP_BASE_URL=https://mitfahr.deine-domain.de
```

---

## 📁 Projektstruktur

```
tankpreis_rechner/
├── server.ts              # Express Backend + DB-Schema
├── src/
│   ├── lib/
│   │   ├── server/        # Modulare Route-Handler
│   │   ├── AuthContext.tsx
│   │   ├── ToastContext.tsx
│   │   └── api.ts
│   ├── components/
│   │   ├── layout/        # Navbar, Shell, NotificationDropdown
│   │   └── ui/            # Wiederverwendbare UI-Komponenten
│   └── pages/             # Alle Seiten
├── docker-compose.yaml    # Produktion
├── docker-compose.dev.yaml # Entwicklung
├── Dockerfile
└── .env.example
```

---

## ⚙️ Umgebungsvariablen (alle)

| Variable | Standard | Beschreibung |
|---|---|---|
| `APP_PORT` | `22225` | Externer Port |
| `APP_BASE_URL` | `http://localhost:22225` | Basis-URL (für E-Mail-Links) |
| `POSTGRES_PASSWORD` | *(Pflicht)* | DB-Passwort |
| `JWT_SECRET` | *(Pflicht, min. 32 Zeichen)* | Token-Signierung |
| `REGISTRATION_ENABLED` | `true` | Neue Registrierungen erlauben |
| `EMAIL_VERIFICATION_REQUIRED` | `false` | E-Mail-Verifizierung erzwingen |
| `SMTP_HOST` | *(leer)* | SMTP-Server für E-Mails |
| `SMTP_PORT` | `587` | SMTP-Port |
| `SMTP_SECURE` | `false` | SSL (true) oder STARTTLS (false) |
| `SMTP_USER` | *(leer)* | SMTP-Benutzername |
| `SMTP_PASS` | *(leer)* | SMTP-Passwort |
| `SMTP_FROM` | `noreply@mitfahr.io` | Absender-Adresse |
| `ALLOW_DEV_RESET_LINK` | `0` | Reset-Link in API-Antwort (nur Dev!) |
| `DEBT_OVERDUE_DAYS` | `14` | Tage bis Schuld als "überfällig" gilt |

---

## 🎯 Erste Schritte

1. **Fahrer-Konto erstellen**: Registrieren mit Rolle „Fahrer"
2. **Fahrzeug anlegen**: Fahrzeuge → Fahrzeug hinzufügen (Verbrauch + Kraftstoffpreis eintragen)
3. **Fahrgruppe erstellen**: Gruppen → Erstellen → 6-stelligen Einladecode teilen
4. **Mitfahrer beitreten lassen**: Mitfahrer öffnet `/join` und gibt Code ein
5. **Fahrt eintragen**: Fahrten → Fahrt eintragen → Strecken, Mitfahrer und Kraftstoffpreis angeben
6. **Abrechnung**: Kosten werden automatisch berechnet und den Mitfahrern zugeordnet
7. **Zahlung**: Mitfahrer meldet Zahlung → Fahrer bestätigt

---

## 🔧 Nützliche Befehle

```bash
# Logs anzeigen
docker compose logs -f mitfahr-io

# Neustart
docker compose restart mitfahr-io

# Update (nach Code-Änderungen)
docker compose up -d --build mitfahr-io

# Datenbank-Backup
docker exec mitfahr-db pg_dump -U mitfahr mitfahr_io > backup.sql

# Datenbank-Restore
docker exec -i mitfahr-db psql -U mitfahr mitfahr_io < backup.sql
```

---

## 📱 Mobile

Die App ist Mobile-First designed und funktioniert auf Smartphones (375px+). Installierbar als PWA (über Browser-Menü → "Zum Startbildschirm hinzufügen").
