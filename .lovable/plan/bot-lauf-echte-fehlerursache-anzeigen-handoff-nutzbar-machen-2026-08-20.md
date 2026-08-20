# Bot-Lauf: echte Fehlerursache anzeigen + Handoff nutzbar machen

## Was die Logs zeigen

Der Lauf ist nicht an den Selektoren gescheitert, sondern an der Zieladresse:

```text
Schritt 1/14 ok: Startseite öffnen
Schritt 3 ... auf https://www.deutsche-bank.de/pk/konto-und-karte/girokonto.html
("Fehlerseite 404 Seite nicht gefunden | Deutsche Bank")
```

Die im Bot-Profil hinterlegte URL liefert eine 404-Seite. Schritt 1 wurde trotzdem als "ok"
gewertet, weil der Runner nur prüft, ob der Server *irgendetwas* antwortet – nicht, ob es die
richtige Seite ist. Danach müssen Cookie-Banner und "Jetzt eröffnen" zwangsläufig fehlschlagen.

Zwei weitere Punkte aus dem Screenshot:
- Der Hinweis "Bitte Screenshot prüfen" führt ins Leere – im Warteschlangen-Panel gibt es
  überhaupt keinen Link zum Screenshot (die Dateien liegen in einem privaten Speicher).
- "Übernehmen" schreibt derzeit nur intern `claimed_by`/`claimed_at` in die Datenbank. Es
  passiert sichtbar nichts, es öffnet sich nichts – deshalb wirkt der Knopf kaputt.

## Was gebaut wird

### 1. Fehlerseiten sofort erkennen (Bot-Runner)
- Nach jedem `goto` HTTP-Status und Seitentitel prüfen. Bei Status >= 400 oder Titeln/Texten wie
  "404", "Seite nicht gefunden", "Fehlerseite", "Zugriff verweigert" bricht der Lauf sofort mit
  Klartext ab: *"Die Startseite liefert 404 – bitte URL im Bot-Profil korrigieren."*
- Gleiche Prüfung vor jedem Klick-/Fill-Schritt, damit ein Zwischenschritt auf einer Fehlerseite
  nicht 3x12 Sekunden lang auf Elemente wartet.
- Ergebnis: statt "Element nicht erreichbar" nach 4 Minuten kommt nach wenigen Sekunden die
  wirkliche Ursache.

### 2. Handoff-Panel, mit dem man wirklich arbeiten kann (Portal)
Das Feld "1 Lauf/Läufe warten auf dich" wird ausklappbar und zeigt:
- **Screenshot-Vorschau** der Seite, auf der es hakte (signierter Link, klickbar auf Vollbild).
- **"Seite öffnen"** – öffnet die letzte Bot-URL in einem neuen Tab.
- **Die Daten des Laufs** (Name, E-Mail, Telefon, Passwort, Vorgangsnummer) mit Kopier-Knopf,
  damit du sofort manuell weitermachen kannst, ohne sie zu suchen.
- **"Diagnose"** – Seiten-HTML, Trace und die Liste der tatsächlich vorhandenen Elemente mit
  Selektor-Vorschlägen zum Einfügen ins Bot-Profil.
- **"Abbrechen"/"Erledigt"** wie bisher.

### 3. "Übernehmen" bekommt Wirkung
- Klick klappt das Panel auf, öffnet die Bot-URL in einem neuen Tab und zeigt eine Bestätigung.
- Der Lauf wird sichtbar als "von dir übernommen · <Name> · <Uhrzeit>" markiert, damit kein
  zweiter Admin parallel dranarbeitet; ein zweiter Klick gibt ihn wieder frei.

### 4. URL im Profil korrigieren
Nach dem Deploy im Profil "Deutsche Bank – Girokonto" die Start-URL auf die aktuelle,
funktionierende Seite ändern (die alte `.../girokonto.html` existiert nicht mehr). Das ist eine
reine Eingabe im Portal – dafür ist keine weitere Entwicklungsrunde nötig.

## Technische Details
- `bot-runner/server.ts`: `gotoWithRetry` gibt die `Response` zurück; neue Hilfsfunktion
  `assertPageOk(page, response)` prüft Status und Titel/H1 und wirft einen klaren Fehler mit
  `handoff_reason` statt eines Timeouts.
- `src/lib/bots.functions.ts`: bereits vorhandene `getBotArtifactUrl` (signierte Links, nur Admin,
  Pfad-Prefix `bot-runs/`) wird auch fürs Handoff-Panel genutzt; `claimBotRun` bekommt ein
  `release`-Flag und gibt `claimed_by`/`claimed_at` an die UI zurück.
- `src/routes/admin.bots.tsx`: Handoff-Karte wird zu einer aufklappbaren Komponente mit
  Screenshot-Vorschau, Datenliste, Links und Diagnose-Dialog (`BotRunDebugDialog` wird
  wiederverwendet).

## Rollout
1. Portal-Server: `cd /opt/apps/portal && bash scripts/deploy.sh`
2. Bot-Server: `cd /opt/apps/portal && git pull && bash scripts/setup-bot-runner.sh`
3. Im Portal die Start-URL des Profils korrigieren, dann neuen Lauf starten.
