# Chat-Fixes: fehlende Nachrichten beim Mitarbeiter + falscher Tipp-Indikator

## Was die Screenshots zeigen

- Maria und Marcel sehen im Chat nicht alle Nachrichten; nach Neuladen oder Schliessen des Fensters wirkt der Verlauf veraltet oder leer.
- Dirk meldet: "Luisa tippt live..." flackert, obwohl niemand schreibt.

Das sind zwei getrennte Fehler, beide nur auf der Mitarbeiter-Seite. Die Admin-Ansicht wurde bereits korrigiert, die Mitarbeiter-Seite nicht.

## Fehler 1: Es werden die 200 AELTESTEN Nachrichten geladen

Sowohl das Chat-Fenster unten rechts als auch die Chat-Seite des Mitarbeiters laden den Verlauf so:

```text
sortiere nach Datum AUFSTEIGEND, nimm die ersten 200
```

Bei Mitarbeitern mit langer Historie liefert das die 200 aeltesten Nachrichten - die neuen kommen nie an. Genau deshalb "verschwinden" Nachrichten beim Neuladen: waehrend der Sitzung kommen neue Nachrichten live rein und sind sichtbar, nach dem Reload zeigt der geladene Verlauf wieder nur den alten Stand. In der Admin-Ansicht wurde dieselbe Stelle bereits auf "neueste zuerst" umgestellt, auf der Mitarbeiter-Seite steht noch die alte Variante.

Fix: neueste 200 laden (absteigend abfragen, danach fuer die Anzeige wieder chronologisch sortieren) - in beiden Mitarbeiter-Ansichten. Zusaetzlich ein "Aeltere Nachrichten laden"-Button, damit der komplette Verlauf erreichbar bleibt.

## Fehler 2: Nachrichten, die mit "Hallo" beginnen, werden als System
