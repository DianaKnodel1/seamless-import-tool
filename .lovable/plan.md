Chat-Status nach Screenshot: Zuerst deployen, dann prüfen

1. Auf dem Portal-Server deployen: `cd /opt/apps/portal && bash scripts/deploy.sh`.
2. Datenbank-Migration prüfen/ausführen: `db-migrations/20260901000000_chat_is_system_and_conversation_list.sql` (falls noch nicht angewendet).
3. Chat-Verhalten testen: Mitarbeiter öffnet Chat, Admin schreibt Nachricht → Mitarbeiter sieht sie sofort, Ungelesen-Zähler bleibt nicht hängen, Tipp-Indikator verschwindet nach Senden.
4. Falls der Fehler nach dem Deploy weiterhin auftritt, gemeinsam mit konkreten Schritten und Screenshot erneut analysieren.
