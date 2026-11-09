# Plattform: Mitarbeiter steuern die Sitzungen

Stand 09.11.2026, beschlossen mit Marcel: Die Plattform waechst aus dem Tony Board, nicht als neues System.

## Ziel

Marcel arbeitet von einer Oberflaeche aus. Seine Claude-Sitzungen laufen weiter auf seinem PC, aber er sieht und steuert sie hier:

- **Workspaces:** NoraNotes, KIOS, Marketplace. Sie werden aus dem Ordner der Sitzung abgeleitet.
- **Mitarbeiter:** Je Workspace gibt es feste Bereiche, bei NoraNotes zum Beispiel Prompt und KI, UI und UX, Ablaeufe und Stabilitaet, Daten und Importe, Marketing und Social, Betrieb und Agenten. Jede Sitzung gehoert zu genau einem Mitarbeiter.
- **Einstieg vor jeder Frage:** Braucht ein Mitarbeiter etwas, zeigt er zuerst Thema, Ablauf, Zahlen, den Stand von Code, staging und prod und seine Empfehlung mit Risiko. Erst dann kommt die Frage. Der Entwurf wurde am 09.11. abgenommen.
- **Chat in die Sitzung:** Was Marcel an einer Sitzungskarte schreibt, landet in genau dieser laufenden Sitzung auf dem PC, und die Antwort kommt zurueck.
- **Ziel fertig:** Jeder Mitarbeiter treibt seine Themen bis zum Abschluss. Aehnliche Sitzungen schlaegt er zum Zusammenlegen vor.

## Bausteine, die es schon gibt

| Baustein | Rolle |
|---|---|
| Tony Board (`docs/index.html`, Edge Function `supabase/tony-board`) | Oberflaeche, Karten, Eingabe je Karte, Wiedervorlage |
| Hook `~/.claude/hooks/tony-melden.mjs` | meldet jede lokale Sitzung als Karte `cc-<8 Zeichen>` |
| Mod `team` (`~/.claude/mods/team`) | steckt in jeder Sitzung; erzeugt Funde und Einstieg; kann in die Sitzung schreiben (`$.prompt.submit`) |
| Sitzungs-Graph (KIOS Unternehmen) | Vorbild fuer die Graph-Ansicht und das Oeffnen per `claude://claude.ai/epitaxy/<id>` |

## Stufen

Jede Stufe ist fuer sich nutzbar und wird geprueft, bevor die naechste beginnt.

1. **Einstieg auf die Karten.**
   - `tony_board_fenster` bekommt die Spalten `workspace`, `mitarbeiter`, `einstieg` (jsonb) und `desktop_id`.
   - `fenster_zeigen` nimmt diese Felder an.
   - Der Hook setzt `workspace` aus dem Ordner. Der Mod `team` schickt nach jeder Antwort mit offener Frage `mitarbeiter` und `einstieg` an die Karte `cc-…`.
   - Das Board zeichnet den Einstieg im Detail der Karte.
   - Fertig, wenn eine echte Sitzungskarte in der Datenbank einen Einstieg hat und das Board ihn zeigt (Bildschirmfoto).
2. **Karte mit Hauptmanager (Hybrid, Marcels Wunsch vom 09.11.).**
   - Die Startansicht ist eine Karte wie der Sitzungs-Graph. In der Mitte steht der Hauptmanager, darum die Workspaces, darum die Mitarbeiter und an jedem Mitarbeiter seine Aufgaben als Punkte.
   - Ein Klick auf eine Aufgabe oeffnet sie im bekannten Kartenstil, mit Einstieg, Stand und Chat.
   - Der Hauptmanager ist Tony. Er fasst zusammen, was ansteht, ordnet nach Dringlichkeit und leitet Marcels Eingaben an den richtigen Mitarbeiter weiter.
   - Oben ein Umschalter fuer die Workspaces. Die alten Bereiche technik, vertrieb und organisation bleiben fuer Tonys eigene Karten.
3. **Chat in die laufende Sitzung.**
   - Eine Eingabe an einer `cc-`-Karte wird zum Auftrag fuer genau diese Sitzung.
   - Der Mod `team` holt ihn ab und schickt ihn mit `$.prompt.submit` in die Sitzung, die Antwort meldet der Hook zurueck.
   - Laeuft die Sitzung nicht, oeffnet ein Knopf sie per `claude://`.
4. **Fertig machen und zusammenlegen.**
   - Jeder Mitarbeiter fuehrt eine Fortschrittsangabe bis zum Abschluss.
   - Aehnliche Sitzungen (gleicher Mitarbeiter, gleiche Kennung oder aehnlicher Auftrag) erscheinen als Vorschlag zum Zusammenlegen.
