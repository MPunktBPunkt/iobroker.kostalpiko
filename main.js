'use strict';

/**
 * ioBroker Kostal PIKO Adapter
 * Liest Echtzeit- und Historiendaten vom Kostal PIKO Wechselrichter via HTTP-Scraping
 * Version: 0.6.29
 */

const utils = require('@iobroker/adapter-core');
const { MODULE_PRESETS, getModulePresetFields } = require('./lib/module-presets');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const url = require('node:url');

// ─── Konstanten ────────────────────────────────────────────────────────────────
const ADAPTER_NAME = 'kostalpiko';
const ADAPTER_VERSION = '0.6.29';
const WEATHER_HISTORY_CACHE_MAX = 400;

const POLL_URLS = {
    main: '/index.fhtml',
    info: '/Inf.fhtml',
    log: '/LogDaten.dat',
};

// Spaltenindizes für LogDaten.dat (Tab-separiert)
const COL = {
    ZEIT: 0,
    DC1_U: 1,
    DC1_I: 2,
    DC1_P: 3,
    DC1_T: 4,
    DC1_S: 5,
    DC2_U: 6,
    DC2_I: 7,
    DC2_P: 8,
    DC2_T: 9,
    DC2_S: 10,
    DC3_U: 11,
    DC3_I: 12,
    DC3_P: 13,
    DC3_T: 14,
    DC3_S: 15,
    AC1_U: 16,
    AC1_I: 17,
    AC1_P: 18,
    AC1_T: 19,
    AC2_U: 20,
    AC2_I: 21,
    AC2_P: 22,
    AC2_T: 23,
    AC3_U: 24,
    AC3_I: 25,
    AC3_P: 26,
    AC3_T: 27,
    AC_F: 28,
    FC_I: 29,
    AIN1: 30,
    AIN2: 31,
    AIN3: 32,
    AIN4: 33,
    AC_S: 34,
    ERR: 35,
    ENS_S: 36,
    ENS_ERR: 37,
    KB_S: 38,
    TOTAL_E: 39,
    ISO_R: 40,
};

// History-States für InfluxDB (erhalten historische ts-Werte beim setState)
const HISTORY_STATES = [
    { id: 'history.dc1.voltage', col: COL.DC1_U, factor: 1, unit: 'V', name: 'String 1 Spannung (15-min)' },
    { id: 'history.dc1.current', col: COL.DC1_I, factor: 0.001, unit: 'A', name: 'String 1 Strom (15-min)' },
    { id: 'history.dc1.power', col: COL.DC1_P, factor: 1, unit: 'W', name: 'String 1 Leistung (15-min)' },
    { id: 'history.dc2.voltage', col: COL.DC2_U, factor: 1, unit: 'V', name: 'String 2 Spannung (15-min)' },
    { id: 'history.dc2.current', col: COL.DC2_I, factor: 0.001, unit: 'A', name: 'String 2 Strom (15-min)' },
    { id: 'history.dc2.power', col: COL.DC2_P, factor: 1, unit: 'W', name: 'String 2 Leistung (15-min)' },
    { id: 'history.dc3.voltage', col: COL.DC3_U, factor: 1, unit: 'V', name: 'String 3 Spannung (15-min)' },
    { id: 'history.dc3.current', col: COL.DC3_I, factor: 0.001, unit: 'A', name: 'String 3 Strom (15-min)' },
    { id: 'history.dc3.power', col: COL.DC3_P, factor: 1, unit: 'W', name: 'String 3 Leistung (15-min)' },
    { id: 'history.ac1.voltage', col: COL.AC1_U, factor: 1, unit: 'V', name: 'L1 Spannung (15-min)' },
    { id: 'history.ac1.current', col: COL.AC1_I, factor: 0.001, unit: 'A', name: 'L1 Strom (15-min)' },
    { id: 'history.ac1.power', col: COL.AC1_P, factor: 1, unit: 'W', name: 'L1 Leistung (15-min)' },
    { id: 'history.ac2.voltage', col: COL.AC2_U, factor: 1, unit: 'V', name: 'L2 Spannung (15-min)' },
    { id: 'history.ac2.current', col: COL.AC2_I, factor: 0.001, unit: 'A', name: 'L2 Strom (15-min)' },
    { id: 'history.ac2.power', col: COL.AC2_P, factor: 1, unit: 'W', name: 'L2 Leistung (15-min)' },
    { id: 'history.ac3.voltage', col: COL.AC3_U, factor: 1, unit: 'V', name: 'L3 Spannung (15-min)' },
    { id: 'history.ac3.current', col: COL.AC3_I, factor: 0.001, unit: 'A', name: 'L3 Strom (15-min)' },
    { id: 'history.ac3.power', col: COL.AC3_P, factor: 1, unit: 'W', name: 'L3 Leistung (15-min)' },
    { id: 'history.ac.totalPower', col: null, factor: 1, unit: 'W', name: 'AC Gesamtleistung (15-min)' },
    { id: 'history.dc.totalPower', col: null, factor: 1, unit: 'W', name: 'DC Gesamtleistung (15-min)' },
    { id: 'history.efficiency.ratio', col: null, factor: 1, unit: '%', name: 'Wirkungsgrad DC\u2192AC (15-min)' },
    { id: 'history.ac.frequency', col: COL.AC_F, factor: 1, unit: 'Hz', name: 'Netzfrequenz (15-min)' },
    { id: 'history.acStatus', col: COL.AC_S, factor: 1, unit: '', name: 'Betriebsstatus-Code (15-min)' },
    { id: 'history.errorCode', col: COL.ERR, factor: 1, unit: '', name: 'Fehlercode (15-min)' },
    {
        id: 'history.energy.total',
        col: COL.TOTAL_E,
        factor: 1,
        unit: 'kWh',
        name: 'Gesamtenergie-Z\u00e4hler (15-min)',
    },
];

// Live-States die bei aktiviertem InfluxDB-Sync mitgeschrieben werden
const LIVE_INFLUX_STATES = [
    'ac.power',
    'energy.today',
    'energy.total',
    'ac.l1.voltage',
    'ac.l1.power',
    'ac.l2.voltage',
    'ac.l2.power',
    'ac.l3.voltage',
    'ac.l3.power',
    'pv.string1.voltage',
    'pv.string1.current',
    'pv.string2.voltage',
    'pv.string2.current',
    'pv.string3.voltage',
    'pv.string3.current',
    'dc.totalPower',
    'efficiency.ratio',
    'efficiency.expected',
    'string1.tempEquivalentC',
    'string2.tempEquivalentC',
    'string3.tempEquivalentC',
    'string1.tempLossW',
    'string2.tempLossW',
    'temperature.totalLossW',
    'weather.sunshineHours',
    'weather.tempMax',
    'weather.cloudCover',
    'weather.precipitation',
];

// Typische Modul-Vorlagen (Solarworld 225 Wp, ~2010)
const VMPP_VOC_RATIO = 29.5 / 36.8; // typisch poly 225 Wp
const DEFAULT_BETA_VMPP = 0.0045;

// ─── Vmpp-basierte Modultemperatur (siehe docs/KonzeptPikoTemperatur.md) ───────
function calcStringTemp(vString, nMod, vmppStc, betaVmpp) {
    if (!vString || !nMod) {
        return null;
    }
    const vmpp = vmppStc || 29.5;
    const beta = Math.abs(betaVmpp || DEFAULT_BETA_VMPP);
    const vmppMod = vString / nMod;
    return Math.round((25 + (vmpp - vmppMod) / (vmpp * beta)) * 10) / 10;
}

function calcTempUncertainty(nMod, vmppStc, betaVmpp) {
    const vmpp = vmppStc || 29.5;
    const beta = Math.abs(betaVmpp || DEFAULT_BETA_VMPP);
    const sigmaV = 1 / nMod;
    const sigmaBeta = 0.0002;
    const sigmaVstc = vmpp * 0.005;
    const s1 = Math.pow(sigmaV / (vmpp * beta), 2);
    const s2 = Math.pow(sigmaBeta / (beta * beta), 2);
    const s3 = Math.pow(sigmaVstc / (vmpp * beta), 2);
    return Math.round(Math.sqrt(s1 + s2 + s3) * 10) / 10;
}

function isTempValidRelative(iString, imppString) {
    return iString > 0 && imppString > 0 && iString / imppString > 0.1;
}

function isTempValidAbsolute(iString, imppString, tEquiv, tAmbient) {
    const gSufficient = imppString > 0 && iString / imppString > 0.45;
    const physPlaus = tAmbient != null ? tEquiv > tAmbient : true;
    return gSufficient && physPlaus;
}

/** Qualitätsstufe für Anzeige: absolute | limited | invalid */
function getTempQuality(tempC, iString, imppString, pMeasured, tAmbient, validAbs, validRel, mppUtil) {
    if (tempC === null || iString < 0.05) {
        return 'invalid';
    }

    const coolModule = mppUtil != null && mppUtil >= 97; // Vmpp ≥ STC → Module kühl
    const iFrac = imppString > 0 ? iString / imppString : 0;
    const hasSignal =
        pMeasured >= 50 || (pMeasured >= 15 && iString >= 0.1) || (coolModule && pMeasured >= 10 && iString >= 0.05);

    if (!hasSignal) {
        return 'invalid';
    }

    // Low-G-Artefakt: nur bei warmen Strings (Vmpp unter STC) + wenig Strom
    const lowGArtifact = !coolModule && tAmbient != null && tempC < tAmbient - 2 && iFrac < 0.25;
    if (lowGArtifact) {
        return 'invalid';
    }

    if (validAbs) {
        return 'absolute';
    }
    // Kühle Module (5.5-Dach): T < T_Luft ist plausibel → eingeschränkt anzeigen
    if (pMeasured >= 50 || validRel || coolModule) {
        return 'limited';
    }
    return 'invalid';
}

function calcTempLoss(pMeasured, tMod, betaPmax) {
    if (!tMod || tMod <= 25 || !pMeasured) {
        return 0;
    }
    return Math.round(pMeasured * (betaPmax || DEFAULT_BETA_VMPP) * (tMod - 25));
}

function calcMppUtilization(vString, nMod, vmppStc) {
    if (!vString || !nMod || !vmppStc) {
        return null;
    }
    return Math.round((vString / nMod / vmppStc) * 1000) / 10;
}

function getTempAlert(tMod) {
    if (tMod === null || tMod === undefined) {
        return 'UNBEKANNT';
    }
    if (tMod < 35) {
        return 'NORMAL';
    }
    if (tMod < 50) {
        return 'WARM';
    }
    if (tMod < 60) {
        return 'HEISS';
    }
    if (tMod < 70) {
        return 'WARNUNG';
    }
    return 'KRITISCH';
}

const TEMP_ALERT_RANK = { UNBEKANNT: -1, NORMAL: 0, WARM: 1, HEISS: 2, WARNUNG: 3, KRITISCH: 4 };

// Kostal PIKO Grenzwerte laut Datenblatt (PIKO 4.2–10.1)
const PIKO_SPECS = {
    'piko3.0': {
        name: 'PIKO 3.0',
        strings: 1,
        dcMaxV: 950,
        dcMinV: 180,
        dcMaxA: 9,
        mppMin2: 500,
        mppMax: 850,
        udcNom: 680,
        pacNom: 3000,
    },
    'piko3.6': {
        name: 'PIKO 3.6',
        strings: 2,
        dcMaxV: 950,
        dcMinV: 180,
        dcMaxA: 9,
        mppMin2: 360,
        mppMax: 850,
        udcNom: 680,
        pacNom: 3600,
    },
    'piko4.2': {
        name: 'PIKO 4.2',
        strings: 2,
        dcMaxV: 950,
        dcMinV: 180,
        dcMaxA: 9,
        mppMin2: 360,
        mppMax: 850,
        udcNom: 680,
        pacNom: 4200,
    },
    'piko5.5': {
        name: 'PIKO 5.5',
        strings: 3,
        dcMaxV: 950,
        dcMinV: 180,
        dcMaxA: 9,
        mppMin1: 660,
        mppMin2: 360,
        mppMax: 850,
        udcNom: 680,
        pacNom: 5500,
    },
    'piko7.0': {
        name: 'PIKO 7.0',
        strings: 2,
        dcMaxV: 950,
        dcMinV: 180,
        dcMaxA: 12.5,
        mppMin2: 400,
        mppMax: 850,
        udcNom: 680,
        pacNom: 7000,
    },
    'piko8.3': {
        name: 'PIKO 8.3',
        strings: 2,
        dcMaxV: 950,
        dcMinV: 180,
        dcMaxA: 12.5,
        mppMin2: 400,
        mppMax: 850,
        udcNom: 680,
        pacNom: 8300,
    },
    'piko10.1': {
        name: 'PIKO 10.1',
        strings: 3,
        dcMaxV: 950,
        dcMinV: 180,
        dcMaxA: 12.5,
        mppMin2: 420,
        mppMax: 850,
        udcNom: 680,
        pacNom: 10000,
    },
};
const GRID_LIMITS_DE = { acMaxV: 264.5, acMinV: 184, fMax: 51.5, fMin: 47.5 };

// Kostal PIKO Ereignis-/Fehlercodes (LogDaten Spalte Err, dezimal)
const PIKO_ERROR_HINTS = {
    0: 'Kein Fehler',
    240: 'Netzstörung – Netzspannung kurzzeitig außerhalb des zulässigen Bereichs (häufig morgens/abends oder bei Wolken; bei Wiederholung Netzbetreiber/AC-Verkabelung prüfen)',
    241: 'Netzunterspannung',
    242: 'Netzüberspannung',
    243: 'Netzunterfrequenz',
    244: 'Netzüberfrequenz',
    301: 'Isolationsfehler',
    302: 'Isolationsfehler (String)',
    401: 'Übertemperatur',
    402: 'Interne Kommunikationsstörung',
};

// ─── Adapter-Klasse ────────────────────────────────────────────────────────────
class KostalPikoAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: ADAPTER_NAME });
        this._pollTimer = null;
        this._webServer = null;
        this._logBuffer = [];
        this._maxLogs = 500;
        this._lastData = {};
        this._lastHistoryRows = [];
        this._lastNotifySent = {}; // pro Berichtstyp, verhindert doppeltes Senden
        this._nodes = {};
        this._pikoEpoch = null; // Unix-Sekunden (Geräteinbetriebnahme)
        this._lastImportedTs = 0; // ms - zuletzt importierter Timestamp
        this._lastImportIso = null; // ISO-Zeitpunkt des letzten History-Imports
        this._lastHistoryFetch = 0;
        this._lastStaleHistoryFetch = 0;
        this._historyCachePath = null;
        this._yieldsCachePath = null;
        this._monthlyYields = null;
        this._lastWeather = null;
        this._lastWeatherFetch = 0;
        this._weatherGeoCache = null;
        this._weatherHistoryCache = new Map();
        this._historyApiCache = null;
        this._historySyncActive = false;
        this._instanceDisplayName = '';
        this._tempLossKwhDay = 0;
        this._tempLossDayDate = '';

        this.on('ready', this._onReady.bind(this));
        this.on('stateChange', this._onStateChange.bind(this));
        this.on('message', this._onMessage.bind(this));
        this.on('unload', this._onUnload.bind(this));
    }

    // ─── Lifecycle ──────────────────────────────────────────────────────────────

    async _onReady() {
        this._log('SYSTEM', `Kostal PIKO Adapter v${ADAPTER_VERSION} gestartet`);

        this._cfg = {
            ip: (this.config.ip || '192.168.178.30').trim(),
            port: parseInt(this.config.port) || 80,
            user: (this.config.user || 'pvserver').trim(),
            password: (this.config.password || 'pvwr').trim(),
            pollInterval: parseInt(this.config.pollInterval) || 30,
            webPort: parseInt(this.config.webPort) || 8092,
            verbose: !!this.config.verbose,
            historyFetch: !!this.config.historyFetch,
            influxSync: !!this.config.influxSync, // InfluxDB-Sync separat
            syncInterval: parseInt(this.config.syncInterval || this.config.historyInterval) || 15,
            influxInstance: (this.config.influxInstance || 'influxdb.0').trim(),
            // influxEnable = nur wenn BEIDE aktiviert sind
            influxEnable: !!this.config.historyFetch && !!this.config.influxSync,
            // Netzwerk-Modus: 'local' = direkt, 'fritzwireguard' = via WireGuard-Tunnel
            networkMode: (this.config.networkMode || 'local').trim(),
            fritzwgInstance: (this.config.fritzwgInstance || 'fritzwireguard.0').trim(),
            // State-ID des Verbindungsstatus im fritzwireguard-Adapter
            // Typisch: fritzwireguard.0.info.connection oder fritzwireguard.0.connected
            fritzwgConnectedState: (this.config.fritzwgConnectedState || '').trim(),
            // Modell-Override: 'auto' = aus HTML lesen, sonst z.B. 'piko5.5'
            pikoModel: (this.config.pikoModel || 'auto').trim(),
            // Benachrichtigungen
            notifyEnabled: !!this.config.notifyEnabled,
            notifyInstance: (this.config.notifyInstanceEmail || this.config.notifyInstance || 'email.0').trim(),
            reportLabel: (this.config.reportLabel || '').trim(),
            notifyRecipient: (this.config.notifyRecipient || '').trim(),
            notifyRecipientWeekly: (this.config.notifyRecipientWeekly || '').trim(),
            notifyRecipientMonthly: (this.config.notifyRecipientMonthly || '').trim(),
            notifyDaily: !!this.config.notifyDaily,
            notifyDailyTime: (this.config.notifyDailyTime || '07:00').trim(),
            notifyWeekly: !!this.config.notifyWeekly,
            notifyWeeklyTime: (this.config.notifyWeeklyTime || '07:00').trim(),
            notifyMonthly: !!this.config.notifyMonthly,
            notifyMonthlyTime: (this.config.notifyMonthlyTime || '07:00').trim(),
            notifyAlert: !!this.config.notifyAlert,
            notifyAlertTime: (this.config.notifyAlertTime || '07:00').trim(),
            notifyThresholdKwh: parseFloat(this.config.notifyThresholdKwh) || 0,
            // Modul-Konfiguration (optional, für String-Analyse)
            moduleWp: parseFloat(this.config.moduleWp) || 0,
            moduleVoc: parseFloat(this.config.moduleVoc) || 0,
            moduleVmpp: parseFloat(this.config.moduleVmpp) || 0,
            modulePreset: (this.config.modulePreset || '').trim(),
            moduleManualOverride: !!this.config.moduleManualOverride,
            moduleNoctEff: parseFloat(this.config.moduleNoctEff) || 0,
            string1Modules: parseInt(this.config.string1Modules) || 0,
            string2Modules: parseInt(this.config.string2Modules) || 0,
            string3Modules: parseInt(this.config.string3Modules) || 0,
            yieldFeedInTariff: parseFloat(this.config.yieldFeedInTariff) || 0.3925,
            yieldInstalledKwp: parseFloat(this.config.yieldInstalledKwp) || 0,
            yieldPlz: (() => {
                const plz = String(this.config.yieldPlz || '').trim();
                const legacy = String(this.config.yieldPlzRegion || '').trim();
                if (/^\d{5}$/.test(plz)) {
                    return plz;
                }
                if (/^\d{5}$/.test(legacy)) {
                    return legacy;
                }
                return plz || legacy || '87781';
            })(),
        };

        const networkInfo =
            this._cfg.networkMode === 'fritzwireguard'
                ? `Via ${this._cfg.fritzwgInstance} (WireGuard)`
                : 'Lokal (direkter Zugriff)';
        this._log('SYSTEM', `Auth: user=${this._cfg.user}, password=${this._cfg.password ? 'gesetzt' : 'LEER!'}`);
        this._log(
            'SYSTEM',
            `Ziel: http://${this._cfg.ip}:${this._cfg.port} | ` +
                `Netzwerk: ${networkInfo} | ` +
                `Poll: ${this._cfg.pollInterval}s | ` +
                `Sync: ${this._cfg.historyFetch ? `alle ${this._cfg.syncInterval} min${this._cfg.influxEnable ? ` → ${this._cfg.influxInstance}` : ' (nur Web-UI, kein InfluxDB)'}` : 'deaktiviert'}`,
        );

        await this._ensureBaseStates();
        await this._ensureHistoryStates();
        await this._ensureYieldStates();
        await this._syncModulePresetConfig();
        this._historyCachePath = this._getHistoryCachePath();
        this._yieldsCachePath = this._getYieldsCachePath();
        await this._migrateLegacyDataFiles();
        await this._loadHistoryCache();
        await this._loadMonthlyYields();

        await this._loadInstanceDisplayName();

        // Letzten importierten Timestamp aus State laden
        try {
            const st = await this.getStateAsync('history.lastImportedTs');
            if (st && st.val) {
                this._lastImportedTs = parseInt(st.val) || 0;
                this._log('INFO', `History-Cursor: ${new Date(this._lastImportedTs).toISOString()}`);
            }
            const stLi = await this.getStateAsync('history.lastImport');
            if (stLi && stLi.val) {
                this._lastImportIso = stLi.val;
            }
        } catch (_) {}

        this._startWebServer();

        // Polls dürfen nicht sofort einen zweiten LogDaten-Download starten
        if (this._cfg.historyFetch) {
            this._lastHistoryFetch = Date.now();
        }
        await this._poll();
        this._pollTimer = this.setInterval(() => this._poll(), this._cfg.pollInterval * 1000);
        this._refreshWeather().catch(e => this._log('DEBUG', `Wetter: ${e.message}`));

        if (this._cfg.historyFetch) {
            this.setTimeout(() => {
                this._fetchAndImportHistory(false).catch(e => this._log('WARN', `Startup History-Fetch: ${e.message}`));
            }, 5000);
        }

        // Benachrichtigungs-Timer
        if (this._cfg.notifyEnabled) {
            if (!this._cfg.historyFetch) {
                this._log(
                    'WARN',
                    'Benachrichtigungen aktiv, aber Historiendaten laden ist deaktiviert – Berichte haben keine Daten',
                );
            }
            this._logNotifyConfig();
            this._startNotifyTimer();
        }
    }

    _logNotifyConfig() {
        const inst = this._cfg.notifyInstance;
        const dailyRcpt = this._getRecipientsForReport('daily');
        this._log(
            'SYSTEM',
            `Berichte: E-Mail via ${inst || '(nicht gesetzt!)'} → ${dailyRcpt.join(', ') || '(kein Empfänger!)'}`,
        );
        if (this.config.notifyAdapter || (this.config.notifyInstance && this.config.notifyInstance !== inst)) {
            this._log(
                'INFO',
                'Legacy-Felder notifyAdapter/notifyInstance in der Instanz-Konfiguration werden ignoriert (nur notifyInstanceEmail)',
            );
        }
        if (!inst) {
            this._log('WARN', 'E-Mail-Instanz fehlt – bitte „E-Mail-Instanz“ in Admin setzen (z. B. email.0)');
        }
        if (!dailyRcpt.length) {
            this._log('WARN', 'Kein Empfänger für Tagesbericht – bitte „Empfänger (Hauptadresse)“ setzen');
        }
        const parts = [];
        if (this._cfg.notifyDaily) {
            parts.push(`Tagesbericht ${this._cfg.notifyDailyTime}`);
        }
        if (this._cfg.notifyWeekly) {
            parts.push(`Wochenbericht Mo ${this._cfg.notifyWeeklyTime}`);
        }
        if (this._cfg.notifyMonthly) {
            parts.push(`Monatsbericht 1. ${this._cfg.notifyMonthlyTime}`);
        }
        if (this._cfg.notifyAlert) {
            parts.push(`Alarm ${this._cfg.notifyAlertTime}`);
        }
        if (parts.length) {
            this._log('SYSTEM', `Zeitplan: ${parts.join(' · ')}`);
        }
    }

    _onStateChange(id, state) {
        if (state && !state.ack && this._cfg.verbose) {
            this._log('DEBUG', `State geändert: ${id} = ${state.val}`);
        }
    }

    // ─── Admin-Nachrichten (Verbindungstest) ────────────────────────────────────

    _resolveMessageCommand(obj) {
        let cmd = obj.command;
        if (cmd === 'send') {
            if (typeof obj.message === 'string') {
                return obj.message;
            }
            if (obj.message && typeof obj.message === 'object' && obj.message.command) {
                return obj.message.command;
            }
        }
        return cmd;
    }

    _onMessage(obj) {
        if (!obj) {
            return;
        }
        const cmd = this._resolveMessageCommand(obj);

        if (cmd === 'testReportDaily' || cmd === 'testReportWeekly' || cmd === 'testReportMonthly') {
            const kind = cmd.replace('testReport', '').toLowerCase();
            const reply = (result, error) => {
                this.sendTo(obj.from, cmd, { result, error }, obj.callback);
            };
            this._log(
                'INFO',
                `Test-${kind === 'daily' ? 'Tages' : kind === 'weekly' ? 'Wochen' : 'Monats'}bericht angefordert`,
            );
            if (!this._cfg.notifyEnabled) {
                reply(null, 'Benachrichtigungen sind deaktiviert – bitte zuerst aktivieren und speichern.');
                return;
            }
            if (!this._cfg.notifyInstance) {
                reply(null, 'Kein Benachrichtigungs-Adapter konfiguriert.');
                return;
            }
            const recipients = this._getRecipientsForReport(kind);
            if (!recipients.length) {
                reply(null, 'Kein E-Mail-Empfänger eingetragen.');
                return;
            }
            const sendFn =
                kind === 'daily'
                    ? () => this._sendDailyReport({ test: true })
                    : kind === 'weekly'
                      ? () => this._sendWeeklyReport({ test: true })
                      : () => this._sendMonthlyReport({ test: true });
            sendFn()
                .then(() =>
                    reply(
                        `✅ Test-${kind === 'daily' ? 'Tages' : kind === 'weekly' ? 'Wochen' : 'Monats'}bericht gesendet`,
                        null,
                    ),
                )
                .catch(e => reply(null, `❌ ${e.message}`));
            return;
        }

        if (cmd === 'applyModulePreset') {
            const presetId = (obj.message?.preset || this._cfg.modulePreset || '').trim();
            const preset = MODULE_PRESETS[presetId];
            if (!preset) {
                this.sendTo(obj.from, cmd, { error: 'Keine Modul-Vorlage gewählt.' }, obj.callback);
                return;
            }
            this._applyModulePresetToInstance(presetId, preset)
                .then(() =>
                    this.sendTo(
                        obj.from,
                        cmd,
                        {
                            result: `✅ ${preset.name}: ${preset.wp} Wp, Voc ${preset.voc} V, Vmpp ${preset.vmpp} V übernommen`,
                        },
                        obj.callback,
                    ),
                )
                .catch(e => this.sendTo(obj.from, cmd, { error: e.message }, obj.callback));
            return;
        }

        if (cmd === 'getModulePresetInfo') {
            const presetId = (obj.message?.preset || this._cfg.modulePreset || '').trim();
            const preset = MODULE_PRESETS[presetId];
            this.sendTo(
                obj.from,
                cmd,
                {
                    preset: presetId,
                    summary: preset
                        ? `${preset.wp} Wp · Voc ${preset.voc} V · Vmpp ${preset.vmpp} V · Impp ${preset.impp} A · β ${(preset.betaPmax * 100).toFixed(2)} %/K · NOCT ${preset.noct} °C`
                        : '',
                    fields: getModulePresetFields(presetId),
                },
                obj.callback,
            );
            return;
        }

        if (cmd !== 'test') {
            return;
        }
        const { ip, port, user, password } = obj.message || {};
        const testIp = (ip || this._cfg.ip).trim();
        const testPort = parseInt(port) || this._cfg.port;
        const testUser = (user || this._cfg.user).trim();
        const testPass = (password || this._cfg.password).trim();

        const http = require('node:http');
        const auth = Buffer.from(`${testUser}:${testPass}`).toString('base64');
        const req = http.request(
            {
                hostname: testIp,
                port: testPort,
                path: '/index.fhtml',
                method: 'GET',
                headers: { Authorization: `Basic ${auth}` },
                timeout: 5000,
            },
            res => {
                let data = '';
                res.setEncoding('latin1');
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    const ok = res.statusCode === 200 && data.includes('PIKO');
                    this.sendTo(
                        obj.from,
                        obj.command,
                        {
                            result: ok
                                ? `✅ Verbindung OK – PIKO gefunden (HTTP ${res.statusCode})`
                                : `⚠️ HTTP ${res.statusCode} – PIKO nicht erkannt`,
                            error: ok ? null : 'Gerät antwortet aber kein PIKO erkannt',
                        },
                        obj.callback,
                    );
                });
            },
        );
        req.on('error', e => {
            this.sendTo(
                obj.from,
                obj.command,
                {
                    result: null,
                    error: `❌ Verbindung fehlgeschlagen: ${e.message}`,
                },
                obj.callback,
            );
        });
        req.on('timeout', () => {
            req.destroy();
            this.sendTo(
                obj.from,
                obj.command,
                {
                    result: null,
                    error: '❌ Timeout – Gerät nicht erreichbar (5s)',
                },
                obj.callback,
            );
        });
        req.end();
    }

    _onUnload(callback) {
        try {
            if (this._pollTimer) {
                this.clearInterval(this._pollTimer);
            }
            if (this._notifyTimer) {
                this.clearInterval(this._notifyTimer);
            }
            if (this._webServer) {
                this._webServer.close();
            }
        } catch (_) {}
        callback();
    }

    // ─── Netzwerk-Verfügbarkeit prüfen (fritzwireguard) ────────────────────────

    async _checkNetwork() {
        if (this._cfg.networkMode !== 'fritzwireguard') {
            return true;
        }

        const stateId = this._cfg.fritzwgConnectedState || `${this._cfg.fritzwgInstance}.info.connection`;
        try {
            const st = await this.getForeignStateAsync(stateId);
            if (!st || !st.val) {
                this._log(
                    'WARN',
                    `WireGuard-Tunnel nicht aktiv (${stateId} = ${st ? st.val : 'null'}) → Poll übersprungen`,
                );
                return false;
            }
            if (this._cfg.verbose) {
                this._log('DEBUG', `WireGuard-Tunnel aktiv (${stateId} = true) → Poll via Tunnel`);
            }
            return true;
        } catch (e) {
            this._log(
                'WARN',
                `WireGuard-Status konnte nicht gelesen werden (${stateId}): ${e.message} → Poll übersprungen`,
            );
            return false;
        }
    }

    _getTodayHistoryMeta() {
        const rows = this._lastHistoryRows;
        if (!rows.length) {
            return { todayNewest: null, todayStale: false, ageMin: null };
        }
        const today = this._berlinDateKey();
        const todayRows = rows.filter(r => this._berlinDateKey(r.ts) === today);
        if (!todayRows.length) {
            return { todayNewest: null, todayStale: false, ageMin: null };
        }
        const newestTs = Math.max(...todayRows.map(r => r.ts));
        const ageMin = Math.round((Date.now() - newestTs) / 60000);
        const hour = parseInt(
            new Intl.DateTimeFormat('en', {
                timeZone: 'Europe/Berlin',
                hour: 'numeric',
                hour12: false,
            }).format(new Date()),
            10,
        );
        const livePower = parseFloat(this._lastData['ac.power']) || 0;
        const producing = livePower >= 50;
        const daylight = hour >= 5 && hour <= 22;
        const todayStale = daylight && ageMin >= 20 && (producing || ageMin >= 35);
        return {
            todayNewest: new Date(newestTs).toISOString(),
            todayStale,
            ageMin,
        };
    }

    // ─── Polling-Hauptschleife ───────────────────────────────────────────────────

    async _poll() {
        // 0. Netzwerk-Check (nur bei fritzwireguard-Modus)
        if (!(await this._checkNetwork())) {
            await this.setStateAsync('info.connection', { val: false, ack: true }).catch(() => {});
            return;
        }

        // 1. Live-Daten – nicht parallel zum LogDaten-Download (PIKO bedient nur eine HTTP-Verbindung)
        if (this._historyLoading) {
            if (this._cfg.verbose) {
                this._log('DEBUG', 'Live-Poll übersprungen – History-Download läuft');
            }
            return;
        }
        try {
            // Sequentiell: zwei parallele Requests erzeugen oft "service busy"
            const mainHtml = await this._fetchPage(POLL_URLS.main);
            const infoHtml = await this._fetchPage(POLL_URLS.info);
            await this._writeStates({
                ...this._parseMainPage(mainHtml),
                ...this._parseInfoPage(infoHtml),
            });
            await this.setStateAsync('info.connection', { val: true, ack: true });
            await this.setStateAsync('info.lastPoll', { val: new Date().toISOString(), ack: true });
            await this.setStateAsync('info.networkMode', { val: this._cfg.networkMode, ack: true });
            await this._writeModuleStates();
            if (this._cfg.verbose) {
                this._log('DEBUG', 'Live-Poll OK');
            }
        } catch (err) {
            this._log('ERROR', `Live-Poll: ${err.message}`);
            await this.setStateAsync('info.connection', { val: false, ack: true }).catch(() => {});
        }

        // 2. History-Sync (syncInterval) + Nachhol-Abruf wenn Tagesdaten hängen bleiben
        // 3–5s Verzögerung damit PIKO nach dem Live-Poll wieder frei ist
        if (this._cfg.historyFetch && !this._historySyncActive) {
            const now = Date.now();
            const intervalMs = this._cfg.syncInterval * 60 * 1000;
            const todayMeta = this._getTodayHistoryMeta();
            const intervalDue = now - this._lastHistoryFetch >= intervalMs;
            const staleDue =
                todayMeta.todayStale && !this._historyLoading && now - this._lastStaleHistoryFetch >= 5 * 60 * 1000;
            if (intervalDue || staleDue) {
                if (intervalDue) {
                    this._lastHistoryFetch = now;
                }
                if (staleDue) {
                    this._lastStaleHistoryFetch = now;
                    this._log('INFO', `Tages-Historie hängt (${todayMeta.ageMin} Min seit letztem Punkt) → PIKO-Abruf`);
                }
                this.setTimeout(
                    () => {
                        this._fetchAndImportHistory(false).catch(e => this._log('WARN', `History-Sync: ${e.message}`));
                    },
                    staleDue ? 5000 : 3000,
                );
            }
        }

        // 3. Wetter (alle 30 Minuten, wenn PLZ gesetzt)
        if (this._cfg.yieldPlz && Date.now() - this._lastWeatherFetch >= 30 * 60 * 1000) {
            this._refreshWeather().catch(e => {
                if (this._cfg.verbose) {
                    this._log('DEBUG', `Wetter: ${e.message}`);
                }
            });
        }
    }

    // ─── Wetter / Sonnenerwartung (Open-Meteo) ───────────────────────────────────

    _fetchHttpsJson(reqUrl, timeoutMs = 12000) {
        return new Promise((resolve, reject) => {
            const req = https.get(reqUrl, { timeout: timeoutMs }, res => {
                let data = '';
                res.on('data', c => {
                    data += c;
                });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`HTTP ${res.statusCode}`));
                    }
                    try {
                        resolve(JSON.parse(data));
                    } catch (_e) {
                        reject(new Error('JSON ungültig'));
                    }
                });
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
            req.on('error', reject);
        });
    }

    _berlinDateKey(ts = Date.now()) {
        return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    }

    _weatherLabelFromMetrics(cloudPct, sunshineH, weatherCode) {
        if (cloudPct != null) {
            if (cloudPct <= 15) {
                return 'Sonnig';
            }
            if (cloudPct <= 35) {
                return 'Überwiegend sonnig';
            }
            if (cloudPct <= 60) {
                return 'Teilweise bewölkt';
            }
            if (cloudPct <= 85) {
                return 'Bewölkt';
            }
            return 'Stark bewölkt';
        }
        if (sunshineH != null && sunshineH >= 10) {
            return 'Sonnig';
        }
        return weatherCode != null ? this._wmoLabel(weatherCode) : null;
    }

    _wmoLabel(code) {
        const labels = {
            0: 'Klar',
            1: 'Überwiegend klar',
            2: 'Teilweise bewölkt',
            3: 'Bewölkt',
            45: 'Neblig',
            48: 'Neblig',
            51: 'Leichter Nieselregen',
            53: 'Nieselregen',
            55: 'Starker Nieselregen',
            61: 'Leichter Regen',
            63: 'Regen',
            65: 'Starker Regen',
            71: 'Leichter Schneefall',
            73: 'Schneefall',
            75: 'Starker Schneefall',
            80: 'Regenschauer',
            81: 'Regenschauer',
            82: 'Starke Regenschauer',
            95: 'Gewitter',
            96: 'Gewitter mit Hagel',
            99: 'Gewitter mit Hagel',
        };
        return labels[code] || `Wettercode ${code}`;
    }

    async _geocodePlz(plz) {
        if (this._weatherGeoCache && this._weatherGeoCache.plz === plz) {
            return this._weatherGeoCache;
        }
        const zip = await this._fetchHttpsJson(`https://api.zippopotam.us/de/${plz}`);
        const place = zip.places && zip.places[0];
        if (!place) {
            throw new Error(`PLZ ${plz} nicht gefunden`);
        }
        const geo = {
            plz,
            lat: parseFloat(place.latitude),
            lon: parseFloat(place.longitude),
            place: `${place['place name']}`,
            state: place.state || '',
        };
        this._weatherGeoCache = geo;
        return geo;
    }

    _isPrecipWeatherCode(code) {
        if (code == null) {
            return false;
        }
        return (code >= 51 && code <= 67) || (code >= 71 && code <= 77) || (code >= 80 && code <= 82) || code >= 95;
    }

    _sumHourlyPrecipToday(times, values, todayBerlin, onlyElapsed = false) {
        if (!times.length || !values.length) {
            return 0;
        }
        const now = Date.now();
        let sum = 0;
        times.forEach((t, i) => {
            if (!t.startsWith(todayBerlin) || values[i] == null) {
                return;
            }
            if (onlyElapsed && new Date(t).getTime() > now) {
                return;
            }
            sum += values[i];
        });
        return sum;
    }

    _formatPrecipMm(mm) {
        if (mm == null || isNaN(mm)) {
            return null;
        }
        return Math.round(mm * 10) / 10;
    }

    async _loadInstanceDisplayName() {
        try {
            const obj = await this.getObjectAsync(`system.adapter.${this.namespace}`);
            const title = (obj?.common?.title || '').trim();
            if (title && title !== 'Kostal PIKO' && title.length <= 40) {
                this._instanceDisplayName = title;
                return;
            }
            const tl = obj?.common?.titleLang;
            let raw = typeof tl === 'string' ? tl : tl?.de || tl?.en || '';
            raw = raw
                .replace(/^Kostal\s+PIKO\s*/i, '')
                .replace(/\s*Wechselrichter.*/i, '')
                .trim();
            if (raw) {
                this._instanceDisplayName = raw;
            }
        } catch (_) {}
    }

    _getReportSubjectTag() {
        const model =
            this._lastData['device.model'] ||
            PIKO_SPECS[this._cfg.pikoModel]?.name ||
            (this._cfg.pikoModel !== 'auto' ? this._cfg.pikoModel : 'PIKO');
        const label = (this._cfg.reportLabel || this._instanceDisplayName || '').trim();
        if (label) {
            return `${model} · ${label} – `;
        }
        return `${model} – `;
    }

    _explainErrorCode(code) {
        return PIKO_ERROR_HINTS[code] || `Ereigniscode ${code} (Details: Kostal PIKO Dokumentation)`;
    }

    _formatErrorCodesHtml(codes) {
        if (!codes?.length) {
            return '';
        }
        const items = codes
            .map(c => `<li><strong>${c}</strong>: ${this._escHtml(this._explainErrorCode(c))}</li>`)
            .join('');
        return (
            `<p class="warn" style="margin:8px 0 4px;">⚠️ Fehlercodes im Tagesverlauf</p>` +
            `<ul style="margin:0 0 12px 18px;padding:0;font-size:10px;">${items}</ul>`
        );
    }

    _formatErrorCodesText(codes) {
        if (!codes?.length) {
            return '';
        }
        return codes.map(c => `⚠️ ${c}: ${this._explainErrorCode(c)}`).join('\n');
    }

    _tdCell(content, num = false) {
        const style = num
            ? 'border-bottom:1px solid #e0e0e0;padding:4px 6px;text-align:right;'
            : 'border-bottom:1px solid #e0e0e0;padding:4px 6px;';
        return `<td style="${style}">${content}</td>`;
    }

    _thCell(label, num = false) {
        const align = num ? 'right' : 'left';
        return `<th style="background:#1565c0;color:#fff;padding:5px 6px;text-align:${align};">${this._escHtml(label)}</th>`;
    }

    _reportTableOpen() {
        return '<table style="width:100%;border-collapse:collapse;font-size:10px;margin:8px 0;" cellpadding="0" cellspacing="0">';
    }

    _weatherFromArchiveDay(data, geo, dateKey) {
        const sunshineSec = data.daily?.sunshine_duration?.[0];
        const weatherCode = data.daily?.weather_code?.[0];
        const tempMax = data.daily?.temperature_2m_max?.[0];
        const dailyPrecip = Math.max(data.daily?.precipitation_sum?.[0] ?? 0, data.daily?.rain_sum?.[0] ?? 0);

        const times = data.hourly?.time || [];
        const clouds = data.hourly?.cloud_cover || [];
        let cloudAvg = null;
        if (times.length && clouds.length) {
            const dayClouds = [];
            times.forEach((t, i) => {
                const h = parseInt(t.substring(11, 13), 10);
                if (t.startsWith(dateKey) && h >= 7 && h <= 19 && clouds[i] != null) {
                    dayClouds.push(clouds[i]);
                }
            });
            if (dayClouds.length) {
                cloudAvg = Math.round(dayClouds.reduce((s, v) => s + v, 0) / dayClouds.length);
            }
        }

        const sunshineH = sunshineSec != null ? Math.round((sunshineSec / 3600) * 10) / 10 : null;
        const weatherLabel =
            this._weatherLabelFromMetrics(cloudAvg, sunshineH, weatherCode) ||
            (weatherCode != null ? this._wmoLabel(weatherCode) : null);

        return {
            plz: geo.plz,
            place: geo.place,
            date: dateKey,
            sunshineH,
            weather: weatherLabel || '–',
            weatherCode,
            tempMax: tempMax != null ? Math.round(tempMax * 10) / 10 : null,
            precipMm: this._formatPrecipMm(dailyPrecip > 0 ? dailyPrecip : 0),
            precipSoFar: null,
            precipCurrent: null,
            precipForecast: null,
            cloudPct: cloudAvg,
            source: 'Open-Meteo Archiv',
            historical: true,
            updatedAt: new Date().toISOString(),
        };
    }

    async _getWeatherForDate(dateKey) {
        if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            return null;
        }
        const today = this._berlinDateKey();
        if (dateKey === today) {
            if (!this._lastWeather || this._lastWeather.date !== today) {
                await this._refreshWeather();
            }
            return this._lastWeather;
        }
        if (this._weatherHistoryCache.has(dateKey)) {
            return this._weatherHistoryCache.get(dateKey);
        }
        const plz = this._cfg.yieldPlz;
        if (!plz || !/^\d{5}$/.test(plz)) {
            return null;
        }
        try {
            const geo = await this._geocodePlz(plz);
            const q = new URLSearchParams({
                latitude: String(geo.lat),
                longitude: String(geo.lon),
                start_date: dateKey,
                end_date: dateKey,
                daily: 'sunshine_duration,weather_code,temperature_2m_max,precipitation_sum,rain_sum',
                hourly: 'cloud_cover,precipitation,rain',
                timezone: 'Europe/Berlin',
            });
            const ar = await this._fetchHttpsJson(`https://archive-api.open-meteo.com/v1/archive?${q}`);
            const w = this._weatherFromArchiveDay(ar, geo, dateKey);
            this._cacheWeatherHistory(dateKey, w);
            return w;
        } catch (e) {
            this._log('DEBUG', `Wetter-Archiv ${dateKey}: ${e.message}`);
            return null;
        }
    }

    _weatherSummaryText(w) {
        if (!w) {
            return '';
        }
        const parts = [
            w.weather && `Bedingungen: ${w.weather}`,
            w.sunshineH != null && `Sonnenschein: ${w.sunshineH} h`,
            w.tempMax != null && `Max-Temp.: ${w.tempMax} °C`,
            w.cloudPct != null && `Bewölkung: ${w.cloudPct} %`,
            w.precipMm != null && w.precipMm > 0 && `Niederschlag: ${w.precipMm} mm`,
        ].filter(Boolean);
        return parts.join(' · ');
    }

    async _refreshWeather() {
        const plz = this._cfg.yieldPlz;
        if (!plz || !/^\d{5}$/.test(plz)) {
            return;
        }

        const geo = await this._geocodePlz(plz);
        const q = new URLSearchParams({
            latitude: String(geo.lat),
            longitude: String(geo.lon),
            daily: 'sunshine_duration,weather_code,temperature_2m_max,precipitation_sum,rain_sum',
            hourly: 'cloud_cover,precipitation,rain,weather_code',
            current: 'precipitation,rain,weather_code',
            timezone: 'Europe/Berlin',
            forecast_days: '1',
        });
        const fc = await this._fetchHttpsJson(`https://api.open-meteo.com/v1/forecast?${q}`);

        const sunshineSec = fc.daily?.sunshine_duration?.[0];
        const weatherCode = fc.daily?.weather_code?.[0];
        const tempMax = fc.daily?.temperature_2m_max?.[0];
        const dailyPrecip = fc.daily?.precipitation_sum?.[0];
        const dailyRain = fc.daily?.rain_sum?.[0];
        const currentCode = fc.current?.weather_code;
        const currentPrecip = fc.current?.precipitation;
        const currentRain = fc.current?.rain;

        const times = fc.hourly?.time || [];
        const clouds = fc.hourly?.cloud_cover || [];
        const hourlyPrecip = fc.hourly?.precipitation || [];
        const hourlyRain = fc.hourly?.rain || [];
        const todayBerlin = this._berlinDateKey();

        let cloudAvg = null;
        if (times.length && clouds.length) {
            const dayClouds = [];
            times.forEach((t, i) => {
                const h = parseInt(t.substring(11, 13), 10);
                if (t.startsWith(todayBerlin) && h >= 7 && h <= 19 && clouds[i] != null) {
                    dayClouds.push(clouds[i]);
                }
            });
            if (dayClouds.length) {
                cloudAvg = Math.round(dayClouds.reduce((s, v) => s + v, 0) / dayClouds.length);
            }
        }

        const precipSoFar = Math.max(
            this._sumHourlyPrecipToday(times, hourlyPrecip, todayBerlin, true),
            this._sumHourlyPrecipToday(times, hourlyRain, todayBerlin, true),
        );
        const precipCurrent = Math.max(currentPrecip ?? 0, currentRain ?? 0);
        const precipForecast = Math.max(dailyPrecip ?? 0, dailyRain ?? 0);

        let precipMm = precipSoFar;
        if (this._isPrecipWeatherCode(currentCode) && precipCurrent > 0) {
            precipMm = Math.max(precipMm, precipSoFar + precipCurrent);
        }
        if (precipMm < 0.05 && precipForecast > 0) {
            precipMm = precipForecast;
        }

        const sunshineH = sunshineSec != null ? Math.round((sunshineSec / 3600) * 10) / 10 : null;
        const labelCode = currentCode != null && this._isPrecipWeatherCode(currentCode) ? currentCode : weatherCode;
        const weatherLabel = this._isPrecipWeatherCode(labelCode)
            ? this._wmoLabel(labelCode)
            : this._weatherLabelFromMetrics(cloudAvg, sunshineH, weatherCode);

        this._lastWeather = {
            plz,
            place: geo.place,
            state: geo.state,
            date: todayBerlin,
            sunshineH,
            weather: weatherLabel,
            weatherCode: labelCode ?? weatherCode,
            tempMax: tempMax != null ? Math.round(tempMax * 10) / 10 : null,
            precipMm: this._formatPrecipMm(precipMm),
            precipSoFar: this._formatPrecipMm(precipSoFar),
            precipCurrent: this._formatPrecipMm(precipCurrent > 0 ? precipCurrent : null),
            precipForecast: this._formatPrecipMm(precipForecast > 0 ? precipForecast : null),
            cloudPct: cloudAvg,
            source: 'Open-Meteo',
            updatedAt: new Date().toISOString(),
        };
        this._lastWeatherFetch = Date.now();
        if (this._cfg.verbose) {
            this._log(
                'DEBUG',
                `Wetter ${plz} ${geo.place}: ${this._lastWeather.sunshineH}h Sonne, ${this._lastWeather.weather}`,
            );
        }
        await this._writeWeatherStates();
    }

    async _writeWeatherStates() {
        const w = this._lastWeather;
        if (!w) {
            return;
        }
        await this._writeStates(
            {
                'weather.sunshineHours': w.sunshineH ?? 0,
                'weather.tempMax': w.tempMax ?? 0,
                'weather.cloudCover': w.cloudPct ?? 0,
                'weather.precipitation': w.precipMm ?? 0,
                'weather.description': w.weather || '',
                'weather.plz': w.plz || '',
                'weather.place': w.place || '',
                'weather.updatedAt': w.updatedAt || '',
            },
            { skipDerived: true },
        );
    }

    _calcTemperatureStates(data) {
        const { wp, voc, vmpp, betaVmpp, betaPmax, impp } = this._getModuleParams();
        if (!voc || !wp || !vmpp) {
            return {};
        }

        const tAmbient = this._lastWeather?.tempMax ?? null;
        const stringCount = this._getStringCount();
        const results = {};
        let totalLossW = 0;
        let hottestId = '';
        let hottestTemp = -Infinity;
        let worstAlert = 'UNBEKANNT';

        for (const s of [
            { id: 1, count: this._cfg.string1Modules },
            { id: 2, count: this._cfg.string2Modules },
            { id: 3, count: this._cfg.string3Modules },
        ]) {
            if (!s.count || s.id > stringCount) {
                continue;
            }

            const v = parseFloat(data[`pv.string${s.id}.voltage`]) || 0;
            const i = parseFloat(data[`pv.string${s.id}.current`]) || 0;
            const prefix = `string${s.id}`;
            const imppString = impp * s.count;
            const pMeasured = v * i;
            const tempC = calcStringTemp(v, s.count, vmpp, betaVmpp);
            const uncertainty = s.count ? calcTempUncertainty(s.count, vmpp, betaVmpp) : 0;
            const validRel = tempC !== null && isTempValidRelative(i, imppString);
            const validAbs = tempC !== null && isTempValidAbsolute(i, imppString, tempC, tAmbient);
            const mppUtil = calcMppUtilization(v, s.count, vmpp);
            const quality = getTempQuality(tempC, i, imppString, pMeasured, tAmbient, validAbs, validRel, mppUtil);
            const deltaK = tempC !== null ? Math.round((tempC - 25) * 10) / 10 : 0;
            const lossW = tempC !== null && quality !== 'invalid' ? calcTempLoss(pMeasured, tempC, betaPmax) : 0;
            const powerAt25 =
                tempC !== null && tempC > 25 && betaPmax > 0 && pMeasured > 0
                    ? Math.round(pMeasured / (1 - betaPmax * (tempC - 25)))
                    : Math.round(pMeasured);
            const alert = quality !== 'invalid' ? getTempAlert(tempC) : 'UNBEKANNT';
            const vmppMod = v && s.count ? Math.round((v / s.count) * 10) / 10 : 0;
            const qualityLabel =
                quality === 'absolute' ? 'ABSOLUT' : quality === 'limited' ? 'EINGESCHRAENKT' : 'UNGUELTIG';

            results[`${prefix}.vmppPerModule`] = vmppMod;
            results[`${prefix}.tempEquivalentC`] = tempC !== null ? tempC : 0;
            results[`${prefix}.tempQuality`] = qualityLabel;
            results[`${prefix}.tempValidRelative`] = validRel;
            results[`${prefix}.tempValidAbsolute`] = validAbs;
            results[`${prefix}.tempUncertaintyK`] = uncertainty;
            results[`${prefix}.tempDeltaK`] = deltaK;
            results[`${prefix}.tempLossW`] = lossW;
            results[`${prefix}.powerAt25C`] = powerAt25;
            results[`${prefix}.mppUtilization`] = mppUtil !== null ? mppUtil : 0;
            results[`${prefix}.tempAlert`] = alert;

            totalLossW += lossW;
            if (quality !== 'invalid' && tempC !== null && tempC > hottestTemp) {
                hottestTemp = tempC;
                hottestId = prefix;
            }
            if ((TEMP_ALERT_RANK[alert] ?? -1) > (TEMP_ALERT_RANK[worstAlert] ?? -1)) {
                worstAlert = alert;
            }
        }

        const s1q = results['string1.tempQuality'];
        const s2q = results['string2.tempQuality'];
        const s1p = (parseFloat(data['pv.string1.voltage']) || 0) * (parseFloat(data['pv.string1.current']) || 0);
        const s2p = (parseFloat(data['pv.string2.voltage']) || 0) * (parseFloat(data['pv.string2.current']) || 0);
        let deltaStrings = 0;
        let deltaValid = false;
        if (s1q && s1q !== 'UNGUELTIG' && s2q && s2q !== 'UNGUELTIG' && s1p >= 50 && s2p >= 50) {
            deltaStrings =
                Math.round(
                    ((results['string1.tempEquivalentC'] || 0) - (results['string2.tempEquivalentC'] || 0)) * 10,
                ) / 10;
            deltaValid = true;
        }

        const today = new Date().toDateString();
        if (this._tempLossDayDate !== today) {
            this._tempLossDayDate = today;
            this._tempLossKwhDay = 0;
        }
        const acPower = parseFloat(data['ac.power']) || 0;
        if (totalLossW > 0 && acPower >= 50) {
            this._tempLossKwhDay += (totalLossW * (this._cfg.pollInterval || 30)) / 3600000;
            this._tempLossKwhDay = Math.round(this._tempLossKwhDay * 10000) / 10000;
        }

        results['temperature.deltaStrings'] = deltaStrings;
        results['temperature.deltaValid'] = deltaValid;
        results['temperature.totalLossW'] = totalLossW;
        results['temperature.totalLossKwhDay'] = this._tempLossKwhDay || 0;
        results['temperature.hottest'] = hottestId;
        results['temperature.systemAlert'] = worstAlert;

        return results;
    }

    _calcDerivedStates(data) {
        const str = n => ({
            v: parseFloat(data[`pv.string${n}.voltage`]) || 0,
            a: parseFloat(data[`pv.string${n}.current`]) || 0,
        });
        const strings = [str(1), str(2), str(3)];
        const stringCount = this._getStringCount();
        const dcTotal = Math.round(strings.slice(0, stringCount).reduce((sum, s) => sum + s.v * s.a, 0));
        const acPower = parseFloat(data['ac.power']) || 0;
        let ratio = 0;
        if (dcTotal >= 50 && acPower >= 0) {
            ratio = Math.round((acPower / dcTotal) * 1000) / 10;
        }
        const tempMax = this._lastWeather?.tempMax;
        let expected = 97;
        if (tempMax != null) {
            const cellTempEst = tempMax + 18;
            const tempFactor = 1 - 0.004 * Math.max(0, cellTempEst - 25);
            expected = Math.round(97 * tempFactor * 10) / 10;
        }
        return {
            'dc.totalPower': dcTotal,
            'efficiency.ratio': ratio,
            'efficiency.expected': expected,
            ...this._calcTemperatureStates(data),
        };
    }

    // ─── History: Abruf + Import ─────────────────────────────────────────────────

    _isHistoryBusyBody(raw) {
        const head = (raw || '').substring(0, 500);
        return /service.*busy|nicht.*verf.gbar|<html/i.test(head);
    }

    _retryHistorySync(syncAll, retryCount, reason) {
        this._log('WARN', `History-Sync: ${reason} → Retry in 30s (Versuch ${retryCount + 1}/3)`);
        this.setTimeout(
            () =>
                this._fetchAndImportHistory(syncAll, retryCount + 1).catch(e => {
                    this._historySyncActive = false;
                    this._historyLoading = false;
                    this._log('WARN', `History-Sync Retry: ${e.message}`);
                }),
            30000,
        );
    }

    async _fetchAndImportHistory(syncAll = false, retryCount = 0) {
        if (retryCount === 0) {
            if (this._historySyncActive) {
                this._log('DEBUG', 'History-Sync läuft bereits – übersprungen');
                return;
            }
            this._historySyncActive = true;
            this._lastHistoryFetch = Date.now();
        }
        this._historyLoading = true;
        let retainSyncLock = false;
        try {
            if (retryCount === 0) {
                this._log(
                    'INFO',
                    syncAll
                        ? 'Starte VOLLSYNC (alle Datenpunkte) → InfluxDB...'
                        : 'Starte History-Sync (nur neue Datenpunkte)...',
                );
            }

            // Zeitpunkt des HTTP-Abrufs merken (für Epochen-Berechnung)
            const fetchUnixSec = Math.floor(Date.now() / 1000);
            let raw;
            try {
                raw = await this._fetchPage(POLL_URLS.log, 60000);
            } catch (e) {
                if (retryCount < 3 && /timeout|truncated|ECONNRESET|socket hang up|EPIPE/i.test(e.message || '')) {
                    retainSyncLock = true;
                    this._retryHistorySync(syncAll, retryCount, e.message);
                    return;
                }
                throw e;
            }

            // "akt. Zeit" aus Header lesen (Tab-separiert: "akt. Zeit:\t 495381409")
            const m = raw.match(/akt\.\s*Zeit[:\s\t]+\s*(\d+)/);
            if (!m) {
                const preview = raw.substring(0, 300).replace(/\r/g, '').split('\n').slice(0, 5).join(' | ');
                if (this._isHistoryBusyBody(raw) && retryCount < 3) {
                    retainSyncLock = true;
                    this._retryHistorySync(syncAll, retryCount, 'PIKO meldet "service busy"');
                    return;
                }
                throw new Error(`"akt. Zeit" nicht im Header gefunden. Header-Preview: ${preview}`);
            }
            const aktZeit = parseInt(m[1]);

            this._pikoEpoch = fetchUnixSec - aktZeit;
            this._log(
                'INFO',
                `PIKO Epoche: ${new Date(this._pikoEpoch * 1000).toISOString().substring(0, 10)} ` +
                    `| akt. Zeit des Geräts: ${aktZeit} s`,
            );
            await this.setStateAsync('history.pikoEpoch', {
                val: new Date(this._pikoEpoch * 1000).toISOString(),
                ack: true,
            });

            const rows = this._parseLogDaten(raw, this._pikoEpoch);

            if (rows.length === 0) {
                if (retryCount < 3) {
                    retainSyncLock = true;
                    this._retryHistorySync(syncAll, retryCount, 'LogDaten.dat ohne Messzeilen');
                    return;
                }
                this._log(
                    'WARN',
                    'LogDaten.dat: keine verwertbaren Zeilen gefunden – bestehende Historie bleibt erhalten',
                );
                return;
            }

            const prevRows = this._lastHistoryRows;

            if (this._isHistoryParseSuspicious(prevRows, rows)) {
                if (retryCount < 3) {
                    retainSyncLock = true;
                    this._retryHistorySync(
                        syncAll,
                        retryCount,
                        `LogDaten.dat unvollständig (${rows.length} Punkte, zuvor ${prevRows.length})`,
                    );
                    return;
                }
                this._log(
                    'WARN',
                    `LogDaten.dat wirkt unvollständig (${rows.length} Punkte, zuvor ${prevRows.length}, ` +
                        `${rows[0].date.substring(0, 10)} – ${rows[rows.length - 1].date.substring(0, 10)}) – ` +
                        `Cache wird per Merge aktualisiert, ältere Punkte bleiben erhalten`,
                );
            } else if (this._cfg.verbose && prevRows.length && rows.length < prevRows.length * 0.1) {
                this._log(
                    'DEBUG',
                    `LogDaten.dat kurz (${rows.length} von ${prevRows.length} Punkten), aber aktuell – Merge ohne Warnung`,
                );
            }

            const merged = this._mergeHistoryRows(prevRows, rows);
            const added = merged.length - prevRows.length;
            const removed = prevRows.length + rows.length - merged.length;
            this._lastHistoryRows = merged.map(r => this._compactHistoryRow(r));
            this._invalidateHistoryApiCache();
            if (removed > 0) {
                this._log('INFO', `${removed} doppelte History-Punkte beim Merge entfernt`);
            }
            if (added > 0) {
                this._log('INFO', `${added} neue Punkte per Merge (gesamt ${merged.length})`);
            }

            await this._saveHistoryCache().catch(e => this._log('WARN', `History-Cache speichern: ${e.message}`));
            await this._refreshAutoYields().catch(e => this._log('WARN', `Monatserträge aktualisieren: ${e.message}`));

            const allRows = this._lastHistoryRows;
            this._log(
                'INFO',
                `${allRows.length} Datenpunkte gesamt | ` +
                    `${allRows[0].date.substring(0, 10)} – ${allRows[allRows.length - 1].date.substring(0, 10)}`,
            );

            if (syncAll) {
                this._log('INFO', 'Sync-All: Cursor zurückgesetzt, übertrage alle Datenpunkte');
                this._lastImportedTs = 0;
            }

            const newRows = syncAll ? allRows.filter(r => r.ts > 0) : allRows.filter(r => r.ts > this._lastImportedTs);
            this._log('INFO', `${newRows.length} Datenpunkte ${syncAll ? '(alle)' : '(neu)'} → InfluxDB`);

            if (newRows.length === 0) {
                this._lastImportIso = new Date().toISOString();
                await this.setStateAsync('history.lastImport', { val: this._lastImportIso, ack: true });
                await this.setStateAsync('history.recordCount', { val: allRows.length, ack: true });
                await this._refreshAutoYields().catch(e =>
                    this._log('WARN', `Monatserträge aktualisieren: ${e.message}`),
                );
                return;
            }

            let influxSent = 0;
            let maxTs = this._lastImportedTs;

            for (const row of newRows) {
                await this._writeHistoryRow(row);

                if (this._cfg.influxEnable) {
                    const n = await this._sendRowToInflux(row);
                    influxSent += n;
                }

                if (row.ts > maxTs) {
                    maxTs = row.ts;
                }
            }

            this._lastImportedTs = maxTs;
            await this.setStateAsync('history.lastImportedTs', { val: maxTs, ack: true });
            this._lastImportIso = new Date().toISOString();
            await this.setStateAsync('history.lastImport', { val: this._lastImportIso, ack: true });
            await this.setStateAsync('history.recordCount', { val: allRows.length, ack: true });
            await this.setStateAsync('history.newRecords', { val: newRows.length, ack: true });
            await this.setStateAsync('history.oldestRecord', { val: allRows[0].date, ack: true });
            await this.setStateAsync('history.newestRecord', { val: allRows[allRows.length - 1].date, ack: true });
            if (this._cfg.influxEnable) {
                await this.setStateAsync('history.influxSent', { val: influxSent, ack: true });
            }

            this._log(
                'INFO',
                `Sync ${syncAll ? '(Vollsync)' : ''} fertig: ${newRows.length} Punkte${
                    this._cfg.influxEnable ? `, ${influxSent} → ${this._cfg.influxInstance}` : ''
                }`,
            );
        } finally {
            if (!retainSyncLock) {
                this._historyLoading = false;
                this._historySyncActive = false;
            } else {
                this._historyLoading = false;
            }
        }
    }

    // ─── History → ioBroker-States (mit historischem ts) ────────────────────────

    async _writeHistoryRow(row) {
        for (const def of HISTORY_STATES) {
            const val = this._calcHistVal(row, def);
            if (val === null) {
                continue;
            }
            try {
                // ts = historischer UNIX-Timestamp in ms
                // Der ioBroker InfluxDB-Adapter schreibt diesen ts in die DB
                await this.setStateAsync(def.id, {
                    val,
                    ack: true,
                    ts: row.ts, // ← DAS ist der Schlüssel für korrekte Zeitreihen
                    q: 0,
                });
            } catch (e) {
                if (this._cfg.verbose) {
                    this._log('WARN', `${def.id}: ${e.message}`);
                }
            }
        }
    }

    // ─── History → InfluxDB direkt via sendTo (Batch) ────────────────────────────

    async _sendRowToInflux(row) {
        const points = [];
        for (const def of HISTORY_STATES) {
            const val = this._calcHistVal(row, def);
            if (val === null) {
                continue;
            }
            points.push({
                id: `${this.namespace}.${def.id}`,
                state: { val, ts: row.ts, ack: true, q: 0 },
            });
        }
        if (!points.length) {
            return 0;
        }

        await new Promise(resolve => {
            this.sendTo(this._cfg.influxInstance, 'storeState', points, result => {
                if (result && result.error) {
                    this._log('WARN', `InfluxDB sendTo: ${result.error}`);
                }
                resolve();
            });
        });
        return points.length;
    }

    async _syncLiveToInflux(data) {
        if (!this._cfg.influxEnable) {
            return;
        }
        const ts = Date.now();
        const points = [];
        for (const id of LIVE_INFLUX_STATES) {
            if (data[id] === null || data[id] === undefined) {
                continue;
            }
            points.push({
                id: `${this.namespace}.${id}`,
                state: { val: data[id], ts, ack: true, q: 0 },
            });
        }
        if (!points.length) {
            return;
        }

        await new Promise(resolve => {
            this.sendTo(this._cfg.influxInstance, 'storeState', points, result => {
                if (result && result.error && this._cfg.verbose) {
                    this._log('WARN', `InfluxDB Live-Sync: ${result.error}`);
                }
                resolve();
            });
        });
    }

    _dedupeHistoryRows(rows) {
        const SLOT_MS = 15 * 60 * 1000;
        const bySlot = new Map();
        for (const r of rows) {
            if (!r?.ts) {
                continue;
            }
            const slot = Math.floor(r.ts / SLOT_MS);
            bySlot.set(slot, r);
        }
        return [...bySlot.values()].sort((a, b) => a.ts - b.ts);
    }

    _mergeHistoryRows(prevRows, newRows) {
        if (!prevRows.length) {
            return this._dedupeHistoryRows(newRows);
        }
        if (!newRows.length) {
            return this._dedupeHistoryRows(prevRows);
        }
        return this._dedupeHistoryRows([...prevRows, ...newRows]);
    }

    _isHistoryParseSuspicious(prevRows, newRows) {
        if (!prevRows.length || !newRows.length) {
            return false;
        }
        if (prevRows.length < 100) {
            return false;
        }
        const prevMax = prevRows[prevRows.length - 1].ts;
        const newMax = newRows[newRows.length - 1].ts;
        // Nur wenn die Datei älter endet als der Cache: echter Truncate (fehlender Nachmittag).
        // Eine kurze, aber aktuelle Antwort (1 Punkt vs. 20k, Solar-Log blockiert) ist kein Fehler.
        return newMax < prevMax - 45 * 60 * 1000;
    }

    _resolvePikoModelKey() {
        const cfgModel = (this._cfg.pikoModel || 'auto').toLowerCase();
        if (cfgModel !== 'auto' && PIKO_SPECS[cfgModel]) {
            return cfgModel;
        }
        const live = (this._lastData['device.model'] || '').toLowerCase();
        if (live.includes('10.1')) {
            return 'piko10.1';
        }
        if (live.includes('8.3')) {
            return 'piko8.3';
        }
        if (live.includes('7.0')) {
            return 'piko7.0';
        }
        if (live.includes('5.5')) {
            return 'piko5.5';
        }
        if (live.includes('4.2')) {
            return 'piko4.2';
        }
        if (live.includes('3.6')) {
            return 'piko3.6';
        }
        if (live.includes('3.0')) {
            return 'piko3.0';
        }
        return null;
    }

    _getInverterSpecs() {
        const key = this._resolvePikoModelKey();
        const spec = key ? PIKO_SPECS[key] : null;
        if (!spec) {
            return { enabled: false };
        }
        const activeStrings =
            [this._cfg.string1Modules, this._cfg.string2Modules, this._cfg.string3Modules].filter(n => n > 0).length ||
            spec.strings;
        const mppMin = activeStrings >= 2 ? spec.mppMin2 || spec.mppMin1 : spec.mppMin1 || spec.mppMin2;
        return {
            enabled: true,
            modelKey: key,
            modelName: spec.name,
            ...spec,
            mppMinActive: mppMin,
            grid: GRID_LIMITS_DE,
        };
    }

    _checkStringInverterLimits(voltage, current, inv) {
        if (!inv?.enabled || !voltage) {
            return { ok: true, warnings: [] };
        }
        const w = [];
        if (voltage > inv.dcMaxV) {
            w.push(`Spannung ${voltage}V > Udcmax ${inv.dcMaxV}V`);
        }
        if (voltage < inv.dcMinV && current > 0.1) {
            w.push(`Spannung ${voltage}V < Udcmin ${inv.dcMinV}V`);
        }
        if (inv.dcMaxA && current > inv.dcMaxA) {
            w.push(`Strom ${current}A > Idmax ${inv.dcMaxA}A`);
        }
        return { ok: !w.length, warnings: w };
    }

    _getPersistentDataDir() {
        let base = '';
        try {
            if (typeof utils.getAbsoluteDefaultDataDir === 'function') {
                base = utils.getAbsoluteDefaultDataDir();
            }
        } catch (_) {}
        if (!base) {
            base = path.join('/opt/iobroker', 'iobroker-data');
        }
        return path.join(base, this.namespace);
    }

    _legacyDataDirs() {
        const dirs = [];
        const add = dir => {
            if (dir && !dirs.includes(dir)) {
                dirs.push(dir);
            }
        };
        add(path.join(process.cwd(), 'iobroker-data', this.namespace));
        if (this.adapterDir) {
            add(path.join(this.adapterDir, 'iobroker-data', this.namespace));
        }
        return dirs;
    }

    _getHistoryCachePath() {
        return path.join(this._getPersistentDataDir(), 'history-cache.json');
    }

    _getYieldsCachePath() {
        return path.join(this._getPersistentDataDir(), 'monthly-yields.json');
    }

    async _migrateLegacyDataFiles() {
        const destDir = this._getPersistentDataDir();
        await fs.promises.mkdir(destDir, { recursive: true });
        const names = [
            'monthly-yields.json',
            'monthly-yields.json.bak',
            'history-cache.json',
            'history-cache.json.bak',
        ];
        for (const dir of this._legacyDataDirs()) {
            if (path.resolve(dir) === path.resolve(destDir)) {
                continue;
            }
            for (const name of names) {
                const src = path.join(dir, name);
                const dest = path.join(destDir, name);
                try {
                    await fs.promises.access(src);
                } catch (_) {
                    continue;
                }
                let overwrite = false;
                try {
                    const srcStat = await fs.promises.stat(src);
                    const destStat = await fs.promises.stat(dest);
                    overwrite = srcStat.size > destStat.size;
                } catch (_) {
                    overwrite = true;
                }
                if (overwrite) {
                    await fs.promises.copyFile(src, dest);
                    this._log('INFO', `Daten nach Update-sicheren Ordner kopiert: ${name}`);
                }
            }
        }
    }

    _compactHistoryRow(row) {
        return {
            ts: row.ts,
            date: row.date,
            dc1: row.dc1,
            dc2: row.dc2,
            dc3: row.dc3,
            ac1: row.ac1,
            ac2: row.ac2,
            ac3: row.ac3,
            frequency: row.frequency,
            acStatus: row.acStatus,
            errorCode: row.errorCode,
            acTotalPower: row.acTotalPower,
            totalEnergy: row.totalEnergy,
        };
    }

    _invalidateHistoryApiCache() {
        this._historyApiCache = null;
    }

    _buildHistoryApiPayload() {
        const newest = this._lastHistoryRows.length
            ? this._lastHistoryRows[this._lastHistoryRows.length - 1].date
            : null;
        const todayMeta = this._getTodayHistoryMeta();
        return {
            rows: this._lastHistoryRows.slice().reverse(),
            pikoEpoch: this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString() : null,
            recordCount: this._lastHistoryRows.length,
            lastImported: this._lastImportIso,
            newestRecord: newest,
            todayNewest: todayMeta.todayNewest,
            todayStale: todayMeta.todayStale,
            todayAgeMin: todayMeta.ageMin,
            loading: this._historyLoading || false,
            stringAnalysis: this._getStringAnalysisConfig(),
            temperatureAnalysis: this._getTemperatureAnalysis(),
            stringCount: this._getStringCount(),
            fromCache: this._historyLoading && this._lastHistoryRows.length > 0,
        };
    }

    _getHistoryApiJson() {
        if (!this._historyApiCache) {
            this._historyApiCache = JSON.stringify(this._buildHistoryApiPayload());
        }
        return this._historyApiCache;
    }

    _cacheWeatherHistory(dateKey, weather) {
        if (this._weatherHistoryCache.size >= WEATHER_HISTORY_CACHE_MAX) {
            const oldest = this._weatherHistoryCache.keys().next().value;
            if (oldest !== undefined) {
                this._weatherHistoryCache.delete(oldest);
            }
        }
        this._weatherHistoryCache.set(dateKey, weather);
    }

    async _saveHistoryCache() {
        if (!this._historyCachePath || !this._lastHistoryRows.length) {
            return;
        }
        const dir = path.dirname(this._historyCachePath);
        await fs.promises.mkdir(dir, { recursive: true });
        try {
            await fs.promises.access(this._historyCachePath);
            await fs.promises.copyFile(this._historyCachePath, `${this._historyCachePath}.bak`);
        } catch (_) {}
        const payload = {
            savedAt: new Date().toISOString(),
            pikoEpoch: this._pikoEpoch,
            rows: this._lastHistoryRows.map(r => this._compactHistoryRow(r)),
        };
        await fs.promises.writeFile(this._historyCachePath, JSON.stringify(payload), 'utf-8');
    }

    async _loadHistoryCache() {
        if (!this._historyCachePath) {
            return;
        }
        for (const file of [this._historyCachePath, `${this._historyCachePath}.bak`]) {
            try {
                const raw = await fs.promises.readFile(file, 'utf-8');
                const data = JSON.parse(raw);
                if (!data.rows || !Array.isArray(data.rows) || data.rows.length < 10) {
                    continue;
                }
                this._lastHistoryRows = this._dedupeHistoryRows(data.rows.map(r => this._compactHistoryRow(r)));
                this._invalidateHistoryApiCache();
                if (data.pikoEpoch) {
                    this._pikoEpoch = data.pikoEpoch;
                }
                const removed = data.rows.length - this._lastHistoryRows.length;
                this._log(
                    'INFO',
                    `History-Cache geladen: ${this._lastHistoryRows.length} Punkte${
                        removed > 0 ? ` (${removed} Duplikate entfernt)` : ''
                    }${
                        data.savedAt ? ` (Stand ${data.savedAt.substring(0, 19).replace('T', ' ')})` : ''
                    }${file.endsWith('.bak') ? ' [Backup]' : ''}`,
                );
                if (removed > 0) {
                    await this._saveHistoryCache().catch(e =>
                        this._log('WARN', `History-Cache bereinigen: ${e.message}`),
                    );
                }
                return;
            } catch (e) {
                if (e.code !== 'ENOENT' && this._cfg.verbose) {
                    this._log('DEBUG', `History-Cache ${file}: ${e.message}`);
                }
            }
        }
    }

    _defaultMonthlyYields() {
        const kwp = this._cfg.yieldInstalledKwp || this._getInstalledKwp();
        let _commissionYear = null;
        if (this._pikoEpoch) {
            _commissionYear = new Date(this._pikoEpoch * 1000).getFullYear();
        }
        return {
            savedAt: new Date().toISOString(),
            feedInTariff: this._cfg.yieldFeedInTariff || 0.3925,
            installedKwp: kwp || 0,
            plzRegion: (this._cfg.yieldPlz || '').charAt(0) || '',
            plz: this._cfg.yieldPlz || '',
            regionalKwpRef: null,
            extraYears: [],
            months: {},
        };
    }

    _getYieldsYears(months, extraYears) {
        const fromData = Object.keys(months || {})
            .map(k => this._parseMonthKey(k)?.year)
            .filter(Boolean);
        const pinned = (extraYears || []).map(y => parseInt(y)).filter(y => y >= 1990 && y <= 2100);
        const currentYear = new Date().getFullYear();
        const years = [...new Set([...fromData, ...pinned, currentYear])].sort((a, b) => a - b);
        return years;
    }

    async _loadMonthlyYields() {
        const candidates = [];
        const addFile = async filePath => {
            const data = await this._readYieldsFile(filePath);
            if (data) {
                candidates.push({ data, src: filePath, n: Object.keys(data.months).length });
            }
        };
        if (this._yieldsCachePath) {
            await addFile(this._yieldsCachePath);
            await addFile(`${this._yieldsCachePath}.bak`);
        }
        for (const dir of this._legacyDataDirs()) {
            await addFile(path.join(dir, 'monthly-yields.json'));
            await addFile(path.join(dir, 'monthly-yields.json.bak'));
        }
        const snap = await this._readYieldsSnapshotState();
        if (snap) {
            candidates.push({ data: snap, src: 'state:yields.snapshot', n: Object.keys(snap.months).length });
        }

        candidates.sort((a, b) => b.n - a.n);
        if (candidates.length && candidates[0].n > 0) {
            this._monthlyYields = candidates[0].data;
            this._log('INFO', `Monatserträge geladen: ${candidates[0].n} Monate (${candidates[0].src})`);
            if (this._yieldsCachePath && candidates[0].src !== this._yieldsCachePath) {
                await this._saveMonthlyYields();
            }
            return;
        }

        const fromInflux = await this._loadYieldsFromInflux();
        if (fromInflux && Object.keys(fromInflux.months).length) {
            this._monthlyYields = fromInflux;
            this._log(
                'INFO',
                `Monatserträge aus InfluxDB wiederhergestellt: ${Object.keys(fromInflux.months).length} Monate`,
            );
            await this._saveMonthlyYields();
            return;
        }

        this._monthlyYields = this._defaultMonthlyYields();
        if (this._cfg.influxEnable) {
            this.setTimeout(() => {
                this._loadYieldsFromInflux()
                    .then(async data => {
                        if (
                            !data ||
                            Object.keys(data.months).length <= Object.keys(this._monthlyYields.months).length
                        ) {
                            return;
                        }
                        this._monthlyYields = data;
                        this._log(
                            'INFO',
                            `Monatserträge nachträglich aus InfluxDB: ${Object.keys(data.months).length} Monate`,
                        );
                        await this._saveMonthlyYields();
                    })
                    .catch(e => this._log('DEBUG', `Influx-Ertrag später: ${e.message}`));
            }, 12000);
        }
    }

    async _readYieldsFile(filePath) {
        try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            const data = JSON.parse(raw);
            if (!data.months || typeof data.months !== 'object') {
                return null;
            }
            return {
                ...this._defaultMonthlyYields(),
                ...data,
                months: { ...data.months },
                extraYears: Array.isArray(data.extraYears) ? [...data.extraYears] : [],
            };
        } catch (e) {
            if (e.code !== 'ENOENT' && this._cfg?.verbose) {
                this._log('DEBUG', `Monatserträge ${filePath}: ${e.message}`);
            }
            return null;
        }
    }

    async _saveMonthlyYields(options = {}) {
        if (!this._yieldsCachePath || !this._monthlyYields) {
            return;
        }
        const n = Object.keys(this._monthlyYields.months || {}).length;
        const existing = await this._readYieldsFile(this._yieldsCachePath);
        const existingN = existing ? Object.keys(existing.months).length : 0;
        if (!options.force && existingN >= 12 && n < existingN * 0.5) {
            this._log(
                'WARN',
                `Monatserträge nicht überschrieben (${n} Monate in Speicher, Datei hat ${existingN}) – Import/Backup nutzen`,
            );
            return;
        }
        const dir = path.dirname(this._yieldsCachePath);
        await fs.promises.mkdir(dir, { recursive: true });
        try {
            await fs.promises.access(this._yieldsCachePath);
            await fs.promises.copyFile(this._yieldsCachePath, `${this._yieldsCachePath}.bak`);
        } catch (_) {}
        this._monthlyYields.savedAt = new Date().toISOString();
        await fs.promises.writeFile(this._yieldsCachePath, JSON.stringify(this._monthlyYields, null, 2), 'utf-8');
        await this._persistYieldsSnapshotState();
        this._syncYieldsToInflux().catch(e => this._log('WARN', `Ertrag → InfluxDB: ${e.message}`));
    }

    async _ensureYieldStates() {
        const defs = [
            {
                id: 'yield.monthly',
                type: 'number',
                role: 'value.energy',
                name: 'Monatsertrag (Influx/Grafana)',
                unit: 'kWh',
                def: 0,
            },
            {
                id: 'yields.snapshot',
                type: 'string',
                role: 'json',
                name: 'Ertragstabelle JSON-Backup',
                def: '',
            },
        ];
        for (const d of defs) {
            await this._ensureChannelPath(d.id);
            const common = {
                name: d.name,
                type: d.type,
                role: d.role,
                read: true,
                write: false,
                def: d.def,
            };
            if (d.unit) {
                common.unit = d.unit;
            }
            await this.setObjectNotExistsAsync(d.id, { type: 'state', common, native: {} });
            this._nodes[d.id] = { name: d.name, type: d.type, role: d.role, unit: d.unit };
        }
    }

    _sendToAsync(instance, command, message, timeoutMs = 15000) {
        return new Promise(resolve => {
            let done = false;
            const timer = this.setTimeout(() => {
                if (!done) {
                    done = true;
                    resolve({ error: 'timeout' });
                }
            }, timeoutMs);
            this.sendTo(instance, command, message, result => {
                if (done) {
                    return;
                }
                done = true;
                this.clearTimeout(timer);
                resolve(result || {});
            });
        });
    }

    async _persistYieldsSnapshotState() {
        try {
            await this.setStateAsync('yields.snapshot', {
                val: JSON.stringify(this._monthlyYields),
                ack: true,
            });
        } catch (e) {
            this._log('WARN', `Ertrag-Snapshot State: ${e.message}`);
        }
    }

    async _readYieldsSnapshotState() {
        try {
            const st = await this.getStateAsync('yields.snapshot');
            if (!st || !st.val || typeof st.val !== 'string') {
                return null;
            }
            const data = JSON.parse(st.val);
            if (!data.months || typeof data.months !== 'object') {
                return null;
            }
            return {
                ...this._defaultMonthlyYields(),
                ...data,
                months: { ...data.months },
                extraYears: Array.isArray(data.extraYears) ? [...data.extraYears] : [],
            };
        } catch (_) {
            return null;
        }
    }

    async _syncYieldsToInflux() {
        if (!this._cfg.influxEnable || !this._monthlyYields?.months) {
            return;
        }
        const points = [];
        for (const [key, entry] of Object.entries(this._monthlyYields.months)) {
            const parsed = this._parseMonthKey(key);
            const wh = entry && typeof entry === 'object' ? entry.wh : entry;
            const n = Math.round(parseFloat(wh));
            if (!parsed || !n) {
                continue;
            }
            const ts = new Date(parsed.year, parsed.month - 1, 1, 12, 0, 0).getTime();
            points.push({
                id: `${this.namespace}.yield.monthly`,
                state: { val: Math.round((n / 1000) * 1000) / 1000, ts, ack: true, q: 0 },
            });
        }
        if (!points.length) {
            return;
        }
        const result = await this._sendToAsync(this._cfg.influxInstance, 'storeState', points, 20000);
        if (result && result.error) {
            throw new Error(String(result.error));
        }
        this._log('INFO', `${points.length} Monatserträge → ${this._cfg.influxInstance} (yield.monthly)`);
    }

    async _loadYieldsFromInflux() {
        if (!this._cfg.influxEnable) {
            return null;
        }
        const result = await this._sendToAsync(
            this._cfg.influxInstance,
            'getHistory',
            {
                id: `${this.namespace}.yield.monthly`,
                options: {
                    start: Date.UTC(2000, 0, 1),
                    end: Date.now(),
                    count: 5000,
                    aggregate: 'none',
                },
            },
            20000,
        );
        const rows = result && (result.result || result.rows);
        if (result?.error || !Array.isArray(rows) || !rows.length) {
            return null;
        }
        const vals = rows.map(p => parseFloat(p.val)).filter(v => !isNaN(v) && v > 0);
        if (!vals.length) {
            return null;
        }
        const max = Math.max(...vals);
        const toWh = v => (max > 5000 ? Math.round(v) : Math.round(v * 1000));
        const months = {};
        const extraYears = new Set();
        for (const p of rows) {
            const v = parseFloat(p.val);
            if (!p.ts || isNaN(v) || v <= 0) {
                continue;
            }
            const d = new Date(p.ts);
            const key = this._monthKey(d.getFullYear(), d.getMonth() + 1);
            months[key] = {
                wh: toWh(v),
                source: 'manual',
                updatedAt: new Date(p.ts).toISOString(),
            };
            extraYears.add(d.getFullYear());
        }
        if (!Object.keys(months).length) {
            return null;
        }
        return {
            ...this._defaultMonthlyYields(),
            months,
            extraYears: [...extraYears].sort((a, b) => a - b),
        };
    }

    _monthKey(year, month) {
        return `${year}-${String(month).padStart(2, '0')}`;
    }

    _parseMonthKey(key) {
        const m = /^(\d{4})-(\d{2})$/.exec(key || '');
        if (!m) {
            return null;
        }
        return { year: parseInt(m[1]), month: parseInt(m[2]) };
    }

    _getRowsForMonth(year, month) {
        return this._dedupeHistoryRows(this._lastHistoryRows).filter(r => {
            const parts = new Intl.DateTimeFormat('en', {
                timeZone: 'Europe/Berlin',
                year: 'numeric',
                month: 'numeric',
            }).formatToParts(new Date(r.ts));
            const y = parseInt(parts.find(p => p.type === 'year').value, 10);
            const m = parseInt(parts.find(p => p.type === 'month').value, 10);
            return y === year && m === month;
        });
    }

    _maxPlausibleMonthWh(kwp) {
        const k = kwp || this._getInstalledKwp() || 10;
        return Math.round(k * 220 * 1000);
    }

    _calcMonthWhFromRows(rows) {
        if (!rows.length) {
            return 0;
        }
        const byDay = {};
        this._dedupeHistoryRows(rows).forEach(r => {
            const day = this._berlinDateKey(r.ts);
            if (!byDay[day]) {
                byDay[day] = [];
            }
            byDay[day].push(r);
        });
        let totalKwh = 0;
        Object.values(byDay).forEach(dayRows => {
            totalKwh += this._calcDailyKwh(dayRows);
        });
        return Math.round(totalKwh * 1000);
    }

    async _refreshAutoYields(options = {}) {
        if (!this._monthlyYields) {
            this._monthlyYields = this._defaultMonthlyYields();
        }
        if (!this._lastHistoryRows.length) {
            return { updated: 0, historyFrom: null, historyTo: null, monthsInHistory: 0 };
        }

        const force = !!options.force;
        const fromYear = options.fromYear ? parseInt(options.fromYear) : null;
        const fromMonth = options.fromMonth ? parseInt(options.fromMonth) : 1;

        const kwp = this._cfg.yieldInstalledKwp || this._getInstalledKwp();
        if (kwp) {
            this._monthlyYields.installedKwp = kwp;
        }
        this._monthlyYields.feedInTariff = this._cfg.yieldFeedInTariff || this._monthlyYields.feedInTariff;
        if (this._cfg.yieldPlz) {
            this._monthlyYields.plzRegion = this._cfg.yieldPlz.charAt(0);
            this._monthlyYields.plz = this._cfg.yieldPlz;
        }

        if (fromYear) {
            if (!this._monthlyYields.extraYears) {
                this._monthlyYields.extraYears = [];
            }
            const cy = new Date().getFullYear();
            for (let y = fromYear; y <= cy; y++) {
                if (!this._monthlyYields.extraYears.includes(y)) {
                    this._monthlyYields.extraYears.push(y);
                }
            }
            this._monthlyYields.extraYears.sort((a, b) => a - b);
        }

        const monthSet = {};
        this._lastHistoryRows.forEach(r => {
            const d = new Date(r.ts);
            const year = d.getFullYear();
            const month = d.getMonth() + 1;
            if (fromYear) {
                const beforeStart = year < fromYear || (year === fromYear && month < fromMonth);
                if (beforeStart) {
                    return;
                }
            }
            monthSet[this._monthKey(year, month)] = { year, month };
        });

        let updated = 0;
        let skippedManual = 0;
        Object.values(monthSet).forEach(({ year, month }) => {
            const key = this._monthKey(year, month);
            const existing = this._monthlyYields.months[key];
            if (existing && existing.source === 'manual') {
                skippedManual++;
                return;
            }

            const wh = this._calcMonthWhFromRows(this._getRowsForMonth(year, month));
            if (wh <= 0) {
                return;
            }

            const maxWh = this._maxPlausibleMonthWh(kwp);
            if (wh > maxWh) {
                this._log(
                    'WARN',
                    `Monatsertrag ${key}: ${wh} Wh unrealistisch (>${maxWh} Wh) – ` +
                        `bitte „Auto-Werte löschen“ und erneut aus Historie berechnen`,
                );
                return;
            }

            const now = new Date();
            const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
            if (!force && existing && existing.source === 'auto' && existing.wh === wh && !isCurrentMonth) {
                return;
            }

            this._monthlyYields.months[key] = {
                wh,
                source: 'auto',
                updatedAt: new Date().toISOString(),
            };
            updated++;
        });

        if (updated > 0) {
            await this._saveMonthlyYields();
            this._log('INFO', `Monatserträge: ${updated} Monat(e) aus Historie aktualisiert`);
        }

        const sorted = [...this._lastHistoryRows].sort((a, b) => a.ts - b.ts);
        return {
            updated,
            skippedManual,
            monthsInHistory: Object.keys(monthSet).length,
            historyFrom: sorted.length ? sorted[0].date.substring(0, 10) : null,
            historyTo: sorted.length ? sorted[sorted.length - 1].date.substring(0, 10) : null,
        };
    }

    _buildYieldsApiResponse() {
        const data = this._monthlyYields || this._defaultMonthlyYields();
        const months = data.months || {};
        const years = this._getYieldsYears(months, data.extraYears);

        const monthNames = [
            'Januar',
            'Februar',
            'März',
            'April',
            'Mai',
            'Juni',
            'Juli',
            'August',
            'September',
            'Oktober',
            'November',
            'Dezember',
        ];
        const grid = [];
        const monthStats = [];

        for (let m = 1; m <= 12; m++) {
            const row = { month: m, name: monthNames[m - 1], cells: {}, stats: {} };
            const values = [];
            years.forEach(year => {
                const key = this._monthKey(year, m);
                const entry = months[key];
                const wh = entry && entry.wh > 0 ? entry.wh : null;
                row.cells[year] = {
                    wh,
                    source: entry?.source || null,
                };
                if (wh) {
                    values.push(wh);
                }
            });
            if (values.length) {
                const avg = values.reduce((s, v) => s + v, 0) / values.length;
                row.stats = {
                    avg: Math.round(avg),
                    min: Math.min(...values),
                    max: Math.max(...values),
                };
            }
            grid.push(row);
            monthStats.push(row.stats);
        }

        const yearTotals = {};
        const yearEuro = {};
        const yearKwp = {};
        const tariff = data.feedInTariff || 0.3925;
        const kwp = data.installedKwp || this._cfg.yieldInstalledKwp || this._getInstalledKwp() || 0;

        years.forEach(year => {
            let sumWh = 0;
            for (let m = 1; m <= 12; m++) {
                const key = this._monthKey(year, m);
                const wh = months[key]?.wh;
                if (wh > 0) {
                    sumWh += wh;
                }
            }
            yearTotals[year] = sumWh;
            yearEuro[year] = Math.round((sumWh / 1000) * tariff * 100) / 100;
            yearKwp[year] = kwp > 0 ? Math.round((sumWh / 1000 / kwp) * 10) / 10 : null;
        });

        let totalWh = 0;
        Object.values(yearTotals).forEach(v => {
            totalWh += v;
        });
        const totalEuro = Math.round((totalWh / 1000) * tariff * 100) / 100;
        const totalKwh = Math.round((totalWh / 1000) * 10) / 10;

        return {
            settings: {
                feedInTariff: tariff,
                installedKwp: kwp,
                plzRegion: data.plzRegion || (data.plz || '').charAt(0) || '',
                plz: data.plz || this._cfg.yieldPlz || '',
                regionalKwpRef: data.regionalKwpRef || null,
                pikoEpoch: this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString().substring(0, 10) : null,
            },
            storagePath: this._yieldsCachePath || null,
            backupPath: this._yieldsCachePath ? `${this._yieldsCachePath}.bak` : null,
            influxBackup: !!this._cfg.influxEnable,
            influxInstance: this._cfg.influxInstance || null,
            historyFrom: this._lastHistoryRows.length
                ? [...this._lastHistoryRows].sort((a, b) => a.ts - b.ts)[0].date.substring(0, 10)
                : null,
            historyTo: this._lastHistoryRows.length
                ? [...this._lastHistoryRows]
                      .sort((a, b) => a.ts - b.ts)
                      .pop()
                      .date.substring(0, 10)
                : null,
            extraYears: data.extraYears || [],
            years,
            grid,
            yearTotals,
            yearEuro,
            yearKwp,
            totalWh,
            totalKwh,
            totalEuro,
            monthCount: Object.keys(months).length,
        };
    }

    async _handleYieldsPost(body) {
        if (!this._monthlyYields) {
            this._monthlyYields = this._defaultMonthlyYields();
        }
        const action = body.action;

        if (action === 'setCell') {
            const year = parseInt(body.year);
            const month = parseInt(body.month);
            if (!year || month < 1 || month > 12) {
                throw new Error('Ungültiges Jahr/Monat');
            }
            const key = this._monthKey(year, month);
            const wh =
                body.wh === null || body.wh === '' || body.wh === undefined
                    ? null
                    : Math.round(parseFloat(String(body.wh).replace(',', '.')));
            if (wh === null || isNaN(wh)) {
                delete this._monthlyYields.months[key];
            } else if (wh < 0) {
                throw new Error('Ertrag darf nicht negativ sein');
            } else {
                this._monthlyYields.months[key] = {
                    wh,
                    source: 'manual',
                    updatedAt: new Date().toISOString(),
                };
            }
            await this._saveMonthlyYields();
            return { ok: true, message: 'Gespeichert' };
        }

        if (action === 'setSettings') {
            if (body.feedInTariff !== undefined) {
                const t = parseFloat(String(body.feedInTariff).replace(',', '.'));
                if (!isNaN(t) && t >= 0) {
                    this._monthlyYields.feedInTariff = t;
                }
            }
            if (body.installedKwp !== undefined) {
                const k = parseFloat(String(body.installedKwp).replace(',', '.'));
                if (!isNaN(k) && k >= 0) {
                    this._monthlyYields.installedKwp = k;
                }
            }
            if (body.plzRegion !== undefined) {
                const p = String(body.plzRegion).trim();
                this._monthlyYields.plzRegion = /^\d{5}$/.test(p) ? p.charAt(0) : p;
                if (/^\d{5}$/.test(p)) {
                    this._monthlyYields.plz = p;
                }
            }
            if (body.plz !== undefined) {
                const p = String(body.plz).trim();
                if (/^\d{5}$/.test(p)) {
                    this._monthlyYields.plz = p;
                    this._monthlyYields.plzRegion = p.charAt(0);
                    this._cfg.yieldPlz = p;
                    this._weatherGeoCache = null;
                    this._lastWeatherFetch = 0;
                    this._refreshWeather().catch(e => this._log('DEBUG', `Wetter: ${e.message}`));
                }
            }
            if (body.regionalKwpRef !== undefined) {
                if (body.regionalKwpRef === null) {
                    this._monthlyYields.regionalKwpRef = null;
                } else if (Array.isArray(body.regionalKwpRef) && body.regionalKwpRef.length === 12) {
                    this._monthlyYields.regionalKwpRef = body.regionalKwpRef.map(v =>
                        v === null || v === '' ? null : parseFloat(String(v).replace(',', '.')),
                    );
                }
            }
            await this._saveMonthlyYields();
            return { ok: true, message: 'Einstellungen gespeichert' };
        }

        if (action === 'refreshAuto') {
            const result = await this._refreshAutoYields({ force: !!body.force });
            const range =
                result.historyFrom && result.historyTo
                    ? ` (Historie: ${result.historyFrom} – ${result.historyTo})`
                    : '';
            return {
                ok: true,
                message: `${result.updated} Monat(e) aus Historie berechnet${range}`,
                ...result,
            };
        }

        if (action === 'rebuildFromHistory') {
            const fromYear = parseInt(body.fromYear) || 2018;
            const fromMonth = parseInt(body.fromMonth) || 5;
            const result = await this._refreshAutoYields({
                fromYear,
                fromMonth,
                force: true,
            });
            const range =
                result.historyFrom && result.historyTo
                    ? `${result.historyFrom} – ${result.historyTo}`
                    : 'keine Historie';
            let msg =
                `${result.updated} Monat(e) neu berechnet (ab ${String(fromMonth).padStart(2, '0')}/${fromYear}). ` +
                `Historie im Cache: ${range}.`;
            if (result.historyFrom && result.historyFrom > `${fromYear}-${String(fromMonth).padStart(2, '0')}-01`) {
                msg += ` Ältere Monate fehlen in der Historie – Backup/Import nutzen oder scripts/combine-yields.js auf dem Server.`;
            }
            return { ok: true, message: msg, ...result };
        }

        if (action === 'restoreBackup') {
            const tried = [];
            const tryFile = async filePath => {
                tried.push(filePath);
                return this._readYieldsFile(filePath);
            };
            let data = this._yieldsCachePath ? await tryFile(`${this._yieldsCachePath}.bak`) : null;
            if (!data || !Object.keys(data.months).length) {
                data = await this._readYieldsSnapshotState();
                if (data) {
                    tried.push('yields.snapshot');
                }
            }
            if (!data || !Object.keys(data.months).length) {
                for (const dir of this._legacyDataDirs()) {
                    data = await tryFile(path.join(dir, 'monthly-yields.json.bak'));
                    if (data && Object.keys(data.months).length) {
                        break;
                    }
                    data = await tryFile(path.join(dir, 'monthly-yields.json'));
                    if (data && Object.keys(data.months).length) {
                        break;
                    }
                }
            }
            if (!data || !Object.keys(data.months).length) {
                throw new Error(`Kein Backup gefunden (${tried.join(', ') || 'keine Pfade'})`);
            }
            this._monthlyYields = data;
            await this._saveMonthlyYields({ force: true });
            return {
                ok: true,
                message: `${Object.keys(data.months).length} Monate aus Backup wiederhergestellt`,
            };
        }

        if (action === 'restoreFromInflux') {
            if (!this._cfg.influxEnable) {
                throw new Error('InfluxDB-Sync ist nicht aktiv – in den Adapter-Einstellungen einschalten');
            }
            const data = await this._loadYieldsFromInflux();
            if (!data || !Object.keys(data.months).length) {
                throw new Error('InfluxDB enthält noch keine Monatserträge (yield.monthly)');
            }
            const mode = body.mode === 'replace' ? 'replace' : 'merge';
            if (mode === 'replace') {
                this._monthlyYields = data;
            } else {
                this._monthlyYields.extraYears = [
                    ...new Set([...(this._monthlyYields.extraYears || []), ...(data.extraYears || [])]),
                ].sort((a, b) => a - b);
                Object.entries(data.months).forEach(([key, entry]) => {
                    const existing = this._monthlyYields.months[key];
                    if (existing?.source === 'manual') {
                        return;
                    }
                    this._monthlyYields.months[key] = entry;
                });
            }
            await this._saveMonthlyYields({ force: true });
            return {
                ok: true,
                message: `${Object.keys(this._monthlyYields.months).length} Monate aus InfluxDB (${mode})`,
            };
        }

        if (action === 'clearAuto') {
            let cleared = 0;
            Object.keys(this._monthlyYields.months).forEach(key => {
                if (this._monthlyYields.months[key].source === 'auto') {
                    delete this._monthlyYields.months[key];
                    cleared++;
                }
            });
            await this._saveMonthlyYields();
            return { ok: true, message: `${cleared} automatische Einträge entfernt` };
        }

        if (action === 'addYear') {
            const year = parseInt(body.year);
            if (!year || year < 1990 || year > 2100) {
                throw new Error('Ungültiges Jahr (1990–2100)');
            }
            if (!this._monthlyYields.extraYears) {
                this._monthlyYields.extraYears = [];
            }
            if (!this._monthlyYields.extraYears.includes(year)) {
                this._monthlyYields.extraYears.push(year);
                this._monthlyYields.extraYears.sort((a, b) => a - b);
            }
            await this._saveMonthlyYields();
            return { ok: true, message: `Jahr ${year} hinzugefügt` };
        }

        if (action === 'fillYears') {
            const from = body.fromYear
                ? parseInt(body.fromYear)
                : this._pikoEpoch
                  ? new Date(this._pikoEpoch * 1000).getFullYear()
                  : 2010;
            const to = body.toYear ? parseInt(body.toYear) : new Date().getFullYear();
            if (!from || from < 1990 || to > 2100 || from > to) {
                throw new Error('Ungültiger Jahresbereich');
            }
            if (!this._monthlyYields.extraYears) {
                this._monthlyYields.extraYears = [];
            }
            let added = 0;
            for (let y = from; y <= to; y++) {
                if (!this._monthlyYields.extraYears.includes(y)) {
                    this._monthlyYields.extraYears.push(y);
                    added++;
                }
            }
            this._monthlyYields.extraYears.sort((a, b) => a - b);
            await this._saveMonthlyYields();
            return { ok: true, message: `${added} Jahr(e) hinzugefügt (${from}–${to})` };
        }

        if (action === 'removeYear') {
            const year = parseInt(body.year);
            if (!year) {
                throw new Error('Jahr fehlt');
            }
            if (this._monthlyYields.extraYears) {
                this._monthlyYields.extraYears = this._monthlyYields.extraYears.filter(y => y !== year);
            }
            if (body.clearData) {
                for (let m = 1; m <= 12; m++) {
                    delete this._monthlyYields.months[this._monthKey(year, m)];
                }
            }
            await this._saveMonthlyYields();
            return { ok: true, message: `Jahr ${year} entfernt` };
        }

        if (action === 'import') {
            const mode = body.mode === 'replace' ? 'replace' : 'merge';
            let imported = 0;

            if (body.data && typeof body.data === 'object') {
                const payload = body.data;
                if (payload.feedInTariff !== undefined) {
                    const t = parseFloat(String(payload.feedInTariff).replace(',', '.'));
                    if (!isNaN(t)) {
                        this._monthlyYields.feedInTariff = t;
                    }
                }
                if (payload.installedKwp !== undefined) {
                    const k = parseFloat(String(payload.installedKwp).replace(',', '.'));
                    if (!isNaN(k)) {
                        this._monthlyYields.installedKwp = k;
                    }
                }
                if (payload.plzRegion !== undefined) {
                    this._monthlyYields.plzRegion = String(payload.plzRegion).trim();
                }
                if (Array.isArray(payload.extraYears)) {
                    this._monthlyYields.extraYears = [
                        ...new Set([
                            ...(this._monthlyYields.extraYears || []),
                            ...payload.extraYears.map(y => parseInt(y)).filter(Boolean),
                        ]),
                    ].sort((a, b) => a - b);
                }
                if (mode === 'replace' && payload.months) {
                    this._monthlyYields.months = {};
                }
                if (payload.months && typeof payload.months === 'object') {
                    Object.entries(payload.months).forEach(([key, entry]) => {
                        const parsed = this._parseMonthKey(key);
                        if (!parsed) {
                            return;
                        }
                        const wh = typeof entry === 'object' ? entry.wh : entry;
                        const n = Math.round(parseFloat(String(wh).replace(',', '.')));
                        if (!n || n <= 0) {
                            return;
                        }
                        const existing = this._monthlyYields.months[key];
                        if (mode === 'merge' && existing?.source === 'auto' && entry?.source !== 'manual') {
                            return;
                        }
                        this._monthlyYields.months[key] = {
                            wh: n,
                            source: 'manual',
                            updatedAt: new Date().toISOString(),
                        };
                        imported++;
                    });
                }
            } else if (body.csv && typeof body.csv === 'string') {
                imported = this._importYieldsCsv(body.csv, mode);
            } else {
                throw new Error('Keine Import-Daten (data oder csv)');
            }

            await this._saveMonthlyYields({ force: true });
            return { ok: true, message: `${imported} Monatswerte importiert (${mode})` };
        }

        throw new Error('Unbekannte Aktion');
    }

    _importYieldsCsv(csv, mode) {
        const monthNames = {
            januar: 1,
            jan: 1,
            februar: 2,
            feb: 2,
            märz: 3,
            mar: 3,
            maerz: 3,
            april: 4,
            apr: 4,
            mai: 5,
            juni: 6,
            jun: 6,
            juli: 7,
            jul: 7,
            august: 8,
            aug: 8,
            september: 9,
            sep: 9,
            oktober: 10,
            okt: 10,
            november: 11,
            nov: 11,
            dezember: 12,
            dez: 12,
        };
        const lines = csv
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);
        if (lines.length < 2) {
            return 0;
        }

        const sep = lines[0].includes(';') ? ';' : ',';
        const header = lines[0].split(sep).map(h => h.trim());
        const yearCols = [];
        header.forEach((h, i) => {
            if (i === 0) {
                return;
            }
            const ym = h.match(/(\d{4})/);
            if (ym) {
                yearCols.push({ index: i, year: parseInt(ym[1]) });
            }
        });
        if (!yearCols.length) {
            throw new Error('CSV: keine Jahres-Spalten gefunden');
        }

        if (mode === 'replace') {
            this._monthlyYields.months = {};
        }
        if (!this._monthlyYields.extraYears) {
            this._monthlyYields.extraYears = [];
        }
        yearCols.forEach(c => {
            if (!this._monthlyYields.extraYears.includes(c.year)) {
                this._monthlyYields.extraYears.push(c.year);
            }
        });
        this._monthlyYields.extraYears.sort((a, b) => a - b);

        let imported = 0;
        for (let li = 1; li < lines.length; li++) {
            const cols = lines[li].split(sep).map(c => c.trim());
            const monthKey =
                monthNames[cols[0].toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')];
            if (!monthKey) {
                continue;
            }
            yearCols.forEach(({ index, year }) => {
                const raw = cols[index];
                if (!raw) {
                    return;
                }
                const n = Math.round(parseFloat(raw.replace(/\./g, '').replace(',', '.')));
                if (!n || n <= 0) {
                    return;
                }
                const key = this._monthKey(year, monthKey);
                const existing = this._monthlyYields.months[key];
                if (mode === 'merge' && existing?.source === 'auto') {
                    return;
                }
                this._monthlyYields.months[key] = {
                    wh: n,
                    source: 'manual',
                    updatedAt: new Date().toISOString(),
                };
                imported++;
            });
        }
        return imported;
    }

    _exportYieldsCsv() {
        const resp = this._buildYieldsApiResponse();
        const sep = ';';
        const header = ['Monat', ...resp.years.map(y => `${y} [Wh]`)].join(sep);
        const rows = resp.grid.map(row => {
            const vals = resp.years.map(y => {
                const wh = row.cells[y]?.wh;
                return wh > 0 ? String(wh) : '';
            });
            return [row.name, ...vals].join(sep);
        });
        const sum = ['Σ Jahr [Wh]', ...resp.years.map(y => resp.yearTotals[y] || '')].join(sep);
        return [header, ...rows, sum].join('\n');
    }

    _readPostBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', chunk => {
                data += chunk;
                if (data.length > 1e6) {
                    req.destroy();
                    reject(new Error('Request zu groß'));
                }
            });
            req.on('end', () => {
                try {
                    resolve(data ? JSON.parse(data) : {});
                } catch (_e) {
                    reject(new Error('Ungültiges JSON'));
                }
            });
            req.on('error', reject);
        });
    }

    _getStringCount() {
        const fromData = parseInt(this._lastData['device.strings']);
        if (fromData === 2 || fromData === 3) {
            return fromData;
        }
        const model = (this._cfg.pikoModel || 'auto').toLowerCase();
        if (model.includes('5.5') || model.includes('10.1')) {
            return 3;
        }
        return 2;
    }

    _historyColValue(row, col) {
        switch (col) {
            case COL.DC1_U:
                return row.dc1?.voltage;
            case COL.DC1_I:
                return row.dc1?.current;
            case COL.DC1_P:
                return row.dc1?.power;
            case COL.DC2_U:
                return row.dc2?.voltage;
            case COL.DC2_I:
                return row.dc2?.current;
            case COL.DC2_P:
                return row.dc2?.power;
            case COL.DC3_U:
                return row.dc3?.voltage;
            case COL.DC3_I:
                return row.dc3?.current;
            case COL.DC3_P:
                return row.dc3?.power;
            case COL.AC1_U:
                return row.ac1?.voltage;
            case COL.AC1_I:
                return row.ac1?.current;
            case COL.AC1_P:
                return row.ac1?.power;
            case COL.AC2_U:
                return row.ac2?.voltage;
            case COL.AC2_I:
                return row.ac2?.current;
            case COL.AC2_P:
                return row.ac2?.power;
            case COL.AC3_U:
                return row.ac3?.voltage;
            case COL.AC3_I:
                return row.ac3?.current;
            case COL.AC3_P:
                return row.ac3?.power;
            case COL.AC_F:
                return row.frequency;
            case COL.AC_S:
                return row.acStatus;
            case COL.ERR:
                return row.errorCode;
            case COL.TOTAL_E:
                return row.totalEnergy;
            default:
                return null;
        }
    }

    _calcHistVal(row, def) {
        if (def.col === null) {
            if (def.id === 'history.ac.totalPower') {
                return row.ac1.power + row.ac2.power + row.ac3.power;
            }
            if (def.id === 'history.dc.totalPower') {
                return (row.dc1?.power || 0) + (row.dc2?.power || 0) + (row.dc3?.power || 0);
            }
            if (def.id === 'history.efficiency.ratio') {
                const dc = (row.dc1?.power || 0) + (row.dc2?.power || 0) + (row.dc3?.power || 0);
                const ac = row.acTotalPower || 0;
                if (dc < 50) {
                    return null;
                }
                return Math.round((ac / dc) * 1000) / 10;
            }
            return null;
        }
        const val = this._historyColValue(row, def.col);
        if (val === null || val === undefined) {
            return null;
        }
        return Math.round(val * 1000) / 1000;
    }

    // ─── Parser: LogDaten.dat ───────────────────────────────────────────────────

    _parseLogDaten(raw, pikoEpoch) {
        const lines = raw.split(/\r?\n/);
        const rows = [];

        for (const line of lines) {
            if (!line.trim()) {
                continue;
            }
            const cols = line.split('\t').map(s => s.trim());
            const zeit = parseInt(cols[COL.ZEIT]);
            if (isNaN(zeit) || zeit < 1000) {
                continue;
            }

            // Ereigniszeile erkennen (enthält Hex-Code wie "80001200h")
            const isEvent = cols.some(c => /^[0-9a-fA-F]{4,}h$/.test(c));

            // Nur normale Messzeilen (mind. 38 Spalten mit Zahlen)
            if (!isEvent && cols.length < 38) {
                continue;
            }
            if (isEvent) {
                continue;
            } // Ereigniszeilen vorerst überspringen

            const ts = (pikoEpoch + zeit) * 1000; // ms

            const int = i => parseInt(cols[i]) || 0;
            const flt = i => parseFloat(cols[i]) || 0;

            rows.push({
                ts,
                date: new Date(ts).toISOString(),
                dc1: {
                    voltage: int(COL.DC1_U),
                    current: int(COL.DC1_I) / 1000,
                    power: int(COL.DC1_P),
                    status: int(COL.DC1_S),
                },
                dc2: {
                    voltage: int(COL.DC2_U),
                    current: int(COL.DC2_I) / 1000,
                    power: int(COL.DC2_P),
                    status: int(COL.DC2_S),
                },
                dc3: {
                    voltage: int(COL.DC3_U),
                    current: int(COL.DC3_I) / 1000,
                    power: int(COL.DC3_P),
                    status: int(COL.DC3_S),
                },
                ac1: { voltage: int(COL.AC1_U), current: int(COL.AC1_I) / 1000, power: int(COL.AC1_P) },
                ac2: { voltage: int(COL.AC2_U), current: int(COL.AC2_I) / 1000, power: int(COL.AC2_P) },
                ac3: { voltage: int(COL.AC3_U), current: int(COL.AC3_I) / 1000, power: int(COL.AC3_P) },
                frequency: flt(COL.AC_F),
                acStatus: int(COL.AC_S),
                errorCode: int(COL.ERR),
                ensStatus: int(COL.ENS_S),
                busStatus: int(COL.KB_S),
                acTotalPower: int(COL.AC1_P) + int(COL.AC2_P) + int(COL.AC3_P),
                totalEnergy: flt(COL.TOTAL_E),
            });
        }

        rows.sort((a, b) => a.ts - b.ts); // älteste zuerst
        return rows;
    }

    // ─── HTTP-Client ─────────────────────────────────────────────────────────────

    _fetchPage(path, timeoutMs = 15000) {
        const maxBytes = path === POLL_URLS.log ? 12 * 1024 * 1024 : 2 * 1024 * 1024;
        return new Promise((resolve, reject) => {
            const auth = Buffer.from(`${this._cfg.user}:${this._cfg.password}`).toString('base64');
            let settled = false;
            let absTimer;
            const done = (err, data) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (absTimer) {
                    this.clearTimeout(absTimer);
                }
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            };
            const req = http.request(
                {
                    hostname: this._cfg.ip,
                    port: this._cfg.port,
                    path,
                    method: 'GET',
                    timeout: timeoutMs,
                    headers: {
                        Authorization: `Basic ${auth}`,
                        'User-Agent': `ioBroker-KostalPiko/${ADAPTER_VERSION}`,
                    },
                },
                res => {
                    const chunks = [];
                    let total = 0;
                    res.on('data', c => {
                        total += c.length;
                        if (total > maxBytes) {
                            req.destroy();
                            return done(new Error(`${path} zu groß (${total} bytes)`));
                        }
                        chunks.push(c);
                    });
                    res.on('end', () => {
                        if (res.statusCode === 401) {
                            return done(new Error('Auth fehlgeschlagen (401)'));
                        }
                        if (res.statusCode !== 200) {
                            return done(new Error(`HTTP ${res.statusCode} für ${path}`));
                        }
                        const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
                        const data = Buffer.isBuffer(buf) ? buf.toString('latin1') : String(buf);
                        const declared = parseInt(res.headers['content-length'], 10);
                        if (declared > 10000 && data.length < declared * 0.5) {
                            return done(new Error(`truncated ${path} (got ${data.length} of ${declared} bytes)`));
                        }
                        done(null, data);
                    });
                },
            );
            req.on('timeout', () => {
                req.destroy();
                done(new Error(`Timeout für ${path}`));
            });
            req.on('error', e => done(e));
            absTimer = this.setTimeout(() => {
                req.destroy();
                done(new Error(`Timeout für ${path}`));
            }, timeoutMs);
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
        const re = /bgcolor="#FFFFFF">\s*([\s\S]*?)\s*<\/td>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            cells.push(m[1].trim());
        }

        // Status lesen
        const statusMatch = html.match(/Status<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i);
        const status = statusMatch ? statusMatch[1].trim() : null;

        // Offline: "x x x" in Messwert-Zellen (beide Modelle)
        const isXxx = s => /^x\s+x\s+x$/i.test(s || '');
        const isOff = !status || status.toLowerCase() === 'aus' || cells.some(c => isXxx(c));
        const isOn = !isOff;

        // Modell-Name: aus Config-Override oder HTML lesen
        let modelName;
        if (this._cfg && this._cfg.pikoModel !== 'auto') {
            const modelMap = {
                'piko3.0': 'PIKO 3.0',
                'piko3.6': 'PIKO 3.6',
                'piko4.2': 'PIKO 4.2',
                'piko5.5': 'PIKO 5.5',
                'piko7.0': 'PIKO 7.0',
                'piko8.3': 'PIKO 8.3',
                'piko10.1': 'PIKO 10.1',
            };
            modelName = modelMap[this._cfg.pikoModel] || 'PIKO';
        } else {
            const modelMatch =
                html.match(/<font[^>]*size="\+3"[^>]*>\s*([\w\s.]+)\s*<br/i) || html.match(/>(PIKO\s+[\d.]+)</i);
            modelName = modelMatch ? modelMatch[1].trim() : 'PIKO';
        }

        // Strings bestimmen: aus Config-Override oder Auto-Erkennung über Zellenanzahl
        //   13 Zellen = 2 Strings (PIKO 3.6/4.2/7.0/8.3)
        //   15 Zellen = 3 Strings (PIKO 5.5/10.1)
        const modelCfg = this._cfg ? this._cfg.pikoModel : 'auto';
        const modelStr3 = ['piko5.5', 'piko10.1'].includes(modelCfg);
        const has3Strings = modelCfg === 'auto' ? cells.length >= 15 : modelStr3;

        // Messwert-Parser
        const toNum = s => {
            if (!s || isXxx(s) || s === '&nbsp;') {
                return 0;
            }
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? 0 : v;
        };
        const toEnergy = s => {
            if (!s || isXxx(s)) {
                return null;
            }
            const v = parseFloat(s.replace(',', '.'));
            return isNaN(v) ? null : v;
        };

        const result = {
            status: status || 'Aus',
            online: isOn ? 1 : 0,
            'device.strings': has3Strings ? 3 : 2,
            'device.model': modelName,
        };

        if (cells.length >= 10) {
            result['ac.power'] = isOn ? toNum(cells[0]) : 0;

            // Energie immer lesen (auch offline gültig)
            const eTot = toEnergy(cells[1]);
            const eDay = toEnergy(cells[2]);
            if (eTot !== null) {
                result['energy.total'] = eTot;
            }
            if (eDay !== null) {
                result['energy.today'] = eDay;
            }

            // INTERLEAVED: String und L-Phase in gleicher HTML-Tabellenzeile
            // cells[3]=S1U, cells[4]=L1U, cells[5]=S1I, cells[6]=L1P
            // cells[7]=S2U, cells[8]=L2U, cells[9]=S2I, cells[10]=L2P
            result['pv.string1.voltage'] = isOn ? toNum(cells[3]) : 0;
            result['ac.l1.voltage'] = isOn ? toNum(cells[4]) : 0;
            result['pv.string1.current'] = isOn ? toNum(cells[5]) : 0;
            result['ac.l1.power'] = isOn ? toNum(cells[6]) : 0;
            result['pv.string2.voltage'] = isOn ? toNum(cells[7]) : 0;
            result['ac.l2.voltage'] = isOn ? toNum(cells[8]) : 0;
            result['pv.string2.current'] = isOn ? toNum(cells[9]) : 0;
            result['ac.l2.power'] = isOn ? toNum(cells[10]) : 0;

            if (has3Strings) {
                // PIKO 5.5: cells[11]=S3U, cells[12]=L3U, cells[13]=S3I, cells[14]=L3P
                result['pv.string3.voltage'] = isOn ? toNum(cells[11]) : 0;
                result['ac.l3.voltage'] = isOn && cells.length > 12 ? toNum(cells[12]) : 0;
                result['pv.string3.current'] = isOn && cells.length > 13 ? toNum(cells[13]) : 0;
                result['ac.l3.power'] = isOn && cells.length > 14 ? toNum(cells[14]) : 0;
            } else {
                // PIKO 8.3: cells[11]=L3U, cells[12]=L3P (keine String3-Zeile)
                result['ac.l3.voltage'] = isOn && cells.length > 11 ? toNum(cells[11]) : 0;
                result['ac.l3.power'] = isOn && cells.length > 12 ? toNum(cells[12]) : 0;
            }
        }

        const busM = html.match(/name="[^"]*[Aa]dr[^"]*"[^>]*value="(\d+)"/i);
        if (busM) {
            result['rs485.busAddress'] = parseInt(busM[1]);
        }
        return result;
    }

    // ─── Parser: Infoseite (Inf.fhtml) ───────────────────────────────────────────

    _parseInfoPage(html) {
        const r = {};
        const re = /(\d+)\.\s+analoger\s+Eingang:\s*<b>([\d.,]+)V<\/b>/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
            r[`info.analog${m[1]}`] = parseFloat(m[2].replace(',', '.'));
        }
        const mm = html.match(/Modemstatus:\s*<b>([^<]+)<\/b>/i);
        if (mm) {
            r['info.modemStatus'] = mm[1].trim();
        }
        const pm = html.match(/letzte\s+Verbindung\s+zum\s+Portal:\s*<b>([^<]+)<\/b>/i);
        if (pm) {
            r['info.lastPortalConnection'] = pm[1].trim();
        }
        const sm = html.match(/Anzahl\s+der\s+Energiepulse[^:]*:\s*<b>(\d+)<\/b>/i);
        if (sm) {
            r['info.s0Pulses'] = parseInt(sm[1]);
        }
        return r;
    }

    _getModuleParams() {
        const presetKey = this._cfg.modulePreset;
        const preset = presetKey ? MODULE_PRESETS[presetKey] : null;
        const manual = !!this._cfg.moduleManualOverride;

        let wp = this._cfg.moduleWp;
        let voc = this._cfg.moduleVoc;
        let vmpp = this._cfg.moduleVmpp;

        if (preset && !manual) {
            wp = preset.wp;
            voc = preset.voc;
            vmpp = preset.vmpp;
        } else if (preset) {
            if (!wp) {
                wp = preset.wp;
            }
            if (!voc) {
                voc = preset.voc;
            }
            if (!vmpp) {
                vmpp = preset.vmpp;
            }
        }

        if (!vmpp && voc) {
            vmpp = Math.round(voc * VMPP_VOC_RATIO * 100) / 100;
        }

        const vmppNoct = preset?.vmppNoct || (vmpp ? Math.round(vmpp * 0.898 * 100) / 100 : 0);
        const betaVmpp = preset?.betaVmpp ?? DEFAULT_BETA_VMPP;
        const betaPmax = preset?.betaPmax ?? betaVmpp;
        const impp = preset?.impp ?? 7.63;
        const noctStd = preset?.noct ?? 46;
        const noctEff = this._cfg.moduleNoctEff > 0 ? this._cfg.moduleNoctEff : noctStd;

        return {
            wp,
            voc,
            vmpp,
            vmppNoct,
            betaVmpp,
            betaPmax,
            impp,
            noct: noctEff,
            noctStd,
            presetName: preset?.name || null,
            presetKey,
        };
    }

    async _applyModulePresetToInstance(presetId, preset) {
        const instId = `system.adapter.${this.namespace}`;
        const obj = await this.getObjectAsync(instId);
        if (!obj?.native) {
            throw new Error('Instanz-Konfiguration nicht lesbar');
        }
        const native = {
            ...obj.native,
            modulePreset: presetId,
            moduleWp: preset.wp,
            moduleVoc: preset.voc,
            moduleVmpp: preset.vmpp,
            moduleManualOverride: false,
        };
        await this.setForeignObjectAsync(instId, { ...obj, native });
        this._cfg.modulePreset = presetId;
        this._cfg.moduleWp = preset.wp;
        this._cfg.moduleVoc = preset.voc;
        this._cfg.moduleVmpp = preset.vmpp;
        this._cfg.moduleManualOverride = false;
    }

    async _syncModulePresetConfig() {
        if (this._cfg.moduleManualOverride || !this._cfg.modulePreset) {
            return;
        }
        const preset = MODULE_PRESETS[this._cfg.modulePreset];
        if (!preset) {
            return;
        }
        const needsSync =
            this._cfg.moduleWp !== preset.wp ||
            this._cfg.moduleVoc !== preset.voc ||
            this._cfg.moduleVmpp !== preset.vmpp;
        if (!needsSync) {
            return;
        }
        try {
            await this._applyModulePresetToInstance(this._cfg.modulePreset, preset);
            this._log('INFO', `Modul-Vorlage "${preset.name}" in Instanz-Konfiguration übernommen`);
        } catch (e) {
            this._log('WARN', `Modul-Vorlage konnte nicht synchronisiert werden: ${e.message}`);
        }
    }

    _getStringAnalysisConfig() {
        const { wp, voc, vmpp, vmppNoct, betaVmpp, impp } = this._getModuleParams();
        if (!voc || !wp || !vmpp) {
            return { enabled: false, strings: [] };
        }
        const inv = this._getInverterSpecs();
        const strings = [];
        for (const s of [
            { id: 1, count: this._cfg.string1Modules },
            { id: 2, count: this._cfg.string2Modules },
            { id: 3, count: this._cfg.string3Modules },
        ]) {
            if (!s.count) {
                continue;
            }
            const vocString = voc * s.count;
            const mppStc = vmpp * s.count;
            const mppTypical = vmppNoct * s.count; // typische Betriebsspannung warm
            strings.push({
                id: s.id,
                modules: s.count,
                expectedVoltage: Math.round(vocString * 10) / 10,
                expectedMpp: Math.round(mppStc * 10) / 10,
                expectedPower: wp * s.count,
                vmppPerModule: vmpp,
                vmppStc: vmpp,
                betaVmpp,
                imppString: Math.round(impp * s.count * 100) / 100,
                mppMin: Math.round(mppTypical * 0.88 * 10) / 10,
                mppMax: Math.round(mppStc * 1.06 * 10) / 10,
                invDcMaxV: inv.enabled ? inv.dcMaxV : null,
                invDcMinV: inv.enabled ? inv.dcMinV : null,
                invMppMin: inv.enabled ? inv.mppMinActive : null,
                invMppMax: inv.enabled ? inv.mppMax : null,
                invDcMaxA: inv.enabled ? inv.dcMaxA : null,
            });
        }
        return {
            enabled: strings.length > 0,
            strings,
            vmpp,
            voc,
            betaVmpp,
            preset: this._cfg.modulePreset,
            noct: this._getModuleParams().noct,
            inverter: inv,
        };
    }

    _getTemperatureAnalysis() {
        const cfg = this._getStringAnalysisConfig();
        if (!cfg.enabled) {
            return { enabled: false, strings: [], system: null };
        }
        const strings = cfg.strings.map(scfg => {
            const prefix = `string${scfg.id}`;
            const validRel = !!this._lastData[`${prefix}.tempValidRelative`];
            const validAbs = !!this._lastData[`${prefix}.tempValidAbsolute`];
            const tempRaw = this._lastData[`${prefix}.tempEquivalentC`];
            const quality = this._lastData[`${prefix}.tempQuality`] || 'UNGUELTIG';
            const usable = quality !== 'UNGUELTIG' && tempRaw;
            return {
                id: scfg.id,
                modules: scfg.modules,
                vmppPerModule: this._lastData[`${prefix}.vmppPerModule`] || 0,
                tempC: usable ? tempRaw : null,
                tempQuality: quality,
                uncertainty: this._lastData[`${prefix}.tempUncertaintyK`] ?? null,
                validRelative: validRel,
                validAbsolute: validAbs,
                tempDeltaK: this._lastData[`${prefix}.tempDeltaK`] ?? 0,
                tempLossW: this._lastData[`${prefix}.tempLossW`] ?? 0,
                powerAt25C: this._lastData[`${prefix}.powerAt25C`] ?? 0,
                mppUtilization: this._lastData[`${prefix}.mppUtilization`] ?? 0,
                alert: this._lastData[`${prefix}.tempAlert`] || 'UNBEKANNT',
            };
        });
        return {
            enabled: strings.length > 0,
            strings,
            system: {
                deltaStrings: this._lastData['temperature.deltaStrings'] ?? 0,
                deltaValid: !!this._lastData['temperature.deltaValid'],
                totalLossW: this._lastData['temperature.totalLossW'] ?? 0,
                totalLossKwhDay: this._lastData['temperature.totalLossKwhDay'] ?? 0,
                hottest: this._lastData['temperature.hottest'] || '',
                systemAlert: this._lastData['temperature.systemAlert'] || 'UNBEKANNT',
            },
        };
    }

    // ─── Modul-Analyse: Soll-Werte berechnen ────────────────────────────────────────

    async _writeModuleStates() {
        const { wp, voc, vmpp } = this._getModuleParams();
        if (!voc || !wp || !vmpp) {
            return;
        }

        const strings = [
            { id: '1', count: this._cfg.string1Modules },
            { id: '2', count: this._cfg.string2Modules },
            { id: '3', count: this._cfg.string3Modules },
        ];

        for (const s of strings) {
            if (!s.count) {
                continue;
            }
            const expectedVoc = Math.round(voc * s.count * 10) / 10;
            const expectedMpp = Math.round(vmpp * s.count * 10) / 10;
            const expectedPower = wp * s.count;
            await this.setStateAsync(`string${s.id}.expectedVoltage`, { val: expectedMpp, ack: true });
            await this.setStateAsync(`string${s.id}.expectedVoc`, { val: expectedVoc, ack: true });
            await this.setStateAsync(`string${s.id}.expectedPower`, { val: expectedPower, ack: true });
        }
    }

    // ─── Benachrichtigungen ─────────────────────────────────────────────────────

    _startNotifyTimer() {
        if (this._notifyTimer) {
            this.clearInterval(this._notifyTimer);
        }
        // Jede Minute prüfen ob ein Bericht fällig ist
        this._notifyTimer = this.setInterval(() => this._checkNotify(), 60 * 1000);
        this._log('SYSTEM', 'Benachrichtigungs-Timer gestartet');
    }

    _checkNotify() {
        if (!this._cfg.notifyEnabled) {
            return;
        }
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const dow = now.getDay(); // 0=So, 1=Mo
        const dom = now.getDate(); // 1–31

        // Tagesbericht
        if (this._cfg.notifyDaily && hhmm === this._cfg.notifyDailyTime) {
            const key = `daily-${now.toDateString()}`;
            if (this._lastNotifySent.daily !== key) {
                this._lastNotifySent.daily = key;
                this._sendDailyReport().catch(e => this._log('WARN', `Tagesbericht: ${e.message}`));
            }
        }
        // Wochenbericht (Montag)
        if (this._cfg.notifyWeekly && dow === 1 && hhmm === this._cfg.notifyWeeklyTime) {
            const key = `weekly-${now.toDateString()}`;
            if (this._lastNotifySent.weekly !== key) {
                this._lastNotifySent.weekly = key;
                this._sendWeeklyReport().catch(e => this._log('WARN', `Wochenbericht: ${e.message}`));
            }
        }
        // Monatsbericht (1. des Monats)
        if (this._cfg.notifyMonthly && dom === 1 && hhmm === this._cfg.notifyMonthlyTime) {
            const key = `monthly-${now.toDateString()}`;
            if (this._lastNotifySent.monthly !== key) {
                this._lastNotifySent.monthly = key;
                this._sendMonthlyReport().catch(e => this._log('WARN', `Monatsbericht: ${e.message}`));
            }
        }
        // Alarm
        if (this._cfg.notifyAlert && hhmm === this._cfg.notifyAlertTime) {
            const key = `alert-${now.toDateString()}`;
            if (this._lastNotifySent.alert !== key) {
                this._lastNotifySent.alert = key;
                this._checkDayAlert().catch(e => this._log('WARN', `Alarm-Check: ${e.message}`));
            }
        }
    }

    _getRowsForDate(date) {
        // Alle History-Rows für ein bestimmtes Datum
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return this._lastHistoryRows.filter(r => {
            const ts = new Date(r.date).getTime();
            return ts >= start.getTime() && ts <= end.getTime();
        });
    }

    _getPreviousCalendarWeek() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const thisMonday = new Date(today);
        thisMonday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
        const prevMonday = new Date(thisMonday);
        prevMonday.setDate(thisMonday.getDate() - 7);
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(prevMonday);
            d.setDate(prevMonday.getDate() + i);
            days.push(d);
        }
        return { days, weekNum: this._isoWeek(prevMonday), start: prevMonday };
    }

    _getInstalledKwp() {
        const wp = this._getModuleParams().wp || this._cfg.moduleWp || 0;
        if (!wp) {
            return 0;
        }
        const modules =
            (this._cfg.string1Modules || 0) + (this._cfg.string2Modules || 0) + (this._cfg.string3Modules || 0);
        return modules > 0 ? Math.round(((wp * modules) / 1000) * 1000) / 1000 : 0;
    }

    _formatDuration(minutes) {
        if (!minutes) {
            return '0 min';
        }
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        return h > 0 ? `${h} h ${m} min` : `${m} min`;
    }

    _formatKwpLine(kwh, kwp) {
        if (!kwp) {
            return '';
        }
        return `📐 Spez. Ertrag: ${(kwh / kwp).toFixed(2)} kWh/kWp (Anlage: ${kwp.toFixed(2)} kWp)\n`;
    }

    _escHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _parseRecipients(raw) {
        if (!raw) {
            return [];
        }
        return [
            ...new Set(
                String(raw)
                    .split(/[,;]+/)
                    .map(s => s.trim())
                    .filter(Boolean),
            ),
        ];
    }

    _getRecipientsForReport(kind) {
        const primary = this._parseRecipients(this._cfg.notifyRecipient);
        if (kind === 'weekly') {
            return [...new Set([...primary, ...this._parseRecipients(this._cfg.notifyRecipientWeekly)])];
        }
        if (kind === 'monthly') {
            return [...new Set([...primary, ...this._parseRecipients(this._cfg.notifyRecipientMonthly)])];
        }
        return primary;
    }

    _reportBaseCss() {
        return `
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#1a1a1a;margin:0;padding:0;background:#f4f4f4;}
.page{max-width:210mm;margin:0 auto;background:#fff;padding:14px 16px;box-sizing:border-box;}
.hdr{border-bottom:3px solid #1565c0;padding-bottom:8px;margin-bottom:12px;}
.hdr h1{font-size:18px;margin:0 0 4px;color:#1565c0;}
.hdr .sub{font-size:12px;color:#555;}
.kpis{display:table;width:100%;border-collapse:separate;border-spacing:6px;margin:10px 0 14px;}
.kpi{display:table-cell;background:#e3f2fd;border:1px solid #90caf9;border-radius:6px;padding:8px 10px;text-align:center;vertical-align:top;}
.kpi .v{font-size:16px;font-weight:bold;color:#0d47a1;}
.kpi .l{font-size:9px;color:#555;margin-top:2px;}
.sec{margin:14px 0 8px;}
.sec h2{font-size:13px;margin:0 0 6px;color:#1565c0;border-left:4px solid #1565c0;padding-left:8px;}
.chart{margin:6px 0 12px;text-align:center;}
.tbl{width:100%;border-collapse:collapse;font-size:10px;margin:8px 0;}
.tbl th{background:#1565c0;color:#fff;padding:5px 6px;text-align:left;}
.tbl td{border-bottom:1px solid #e0e0e0;padding:4px 6px;}
.tbl tr:nth-child(even) td{background:#f5f5f5;}
.tbl .num{text-align:right;font-variant-numeric:tabular-nums;}
.tbl tfoot td{font-weight:bold;background:#e8eaf6;}
.weather{background:#fff8e1;border:1px solid #ffcc80;border-radius:6px;padding:10px 12px;margin-top:12px;}
.weather h3{margin:0 0 6px;font-size:12px;color:#e65100;}
.cmp{background:#f1f8e9;border:1px solid #aed581;border-radius:6px;padding:10px 12px;margin-top:10px;}
.cmp h3{margin:0 0 6px;font-size:12px;color:#33691e;}
.foot{margin-top:14px;padding-top:8px;border-top:1px solid #ddd;font-size:9px;color:#888;text-align:center;}
.warn{color:#c62828;font-weight:bold;}
@media print{body{background:#fff;}.page{max-width:none;padding:10mm;}}
`;
    }

    _reportPageHtml(title, subtitle, bodyHtml, testMode) {
        const testBanner = testMode
            ? '<p class="warn" style="margin:0 0 10px;">⚠️ TESTBERICHT – Vorschau, nicht der geplante Versand</p>'
            : '';
        return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${this._escHtml(title)}</title><style>${this._reportBaseCss()}</style></head><body>
<div class="page">${testBanner}
<div class="hdr"><h1>${this._escHtml(title)}</h1><div class="sub">${this._escHtml(subtitle)}</div></div>
${bodyHtml}
<div class="foot">Kostal PIKO Adapter v${ADAPTER_VERSION} · ioBroker</div>
</div></body></html>`;
    }

    _kpiHtml(items) {
        const cells = items
            .map(
                i =>
                    `<div class="kpi"><div class="v">${this._escHtml(i.value)}</div><div class="l">${this._escHtml(i.label)}</div></div>`,
            )
            .join('');
        return `<div class="kpis">${cells}</div>`;
    }

    _berlinTimeLabel(ts) {
        return new Intl.DateTimeFormat('de-DE', {
            timeZone: 'Europe/Berlin',
            hour: '2-digit',
            minute: '2-digit',
        }).format(new Date(ts));
    }

    _chartXLabels(n, sortedRows) {
        const labels = [];
        if (!sortedRows.length) {
            return labels;
        }
        const step = Math.max(1, Math.floor(n / 8));
        for (let i = 0; i < n; i += step) {
            labels.push({ i, label: this._berlinTimeLabel(sortedRows[i].ts) });
        }
        if (n > 1 && labels[labels.length - 1]?.i !== n - 1) {
            labels.push({ i: n - 1, label: this._berlinTimeLabel(sortedRows[n - 1].ts) });
        }
        return labels;
    }

    _svgLineChart(width, height, series, opts = {}) {
        const pad = { top: 22, right: 10, bottom: 26, left: 42 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const allVals = series.flatMap(s => s.points.filter(v => v != null && !isNaN(v)));
        const yMax = opts.yMax || Math.max(...allVals, 1);
        const n = Math.max(...series.map(s => s.points.length), 1);
        const xAt = i => pad.left + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
        const yAt = v => pad.top + plotH - (v / yMax) * plotH;

        let paths = '';
        series.forEach(s => {
            const pts = [];
            s.points.forEach((v, i) => {
                if (v != null && !isNaN(v)) {
                    pts.push(`${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
                }
            });
            if (pts.length >= 2) {
                paths += `<polyline fill="none" stroke="${s.color}" stroke-width="1.4" points="${pts.join(' ')}" />`;
            }
        });

        let yLabels = '';
        for (let i = 0; i <= 4; i++) {
            const v = Math.round((yMax * (4 - i)) / 4);
            const y = pad.top + (plotH * i) / 4;
            yLabels += `<text x="${pad.left - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="#666">${v}</text>`;
        }
        let xLabels = '';
        (opts.xLabels || []).forEach(({ i, label }) => {
            xLabels += `<text x="${xAt(i).toFixed(1)}" y="${height - 5}" text-anchor="middle" font-size="7" fill="#666">${this._escHtml(label)}</text>`;
        });
        let legend = '';
        series.forEach((s, idx) => {
            const lx = pad.left + idx * 88;
            legend += `<rect x="${lx}" y="4" width="9" height="9" fill="${s.color}"/>`;
            legend += `<text x="${lx + 13}" y="12" font-size="8" fill="#333">${this._escHtml(s.label)}</text>`;
        });

        return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;display:block;margin:0 auto;">
<rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="#fafafa" stroke="#e0e0e0"/>
${yLabels}${paths}${xLabels}${legend}
<text x="${pad.left}" y="${height - 1}" font-size="7" fill="#999">${this._escHtml(opts.unit || 'W')}</text>
</svg>`;
    }

    _svgBarChart(width, height, bars) {
        const pad = { top: 16, right: 10, bottom: 32, left: 36 };
        const plotW = width - pad.left - pad.right;
        const plotH = height - pad.top - pad.bottom;
        const maxV = Math.max(...bars.map(b => b.value), 0.1);
        const barW = Math.min(48, plotW / Math.max(bars.length, 1) - 6);
        let rects = '';
        let xLabels = '';
        bars.forEach((b, i) => {
            const cx = pad.left + (i + 0.5) * (plotW / bars.length);
            const bh = (b.value / maxV) * plotH;
            const x = cx - barW / 2;
            const y = pad.top + plotH - bh;
            rects += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" fill="${b.color || '#42a5f5'}" rx="2"/>`;
            rects += `<text x="${cx.toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="#333">${b.value > 0 ? b.value.toFixed(1) : ''}</text>`;
            xLabels += `<text x="${cx.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="8" fill="#555">${this._escHtml(b.label)}</text>`;
        });
        return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;height:auto;display:block;margin:0 auto;">
<rect x="${pad.left}" y="${pad.top}" width="${plotW}" height="${plotH}" fill="#fafafa" stroke="#e0e0e0"/>
${rects}${xLabels}
<text x="${pad.left - 4}" y="${pad.top + 8}" text-anchor="end" font-size="8" fill="#666">${maxV.toFixed(0)}</text>
<text x="${pad.left}" y="${height - 1}" font-size="7" fill="#999">kWh</text>
</svg>`;
    }

    _weatherReportHtml(reportDateKey, weatherOverride) {
        const w = weatherOverride || (this._lastWeather?.date === reportDateKey ? this._lastWeather : null);
        if (!w) {
            return `<div class="weather"><h3>🌤 Wetter</h3><p>Keine Wetterdaten für ${this._escHtml(reportDateKey)} – PLZ in der Konfiguration hinterlegen.</p></div>`;
        }
        const dateNote = w.historical
            ? `${reportDateKey}${w.place ? ` · ${w.place}` : ''} (Archiv)`
            : w.date === reportDateKey
              ? `Stand ${w.date}${w.place ? ` · ${w.place}` : ''}`
              : `Region ${w.place || w.plz} (Vorschau, Berichtstag: ${reportDateKey})`;
        const precipParts = [];
        if (w.historical) {
            if (w.precipMm != null && w.precipMm > 0) {
                precipParts.push(`${w.precipMm} mm`);
            }
        } else {
            if (w.precipMm != null) {
                precipParts.push(`${w.precipMm} mm bisher`);
            }
            if (w.precipCurrent != null && w.precipCurrent > 0) {
                precipParts.push(`aktuell ${w.precipCurrent} mm/h`);
            }
            if (w.precipForecast != null && w.precipForecast > 0) {
                precipParts.push(`Prognose Tag ${w.precipForecast} mm`);
            }
        }
        const parts = [
            w.weather && `Bedingungen: ${w.weather}`,
            w.sunshineH != null && `Sonnenschein: ${w.sunshineH} h`,
            w.tempMax != null && `Max-Temp.: ${w.tempMax} °C`,
            w.cloudPct != null && `Bewölkung: ${w.cloudPct} %`,
            precipParts.length && `Niederschlag: ${precipParts.join(', ')}`,
        ].filter(Boolean);
        return `<div class="weather"><h3>🌤 Wetter (${this._escHtml(dateNote)})</h3>
<p style="margin:0;">${this._escHtml(parts.join(' · '))}</p>
<p style="margin:4px 0 0;font-size:9px;color:#888;">Quelle: ${this._escHtml(w.source || 'Open-Meteo')}</p></div>`;
    }

    _monthlyComparisonHtml(year, month, totalKwh) {
        const kwp = this._getInstalledKwp();
        const lines = [];
        const spec = kwp > 0 ? totalKwh / kwp : null;
        if (spec != null) {
            lines.push(
                `Spez. Monatsertrag: <strong>${spec.toFixed(1)} kWh/kWp</strong> (Anlage ${kwp.toFixed(2)} kWp)`,
            );
        }

        const prev = [];
        for (let y = year - 1; y >= year - 8; y--) {
            const entry = this._monthlyYields?.months?.[this._monthKey(y, month)];
            if (entry?.wh > 0) {
                prev.push({ year: y, kwh: entry.wh / 1000 });
            }
        }
        if (prev.length) {
            const avgPrev = prev.reduce((s, p) => s + p.kwh, 0) / prev.length;
            const diff = totalKwh - avgPrev;
            const diffPct = avgPrev > 0 ? (diff / avgPrev) * 100 : 0;
            const rows = prev
                .map(
                    p => `<tr>
${this._tdCell(String(p.year))}
${this._tdCell(`${p.kwh.toFixed(1)} kWh`, true)}
${this._tdCell(kwp ? `${(p.kwh / kwp).toFixed(1)}` : '–', true)}
</tr>`,
                )
                .join('');
            lines.push(`${this._reportTableOpen()}<thead><tr>
${this._thCell('Vorjahr')}${this._thCell('Ertrag', true)}${this._thCell('kWh/kWp', true)}
</tr></thead><tbody>${rows}</tbody>
<tfoot><tr>
${this._tdCell(`Ø Vorjahre (${prev.length})`)}
${this._tdCell(`${avgPrev.toFixed(1)} kWh`, true)}
${this._tdCell(`${diff >= 0 ? '+' : ''}${diff.toFixed(1)} kWh (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(0)} %)`, true)}
</tr></tfoot></table>`);
        }

        const regional = this._monthlyYields?.regionalKwpRef;
        if (regional && regional[month - 1] > 0 && kwp > 0) {
            const refKwhKwp = regional[month - 1];
            const refTotal = refKwhKwp * kwp;
            const delta = spec != null ? spec - refKwhKwp : null;
            lines.push(
                `Regionaler Referenzwert (PLZ ${this._escHtml(this._monthlyYields.plz || this._cfg.yieldPlz || '')}): ` +
                    `<strong>${refKwhKwp.toFixed(1)} kWh/kWp</strong> ≈ ${refTotal.toFixed(0)} kWh${
                        delta != null ? ` · Abweichung: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} kWh/kWp` : ''
                    }`,
            );
        }

        if (!lines.length) {
            return '';
        }
        return `<div class="cmp"><h3>📊 Vergleich &amp; Durchschnitt</h3>${lines.join('')}</div>`;
    }

    async _buildDailyReport(date, opts = {}) {
        const rows = this._getRowsForDate(date);
        const dateStr = date.toLocaleDateString('de-DE', {
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
        const dateKey = this._berlinDateKey(date.getTime());
        const model = this._lastData['device.model'] || 'PIKO';
        const kwp = this._getInstalledKwp();
        const testPrefix = opts.test ? '[TEST] ' : '';
        const subject = `${testPrefix}${this._getReportSubjectTag()}Tagesbericht ${dateStr}`;
        const weatherData = await this._getWeatherForDate(dateKey);

        if (!rows.length) {
            const text =
                `☀️ Kostal PIKO (${model}) – Tagesbericht\n📅 ${dateStr}\n\n⚠️ Keine Historiendaten vorhanden.\n` +
                `Bitte „Historiendaten laden“ aktivieren und Sync-Intervall prüfen.`;
            const html = this._reportPageHtml(
                'Tagesbericht',
                `${model} · ${dateStr}`,
                '<p class="warn">Keine Historiendaten für diesen Tag. „Historiendaten laden“ aktivieren.</p>',
                opts.test,
            );
            return { subject, text, html };
        }

        const stats = this._calcDayStats(rows);
        const sorted = [...rows].sort((a, b) => a.ts - b.ts);
        const stringCount = this._getStringCount();
        const prodWindow =
            stats.firstProd && stats.lastProd
                ? `${stats.firstProd.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}–` +
                  `${stats.lastProd.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`
                : '–';

        const acSeries = [{ label: 'AC gesamt', color: '#1565c0', points: sorted.map(r => r.acTotalPower || 0) }];
        const dcSeries = [
            {
                label: 'DC gesamt',
                color: '#2e7d32',
                points: sorted.map(r => (r.dc1?.power || 0) + (r.dc2?.power || 0) + (r.dc3?.power || 0)),
            },
        ];
        if (stringCount >= 1) {
            dcSeries.push({ label: 'String 1', color: '#66bb6a', points: sorted.map(r => r.dc1?.power || 0) });
        }
        if (stringCount >= 2) {
            dcSeries.push({ label: 'String 2', color: '#43a047', points: sorted.map(r => r.dc2?.power || 0) });
        }
        if (stringCount >= 3) {
            dcSeries.push({ label: 'String 3', color: '#1b5e20', points: sorted.map(r => r.dc3?.power || 0) });
        }

        const phaseSeries = [
            { label: 'L1', color: '#ef6c00', points: sorted.map(r => r.ac1?.power || 0) },
            { label: 'L2', color: '#f57c00', points: sorted.map(r => r.ac2?.power || 0) },
            { label: 'L3', color: '#e65100', points: sorted.map(r => r.ac3?.power || 0) },
        ];
        const xLabels = this._chartXLabels(sorted.length, sorted);

        const kpiItems = [
            { value: `${stats.kwh.toFixed(2)} kWh`, label: 'Tagesertrag' },
            { value: `${stats.maxW} W`, label: `Spitze (${stats.peakTime})` },
            { value: `${stats.maxDc} W`, label: 'DC-Spitze' },
            { value: this._formatDuration(stats.prodMinutes), label: `Erzeugung (${prodWindow})` },
            { value: `${stats.avgW} W`, label: 'Ø-Leistung' },
        ];
        if (kwp) {
            kpiItems.push({ value: `${(stats.kwh / kwp).toFixed(2)}`, label: 'kWh/kWp' });
        }

        let body = this._kpiHtml(kpiItems);
        body += `<div class="sec"><h2>AC-Leistung (15-min)</h2><div class="chart">${this._svgLineChart(680, 140, acSeries, { xLabels, unit: 'W' })}</div></div>`;
        body += `<div class="sec"><h2>DC-Leistung Strings</h2><div class="chart">${this._svgLineChart(680, 150, dcSeries, { xLabels, unit: 'W' })}</div></div>`;
        body += `<div class="sec"><h2>AC-Phasen</h2><div class="chart">${this._svgLineChart(680, 130, phaseSeries, { xLabels, unit: 'W' })}</div></div>`;
        if (stats.errorCodes.length) {
            body += this._formatErrorCodesHtml(stats.errorCodes);
        }
        body += this._weatherReportHtml(dateKey, weatherData);
        const html = this._reportPageHtml(
            'Tagesbericht',
            `${model} · ${dateStr} · ${stats.dataPoints} Messpunkte`,
            body,
            opts.test,
        );

        const hourly = [];
        for (let h = 0; h < 24; h++) {
            const hr = rows.filter(r => new Date(r.date).getHours() === h);
            hourly.push(hr.length ? Math.max(...hr.map(r => r.acTotalPower)) : 0);
        }
        const spark = this._sparkline(hourly.filter((_, i) => i >= 5 && i <= 21));
        const lines = [
            `☀️ Kostal PIKO (${model}) – Tagesbericht`,
            `📅 ${dateStr}`,
            ``,
            `⚡ Tagesertrag:       ${stats.kwh.toFixed(2)} kWh`,
            this._formatKwpLine(stats.kwh, kwp).trimEnd(),
            `📈 Spitzenleistung:   ${stats.maxW} W (um ${stats.peakTime})`,
            `🔆 DC-Spitze:         ${stats.maxDc} W`,
            `⏱️ Erzeugungszeit:    ${this._formatDuration(stats.prodMinutes)} (${prodWindow})`,
            `📊 Ø-Leistung (Tag):  ${stats.avgW} W`,
            `📡 Messpunkte:        ${stats.dataPoints} (15-min)`,
        ].filter(Boolean);
        if (stats.errorCodes.length) {
            lines.push(this._formatErrorCodesText(stats.errorCodes));
        }
        const weatherLine = this._weatherSummaryText(weatherData);
        if (weatherLine) {
            lines.push(`🌤 Wetter: ${weatherLine}`);
        }
        lines.push('', `Leistungskurve AC (5–21 Uhr):`, spark);
        return { subject, text: lines.join('\n'), html };
    }

    _buildWeeklyReport(opts = {}) {
        const { days, weekNum, start } = this._getPreviousCalendarWeek();
        const model = this._lastData['device.model'] || 'PIKO';
        const kwp = this._getInstalledKwp();
        const rangeStr =
            `${start.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ` +
            `${days[6].toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
        const testPrefix = opts.test ? '[TEST] ' : '';
        const subject = `${testPrefix}${this._getReportSubjectTag()}Wochenbericht KW ${weekNum}`;

        const dayStats = days.map(date => {
            const rows = this._getRowsForDate(date);
            return { date, rows, stats: rows.length ? this._calcDayStats(rows) : null };
        });

        let totalKwh = 0;
        let bestDay = null;
        let worstDay = null;
        let peakW = 0;
        let daysWithData = 0;
        const bars = [];
        const tableRows = [];

        dayStats.forEach(d => {
            const kwh = d.stats ? d.stats.kwh : 0;
            totalKwh += kwh;
            if (d.rows.length) {
                daysWithData++;
            }
            if (d.stats && d.stats.maxW > peakW) {
                peakW = d.stats.maxW;
            }
            if (d.stats && kwh > 0) {
                if (!bestDay || kwh > bestDay.kwh) {
                    bestDay = { date: d.date, kwh };
                }
                if (!worstDay || kwh < worstDay.kwh) {
                    worstDay = { date: d.date, kwh };
                }
            }
            const label = d.date.toLocaleDateString('de-DE', { weekday: 'short' });
            bars.push({ label, value: kwh, color: kwh > 0 ? '#42a5f5' : '#bdbdbd' });
            const dayLabel = d.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            tableRows.push(`<tr>
${this._tdCell(this._escHtml(dayLabel))}
${this._tdCell(kwh.toFixed(1), true)}
${this._tdCell(d.stats ? String(d.stats.maxW) : '–', true)}
${this._tdCell(d.stats ? this._formatDuration(d.stats.prodMinutes) : '–', true)}
${this._tdCell(d.rows.length ? this._escHtml(this._barForKwh(kwh)) : '–')}
</tr>`);
        });

        const avgKwh = daysWithData ? totalKwh / daysWithData : 0;
        const kpiItems = [
            { value: `${totalKwh.toFixed(1)} kWh`, label: 'Wochensumme' },
            { value: `${avgKwh.toFixed(1)} kWh`, label: `Ø/Tag (${daysWithData} Tage)` },
            { value: peakW ? `${peakW} W` : '–', label: 'Wochenspitze' },
        ];
        if (kwp) {
            kpiItems.push({ value: `${(totalKwh / kwp).toFixed(1)}`, label: 'kWh/kWp' });
        }

        let body = this._kpiHtml(kpiItems);
        body += `<div class="sec"><h2>Tageserträge KW ${weekNum}</h2><div class="chart">${this._svgBarChart(680, 160, bars)}</div></div>`;
        body += `${this._reportTableOpen()}<thead><tr>
${this._thCell('Tag')}${this._thCell('kWh', true)}${this._thCell('Spitze', true)}${this._thCell('Erzeugung', true)}${this._thCell('Verlauf')}
</tr></thead><tbody>${tableRows.join('')}</tbody></table>`;
        if (bestDay) {
            body += `<p>🏆 Bester Tag: <strong>${bestDay.kwh.toFixed(1)} kWh</strong> (${bestDay.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })})`;
            if (worstDay && worstDay.kwh < bestDay.kwh) {
                body += ` · 📉 Schwächster: <strong>${worstDay.kwh.toFixed(1)} kWh</strong> (${worstDay.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })})`;
            }
            body += '</p>';
        }
        const html = this._reportPageHtml('Wochenbericht', `${model} · KW ${weekNum} (${rangeStr})`, body, opts.test);

        const lines = [`📅 Kostal PIKO (${model}) – Wochenbericht`, `KW ${weekNum} (${rangeStr})`, ``];
        dayStats.forEach(d => {
            const kwh = d.stats ? d.stats.kwh : 0;
            const label = d.date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            lines.push(`${label}  ${d.rows.length ? this._barForKwh(kwh) : '–'}  ${kwh.toFixed(1)} kWh`);
        });
        lines.push('', `📊 Wochensumme: ${totalKwh.toFixed(1)} kWh`, `📊 Ø pro Tag: ${avgKwh.toFixed(1)} kWh`);
        if (kwp) {
            lines.push(`📐 Spez. Ertrag: ${(totalKwh / kwp).toFixed(1)} kWh/kWp`);
        }
        return { subject, text: lines.join('\n'), html };
    }

    _buildMonthlyReport(opts = {}) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const daysInMonth = new Date(today.getFullYear(), today.getMonth(), 0).getDate();
        const monthName = lastMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
        const year = lastMonth.getFullYear();
        const month = lastMonth.getMonth() + 1;
        const model = this._lastData['device.model'] || 'PIKO';
        const kwp = this._getInstalledKwp();
        const testPrefix = opts.test ? '[TEST] ' : '';
        const subject = `${testPrefix}${this._getReportSubjectTag()}Monatsbericht ${monthName}`;

        let totalKwh = 0;
        let daysWithYield = 0;
        let daysWithData = 0;
        let bestDay = null;
        let worstDay = null;
        let peakW = 0;
        const tableRows = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), d);
            const rows = this._getRowsForDate(date);
            const stats = rows.length ? this._calcDayStats(rows) : null;
            const kwh = stats ? stats.kwh : 0;
            totalKwh += kwh;
            if (rows.length) {
                daysWithData++;
            }
            if (kwh > 0.1) {
                daysWithYield++;
            }
            if (stats && stats.maxW > peakW) {
                peakW = stats.maxW;
            }
            if (stats && kwh > 0) {
                if (!bestDay || kwh > bestDay.kwh) {
                    bestDay = { date, kwh };
                }
                if (!worstDay || kwh < worstDay.kwh) {
                    worstDay = { date, kwh };
                }
            }
            const spec = kwp > 0 && kwh > 0 ? (kwh / kwp).toFixed(2) : '–';
            const label = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
            const rowStyle = kwh <= 0 && !rows.length ? ' style="color:#999;"' : '';
            tableRows.push(`<tr${rowStyle}>
${this._tdCell(this._escHtml(label))}
${this._tdCell(kwh > 0 ? kwh.toFixed(1) : '–', true)}
${this._tdCell(stats && stats.maxW ? String(stats.maxW) : '–', true)}
${this._tdCell(spec, true)}
${this._tdCell(stats ? String(stats.dataPoints) : '–', true)}
</tr>`);
        }

        const avgKwh = daysWithYield ? totalKwh / daysWithYield : 0;
        const kpiItems = [
            { value: `${totalKwh.toFixed(1)} kWh`, label: 'Monatssumme' },
            { value: `${avgKwh.toFixed(1)} kWh`, label: `Ø/Ertragstag (${daysWithYield})` },
            { value: peakW ? `${peakW} W` : '–', label: 'Monatsspitze' },
        ];
        if (kwp) {
            kpiItems.push({ value: `${(totalKwh / kwp).toFixed(1)}`, label: 'kWh/kWp Monat' });
        }

        let body = this._kpiHtml(kpiItems);
        body += `<div class="sec"><h2>Tagesübersicht ${this._escHtml(monthName)}</h2>
${this._reportTableOpen()}<thead><tr>
${this._thCell('Datum')}${this._thCell('kWh', true)}${this._thCell('Spitze W', true)}${this._thCell('kWh/kWp', true)}${this._thCell('Punkte', true)}
</tr></thead>
<tbody>${tableRows.join('')}</tbody>
<tfoot><tr>
${this._tdCell('Summe / Ø')}
${this._tdCell(`${totalKwh.toFixed(1)} kWh`, true)}
${this._tdCell(peakW ? String(peakW) : '–', true)}
${this._tdCell(kwp ? (totalKwh / kwp).toFixed(1) : '–', true)}
${this._tdCell(`${daysWithData}/${daysInMonth} Tage`)}
</tr></tfoot></table></div>`;
        if (bestDay) {
            body += `<p>🏆 Bester Tag: <strong>${bestDay.kwh.toFixed(1)} kWh</strong> (${bestDay.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })})`;
            if (worstDay && daysWithYield > 1) {
                body += ` · Schwächster: <strong>${worstDay.kwh.toFixed(1)} kWh</strong> (${worstDay.date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })})`;
            }
            body += '</p>';
        }
        if (daysWithData < daysInMonth) {
            body += `<p class="warn">⚠️ ${daysInMonth - daysWithData} Tage ohne Messdaten</p>`;
        }
        body += this._monthlyComparisonHtml(year, month, totalKwh);
        const html = this._reportPageHtml('Monatsbericht', `${model} · ${monthName}`, body, opts.test);

        const lines = [`📅 Kostal PIKO (${model}) – Monatsbericht ${monthName}`, ``];
        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), d);
            const rows = this._getRowsForDate(date);
            const stats = rows.length ? this._calcDayStats(rows) : null;
            const kwh = stats ? stats.kwh : 0;
            if (kwh > 0 || rows.length > 0) {
                const label = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit' });
                lines.push(`${label}  ${this._barForKwh(kwh)}  ${kwh.toFixed(1)} kWh`);
            }
        }
        lines.push('', `📊 Monatssumme: ${totalKwh.toFixed(1)} kWh`, `📊 Ø pro Ertragstag: ${avgKwh.toFixed(1)} kWh`);
        if (kwp) {
            lines.push(`📐 Spez. Ertrag: ${(totalKwh / kwp).toFixed(1)} kWh/kWp`);
        }
        return { subject, text: lines.join('\n'), html };
    }

    _sparkline(values) {
        // Unicode-Sparkline aus Werten: ▁▂▃▄▅▆▇█
        const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
        const max = Math.max(...values) || 1;
        return values.map(v => blocks[Math.min(7, Math.floor((v / max) * 8))]).join('');
    }

    _calcDailyKwhFromPower(rows) {
        if (!rows.length) {
            return 0;
        }
        const totalWh = rows.reduce((sum, r) => sum + (r.acTotalPower || 0) * 0.25, 0);
        return Math.round(totalWh) / 1000;
    }

    _calcDailyKwh(rows) {
        if (!rows.length) {
            return 0;
        }
        const sorted = this._dedupeHistoryRows(rows);
        const powerKwh = this._calcDailyKwhFromPower(sorted);
        const withEnergy = sorted.filter(r => r.totalEnergy > 0);
        if (withEnergy.length >= 2) {
            const delta = withEnergy[withEnergy.length - 1].totalEnergy - withEnergy[0].totalEnergy;
            const maxKwh = Math.min(150, Math.max(powerKwh * 1.25, 8));
            if (delta > 0 && delta <= maxKwh) {
                return Math.round(delta * 100) / 100;
            }
        }
        return powerKwh;
    }

    _calcDayStats(rows) {
        if (!rows.length) {
            return null;
        }
        const sorted = [...rows].sort((a, b) => a.ts - b.ts);
        const kwh = this._calcDailyKwh(sorted);
        const peakRow = sorted.reduce((best, r) => (r.acTotalPower > best.acTotalPower ? r : best), sorted[0]);
        const producing = sorted.filter(r => r.acTotalPower >= 50);
        const maxDc = Math.max(...sorted.map(r => (r.dc1?.power || 0) + (r.dc2?.power || 0) + (r.dc3?.power || 0)));
        const errors = sorted.filter(r => r.errorCode && r.errorCode !== 0);
        const errorCodes = [...new Set(errors.map(r => r.errorCode))];
        const avgW = producing.length
            ? Math.round(producing.reduce((s, r) => s + r.acTotalPower, 0) / producing.length)
            : 0;
        const firstProd = producing.length ? new Date(producing[0].ts) : null;
        const lastProd = producing.length ? new Date(producing[producing.length - 1].ts) : null;

        return {
            kwh,
            maxW: peakRow.acTotalPower,
            peakTime: new Date(peakRow.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
            prodMinutes: producing.length * 15,
            firstProd,
            lastProd,
            maxDc,
            avgW,
            errorCodes,
            dataPoints: sorted.length,
        };
    }

    _barForKwh(kwh, scale = 5) {
        if (!kwh) {
            return '–';
        }
        return '▓'.repeat(Math.min(20, Math.round(kwh / scale))) || '▁';
    }

    async _sendNotify(text, subject, opts = {}) {
        return new Promise(resolve => {
            const inst = this._cfg.notifyInstance;
            const recipients = opts.recipients || this._parseRecipients(this._cfg.notifyRecipient);
            if (!inst) {
                return resolve({ error: 'Keine E-Mail-Instanz konfiguriert' });
            }
            if (!recipients.length) {
                return resolve({ error: 'Kein Empfänger konfiguriert' });
            }
            const mailSubject = subject || 'Kostal PIKO Bericht';
            const payload = {
                to: recipients.join(', '),
                subject: mailSubject,
                text,
            };
            if (opts.html) {
                payload.html = opts.html;
            }
            let settled = false;
            const finish = result => {
                if (settled) {
                    return;
                }
                settled = true;
                this.clearTimeout(timer);
                resolve(result);
            };
            const timer = this.setTimeout(() => {
                this._log('WARN', `Benachrichtigung: Timeout (30s) via ${inst}`);
                finish({ error: 'Timeout beim E-Mail-Versand (email-Adapter antwortet nicht)' });
            }, 30000);
            this.sendTo(inst, 'send', payload, result => {
                if (result && result.error) {
                    this._log('WARN', `Benachrichtigung fehlgeschlagen (${inst}): ${result.error}`);
                    return finish({ error: result.error });
                }
                this._log('INFO', `Benachrichtigung gesendet via ${inst} → ${recipients.join(', ')}`);
                finish({ ok: true });
            });
        });
    }

    async _sendDailyReport(opts = {}) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const built = await this._buildDailyReport(yesterday, opts);
        const result = await this._sendNotify(built.text, built.subject, {
            html: built.html,
            recipients: this._getRecipientsForReport('daily'),
        });
        if (result?.error) {
            throw new Error(result.error);
        }
        const stats = this._calcDayStats(this._getRowsForDate(yesterday));
        if (stats) {
            this._log('INFO', `Tagesbericht gesendet: ${stats.kwh.toFixed(2)} kWh`);
        }
    }

    async _sendWeeklyReport(opts = {}) {
        const built = this._buildWeeklyReport(opts);
        const result = await this._sendNotify(built.text, built.subject, {
            html: built.html,
            recipients: this._getRecipientsForReport('weekly'),
        });
        if (result?.error) {
            throw new Error(result.error);
        }
        const { weekNum } = this._getPreviousCalendarWeek();
        this._log('INFO', `Wochenbericht gesendet (KW ${weekNum})`);
    }

    async _sendMonthlyReport(opts = {}) {
        const built = this._buildMonthlyReport(opts);
        const result = await this._sendNotify(built.text, built.subject, {
            html: built.html,
            recipients: this._getRecipientsForReport('monthly'),
        });
        if (result?.error) {
            throw new Error(result.error);
        }
        const today = new Date();
        const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const monthName = lastMonth.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
        this._log('INFO', `Monatsbericht gesendet (${monthName})`);
    }

    async _checkDayAlert() {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const rows = this._getRowsForDate(yesterday);
        const stats = rows.length ? this._calcDayStats(rows) : null;
        const kwh = stats ? stats.kwh : 0;
        const thr = this._cfg.notifyThresholdKwh;
        const dateStr = yesterday.toLocaleDateString('de-DE', {
            weekday: 'long',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
        const model = this._lastData['device.model'] || 'PIKO';
        const subject = `Kostal PIKO – Alarm ${dateStr}`;

        const alerts = [];
        if (!rows.length) {
            alerts.push('⚠️ Keine Historiendaten empfangen');
        } else if (thr > 0 && kwh < thr) {
            alerts.push(`⚠️ Ertrag ${kwh.toFixed(2)} kWh unter Schwellwert ${thr} kWh`);
        }
        if (stats?.errorCodes?.length) {
            alerts.push(`⚠️ Fehlercodes im Tagesverlauf: ${stats.errorCodes.join(', ')}`);
        }

        if (alerts.length) {
            const lines = [`🔔 Kostal PIKO (${model}) – Alarm`, `📅 ${dateStr}`, ``, ...alerts];
            if (stats) {
                lines.push(
                    ``,
                    `Tagesertrag: ${kwh.toFixed(2)} kWh`,
                    `Spitzenleistung: ${stats.maxW} W`,
                    `Messpunkte: ${stats.dataPoints}`,
                );
            }
            await this._sendNotify(lines.join('\n'), subject);
            this._log('WARN', `Alarm gesendet: ${alerts.join(', ')}`);
        }
    }

    _isoWeek(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    }

    // ─── States anlegen ──────────────────────────────────────────────────────────

    async _ensureChannelPath(objectId) {
        const parts = objectId.split('.');
        if (parts.length < 2) {
            return;
        }
        let path = '';
        for (let i = 0; i < parts.length - 1; i++) {
            path = path ? `${path}.${parts[i]}` : parts[i];
            await this.setObjectNotExistsAsync(path, {
                type: 'channel',
                common: { name: parts[i] },
                native: {},
            });
        }
    }

    async _ensureBaseStates() {
        const defs = [
            { id: 'info.connection', type: 'boolean', role: 'indicator.connected', name: 'Verbunden', def: false },
            {
                id: 'info.networkMode',
                type: 'string',
                role: 'text',
                name: 'Netzwerk-Modus (local/fritzwireguard)',
                def: 'local',
            },
            { id: 'info.lastPoll', type: 'string', role: 'date', name: 'Letzter Poll', def: '' },
            { id: 'status', type: 'string', role: 'text', name: 'Betriebsstatus', def: 'Unbekannt' },
            { id: 'online', type: 'number', role: 'value', name: 'Online (1=ja, 0=nein)', def: 0 },
            {
                id: 'ac.power',
                type: 'number',
                role: 'value.power.active',
                name: 'AC-Leistung aktuell',
                def: 0,
                unit: 'W',
            },
            { id: 'ac.l1.voltage', type: 'number', role: 'value.voltage', name: 'L1 Spannung', def: 0, unit: 'V' },
            { id: 'ac.l1.power', type: 'number', role: 'value.power.active', name: 'L1 Leistung', def: 0, unit: 'W' },
            { id: 'ac.l2.voltage', type: 'number', role: 'value.voltage', name: 'L2 Spannung', def: 0, unit: 'V' },
            { id: 'ac.l2.power', type: 'number', role: 'value.power.active', name: 'L2 Leistung', def: 0, unit: 'W' },
            { id: 'ac.l3.voltage', type: 'number', role: 'value.voltage', name: 'L3 Spannung', def: 0, unit: 'V' },
            { id: 'ac.l3.power', type: 'number', role: 'value.power.active', name: 'L3 Leistung', def: 0, unit: 'W' },
            { id: 'energy.total', type: 'number', role: 'value.energy', name: 'Gesamtenergie', def: 0, unit: 'kWh' },
            { id: 'energy.today', type: 'number', role: 'value.energy', name: 'Tagesenergie', def: 0, unit: 'kWh' },
            {
                id: 'pv.string1.voltage',
                type: 'number',
                role: 'value.voltage',
                name: 'String 1 Spannung',
                def: 0,
                unit: 'V',
            },
            {
                id: 'pv.string1.current',
                type: 'number',
                role: 'value.current',
                name: 'String 1 Strom',
                def: 0,
                unit: 'A',
            },
            {
                id: 'pv.string2.voltage',
                type: 'number',
                role: 'value.voltage',
                name: 'String 2 Spannung',
                def: 0,
                unit: 'V',
            },
            {
                id: 'pv.string2.current',
                type: 'number',
                role: 'value.current',
                name: 'String 2 Strom',
                def: 0,
                unit: 'A',
            },
            {
                id: 'pv.string3.voltage',
                type: 'number',
                role: 'value.voltage',
                name: 'String 3 Spannung',
                def: 0,
                unit: 'V',
            },
            {
                id: 'pv.string3.current',
                type: 'number',
                role: 'value.current',
                name: 'String 3 Strom',
                def: 0,
                unit: 'A',
            },
            { id: 'device.strings', type: 'number', role: 'value', name: 'Anzahl PV-Strings (2 oder 3)', def: 2 },
            { id: 'device.model', type: 'string', role: 'text', name: 'Modell (PIKO 8.3 / PIKO 5.5)', def: '' },
            {
                id: 'info.analog1',
                type: 'number',
                role: 'value.voltage',
                name: 'Analoger Eingang 1',
                def: 0,
                unit: 'V',
            },
            {
                id: 'info.analog2',
                type: 'number',
                role: 'value.voltage',
                name: 'Analoger Eingang 2',
                def: 0,
                unit: 'V',
            },
            {
                id: 'info.analog3',
                type: 'number',
                role: 'value.voltage',
                name: 'Analoger Eingang 3',
                def: 0,
                unit: 'V',
            },
            {
                id: 'info.analog4',
                type: 'number',
                role: 'value.voltage',
                name: 'Analoger Eingang 4',
                def: 0,
                unit: 'V',
            },
            { id: 'info.modemStatus', type: 'string', role: 'text', name: 'Modemstatus', def: '' },
            {
                id: 'info.lastPortalConnection',
                type: 'string',
                role: 'text',
                name: 'Letzte Portal-Verbindung',
                def: '',
            },
            { id: 'info.s0Pulses', type: 'number', role: 'value', name: 'S0-Energiepulse', def: 0 },
            { id: 'rs485.busAddress', type: 'number', role: 'value', name: 'RS485 Bus-Adresse', def: 255 },
            // Berechnete Soll-Werte (aus Modul-Konfiguration)
            {
                id: 'string1.expectedVoltage',
                type: 'number',
                role: 'value.voltage',
                name: 'String 1 Soll-Mpp-Spannung',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string1.expectedVoc',
                type: 'number',
                role: 'value.voltage',
                name: 'String 1 Soll-Voc',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string2.expectedVoltage',
                type: 'number',
                role: 'value.voltage',
                name: 'String 2 Soll-Mpp-Spannung',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string2.expectedVoc',
                type: 'number',
                role: 'value.voltage',
                name: 'String 2 Soll-Voc',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string3.expectedVoltage',
                type: 'number',
                role: 'value.voltage',
                name: 'String 3 Soll-Mpp-Spannung',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string3.expectedVoc',
                type: 'number',
                role: 'value.voltage',
                name: 'String 3 Soll-Voc',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string1.expectedPower',
                type: 'number',
                role: 'value.power',
                name: 'String 1 Soll-Leistung',
                def: 0,
                unit: 'Wp',
            },
            {
                id: 'string2.expectedPower',
                type: 'number',
                role: 'value.power',
                name: 'String 2 Soll-Leistung',
                def: 0,
                unit: 'Wp',
            },
            {
                id: 'string3.expectedPower',
                type: 'number',
                role: 'value.power',
                name: 'String 3 Soll-Leistung',
                def: 0,
                unit: 'Wp',
            },
            // Vmpp-basierte Modultemperatur (pro String)
            {
                id: 'string1.vmppPerModule',
                type: 'number',
                role: 'value.voltage',
                name: 'String 1 Vmpp/Modul (gemessen)',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string1.tempEquivalentC',
                type: 'number',
                role: 'value.temperature',
                name: 'String 1 \u00e4quiv. Temperatur',
                def: 0,
                unit: '\u00b0C',
            },
            {
                id: 'string1.tempQuality',
                type: 'string',
                role: 'text',
                name: 'String 1 Temp.-Qualit\u00e4t',
                def: 'UNGUELTIG',
            },
            {
                id: 'string1.tempValidRelative',
                type: 'boolean',
                role: 'indicator',
                name: 'String 1 Temp. relativ valide',
                def: false,
            },
            {
                id: 'string1.tempValidAbsolute',
                type: 'boolean',
                role: 'indicator',
                name: 'String 1 Temp. absolut valide',
                def: false,
            },
            {
                id: 'string1.tempUncertaintyK',
                type: 'number',
                role: 'value',
                name: 'String 1 Temp.-Unsicherheit',
                def: 0,
                unit: 'K',
            },
            {
                id: 'string1.tempDeltaK',
                type: 'number',
                role: 'value',
                name: 'String 1 \u0394T \u00fcber STC',
                def: 0,
                unit: 'K',
            },
            {
                id: 'string1.tempLossW',
                type: 'number',
                role: 'value.power',
                name: 'String 1 Temperaturverlust',
                def: 0,
                unit: 'W',
            },
            {
                id: 'string1.powerAt25C',
                type: 'number',
                role: 'value.power',
                name: 'String 1 \u00e4quiv. STC-Leistung',
                def: 0,
                unit: 'W',
            },
            {
                id: 'string1.mppUtilization',
                type: 'number',
                role: 'value',
                name: 'String 1 MPP-Ausnutzung',
                def: 0,
                unit: '%',
            },
            {
                id: 'string1.tempAlert',
                type: 'string',
                role: 'text',
                name: 'String 1 Temperatur-Status',
                def: 'UNBEKANNT',
            },
            {
                id: 'string2.vmppPerModule',
                type: 'number',
                role: 'value.voltage',
                name: 'String 2 Vmpp/Modul (gemessen)',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string2.tempEquivalentC',
                type: 'number',
                role: 'value.temperature',
                name: 'String 2 \u00e4quiv. Temperatur',
                def: 0,
                unit: '\u00b0C',
            },
            {
                id: 'string2.tempQuality',
                type: 'string',
                role: 'text',
                name: 'String 2 Temp.-Qualit\u00e4t',
                def: 'UNGUELTIG',
            },
            {
                id: 'string2.tempValidRelative',
                type: 'boolean',
                role: 'indicator',
                name: 'String 2 Temp. relativ valide',
                def: false,
            },
            {
                id: 'string2.tempValidAbsolute',
                type: 'boolean',
                role: 'indicator',
                name: 'String 2 Temp. absolut valide',
                def: false,
            },
            {
                id: 'string2.tempUncertaintyK',
                type: 'number',
                role: 'value',
                name: 'String 2 Temp.-Unsicherheit',
                def: 0,
                unit: 'K',
            },
            {
                id: 'string2.tempDeltaK',
                type: 'number',
                role: 'value',
                name: 'String 2 \u0394T \u00fcber STC',
                def: 0,
                unit: 'K',
            },
            {
                id: 'string2.tempLossW',
                type: 'number',
                role: 'value.power',
                name: 'String 2 Temperaturverlust',
                def: 0,
                unit: 'W',
            },
            {
                id: 'string2.powerAt25C',
                type: 'number',
                role: 'value.power',
                name: 'String 2 \u00e4quiv. STC-Leistung',
                def: 0,
                unit: 'W',
            },
            {
                id: 'string2.mppUtilization',
                type: 'number',
                role: 'value',
                name: 'String 2 MPP-Ausnutzung',
                def: 0,
                unit: '%',
            },
            {
                id: 'string2.tempAlert',
                type: 'string',
                role: 'text',
                name: 'String 2 Temperatur-Status',
                def: 'UNBEKANNT',
            },
            {
                id: 'string3.vmppPerModule',
                type: 'number',
                role: 'value.voltage',
                name: 'String 3 Vmpp/Modul (gemessen)',
                def: 0,
                unit: 'V',
            },
            {
                id: 'string3.tempEquivalentC',
                type: 'number',
                role: 'value.temperature',
                name: 'String 3 \u00e4quiv. Temperatur',
                def: 0,
                unit: '\u00b0C',
            },
            {
                id: 'string3.tempQuality',
                type: 'string',
                role: 'text',
                name: 'String 3 Temp.-Qualit\u00e4t',
                def: 'UNGUELTIG',
            },
            {
                id: 'string3.tempValidRelative',
                type: 'boolean',
                role: 'indicator',
                name: 'String 3 Temp. relativ valide',
                def: false,
            },
            {
                id: 'string3.tempValidAbsolute',
                type: 'boolean',
                role: 'indicator',
                name: 'String 3 Temp. absolut valide',
                def: false,
            },
            {
                id: 'string3.tempUncertaintyK',
                type: 'number',
                role: 'value',
                name: 'String 3 Temp.-Unsicherheit',
                def: 0,
                unit: 'K',
            },
            {
                id: 'string3.tempDeltaK',
                type: 'number',
                role: 'value',
                name: 'String 3 \u0394T \u00fcber STC',
                def: 0,
                unit: 'K',
            },
            {
                id: 'string3.tempLossW',
                type: 'number',
                role: 'value.power',
                name: 'String 3 Temperaturverlust',
                def: 0,
                unit: 'W',
            },
            {
                id: 'string3.powerAt25C',
                type: 'number',
                role: 'value.power',
                name: 'String 3 \u00e4quiv. STC-Leistung',
                def: 0,
                unit: 'W',
            },
            {
                id: 'string3.mppUtilization',
                type: 'number',
                role: 'value',
                name: 'String 3 MPP-Ausnutzung',
                def: 0,
                unit: '%',
            },
            {
                id: 'string3.tempAlert',
                type: 'string',
                role: 'text',
                name: 'String 3 Temperatur-Status',
                def: 'UNBEKANNT',
            },
            {
                id: 'temperature.deltaStrings',
                type: 'number',
                role: 'value',
                name: '\u0394T String 1 \u2194 2',
                def: 0,
                unit: 'K',
            },
            {
                id: 'temperature.deltaValid',
                type: 'boolean',
                role: 'indicator',
                name: '\u0394T String 1\u21942 valide',
                def: false,
            },
            {
                id: 'temperature.totalLossW',
                type: 'number',
                role: 'value.power',
                name: 'Temperaturverlust gesamt',
                def: 0,
                unit: 'W',
            },
            {
                id: 'temperature.totalLossKwhDay',
                type: 'number',
                role: 'value.energy',
                name: 'Temperaturverlust heute',
                def: 0,
                unit: 'kWh',
            },
            { id: 'temperature.hottest', type: 'string', role: 'text', name: 'Hei\u00dfester String', def: '' },
            {
                id: 'temperature.systemAlert',
                type: 'string',
                role: 'text',
                name: 'System-Temperatur-Status',
                def: 'UNBEKANNT',
            },
            {
                id: 'dc.totalPower',
                type: 'number',
                role: 'value.power.active',
                name: 'DC-Gesamtleistung (berechnet)',
                def: 0,
                unit: 'W',
            },
            {
                id: 'efficiency.ratio',
                type: 'number',
                role: 'value',
                name: 'Wirkungsgrad DC\u2192AC',
                def: 0,
                unit: '%',
            },
            {
                id: 'efficiency.expected',
                type: 'number',
                role: 'value',
                name: 'Soll-Wirkungsgrad (temp.-korr.)',
                def: 97,
                unit: '%',
            },
            {
                id: 'weather.sunshineHours',
                type: 'number',
                role: 'value',
                name: 'Sonnenstunden heute (Prognose)',
                def: 0,
                unit: 'h',
            },
            {
                id: 'weather.tempMax',
                type: 'number',
                role: 'value.temperature',
                name: 'Max.-Temperatur heute',
                def: 0,
                unit: '\u00b0C',
            },
            {
                id: 'weather.cloudCover',
                type: 'number',
                role: 'value',
                name: 'Bew\u00f6lkung heute (7\u201319h)',
                def: 0,
                unit: '%',
            },
            {
                id: 'weather.precipitation',
                type: 'number',
                role: 'value',
                name: 'Niederschlag heute',
                def: 0,
                unit: 'mm',
            },
            {
                id: 'weather.description',
                type: 'string',
                role: 'weather.state.forecast.0',
                name: 'Wetter heute (Text)',
                def: '',
            },
            { id: 'weather.plz', type: 'string', role: 'text', name: 'Wetter-PLZ', def: '' },
            { id: 'weather.place', type: 'string', role: 'text', name: 'Wetter-Ort', def: '' },
            { id: 'weather.updatedAt', type: 'string', role: 'date', name: 'Wetter letzte Aktualisierung', def: '' },
        ];
        for (const d of defs) {
            await this._ensureChannelPath(d.id);
            const obj = {
                type: 'state',
                common: { name: d.name, type: d.type, role: d.role, read: true, write: false },
                native: {},
            };
            if (d.unit !== undefined) {
                obj.common.unit = d.unit;
            }
            if (d.def !== undefined) {
                obj.common.def = d.def;
            }
            await this.setObjectNotExistsAsync(d.id, obj);
            this._nodes[d.id] = { ...obj.common };
        }
        // E1008: migrate invalid role on existing installations
        await this.extendObjectAsync('weather.description', {
            common: { role: 'weather.state.forecast.0' },
        });
    }

    async _ensureHistoryStates() {
        // Meta-States (History-Status)
        const meta = [
            { id: 'history.lastImport', type: 'string', role: 'date', name: 'Letzter History-Import', def: '' },
            {
                id: 'history.lastImportedTs',
                type: 'number',
                role: 'value',
                name: 'Letzter importierter Timestamp ms',
                def: 0,
            },
            { id: 'history.recordCount', type: 'number', role: 'value', name: 'History-Datenpunkte gesamt', def: 0 },
            { id: 'history.newRecords', type: 'number', role: 'value', name: 'Neue Punkte (letzter Import)', def: 0 },
            {
                id: 'history.oldestRecord',
                type: 'string',
                role: 'date',
                name: '\u00c4ltester History-Eintrag',
                def: '',
            },
            { id: 'history.newestRecord', type: 'string', role: 'date', name: 'Neuester History-Eintrag', def: '' },
            { id: 'history.influxSent', type: 'number', role: 'value', name: 'An InfluxDB gesendete Punkte', def: 0 },
            { id: 'history.pikoEpoch', type: 'string', role: 'date', name: 'PIKO Inbetriebnahme-Datum', def: '' },
        ];
        for (const d of meta) {
            await this._ensureChannelPath(d.id);
            await this.setObjectNotExistsAsync(d.id, {
                type: 'state',
                common: { name: d.name, type: d.type, role: d.role, read: true, write: false, def: d.def },
                native: {},
            });
            this._nodes[d.id] = { name: d.name, type: d.type, role: d.role };
        }

        // Messwert-States für InfluxDB
        for (const def of HISTORY_STATES) {
            await this._ensureChannelPath(def.id);
            await this.setObjectNotExistsAsync(def.id, {
                type: 'state',
                common: {
                    name: def.name,
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: def.unit,
                    // Hinweis für InfluxDB-Adapter-Config (erscheint in ioBroker Admin)
                    desc: 'History-State: enthält historische ts-Werte f\u00fcr InfluxDB',
                },
                native: {},
            });
            this._nodes[def.id] = { name: def.name, type: 'number', unit: def.unit };
        }
    }

    async _writeStates(data, opts = {}) {
        const merged = opts.skipDerived
            ? { ...data }
            : { ...data, ...this._calcDerivedStates({ ...this._lastData, ...data }) };
        const ts = Date.now();
        for (const [key, val] of Object.entries(merged)) {
            if (val === null || val === undefined) {
                continue;
            }
            try {
                await this.setStateAsync(key, { val, ack: true, ts });
            } catch (_) {}
        }
        this._lastData = { ...this._lastData, ...merged, _ts: new Date().toISOString() };
        this._syncLiveToInflux(merged).catch(e => {
            if (this._cfg.verbose) {
                this._log('WARN', `Live Influx-Sync: ${e.message}`);
            }
        });
    }

    // ─── Web-Server ──────────────────────────────────────────────────────────────

    _startWebServer() {
        const port = this._cfg.webPort;
        this._webServer = http.createServer((req, res) => {
            const p = url.parse(req.url, true).pathname;

            if (p === '/api/data') {
                return this._json(res, {
                    data: this._lastData,
                    nodes: this._nodes,
                    stringAnalysis: this._getStringAnalysisConfig(),
                    temperatureAnalysis: this._getTemperatureAnalysis(),
                    inverterSpecs: this._getInverterSpecs(),
                    weather: this._lastWeather,
                    ts: new Date().toISOString(),
                });
            }
            if (p === '/api/history') {
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                });
                return res.end(this._getHistoryApiJson());
            }
            if (p === '/api/logs') {
                return this._json(res, { logs: this._logBuffer });
            }
            if (p === '/api/logs/clear') {
                this._logBuffer = [];
                return this._json(res, { ok: true });
            }
            if (p === '/api/status') {
                return this._json(res, {
                    adapter: ADAPTER_NAME,
                    version: ADAPTER_VERSION,
                    ip: this._cfg.ip,
                    port: this._cfg.port,
                    interval: this._cfg.pollInterval,
                    online: this._lastData.online === 1,
                    historyEnable: this._cfg.historyFetch,
                    syncInterval: this._cfg.syncInterval,
                    influxEnable: this._cfg.influxEnable,
                    influxInst: this._cfg.influxInstance,
                    pikoEpoch: this._pikoEpoch ? new Date(this._pikoEpoch * 1000).toISOString() : null,
                    lastImported: this._lastImportIso,
                });
            }
            if (p === '/api/trigger-history') {
                this._lastHistoryFetch = 0;
                this._fetchAndImportHistory(false).catch(e => this._log('ERROR', `Sync: ${e.message}`));
                return this._json(res, { ok: true, message: 'Sync gestartet (nur neue Datenpunkte)' });
            }
            if (p === '/api/sync-all') {
                // Vollsync: Cursor zurücksetzen → alle ~6 Monate an InfluxDB
                this._fetchAndImportHistory(true).catch(e => this._log('ERROR', `Vollsync: ${e.message}`));
                return this._json(res, {
                    ok: true,
                    message: 'Vollsync gestartet – alle Datenpunkte werden übertragen',
                });
            }
            if (p === '/api/yields' && req.method === 'GET') {
                return this._json(res, this._buildYieldsApiResponse());
            }
            if (p === '/api/yields/export' && req.method === 'GET') {
                const fmt = (url.parse(req.url, true).query || {}).format || 'json';
                if (fmt === 'csv') {
                    const csv = this._exportYieldsCsv();
                    res.writeHead(200, {
                        'Content-Type': 'text/csv; charset=utf-8',
                        'Content-Disposition': `attachment; filename="kostalpiko-${this.namespace}-ertrag.csv"`,
                    });
                    return res.end(`\uFEFF${csv}`);
                }
                const payload = {
                    ...this._monthlyYields,
                    exportedAt: new Date().toISOString(),
                    namespace: this.namespace,
                };
                res.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Disposition': `attachment; filename="kostalpiko-${this.namespace}-ertrag.json"`,
                });
                return res.end(JSON.stringify(payload, null, 2));
            }
            if (p === '/api/yields' && req.method === 'POST') {
                return this._readPostBody(req)
                    .then(async body => {
                        try {
                            const result = await this._handleYieldsPost(body);
                            return this._json(res, { ...result, data: this._buildYieldsApiResponse() });
                        } catch (e) {
                            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                            res.end(JSON.stringify({ ok: false, error: e.message }));
                        }
                    })
                    .catch(e => {
                        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: false, error: e.message }));
                    });
            }
            if (p === '/api/ping') {
                return this._json(res, { ok: true, adapter: ADAPTER_NAME, version: ADAPTER_VERSION });
            }
            if (p === '/app.js') {
                res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
                return res.end(APP_JS_CODE);
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(WEB_UI_HTML.replace(/__VERSION__/g, ADAPTER_VERSION));
        });

        this._webServer.listen(port, () => this._log('SYSTEM', `Web-UI: http://0.0.0.0:${port}/`));
        this._webServer.on('error', e => this._log('ERROR', `Web-Server: ${e.message}`));
    }

    _json(res, obj) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(obj));
    }

    // ─── Logger ──────────────────────────────────────────────────────────────────

    _log(level, message) {
        const entry = { ts: new Date().toISOString(), level, message };
        this._logBuffer.unshift(entry);
        if (this._logBuffer.length > this._maxLogs) {
            this._logBuffer.pop();
        }
        switch (level) {
            case 'ERROR':
                this.log.error(message);
                break;
            case 'WARN':
                this.log.warn(message);
                break;
            case 'DEBUG':
                this.log.debug(message);
                break;
            default:
                this.log.info(message);
                break;
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
.sp-big{width:100%;height:110px;display:block}
.nav-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px}
.nav-btn{background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:5px 12px;border-radius:var(--r);font-size:14px;cursor:pointer;font-family:var(--f)}
.nav-btn:hover{background:var(--bd)}
.nav-btn.active{background:var(--acc);color:#000;border-color:var(--acc);font-weight:700}
.nav-seg{display:flex;gap:3px}
.nav-date{font-size:13px;font-weight:600;color:var(--txt);min-width:150px;text-align:center}
.ir{display:flex;gap:16px;flex-wrap:wrap;margin-top:10px}
.ii .il{font-size:10px;color:var(--mut)}.ii .iv{font-weight:600;font-size:13px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:12px}
.kpi{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:10px 12px}
.kpi .kl{font-size:10px;color:var(--mut);text-transform:uppercase;letter-spacing:.4px}
.kpi .kv{font-size:18px;font-weight:700;margin-top:2px}
.kpi .ks{font-size:10px;color:var(--mut);margin-top:2px}
.chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:10px;margin-bottom:12px}
.chart-box{background:var(--bg3);border:1px solid var(--bd);border-radius:var(--r);padding:12px;position:relative;min-height:220px}
.chart-box.wide{grid-column:1/-1;min-height:280px}
.chart-title{font-size:11px;font-weight:700;color:var(--mut);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.chart-wrap{position:relative;height:200px}
.chart-box.wide .chart-wrap{height:250px}
.chart-legend{display:flex;flex-wrap:wrap;gap:8px;font-size:10px;color:var(--mut)}
.legend-item{display:flex;align-items:center;gap:4px}
.legend-dot{width:8px;height:8px;border-radius:2px;display:inline-block}
.tbl-wrap{max-height:420px;overflow:auto;border:1px solid var(--bd);border-radius:var(--r)}
.tbl-wrap thead th{position:sticky;top:0;background:var(--bg2);z-index:1}
.cache-hint{font-size:11px;color:var(--orn);margin-top:6px}
.yield-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px}
.yield-toolbar label{font-size:11px;color:var(--mut);display:flex;flex-direction:column;gap:3px}
.yield-toolbar input,.yield-toolbar select{background:var(--bg3);border:1px solid var(--bd);color:var(--txt);padding:5px 8px;border-radius:var(--r);font-size:12px;min-width:90px}
.yield-grid-wrap{overflow:auto;max-height:70vh;border:1px solid var(--bd);border-radius:var(--r)}
.yield-grid{border-collapse:collapse;font-size:11px;min-width:100%}
.yield-grid th,.yield-grid td{padding:5px 7px;border:1px solid rgba(48,54,61,.6);text-align:right;white-space:nowrap}
.yield-grid th{background:var(--bg2);color:var(--mut);position:sticky;top:0;z-index:2}
.yield-grid th.ymonth,.yield-grid td.ymonth{position:sticky;left:0;background:var(--bg2);text-align:left;z-index:1;font-weight:600}
.yield-grid th.ymonth{z-index:3}
.yield-grid td.ymonth{color:var(--mut)}
.yield-grid td.editable{cursor:pointer}
.yield-grid td.editable:hover{outline:1px solid var(--acc)}
.yield-grid td.manual{color:var(--blu)}
.yield-grid td.auto{color:var(--txt)}
.yield-grid td.above{background:rgba(63,185,80,.12)}
.yield-grid td.below{background:rgba(248,81,73,.10)}
.yield-grid td.is-min{font-weight:700;color:var(--red)}
.yield-grid td.is-max{font-weight:700;color:var(--grn)}
.yield-grid tr.sum-row td{background:var(--bg3);font-weight:600}
.yield-grid tr.sum-row td.ymonth{color:var(--acc)}
.yield-edit{background:var(--bg);border:1px solid var(--acc);color:var(--txt);width:80px;padding:2px 4px;font-size:11px;border-radius:4px}
.yield-years{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.yield-years label{font-size:11px;color:var(--mut);display:flex;align-items:center;gap:4px;cursor:pointer;padding:3px 8px;background:var(--bg3);border:1px solid var(--bd);border-radius:12px}
.yield-years label.on{border-color:var(--acc);color:var(--acc)}
.yield-years input{margin:0}
.yield-path{font-family:Consolas,monospace;font-size:10px;color:var(--blu);word-break:break-all}
</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
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
  <button onclick="showTab('yields')">&#128202; Ertrag</button>
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
      <div class="vc"><div class="vl">DC-Leistung</div><div class="vv" id="d-dcp">--</div><div class="vu">W</div></div>
      <div class="vc"><div class="vl">Wirkungsgrad</div><div class="vv" id="d-eff">--</div><div class="vu" id="d-eff-hint">DC &rarr; AC</div></div>
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
  <div class="card" id="inv-specs-card" style="display:none">
    <div class="ct"><span class="dot"></span>Wechselrichter-Grenzwerte (Kostal-Datenblatt)</div>
    <div id="inv-specs-body"></div>
  </div>
  <div class="card" id="sa-card" style="display:none">
    <div class="ct"><span class="dot"></span>String-Analyse (Soll vs. Ist)</div>
    <div class="grid g3">
      <div class="vc" id="sa-1" style="display:none"></div>
      <div class="vc" id="sa-2" style="display:none"></div>
      <div class="vc" id="sa-3" style="display:none"></div>
    </div>
    <div style="font-size:10px;color:var(--mut);margin-top:8px">
      Soll-MPP = Vmpp &times; Modulanzahl. Voc (Leerlauf) ist deutlich h&ouml;her und nur als Referenz.
    </div>
  </div>
  <div class="card" id="temp-card" style="display:none">
    <div class="ct"><span class="dot"></span>Modultemperatur (Vmpp-basiert)</div>
    <div class="grid g3">
      <div class="vc" id="temp-1" style="display:none"></div>
      <div class="vc" id="temp-2" style="display:none"></div>
      <div class="vc" id="temp-3" style="display:none"></div>
    </div>
    <div class="vc" id="temp-system" style="display:none;margin-top:8px"></div>
    <div style="font-size:10px;color:var(--mut);margin-top:8px">
      &Auml;quivalente Betriebstemperatur aus Stringspannung &mdash; keine physikalische Messung. Relativvergleich zwischen Strings ist am zuverl&auml;ssigsten.
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
  <div class="card" id="weather-card" style="display:none">
    <div class="ct"><span class="dot"></span>Wetter &amp; Sonne heute <span class="muted" id="w-loc" style="font-weight:400;text-transform:none"></span></div>
    <div class="grid g4" id="w-grid">
      <div class="vc g"><div class="vl">Erwartete Sonnenstunden</div><div class="vv" id="w-sun">--</div><div class="vu">h (heute)</div></div>
      <div class="vc"><div class="vl">Wetter</div><div class="vv" id="w-desc" style="font-size:15px">--</div><div class="vu" id="w-temp">--</div></div>
      <div class="vc"><div class="vl">Bew&ouml;lkung (7&ndash;19 Uhr)</div><div class="vv" id="w-cloud">--</div><div class="vu">% im Mittel</div></div>
      <div class="vc"><div class="vl">Niederschlag</div><div class="vv" id="w-rain">--</div><div class="vu">mm (heute)</div></div>
    </div>
    <div class="muted" style="font-size:10px;margin-top:8px" id="w-src">Quelle: Open-Meteo · PLZ in Admin-Einstellungen</div>
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
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" onclick="loadHistory(true)" title="Anzeige aus Server-Speicher neu laden (kein PIKO-Abruf)">&#8635; Anzeige aktualisieren</button>
        <button class="btn" onclick="triggerSync()" title="LogDaten.dat vom Wechselrichter holen und neue Punkte importieren">&#8595; Vom PIKO laden</button>
        <button class="btn a" onclick="confirmSyncAll()" title="Gesamte Historie an InfluxDB senden (Cursor zur&uuml;cksetzen)">&#9733; Sync-All</button>
      </div>
    </div>
    <div id="histSyncMsg" style="margin-top:8px;font-size:11px;color:var(--mut)"></div>
    <div style="margin-top:6px;font-size:10px;color:var(--mut);line-height:1.5">
      <strong>Anzeige aktualisieren</strong> = nur Darstellung neu laden &middot;
      <strong>Vom PIKO laden</strong> = LogDaten.dat vom Wechselrichter abrufen &middot;
      <strong>Sync-All</strong> = alle Punkte an InfluxDB (nur wenn aktiviert)
    </div>
  </div>

  <!-- String-Analyse für gewählten Zeitraum -->
  <div class="card" id="hsa-card" style="display:none">
    <div class="ct"><span class="dot"></span>String-Analyse (gew&auml;hlter Zeitraum)</div>
    <div class="grid g3" id="hsa-grid"></div>
    <div style="font-size:10px;color:var(--mut);margin-top:8px">
      MPP-Korridor basiert auf Vmpp (Betriebsspannung unter Last), nicht Voc. Gr&uuml;n = im Korridor, Orange = grenzwertig, Rot = au&szlig;erhalb. MPP-Min/Max im Datenblatt = Nennleistungsbereich, kein Sicherheitsalarm.
    </div>
  </div>

  <!-- KPI-Leiste -->
  <div class="kpi-grid" id="hist-kpi">
    <div class="kpi"><div class="kl">Spitzenleistung</div><div class="kv" id="kpi-peak">--</div><div class="ks" id="kpi-peak-t">--</div></div>
    <div class="kpi"><div class="kl">Ertrag (Zeitraum)</div><div class="kv" id="kpi-yield" style="color:var(--grn)">--</div><div class="ks">kWh</div></div>
    <div class="kpi"><div class="kl">&Oslash; Leistung (Tag)</div><div class="kv" id="kpi-avg">--</div><div class="ks">W bei Erzeugung</div></div>
    <div class="kpi"><div class="kl">DC-Spitze</div><div class="kv" id="kpi-dc">--</div><div class="ks">W Summe Strings</div></div>
    <div class="kpi"><div class="kl">Messpunkte</div><div class="kv" id="kpi-pts">--</div><div class="ks">15-min Intervalle</div></div>
    <div class="kpi"><div class="kl">Z&auml;hlerstand</div><div class="kv" id="kpi-energy" style="color:var(--blu)">--</div><div class="ks">kWh Gesamt</div></div>
  </div>
  <div id="cache-hint" class="cache-hint" style="display:none"></div>

  <!-- Navigationsleiste -->
  <div class="card" style="padding:10px 14px;margin-bottom:10px">
    <div class="nav-bar">
      <button class="nav-btn" onclick="navShift(-1)" title="Vorheriger Zeitraum">&#8592;</button>
      <span class="nav-date" id="nav-label">--</span>
      <button class="nav-btn" onclick="navShift(1)" title="N\u00e4chster Zeitraum" id="nav-next">&#8594;</button>
      <div class="nav-seg">
        <button class="nav-btn" id="nb-day"   onclick="navMode('day')">Tag</button>
        <button class="nav-btn" id="nb-week"  onclick="navMode('week')">Woche</button>
        <button class="nav-btn" id="nb-month" onclick="navMode('month')">Monat</button>
      </div>
    </div>
  </div>

  <!-- Charts (Chart.js) -->
  <div class="chart-grid">
    <div class="chart-box wide">
      <div class="chart-title"><span id="chart-main-title">Leistung &amp; Erzeugung</span><span class="chart-legend" id="leg-main"></span></div>
      <div class="chart-wrap"><canvas id="chart-main"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>Phasenleistung L1/L2/L3</span></div>
      <div class="chart-wrap"><canvas id="chart-phases"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>PV-String Leistung</span></div>
      <div class="chart-wrap"><canvas id="chart-dc-power"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>String-Spannungen</span></div>
      <div class="chart-wrap"><canvas id="chart-dc-voltage"></canvas></div>
    </div>
    <div class="chart-box" id="chart-temp-box" style="display:none">
      <div class="chart-title"><span>Modultemperatur (Vmpp)</span></div>
      <div class="chart-wrap"><canvas id="chart-temp"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>Netz &amp; Frequenz</span></div>
      <div class="chart-wrap"><canvas id="chart-grid"></canvas></div>
    </div>
    <div class="chart-box">
      <div class="chart-title"><span>Energie-Z&auml;hler (kWh)</span></div>
      <div class="chart-wrap"><canvas id="chart-energy"></canvas></div>
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Messwerte des gew&auml;hlten Zeitraums (neueste zuerst)</div>
    <div class="tbl-wrap">
    <table>
      <thead><tr>
        <th>Zeitpunkt</th><th>AC [W]</th>
        <th>DC1 U</th><th>DC1 I</th><th>DC1 P</th>
        <th>DC2 U</th><th>DC2 I</th><th>DC2 P</th>
        <th id="th-dc3-1">DC3 U</th><th id="th-dc3-2">DC3 I</th><th id="th-dc3-3">DC3 P</th>
        <th>L1 U</th><th>L1 P</th><th>L2 U</th><th>L2 P</th><th>L3 U</th><th>L3 P</th>
        <th>Hz</th><th>kWh</th><th>St</th><th>Err</th>
      </tr></thead>
      <tbody id="hTb"><tr><td colspan="22" style="color:var(--mut);text-align:center;padding:18px">Kein History-Import &ndash; History in den Einstellungen aktivieren</td></tr></tbody>
    </table>
    </div>
  </div>
</div>

<!-- ERTRAG -->
<div class="tc" id="tab-yields">
  <div class="card" style="padding:13px 16px">
    <div style="display:flex;align-items:center;flex-wrap:wrap;gap:14px">
      <div><div class="muted" style="font-size:10px">Gesamtertrag</div><div style="font-weight:700;font-size:20px" id="y-total-kwh">--</div></div>
      <div><div class="muted" style="font-size:10px">Gesamt &euro;</div><div style="font-weight:700;font-size:20px;color:var(--grn)" id="y-total-eur">--</div></div>
      <div><div class="muted" style="font-size:10px">Erfasste Monate</div><div style="font-size:13px;font-weight:600" id="y-month-cnt">--</div></div>
      <div><div class="muted" style="font-size:10px">Inbetriebnahme</div><div style="font-size:13px;font-weight:600" id="y-epoch">--</div></div>
      <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="loadYields()" title="Tabelle neu laden">&#8635; Aktualisieren</button>
        <button class="btn" onclick="refreshYieldsAuto()" title="Monate aus dem lokalen History-Cache berechnen (nicht vom PIKO)">&#9889; Aus Cache</button>
        <button class="btn" onclick="restoreYieldsBackup()" title="monthly-yields.json.bak oder State-Snapshot wiederherstellen">&#9851; Backup</button>
        <button class="btn" onclick="restoreYieldsInflux()" title="Monatswerte aus InfluxDB laden (Grafana-Serie yield.monthly)">&#128190; InfluxDB</button>
        <button class="btn" onclick="clearYieldsAuto()" title="Automatisch berechnete Monatswerte entfernen">&#128465; Auto l&ouml;schen</button>
        <button class="btn" onclick="addYieldYear()" title="Leere Jahres-Spalte hinzuf&uuml;gen">&#43; Jahr</button>
        <button class="btn" onclick="fillYieldYears()" title="Alle Jahre von Inbetriebnahme bis heute">&#128197; Jahre auff&uuml;llen</button>
        <button class="btn" onclick="exportYields('json')" title="JSON-Backup herunterladen">&#8595; JSON</button>
        <button class="btn" onclick="exportYields('csv')" title="CSV f&uuml;r Excel">&#8595; CSV</button>
        <button class="btn" onclick="document.getElementById('y-import-file').click()" title="JSON oder CSV importieren">&#8593; Import</button>
        <button class="btn a" onclick="saveYieldSettings()" title="Verg&uuml;tung und kWp speichern">&#10003; Einstellungen</button>
      </div>
    </div>
    <input type="file" id="y-import-file" accept=".json,.csv,.txt" style="display:none" onchange="importYieldsFile(this)">
    <div id="yieldMsg" style="margin-top:8px;font-size:11px;color:var(--mut)"></div>
    <div style="margin-top:6px;font-size:10px;color:var(--mut)">
      <strong>Speicherort:</strong> <span class="yield-path" id="y-storage">–</span>
      <span id="y-history-range" style="display:block;margin-top:4px"></span>
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Einstellungen &amp; Vergleich</div>
    <div class="yield-toolbar">
      <label>Verg&uuml;tung [&euro;/kWh]
        <input type="text" id="y-tariff" value="0,3925" title="Einspeiseverg&uuml;tung in Euro pro kWh">
      </label>
      <label>Installierte Leistung [kWp]
        <input type="text" id="y-kwp" placeholder="auto" title="Leer = aus Modul-Konfiguration">
      </label>
      <label>Postleitzahl
        <input type="text" id="y-plz" maxlength="5" placeholder="87781" title="5-stellige PLZ (Wetter + regionaler Vergleich)">
      </label>
    </div>
    <div style="font-size:10px;color:var(--mut);line-height:1.6;margin-bottom:8px">
      <strong>Manuell eingeben:</strong> Zelle anklicken &rarr; Monatswert in Wh eintragen (wie in Excel). Blaue Werte = manuell, wei&szlig;e = aus History-Cache berechnet.
      Die Tabelle liegt unter <code>/opt/iobroker/iobroker-data/kostalpiko.N/</code> (nicht im Adapter-Ordner) und wird zusätzlich als State und nach InfluxDB gesichert.
      <strong>Aus Cache</strong> = Server-Speicher (history-cache.json), <em>nicht</em> direkt vom Wechselrichter &middot; neue Rohdaten: Historie-Tab &rarr; „Vom PIKO laden“.
      Gr&uuml;n/Rot = &uuml;ber/unter dem Durchschnitt aller Jahre f&uuml;r diesen Monat.
      <strong>+ Jahr</strong> = leere Spalte f&uuml;r Vorjahre &middot; <strong>Import/Export</strong> = Backup oder Excel-Migration.
      Regionale Referenz: <a href="https://ertragsdatenbank.de/auswertung/region.html" target="_blank" rel="noopener" style="color:var(--blu)">ertragsdatenbank.de</a>
    </div>
    <div class="kpi-grid" id="y-kpi"></div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Monatsertr&auml;ge [Wh] &ndash; Jahre als Spalten</div>
    <div class="yield-grid-wrap">
      <table class="yield-grid" id="y-grid">
        <thead><tr><th class="ymonth">Monat</th></tr></thead>
        <tbody><tr><td class="ymonth" style="color:var(--mut)">Lade...</td></tr></tbody>
      </table>
    </div>
  </div>

  <div class="card">
    <div class="ct"><span class="dot"></span>Jahresvergleich (Balkendiagramm)</div>
    <div class="nav-bar" style="margin-bottom:10px">
      <div class="nav-seg">
        <button class="nav-btn active" id="ych-mwh" onclick="setYieldChartUnit('mwh')">MWh</button>
        <button class="nav-btn" id="ych-kwh" onclick="setYieldChartUnit('kwhkwp')">kWh/kWp</button>
      </div>
      <div style="margin-left:auto;display:flex;gap:6px">
        <button class="nav-btn" onclick="selectAllChartYears(true)">Alle</button>
        <button class="nav-btn" onclick="selectAllChartYears(false)">Keine</button>
        <button class="nav-btn" onclick="selectRecentChartYears(3)">Letzte 3</button>
      </div>
    </div>
    <div class="yield-years" id="y-chart-years"></div>
    <div class="chart-box wide" style="min-height:320px">
      <div class="chart-title"><span>Monatsvergleich nach Jahren</span></div>
      <div class="chart-wrap" style="height:280px"><canvas id="chart-yields"></canvas></div>
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
    <label><input type="checkbox" id="aScrl" checked> An neueste halten</label>
    <button class="btn" onclick="loadLogs()">&#8635; Aktualisieren</button>
    <button class="btn" onclick="clearLogs()">&#128465; L&ouml;schen</button>
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
    module.exports = options => new KostalPikoAdapter(options);
} else {
    new KostalPikoAdapter();
}
// app.js wird aus admin/app.js geladen
const APP_JS_CODE = fs.readFileSync(path.join(__dirname, 'admin', 'app.js'), 'utf-8');
