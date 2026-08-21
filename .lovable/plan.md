# Chat-Prüfung: was noch offen ist

Die drei zuletzt gemeldeten Fehler (fehlende neue Nachrichten, globaler Tipp-Indikator, „Hallo"/„Willkommen" als Systemmeldung) sind im Code behoben. Bei der erneuten Durchsicht sind aber noch vier echte Schwachstellen aufgefallen.

## 1. Gelesen-Status wird im Mitarbeiter-Chat nicht aktualisiert (wichtig)

Auf der Mitarbeiter-Chatseite werden Nachrichten nur beim **Laden** der Seite auf „gelesen" gesetzt. Kommt eine Nachricht herein, während der Chat offen ist, bleibt sie dauerhaft „ungelesen".

Folge: In der Admin-Übersicht bleibt der rote Ungelesen-Zähler stehen und wächst, obwohl der Mitarbeiter mitliest — es wirkt, als „hänge" der Chat.

Fix: im Realtime-Handler eingehende Nachrichten sofort als gelesen markieren (so wie es das schwebende Chat-Fenster bereits macht).

## 2. Admin-Übersicht kappt bei 5.000 Nachrichten

Die Gesprächsliste wird aus den letzten 5.000 Nachrichten aller Nutzer berechnet. Sobald diese Grenze überschritten ist, verschwinden ruhigere Gespräche komplett aus der Seitenleiste bzw. zeigen eine veraltete letzte Nachricht.

Fix: letzte Nachricht + Ungelesen-Zähler pro Gespräch serverseitig aggregieren (eine Server-Function mit einer Gruppierungs-Abfrage) statt clientseitig aus einem gekappten Fenster.

## 3. Tipp-Indikator flackert / bleibt stehen

Es wird nur „tippt" gesendet, nie „tippt nicht mehr". Der Indikator verschwindet erst nach 3 Sekunden Timeout und taucht wieder auf, sobald irgendeine Taste (auch Pfeiltasten) gedrückt wird.

Fix: nur senden, wenn das Eingabefeld tatsächlich Text enthält und sich der Text verändert hat, und beim Absenden/Leeren des Feldes ein „stop"-Ereignis senden.

## 4. Systemmeldungen werden weiter geraten

Die Erkennung läuft noch über Emoji-Präfixe im Text. Jede echte Nachricht, die z. B. mit „📅" beginnt, wird als Systemtext dargestellt.

Fix: Spalte `is_system` (boolean, Standard false) an `chat_messages`, von allen systemgenerierten Inserts gesetzt; Anzeige nutzt das Feld, die Präfix-Heuristik greift nur noch als Rückfall für Altdaten.

## Ebenfalls geprüft, kein Handlungsbedarf jetzt

- Nachrichtenverlauf lädt korrekt die neuesten 200 + „Ältere laden" (Mitarbeiter-Seite, Chat-Fenster, Admin).
- Tipp-Kanäle sind auf das Gesprächspaar begrenzt, kein Crosstalk mehr.
- Anhänge (Upload, Anzeige) sind auf beiden Seiten konsistent verdrahtet.

## Technische Umsetzung

- `src/routes/_employee/chat.tsx`: Read-Update im Realtime-Handler; Typing-Broadcast nur bei Textänderung + Stop-Event.
- `src/components/FloatingChat.tsx`: gleiche Typing-Anpassung.
- `src/routes/admin.chat.tsx`: Gesprächsliste über neue Server-Function laden; `is_system` statt Präfix-Heuristik.
- Neue Server-Function `listChatConversations` in `src/lib/chat.functions.ts` (Aggregation pro Partner).
- Migration: `alter table public.chat_messages add column is_system boolean not null default false;` inkl. Backfill für bekannte Präfixe.

## Reihenfolge

1. Punkt 1 (Gelesen-Status) — kleinster Eingriff, größte Wirkung.
2. Punkt 3 (Tipp-Indikator).
3. Punkt 4 (`is_system` + Migration).
4. Punkt 2 (serverseitige Aggregation).
