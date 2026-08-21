# Chat: verbleibende Fehler beheben

Die zuletzt gemeldeten Hauptprobleme sind bereits behoben (neueste Nachrichten werden geladen statt der ältesten, Tipp-Indikator läuft pro Gespräch statt global, "Hallo"/"Willkommen" gelten nicht mehr als Systemtext). Bei der erneuten Prüfung sind noch vier Punkte offen.

## 1. Ungelesen-Zähler bleibt stehen
Der Mitarbeiter-Chat markiert Nachrichten nur beim Öffnen als gelesen. Kommt eine Nachricht rein, während der Chat offen ist, bleibt sie in der Admin-Ansicht "ungelesen".

Fix: eingehende Nachrichten im Realtime-Handler sofort auf gelesen setzen (`src/routes/_employee/chat.tsx`, `src/components/FloatingChat.tsx`).

## 2. Tipp-Indikator flackert / bleibt hängen
Es wird nur "tippt" gesendet, nie "tippt nicht mehr" – der Indikator verschwindet erst nach Timeout und kann nach dem Absenden noch stehenbleiben.

Fix: beim Leeren des Feldes und beim Absenden ein explizites Stop-Signal senden (alle drei Chat-Oberflächen).

## 3. Systemmeldungen werden geraten
Erkennung läuft weiterhin über Emoji-Präfixe. Eine normale Nachricht, die mit 📅 oder ✅ beginnt, wird fälschlich als Systemtext dargestellt.

Fix: Spalte `is_system` an `chat_messages` ergänzen, beim Erzeugen von Systemmeldungen setzen und im UI vorrangig auswerten (Präfix-Erkennung nur noch als Rückfall für Altdaten).

## 4. Gespräche verschwinden aus der Admin-Seitenleiste
Die Gesprächsliste wird aus den letzten 5.000 Nachrichten insgesamt gebaut. Sobald dieses Fenster überschritten ist, fallen ruhige Gespräche aus der Liste.

Fix: serverseitige Aggregation (`list_chat_conversations`) über alle Nachrichten, mit der bisherigen Logik als Rückfall.

## Technische Details
- Migration (manuell in `db-migrations/`, wie im Projekt üblich): `ALTER TABLE chat_messages ADD COLUMN is_system boolean NOT NULL DEFAULT false` plus SQL-Funktion `list_chat_conversations()` (letzte Nachricht, Zeitpunkt, Ungelesen-Anzahl, letzte Mitarbeiter-Nachricht je Partner), `SECURITY DEFINER`, `GRANT EXECUTE ... TO authenticated`.
- Betroffene Dateien: `src/routes/_employee/chat.tsx`, `src/components/FloatingChat.tsx`, `src/routes/admin.chat.tsx`, neue Migrationsdatei.
- Nach dem Umsetzen: Migration auf der Datenbank ausführen, dann Portal deployen (`bash scripts/deploy.sh`).
