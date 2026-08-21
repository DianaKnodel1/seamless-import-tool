# Chat-Login-Status und Bewerbungs-Statistik prüfen

Zwei getrennte Themen: die Anzeige "Noch nie eingeloggt" im Chat und die Zahlen in der Bewerbungen-Leiste.

## 1. "Noch nie eingeloggt" bei allen Personen

Die Anzeige holt sich zwei Werte pro Person: den letzten Login (Datenbank-Funktion `get_last_sign_ins`) und die letzte Aktivität (`profiles.last_seen_at`). Beides läuft in einem gemeinsamen Aufruf: schlägt einer der beiden Werte fehl, wird der ganze Aufruf abgebrochen, der Fehler nur still in die Browser-Konsole geschrieben und in der Liste steht bei **jedem** "Noch nie eingeloggt" — genau das Bild aus dem Screenshot.

Warum es auf dem eigenen Server fehlschlagen kann, ist noch nicht bewiesen: die Funktion `get_last_sign_ins` stammt aus einer alten Migration, die nicht im Ordner liegt, den das Deploy-Skript auf den Server überträgt. Sie könnte dort also fehlen.

Vorgehen:
- Die beiden Abfragen entkoppeln: fällt eine aus, wird trotzdem der andere Wert angezeigt.
- Statt fälschlich "Noch nie eingeloggt" wird bei echtem Fehler "Status unbekannt" angezeigt, plus ein sichtbarer Hinweis im Chat-Kopf mit dem konkreten Fehlertext (statt nur Konsole).
- Eine idempotente Migration nachliefern, die `get_last_sign_ins`, die Spalte `profiles.last_seen_at` und die nötigen Rechte sicher anlegt — damit der Wert auf dem eigenen Server garantiert vorhanden ist.
- Nach dem Deploy prüfen wir gemeinsam: entweder erscheinen echte Zeiten, oder der Hinweis nennt die genaue Ursache.

## 2. Bewerbungs-Statistik prüfen

Die Chips zählen dieselbe Menge, die auch die Tabelle anzeigt (Mandant + Archiv-Schalter gelten für beide) — 44+15+5+31+16+18+1+21 ergibt exakt 151. Rechnerisch passt es also; das Problem liegt in der **Einordnung** der Bewerber, nicht in der Summe.

Auffällig ist eine Automatik-Regel: Wer einen Termin hatte, der mehr als 45 Minuten zurückliegt, bei dem kein Interview gestartet wurde und zu dem keine Entscheidung vorliegt, wird automatisch als "Nicht erschienen" gewertet — auch wenn er in Wahrheit abgesagt hat, der Termin verschoben wurde oder das Interview außerhalb des Portals lief. Das erklärt hohe "Nicht erschienen"-Zahlen. Dass du "die Bewerber nicht siehst", ist noch ungeklärt und wird zuerst untersucht.

Vorgehen:
- Zuerst diagnostizieren: eine kleine Admin-Ansicht (aufklappbar unter den Chips) zeigt pro Chip, wie viele Datensätze dort landen und **warum** (welche Regel gegriffen hat). Damit sehen wir sofort, ob 31 Personen wirklich No-Show sind oder nur durch die 45-Minuten-Regel dort gelandet sind.
- Parallel prüfen, ob beim Klick auf einen Chip wirklich alle passenden Zeilen erscheinen (Filter, Suche, Seitenblättern) — falls dort etwas hakt, wird es korrigiert.
- Erst nach dieser Auswertung passen wir die Einordnungsregeln an (z. B. Absagen und verschobene Termine nicht mehr als "Nicht erschienen" zählen). Die konkrete Änderung stimme ich vorher kurz mit dir ab.

## Technische Details

- `src/lib/last-sign-ins.functions.ts`: RPC und `profiles`-Abfrage getrennt behandeln, Teilerfolge liefern, Fehlertext zurückgeben.
- `src/routes/admin.chat.tsx`: Fehlerzustand vom Zustand "wirklich nie eingeloggt" unterscheiden, Hinweis anzeigen.
- Neue Datei `supabase/manual-migrations/2026090300000_last_sign_in_and_last_seen.sql`: `CREATE OR REPLACE FUNCTION public.get_last_sign_ins`, `ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen_at`, Grants.
- `src/routes/admin.bewerbungen.tsx`: `computePhase` gibt zusätzlich einen Grund zurück; Diagnose-Panel listet Anzahl je Grund; Chip→Liste-Abgleich verifizieren.
- Deploy: `bash scripts/deploy.sh` (überträgt auch die neue Migration).
