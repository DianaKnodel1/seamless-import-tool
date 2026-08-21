# Chat als echten Live-Chat stabilisieren

## Ziel
Gesendete und empfangene Nachrichten erscheinen in Admin-Chat, Mitarbeiter-Chat und schwebendem Chat sofort – ohne manuelles Neuladen. Kurze Verbindungsunterbrechungen dürfen keine sichtbaren Nachrichtenlücken erzeugen.

## Umsetzung

1. **Eigene Nachrichten sofort anzeigen**
   - Beim Senden den gespeicherten Datensatz direkt von der Datenbank zurückgeben lassen und unmittelbar in den lokalen Verlauf einfügen.
   - Das spätere Realtime-Ereignis über die Nachrichten-ID deduplizieren.
   - Eingabe bei einem Speicherfehler wiederherstellen und einen klaren Fehler anzeigen, statt die Nachricht scheinbar zu verlieren.

2. **Realtime-Abonnements stabil machen**
   - Admin-, Mitarbeiter- und Floating-Chat auf dauerhaft stabile Channels umstellen.
   - Aktuelle Gesprächs- und Öffnungszustände über Refs lesen, damit Zustandsänderungen nicht laufend Channels abbauen und neu verbinden; dadurch entstehen aktuell mögliche Empfangslücken.
   - Subscription-Status auswerten und Verbindungsfehler sichtbar protokollieren.

3. **Verpasste Nachrichten automatisch nachholen**
   - Nach erfolgreicher Verbindung bzw. Wiederverbindung die neuesten Nachrichten des aktiven Gesprächs erneut abgleichen.
   - Zusammenführen immer anhand der Nachrichten-ID, chronologisch sortiert und ohne Duplikate.
   - Beim Zurückkehren in den Browser-Tab ebenfalls kurz synchronisieren, damit Schlafmodus oder Netzwechsel keinen Reload erfordern.

4. **Datenbank-Realtime absichern**
   - Eine idempotente manuelle Migration ergänzen, die `public.chat_messages` in die Realtime-Publication aufnimmt, falls die Tabelle dort noch nicht registriert ist.
   - Die Migration läuft über den bestehenden Deploy-/Migrationsablauf.

## Betroffene Bereiche
- `src/routes/admin.chat.tsx`
- `src/routes/_employee/chat.tsx`
- `src/components/FloatingChat.tsx`
- neue Migration unter `supabase/manual-migrations/`

## Prüfung
- Admin sendet an Mitarbeiter: Nachricht erscheint sofort auf beiden Seiten.
- Mitarbeiter sendet an Admin: Nachricht erscheint sofort in Chatbox und Seitenleiste.
- Test in zwei getrennten Browser-Sitzungen ohne Reload.
- Reconnect-Test: Netzwerk kurz unterbrechen, währenddessen senden, danach automatischer Abgleich ohne Duplikate.
- Anhänge und Ungelesen-Markierung im gleichen Ablauf mitprüfen.
