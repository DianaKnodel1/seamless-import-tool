# Zwei Fixes: Bot bricht bei Schritt 3 ab, Chat zeigt neue Nachrichten nicht

## 1. Chat: neueste Nachricht fehlt im großen Fenster

Bestätigte Ursache im Code (`src/routes/admin.chat.tsx`, Zeile 250–255): der Verlauf wird
aufsteigend sortiert mit `limit(200)` geladen. Damit kommen die **ältesten 200** Nachrichten
zurück — alles Neuere fällt weg. Die Sidebar zeigt dagegen die zuletzt gesendete Nachricht aus
einer eigenen Abfrage, deshalb der Widerspruch im Screenshot: Marcel steht mit "Was ist mit dem
chat passiert?" in der Liste, im Fenster endet der Verlauf früher.

Fix:
- Verlauf absteigend laden (neueste 200) und für die Anzeige umdrehen — Marcels neueste
  Nachrichten sind sofort sichtbar.
- Fehler der Abfrage nicht mehr verschlucken (`error` auswerten, Hinweis "Verlauf konnte nicht
  geladen werden – erneut versuchen" statt stiller Leere).
- "Ältere Nachrichten laden"-Button für den Rest des Verlaufs, damit nichts unerreichbar wird.
- Realtime-Handler auf Refs umstellen (aktuell hängt der Effekt an `conversations` und wird bei
  jeder Nachricht neu aufgebaut) und eingehende Nachrichten deduplizieren.

Erster Schritt vor dem Fix: Anzahl der Nachrichten in Marcels Chat prüfen, um zu bestätigen,
dass die 200er-Grenze in seinem Fall wirklich greift.

## 2. Bot: Abbruch bei Schritt 3 ("page.click: Timeout 20000ms exceeded")

Der Lauf (Deutsche Bank – Girokonto, 3/14) bricht beim Klick ab: der im Profil hinterlegte
Selektor war nach 20 Sekunden nicht klickbar. Typische Gründe, die der Runner heute nicht
behandelt:
- Cookie-/Consent-Layer liegt über der Seite; jeder Klick trifft das Overlay.
- Selektor stimmt nicht mehr oder das Element steckt in einem iFrame.
- Element existiert, ist aber noch nicht sichtbar/scrollbar.

Aktuell liefert ein Fehlschlag nur die Timeout-Meldung — kein Screenshot, kein Seiten-Zustand.
Deshalb zuerst Sichtbarkeit, dann Robustheit (`bot-runner/server.ts`):

1. **Diagnose:** bei jedem Schritt-Fehler automatisch Screenshot + aktuelle URL + Seitentitel
   speichern und im Portal am Lauf anzeigen. Damit ist in einem Testlauf sichtbar, woran
   Schritt 3 hängt.
2. **Cookie-Banner:** vor jedem Klick/Fill die gängigen Consent-Buttons ("Alle akzeptieren",
   "Zustimmen", "Akzeptieren", Usercentrics/OneTrust-Container, auch in iFrames) einmalig
   wegklicken.
3. **Klick-Robustheit:** Klicks mit mehreren Versuchen, davor `scrollIntoViewIfNeeded`, Fallback
   auf Text-/Rollen-Suche, wenn der CSS-Selektor nicht greift; letzter Versuch als
   JavaScript-Klick.
4. **Timeouts:** Standard-Timeout für Interaktionen konfigurierbar (Standard 35 s statt 20 s).
5. **Statt "Fehlgeschlagen" bei Selektorproblemen** den Lauf auf "Wartet auf Admin" setzen, mit
   Screenshot und Seitenlink — so kann der Vorgang manuell weitergeführt werden, statt komplett
   zu sterben.

Danach ein Testlauf; anhand des Screenshots wird bei Bedarf der Selektor im Bot-Profil
korrigiert (das ist Konfiguration, keine Codeänderung).

## Technische Details

- `src/routes/admin.chat.tsx`: Verlaufsabfrage `order(desc).limit(200)` + `reverse()`,
  Fehlerbehandlung, Nachladen älterer Nachrichten, Realtime-Effekt ohne `conversations`-Dependency.
- `bot-runner/server.ts`: Helfer `dismissConsent(page)`, `clickWithRetry(page, selector)`,
  Fehler-Screenshot in `documents/bot-runs/<run>/step-error-*.png`, neue Env `STEP_TIMEOUT_MS`.
- Kein Frontend-Deploy nötig für den Bot-Teil; auf dem Bot-Server danach
  `git pull && bash scripts/setup-bot-runner.sh`.
