# Installation – iobroker.kostalpiko

Dieser Adapter ist **nicht im offiziellen ioBroker-Repository** enthalten und muss daher manuell installiert werden. Es gibt drei Wege.

---

## Methode A – Admin UI mit GitHub-URL (empfohlen)

Kein Terminal erforderlich, funktioniert direkt im Browser.

1. ioBroker Admin öffnen → **Adapter**-Tab
2. Oben rechts auf das **🐙 Octocat-Icon** klicken  
   *(„Adapter von eigener URL installieren")*
3. Tab **„ANY"** auswählen
4. Folgende URL eintragen:
   ```
   https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/
   ```
5. **„Installieren"** klicken und warten (~30 Sekunden)
6. Nach der Installation erscheint der Adapter in der Liste  
   → Auf **„+ Instanz hinzufügen"** klicken
7. Instanz konfigurieren (IP-Adresse des PIKO, Intervall, InfluxDB-Instanz)
8. Instanz starten

> ⚠️ **Wichtig:** Verwende die URL mit `/tarball/main/` am Ende – nur so liefert GitHub ein installierbares Paket. Die normale Repo-URL `https://github.com/.../iobroker.kostalpiko` funktioniert **nicht**.

---

## Methode B – Kommandozeile (SSH/Terminal)

```bash
# 1. In das ioBroker-Verzeichnis wechseln
cd /opt/iobroker

# 2. Adapter von GitHub installieren
npm install https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/

# 3. Adapter bei ioBroker registrieren und erste Instanz anlegen
iobroker add kostalpiko

# 4. Adapter starten
iobroker start kostalpiko.0
```

Im ioBroker-Log sollte erscheinen:
```
[SYSTEM] Kostal PIKO Adapter v0.2.0 gestartet
[SYSTEM] Web-UI: http://0.0.0.0:8092/
```

---

## Methode C – Offline / manuell (ohne Internet)

Für Installationen ohne Internetzugang auf dem ioBroker-Server.

```bash
# 1. Zielordner anlegen
mkdir -p /opt/iobroker/node_modules/iobroker.kostalpiko

# 2. Dateien kopieren (USB-Stick, SCP, WinSCP …)
#    Alle Dateien aus dem ZIP in folgenden Ordner:
#    /opt/iobroker/node_modules/iobroker.kostalpiko/
#
#    Benötigte Dateien:
#      main.js
#      io-package.json
#      package.json
#      admin/jsonConfig.json
#      admin/kostal-piko-icon.svg

# 3. Abhängigkeiten installieren
cd /opt/iobroker/node_modules/iobroker.kostalpiko
npm install

# 4. Adapter registrieren
cd /opt/iobroker
iobroker add kostalpiko

# 5. Starten
iobroker start kostalpiko.0
```

---

## Update

### Über Admin UI

Gleicher Weg wie bei der Installation (Methode A) – einfach die URL erneut eintragen. Die bestehende Instanz-Konfiguration bleibt erhalten.

### Über Kommandozeile

```bash
cd /opt/iobroker
npm install https://github.com/MPunktBPunkt/iobroker.kostalpiko/tarball/main/
iobroker restart kostalpiko.0
```

---

## Firewall

Falls das Web-UI von anderen Geräten im Netzwerk erreichbar sein soll:

```bash
sudo ufw allow 8092/tcp
```

---

## Deinstallation

```bash
iobroker del kostalpiko.0      # Instanz löschen
iobroker del kostalpiko        # Adapter deregistrieren
npm uninstall iobroker.kostalpiko --prefix /opt/iobroker
```
