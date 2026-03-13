'use strict';

/**
 * ioBroker Kostal PIKO Adapter
 * Liest Echtzeit- und Historiendaten vom Kostal PIKO Wechselrichter via HTTP-Scraping
 * Version: 0.3.2
 */

const utils = require('@iobroker/adapter-core');
const http  = require('http');
const url   = require('url');

// ─── Konstanten ────────────────────────────────────────────────────────────────
const ADAPTER_NAME    = 'kostalpiko';
const ADAPTER_VERSION = '0.3.2';

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
            ip            : (this.config.ip            || '192.168.178.30').trim(),
            port          : parseInt(this.config.port)          || 80,
            user          : (this.config.user          || 'pvserver').trim(),
            password      : (this.config.password      || 'pvwr').trim(),
            pollInterval  : parseInt(this.config.pollInterval)  || 30,
            webPort       : parseInt(this.config.webPort)       || 8092,
            verbose       : !!this.config.verbose,
            historyFetch  : !!this.config.historyFetch,
            // syncInterval: aus Admin-Config (früher historyInterval)
            syncInterval  : parseInt(this.config.syncInterval || this.config.historyInterval) || 15,
            influxInstance: (this.config.influxInstance || 'influxdb.0').trim(),
            // InfluxDB ist aktiv wenn historyFetch aktiv
            influxEnable  : !!this.config.historyFetch,
        };

        this._log('SYSTEM',
            `Ziel: http://${this._cfg.ip}:${this._cfg.port} | ` +
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

    // ─── Polling-Hauptschleife ───────────────────────────────────────────────────

    async _poll() {
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
            await this.setStateAsync('info.connection', { val: true,  ack: true });
            await this.setStateAsync('info.lastPoll',   { val: new Date().toISOString(), ack: true });
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

        // "akt. Zeit" aus Header lesen
        const m = raw.match(/akt\.\s*Zeit:\s*(\d+)/);
        if (!m) throw new Error('"akt. Zeit" nicht im Header der LogDaten.dat gefunden');
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
    // Unterstützt PIKO 8.3 (2 Strings, leere Zellen=offline) und
    // PIKO 5.5 (3 Strings, "x x x" in Zellen=offline)

    _parseMainPage(html) {
        // Alle bgcolor="#FFFFFF" Zellen sammeln (inkl. leere)
        const cells = [];
        const re    = /bgcolor="#FFFFFF">\s*([\s\S]*?)\s*<\/td>/gi;
        let m;
        while ((m = re.exec(html)) !== null) cells.push(m[1].trim());

        // Status lesen
        const statusMatch = html.match(/Status<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i);
        const status      = statusMatch ? statusMatch[1].trim() : null;

        // Offline-Erkennung: beide PIKO-Modelle zeigen "x x x" in den
        // Messpunkt-Zellen wenn der Inverter aus ist (Status: "Aus").
        // Energie-Zähler (cells[1], cells[2]) zeigen aber immer echte Werte!
        const isXxx = (s) => /^x\s+x\s+x$/i.test(s || '');
        const isOff = !status || status.toLowerCase() === 'aus' || cells.some(c => isXxx(c));
        const isOn  = !isOff;

        // Strings auto-detektieren anhand Zellenanzahl:
        //   2 Strings (PIKO 8.3) → 13 Zellen
        //   3 Strings (PIKO 5.5) → 15 Zellen
        const has3Strings = cells.length >= 15;
        const acOffset    = has3Strings ? 2 : 0;

        // Messwert-Parser: "x x x" → 0, leere Zellen → 0, Zahlen → float
        const toNum = (s) => {
            if (!s || isXxx(s) || s === '&nbsp;') return 0;
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? 0 : v;
        };
        // Energie-Parser: immer auslesen, auch wenn offline
        const toEnergy = (s) => {
            if (!s || isXxx(s)) return null; // null = nicht updaten
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? null : v;
        };

        const result = {
            status           : status || 'Aus',
            online           : isOn ? 1 : 0,
            'device.strings' : has3Strings ? 3 : 2,
        };

        if (cells.length >= 10) {
            // Energie immer speichern (zeigt echte Werte auch wenn offline)
            const eTot = toEnergy(cells[1]);
            const eDay = toEnergy(cells[2]);
            if (eTot !== null) result['energy.total'] = eTot;
            if (eDay !== null) result['energy.today'] = eDay;

            // Leistungs-Messwerte: bei offline immer 0
            result['ac.power']           = isOn ? toNum(cells[0]) : 0;
            result['pv.string1.voltage'] = isOn ? toNum(cells[3]) : 0;
            result['pv.string1.current'] = isOn ? toNum(cells[4]) : 0;
            result['pv.string2.voltage'] = isOn ? toNum(cells[5]) : 0;
            result['pv.string2.current'] = isOn ? toNum(cells[6]) : 0;

            if (has3Strings) {
                result['pv.string3.voltage'] = isOn ? toNum(cells[7]) : 0;
                result['pv.string3.current'] = isOn ? toNum(cells[8]) : 0;
            }

            result['ac.l1.voltage'] = isOn ? toNum(cells[7  + acOffset]) : 0;
            result['ac.l1.power']   = isOn ? toNum(cells[8  + acOffset]) : 0;
            result['ac.l2.voltage'] = isOn ? toNum(cells[9  + acOffset]) : 0;
            result['ac.l2.power']   = isOn ? toNum(cells[10 + acOffset]) : 0;
            result['ac.l3.voltage'] = isOn && cells.length > 11 + acOffset ? toNum(cells[11 + acOffset]) : 0;
            result['ac.l3.power']   = isOn && cells.length > 12 + acOffset ? toNum(cells[12 + acOffset]) : 0;
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

    // ─── States anlegen ──────────────────────────────────────────────────────────

    async _ensureBaseStates() {
        const defs = [
            { id:'info.connection',           type:'boolean', role:'indicator.connected', name:'Verbunden',                   def:false },
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
            { id:'info.analog1',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 1',          def:0, unit:'V' },
            { id:'info.analog2',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 2',          def:0, unit:'V' },
            { id:'info.analog3',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 3',          def:0, unit:'V' },
            { id:'info.analog4',              type:'number',  role:'value.voltage',       name:'Analoger Eingang 4',          def:0, unit:'V' },
            { id:'info.modemStatus',          type:'string',  role:'text',                name:'Modemstatus',                 def:'' },
            { id:'info.lastPortalConnection', type:'string',  role:'text',                name:'Letzte Portal-Verbindung',    def:'' },
            { id:'info.s0Pulses',             type:'number',  role:'value',               name:'S0-Energiepulse',             def:0 },
            { id:'rs485.busAddress',          type:'number',  role:'value',               name:'RS485 Bus-Adresse',           def:255 },
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
    <div style="margin-left:auto;text-align:right"><div class="muted">Modell</div><div style="font-weight:600">PIKO 8.3</div></div>
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
// ─── App JavaScript (separat gehostet) ──────────────────────────────────────
const APP_JS_CODE = `(function(){
var allLogs=[],allNodes={},allData={},histRows=[];

window.showTab=function(n){
  document.querySelectorAll('.tc').forEach(function(e){e.classList.remove('act')});
  document.querySelectorAll('nav button').forEach(function(e){e.classList.remove('act')});
  var t=document.getElementById('tab-'+n); if(t) t.classList.add('act');
  document.querySelectorAll('nav button').forEach(function(b){
    if(b.getAttribute('onclick')==="showTab('"+n+"')") b.classList.add('act');
  });
  if(n==='logs')    loadLogs();
  if(n==='system')  loadSystem();
  if(n==='nodes')   renderNodes();
  if(n==='history') loadHistory();
};

/* \u2500\u2500 Live-Daten \u2500\u2500 */
window.loadData=function(){
  fetch(window.location.origin+'/api/data').then(function(r){return r.json()}).then(function(j){
    allData=j.data||{}; allNodes=j.nodes||{};
    var on=allData.online===1;
    document.getElementById('sdot').className='sd'+(on?' on':'');
    document.getElementById('stxt').textContent=on?'Online':'Offline';
    if(allData._ts) document.getElementById('lUpd').textContent='Aktualisiert '+new Date(allData._ts).toLocaleTimeString('de-DE');
    var b=document.getElementById('sBadge'); b.textContent=allData.status||'--'; b.className='sb'+(on?' on':'');
    function s(id,k,dec){var v=allData[k];document.getElementById(id).textContent=v!=null?(dec!=null?Number(v).toFixed(dec):v):'--';}
    s('d-acp','ac.power'); s('d-etot','energy.total'); s('d-eday','energy.today');
    s('d-s1v','pv.string1.voltage'); s('d-s1a','pv.string1.current',2);
    s('d-s2v','pv.string2.voltage'); s('d-s2a','pv.string2.current',2);
    s('d-s3v','pv.string3.voltage'); s('d-s3a','pv.string3.current',2);
    var has3=(allData['device.strings']===3);
    ['card-s3v','card-s3a'].forEach(function(id){
      var el=document.getElementById(id); if(el) el.style.display=has3?'':'none';
    });
    s('d-l1v','ac.l1.voltage'); s('d-l1p','ac.l1.power');
    s('d-l2v','ac.l2.voltage'); s('d-l2p','ac.l2.power');
    s('d-l3v','ac.l3.voltage'); s('d-l3p','ac.l3.power');
    s('d-a1','info.analog1',2); s('d-a2','info.analog2',2); s('d-a3','info.analog3',2); s('d-a4','info.analog4',2);
    document.getElementById('d-modem').textContent=allData['info.modemStatus']||'--';
    document.getElementById('d-portal').textContent=allData['info.lastPortalConnection']||'--';
    s('d-s0','info.s0Pulses');
  }).catch(function(){});
};

/* \u2500\u2500 History \u2500\u2500 */
window.loadHistory=function(){
  fetch(window.location.origin+'/api/history').then(function(r){return r.json()}).then(function(j){
    histRows=j.rows||[];
    document.getElementById('h-cnt').textContent=j.recordCount||0;
    document.getElementById('h-ep').textContent=j.pikoEpoch?j.pikoEpoch.substring(0,10):'--';
    document.getElementById('h-li').textContent=j.lastImported?new Date(j.lastImported).toLocaleString('de-DE'):'noch kein Import';
    if(histRows.length){
      var f=histRows[histRows.length-1],l=histRows[0];
      document.getElementById('h-rng').textContent=(f.date||'').substring(0,10)+' \u2013 '+(l.date||'').substring(0,10);
    }
    renderHistTable(); renderSparklines();
  }).catch(function(){});
};

function renderHistTable(){
  var tb=document.getElementById('hTb');
  if(!histRows.length){
    tb.innerHTML='<tr><td colspan="16" style="color:var(--mut);text-align:center;padding:16px">Keine Daten</td></tr>'; return;
  }
  tb.innerHTML=histRows.slice(0,200).map(function(r){
    var dt=r.date?new Date(r.date).toLocaleString('de-DE'):'--';
    var dim=r.acTotalPower===0?'style="color:var(--mut)"':'';
    return '<tr '+dim+'><td style="font-size:11px;white-space:nowrap">'+dt+'</td>'+
      '<td style="font-weight:600">'+r.acTotalPower+'</td>'+
      '<td>'+r.dc1.voltage+'</td><td>'+r.dc1.current.toFixed(3)+'</td><td>'+r.dc1.power+'</td>'+
      '<td>'+r.dc2.voltage+'</td><td>'+r.dc2.current.toFixed(3)+'</td><td>'+r.dc2.power+'</td>'+
      '<td>'+r.ac1.voltage+'</td><td>'+r.ac1.power+'</td>'+
      '<td>'+r.ac2.voltage+'</td><td>'+r.ac2.power+'</td>'+
      '<td>'+r.ac3.voltage+'</td><td>'+r.ac3.power+'</td>'+
      '<td>'+r.frequency+'</td><td>'+r.acStatus+'</td></tr>';
  }).join('');
}

function renderSparklines(){
  var defs=[
    {id:'sp0',fn:function(r){return r.acTotalPower},color:'#f6c90e'},
    {id:'sp1',fn:function(r){return r.dc1.power},   color:'#3fb950'},
    {id:'sp2',fn:function(r){return r.dc2.power},   color:'#58a6ff'},
    {id:'sp3',fn:function(r){return r.ac1.voltage}, color:'#e3b341'},
  ];
  var sample=[].concat(histRows).reverse().slice(0,96);
  defs.forEach(function(ds){
    var cv=document.getElementById(ds.id); if(!cv) return;
    var vals=sample.map(ds.fn);
    var max=Math.max.apply(null,vals)||1;
    var min=Math.min.apply(null,vals.filter(function(v){return v>0}))||0;
    var W=cv.parentElement.clientWidth-20, H=56;
    cv.width=W; cv.height=H;
    var ctx=cv.getContext('2d'), L=vals.length;
    ctx.clearRect(0,0,W,H);
    if(L<2) return;
    ctx.beginPath();
    vals.forEach(function(v,i){
      var x=i/(L-1)*W, y=H-((v-min)/(max-min||1))*(H-4)-2;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
    ctx.fillStyle=ds.color+'25'; ctx.fill();
    ctx.beginPath();
    vals.forEach(function(v,i){
      var x=i/(L-1)*W, y=H-((v-min)/(max-min||1))*(H-4)-2;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    ctx.strokeStyle=ds.color; ctx.lineWidth=1.5; ctx.stroke();
  });
}

window.triggerSync=function(){
  var msg=document.getElementById('syncMsg');
  if(msg) msg.textContent='Sync wird gestartet...';
  fetch(window.location.origin+'/api/trigger-history').then(function(){
    if(msg) msg.textContent='Sync l\u00e4uft \u2013 neue Datenpunkte werden \u00fcbertragen. Seite in ca. 10 s neu laden.';
    setTimeout(loadHistory, 8000);
  }).catch(function(e){ if(msg) msg.textContent='Fehler: '+e.message; });
};

window.confirmSyncAll=function(){
  if(!confirm('Sync-All: Alle Datenpunkte der letzten ~6 Monate werden an InfluxDB \u00fcbertragen.\n\nDas kann je nach Datenmenge einige Minuten dauern.\n\nFortfahren?')) return;
  var msg=document.getElementById('syncMsg');
  if(msg) msg.textContent='Vollsync gestartet \u2013 bitte warten, das kann einige Minuten dauern...';
  var btn=document.getElementById('btnSyncAll');
  if(btn){ btn.disabled=true; btn.textContent='\u23F3 L\u00e4uft...'; }
  fetch(window.location.origin+'/api/sync-all').then(function(){
    if(msg) msg.textContent='Vollsync l\u00e4uft. Seite in ca. 30 s aktualisieren.';
    setTimeout(function(){
      loadHistory();
      if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
    }, 30000);
  }).catch(function(e){
    if(msg) msg.textContent='Fehler: '+e.message;
    if(btn){ btn.disabled=false; btn.textContent='\u2605 Sync-All (gesamte Historie)'; }
  });
};

/* \u2500\u2500 Nodes \u2500\u2500 */
window.renderNodes=function(){
  var tb=document.getElementById('nTb'), keys=Object.keys(allNodes).sort();
  if(!keys.length){tb.innerHTML='<tr><td colspan="5" style="color:var(--mut);text-align:center;padding:16px">Daten-Tab zuerst \u00f6ffnen</td></tr>';return;}
  tb.innerHTML=keys.map(function(k){
    var n=allNodes[k], v=allData[k];
    var bc=n.type==='number'?'bn':(n.type==='boolean'?'bb':'bs');
    return '<tr><td style="font-family:monospace;font-size:11px;color:var(--blu)">'+k+'</td>'+
      '<td>'+(n.name||'')+'</td>'+
      '<td><span class="badge '+bc+'">'+(n.type||'')+'</span></td>'+
      '<td style="font-weight:600">'+(v!=null?v:'<span style="color:var(--mut)">--</span>')+'</td>'+
      '<td style="color:var(--mut)">'+(n.unit||'')+'</td></tr>';
  }).join('');
};

/* \u2500\u2500 Logs \u2500\u2500 */
window.loadLogs=function(){
  fetch(window.location.origin+'/api/logs').then(function(r){return r.json()}).then(function(j){allLogs=j.logs||[];renderLogs()});
};
window.renderLogs=function(){
  var f=document.getElementById('lvlF').value, c=document.getElementById('lWrap');
  var rows=f?allLogs.filter(function(l){return l.level===f}):allLogs;
  c.innerHTML=rows.length?rows.map(function(l){
    return '<div class="le"><span class="lts">'+l.ts.replace('T',' ').substring(0,19)+'</span>'+
      '<span class="llv l'+l.level+'">'+l.level+'</span>'+
      '<span class="lm">'+l.message.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span></div>';
  }).join(''):'<div style="color:var(--mut);padding:6px">Keine Eintr\u00e4ge</div>';
  if(document.getElementById('aScrl').checked) c.scrollTop=c.scrollHeight;
};

/* \u2500\u2500 System \u2500\u2500 */
window.loadSystem=function(){
  fetch(window.location.origin+'/api/status').then(function(r){return r.json()}).then(function(s){
    function row(k,v){return '<div class="sr"><span class="sk">'+k+'</span><span class="sv">'+v+'</span></div>';}
    document.getElementById('sysInfo').innerHTML=[
      row('Adapter', s.adapter),
      row('Version', 'v'+s.version),
      row('Ziel-IP', s.ip+':'+s.port),
      row('Poll-Intervall', s.interval+' s'),
      row('Status', s.online?'<span class="sb on">Online</span>':'<span class="sb">Offline</span>'),
    ].join('');
    document.getElementById('sysHist').innerHTML=[
      row('Sync aktiviert', s.historyEnable?'<span class="chip ck">ja</span>':'<span class="chip ce">nein (in Einstellungen aktivieren)</span>'),
      row('Sync-Intervall', s.historyEnable?s.syncInterval+' Minuten':'\u2013'),
      row('InfluxDB-Instanz', '<code>'+s.influxInst+'</code>'),
      row('PIKO Inbetriebnahme', s.pikoEpoch?s.pikoEpoch.substring(0,10):'noch nicht ermittelt'),
      row('Letzter Sync', s.lastImported?new Date(s.lastImported).toLocaleString('de-DE'):'noch kein Sync'),
    ].join('');
  });
};

/* \u2500\u2500 Auto-Refresh \u2500\u2500 */
function tick(){
  var a=document.querySelector('.tc.act');
  if(!a) return;
  if(a.id==='tab-daten')   loadData();
  if(a.id==='tab-logs')    loadLogs();
  if(a.id==='tab-history') loadHistory();
}
loadData(); loadLogs();
setInterval(tick,15000);
})();`;


