# Installation – iobroker.kostalpiko

Dieser Adapter ist **nicht im offiziellen ioBroker-Repository** enthalten und muss manuell installiert werden.

---

## Methode A – Kommandozeile (empfohlen)

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kostalpiko
iobroker add kostalpiko
```

Im ioBroker-Log sollte danach erscheinen:
```
[SYSTEM] Kostal PIKO Adapter v0.3.19 gestartet
[SYSTEM] Web-UI: http://0.0.0.0:8092/
```

---

## Methode B – Admin UI mit GitHub-URL

1. ioBroker Admin öffnen → **Adapter**-Tab
2. Oben rechts auf das 🐙 **Octocat-Icon** klicken
3. Tab **„ANY"** auswählen
4. URL eintragen:
   ```
   https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/
   ```
5. **„Installieren"** klicken und warten (~30 Sekunden)
6. Instanz anlegen → konfigurieren → starten

---

## Methode C – Offline / manuell

```bash
mkdir -p /opt/iobroker/node_modules/iobroker.kostalpiko
# Dateien nach /opt/iobroker/node_modules/iobroker.kostalpiko/ kopieren
#   Benötigt: main.js, io-package.json, package.json, admin/
cd /opt/iobroker/node_modules/iobroker.kostalpiko
npm install
cd /opt/iobroker
iobroker add kostalpiko
iobroker start kostalpiko.0
```

---

## Update

### Kommandozeile (empfohlen)

```bash
iobroker url https://github.com/MPunktBPunkt/iobroker.kostalpiko
iobroker restart kostalpiko
```

`iobroker restart kostalpiko` startet alle Instanzen (kostalpiko.0, kostalpiko.1 …) automatisch neu.

### Admin UI

Octocat-Icon → Tab „ANY" → gleiche URL eintragen → Installieren → Instanz(en) neu starten.

---

## Zweite Instanz (zweiter Wechselrichter)

Im Admin **Adapter → Kostal PIKO → „+ Instanz hinzufügen"** klicken.  
Wichtig: einen anderen **Web-UI Port** einstellen, z. B. `8093` für die zweite Instanz.

Die Datenpunkte sind vollständig getrennt:
- `kostalpiko.0.*` → erster Wechselrichter
- `kostalpiko.1.*` → zweiter Wechselrichter

---

## Deinstallation

```bash
iobroker del kostalpiko.0      # Instanz löschen
iobroker del kostalpiko        # Adapter deregistrieren
npm uninstall iobroker.kostalpiko --prefix /opt/iobroker
```

---

## Firewall

```bash
sudo ufw allow 8092/tcp   # Instanz 0
sudo ufw allow 8093/tcp   # Instanz 1 (falls vorhanden)
```
