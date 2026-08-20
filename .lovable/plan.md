# Bot schnell zum Laufen bringen – ohne Credits zu verbrennen

Das teuerste Muster bisher: jeder Fehlversuch = neue Lovable-Runde (Code ändern, deployen, Lauf starten, Screenshot posten). Ziel: Diagnose auf den Bot-Server verlagern, damit du dort in Sekunden testen kannst und Lovable nur noch für echte Code-Änderungen brauchst.

## Grundidee

1. **Selektoren gehören ins Bot-Profil (DB), nicht in den Code.** Ein falscher Selektor darf nie ein Redeploy erfordern – du korrigierst ihn im Admin-UI und startest neu. Das ist bereits so angelegt (`bot_profiles.steps`), wir nutzen es konsequent.
2. **Fehler müssen selbsterklärend sein.** Screenshot + Seiten-URL + Titel gibt es schon; ergänzen um gespeichertes HTML und eine Liste sichtbarer Kandidaten-Elemente (Buttons/Inputs mit Text, id, name), damit du den richtigen Selektor direkt ablesen kannst statt zu raten.
3. **Diagnose direkt am echten Lauf.** Kein separater Testmodus – die Artefakte des fehlgeschlagenen Portal-Laufs (Screenshot, HTML, Elementliste) reichen, um den Selektor im Admin zu korrigieren und neu zu starten.

## Vorschlag: 2 Bausteine (einmalige Umsetzung)

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

## Wie wir Credits sparen (Arbeitsweise)

- Ein einziger Umsetzungs-Durchgang für A+B, danach iterierst du selbst über Profil-Selektoren im Admin.
- Statt Screenshots von Fehlläufen zu schicken: Artefakte des Laufs (Screenshot + Elementliste) im Admin öffnen, Selektor korrigieren, neuen Lauf starten.
- Lovable nur noch holen, wenn (a) eine neue Aktion/Feature im Runner fehlt oder (b) ein echter Bug im Code auftritt – nicht für Selektor-Korrekturen.
- Kein Frontend-Deploy nötig für Runner-Änderungen; Bot-Server-Pull reicht.

## Technische Details

- Datei: `bot-runner/server.ts` (Schritt-Loop und Fehlerbehandlung)
- Storage-Pfade wie bisher unter `bot-runs/<run_id>/…`, zusätzlich `page-*.html`, `trace-*.zip`
- Kein Schema-Change nötig, wenn Multi-Selektor als `"a, b"`-CSS-Liste oder JSON-Array in `steps` interpretiert wird
- Admin-UI (`admin.bots.tsx`) bekommt Links zu HTML/Trace-Artefakten, sonst unverändert

