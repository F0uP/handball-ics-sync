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
4. Diese URL im Kalender-Programm als Abo hinzufuegen:

   ```
   https://cdn.jsdelivr.net/gh/<dein-github-user>/handball-ics-sync@main/THW_Kiel_III_Spielplan.ics
   ```

   (Google Calendar: "Von URL", Outlook: "Kalender abonnieren", Apple Kalender:
   "Neues Kalenderabo" - dort ggf. `webcal://` statt `https://` verwenden.)

   Hinweis: Bewusst die jsDelivr-URL statt des direkten
   `raw.githubusercontent.com`-Links, da GitHub `.ics`-Dateien dort faelschlich
   mit `Content-Type: text/plain` statt `text/calendar` ausliefert - das lehnt
   Google Calendars "Von URL hinzufuegen" oft mit einer generischen
   "Oops, we couldn't add this calendar"-Fehlermeldung ab. jsDelivr spiegelt
   denselben Dateiinhalt, setzt aber den korrekten `text/calendar`-Header.
   jsDelivr cached bis zu ca. 12h, was sich mit dem taeglichen Auto-Update-Workflow
   vertraegt.

## Push auf GitHub (einmalig)

```
git remote add origin https://github.com/<dein-github-user>/handball-ics-sync.git
git branch -M main
git push -u origin main
```
