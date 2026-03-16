# ioBroker Kostal PIKO Adapter

[![Version](https://img.shields.io/badge/version-0.3.13-blue.svg)](https://github.com/MPunktBPunkt/iobroker.kostalpiko)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org)

Liest Echtzeit- und Historiendaten vom **Kostal PIKO Solarwechselrichter** direkt über den eingebauten HTTP-Webserver und speichert sie als ioBroker-Datenpunkte. Die 15-Minuten-Messreihen der letzten ~6 Monate werden mit korrektem historischen Zeitstempel an InfluxDB übertragen.

---

## Features

- ☀️ **HTTP-Scraping** – direkte Anbindung an den PIKO-Webserver, kein Cloud-Zwang
- ⚡ **Echtzeit-Messwerte** – AC-Leistung, PV-Strings, L1/L2/L3, Energie, Status
- 🔌 **Offline-Erkennung** – `x x x` Muster im HTML erkannt; Energie-Zähler bleiben erhalten
- 📊 **Historiendaten** – LogDaten.dat (CSV, 15-min-Intervall, ~6 Monate)
- 🕐 **Korrekter Zeitstempel** – dekodiert den PIKO-internen Uptime-Zähler in echte Unix-Timestamps
- 📤 **InfluxDB-Integration** – sendet History-Daten via `sendTo()` mit historischem Zeitstempel
- 🔄 **Sync-All** – überträgt die gesamte gespeicherte Historie auf Knopfdruck
- 🌐 **Web-UI** – eingebautes Dashboard mit 5 Tabs: Daten, Historie, Nodes, Logs, System
- 🔢 **Multi-String** – automatische Erkennung von 2 oder 3 PV-Strings (PIKO 8.3 / PIKO 5.5)

---

## Getestete Hardware

| Modell | Firmware | Strings | Status |
|---|---|---|---|
| PIKO 3.0 | ver 3.62 | 1 | Unterstützt |
| PIKO 3.6 | ver 3.62 | 2 | Unterstützt |
| PIKO 4.2 | ver 3.62 | 2 | Unterstützt |
| PIKO 5.5 | ver 3.62 | 3 | ✅ Getestet |
| PIKO 7.0 | ver 3.62 | 2 | Unterstützt |
| PIKO 8.3 | ver 3.62 | 2 | ✅ Getestet |
| PIKO 10.1 | ver 3.62 | 3 | Unterstützt |

---

## Installation

### Option A – Kommandozeile (empfohlen)

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kostalpiko
iobroker add kostalpiko
```

### Option B – ioBroker Admin UI

Im ioBroker Admin unter **Adapter** auf das 🐙 **Octocat-Icon** klicken → Tab **„ANY"** → folgende URL eintragen:

```
https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/
```

→ „Installieren" klicken. Danach im Admin unter **Instanzen** eine neue Instanz anlegen und konfigurieren.

### Option C – manuell (offline)

```bash
mkdir -p /opt/iobroker/node_modules/iobroker.kostalpiko
# Alle Dateien aus dem ZIP nach /opt/iobroker/node_modules/iobroker.kostalpiko/ kopieren
cd /opt/iobroker/node_modules/iobroker.kostalpiko
npm install
cd /opt/iobroker
iobroker add kostalpiko
```

---

## Update

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kostalpiko
iobroker restart kostalpiko
```

Bei mehreren Instanzen startet `iobroker restart kostalpiko` alle automatisch neu.

---

## Mehrere Wechselrichter (Multi-Instanz)

Jede Instanz verwaltet einen eigenen Wechselrichter mit vollständig getrennten Datenpunkten:

| Instanz | Namespace | IP | Web-UI Port |
|---|---|---|---|
| kostalpiko.0 | `kostalpiko.0.*` | 192.168.178.30 (PIKO 8.3) | 8092 |
| kostalpiko.1 | `kostalpiko.1.*` | 192.168.178.31 (PIKO 5.5) | 8093 |

Für die zweite Instanz einfach im Admin **„+ Instanz hinzufügen"** klicken und einen anderen Web-UI Port einstellen.

---

## Konfiguration

Im ioBroker Admin unter **Adapter → Kostal PIKO → Instanz konfigurieren**:

| Einstellung | Standard | Beschreibung |
|---|---|---|
| IP-Adresse | `192.168.178.30` | IP des PIKO-Wechselrichters |
| HTTP-Port | `80` | Web-Server Port des PIKO |
| Benutzername | `pvserver` | HTTP Basic Auth |
| Passwort | `pvwr` | HTTP Basic Auth |
| Poll-Intervall | `30` | Sekunden zwischen Live-Abfragen |
| Historiendaten & InfluxDB | `false` | LogDaten.dat abrufen + an InfluxDB senden |
| Sync-Intervall | `15` | Minuten zwischen automatischen Syncs |
| InfluxDB-Instanz | `influxdb.0` | Name der InfluxDB-Adapter-Instanz |
| Web-UI Port | `8092` | Port für das eingebaute Dashboard |
| **PIKO Modell** | `Auto` | Modell explizit setzen (PIKO 3.0–10.1) oder Auto-Erkennung |
| Modul-Leistung (Wp) | `0` | Optional: Nennleistung eines Moduls für String-Analyse |
| Leerlaufspannung Voc | `0` | Optional: Leerlaufspannung eines Moduls (STC) |
| Anzahl Module pro String | `0` | Optional: Anzahl Module in String 1/2/3 |
| Verbose Logging | `false` | Debug-Ausgaben aktivieren |
| **Netzwerk-Modus** | `Lokal` | `Lokal` = direkter Zugriff · `Via iobroker.fritzwireguard` = Zugriff über WireGuard-Tunnel |
| fritzwireguard-Instanz | `fritzwireguard.0` | Name der fritzwireguard Adapter-Instanz (nur im Tunnel-Modus relevant) |
| Verbindungs-State | *(leer)* | Optionaler ioBroker State für Tunnel-Status – leer lassen für Auto-Erkennung |

### InfluxDB-Verbindung

Die Verbindungsdaten für InfluxDB (Host, Port, Datenbank, Token) werden **nicht** in diesem Adapter eingetragen, sondern im **ioBroker Admin → Adapter → InfluxDB → Instanz konfigurieren**. Dieser Adapter kennt nur den Instanz-Namen und leitet die Daten über den ioBroker-internen `sendTo()`-Mechanismus weiter.

---

## Angelegte Datenpunkte

Unter `kostalpiko.0.*`:

```
info.connection           – Adapter verbunden (boolean)
info.lastPoll             – Letzter Poll-Zeitpunkt (ISO-8601)
status                    – Betriebsstatus ("Einspeisen MPP" / "Aus" / ...)
online                    – 1 = läuft, 0 = offline/Nacht
device.strings            – Anzahl PV-Strings (2 oder 3, auto-erkannt)
ac.power                  – AC-Gesamtleistung aktuell (W)
ac.l1/l2/l3.voltage       – Phasenspannungen (V)
ac.l1/l2/l3.power         – Phasenleistungen (W)
energy.total              – Gesamtenergie (kWh) – auch nachts gültig
energy.today              – Tagesenergie (kWh)  – auch nachts gültig
pv.string1/2.voltage      – PV-String-Spannungen (V)
pv.string1/2.current      – PV-String-Ströme (A)
pv.string3.voltage/current – nur PIKO 5.5 (3 Strings)
info.analog1–4            – Analoge Eingänge (V)
info.modemStatus
info.lastPortalConnection
info.s0Pulses

history.lastImport        – Zeitpunkt letzter Sync
history.lastImportedTs    – Deduplication-Cursor (ms)
history.recordCount       – Datenpunkte in der Logdatei gesamt
history.newRecords        – Beim letzten Sync übertragene Punkte
history.oldestRecord      – Ältester Eintrag in der Logdatei
history.newestRecord      – Neuester Eintrag
history.influxSent        – An InfluxDB gesendete Punkte
history.pikoEpoch         – Berechnetes PIKO-Inbetriebnahmedatum

history.dc1/dc2.voltage/current/power  – String-Werte (15-min, historischer ts)
history.ac1/ac2/ac3.voltage/current/power
history.ac.totalPower
history.ac.frequency
history.acStatus / history.errorCode
```

---

## Web-UI

Aufrufbar im Browser (kein Login):

```
http://IOBROKER-IP:8092/
```

| Tab | Inhalt |
|---|---|
| ⚡ Daten | Live-Werte: Status, AC-Leistung, Energie, PV-Strings, Phasen |
| 📈 Historie | Sparklines (letzte 24h), Datentabelle (200 Zeilen), Sync-Buttons |
| 🌐 Nodes | Alle Datenpunkte mit Typ, aktuellem Wert, Einheit |
| 📄 Logs | Echtzeit-Log mit Level-Filter und Auto-Scroll |
| ⚙️ System | Adapter-Info, Sync-Status, Aktionen, InfluxDB-Erklärung |

### Sync-Aktionen im Web-UI

- **„Neue Punkte synchronisieren"** – überträgt nur Datenpunkte seit dem letzten Sync
- **„Sync-All (gesamte Historie)"** – setzt den Cursor zurück und überträgt alle ~6 Monate (Bestätigungs-Dialog, kann einige Minuten dauern)

---

## Firewall (falls nötig)

```bash
sudo ufw allow 8092/tcp   # Instanz 0 (PIKO 8.3)
sudo ufw allow 8093/tcp   # Instanz 1 (PIKO 5.5)
```

---

## Changelog

### 0.3.9 (2026-03-15)
- **Bugfix:** Passwortfeld verschwand beim Antippen in den Instanzeinstellungen
- `encryptedNative: ["password"]` in `io-package.json` ergänzt, Plaintext-Default entfernt
- Nach dem Update Passwort bitte einmal neu eingeben und speichern

### 0.3.8 (2026-03-15)
- **Bugfix:** Speichern-Button in den Adapter-Einstellungen war rot/deaktiviert
- Ursache: `required: true` auf dem IP-Feld + fehlende `sm`-Angaben in `jsonConfig.json`

### 0.3.7 (2026-03-15)
- **NEU:** Modell-Dropdown in den Einstellungen – PIKO 3.0 bis 10.1 wählbar, überschreibt Auto-Erkennung
- Korrekte String-Anzahl laut Datenblatt: PIKO 5.5 / 10.1 = 3 Strings, alle anderen = 2 Strings

### 0.3.6 (2026-03-15)
- **NEU:** Modul-Konfiguration in den Einstellungen (Wp, Voc, Anzahl pro String)
- **NEU:** Berechnete Soll-Spannung und Nennleistung als ioBroker-States
- **NEU:** String-Analyse-Karte im Web-UI (Soll vs. Ist mit Farb-Indikator)
- **Bugfix:** `akt. Zeit` Regex robuster (Tab-Separierung)

### 0.3.5 (2026-03-15)
- **Bugfix:** Zellenreihenfolge im HTML-Parser war falsch – String und L-Phase stehen in der GLEICHEN Tabellenzeile (interleaved), nicht sequentiell. Alle Messwerte waren dadurch vertauscht
- **Bugfix:** `pv.string1.current` zeigte L1-Spannung, `pv.string2.voltage` zeigte String1-Strom usw.
- **NEU:** `device.model` State – liest Modellbezeichnung (PIKO 8.3 / PIKO 5.5) direkt aus dem HTML
- **NEU:** Modell-Anzeige im Web-UI jetzt dynamisch (nicht mehr hardcoded PIKO 8.3)

### 0.3.4 (2026-03-14)
- **NEU:** Netzwerk-Modus Einstellung: `Lokal` (direkter Zugriff) oder `Via iobroker.fritzwireguard` (WireGuard-Tunnel)
- Vor jedem Poll wird der Tunnel-Status geprüft – bei inaktivem Tunnel wird der Poll übersprungen und im Log gemeldet
- Tunnel läuft dauerhaft im Hintergrund, der Adapter nutzt ihn transparent
- Neuer State `info.networkMode` zeigt den aktuell genutzten Modus

### 0.3.3 (2026-03-14)
- **Bugfix:** `app.js` als echte Datei (`admin/app.js`) via `fs.readFileSync` serviert – behebt `SyntaxError: Invalid or unexpected token` durch fehlerhafte `\n`-Interpretation im Node.js Template-Literal

### 0.3.2 (2026-03-14)
- **Bugfix:** JavaScript als separate `/app.js` Route serviert statt Inline-Script
  – behebt das Problem dass Tabs nicht funktionierten weil Node.js lange HTML-Responses abschnitt

### 0.3.1 (2026-03-14)
- **Bugfix:** `x x x` Offline-Muster gilt für beide PIKO-Modelle (nicht nur PIKO 5.5)
- **Bugfix:** `energy.total` und `energy.today` werden auch im Offline-Zustand korrekt gelesen und nicht auf 0 gesetzt

### 0.3.0 (2026-03-14)
- **NEU:** PIKO 5.5 Support – automatische Erkennung von 2 oder 3 PV-Strings
- **NEU:** `pv.string3.voltage/current` States für 3-String-Wechselrichter
- **NEU:** `device.strings` State zeigt Anzahl erkannter Strings
- **NEU:** String 3 Cards im Web-UI erscheinen automatisch bei PIKO 5.5
- **Bugfix:** JavaScript-Sonderzeichen als `\uXXXX` escaped → Tabs funktionieren
- **Bugfix:** `fetch()`-URLs absolut mit `window.location.origin` → kein Proxy-Problem mehr

### 0.2.0 (2026-03-13)
- **NEU:** LogDaten.dat Parser – PIKO-Epoch-Berechnung (`fetchUnixSec − akt. Zeit`)
- **NEU:** InfluxDB-Integration via `sendTo()` mit historischem Zeitstempel
- **NEU:** Deduplication-Cursor (überlebt Adapter-Neustarts)
- **NEU:** History-Tab im Web-UI mit Sparklines und Datentabelle
- **NEU:** Sync-All Button (Vollsync der gesamten ~6-Monats-Historie)
- **NEU:** System-Tab erklärt wo InfluxDB-Verbindungsdaten konfiguriert werden
- Alle Stromwerte korrekt von mA in A umgerechnet (Faktor 0.001)
- Konfigparam `syncInterval` (statt `historyInterval` + `influxEnable`)

### 0.1.0 (2026-03-13)
- Erstveröffentlichung
- HTTP-Scraping: index.fhtml + Inf.fhtml
- Web-UI: Daten, Nodes, Logs, System

---

## Lizenz

MIT © MPunktBPunkt
