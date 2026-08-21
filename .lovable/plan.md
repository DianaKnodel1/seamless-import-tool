# Chat-Fix live bekommen: fehlende Datenbank-Änderung nachziehen

Das Frontend-Deploy ist durch, aber die Chat-Datenbankänderung wurde **nicht** mit ausgeliefert.

## Was fehlt

Die Chat-Änderung liegt in `db-migrations/20260901000000_chat_is_system_and_conversation_list.sql`.
Das Deploy überträgt und wendet aber nur Dateien aus `supabase/manual-migrations/` an (bestätigt in
`scripts/sync-to-backend.sh`, Zeile 14). Im Deploy-Log endet die Liste entsprechend bei
`20260831000000_bot_recorder_prompt.sql` — die Chat-Datei taucht nicht auf.

Solange sie fehlt:
- Spalte `is_system` existiert nicht → der Chat fällt auf das alte Raten am Nachrichtentext zurück
- Funktion `list_chat_conversations()` existiert nicht → die Admin-Gesprächsliste nutzt den
  begrenzten Fallback (nur die letzten Nachrichten)

Der Frontend-Code fängt beides ab, deshalb bricht nichts hart — aber die Fixes sind nur halb aktiv.

## Umsetzung

1. Migrationsdatei nach `supabase/manual-migrations/20260901000000_chat_is_system_and_conversation_list.sql`
   verschieben, damit sie beim Deploy automatisch mitläuft (Inhalt unverändert).
2. Auf dem Server erneut `bash scripts/deploy.sh` (oder nur `bash scripts/sync-to-backend.sh`) —
   die Datei wird angewendet und im Status-File vermerkt.
3. Danach prüfen: Spalte `is_system` vorhanden, `list_chat_conversations()` liefert Zeilen.

## Test danach

- Mitarbeiter öffnet Chat → neueste Nachrichten sichtbar, Ungelesen-Zähler geht auf 0
- Admin schreibt und leert das Feld → Tipp-Indikator beim Mitarbeiter verschwindet sofort
- Systemmeldungen grau/zentriert, echte Teamleiter-Antworten als normale Blase

Wenn nach diesem Schritt weiterhin Nachrichten fehlen, prüfen wir gezielt Marcels Gesprächsverlauf
in der Datenbank gegen die Anzeige.
