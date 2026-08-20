# Bot schnell zum Laufen bringen – ohne Credits zu verbrennen

Das teuerste Muster bisher: jeder Fehlversuch = neue Lovable-Runde (Code ändern, deployen, Lauf starten, Screenshot posten). Ziel: Diagnose auf den Bot-Server verlagern, damit du dort in Sekunden testen kannst und Lovable nur noch für echte Code-Änderungen brauchst.

## Grundidee

1. **Selektoren gehören ins Bot-Profil (DB), nicht in den Code.** Ein falscher Selektor darf nie ein Redeploy erfordern – du korrigierst ihn im Admin-UI und startest neu. Das ist bereits so angelegt (`bot_profiles.steps`), wir nutzen es konsequent.
2. **Fehler müssen selbsterklärend sein.** Screenshot + Seiten-URL + Titel gibt es schon; ergänzen um gespeichertes HTML und eine Liste sichtbarer Kandidaten-Elemente (Buttons/Inputs mit Text, id, name), damit du den richtigen Selektor direkt ablesen kannst statt zu raten.
3. **Lokaler Test-Modus auf dem Server.** Ein Kommando, das einen Bot-Profil-Lauf im sichtbaren/Trace-Modus gegen die Bankseite fährt, ohne Portal-Queue. Damit testest du Selektoren in Minuten statt Deploy-Zyklen.

## Vorschlag: 3 kleine Bausteine (einmalige Umsetzung)

### A. Bessere Fehler-Diagnose im Runner
Bei Schritt-Fehler zusätzlich speichern:
- `page.content()` als HTML-Datei in Storage
- Liste der interaktiven Elemente (Text, tag, id, name, type, sichtbar)
- Playwright-Trace-Zip (nur bei Fehler)

Ergebnis: Du siehst im Admin genau, was der Bot gesehen hat, und kannst den Selektor sofort korrigieren.

### B. Selektor-Robustheit
- Mehrere Selektoren pro Schritt erlauben (`selector` darf Liste sein → erster Treffer gewinnt)
- Fallback auf Text-basierte Suche (`getByRole('button', { name: ... })`) wenn CSS nicht greift
- Optional-Flag konsequent für Cookie-/Zwischenschritte

Damit überleben Läufe kleine Layout-Änderungen der Bank.

### C. Offline-Testkommando
`node --import tsx bot-runner/server.ts --dry-run --profile <id>`:
- lädt Profil + Steps aus der DB
- startet Browser (headless abschaltbar), läuft die Steps durch
- schreibt Screenshot pro Schritt nach `./debug/`
- schreibt nichts in `bot_runs`

Du testest damit direkt auf dem Bot-Server, ohne Portal-Lauf und ohne Lovable-Runde.

## Wie wir Credits sparen (Arbeitsweise)

- Ein einziger Umsetzungs-Durchgang für A+B+C, danach iterierst du selbst über Profil-Selektoren im Admin.
- Statt Screenshots von Fehlläufen zu schicken: erst `--dry-run` laufen lassen, den Kandidaten-Dump lesen, Selektor im Admin fixen.
- Lovable nur noch holen, wenn (a) eine neue Aktion/Feature im Runner fehlt oder (b) ein echter Bug im Code auftritt – nicht für Selektor-Korrekturen.
- Kein Frontend-Deploy nötig für Runner-Änderungen; Bot-Server-Pull reicht.

## Technische Details

- Datei: `bot-runner/server.ts` (Schritt-Loop, Fehlerbehandlung, neuer CLI-Modus)
- Storage-Pfade wie bisher unter `bot-runs/<run_id>/…`, zusätzlich `page-*.html`, `trace-*.zip`
- Kein Schema-Change nötig, wenn Multi-Selektor als `"a, b"`-CSS-Liste oder JSON-Array in `steps` interpretiert wird
- Admin-UI (`admin.bots.tsx`) bekommt Links zu HTML/Trace-Artefakten, sonst unverändert

## Offene Frage

Reicht dir A+B+C, oder willst du zuerst nur C (Testkommando), damit du selbst diagnostizieren kannst und wir danach gezielt fixen?
