# ioBroker Kostal PIKO Adapter

[![Version](https://img.shields.io/badge/version-0.6.29-blue.svg)](https://github.com/MPunktBPunkt/ioBroker.kostalpiko/releases)
[![License](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](./LICENSE)
[![Donate](https://img.shields.io/badge/Donate-PayPal-00457C.svg?logo=paypal)](https://www.paypal.com/donate/?business=martin%40bchmnn.de&currency_code=EUR)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**Live monitoring, 15-minute history and long-term yield** for Kostal PIKO inverters – directly via the built-in HTTP web server, no cloud required.  
Values are exposed as ioBroker states, optional **InfluxDB** sync for Grafana, and a built-in **engineer dashboard** in the browser.

German documentation: [docs/README.de.md](docs/README.de.md) · Installation: [INSTALLATION.md](INSTALLATION.md)

```
http://IOBROKER-IP:8092/     ← kostalpiko.0
http://IOBROKER-IP:8093/     ← kostalpiko.1 (additional instances +1 port)
```

---

## Dashboard overview

| Tab | Content |
|---|---|
| **Data** | Live AC/DC, phases, efficiency, string values, Vmpp temperature, weather |
| **History** | KPIs, Chart.js curves, 15-min table, string analysis, temperature chart |
| **Yield** | Monthly table years × months, €/kWh, export/import, year comparison |
| **Nodes** | All ioBroker states of the instance |
| **Logs** | Adapter log (sync, PIKO fetch, errors) |
| **System** | Connection, InfluxDB, manual sync |

---

## Screenshots

See [docs/screenshots/](docs/screenshots/) – update guide in [docs/screenshots/README.md](docs/screenshots/README.md).

---

## Features

| Area | Function |
|---|---|
| **Live data** | AC/DC, phases, energy, status, efficiency |
| **History** | LogDaten.dat, Chart.js, cache, catch-up fetch |
| **Yield** | Years × months, manual + auto, €, kWh/kWp, CSV/JSON |
| **Weather** | Open-Meteo: sunshine hours, cloud cover, temperature (postal code) |
| **Analysis** | String analysis, Kostal datasheet limits |
| **InfluxDB** | Live + history with historical timestamps |
| **Multi-instance** | `kostalpiko.0` + `kostalpiko.1` in parallel |
| **Notifications** | Daily/weekly/monthly HTML email reports |

---

## Supported hardware

| Model | Strings | Status |
|---|---|---|
| PIKO 3.0 – 4.2 | 1–2 | Supported |
| PIKO 5.5 | 3 | Tested |
| PIKO 7.0 – 8.3 | 2 | Tested (8.3) |
| PIKO 10.1 | 3 | Supported |

Firmware: ver 3.62 · Model selectable in settings or auto-detected.

Manufacturer: [Kostal Solar Electric](https://www.kostal-solar-electric.com/)

---

## Installation & update

Install and update via the ioBroker Admin UI (Adapters tab) or the command line:

```bash
iobroker add kostalpiko          # first install only
iobroker update kostalpiko
iobroker restart kostalpiko
```

Details: [INSTALLATION.md](./INSTALLATION.md) · API overview: [Schnittstellen.md](./Schnittstellen.md) · [Release notes](https://github.com/MPunktBPunkt/ioBroker.kostalpiko/releases)

---

## Configuration (summary)

| Setting | Default | Description |
|---|---|---|
| IP / port / auth | – | PIKO web server |
| Poll interval | 30 s | Live polling |
| Fetch history | off | `LogDaten.dat` |
| Sync interval | 15 min | History + optional InfluxDB |
| Web UI port | 8092 | +1 per instance |
| Postal code | 87781 | Weather + regional comparison |
| Feed-in tariff | 0.3925 €/kWh | Yield tab |
| Module config | optional | String analysis, kWp |

InfluxDB (host, token, database) is configured in the **InfluxDB adapter**.

---

## States (selection)

**Live:** `ac.power`, `energy.today/total`, `pv.string1/2/3.*`, `dc.totalPower`, `efficiency.ratio`, `weather.*`, `status`, `online`

**History (15-min):** `history.dc1/2/3.*`, `history.ac.*`, `history.ac.totalPower`, `history.energy.total`, `history.efficiency.ratio`

Full list: Web UI → **Nodes** tab or [Schnittstellen.md](./Schnittstellen.md)

Object hierarchy: channels (`ac`, `pv`, `weather`, `history`, …) are created explicitly before states (ioBroker object schema).

---

## Multiple inverters

| Instance | Web UI | Data |
|---|---|---|
| `kostalpiko.0` | :8092 | own `monthly-yields.json`, `history-cache.json` |
| `kostalpiko.1` | :8093 | own files |

Combine yields from two inverters:

```bash
node /opt/iobroker/node_modules/iobroker.kostalpiko/scripts/combine-yields.js \
  /opt/iobroker/iobroker-data kostalpiko.0 kostalpiko.1 --from 2018-05 --csv yield.csv
```

---

## Changelog

### 0.6.29
- kWh/kWp uses module preset (e.g. SW 225) × string counts when the kWp field is empty
- Yield table survives adapter updates (`iobroker-data`); JSON snapshot state; InfluxDB backup/restore
- Fix memory leak: `/api/history` compact cache; no duplicate LogDaten download after restart
- LogDaten: merge short current replies, retry busy/timeout; skip live poll during history sync
- Web UI log: local time, newest on top, clear empties the buffer

### 0.6.24
- Fix object role `weather.description`: use valid `weather.state.forecast.0` (E1008)

### 0.6.23
- Admin i18n: missing translations added (E5606); release-script and adapter-dev

**Older versions:** [GitHub Releases](https://github.com/MPunktBPunkt/ioBroker.kostalpiko/releases) · [CHANGELOG_OLD.md](CHANGELOG_OLD.md)

---

## Donate

[![Donate](https://img.shields.io/badge/Donate-PayPal-00457C.svg?logo=paypal)](https://www.paypal.com/donate/?business=martin%40bchmnn.de&currency_code=EUR)

---

## License

**GNU General Public License v3.0** – see [LICENSE](./LICENSE)

Copyright (c) 2026 MPunktBPunkt
