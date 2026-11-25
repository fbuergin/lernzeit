# Lernzeit – Zeit-Tracker für den Unialltag

Eine iPhone-App als **PWA** (Progressive Web App). Einmal installiert läuft sie komplett offline
auf dem iPhone, ganz ohne Computer, Server oder laufendes Skript. Alle Daten bleiben lokal auf dem Gerät.

## Aufs iPhone bringen (einmalig, kostenlos)

Die Dateien müssen einmal über HTTPS erreichbar sein, damit Safari sie installieren kann.
Danach speichert das iPhone alles lokal und braucht die Webseite nicht mehr.

### Variante A: GitHub Pages (empfohlen, dauerhaft gratis)
1. Auf github.com einen kostenlosen Account anlegen → **New repository**, z. B. `lernzeit`, auf **Public** stellen.
2. **Add file → Upload files** → den *Inhalt* des Ordners `Lernzeit` hineinziehen
   (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, Ordner `icons`) → **Commit**.
3. **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)` → **Save**.
4. Nach ca. 1 Minute ist die App unter `https://<dein-name>.github.io/lernzeit/` erreichbar.

### Variante B: Netlify Drop
Auf https://app.netlify.com/drop den Ordner `Lernzeit` hineinziehen (kostenloser Account nötig, damit die Seite bleibt).

### Auf dem iPhone installieren
1. Den Link in **Safari** öffnen.
2. **Teilen** → **Zum Home-Bildschirm** → **Hinzufügen**.
3. Ab jetzt die App über das Icon starten. Sie läuft im Vollbild und offline.

## Updates
Geänderte Dateien wieder hochladen und in `sw.js` die Zeile `const CACHE = 'lernzeit-v1'` hochzählen (v2, v3 …).
Die App holt sich das Update beim nächsten Öffnen mit Internet; die Daten bleiben erhalten.

## Daten & Backup
- Gespeichert im lokalen Speicher der Home-Bildschirm-App (bleibt, solange die App installiert ist).
- **Achtung:** Wenn das App-Icon gelöscht wird, sind die Daten weg. Deshalb unter *Mehr → Backup exportieren*
  ab und zu eine JSON-Datei in „Dateien“/iCloud sichern. Mit *Backup importieren* kommt alles zurück.
- CSV-Export für Excel/Numbers ist ebenfalls drin.

## Lokal testen (am PC)
```
python -m http.server 8765
```
Dann http://localhost:8765 öffnen.

## Aufbau
| Datei | Zweck |
|---|---|
| `index.html` | Grundgerüst, Tab-Leiste, Sheet-Container |
| `styles.css` | Liquid-Glass-Design, Hell-/Dunkelmodus |
| `app.js` | Gesamte Logik: Timer, Sessions, Statistiken, Einstellungen (Vanilla JS, keine Abhängigkeiten) |
| `sw.js` | Service Worker → Offline-Fähigkeit |
| `manifest.webmanifest` | App-Name, Icons, Vollbild-Modus |
