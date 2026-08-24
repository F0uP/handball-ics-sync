# handball-ics-sync

Erzeugt automatisch eine `.ics`-Kalenderdatei mit allen Saisonspielen eines
Teams von [handball.net](https://www.handball.net), da die Plattform seit
kurzem keinen eigenen Kalender-Export mehr anbietet.

Ein GitHub-Actions-Workflow (`.github/workflows/update-ics.yml`) laeuft
taeglich, ruft die inoffizielle handball.net-API ab und committet die
aktualisierte `.ics`-Datei automatisch zurueck ins Repo.

## Manuell ausfuehren

```
node generate_ics.js <team-id-oder-url> [saison-startjahr]
node generate_ics.js 81768
node generate_ics.js https://www.handball.net/team/81768
node generate_ics.js 81768 2025   # Saison 2025/2026 statt aktueller Saison
```

Der Dateiname enthaelt bewusst kein Saisonjahr (`THW_Kiel_III_Spielplan.ics`),
damit die Kalender-Abo-URL auch nach einem Saisonwechsel stabil bleibt.

## Einrichtung als Kalender-Abo

1. Dieses Repo auf GitHub **oeffentlich** pushen (siehe unten).
2. In Settings -> Actions -> General sicherstellen, dass Workflow-Berechtigungen
   nicht blockiert sind (das Workflow-File setzt `permissions: contents: write`
   bereits selbst, das reicht in der Regel aus).
3. Einmal manuell ueber den "Run workflow"-Button im Actions-Tab anstossen,
   damit die Datei im Repo landet.
4. Repo bei Netlify verbinden, damit die Datei ueber eine stabile URL ganz ohne
   CDN-Bot-Schutz ausgeliefert wird (siehe naechster Abschnitt, warum das
   noetig ist).
5. Diese URL im Kalender-Programm als Abo hinzufuegen:

   ```
   https://<dein-netlify-site-name>.netlify.app/THW_Kiel_III_Spielplan.ics
   ```

   (Google Calendar: "Von URL", Outlook: "Kalender abonnieren", Apple Kalender:
   "Neues Kalenderabo" - dort ggf. `webcal://` statt `https://` verwenden.)

### Warum Netlify statt raw.githubusercontent.com / jsDelivr

`raw.githubusercontent.com` liefert `.ics`-Dateien mit `Content-Type: text/plain`
statt `text/calendar` aus - das allein reicht schon, damit Google Calendars
"Von URL hinzufuegen" mit einer generischen "Oops, we couldn't add this
calendar"-Fehlermeldung ablehnt. Als Alternative mit korrektem Content-Type
wurde jsDelivr getestet (spiegelt GitHub-Repos 1:1) - das scheiterte aber
mit demselben Fehler. Vermutung: Cloudflare (hinter jsDelivr) und Fastly
(hinter raw.githubusercontent.com) stufen Anfragen aus Google-Cloud-IP-Bereichen
teils als Bot-Traffic ein und blocken sie, weil echte Nutzer selten von dort
browsen. Ein Test mit unterschiedlichen User-Agents zeigte keine Blockade,
das schliesst IP-basierte Bot-Erkennung aber nicht aus. Ein zum Vergleich
getesteter Feed auf einer ungeschuetzten WordPress-Seite (ohne CDN/Bot-Schutz)
funktionierte dagegen anstandslos. Netlify hat standardmaessig keinen
vergleichbar aggressiven Bot-Schutz und deployt automatisch bei jedem Push,
verpackt sich also nahtlos in den taeglichen Auto-Update-Workflow.

`netlify.toml` in diesem Repo setzt zusaetzlich explizit den korrekten
`Content-Type: text/calendar`-Header fuer die `.ics`-Datei, unabhaengig von
Netlifys eigener MIME-Type-Erkennung.

**Einrichtung bei Netlify:**

1. Auf [app.netlify.com](https://app.netlify.com) mit dem GitHub-Account einloggen.
2. "Add new site" -> "Import an existing project" -> GitHub auswaehlen,
   Repo `handball-ics-sync` verbinden.
3. Build-Einstellungen leer lassen (kein Build-Command, Publish-Directory `.`
   - steht bereits in `netlify.toml`).
4. Deploy anstossen. Netlify vergibt eine Standard-URL wie
   `https://<zufaelliger-name>.netlify.app` (unter "Site settings" -> "Change
   site name" laesst sich ein sprechenderer Name setzen).
5. Die `.ics`-Datei ist danach direkt unter
   `https://<site-name>.netlify.app/THW_Kiel_III_Spielplan.ics` erreichbar
   und wird bei jedem Push (auch durch den taeglichen GitHub-Actions-Workflow)
   automatisch neu deployt.

## Push auf GitHub (einmalig)

```
git remote add origin https://github.com/<dein-github-user>/handball-ics-sync.git
git branch -M main
git push -u origin main
```
