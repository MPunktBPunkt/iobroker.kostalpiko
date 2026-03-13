# ioBroker Kostal PIKO Adapter

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://github.com/MPunktBPunkt/iobroker.kostalpiko)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)](https://nodejs.org)

Liest Echtzeit- und Historiendaten vom **Kostal PIKO Solarwechselrichter** direkt über den eingebauten HTTP-Webserver und speichert sie als ioBroker-Datenpunkte. Die 15-Minuten-Messreihen der letzten ~6 Monate werden mit korrektem historischen Zeitstempel an InfluxDB übertragen.

---

## Features

- ☀️ **HTTP-Scraping** – direkte Anbindung an den PIKO-Webserver, kein Cloud-Zwang
- ⚡ **Echtzeit-Messwerte** – AC-Leistung, PV-Strings, L1/L2/L3, Energie, Status
- 🔌 **Offline-Erkennung** – erkennt wenn der Wechselrichter nachts aus ist
- 📊 **Historiendaten** – LogDaten.dat (CSV, 15-min-Intervall, ~6 Monate)
- 🕐 **Korrekter Zeitstempel** – dekodiert den PIKO-internen Uptime-Zähler in echte Unix-Timestamps
- 📤 **InfluxDB-Integration** – sendet History-Daten via `sendTo()` mit historischem Zeitstempel
- 🔄 **Sync-All** – überträgt die gesamte gespeicherte Historie auf Knopfdruck
- 🌐 **Web-UI** – eingebautes Dashboard mit 5 Tabs: Daten, Historie, Nodes, Logs, System

---

## Getestete Hardware

| Modell | Firmware | Status |
|---|---|---|
| PIKO 8.3 | ver 3.62 | ✅ Getestet |

---

## Installation

### Option A – ioBroker Admin UI (empfohlen, kein Terminal nötig)

Im ioBroker Admin unter **Adapter** auf das 🐙 **Octocat-Icon** klicken → Tab **„ANY"** → folgende URL eintragen:

```
https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/
```

→ „Installieren" klicken. Danach im Admin unter **Instanzen** eine neue Instanz anlegen und konfigurieren.

### Option B – Kommandozeile

```bash
cd /opt/iobroker
npm install https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/
iobroker add kostalpiko
```

### Option C – manuell (offline)

```bash
mkdir -p /opt/iobroker/node_modules/iobroker.kostalpiko
# Dateien in diesen Ordner kopieren (USB, SCP, WinSCP …)
cd /opt/iobroker/node_modules/iobroker.kostalpiko
npm install
cd /opt/iobroker
iobroker add kostalpiko
```

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
| Verbose Logging | `false` | Debug-Ausgaben aktivieren |

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
ac.power                  – AC-Gesamtleistung aktuell (W)
ac.l1/l2/l3.voltage       – Phasenspannungen (V)
ac.l1/l2/l3.power         – Phasenleistungen (W)
energy.total              – Gesamtenergie (kWh)
energy.today              – Tagesenergie (kWh)
pv.string1/2.voltage      – PV-String-Spannungen (V)
pv.string1/2.current      – PV-String-Ströme (A)
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

- **„Neue Punkte synchronisieren"** – überträgt nur Datenpunkte, die seit dem letzten Sync neu sind
- **„Sync-All (gesamte Historie)"** – setzt den Cursor zurück und überträgt alle ~6 Monate auf einmal (Bestätigungs-Dialog, kann einige Minuten dauern)

---

## Firewall (falls nötig)

```bash
sudo ufw allow 8092/tcp
```

---

## Changelog

### 0.2.0 (2026-03-13)
- **NEU:** LogDaten.dat Parser – PIKO-Epoch-Berechnung (`fetchUnixSec − akt. Zeit`)
- **NEU:** InfluxDB-Integration via `sendTo()` mit historischem Zeitstempel
- **NEU:** Deduplication-Cursor (überlebt Adapter-Neustarts)
- **NEU:** History-Tab im Web-UI mit Sparklines und Datentabelle
- **NEU:** Sync-All Button (Vollsync der gesamten ~6-Monats-Historie)
- **NEU:** System-Tab erklärt wo InfluxDB-Verbindungsdaten konfiguriert werden
- Alle Strömwerte korrekt von mA in A umgerechnet (Faktor 0.001)
- Konfigparam `syncInterval` (unified, statt `historyInterval` + `influxEnable`)

### 0.1.0 (2026-03-13)
- Erstveröffentlichung
- HTTP-Scraping: index.fhtml + Inf.fhtml
- Offline-Erkennung (Status "Aus" → alle Werte = 0)
- Web-UI: Daten, Nodes, Logs, System

---

## Lizenz

MIT © MPunktBPunkt
