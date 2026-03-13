# Installation – iobroker.kostalpiko

Dieser Adapter ist **nicht im offiziellen ioBroker-Repository** enthalten und muss manuell installiert werden.

---

## Methode A – Admin UI mit GitHub-URL (empfohlen)

Kein Terminal erforderlich, funktioniert direkt im Browser.

1. ioBroker Admin öffnen → **Adapter**-Tab
2. Oben rechts auf das 🐙 **Octocat-Icon** klicken
3. Tab **„ANY"** auswählen
4. URL eintragen:
   ```
   https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/
   ```
5. **„Installieren"** klicken und warten (~30 Sekunden)
6. Instanz anlegen → konfigurieren → starten

> ⚠️ Die URL muss `/tarball/main/` am Ende haben. Die normale Repo-URL funktioniert nicht.

---

## Methode B – Kommandozeile

> ⚠️ **Bekanntes Problem bei der Erstinstallation:**  
> ioBroker sperrt `npm`-Aufrufe als `root`-User mit der Fehlermeldung:
> ```
> Sorry, user root is not allowed to execute '...npm install...' as iobroker
> ```
> **Lösung:** Den Befehl als `iobroker`-User ausführen:

```bash
sudo -u iobroker -H bash -c "cd /opt/iobroker && npm install https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/"
iobroker add kostalpiko
iobroker start kostalpiko.0
```

Im ioBroker-Log sollte danach erscheinen:
```
[SYSTEM] Kostal PIKO Adapter v0.3.1 gestartet
[SYSTEM] Web-UI: http://0.0.0.0:8092/
```

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
sudo -u iobroker -H bash -c "cd /opt/iobroker && npm install https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/"
iobroker restart kostalpiko.0
```

Bei mehreren Instanzen alle neu starten:
```bash
iobroker restart kostalpiko.0
iobroker restart kostalpiko.1
```

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
