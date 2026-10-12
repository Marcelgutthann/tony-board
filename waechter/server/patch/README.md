# Empfangs-, Warte- und Startrückmeldung — Patch zur Prüfung

**Revision 3** (nach Tonys zweitem Review; Revision 1 in `5de9265`, Revision 2 in `937600e`).
**Stand: vorgeschlagen, nicht installiert.** Der produktive Runner unter `/opt/tony/waechter/`
ist unverändert (Prüfsummen `c85ef04ac5089b9b` / `9586dbea201205f1`, Dienst ohne Neustart).
Hier liegen nur Entwürfe, ein Diff, ein Prüfstand und der Plan zum Scharfschalten.

| Datei | Zweck |
|---|---|
| `waechter.sh`, `bearbeite.sh` | die vorgeschlagenen neuen Fassungen |
| `aktivierungsmeldung.diff` | Diff gegen den laufenden Stand (`../waechter.sh`, `../bearbeite.sh`) |
| `test-aktivierung.sh` | Prüfstand mit nachgebildeter Board-API und nachgebildetem `claude` |
| `fake-board.py` | die Nachbildung der Board-API für den Prüfstand |

## Was der Patch ändert

1. **Empfang sofort melden.** `waechter.sh` bestätigt Tony die Übernahme in dem Moment, in dem
   die Post abgeholt ist — und sagt dazu, ob gleich gearbeitet wird oder noch ein Arbeiter läuft.
   Die Fenstersperre wird dafür nur kurz probiert und sofort wieder losgelassen.
2. **Warten sichtbar mit Grund.** `bearbeite.sh` versucht die Sperre erst ohne Blockieren. Klappt
   das nicht, meldet es „Wartet: … läuft bereits ein Arbeiter (Prozess N)" und blockiert erst
   danach. Auch ein belegter Arbeitsplatz wird einmalig gemeldet.
3. **Arbeitsstart erst nach belegtem Prozessstart — und während der Prozess noch läuft.** Starten
   und Abwarten sind getrennt (`lauf_starten` / `lauf_abwarten`). Gemeldet wird, sobald die PID
   nachweislich lebt; erst danach wartet der Arbeiter auf das Ende. Die Meldung nennt PID und
   Lauf-ID. Gleichzeitig bekommt die Karte `taetigkeit` und `zustaendig`.
4. **Statusfragen stapeln sich nicht mehr.** Unter der Fenstersperre wird **alles** Offene zu
   diesem Fenster zu *einem* Lauf zusammengefasst. Weitere Arbeiter finden nichts mehr vor und
   beenden sich ohne `claude`-Aufruf. Der Auftragstext weist Claude an, reine Statusnachfragen
   kurz zu beantworten und dafür keine neue Umsetzung zu beginnen.
5. **Abschluss und Fehler sauber.** Nach einem Lauf mit belegtem, diesem Lauf zugeordnetem
   Ergebnis wird die übernommene Post entfernt.
   Bei Abbruch wandert der Text nach `fehlgeschlagen/`, Tony bekommt eine Fehlermeldung, die Karte
   bekommt den Fehlertext — **kein** automatischer Neuversuch.
6. **Nebenbefund, trennbar:** Die Post wird nicht mehr vor dem Start gelöscht, sondern nach
   `laufend/<fenster>.txt` übernommen und erst nach Erfolg entfernt. Stirbt der Prozess dazwischen,
   holt der nächste Arbeiter die Nachricht nach, statt sie zu verlieren. Wer das nicht will,
   streicht Punkt 6 — die Punkte 1 bis 5 funktionieren auch ohne.

Zusätzlich sind Pfade, Zeitgrenze und das `claude`-Binary über Umgebungsvariablen überschreibbar
(Vorgabe = bisheriges Verhalten). Nur dadurch ist der Prüfstand ohne echten Runner möglich.

## Was Revision 3 gegenüber Revision 2 korrigiert

Tonys zweiter Review fand drei weitere Blocker — alle berechtigt, alle behoben.

**A) Die Ergebnisprüfung akzeptierte ihre eigene Startmeldung.** `an-tony` speichert *jede*
Meldung als `von = claude`, auch die des Runners. Revision 2 prüfte nur Absender, Fenster und
Zeit — und bestätigte sich damit selbst. Dass der Prüfstand das nicht fand, war der zweite Teil
des Fehlers: die nachgebildete API legte `an-tony`-Meldungen gar nicht in `absprache` ab und
bildete die echte Semantik damit falsch nach. Jetzt gilt: jede Runner-Meldung trägt das
Kennzeichen `[Runner]` und ist von der Ergebnisprüfung ausdrücklich ausgeschlossen; der Lauf
erzeugt eine **eindeutige Lauf-ID**, und als Ergebnis zählt nur eine Antwortdatei, die **genau
diese Lauf-ID** und den **Ergebnistyp** `art: "ergebnis"` trägt — zusätzlich zu einer im Board
angekommenen Antwort ohne `[Runner]`. Die Fake-API persistiert `an-tony` jetzt exakt wie das
Original.

**B) Die Startmeldung kam erst nach dem Prozessende.** `starte_lauf` wartete intern auf das Ende,
die Meldung ging also bei einem 35-Minuten-Lauf 35 Minuten zu spät raus — womit der ganze Zweck
verfehlt war. Starten und Abwarten sind jetzt zwei Funktionen; die Meldung liegt dazwischen.
Belegt durch einen blockierenden Fakeprozess, dessen Boardzustand **vor** dem Ende ausgelesen wird.

**C) Die Resume-Heuristik ist kein Beweis für fehlende Teilwirkung.** Richtig. Der automatische
zweite fachliche Aufruf entfällt für diesen minimalen Patch **vollständig**. Jeder Fehlschlag
führt zu einer Meldung mit ausdrücklich unklarer Wirkung, gesichertem Text und keinem
Neuversuch; war eine Sitzung im Spiel, nennt die Meldung den manuellen Ausweg.

## Was Revision 2 gegenüber Revision 1 korrigiert

Tonys Review fand drei Installationsblocker. Alle drei waren dieselbe Sünde: Erfolg behaupten ohne
Beleg. Alle drei sind behoben.

**1) Der Arbeitsstart wurde vor dem `claude`-Aufruf gemeldet.** Jetzt wird der Prozess im
Hintergrund gestartet, seine PID festgehalten und erst nach einem überprüfbaren Ereignis gemeldet:
Die PID lebt noch, oder der Prozess ist bereits beendet mit einem Code, der kein Spawn-Fehler ist.
Ein fehlendes oder nicht ausführbares Binary wird zusätzlich vorab geprüft und ergibt eine
ausdrückliche *Nicht-gestartet*-Meldung samt Fehlereintrag auf der Karte — niemals „arbeitet".

**2) Der pauschale zweite Versuch ist entfernt.** Vorher wurde nach *jedem* nicht erfolgreichen
`--resume` der komplette Auftrag ohne Resume wiederholt — auch nach einem Timeout, bei dem Claude
schon gewirkt haben kann. (Revision 2 ließ dafür noch einen eng umgrenzten Sonderfall zu;
Revision 3 streicht auch den — siehe C.)

**3) Exit 0 gilt nicht mehr als Beleg für ein Ergebnis.** Vor dem Lauf wird ein Zeitstempel
genommen; danach wird im Board geprüft, ob seitdem eine Antwort von Claude **zu diesem Fenster**
eingetroffen ist. Nur dann wird die übernommene Post entfernt. Endet der Lauf mit 0, ohne dass eine
Antwort ankam, wandert der Text nach `ohne-ergebnis/`, Tony bekommt eine ausdrückliche
*Unklar*-Meldung, und nichts wird für fertig erklärt. Zusätzlich verschlucken `an_tony` und
`karte_melden` keine Fehler mehr: Sie prüfen den HTTP-Code, protokollieren jeden Fehlschlag und
schreiben ihn nach `meldefehler.log`.

## Prüfergebnis

```
bash waechter/server/patch/test-aktivierung.sh     →  65/65 Prüfungen bestanden
```

Jeder Fall zählt **Aufrufzahl und Außenwirkung** getrennt, damit ein stiller zweiter Versuch
auffliegt. Die wichtigsten Zusicherungen im Wortlaut:

| Fall | Zusicherung |
|---|---|
| 1 | Start erst nach Beleg; 1 Aufruf, 1 Außenwirkung; Post erst nach belegtem Ergebnis entfernt |
| 2 | vier Nachrichten → **1** Aufruf und **1** Außenwirkung |
| 3 | Warten mit Grund, und zwar nachweislich **vor** der Startmeldung |
| 4 | zweiter Arbeiter ohne Post: 0 Aufrufe, 0 Außenwirkungen, 0 Meldungen |
| 5 | Fehlerlauf: gemeldet, gesichert, **1** Aufruf (kein stiller zweiter) |
| 6 | Absturz nach Übernahme: Nachricht wird nachgeholt, Inhalt vollständig |
| 7/8 | Verteiler meldet Empfang sofort, mit Grund wenn besetzt |
| 9 | fehlendes Binary: **0** Startmeldungen, ausdrückliche Nicht-gestartet-Meldung, Fehler auf der Karte |
| 10 | Timeout (124) mit Teilwirkung: **1** Aufruf, **1** Außenwirkung — keine Verdopplung |
| 11 | gescheiterter Resume: **1** Aufruf, **0** Außenwirkungen, unklare Wirkung gemeldet, manueller Ausweg benannt |
| 12 | Exit 0 ohne Zustellung: nicht fertig, Inhalt in `ohne-ergebnis/`, **1** Aufruf |
| 13 | HTTP 500/503 auf Melde- und Kartenweg: protokolliert und in `meldefehler.log` |
| 14 | hängender Meldeweg: Arbeiter endet sauber, Lauf fand statt, Hänger vermerkt |
| 15 | Ende zu Ende: Empfang vor belegtem Start, Ergebnis genau einmal, Sitzung gemerkt |
| 16 | **blockierender Prozess:** Startmeldung ist da, **während** der Lauf noch läuft und bevor Claude irgendetwas geliefert hat |
| 17 | **die eigene Startmeldung zählt nicht:** sie steht als `von=claude` im Board, trotzdem gilt der Lauf als ohne Ergebnis |
| 18 | Antwortdatei mit fremder Lauf-ID zählt nicht als eigenes Ergebnis |
| 19 | vollständig belegtes Ergebnis (Lauf-ID + Typ + Zustellung) wird als fertig gewertet |

Die nachgebildete API kann dafür HTTP-Fehler erzwingen und Antworten hängen lassen. Der Prüfstand
läuft vollständig in einem Wegwerf-Ordner; es wird kein Dienst angelegt und nichts Produktives
angefasst.

## Verbleibende Risiken

- **„Prozess lief" ist nicht „Arbeit war sinnvoll".** Der Beleg zeigt, dass ein Prozess existierte,
  nicht dass er fachlich etwas erreicht hat. Dafür ist die Zustellprüfung in Punkt 3 zuständig.
- **Die Zustellprüfung hängt am Board.** Ist das Board im Moment der Prüfung nicht erreichbar, gilt
  das Ergebnis als nicht belegt und der Text landet in `ohne-ergebnis/` — konservativ, aber ein
  Fehlalarm ist möglich. Nichts geht dabei verloren.
- **Fenster `ohne-fenster`.** Für Nachrichten ohne Fensterbezug kann die Zustellprüfung nicht auf
  die Fenster-Kennung filtern; dort genügt irgendeine Claude-Antwort seit Laufbeginn.
- **Eine unbrauchbare gespeicherte Sitzung blockiert das Fenster dauerhaft.** Da es keinen
  automatischen zweiten Aufruf mehr gibt, scheitert dann jeder Lauf. Die Meldung sagt das und
  nennt den Handgriff (`sitzungen/<fenster>` entfernen); automatisch passiert bewusst nichts.
- **Das Ergebnis hängt daran, dass Claude die Lauf-ID zurückschreibt.** Tut er das nicht, gilt der
  Lauf als ohne Ergebnis — konservativ, der Text bleibt erhalten, aber ein Fehlalarm ist möglich.
- **`fuser` ist optional.** Fehlt es, steht in der Wartemeldung keine Prozessnummer, sonst ändert
  sich nichts.
- **0,4 s Startprobe.** Ein Lauf, der schneller als das fertig wird, wird am Exitcode erkannt und
  korrekt als gestartet gewertet; nur 126/127 gelten als Spawn-Fehler.
- **`laufend/` kennt die alte Fassung nicht.** Vor einem Rollback ist der dokumentierte Umzug
  nötig, sonst bleiben übernommene Nachrichten liegen.

## Aktivierungsplan (erst nach Freigabe)

Voraussetzung: Es läuft gerade kein Arbeiter (`systemctl list-units 'tony-*' --no-legend` ist leer)
und `post/` ist leer. Bestehende Queueinhalte werden **nicht** gelöscht und **nicht** neu ausgeführt.

1. Sicherung anlegen:
   `cp -a /opt/tony/waechter/{waechter.sh,bearbeite.sh} /opt/tony/waechter/sicherung-$(date +%F-%H%M)/`
2. Prüfsummen notieren (Soll vorher: `c85ef04ac5089b9b`, `9586dbea201205f1`).
3. Neue Fassungen **atomar** einsetzen, damit ein gerade laufender Arbeiter seine alte Fassung
   behält: in eine Datei daneben schreiben, dann `mv` darüber. Niemals in die laufende Datei
   hineinschreiben.
4. Kein Dienst-Neustart nötig: `waechter.sh` wird von der Dauerschleife bei jedem Durchlauf neu
   gelesen, `bearbeite.sh` bei jedem Aufruf. Die Änderung greift binnen fünf Sekunden.
5. Abnahme: eine Testnachricht über `an_claude` schicken und prüfen, dass genau drei Meldungen
   kommen — Empfang, Arbeitsstart, Ergebnis — und im Log genau ein Lauf steht.

## Rollback

Jederzeit und ohne Datenverlust, weil der Patch nur Meldungen hinzufügt und die Post anders
verwaltet:

1. `cp -a /opt/tony/waechter/sicherung-<stand>/{waechter.sh,bearbeite.sh} /opt/tony/waechter/`
   (wieder per `mv` atomar), Prüfsummen gegen die Sollwerte oben vergleichen.
2. Greift ebenfalls binnen fünf Sekunden, kein Neustart.
3. **Wichtig:** Liegt zu diesem Zeitpunkt etwas in `laufend/`, kennt die alte Fassung dieses
   Verzeichnis nicht. Vor dem Rollback einmal
   `for f in /opt/tony/waechter/laufend/*.txt; do mv "$f" "/opt/tony/waechter/post/$(basename "$f" .txt).$(date +%s%N).txt"; done`
   ausführen — damit wandern übernommene Nachrichten zurück ins Postfach und gehen nicht verloren.
4. `fehlgeschlagen/` kann stehen bleiben; es wird von keiner Fassung gelesen.

## Was der Patch ausdrücklich nicht tut

Keine neuen Zugangsdaten, keine erweiterten Rechte, keine neuen Zeitpläne, keine CI-Läufe, keine
Datenbankänderung, keine Umgehung einer Freigabe. Er nutzt ausschließlich die schon vorhandenen
Endpunkte `an-tony`, `state` und `mcp` mit dem bereits vorhandenen Schlüssel.
