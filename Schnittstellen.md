# Schnittstellen – iobroker.kostalpiko v0.3.4

> Stand: 2026-03-14

---

## 1. Geräteschnittstelle: Kostal PIKO HTTP-Server

| Eigenschaft | Wert |
|---|---|
| Protokoll | HTTP/1.1 |
| Auth | Basic Authentication |
| Benutzer | `pvserver` |
| Passwort | `pvwr` |
| Zeichensatz | windows-1252 (latin1) – `res.setEncoding('latin1')` zwingend |
| Standard-IP | `192.168.178.30` (PIKO 8.3) / `192.168.178.31` (PIKO 5.5) |

### Endpunkte

| URL | Inhalt |
|---|---|
| `GET /index.fhtml` | Hauptseite: AC, Energie, PV-Strings, L1/L2/L3, Status |
| `GET /Inf.fhtml` | Infoseite: Analogeingänge, Modem, Portal, S0-Pulse |
| `GET /LogDaten.dat` | Messreihen-CSV, 15-min-Intervall, ~6 Monate |
| `GET /Solar2.fhtml` | Einstellungen (wird nicht abgerufen) |

### index.fhtml – Parsing

Messwerte stehen in `<td bgcolor="#FFFFFF">WERT</td>` Zellen. Beide PIKO-Modelle zeigen `x x x` wenn offline.

**String-Erkennung (auto):**

| Zellen-Anzahl | Modell | Strings | acOffset |
|---|---|---|---|
| 13 | PIKO 8.3 | 2 | 0 |
| 15 | PIKO 5.5 | 3 | 2 |

**Zellenreihenfolge (Firmware 3.62):**

| Index | Wert | Einheit | Hinweis |
|---|---|---|---|
| 0 | AC-Leistung | W | Bei offline = 0 |
| 1 | Gesamtenergie | kWh | **Immer lesen** (auch offline gültig) |
| 2 | Tagesenergie | kWh | **Immer lesen** |
| 3 | String 1 Spannung | V | |
| 4 | String 1 Strom | A | |
| 5 | String 2 Spannung | V | |
| 6 | String 2 Strom | A | |
| 7 | String 3 Spannung* | V | *nur PIKO 5.5 |
| 8 | String 3 Strom* | A | *nur PIKO 5.5 |
| 7+acOffset | L1 Spannung | V | |
| 8+acOffset | L1 Leistung | W | |
| 9+acOffset | L2 Spannung | V | |
| 10+acOffset | L2 Leistung | W | |
| 11+acOffset | L3 Spannung | V | |
| 12+acOffset | L3 Leistung | W | |

### LogDaten.dat – Format

```
Wechselricher Logdaten
Wechselrichter Nr:    255
Name:    Grosser
akt. Zeit:    495381409      ← Geräte-Uptime beim Export (Sekunden)

Logdaten U[V], I[mA], P[W], E[kWh], F[Hz], ...
Zeit    DC1 U   DC1 I   DC1 P   ...
 482576950   616   950   588 ...
```

**Zeitstempel:**
```javascript
const pikoEpoch = Math.floor(Date.now() / 1000) - aktZeit;
const ts_ms     = (pikoEpoch + cols[0]) * 1000;
```

**Spalten (wichtigste):**

| Idx | Name | Einheit | Hinweis |
|---|---|---|---|
| 0 | Zeit | sec | Geräte-Uptime-Zähler |
| 1,2,3 | DC1 U/I/P | V / **mA** / W | I ÷ 1000 = A |
| 4 | DC1 T | raw | Ignorieren |
| 5 | DC1 S | – | Status-Code |
| 6–10 | DC2 * | | String 2 |
| 11–15 | DC3 * | | String 3 (PIKO 5.5) |
| 16–19 | AC1 U/I/P/T | V / mA / W | L1, T ignorieren |
| 20–23 | AC2 * | | L2 |
| 24–27 | AC3 * | | L3 |
| 28 | AC F | Hz | Netzfrequenz |
| 34 | AC S | – | Betriebsstatus-Code |
| 35 | Err | – | Fehlercode |
| 38 | KB S | – | Bus-Status |

Sonderzeilen mit `80001200h` → werden übersprungen.

---

## 2. ioBroker-Schnittstelle

### Admin-Konfiguration (`admin/jsonConfig.json`)

| Feld | Typ | Standard | Sichtbarkeit |
|---|---|---|---|
| `ip` | text | `192.168.178.30` | immer |
| `port` | number | `80` | immer |
| `networkMode` | select | `local` | immer |
| `fritzwgInstance` | text | `fritzwireguard.0` | nur wenn networkMode=fritzwireguard |
| `fritzwgConnectedState` | text | `''` | nur wenn networkMode=fritzwireguard |
| `user` | text | `pvserver` | immer |
| `password` | password | `pvwr` | immer |
| `pollInterval` | number | `30` | immer |
| `historyFetch` | checkbox | `false` | immer |
| `syncInterval` | number | `15` | immer |
| `influxInstance` | text | `influxdb.0` | immer |
| `webPort` | number | `8092` | immer |
| `verbose` | checkbox | `false` | immer |

### States (`kostalpiko.0.*`)

```
info.connection           boolean  Adapter verbunden
info.lastPoll             string   ISO-8601
info.networkMode          string   "local" | "fritzwireguard"
status                    string   Betriebsstatus-Text
online                    number   1 | 0
device.strings            number   2 | 3 (auto-erkannt)
ac.power                  number   W
ac.l1/l2/l3.voltage       number   V
ac.l1/l2/l3.power         number   W
energy.total              number   kWh  (auch nachts gültig)
energy.today              number   kWh  (auch nachts gültig)
pv.string1/2.voltage      number   V
pv.string1/2.current      number   A
pv.string3.voltage/current number  V/A  (nur PIKO 5.5)
info.analog1–4            number   V
info.modemStatus          string
info.lastPortalConnection string
info.s0Pulses             number
rs485.busAddress          number

history.lastImport        string   ISO-8601
history.lastImportedTs    number   ms (Deduplication-Cursor)
history.recordCount       number
history.newRecords        number
history.oldestRecord      string   ISO-8601
history.newestRecord      string   ISO-8601
history.influxSent        number
history.pikoEpoch         string   ISO-8601

history.dc1/dc2.voltage/current/power    V/A/W  (historischer ts)
history.ac1/ac2/ac3.voltage/current/power
history.ac.totalPower     number   W
history.ac.frequency      number   Hz
history.acStatus          number
history.errorCode         number
```

---

## 3. Netzwerk-Schnittstelle: fritzwireguard (v0.3.4)

### Konzept

Der WireGuard-Tunnel läuft **dauerhaft** auf OS-Ebene. Die PIKO-IP bleibt identisch (`192.168.178.30`). Der Adapter prüft nur den Tunnel-Status, bevor er HTTP-Anfragen sendet.

### Konfiguration

```
networkMode           = 'fritzwireguard'
fritzwgInstance       = 'fritzwireguard.0'
fritzwgConnectedState = ''   (leer = Auto: fritzwireguard.0.info.connection)
```

### Poll-Logik

```javascript
// _checkNetwork() vor jedem Poll:
const stateId = fritzwgConnectedState || fritzwgInstance + '.info.connection';
const st = await getForeignStateAsync(stateId);

if (!st || !st.val) {
    log.warn(`Tunnel nicht aktiv (${stateId} = false) → Poll übersprungen`);
    return false;
}
// true → pollen
```

### Verhalten

| Tunnel-Status | Aktion |
|---|---|
| `true` | Poll normal ausführen |
| `false` | WARN-Log, Poll übersprungen, `info.connection = false` |
| State nicht lesbar | WARN-Log, Poll übersprungen |
| networkMode = `local` | Kein Check, direkt pollen |

---

## 4. InfluxDB-Schnittstelle

InfluxDB-Verbindung (Host, Port, DB, Token) → **ioBroker Admin → InfluxDB-Adapter**.

```javascript
// sendTo-Aufruf pro History-Zeile (Batch, 19 States):
adapter.sendTo('influxdb.0', 'storeState', [
    { id: 'kostalpiko.0.history.ac.totalPower',
      state: { val: 1234, ts: 1729083201000, ack: true, q: 0 } }
], callback);
```

---

## 5. Web-Interface API

Port: `webPort` (Standard 8092). Kein Login.

| Route | Beschreibung |
|---|---|
| `GET /` | Web-UI HTML (~15 KB) |
| `GET /app.js` | Browser-JavaScript (aus `admin/app.js`) |
| `GET /api/ping` | `{"ok":true,"adapter":"kostalpiko","version":"0.3.4"}` |
| `GET /api/data` | Live-Daten + Nodes-Definition |
| `GET /api/history` | Letzte 200 History-Zeilen (neueste zuerst) |
| `GET /api/logs` | Log-Buffer (max. 500 Einträge) |
| `GET /api/status` | Adapter-Status inkl. networkMode, pikoEpoch |
| `GET /api/trigger-history` | Sync starten (nur neue Punkte) |
| `GET /api/sync-all` | Vollsync (cursor=0, alle ~6 Monate) |

### /api/status Response

```json
{
  "adapter"      : "kostalpiko",
  "version"      : "0.3.4",
  "ip"           : "192.168.178.30",
  "port"         : 80,
  "interval"     : 30,
  "online"       : true,
  "networkMode"  : "local",
  "historyEnable": false,
  "syncInterval" : 15,
  "influxEnable" : false,
  "influxInst"   : "influxdb.0",
  "pikoEpoch"    : "2010-07-02T04:44:11.000Z",
  "lastImported" : "2026-03-14T08:00:00.000Z"
}
```

---

## 6. Design-System (identisch mit iobroker.metermaster)

```css
--bg: #0d1117  --bg2: #161b22  --bg3: #1c2128  --border: #30363d
--accent: #f6c90e  --green: #3fb950  --red: #f85149
--blue: #58a6ff    --orange: #e3b341
--text: #e6edf3    --muted: #8b949e
```

---

## 7. Abhängigkeiten

| Paket | Version |
|---|---|
| `@iobroker/adapter-core` | `^3.0.0` |
| Node.js | `>= 16.0.0` |
| js-controller | `>= 3.0.0` |

Keine weiteren npm-Pakete. Node.js stdlib: `http`, `url`, `fs`, `path`.
