# Empfangs-, Warte- und Startrückmeldung — Patch zur Prüfung

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
3. **Arbeitsstart erst nach Erwerb und Prozessstart.** Die Startmeldung steht hinter Sperre,
   Platz und Übernahme der Post, unmittelbar vor dem `claude`-Aufruf — sie sagt ausdrücklich
   „Vorher war nur der Empfang bestätigt, jetzt läuft der Prozess". Gleichzeitig bekommt die Karte
   `taetigkeit` und `zustaendig`, damit die Statusleiste ein echtes bestätigtes Signal zeigt.
4. **Statusfragen stapeln sich nicht mehr.** Unter der Fenstersperre wird **alles** Offene zu
   diesem Fenster zu *einem* Lauf zusammengefasst. Weitere Arbeiter finden nichts mehr vor und
   beenden sich ohne `claude`-Aufruf. Der Auftragstext weist Claude an, reine Statusnachfragen
   kurz zu beantworten und dafür keine neue Umsetzung zu beginnen.
5. **Abschluss und Fehler sauber.** Nach einem sauberen Lauf wird die übernommene Post entfernt.
   Bei Abbruch wandert der Text nach `fehlgeschlagen/`, Tony bekommt eine Fehlermeldung, die Karte
   bekommt den Fehlertext — **kein** automatischer Neuversuch.
6. **Nebenbefund, trennbar:** Die Post wird nicht mehr vor dem Start gelöscht, sondern nach
   `laufend/<fenster>.txt` übernommen und erst nach Erfolg entfernt. Stirbt der Prozess dazwischen,
   holt der nächste Arbeiter die Nachricht nach, statt sie zu verlieren. Wer das nicht will,
   streicht Punkt 6 — die Punkte 1 bis 5 funktionieren auch ohne.

Zusätzlich sind Pfade, Zeitgrenze und das `claude`-Binary über Umgebungsvariablen überschreibbar
(Vorgabe = bisheriges Verhalten). Nur dadurch ist der Prüfstand ohne echten Runner möglich.

## Prüfergebnis

```
bash waechter/server/patch/test-aktivierung.sh     →  29/29 Prüfungen bestanden
```

Abgedeckt: freie Bahn (Empfang → Start → Abschluss), vier Nachrichten werden ein Lauf statt vier,
Warten mit Grund und in der richtigen Reihenfolge vor dem Start, zweiter Arbeiter ohne offene Post
startet kein `claude`, fehlgeschlagener Lauf meldet und sichert ohne Wiederholung, Absturz nach
Übernahme verliert nichts, und der Verteiler meldet Empfang sofort — mit Grund, wenn schon jemand
läuft. Der Prüfstand läuft vollständig in einem Wegwerf-Ordner gegen eine nachgebildete API und ein
nachgebildetes `claude`; es wird kein Dienst angelegt und nichts Produktives angefasst.

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
