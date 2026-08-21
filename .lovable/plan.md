# Chat-Fixes: fehlende Nachrichten + falscher Tipp-Indikator

## Beobachtung
- Maria und Marcel sehen im Chat nicht alle Nachrichten; nach Neuladen wirkt der Verlauf veraltet.
- Dirk: "Luisa tippt live..." flackert, obwohl niemand schreibt.

Zwei getrennte Fehler, beide nur auf der Mitarbeiter-Seite.

## Fehler 1: es werden die 200 AELTESTEN Nachrichten geladen
Chat-Fenster (FloatingChat) und Mitarbeiter-Chatseite laden den Verlauf
aufsteigend sortiert mit Limit 200 - also die 200 aeltesten Nachrichten.
Bei langer Historie kommen die neuen nie an: waehrend der Sitzung sind sie
live sichtbar, nach Reload zeigt der geladene Verlauf wieder den alten Stand.
In der Admin-Ansicht wurde genau das schon auf "neueste zuerst" umgestellt,
auf der Mitarbeiter-Seite nicht.

Fix: neueste 200 laden (absteigend abfragen, fuer die Anzeige chronologisch
sortieren) - in beiden Mitarbeiter-Ansichten, plus Button "Aeltere Nachrichten
laden" fuer den kompletten Verlauf.

## Fehler 2: Nachrichten mit "Hallo"/"Willkommen" gelten als Systemmeldung
Auf der Mitarbeiter-Chatseite gilt jede Teamleiter-Nachricht, die mit
"Hallo", "Willkommen" oder einem der Emoji-Praefixe beginnt, als
Systemmeldung und wird anders (unauffaellig, mittig) dargestellt. Deine
echten Antworten beginnen oft mit "Hallo Marcel, ..." - sie wirken dadurch
wie Systemtext und werden leicht uebersehen.

Fix: nur noch echte, vom System erzeugte Nachrichten so kennzeichnen
(Markierung an der Nachricht statt Raten am Text). Bis das Feld existiert:
Praefixe "Hallo" und "Willkommen" aus der Erkennung entfernen.

## Fehler 3: Tipp-Indikator zeigt fremdes Tippen
Das Chat-Fenster hoert auf einen globalen Kanal "floating-chat-main" und
zeigt "<Teamleiter> tippt gerade live..." sobald IRGENDEIN anderer Nutzer
t

## Fehler 3: Tipp-Indikator zeigt fremdes Tippen
Das Chat-Fenster hoert auf einen globalen Kanal und zeigt "tippt gerade
live...", sobald ir

## Fehler 3: Tipp-Indikator
Das Chat-Fenster hoert auf einen globalen Kanal.
Sobald irgendein anderer Mitarbeiter tippt, sehen alle den Hinweis.
Dein echtes Tippen erreicht sie dagegen nie: die Admin-Ansicht sendet auf
einem Kanal pro Unterhaltung, den das Chat-Fenster nicht abonniert.
Fix: beide Seiten nutzen denselben Kanal pro Gespraechspaar, der Empfaenger
prueft die Absender-ID, und der Hinweis erlischt nach 3 Sekunden ohne neues
Signal.
