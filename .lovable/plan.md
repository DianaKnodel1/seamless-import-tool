# Live-Chat ohne Neuladen stabilisieren

## Ziel
Gesendete und empfangene Nachrichten erscheinen sofort im offenen Chat. Ein manuelles Neuladen darf nicht mehr nötig sein.

## Umsetzung
1. **Echte Sofortanzeige beim Senden**
   - Die Nachricht direkt beim Klick lokal als „wird gesendet“ anzeigen, noch bevor die Datenbank antwortet.
   - Nach erfolgreichem Speichern den temporären Eintrag durch die echte Nachricht ersetzen.
   - Bei einem Fehler den Eintrag sichtbar als fehlgeschlagen behandeln und erneutes Senden ermöglichen, statt ihn still verschwinden zu lassen.

2. **Alle Chat-Oberflächen vereinheitlichen**
   - Dasselbe Verhalten im Admin-Chat, auf der Mitarbeiter-Chatseite und im schwebenden Mitarbeiter-Chat umsetzen.
   - Doppelte Nachrichten verhindern, wenn Sofortanzeige und Realtime-Ereignis dieselbe Nachricht liefern.

3. **Empfang in Echtzeit absichern**
   - Die vorhandenen stabilen Realtime-Kanäle beibehalten und ihren Status sichtbar protokollieren.
   - Nach Verbindungsaufbau, Wiederverbindung, Tab-Fokus und Rückkehr ins Netz fehlende Nachrichten automatisch nachladen.
   - Prüfen, dass die vorhandene Realtime-Datenbankmigration beim Deploy tatsächlich ausgeführt wird.

4. **End-to-End prüfen**
   - Senden im Admin-Chat und Mitarbeiter-Chat testen: eigene Nachricht muss unmittelbar erscheinen.
   - Mit zwei gleichzeitig geöffneten Sitzungen testen: Nachricht muss ohne Reload auf der Gegenseite eintreffen.
   - Reconnect und kurzfristigen Offline-Zustand testen, damit verpasste Nachrichten automatisch ergänzt werden.

## Technische Details
- Temporäre Client-ID und Sendestatus für lokale Nachrichten verwenden.
- Beim Datenbankergebnis atomar auf die echte ID wechseln; Realtime-Daten anhand der echten ID zusammenführen.
- Keine Änderung an Chat-Inhalten, Rollen oder Berechtigungslogik; ausschließlich Anzeige, Synchronisation und Fehlerbehandlung.
