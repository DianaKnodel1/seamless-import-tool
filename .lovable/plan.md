# Fix: „Aktiv vor 8 h“ obwohl gerade geschrieben wurde

## Was ich im Code gefunden habe

1. **Die Aktivitätszeiten werden nur einmal geladen.** In `src/routes/admin.chat.tsx` wird die Liste der Gespräche beim Öffnen der Seite geladen und danach einmalig mit den Login-/Aktivitätszeiten angereichert. Es gibt keinen Intervall-Refresh. Wenn dein Admin-Tab länger offen ist, altert die Anzeige einfach vor sich hin — nach 8 Stunden offenem Tab steht dort „Aktiv vor 8 h“, auch wenn die Person gerade schreibt.
2. **Eine neue Nachricht aktualisiert die Aktivitätsanzeige nicht.** Kommt per Live-Chat eine Nachricht rein, wird die Nachricht angezeigt, aber `lastSeenAt` bleibt auf dem alten Wert.
3. **Der Herzschlag zählt nur offene Tabs.** `profiles.last_seen_at` wird alle 60 Sekunden gesetzt, solange die Person die App offen hat. Schreibt jemand vom Handy und schließt die App, kann der Wert kurz danach schon veraltet wirken.

Diese drei Punkte erklären genau das Bild im Screenshot.

## Was ich ändern werde

- **Nachricht = Aktivität:** Der Zeitpunkt der letzten Nachricht einer Person zählt künftig als Aktivität. Angezeigt wird immer der neueste der drei Werte (letzte Nachricht, Herzschlag, letzter Login). Damit steht bei einer gerade eingetroffenen Nachricht sofort „Gerade aktiv“.
- **Live-Aktualisierung:** Trifft im Chat eine neue Nachricht ein, wird die Aktivitätszeit dieser Person sofort mitgesetzt.
- **Regelmäßiger Refresh:** Die Aktivitätsdaten werden alle 60 Sekunden sowie beim Zurückkehren in den Tab neu geladen, damit kein veralteter Stand stehen bleibt.
- **Anzeige-Feinschliff:** Wer laut Presence gerade online ist, wird als „Gerade aktiv“ ausgewiesen statt mit einer Stundenangabe.

## Technische Details

- `src/routes/admin.chat.tsx`: `lastSeenAt` in `formatLastActive` durch ein Maximum aus `lastSeenAt`, `lastSignInAt` und dem Zeitstempel der letzten Nachricht der Person (`lastFromEmployeeAt` bzw. `lastAt`) ersetzen; Realtime-Handler für neue Nachrichten setzt `lastSeenAt` der betroffenen Konversation auf den Nachrichtenzeitpunkt; Intervall (60 s) + `visibilitychange`-Listener ruft die Aktivitätsabfrage erneut auf; `useOnlineUsers()` überschreibt die Ausgabe mit „Gerade aktiv“.
- Keine Datenbank-Änderung nötig, keine Änderung an `last-sign-ins.functions.ts` oder am Presence-Heartbeat.
- Danach: Portal deployen mit `bash scripts/deploy.sh`.
