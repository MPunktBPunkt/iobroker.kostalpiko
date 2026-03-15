'use strict';

/**
 * ioBroker Kostal PIKO Adapter
 * Liest Echtzeit- und Historiendaten vom Kostal PIKO Wechselrichter via HTTP-Scraping
 * Version: 0.3.7
 */

const utils = require('@iobroker/adapter-core');
const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const url   = require('url');

// ─── Konstanten ────────────────────────────────────────────────────────────────
const ADAPTER_NAME    = 'kostalpiko';
const ADAPTER_VERSION = '0.3.7';

const POLL_URLS = {
    main : '/index.fhtml',
    info : '/Inf.fhtml',
    log  : '/LogDaten.dat',
};

// Spaltenindizes für LogDaten.dat (Tab-separiert)
const COL = {
    ZEIT:0, DC1_U:1,DC1_I:2,DC1_P:3,DC1_T:4,DC1_S:5,
    DC2_U:6,DC2_I:7,DC2_P:8,DC2_T:9,DC2_S:10,
    DC3_U:11,DC3_I:12,DC3_P:13,DC3_T:14,DC3_S:15,
    AC1_U:16,AC1_I:17,AC1_P:18,AC1_T:19,
    AC2_U:20,AC2_I:21,AC2_P:22,AC2_T:23,
    AC3_U:24,AC3_I:25,AC3_P:26,AC3_T:27,
    AC_F:28,FC_I:29,
    AIN1:30,AIN2:31,AIN3:32,AIN4:33,
    AC_S:34,ERR:35,ENS_S:36,ENS_ERR:37,KB_S:38,
    TOTAL_E:39,ISO_R:40,
};

// History-States für InfluxDB (erhalten historische ts-Werte beim setState)
const HISTORY_STATES = [
    { id:'history.dc1.voltage',   col:COL.DC1_U,  factor:1,     unit:'V',  name:'String 1 Spannung (15-min)' },
    { id:'history.dc1.current',   col:COL.DC1_I,  factor:0.001, unit:'A',  name:'String 1 Strom (15-min)' },
    { id:'history.dc1.power',     col:COL.DC1_P,  factor:1,     unit:'W',  name:'String 1 Leistung (15-min)' },
    { id:'history.dc2.voltage',   col:COL.DC2_U,  factor:1,     unit:'V',  name:'String 2 Spannung (15-min)' },
    { id:'history.dc2.current',   col:COL.DC2_I,  factor:0.001, unit:'A',  name:'String 2 Strom (15-min)' },
    { id:'history.dc2.power',     col:COL.DC2_P,  factor:1,     unit:'W',  name:'String 2 Leistung (15-min)' },
    { id:'history.ac1.voltage',   col:COL.AC1_U,  factor:1,     unit:'V',  name:'L1 Spannung (15-min)' },
    { id:'history.ac1.current',   col:COL.AC1_I,  factor:0.001, unit:'A',  name:'L1 Strom (15-min)' },
    { id:'history.ac1.power',     col:COL.AC1_P,  factor:1,     unit:'W',  name:'L1 Leistung (15-min)' },
    { id:'history.ac2.voltage',   col:COL.AC2_U,  factor:1,     unit:'V',  name:'L2 Spannung (15-min)' },
    { id:'history.ac2.current',   col:COL.AC2_I,  factor:0.001, unit:'A',  name:'L2 Strom (15-min)' },
    { id:'history.ac2.power',     col:COL.AC2_P,  factor:1,     unit:'W',  name:'L2 Leistung (15-min)' },
    { id:'history.ac3.voltage',   col:COL.AC3_U,  factor:1,     unit:'V',  name:'L3 Spannung (15-min)' },
    { id:'history.ac3.current',   col:COL.AC3_I,  factor:0.001, unit:'A',  name:'L3 Strom (15-min)' },
    { id:'history.ac3.power',     col:COL.AC3_P,  factor:1,     unit:'W',  name:'L3 Leistung (15-min)' },
    { id:'history.ac.totalPower', col:null,        factor:1,     unit:'W',  name:'AC Gesamtleistung (15-min)' },
    { id:'history.ac.frequency',  col:COL.AC_F,   factor:1,     unit:'Hz', name:'Netzfrequenz (15-min)' },
    { id:'history.acStatus',      col:COL.AC_S,   factor:1,     unit:'',   name:'Betriebsstatus-Code (15-min)' },
    { id:'history.errorCode',     col:COL.ERR,    factor:1,     unit:'',   name:'Fehlercode (15-min)' },
];

// ─── Adapter-Klasse ────────────────────────────────────────────────────────────
class KostalPikoAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: ADAPTER_NAME });
        this._pollTimer       = null;
        this._webServer       = null;
        this._logBuffer       = [];
        this._maxLogs         = 500;
        this._lastData        = {};
        this._lastHistoryRows = [];
        this._nodes           = {};
        this._pikoEpoch       = null;  // Unix-Sekunden (Geräteinbetriebnahme)
        this._lastImportedTs  = 0;     // ms - zuletzt importierter Timestamp
        this._lastHistoryFetch= 0;

        this.on('ready',       this._onReady.bind(this));
        this.on('stateChange', this._onStateChange.bind(this));
        this.on('unload',      this._onUnload.bind(this));
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────────

    async _onReady() {
        this._log('SYSTEM', `Kostal PIKO Adapter v${ADAPTER_VERSION} gestartet`);

        this._cfg = {
            ip                   : (this.config.ip                   || '192.168.178.30').trim(),
            port                 : parseInt(this.config.port)                  || 80,
            user                 : (this.config.user                 || 'pvserver').trim(),
            password             : (this.config.password             || 'pvwr').trim(),
            pollInterval         : parseInt(this.config.pollInterval)          || 30,
            webPort              : parseInt(this.config.webPort)               || 8092,
            verbose              : !!this.config.verbose,
            historyFetch         : !!this.config.historyFetch,
            syncInterval         : parseInt(this.config.syncInterval || this.config.historyInterval) || 15,
            influxInstance       : (this.config.influxInstance       || 'influxdb.0').trim(),
            influxEnable         : !!this.config.historyFetch,
            // Netzwerk-Modus: 'local' = direkt, 'fritzwireguard' = via WireGuard-Tunnel
            networkMode          : (this.config.networkMode          || 'local').trim(),
            fritzwgInstance      : (this.config.fritzwgInstance      || 'fritzwireguard.0').trim(),
            // State-ID des Verbindungsstatus im fritzwireguard-Adapter
            // Typisch: fritzwireguard.0.info.connection oder fritzwireguard.0.connected
            fritzwgConnectedState: (this.config.fritzwgConnectedState || '').trim(),
            // Modell-Override: 'auto' = aus HTML lesen, sonst z.B. 'piko5.5'
            pikoModel      : (this.config.pikoModel || 'auto').trim(),
            // Modul-Konfiguration (optional, für String-Analyse)
            moduleWp       : parseFloat(this.config.moduleWp)       || 0,
            moduleVoc      : parseFloat(this.config.moduleVoc)      || 0,
            string1Modules : parseInt(this.config.string1Modules)   || 0,
            string2Modules : parseInt(this.config.string2Modules)   || 0,
            string3Modules : parseInt(this.config.string3Modules)   || 0,
        };

        const networkInfo = this._cfg.networkMode === 'fritzwireguard'
            ? `Via ${this._cfg.fritzwgInstance} (WireGuard)`
            : 'Lokal (direkter Zugriff)';
        this._log('SYSTEM',
            `Ziel: http://${this._cfg.ip}:${this._cfg.port} | ` +
            `Netzwerk: ${networkInfo} | ` +
            `Poll: ${this._cfg.pollInterval}s | ` +
            `Sync: ${this._cfg.historyFetch ? 'alle ' + this._cfg.syncInterval + ' min → ' + this._cfg.influxInstance : 'deaktiviert'}`
        );

        await this._ensureBaseStates();
        await this._ensureHistoryStates();

        // Letzten importierten Timestamp aus State laden
        try {
            const st = await this.getStateAsync('history.lastImportedTs');
            if (st && st.val) {
                this._lastImportedTs = parseInt(st.val) || 0;
                this._log('INFO', `History-Cursor: ${new Date(this._lastImportedTs).toISOString()}`);
            }
        } catch (_) {}

        this._startWebServer();

        await this._poll();
        this._pollTimer = setInterval(() => this._poll(), this._cfg.pollInterval * 1000);
    }

    _onStateChange(id, state) {
        if (state && !state.ack && this._cfg.verbose) {
            this._log('DEBUG', `State geändert: ${id} = ${state.val}`);
        }
    }

    _onUnload(callback) {
        try {
            if (this._pollTimer) clearInterval(this._pollTimer);
            if (this._webServer) this._webServer.close();
        } catch (_) {}
        callback();
    }

    // ─── Netzwerk-Verfügbarkeit prüfen (fritzwireguard) ────────────────────────

    async _checkNetwork() {
        if (this._cfg.networkMode !== 'fritzwireguard') return true;

        const stateId = this._cfg.fritzwgConnectedState ||
                        `${this._cfg.fritzwgInstance}.info.connection`;
        try {
            const st = await this.getForeignStateAsync(stateId);
            if (!st || !st.val) {
                this._log('WARN',
                    `WireGuard-Tunnel nicht aktiv (${stateId} = ${st ? st.val : 'null'}) → Poll übersprungen`);
                return false;
            }
            if (this._cfg.verbose) {
                this._log('DEBUG', `WireGuard-Tunnel aktiv (${stateId} = true) → Poll via Tunnel`);
            }
            return true;
        } catch (e) {
            this._log('WARN', `WireGuard-Status konnte nicht gelesen werden (${stateId}): ${e.message} → Poll übersprungen`);
            return false;
        }
    }

    // ─── Polling-Hauptschleife ───────────────────────────────────────────────────

    async _poll() {
        // 0. Netzwerk-Check (nur bei fritzwireguard-Modus)
        if (!(await this._checkNetwork())) {
            await this.setStateAsync('info.connection', { val: false, ack: true }).catch(() => {});
            return;
        }

        // 1. Live-Daten
        try {
            const [mainHtml, infoHtml] = await Promise.all([
                this._fetchPage(POLL_URLS.main),
                this._fetchPage(POLL_URLS.info),
            ]);
            await this._writeStates({
                ...this._parseMainPage(mainHtml),
                ...this._parseInfoPage(infoHtml),
            });
            await this.setStateAsync('info.connection',  { val: true,  ack: true });
            await this.setStateAsync('info.lastPoll',    { val: new Date().toISOString(), ack: true });
            await this.setStateAsync('info.networkMode', { val: this._cfg.networkMode, ack: true });
            await this._writeModuleStates();
            if (this._cfg.verbose) this._log('DEBUG', 'Live-Poll OK');
        } catch (err) {
            this._log('ERROR', `Live-Poll: ${err.message}`);
            await this.setStateAsync('info.connection', { val: false, ack: true }).catch(() => {});
        }

        // 2. History-Sync (nur alle syncInterval Minuten)
        if (this._cfg.historyFetch) {
            const now        = Date.now();
            const intervalMs = this._cfg.syncInterval * 60 * 1000;
            if (now - this._lastHistoryFetch >= intervalMs) {
                this._lastHistoryFetch = now;
                this._fetchAndImportHistory(false).catch(e =>
                    this._log('ERROR', `History-Sync: ${e.message}`)
                );
            }
        }
    }

    // ─── History: Abruf + Import ─────────────────────────────────────────────────

    async _fetchAndImportHistory(syncAll = false) {
        this._log('INFO', syncAll
            ? 'Starte VOLLSYNC (alle Datenpunkte) → InfluxDB...'
            : 'Starte History-Sync (nur neue Datenpunkte)...'
        );

        // Zeitpunkt des HTTP-Abrufs merken (für Epochen-Berechnung)
        const fetchUnixSec = Math.floor(Date.now() / 1000);
        const raw = await this._fetchPage(POLL_URLS.log);

        // "akt. Zeit" aus Header lesen (Tab-separiert: "akt. Zeit:\t 495381409")
        const m = raw.match(/akt\.\s*Zeit[:\s\t]+\s*(\d+)/);
        if (!m) {
            const preview = raw.substring(0, 300).replace(/\r/g, '').split('\n').slice(0,5).join(' | ');
            throw new Error('"akt. Zeit" nicht im Header gefunden. Header-Preview: ' + preview);
        }
        const aktZeit = parseInt(m[1]);

        // PIKO-Epoche berechnen:
        // Gerät läuft aktZeit Sekunden → Inbetriebnahme war vor aktZeit Sekunden
        this._pikoEpoch = fetchUnixSec - aktZeit;
        this._log('INFO',
            `PIKO Epoche: ${new Date(this._pikoEpoch * 1000).toISOString().substring(0, 10)} ` +
            `| akt. Zeit des Geräts: ${aktZeit} s`
        );
        await this.setStateAsync('history.pikoEpoch',
            { val: new Date(this._pikoEpoch * 1000).toISOString(), ack: true }
        );

        // CSV parsen
        const rows = this._parseLogDaten(raw, this._pikoEpoch);
        this._lastHistoryRows = rows;

        if (rows.length === 0) {
            this._log('WARN', 'LogDaten.dat: keine verwertbaren Zeilen gefunden');
            return;
        }

        this._log('INFO',
            `${rows.length} Datenpunkte | ` +
            `${rows[0].date.substring(0,10)} – ${rows[rows.length-1].date.substring(0,10)}`
        );

        // Deduplication: bei syncAll Cursor auf 0 setzen → alles übertragen
        if (syncAll) {
            this._log('INFO', 'Sync-All: Cursor zurückgesetzt, übertrage alle Datenpunkte');
            this._lastImportedTs = 0;
        }

        // Nur neue Zeilen importieren
        const newRows = rows.filter(r => r.ts > this._lastImportedTs);
        this._log('INFO', `${newRows.length} Datenpunkte ${syncAll ? '(alle)' : '(neu)'} → InfluxDB`);

        if (newRows.length === 0) {
            await this.setStateAsync('history.lastImport', { val: new Date().toISOString(), ack: true });
            return;
        }

        let influxSent = 0;
        let maxTs      = this._lastImportedTs;

        for (const row of newRows) {
            await this._writeHistoryRow(row);

            if (this._cfg.influxEnable) {
                const n = await this._sendRowToInflux(row);
                influxSent += n;
            }

            if (row.ts > maxTs) maxTs = row.ts;
        }

        // Cursor speichern
        this._lastImportedTs = maxTs;
        await this.setStateAsync('history.lastImportedTs', { val: maxTs,                         ack: true });
        await this.setStateAsync('history.lastImport',     { val: new Date().toISOString(),       ack: true });
        await this.setStateAsync('history.recordCount',    { val: rows.length,                    ack: true });
        await this.setStateAsync('history.newRecords',     { val: newRows.length,                 ack: true });
        await this.setStateAsync('history.oldestRecord',   { val: rows[0].date,                   ack: true });
        await this.setStateAsync('history.newestRecord',   { val: rows[rows.length-1].date,       ack: true });
        if (this._cfg.influxEnable) {
            await this.setStateAsync('history.influxSent', { val: influxSent,                     ack: true });
        }

        this._log('INFO',
            `Sync ${syncAll ? '(Vollsync)' : ''} fertig: ${newRows.length} Punkte` +
            (this._cfg.influxEnable ? `, ${influxSent} → ${this._cfg.influxInstance}` : '')
        );
    }

    // ─── History → ioBroker-States (mit historischem ts) ────────────────────────

    async _writeHistoryRow(row) {
        for (const def of HISTORY_STATES) {
            const val = this._calcHistVal(row, def);
            if (val === null) continue;
            try {
                // ts = historischer UNIX-Timestamp in ms
                // Der ioBroker InfluxDB-Adapter schreibt diesen ts in die DB
                await this.setStateAsync(def.id, {
                    val,
                    ack : true,
                    ts  : row.ts,  // ← DAS ist der Schlüssel für korrekte Zeitreihen
                    q   : 0,
                });
            } catch (e) {
                if (this._cfg.verbose) this._log('WARN', `${def.id}: ${e.message}`);
            }
        }
    }

    // ─── History → InfluxDB direkt via sendTo (Batch) ────────────────────────────

    async _sendRowToInflux(row) {
        const points = [];
        for (const def of HISTORY_STATES) {
            const val = this._calcHistVal(row, def);
            if (val === null) continue;
            points.push({
                id   : `${this.namespace}.${def.id}`,
                state: { val, ts: row.ts, ack: true, q: 0 },
            });
        }
        if (!points.length) return 0;

        await new Promise((resolve) => {
            this.sendTo(this._cfg.influxInstance, 'storeState', points, (result) => {
                if (result && result.error) {
                    this._log('WARN', `InfluxDB sendTo: ${result.error}`);
                }
                resolve();
            });
        });
        return points.length;
    }

    _calcHistVal(row, def) {
        if (def.col === null) {
            // Berechneter Wert
            if (def.id.includes('totalPower')) {
                return row.ac1.power + row.ac2.power + row.ac3.power;
            }
            return null;
        }
        const raw = row._raw[def.col];
        if (raw === null || raw === undefined) return null;
        return Math.round(raw * def.factor * 1000) / 1000;
    }

    // ─── Parser: LogDaten.dat ───────────────────────────────────────────────────

    _parseLogDaten(raw, pikoEpoch) {
        const lines = raw.split(/\r?\n/);
        const rows  = [];

        for (const line of lines) {
            if (!line.trim()) continue;
            const cols = line.split('\t').map(s => s.trim());
            const zeit = parseInt(cols[COL.ZEIT]);
            if (isNaN(zeit) || zeit < 1000) continue;

            // Ereigniszeile erkennen (enthält Hex-Code wie "80001200h")
            const isEvent = cols.some(c => /^[0-9a-fA-F]{4,}h$/.test(c));

            // Nur normale Messzeilen (mind. 38 Spalten mit Zahlen)
            if (!isEvent && cols.length < 38) continue;
            if (isEvent) continue; // Ereigniszeilen vorerst überspringen

            const ts  = (pikoEpoch + zeit) * 1000; // ms
            const raw_nums = cols.map(c => {
                const n = parseFloat(c);
                return isNaN(n) ? null : n;
            });

            const int = i => parseInt(cols[i]) || 0;
            const flt = i => parseFloat(cols[i]) || 0;

            rows.push({
                ts,
                date         : new Date(ts).toISOString(),
                _raw         : raw_nums,
                dc1: { voltage: int(COL.DC1_U), current: int(COL.DC1_I)/1000, power: int(COL.DC1_P), status: int(COL.DC1_S) },
                dc2: { voltage: int(COL.DC2_U), current: int(COL.DC2_I)/1000, power: int(COL.DC2_P), status: int(COL.DC2_S) },
                dc3: { voltage: int(COL.DC3_U), current: int(COL.DC3_I)/1000, power: int(COL.DC3_P), status: int(COL.DC3_S) },
                ac1: { voltage: int(COL.AC1_U), current: int(COL.AC1_I)/1000, power: int(COL.AC1_P) },
                ac2: { voltage: int(COL.AC2_U), current: int(COL.AC2_I)/1000, power: int(COL.AC2_P) },
                ac3: { voltage: int(COL.AC3_U), current: int(COL.AC3_I)/1000, power: int(COL.AC3_P) },
                frequency    : flt(COL.AC_F),
                acStatus     : int(COL.AC_S),
                errorCode    : int(COL.ERR),
                ensStatus    : int(COL.ENS_S),
                busStatus    : int(COL.KB_S),
                acTotalPower : int(COL.AC1_P) + int(COL.AC2_P) + int(COL.AC3_P),
            });
        }

        rows.sort((a, b) => a.ts - b.ts); // älteste zuerst
        return rows;
    }

    // ─── HTTP-Client ─────────────────────────────────────────────────────────────

    _fetchPage(path) {
        return new Promise((resolve, reject) => {
            const auth = Buffer.from(`${this._cfg.user}:${this._cfg.password}`).toString('base64');
            const req  = http.request({
                hostname: this._cfg.ip,
                port    : this._cfg.port,
                path,
                method  : 'GET',
                timeout : 15000,
                headers : {
                    'Authorization': `Basic ${auth}`,
                    'User-Agent'   : `ioBroker-KostalPiko/${ADAPTER_VERSION}`,
                },
            }, (res) => {
                let data = '';
                res.setEncoding('latin1'); // PIKO sendet windows-1252
                res.on('data', c => data += c);
                res.on('end', () => {
                    if (res.statusCode === 401) return reject(new Error('Auth fehlgeschlagen (401)'));
                    if (res.statusCode !== 200)  return reject(new Error(`HTTP ${res.statusCode} für ${path}`));
                    resolve(data);
                });
            });
            req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout für ${path}`)); });
            req.on('error',   e  => reject(e));
            req.end();
        });
    }

    // ─── Parser: Hauptseite (index.fhtml) ────────────────────────────────────────
    // HTML-Tabelle hat interleaved Struktur: String und L-Phase in DERSELBEN Zeile!
    // Korrekte Zellenreihenfolge:
    //   [0]=AC, [1]=GesamtE, [2]=TagE,
    //   [3]=S1U, [4]=L1U, [5]=S1I, [6]=L1P,   ← String+Phase in gleicher Zeile
    //   [7]=S2U, [8]=L2U, [9]=S2I, [10]=L2P,
    //   PIKO 8.3 (2 Strings): [11]=L3U, [12]=L3P
    //   PIKO 5.5 (3 Strings): [11]=S3U, [12]=L3U, [13]=S3I, [14]=L3P

    _parseMainPage(html) {
        // Alle bgcolor="#FFFFFF" Zellen in DOM-Reihenfolge sammeln (inkl. leere)
        const cells = [];
        const re    = /bgcolor="#FFFFFF">\s*([\s\S]*?)\s*<\/td>/gi;
        let m;
        while ((m = re.exec(html)) !== null) cells.push(m[1].trim());

        // Status lesen
        const statusMatch = html.match(/Status<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i);
        const status      = statusMatch ? statusMatch[1].trim() : null;

        // Offline: "x x x" in Messwert-Zellen (beide Modelle)
        const isXxx = (s) => /^x\s+x\s+x$/i.test(s || '');
        const isOff = !status || status.toLowerCase() === 'aus' || cells.some(c => isXxx(c));
        const isOn  = !isOff;

        // Modell-Name: aus Config-Override oder HTML lesen
        let modelName;
        if (this._cfg && this._cfg.pikoModel !== 'auto') {
            const modelMap = {
                'piko3.0':'PIKO 3.0','piko3.6':'PIKO 3.6','piko4.2':'PIKO 4.2',
                'piko5.5':'PIKO 5.5','piko7.0':'PIKO 7.0','piko8.3':'PIKO 8.3',
                'piko10.1':'PIKO 10.1',
            };
            modelName = modelMap[this._cfg.pikoModel] || 'PIKO';
        } else {
            const modelMatch = html.match(/<font[^>]*size="\+3"[^>]*>\s*([\w\s.]+)\s*<br/i) ||
                               html.match(/>(PIKO\s+[\d.]+)</i);
            modelName = modelMatch ? modelMatch[1].trim() : 'PIKO';
        }

        // Strings bestimmen: aus Config-Override oder Auto-Erkennung über Zellenanzahl
        //   13 Zellen = 2 Strings (PIKO 3.6/4.2/7.0/8.3)
        //   15 Zellen = 3 Strings (PIKO 5.5/10.1)
        const modelCfg   = this._cfg ? this._cfg.pikoModel : 'auto';
        const modelStr3  = ['piko5.5','piko10.1'].includes(modelCfg);
        const modelStr1  = modelCfg === 'piko3.0';
        const has3Strings = modelCfg === 'auto' ? cells.length >= 15 : modelStr3;

        // Messwert-Parser
        const toNum = (s) => {
            if (!s || isXxx(s) || s === '&nbsp;') return 0;
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? 0 : v;
        };
        const toEnergy = (s) => {
            if (!s || isXxx(s)) return null;
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? null : v;
        };

        const result = {
            status           : status || 'Aus',
            online           : isOn ? 1 : 0,
            'device.strings' : has3Strings ? 3 : 2,
            'device.model'   : modelName,
        };

        if (cells.length >= 10) {
            result['ac.power'] = isOn ? toNum(cells[0]) : 0;

            // Energie immer lesen (auch offline gültig)
            const eTot = toEnergy(cells[1]);
            const eDay = toEnergy(cells[2]);
            if (eTot !== null) result['energy.total'] = eTot;
            if (eDay !== null) result['energy.today'] = eDay;

            // INTERLEAVED: String und L-Phase in gleicher HTML-Tabellenzeile
            // cells[3]=S1U, cells[4]=L1U, cells[5]=S1I, cells[6]=L1P
            // cells[7]=S2U, cells[8]=L2U, cells[9]=S2I, cells[10]=L2P
            result['pv.string1.voltage'] = isOn ? toNum(cells[3])  : 0;
            result['ac.l1.voltage']      = isOn ? toNum(cells[4])  : 0;
            result['pv.string1.current'] = isOn ? toNum(cells[5])  : 0;
            result['ac.l1.power']        = isOn ? toNum(cells[6])  : 0;
            result['pv.string2.voltage'] = isOn ? toNum(cells[7])  : 0;
            result['ac.l2.voltage']      = isOn ? toNum(cells[8])  : 0;
            result['pv.string2.current'] = isOn ? toNum(cells[9])  : 0;
            result['ac.l2.power']        = isOn ? toNum(cells[10]) : 0;

            if (has3Strings) {
                // PIKO 5.5: cells[11]=S3U, cells[12]=L3U, cells[13]=S3I, cells[14]=L3P
                result['pv.string3.voltage'] = isOn ? toNum(cells[11]) : 0;
                result['ac.l3.voltage']      = isOn && cells.length > 12 ? toNum(cells[12]) : 0;
                result['pv.string3.current'] = isOn && cells.length > 13 ? toNum(cells[13]) : 0;
                result['ac.l3.power']        = isOn && cells.length > 14 ? toNum(cells[14]) : 0;
            } else {
                // PIKO 8.3: cells[11]=L3U, cells[12]=L3P (keine String3-Zeile)
                result['ac.l3.voltage'] = isOn && cells.length > 11 ? toNum(cells[11]) : 0;
                result['ac.l3.power']   = isOn && cells.length > 12 ? toNum(cells[12]) : 0;
            }
        }

        const busM = html.match(/name="[^"]*[Aa]dr[^"]*"[^>]*value="(\d+)"/i);
        if (busM) result['rs485.busAddress'] = parseInt(busM[1]);
        return result;
    }

    // ─── Parser: Infoseite (Inf.fhtml) ───────────────────────────────────────────

    _parseInfoPage(html) {
        const r = {};
        const re = /(\d+)\.\s+analoger\s+Eingang:\s*<b>([\d.,]+)V<\/b>/gi;
        let m;
        while ((m = re.exec(html)) !== null) r[`info.analog${m[1]}`] = parseFloat(m[2].replace(',','.'));
        const mm = html.match(/Modemstatus:\s*<b>([^<]+)<\/b>/i);
        if (mm) r['info.modemStatus'] = mm[1].trim();
        const pm = html.match(/letzte\s+Verbindung\s+zum\s+Portal:\s*<b>([^<]+)<\/b>/i);
        if (pm) r['info.lastPortalConnection'] = pm[1].trim();
        const sm = html.match(/Anzahl\s+der\s+Energiepulse[^:]*:\s*<b>(\d+)<\/b>/i);
        if (sm) r['info.s0Pulses'] = parseInt(sm[1]);
        return r;
    }

    // ─── Modul-Analyse: Soll-Werte berechnen ────────────────────────────────────────

    async _writeModuleStates() {
        const { moduleWp, moduleVoc, string1Modules, string2Modules, string3Modules } = this._cfg;
        // Nur berechnen wenn Modul-Konfiguration vorhanden
        if (!moduleVoc || !moduleWp) return;

        const strings = [
            { id: '1', count: string1Modules },
            { id: '2', count: string2Modules },
            { id: '3', count: string3Modules },
        ];

        for (const s of strings) {
            if (!s.count) continue;
            // Soll-Spannung = Voc × Anzahl Module
            // Hinweis: unter Last sinkt die Spannung auf Vmpp (~0.80-0.85 × Voc)
            const expectedVoc  = Math.round(moduleVoc * s.count * 10) / 10;
            const expectedPower = moduleWp * s.count;
            await this.setStateAsync(`string${s.id}.expectedVoltage`,
                { val: expectedVoc,   ack: true });
            await this.setStateAsync(`string${s.id}.expectedPower`,
                { val: expectedPower, ack: true });
        }
    }

    // ─── States anlegen ──────────────────────────────────────────────────────────

    async _ensureBaseStates() {
        const defs = [
            { id:'info.connection',           type:'boolean', role:'indicator.connected', name:'Verbunden',                   def:false },
            { id:'info.networkMode',          type:'string',  role:'text',               name:'Netzwerk-Modus (local/fritzwireguard)', def:'local' },
            { id:'info.lastPoll',             type:'string',  role:'date',                name:'Letzter Poll',                def:'' },
            { id:'status',                    type:'string',  role:'text',                name:'Betriebsstatus',              def:'Unbekannt' },
            { id:'online',                    type:'number',  role:'value',               name:'Online (1=ja, 0=nein)',       def:0 },
            { id:'ac.power',                  type:'number',  role:'value.power.active',  name:'AC-Leistung aktuell',         def:0, unit:'W' },
            { id:'ac.l1.voltage',             type:'number',  role:'value.voltage',       name:'L1 Spannung',                 def:0, unit:'V' },
            { id:'ac.l1.power',               type:'number',  role:'value.power.active',  name:'L1 Leistung',                 def:0, unit:'W' },
            { id:'ac.l2.voltage',             type:'number',  role:'value.voltage',       name:'L2 Spannung',                 def:0, unit:'V' },
            { id:'ac.l2.power',               type:'number',  role:'value.power.active',  name:'L2 Leistung',                 def:0, unit:'W' },
            { id:'ac.l3.voltage',             type:'number',  role:'value.voltage',       name:'L3 Spannung',                 def:0, unit:'V' },
            { id:'ac.l3.power',               type:'number',  role:'value.power.active',  name:'L3 Leistung',                 def:0, unit:'W' },
            { id:'energy.total',              type:'number',  role:'value.energy',        name:'Gesamtenergie',               def:0, unit:'kWh' },
            { id:'energy.today',              type:'number',  role:'value.energy',        name:'Tagesenergie',                def:0, unit:'kWh' },
            { id:'pv.string1.voltage',        type:'number',  role:'value.voltage',       name:'String 1 Spannung',           def:0, unit:'V' },
            { id:'pv.string1.current',        type:'number',  role:'value.current',       name:'String 1 Strom',             def:0, unit:'A' },
            { id:'pv.string2.voltage',        type:'number',  role:'value.voltage',       name:'String 2 Spannung',           def:0, unit:'V' },
            { id:'pv.string2.current',        type:'number',  role:'value.current',       name:'String 2 Strom',             def:0, unit:'A' },
            { id:'pv.string3.voltage',        type:'number',  role:'value.voltage',       name:'String 3 Spannung',           def:0, unit:'V' },
            { id:'pv.string3.current',        type:'number',  role:'value.current',       name:'String 3 Strom',             def:0, unit:'A' },
            { id:'device.strings',            type:'number',  role:'value',               name:'Anzahl PV-Strings (2 oder 3)', def:2 },
            { id:'device.model',              type:'string',  role:'text',                name:'Modell (PIKO 8.3 / PIKO 5.5)',  def:'' },
            { id:'info.analog1',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 1',          def:0, unit:'V' },
            { id:'info.analog2',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 2',          def:0, unit:'V' },
            { id:'info.analog3',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 3',          def:0, unit:'V' },
            { id:'info.analog4',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 4',          def:0, unit:'V' },
            { id:'info.modemStatus',          type:'string',  role:'text',                name:'Modemstatus',                 def:'' },
            { id:'info.lastPortalConnection', type:'string',  role:'text',                name:'Letzte Portal-Verbindung',    def:'' },
            { id:'info.s0Pulses',             type:'number',  role:'value',               name:'S0-Energiepulse',             def:0 },
            { id:'rs485.busAddress',          type:'number',  role:'value',               name:'RS485 Bus-Adresse',           def:255 },
            // Berechnete Soll-Werte (aus Modul-Konfiguration)
            { id:'string1.expectedVoltage',   type:'number',  role:'value.voltage',       name:'String 1 Soll-Spannung',      def:0, unit:'V' },
            { id:'string2.expectedVoltage',   type:'number',  role:'value.voltage',       name:'String 2 Soll-Spannung',      def:0, unit:'V' },
            { id:'string3.expectedVoltage',   type:'number',  role:'value.voltage',       name:'String 3 Soll-Spannung',      def:0, unit:'V' },
            { id:'string1.expectedPower',     type:'number',  role:'value.power',         name:'String 1 Soll-Leistung',      def:0, unit:'Wp' },
            { id:'string2.expectedPower',     type:'number',  role:'value.power',         name:'String 2 Soll-Leistung',      def:0, unit:'Wp' },
            { id:'string3.expectedPower',     type:'number',  role:'value.power',         name:'String 3 Soll-Leistung',      def:0, unit:'Wp' },
        ];
        for (const d of defs) {
            const obj = { type:'state', common:{ name:d.name, type:d.type, role:d.role, read:true, write:false }, native:{} };
            if (d.unit !== undefined) obj.common.unit = d.unit;
            if (d.def  !== undefined) obj.common.def  = d.def;
            await this.setObjectNotExistsAsync(d.id, obj);
            this._nodes[d.id] = { ...obj.common };
        }
    }

    async _ensureHistoryStates() {
        // Meta-States (History-Status)
        const meta = [
            { id:'history.lastImport',     type:'string',  role:'date',  name:'Letzter History-Import',           def:'' },
            { id:'history.lastImportedTs', type:'number',  role:'value', name:'Letzter importierter Timestamp ms', def:0 },
            { id:'history.recordCount',    type:'number',  role:'value', name:'History-Datenpunkte gesamt',        def:0 },
            { id:'history.newRecords',     type:'number',  role:'value', name:'Neue Punkte (letzter Import)',      def:0 },
            { id:'history.oldestRecord',   type:'string',  role:'date',  name:'\u00c4ltester History-Eintrag',    def:'' },
            { id:'history.newestRecord',   type:'string',  role:'date',  name:'Neuester History-Eintrag',         def:'' },
            { id:'history.influxSent',     type:'number',  role:'value', name:'An InfluxDB gesendete Punkte',     def:0 },
            { id:'history.pikoEpoch',      type:'string',  role:'date',  name:'PIKO Inbetriebnahme-Datum',        def:'' },
        ];
        for (const d of meta) {
            await this.setObjectNotExistsAsync(d.id, {
                type:'state', common:{ name:d.name, type:d.type, role:d.role, read:true, write:false, def:d.def }, native:{},
            });
            this._nodes[d.id] = { name:d.name, type:d.type, role:d.role };
        }

        // Messwert-States für InfluxDB
        for (const def of HISTORY_STATES) {
            await this.setObjectNotExistsAsync(def.id, {
                type:'state',
                common:{
                    name : def.name,
                    type : 'number',
                    role : 'value',
                    read : true,
                    write: false,
                    unit : def.unit,
                    // Hinweis für InfluxDB-Adapter-Config (erscheint in ioBroker Admin)
                    desc : 'History-State: enthält historische ts-Werte f\u00fcr InfluxDB',
                },
                native:{},
            });
            this._nodes[def.id] = { name:def.name, type:'number', unit:def.unit };
        }
    }

    async _writeStates(data) {
        const ts = Date.now();
        for (const [key, val] of Object.entries(data)) {
            if (val === null || val === undefined) continue;
            try { await this.setStateAsync(key, { val, ack:true, ts }); } catch (_) {}
        }
        this._lastData = { ...this._lastData, ...data, _ts: new Date().toISOString() };
    }

    // ─── Web-Server ──────────────────────────────────────────────────────────────

    _startWebServer() {
        const port = this._cfg.webPort;
        this._webServer = http.createServer((req, res) => {
            const p = url.parse(req.url, true).pathname;

            if (p === '/api/data') {
                return this._json(res, { data:this._lastData, nodes:this._nodes, ts:new Date().toISOString() });
            }
            if (p === '/api/history') {
                const rows = [...this._lastHistoryRows].reverse().slice(0, 200);
                return this._json(res, {
                    rows,
                    pikoEpoch   : this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString() : null,
                    recordCount : this._lastHistoryRows.length,
                    lastImported: this._lastImportedTs ? new Date(this._lastImportedTs).toISOString() : null,
                });
            }
            if (p === '/api/logs')   return this._json(res, { logs: this._logBuffer });
            if (p === '/api/status') return this._json(res, {
                adapter        : ADAPTER_NAME,
                version        : ADAPTER_VERSION,
                ip             : this._cfg.ip,
                port           : this._cfg.port,
                interval       : this._cfg.pollInterval,
                online         : this._lastData.online === 1,
                historyEnable  : this._cfg.historyFetch,
                syncInterval   : this._cfg.syncInterval,
                influxEnable   : this._cfg.influxEnable,
                influxInst     : this._cfg.influxInstance,
                pikoEpoch      : this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString() : null,
                lastImported   : this._lastImportedTs ? new Date(this._lastImportedTs).toISOString() : null,
            });
            if (p === '/api/trigger-history') {
                this._lastHistoryFetch = 0;
                this._fetchAndImportHistory(false).catch(e => this._log('ERROR', `Sync: ${e.message}`));
                return this._json(res, { ok:true, message:'Sync gestartet (nur neue Datenpunkte)' });
            }
            if (p === '/api/sync-all') {
                // Vollsync: Cursor zurücksetzen → alle ~6 Monate an InfluxDB
                this._fetchAndImportHistory(true).catch(e => this._log('ERROR', `Vollsync: ${e.message}`));
                return this._json(res, { ok:true, message:'Vollsync gestartet – alle Datenpunkte werden übertragen' });
            }
            if (p === '/api/ping') return this._json(res, { ok:true, adapter:ADAPTER_NAME, version:ADAPTER_VERSION });
            if (p === '/app.js') {
                res.writeHead(200, { 'Content-Type':'application/javascript; charset=utf-8' });
                return res.end(APP_JS_CODE);
            }

            res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
            res.end(WEB_UI_HTML.replace(/__VERSION__/g, ADAPTER_VERSION));
        });

        this._webServer.listen(port, () => this._log('SYSTEM', `Web-UI: http://0.0.0.0:${port}/`));
        this._webServer.on('error', e => this._log('ERROR', `Web-Server: ${e.message}`));
    }

    _json(res, obj) {
        res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' });
        res.end(JSON.stringify(obj, null, 2));
    }

    // ─── Logger ──────────────────────────────────────────────────────────────────

    _log(level, message) {
        const entry = { ts:new Date().toISOString(), level, message };
        this._logBuffer.unshift(entry);
        if (this._logBuffer.length > this._maxLogs) this._logBuffer.pop();
        switch (level) {
            case 'ERROR': this.log.error(message); break;
            case 'WARN':  this.log.warn(message);  break;
            case 'DEBUG': this.log.debug(message); break;
            default:      this.log.info(message);  break;
        }
    }
}

// ─── Web-UI ───────────────────────────────────────────────────────────────────
const WEB_UI_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kostal PIKO &ndash; ioBroker</title>
<style>
:root{--bg:#0d1117;--bg2:#161b22;--bg3:#1c2128;--bd:#30363d;--acc:#f6c90e;--grn:#3fb950;--red:#f85149;--blu:#58a6ff;--orn:#e3b341;--txt:#e6edf3;--mut:#8b949e;--r:8px;--f:'Segoe UI',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:var(--f);min-height:100vh}
header{background:var(--bg2);border-bottom:1px solid var(--bd);padding:12px 22px;display:flex;align-items:center;gap:14px}
.logo{width:34px;height:34px;background:var(--acc);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.lt{font-size:16px;font-weight:700}.ls{font-size:11px;color:var(--mut)}
.vb{margin-left:auto;background:var(--bg3);border:1px solid var(--bd);border-radius:20px;padding:3px 11px;font-size:12px;color:var(--mut)}
.sd{width:8px;height:8px;border-radius:50%;background:var(--red);display:inline-block;margin-right:5px;transition:background .4s}
.sd.on{background:var(--grn)}
nav{background:var(--bg2);border-bottom:1px solid var(--bd);display:flex;padding:0 18px;gap:2px}
nav button{background:none;border:none;cursor:pointer;color:var(--mut);padding:10px 15px;font-size:13px;font-family:var(--f);border-bottom:2px solid transparent;transition:color .2s,border-color .2s}
nav button:hover{color:var(--txt)}nav button.act{color:var(--acc);border-bottom-color:var(--acc)}
main{padding:18px;max-width:1300px;margin:0 auto}
.tc{display:none}.tc.act{display:block}
.card{background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r);padding:16px;margin-bottom:12px}
.ct{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--mut);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.dot{width:5px;height:5px;border-radius:50%;background:var(--acc);flex-shrink:0}
.grid{display:grid;gap:9px}
.g2{grid-template-columns:repeat(auto-fill,minmax(230px,1fr))}
.g3{grid-template-columns:repeat(auto-fill,minmax(175px,1fr))}
.g4{grid-template-columns:repeat(auto-fill,minmax(145px,1fr))}
.vc{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:13px;display:flex;flex-direction:column;gap:3px}
.vl{font-size:11px;color:var(--mut)}.vv{font-size:21px;font-weight:700}.vu{font-size:11px;color:var(--mut)}
.vc.a .vv{color:var(--acc)}.vc.g .vv{color:var(--grn)}.vc.b .vv{color:var(--blu)}.vc.o .vv{color:var(--orn)}
.sb{display:inline-flex;align-items:center;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;background:rgba(248,81,73,.12);color:var(--red);border:1px solid rgba(248,81,73,.3)}
.sb.on{background:rgba(63,185,80,.12);color:var(--grn);border-color:rgba(63,185,80,.3)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;padding:6px 8px;color:var(--mut);border-bottom:1px solid var(--bd);font-weight:600;white-space:nowrap}
td{padding:6px 8px;border-bottom:1px solid rgba(48,54,61,.5)}
tr:hover td{background:rgba(255,255,255,.02)}
.badge{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600}
.bn{background:rgba(88,166,255,.12);color:var(--blu)}.bs{background:rgba(246,201,14,.12);color:var(--acc)}.bb{background:rgba(63,185,80,.12);color:var(--grn)}
.lw{background:#0d1117;border:1px solid var(--bd);border-radius:var(--r);padding:10px;max-height:460px;overflow-y:auto;font-family:Consolas,monospace;font-size:12px}
.le{padding:2px 0;display:flex;gap:7px}.lts{color:var(--mut);flex-shrink:0}.llv{font-weight:700;flex-shrink:0;min-width:54px}.lm{color:var(--txt)}
.lERROR{color:var(--red)}.lWARN{color:var(--orn)}.lINFO{color:var(--blu)}.lSYSTEM{color:var(--grn)}.lDEBUG{color:var(--mut)}
.tb{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:9px;align-items:center}
.tb select,.tb button{background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:5px 10px;border-radius:var(--r);font-size:12px;cursor:pointer}
.tb button:hover{background:var(--bd)}.tb label{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:5px}
.sr{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--bd)}
.sr:last-child{border:none}.sk{font-size:13px;color:var(--mut)}.sv{font-size:13px;font-weight:600}
.btn{padding:6px 14px;border-radius:var(--r);border:1px solid var(--bd);background:var(--bg3);color:var(--txt);font-size:13px;cursor:pointer;transition:background .2s}
.btn:hover{background:var(--bd)}.btn.a{background:var(--acc);color:#000;border-color:var(--acc);font-weight:700}.btn.a:hover{filter:brightness(1.1)}
.chip{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.ck{background:rgba(63,185,80,.14);color:var(--grn)}.ce{background:rgba(248,81,73,.14);color:var(--red)}
.muted{font-size:11px;color:var(--mut)}
.hc{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:10px;margin-bottom:12px}
.hct{font-size:11px;color:var(--mut);margin-bottom:6px}
.sp{width:100%;height:56px;display:block}
.ir{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px}
.ii .il{font-size:10px;color:var(--mut)}.ii .iv{font-weight:600;font-size:13px}
</style>
</head>
<body>
<header>
  <div class="logo">&#9728;</div>
  <div><div class="lt">Kostal PIKO</div><div class="ls">ioBroker Adapter v__VERSION__</div></div>
  <div class="vb" id="hVer">v__VERSION__</div>
  <div style="margin-left:10px;display:flex;align-items:center;font-size:13px">
    <span class="sd" id="sdot"></span><span id="stxt">Lade...</span>
  </div>
</header>

<nav id="tabs">
  <button class="act" onclick="showTab('daten')">&#9889; Daten</button>
  <button onclick="showTab('history')">&#128200; Historie</button>
  <button onclick="showTab('nodes')">&#127760; Nodes</button>
  <button onclick="showTab('logs')">&#128196; Logs</button>
  <button onclick="showTab('system')">&#9881; System</button>
</nav>

<main>

<!-- DATEN -->
<div class="tc act" id="tab-daten">
  <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-bottom:9px">
    <span class="muted" id="lUpd">--</span>
    <button class="btn" onclick="loadData()" style="padding:3px 9px;font-size:12px">&#8635;</button>
  </div>
  <div class="card" style="display:flex;align-items:center;gap:16px;padding:13px 16px">
    <div><div class="muted" style="margin-bottom:4px">Betriebsstatus</div><span class="sb" id="sBadge">--</span></div>
    <div style="margin-left:auto;text-align:right"><div class="muted">Modell</div><div style="font-weight:600" id="d-model">--</div></div>
  </div>
  <div class="card">
    <div class="ct"><span class="dot"></span>AC-Leistung &amp; Energie</div>
    <div class="grid g3">
      <div class="vc a"><div class="vl">AC-Leistung</div><div class="vv" id="d-acp">--</div><div class="vu">W</div></div>
      <div class="vc g"><div class="vl">Gesamtenergie</div><div class="vv" id="d-etot">--</div><div class="vu">kWh</div></div>
      <div class="vc b"><div class="vl">Tagesenergie</div><div class="vv" id="d-eday">--</div><div class="vu">kWh</div></div>
    </div>
  </div>
  <div class="card">
    <div class="ct"><span class="dot"></span>PV-Generator</div>
    <div class="grid g4">
      <div class="vc"><div class="vl">String 1 &ndash; Spannung</div><div class="vv" id="d-s1v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">String 1 &ndash; Strom</div><div class="vv" id="d-s1a">--</div><div class="vu">A</div></div>
      <div class="vc"><div class="vl">String 2 &ndash; Spannung</div><div class="vv" id="d-s2v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">String 2 &ndash; Strom</div><div class="vv" id="d-s2a">--</div><div class="vu">A</div></div>
      <div class="vc" id="card-s3v" style="display:none"><div class="vl">String 3 &ndash; Spannung</div><div class="vv" id="d-s3v">--</div><div class="vu">V</div></div>
      <div class="vc" id="card-s3a" style="display:none"><div class="vl">String 3 &ndash; Strom</div><div class="vv" id="d-s3a">--</div><div class="vu">A</div></div>
    </div>
  </div>
  <!-- String-Analyse (nur sichtbar wenn Modul-Konfig gesetzt) -->
  <div class="card" id="sa-card" style="display:none">
    <div class="ct"><span class="dot"></span>String-Analyse (Soll vs. Ist)</div>
    <div class="grid g3">
      <div class="vc" id="sa-1" style="display:none"></div>
      <div class="vc" id="sa-2" style="display:none"></div>
      <div class="vc" id="sa-3" style="display:none"></div>
    </div>
    <div style="font-size:10px;color:var(--mut);margin-top:8px">
      Soll-Spannung = Voc &times; Modulanzahl (Leerlauf). Unter Last (MPP) typisch 80&ndash;88&thinsp;% davon.
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Ausgangsleistung L1 / L2 / L3</div>
    <div class="grid g3">
      <div class="vc"><div class="vl">L1 Spannung</div><div class="vv" id="d-l1v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">L1 Leistung</div><div class="vv" id="d-l1p">--</div><div class="vu">W</div></div>
      <div class="vc"><div class="vl">L2 Spannung</div><div class="vv" id="d-l2v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">L2 Leistung</div><div class="vv" id="d-l2p">--</div><div class="vu">W</div></div>
      <div class="vc"><div class="vl">L3 Spannung</div><div class="vv" id="d-l3v">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">L3 Leistung</div><div class="vv" id="d-l3p">--</div><div class="vu">W</div></div>
    </div>
  </div>
  <div class="card">
    <div class="ct"><span class="dot"></span>Info &amp; Analoge Eing&auml;nge</div>
    <div class="grid g4">
      <div class="vc"><div class="vl">Analoger Eingang 1</div><div class="vv" id="d-a1">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">Analoger Eingang 2</div><div class="vv" id="d-a2">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">Analoger Eingang 3</div><div class="vv" id="d-a3">--</div><div class="vu">V</div></div>
      <div class="vc"><div class="vl">Analoger Eingang 4</div><div class="vv" id="d-a4">--</div><div class="vu">V</div></div>
    </div>
    <div class="ir">
      <div class="ii"><div class="il">Modemstatus</div><div class="iv" id="d-modem">--</div></div>
      <div class="ii"><div class="il">Portal</div><div class="iv" id="d-portal">--</div></div>
      <div class="ii"><div class="il">S0-Pulse</div><div class="iv" id="d-s0">--</div></div>
    </div>
  </div>
</div>

<!-- HISTORY -->
<div class="tc" id="tab-history">
  <div class="card" style="padding:13px 16px">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:14px">
      <div><div class="muted" style="font-size:10px">Datenpunkte</div><div style="font-weight:700;font-size:20px" id="h-cnt">--</div></div>
      <div><div class="muted" style="font-size:10px">Zeitraum</div><div style="font-size:13px;font-weight:600" id="h-rng">--</div></div>
      <div><div class="muted" style="font-size:10px">PIKO in Betrieb seit</div><div style="font-size:13px;font-weight:600" id="h-ep">--</div></div>
      <div><div class="muted" style="font-size:10px">Letzter Import</div><div style="font-size:13px;font-weight:600" id="h-li">--</div></div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="loadHistory()">&#8635; Neu laden</button>
        <button class="btn" onclick="triggerSync()">&#8635; Neue Punkte sync</button>
        <button class="btn a" onclick="confirmSyncAll()">&#9733; Sync-All</button>
      </div>
    </div>
  </div>

  <div class="grid g2" style="margin-bottom:12px">
    <div class="hc"><div class="hct">AC Gesamtleistung [W]</div><canvas class="sp" id="sp0"></canvas></div>
    <div class="hc"><div class="hct">String 1 Leistung [W]</div><canvas class="sp" id="sp1"></canvas></div>
    <div class="hc"><div class="hct">String 2 Leistung [W]</div><canvas class="sp" id="sp2"></canvas></div>
    <div class="hc"><div class="hct">L1 Spannung [V]</div><canvas class="sp" id="sp3"></canvas></div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Messwerte (neueste zuerst, max. 200 Zeilen)</div>
    <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Zeitpunkt</th><th>AC [W]</th>
        <th>DC1 U</th><th>DC1 I</th><th>DC1 P</th>
        <th>DC2 U</th><th>DC2 I</th><th>DC2 P</th>
        <th>L1 U</th><th>L1 P</th><th>L2 U</th><th>L2 P</th><th>L3 U</th><th>L3 P</th>
        <th>Hz</th><th>St</th>
      </tr></thead>
      <tbody id="hTb"><tr><td colspan="16" style="color:var(--mut);text-align:center;padding:18px">Kein History-Import &ndash; History in den Einstellungen aktivieren</td></tr></tbody>
    </table>
    </div>
  </div>
</div>

<!-- NODES -->
<div class="tc" id="tab-nodes">
  <div class="card">
    <div class="ct"><span class="dot"></span>ioBroker Datenpunkte</div>
    <table><thead><tr><th>State-ID</th><th>Name</th><th>Typ</th><th>Wert</th><th>Einheit</th></tr></thead>
    <tbody id="nTb"><tr><td colspan="5" style="color:var(--mut);text-align:center;padding:16px">Lade...</td></tr></tbody></table>
  </div>
</div>

<!-- LOGS -->
<div class="tc" id="tab-logs">
  <div class="tb">
    <label>Level:<select id="lvlF" onchange="renderLogs()">
      <option value="">Alle</option><option>SYSTEM</option><option>INFO</option><option>WARN</option><option>ERROR</option><option>DEBUG</option>
    </select></label>
    <label><input type="checkbox" id="aScrl" checked> Auto-Scroll</label>
    <button class="btn" onclick="loadLogs()">&#8635; Aktualisieren</button>
    <button class="btn" onclick="allLogs=[];document.getElementById('lWrap').innerHTML=''">&#128465; L&ouml;schen</button>
  </div>
  <div class="lw" id="lWrap"></div>
</div>

<!-- SYSTEM -->
<div class="tc" id="tab-system">
  <div class="card"><div class="ct"><span class="dot"></span>Adapter-Info</div><div id="sysInfo">Lade...</div></div>
  <div class="card"><div class="ct"><span class="dot"></span>History &amp; InfluxDB-Sync</div><div id="sysHist">Lade...</div></div>

  <div class="card" style="border-color:var(--acc)">
    <div class="ct"><span class="dot"></span>Sync-Aktionen</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
      <button class="btn" onclick="triggerSync()" id="btnSync">&#8635; Neue Punkte synchronisieren</button>
      <button class="btn" style="border-color:var(--acc);color:var(--acc)" onclick="confirmSyncAll()" id="btnSyncAll">&#9733; Sync-All (gesamte Historie)</button>
      <button class="btn" onclick="loadData()">&#8635; Live-Daten neu laden</button>
    </div>
    <div id="syncMsg" style="margin-top:10px;font-size:12px;color:var(--mut)"></div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Wo werden InfluxDB-Verbindungsdaten konfiguriert?</div>
    <div style="font-size:13px;line-height:1.75;color:var(--mut)">
      <p>Die Verbindung zum InfluxDB-Server <strong style="color:var(--txt)">(Host, Port, Datenbank, Token)</strong> wird <strong style="color:var(--txt)">nicht hier</strong> eingetragen, sondern im:</p>
      <p style="margin-top:6px;padding:8px 12px;background:var(--bg3);border-radius:var(--r);border:1px solid var(--bd);font-family:monospace;color:var(--blu)">ioBroker Admin &rarr; Adapter &rarr; InfluxDB &rarr; Instanz konfigurieren</p>
      <p style="margin-top:8px">Dieser Adapter kennt nur den <strong style="color:var(--txt)">Namen der Instanz</strong> (z.&nbsp;B. <code>influxdb.0</code>) und schickt die Daten per internem <code>sendTo()</code>-Aufruf dorthin. Die Instanz leitet sie dann mit dem korrekten historischen Zeitstempel an InfluxDB weiter.</p>
    </div>
  </div>
</div>

</main>
<script src="/app.js"></script>
</body>
</html>`;

if (require.main !== module) {
    module.exports = (options) => new KostalPikoAdapter(options);
} else {
    new KostalPikoAdapter();
}
// app.js wird aus admin/app.js geladen
const APP_JS_CODE = fs.readFileSync(path.join(__dirname, 'admin', 'app.js'), 'utf-8');


