# Schnittstellen – iobroker.kostalpiko v0.3.7

> Stand: 2026-03-15

---

## 1. Geräteschnittstelle: Kostal PIKO HTTP-Server

| Eigenschaft | Wert |
|---|---|
| Protokoll | HTTP/1.1 |
| Auth | Basic Authentication |
| Benutzer | `pvserver` |
| Passwort | `pvwr` |
| Zeichensatz | windows-1252 → `res.setEncoding('latin1')` zwingend |
| Standard-IPs | `192.168.178.30` (PIKO 8.3) / `192.168.178.31` (PIKO 5.5) |

### Endpunkte

| URL | Inhalt |
|---|---|
| `GET /index.fhtml` | Hauptseite: AC, Energie, PV-Strings, L1/L2/L3, Status |
| `GET /Inf.fhtml` | Infoseite: Analogeingänge, Modem, Portal, S0 |
| `GET /LogDaten.dat` | Messreihen-CSV, 15-min-Intervall, ~6 Monate |

### index.fhtml – Parsing (v0.3.5)

#### Offline-Erkennung
Beide PIKO-Modelle zeigen `x x x` in `bgcolor="#FFFFFF"` Zellen wenn offline.  
Energie-Zellen (index 1+2) enthalten immer echte Werte — auch nachts.

#### Interleaved Zellenreihenfolge

**KRITISCH:** String und L-Phase stehen in **derselben HTML-Tabellenzeile**:

```
Zeile 1: [String1 Spannung] [L1 Spannung]   → cells[3], cells[4]
Zeile 2: [String1 Strom]    [L1 Leistung]   → cells[5], cells[6]
Zeile 3: [String2 Spannung] [L2 Spannung]   → cells[7], cells[8]
Zeile 4: [String2 Strom]    [L2 Leistung]   → cells[9], cells[10]
```

**Vollständige Zuordnung:**

| Idx | Wert | Einheit | Online-only |
|---|---|---|---|
| 0 | AC-Leistung | W | ja |
| 1 | Gesamtenergie | kWh | **nein** |
| 2 | Tagesenergie | kWh | **nein** |
| 3 | String 1 Spannung | V | ja |
| 4 | L1 Spannung | V | ja |
| 5 | String 1 Strom | A | ja |
| 6 | L1 Leistung | W | ja |
| 7 | String 2 Spannung | V | ja |
| 8 | L2 Spannung | V | ja |
| 9 | String 2 Strom | A | ja |
| 10 | L2 Leistung | W | ja |
| **2-String-Modelle** (PIKO 8.3 etc.) | | | |
| 11 | L3 Spannung | V | ja |
| 12 | L3 Leistung | W | ja |
| **3-String-Modelle** (PIKO 5.5 / 10.1) | | | |
| 11 | String 3 Spannung | V | ja |
| 12 | L3 Spannung | V | ja |
| 13 | String 3 Strom | A | ja |
| 14 | L3 Leistung | W | ja |

#### Modell-Erkennung

```javascript
// Auto (cells.length): 13 → 2 Strings, 15 → 3 Strings
// Override via Config (pikoModel='piko5.5' etc.) hat Vorrang
const has3Strings = modelCfg === 'auto'
    ? cells.length >= 15
    : ['piko5.5','piko10.1'].includes(modelCfg);
```

### LogDaten.dat – Format

```
Wechselricher Logdaten
Wechselrichter Nr:\t255
Name:\tGrosser
akt. Zeit:\t 495381409     ← Tab-separiert, führendes Leerzeichen möglich
```

**Zeitstempel-Umrechnung:**
```javascript
const m = raw.match(/akt\.\s*Zeit[:\s\t]+\s*(\d+)/);  // robuster Regex
const pikoEpoch = Math.floor(Date.now() / 1000) - parseInt(m[1]);
const ts_ms     = (pikoEpoch + cols[0]) * 1000;
```

**Spalten:**

| Idx | Name | Einheit | Hinweis |
|---|---|---|---|
| 0 | Zeit | sec | Uptime-Zähler |
| 1,2,3 | DC1 U/I/P | V / **mA** / W | I ÷ 1000 = A |
| 4 | DC1 T | raw | Ignorieren |
| 5 | DC1 S | – | Status |
| 6–10 | DC2 * | | String 2 |
| 11–15 | DC3 * | | String 3 (PIKO 5.5/10.1) |
| 16–19 | AC1 U/I/P/T | | L1 |
| 20–23 | AC2 * | | L2 |
| 24–27 | AC3 * | | L3 |
| 28 | AC F | Hz | Netzfrequenz |
| 34 | AC S | – | Betriebsstatus |
| 35 | Err | – | Fehlercode |
| 38 | KB S | – | Bus-Status |

---

## 2. ioBroker-Schnittstelle

### Admin-Konfiguration (`admin/jsonConfig.json`)

| Feld | Typ | Standard | Sichtbarkeit |
|---|---|---|---|
| `pikoModel` | select | `auto` | immer |
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
| `moduleWp` | number | `0` | immer |
| `moduleVoc` | number | `0` | immer |
| `string1Modules` | number | `0` | immer |
| `string2Modules` | number | `0` | immer |
| `string3Modules` | number | `0` | immer |
| `webPort` | number | `8092` | immer |
| `verbose` | checkbox | `false` | immer |

### States (`kostalpiko.0.*`)

```
info.connection           boolean  Adapter verbunden
info.lastPoll             string   ISO-8601
info.networkMode          string   "local" | "fritzwireguard"
status                    string   Betriebsstatus-Text
online                    number   1 | 0
device.strings            number   2 | 3
device.model              string   "PIKO 8.3" | "PIKO 5.5" | ...
ac.power                  number   W
ac.l1/l2/l3.voltage       number   V
ac.l1/l2/l3.power         number   W
energy.total              number   kWh  (auch nachts gültig)
energy.today              number   kWh
pv.string1/2.voltage      number   V
pv.string1/2.current      number   A
pv.string3.voltage/current number  V/A  (PIKO 5.5/10.1)
string1/2/3.expectedVoltage number V    (Voc × Modulanzahl, 0 wenn kein Config)
string1/2/3.expectedPower   number Wp   (Wp × Modulanzahl)
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

history.dc1/dc2.voltage/current/power    (historischer ts)
history.ac1/ac2/ac3.voltage/current/power
history.ac.totalPower     number   W
history.ac.frequency      number   Hz
history.acStatus          number
history.errorCode         number
```

---

## 3. Netzwerk-Schnittstelle: fritzwireguard (v0.3.4)

WireGuard-Tunnel läuft dauerhaft auf OS-Ebene. PIKO-IP identisch.

```javascript
// _checkNetwork() vor jedem Poll:
const stateId = fritzwgConnectedState || fritzwgInstance + '.info.connection';
const st = await getForeignStateAsync(stateId);
if (!st || !st.val) {
    log.warn(`Tunnel nicht aktiv → Poll übersprungen`);
    return false;
}
```

| Tunnel-Status | Aktion |
|---|---|
| `true` | Poll ausführen |
| `false` | WARN-Log, Poll übersprungen |
| State nicht lesbar | WARN-Log, Poll übersprungen |
| networkMode = `local` | Kein Check |

---

## 4. InfluxDB-Schnittstelle

```javascript
adapter.sendTo('influxdb.0', 'storeState', [
    { id: 'kostalpiko.0.history.ac.totalPower',
      state: { val: 1234, ts: 1729083201000, ack: true, q: 0 } }
], callback);
```

---

## 5. Web-Interface API

Port: `webPort` (Standard 8092).

| Route | Beschreibung |
|---|---|
| `GET /` | Web-UI HTML |
| `GET /app.js` | Browser-JS aus `admin/app.js` |
| `GET /api/ping` | `{"ok":true,"version":"0.3.7"}` |
| `GET /api/data` | Live-Daten + Nodes |
| `GET /api/history` | Letzte 200 History-Zeilen |
| `GET /api/logs` | Log-Buffer |
| `GET /api/status` | Adapter-Status |
| `GET /api/trigger-history` | Sync (nur neue) |
| `GET /api/sync-all` | Vollsync |

---

## 6. Abhängigkeiten

| Paket | Version |
|---|---|
| `@iobroker/adapter-core` | `^3.0.0` |
| Node.js | `>= 16.0.0` |

Nur Node.js-stdlib: `http`, `url`, `fs`, `path`.
