# Schnittstellen – iobroker.kostalpiko v0.3.1

> Technische Dokumentation aller Schnittstellen. Stand: 2026-03-14

---

## 1. Geräteschnittstelle: Kostal PIKO HTTP-Server

| Eigenschaft | Wert |
|---|---|
| Protokoll | HTTP/1.1 |
| Authentifizierung | Basic Authentication |
| Benutzername | `pvserver` |
| Passwort | `pvwr` |
| Zeichensatz | windows-1252 (latin1) |
| Standard-IP | `192.168.178.30` |
| Standard-Port | `80` |

### Endpunkte

| URL | Inhalt |
|---|---|
| `GET /index.fhtml` | Hauptseite: AC-Leistung, Energie, PV-Strings, L1/L2/L3, Status |
| `GET /Inf.fhtml` | Infoseite: Analogeingänge, Modem, Portal, S0-Pulse |
| `GET /Solar2.fhtml` | Einstellungen (wird nicht abgerufen) |
| `GET /LogDaten.dat` | Messreihen-CSV, 15-min-Intervall, ~6 Monate |

### index.fhtml – Parsing

Messwerte stehen in `<td bgcolor="#FFFFFF">WERT</td>` Zellen. Reihenfolge (positionsbasiert, Firmware 3.62):

| cells[i] | Wert | Einheit |
|---|---|---|
| 0 | AC-Leistung aktuell | W |
| 1 | Gesamtenergie | kWh |
| 2 | Tagesenergie | kWh |
| 3 | String 1 Spannung | V |
| 4 | String 1 Strom | A |
| 5 | String 2 Spannung | V |
| 6 | String 2 Strom | A |
| 7 | L1 Spannung | V |
| 8 | L1 Leistung | W |
| 9 | L2 Spannung | V |
| 10 | L2 Leistung | W |
| 11 | L3 Spannung | V |
| 12 | L3 Leistung | W |

Offline-Erkennung: leere Zellen oder Status-Text `"Aus"` → `isOn = false` → alle Messwerte = 0.

Status-Regex:
```
/Status<\/td>\s*<td colspan="4">\s*([^<]+?)\s*<\/td>/i
```

### LogDaten.dat – Dateiformat

```
Wechselricher Logdaten
Wechselrichter Nr:    255
Name:    Grosser
akt. Zeit:    495381409      ← Geräte-Uptime in Sekunden beim Export

Logdaten U[V], I[mA], P[W], E[kWh], F[Hz], R[kOhm], Ain T[digit], Zeit[sec]
Zeit    DC1 U   DC1 I   DC1 P   DC1 T   DC1 S   DC2 U   ...
 482576950    616    950    588 47959    9  ...
```

**Zeitstempel-Mechanismus:**

```javascript
// Beim HTTP-Abruf:
const fetchUnixSec = Math.floor(Date.now() / 1000);
const aktZeit      = parseInt(raw.match(/akt\.\s*Zeit:\s*(\d+)/)[1]);
const pikoEpoch    = fetchUnixSec - aktZeit;   // Unix-Sekunden (Inbetriebnahme)

// Pro Zeile:
const ts_ms = (pikoEpoch + parseInt(cols[0])) * 1000;
```

**Spalten-Schema:**

| Idx | Name | Einheit | Hinweis |
|---|---|---|---|
| 0 | Zeit | sec | Uptime-Zähler |
| 1 | DC1_U | V | |
| 2 | DC1_I | **mA** | ÷1000 für A |
| 3 | DC1_P | W | |
| 4 | DC1_T | raw | ignorieren |
| 5 | DC1_S | — | Status-Code |
| 6–10 | DC2_* | | String 2 |
| 11–15 | DC3_* | | String 3 (immer 0) |
| 16 | AC1_U | V | |
| 17 | AC1_I | **mA** | ÷1000 für A |
| 18 | AC1_P | W | |
| 19 | AC1_T | raw | ignorieren |
| 20–23 | AC2_* | | L2 |
| 24–27 | AC3_* | | L3 |
| 28 | AC_F | Hz | Netzfrequenz |
| 34 | AC_S | — | Betriebsstatus-Code |
| 35 | Err | — | Fehlercode |
| 38 | KB_S | — | Bus-Status |

Sonderzeilen (Ereignisse) enthalten `80001200h` o.ä. → werden übersprungen.

---

## 2. ioBroker-Schnittstelle

### Admin-Konfiguration (`admin/jsonConfig.json`)

| Feld | Typ | Standard |
|---|---|---|
| ip | text | `192.168.178.30` |
| port | number | `80` |
| user | text | `pvserver` |
| password | password | `pvwr` |
| pollInterval | number | `30` |
| historyFetch | checkbox | `false` |
| syncInterval | number | `15` |
| influxInstance | text | `influxdb.0` |
| webPort | number | `8092` |
| verbose | checkbox | `false` |

### Live-States (`kostalpiko.0.*`)

Werden bei jedem Poll mit aktuellem `ts = Date.now()` gesetzt.

```
info.connection           boolean  Adapter verbunden
info.lastPoll             string   ISO-8601
status                    string   "Einspeisen MPP" | "Aus" | ...
online                    number   1 | 0
ac.power                  number   W   AC-Gesamtleistung
ac.l1.voltage             number   V
ac.l1.power               number   W
ac.l2.voltage             number   V
ac.l2.power               number   W
ac.l3.voltage             number   V
ac.l3.power               number   W
energy.total              number   kWh Gesamtenergie
energy.today              number   kWh Tagesenergie
pv.string1.voltage        number   V
pv.string1.current        number   A
pv.string2.voltage        number   V
pv.string2.current        number   A
info.analog1–4            number   V   Analoge Eingänge
info.modemStatus          string
info.lastPortalConnection string
info.s0Pulses             number
rs485.busAddress          number
```

### History-Meta-States (`kostalpiko.0.history.*`)

```
lastImport        string   ISO-8601 Zeitpunkt letzter Sync
lastImportedTs    number   ms  Deduplication-Cursor
recordCount       number   Gesamt-Datenpunkte in Datei
newRecords        number   Übertragene Punkte (letzter Sync)
oldestRecord      string   ISO-8601
newestRecord      string   ISO-8601
influxSent        number   An InfluxDB gesendete Punkte
pikoEpoch         string   ISO-8601 Inbetriebnahmedatum
```

### History-Messwert-States (`kostalpiko.0.history.*`)

Diese States werden beim Sync mit **historischem** `ts` gesetzt:

```
dc1.voltage / dc1.current / dc1.power     V / A / W
dc2.voltage / dc2.current / dc2.power     V / A / W
ac1.voltage / ac1.current / ac1.power     V / A / W
ac2.voltage / ac2.current / ac2.power     V / A / W
ac3.voltage / ac3.current / ac3.power     V / A / W
ac.totalPower                             W  (L1+L2+L3 berechnet)
ac.frequency                              Hz
acStatus                                  Status-Code
errorCode                                 Fehlercode
```

---

## 3. InfluxDB-Schnittstelle

### Verbindungskonfiguration

Die InfluxDB-Verbindung (Host, Port, Datenbank, Token/Passwort) wird **nicht** im PIKO-Adapter konfiguriert. Sie gehört in:

```
ioBroker Admin → Adapter → InfluxDB → Instanz konfigurieren
```

Der PIKO-Adapter kennt nur den Instanz-Namen (`influxdb.0`) und kommuniziert über den ioBroker-internen `sendTo`-Mechanismus.

### sendTo-Aufruf (Batch pro 15-min-Messpunkt)

```javascript
adapter.sendTo('influxdb.0', 'storeState', [
    {
        id   : 'kostalpiko.0.history.ac.totalPower',
        state: {
            val : 1234,             // number – Wert in W
            ts  : 1729083201000,    // number – ms, historischer Messzeitpunkt
            ack : true,
            q   : 0
        }
    },
    // ... 18 weitere States
], (result) => {
    if (result && result.error) console.warn('InfluxDB Fehler:', result.error);
});
```

Der InfluxDB-Adapter schreibt jeden Punkt mit dem übergebenen `ts` als Measurement-Zeitstempel in die Datenbank.

### Sync-Verhalten

| Modus | Auslöser | Verhalten |
|---|---|---|
| Automatisch | alle `syncInterval` Minuten | nur Punkte mit `ts > lastImportedTs` |
| Manuell (neue) | Button „Neue Punkte sync" / `/api/trigger-history` | nur neue Punkte |
| Vollsync | Button „Sync-All" / `/api/sync-all` | Cursor auf 0, alle ~6 Monate |

---

## 4. Web-Interface API

Port: `8092` (konfigurierbar). Kein Login erforderlich.

| Route | Response-Inhalt |
|---|---|
| `GET /` | Web-UI HTML (Single Page, 5 Tabs) |
| `GET /api/ping` | `{"ok":true,"adapter":"kostalpiko","version":"0.3.1"}` |
| `GET /api/data` | `{data:{...}, nodes:{...}, ts:"ISO"}` |
| `GET /api/history` | `{rows:[...], pikoEpoch:"ISO", recordCount:N, lastImported:"ISO"}` |
| `GET /api/logs` | `{logs:[{ts,level,message},...]}` |
| `GET /api/status` | Adapter-Status inkl. syncInterval, influxInst, pikoEpoch |
| `GET /api/trigger-history` | Startet Sync (nur neue Punkte); `{"ok":true}` |
| `GET /api/sync-all` | Setzt Cursor=0, startet Vollsync; `{"ok":true}` |

### /api/data Response-Beispiel

```json
{
  "data": {
    "status": "Einspeisen MPP",
    "online": 1,
    "ac.power": 1234,
    "energy.total": 141240,
    "energy.today": 42.16,
    "pv.string1.voltage": 556,
    "pv.string1.current": 0.37,
    "_ts": "2026-03-13T16:45:00.000Z"
  },
  "nodes": {
    "ac.power": {"name":"AC-Leistung aktuell","type":"number","unit":"W"},
    "...": "..."
  }
}
```

### /api/status Response-Beispiel

```json
{
  "adapter"      : "kostalpiko",
  "version"      : "0.3.1",
  "ip"           : "192.168.178.30",
  "port"         : 80,
  "interval"     : 30,
  "online"       : true,
  "historyEnable": true,
  "syncInterval" : 15,
  "influxEnable" : true,
  "influxInst"   : "influxdb.0",
  "pikoEpoch"    : "2010-07-02T04:44:11.000Z",
  "lastImported" : "2026-03-13T18:30:00.000Z"
}
```

---

## 5. Design-System (Web-UI)

Identisch mit iobroker.metermaster:

```css
--bg:        #0d1117   /* Haupt-Hintergrund */
--bg2:       #161b22   /* Cards, Header */
--bg3:       #1c2128   /* Value-Cards, Controls */
--border:    #30363d   /* Rahmen */
--accent:    #f6c90e   /* Primär-Akzent (Solar-Gelb) */
--green:     #3fb950   /* Online, Energie */
--red:       #f85149   /* Fehler, Offline */
--blue:      #58a6ff   /* Spannung, Links */
--orange:    #e3b341   /* Warnungen */
--text:      #e6edf3   /* Primärtext */
--muted:     #8b949e   /* Sekundärtext */
```

---

## 6. Abhängigkeiten

| Paket | Version | Zweck |
|---|---|---|
| `@iobroker/adapter-core` | `^3.0.0` | ioBroker Framework |
| Node.js | `>= 16.0.0` | Laufzeit |
| js-controller | `>= 3.0.0` | ioBroker Core |

Keine weiteren npm-Pakete. Nur Node.js-stdlib (`http`, `url`).
