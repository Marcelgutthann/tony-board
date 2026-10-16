---
description: Diese Sitzung an den Server-Claude uebergeben — Uebergabenotiz schreiben, Arbeit committen, Branch pushen
---

# Uebergabe an den Server

**Kennung:** $ARGUMENTS

Marcel will diese Sitzung spaeter mit "uebernimm und mach fertig" vom Server-Claude
weiterfuehren lassen. Der Server kann diese Sitzung **nicht** lesen: Transkripte sind an
die Maschine gebunden, Cloud-Sitzungen lassen sich von aussen nicht abrufen. Alles, was
der Server weiss, steht im Branch. Darum gilt: was hier nicht committet und gepusht ist,
existiert fuer ihn nicht.

## Ablauf

1. **Kennung bestimmen.** Oben angegeben, sonst aus dem Branchnamen ableiten
   (Ticketnummer bevorzugt, wenn es eine gibt). Nur `[a-z0-9-]` und Grossbuchstaben in
   Ticketnummern — die Kennung wird Dateiname und Fenstername im Board.

2. **Lage pruefen** mit `git branch --show-current`, `git status --short`, `git log --oneline -3`.
   Abbrechen und Marcel fragen, wenn:
   - kein Branch (detached HEAD),
   - der Branch `main` oder `staging` ist — dafuer erst einen eigenen Branch abzweigen,
   - der Arbeitsbaum Dateien enthaelt, die hier nicht hingehoeren (Secrets, `.env`, grosse Artefakte).

3. **Notiz schreiben** nach `uebergabe/<kennung>.md` im Repo-Wurzelverzeichnis, genau mit
   den Abschnitten aus der Vorlage unten. Keinen Abschnitt weglassen, keinen hinzufuegen.
   Die Notiz ist der ganze Auftrag des Servers — sie muss ohne diese Sitzung verstaendlich sein.

4. **Alles committen und pushen:**
   ```bash
   git add -A
   git commit -m "Uebergabe <kennung>: Stand fuer Server-Uebernahme"
   git push -u origin HEAD
   ```
   `git add -A` nimmt den **gesamten** Arbeitsbaum mit, auch halbfertigen Stand — das ist
   gewollt, sonst kann der Server nicht weiterarbeiten. Sag Marcel ausdruecklich, was
   mitgegangen ist.

5. **Marcel den Satz geben,** den er Tony sagt — wortwoertlich und nichts weiter:

   > Uebernimm `<kennung>`: Repo `<repo>`, Branch `<branch>`, Notiz `uebergabe/<kennung>.md`.

## Vorlage der Notiz

```markdown
# Uebergabe <kennung>

| | |
|---|---|
| Repo | <repo-name> |
| Branch | <branch> |
| Commit | <sha der notiz, nach dem commit nachtragen oder "HEAD des Branches"> |
| Herkunft | lokale Sitzung / Cloud-Sitzung (claude.ai/code) |
| Datum | <YYYY-MM-DD HH:MM> |
| Ticket | Ticketnummer oder "keins" |

## Auftrag
Ein Satz: was gebaut werden soll, so wie Marcel es beauftragt hat.

## Stand
Was jetzt existiert. Trennt hoerbar zwischen **geschrieben** und **tatsaechlich
ausgefuehrt oder getestet**. Nicht Getestetes nie als fertig darstellen.

## Geaendert
Datei -> was daran geaendert wurde, eine Zeile je Datei. Nur das Wesentliche.

## Offen
Nummerierte naechste Schritte. Je Schritt ein pruefbares Ziel und der Befehl oder
Handgriff, mit dem man sieht, dass er sitzt.

## Annahmen und Entscheidungen
Was in dieser Sitzung entschieden wurde und nicht im Code steht. Jede Annahme, auf der
die offenen Schritte aufbauen.

## Nicht anfassen
Dateien, Branches, Daten, Umgebungen, die der Server nicht beruehren darf, und warum.
Mindestens: keine Prod-Umgebung, kein Merge nach `main`.

## Fertig-Kriterium
Woran der Server erkennt, dass er fertig ist — als Liste pruefbarer Punkte mit Befehl
(Typecheck, Test, Prueffenster, Screenshot der echten App).

## Rueckgabe
Wohin das Ergebnis geht: Push auf denselben Branch, Fortschritt als Abschnitt
"## Uebernahme Server <datum>" unten in dieser Notiz. Merge entscheidet Marcel.
```

## Grenzen, die du Marcel nennst, wenn er mehr erwartet

- Der Server uebernimmt **keine Sitzung**, er liest einen Branch. Gespraechsverlauf,
  Begruendungen und Zwischenueberlegungen aus dieser Sitzung sind weg, wenn sie nicht in
  der Notiz stehen.
- Nach der Uebergabe arbeiten zwei Sitzungen am selben Branch, wenn Marcel hier
  weitermacht. Dann gilt: entweder er oder der Server, nicht beide.
