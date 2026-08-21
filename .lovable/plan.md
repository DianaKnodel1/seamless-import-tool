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
