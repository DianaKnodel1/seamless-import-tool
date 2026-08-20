# Bot funktionsfähig machen — einfach erklärt

## Das Grundproblem

Der Bot scheitert nicht am Code, sondern an zwei Dingen:

1. **Falsche/veraltete Angaben im Profil** (z. B. die Start-URL der Deutschen Bank ist eine 404-Seite, Selektoren passen nicht mehr).
2. **Links, die sich bei jedem Durchlauf ändern** — Verifizierungs-Mails, Session-URLs, Antragsnummern. Die kann man nicht fest ins Profil schreiben.

Punkt 1 löst man einmalig pro Bank. Punkt 2 löst man, indem der Bot **nie eine feste URL rät**, sondern entweder dem Klickpfad folgt oder an der Stelle kurz an dich übergibt.

## Wie man mit wechselnden Links umgeht

Drei Bausteine, alle ohne feste URL:

- **Klicken statt Adresse eintippen**: Nach dem Absenden nicht `goto https://…/verify?token=abc`, sondern der Bot bleibt auf der Seite und klickt weiter. Die Session-URL interessiert ihn dann gar nicht.
- **Warten auf ein Muster**: Ein Schritt „warte, bis die Adresse zu `**/verifizierung/**` passt" — egal welcher Token dranhängt.
- **Platzhalter für das, was nur du weißt**: Im Profil schreibst du `{{verify_url}}` oder `{{sms_code}}`. Der Bot hält an, zeigt dir die Handoff-Karte, du fügst den Link/Code aus der Mail ein, der Bot macht allein weiter. Das ist genau dein Fall, weil du die E-Mail pro Durchlauf selbst wählst.

## Was ich dafür bauen würde

### 1. Variablen in Schritten (`{{…}}`)
Jeder `value`/`selector` darf Platzhalter enthalten: `{{email}}`, `{{vorname}}`, `{{passwort}}`, `{{verify_url}}`, `{{sms_code}}`. Bekannte Werte kommen aus den Lauf-Daten, unbekannte fragt der Bot per Handoff bei dir ab.

### 2. Neuer Schritt-Typ „Eingabe vom Admin"
Aktion `prompt`: Bot pausiert, Handoff-Karte zeigt ein Eingabefeld („Bitte Verifizierungslink aus der Mail einfügen"), du fügst ein, Klick auf „Weiter" — Lauf läuft an derselben Stelle weiter, ohne Neustart von vorn.

### 3. Neuer Schritt-Typ „Warten auf URL/Text"
Aktion `wait_for` mit Muster (`**/onboarding/**` oder ein Text auf der Seite). Ersetzt starre Wartezeiten und feste Adressen.

### 4. Aufnahme-Modus für Selektoren (spart dir die meiste Arbeit)
Statt Selektoren zu raten: Der Runner öffnet die Bank-Seite einmal im sichtbaren Browser, du klickst den Antrag ganz normal einmal durch, jede Aktion wird als Schritt mitgeschrieben (mit robusten Selektoren: Label, Rolle, Text). Am Ende landet der Ablauf als fertiges Profil im Portal, das du nur noch nachbearbeitest.
Falls das zu groß ist: kleinere Variante = „Seite scannen"-Knopf, der dir alle Felder/Buttons der aktuellen Seite als Klickliste zeigt und den Selektor per Klick in den Schritt einträgt.

### 5. Fortsetzen statt Neustart
Ein pausierter/abgebrochener Lauf bekommt „Ab Schritt X fortsetzen" — du korrigierst einen Selektor und musst nicht den ganzen Antrag neu laufen lassen.

## Realistische Reihenfolge

1. Variablen + `prompt` + `wait_for` + „Fortsetzen" (macht wechselnde Links beherrschbar)
2. „Seite scannen"/Aufnahme-Modus (macht die Profilpflege schnell)
3. Danach ein einziger Anbieter komplett sauber durchziehen, erst dann weitere

## Was du parallel tun kannst (ohne Credits)

- Start-URL der Deutschen Bank korrigieren (die im Profil ist tot) — echte Antragsstrecke einmal im Browser öffnen und die Adresse kopieren, an der das Formular startet.
- Bei jedem gescheiterten Schritt „Diagnose" öffnen: dort stehen die gefundenen Kandidaten-Elemente; den passenden Selektor per Copy-Paste ins Profil setzen. Mehrere Alternativen mit `||` trennen.
- Cookie-Banner-Klick als ersten optionalen Schritt lassen.

## Technische Details

- `StepSchema` in `src/lib/bots.functions.ts` um `prompt` und `wait_for` erweitern; neue Felder `var_name`, `url_pattern`, `text_pattern`.
- Template-Auflösung im Runner: `{{key}}` gegen `input_data` + `credentials` + neue `run_vars` (JSONB-Spalte auf `bot_runs`).
- `prompt`: Runner setzt Status `waiting_admin` mit `pending_var`; Portal schreibt Wert nach `run_vars` und setzt Status auf `queued` mit `resume_step`.
- Runner startet bei `resume_step` statt bei 0; Sitzungs-Cookies via `storage_state` sichern, damit das Fortsetzen im eingeloggten Zustand passiert.
- Aufnahme-Modus: `playwright codegen`-artiger Listener im Runner (`--headed`), Selektor-Priorität `getByLabel` > `getByRole+Name` > `data-testid` > CSS.
- Migration nötig: `run_vars`, `pending_var`, `resume_step`, `storage_state` auf `bot_runs`.
