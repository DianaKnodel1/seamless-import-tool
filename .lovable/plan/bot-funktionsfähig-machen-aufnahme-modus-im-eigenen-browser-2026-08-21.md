# Bot funktionsfähig machen — Aufnahme-Modus im eigenen Browser

## Das Grundproblem

Der Bot scheitert nicht am Code, sondern an zwei Dingen:

1. **Falsche/veraltete Angaben im Profil** (Start-URL der Deutschen Bank ist eine 404-Seite, Selektoren passen nicht mehr).
2. **Links, die sich pro Durchlauf ändern** — Verifizierungs-Mails, Session-URLs. Die kann man nicht fest ins Profil schreiben.

Lösung: Du klickst den Antrag **einmal in deinem eigenen Browser** durch, alles wird mitgeschrieben und daraus wird ein fertiges Bot-Profil. Wechselnde Links löst der Bot durch Klicken/Warten statt feste Adressen — und dort, wo nur du weiterhelfen kannst (Mail-Link, SMS-Code), hält er kurz an und fragt dich.

## 1. Recorder für deinen Browser

Ein **Bookmarklet** (Lesezeichen mit Skript) aus dem Portal:

- Im Portal: „Aufnahme starten" → du bekommst ein Lesezeichen + einen Aufnahme-Code.
- Auf der Bankseite Lesezeichen anklicken → kleine Leiste unten rechts: „Aufnahme läuft · 7 Schritte · Stopp".
- Du füllst den Antrag ganz normal aus. Jeder Klick, jede Eingabe, jede Auswahl und jeder Seitenwechsel wird als Schritt gespeichert (Selektor-Priorität: Label > Rolle+Text > `data-testid` > stabile CSS-Kette, immer 2–3 Alternativen mit `||`).
- „Stopp" → Ablauf landet im Portal unter „Aufnahmen".

Wichtig: **Passwörter und eingegebene Werte werden nicht im Klartext gespeichert**, sondern als Platzhalter (siehe unten).

## 2. Automatisch bereinigen — ja, das ist besser

Du hast gefragt, was besser ist: **automatisch bereinigen**, aber mit sichtbarer Kontrolle. Ein Rohmitschnitt hat typisch 60–120 Schritte voller Zufallsklicks und Scrollen — den will niemand von Hand aufräumen. Deshalb:

- Doppelklicks, Fokuswechsel, Scrollen, Cookie-Banner werden zusammengefasst bzw. als *optionaler* erster Schritt markiert.
- Eingegebene Werte werden erkannt und durch Platzhalter ersetzt: `{{email}}`, `{{vorname}}`, `{{nachname}}`, `{{geburtsdatum}}`, `{{passwort}}`.
- Instabile Selektoren (zufällige IDs, `nth-child`-Ketten) werden durch Label/Text-Varianten ersetzt.
- **Du siehst danach eine Vorher/Nachher-Liste** und kannst jeden Schritt einzeln behalten, ändern oder löschen, bevor gespeichert wird. Der Rohmitschnitt bleibt zusätzlich erhalten, falls die Bereinigung mal danebenliegt.

## 3. Wechselnde Links

- Nach dem Absenden **klickt** der Bot weiter, statt eine URL zu raten — Session-Tokens sind ihm dann egal.
- Neuer Schritt-Typ `wait_for`: „warte, bis Adresse zu `**/verifizierung/**` passt" oder bis ein Text erscheint.
- Neuer Schritt-Typ `prompt`: Bot hält an, in der Handoff-Karte erscheint ein Eingabefeld („Verifizierungslink aus der Mail einfügen"), du fügst ein → Bot läuft an derselben Stelle weiter. Genau dein Fall, weil du die E-Mail pro Durchlauf selbst wählst.

## 4. Fortsetzen statt Neustart

Pausierte oder abgebrochene Läufe bekommen „Ab Schritt X fortsetzen". Session (Cookies) wird gesichert, damit der Bot eingeloggt weitermacht. Du korrigierst einen Selektor und musst nicht den ganzen Antrag neu starten.

## Wie es dann bei dir abläuft

1. Portal → Bots → „Neue Aufnahme", Bank auswählen.
2. Bankseite öffnen, Bookmarklet klicken, Antrag einmal normal durchklicken (bis zur Mail-Verifizierung), Stopp.
3. Portal zeigt den bereinigten Ablauf, du bestätigst → Profil ist da.
4. Testlauf starten. An der Verifizierung hält der Bot an und fragt dich nach dem Link.
5. Fehlt noch was, siehst du es in der Diagnose und korrigierst nur den einen Schritt.

## Technische Details

- Recorder: Bookmarklet lädt `/api/public/recorder.js` (IIFE, kein Framework), hängt capture-Listener für `click`, `change`, `input` (debounced), `submit` sowie `popstate`/`pushstate` an, puffert Schritte lokal und POSTet an `/api/public/bot-recordings` mit kurzlebigem Aufnahme-Token (Zod-validiert, Token-Ablauf 2 h, kein PII-Klartext — Werte werden clientseitig maskiert/als Platzhalter ersetzt).
- Selektor-Erzeugung im Bookmarklet: `aria-label`/`<label for>` → `role+accessible name` → `data-testid`/`name`/`id` (nur wenn nicht zufällig aussehend) → kurze CSS-Kette; Ausgabe als `a || b || c`, passend zum vorhandenen `splitSelectors`/`resolveLocator` im Runner.
- Neue Tabelle `bot_recordings` (id, tenant_id, profile_id nullable, token_hash, status, raw_steps jsonb, cleaned_steps jsonb, created_by, expires_at) mit GRANTs + RLS (Admin-only lesen/schreiben; der öffentliche Endpoint schreibt tokenbasiert via `supabaseAdmin` nach Token-Prüfung).
- Bereinigung als reine Funktion `src/lib/recording-clean.ts` (server- und clientseitig nutzbar, unit-testbar), Vorher/Nachher-Diff-UI unter `src/routes/admin.bots.recordings.tsx` bzw. Dialog in `admin.bots.tsx`.
- `StepSchema` in `src/lib/bots.functions.ts` erweitern: Aktionen `prompt`, `wait_for`; Felder `var_name`, `url_pattern`, `text_pattern`.
- Migration auf `bot_runs`: `run_vars jsonb`, `pending_var text`, `resume_step int`, `storage_state jsonb`.
- Runner (`bot-runner/server.ts`): Template-Auflösung `{{key}}` gegen `input_data` + `credentials` + `run_vars`; `prompt` setzt `waiting_admin` + `pending_var`; Start bei `resume_step`; `storage_state` sichern/laden.
