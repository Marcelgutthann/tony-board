#!/bin/bash
# Pruefstand fuer die Empfangs-/Start-/Warterueckmeldung.
#   bash test-aktivierung.sh
# Laeuft vollstaendig in einem Wegwerf-Ordner gegen eine nachgebildete Board-API und ein
# nachgebildetes claude. Der produktive Runner unter /opt/tony/waechter wird NICHT angefasst.
#
# Geprueft wird jeweils BEIDES: wie oft claude aufgerufen wurde (Aufrufzahl) und was dabei
# nach aussen gewirkt hat (Aussenwirkung), damit ein stiller zweiter Versuch auffliegt.
set -u
hier=$(cd "$(dirname "$0")" && pwd)
ok=0; nok=0
pruefe() { if [ "$1" = "ja" ]; then echo "OK   $2"; ok=$((ok+1)); else echo "FEHL $2"; nok=$((nok+1)); fi; }
hat() { grep -qFe "$2" -- "$1" 2>/dev/null && echo ja || echo nein; }
gleich() { [ "$1" = "$2" ] && echo ja || echo nein; }

arbeit=$(mktemp -d); port=$(( (RANDOM % 2000) + 18000 )); protokoll=$arbeit/api.log
: > "$protokoll"
python3 "$hier/fake-board.py" "$port" "$protokoll" & fakepid=$!
aufraeumen() { kill $fakepid 2>/dev/null; rm -rf "$arbeit"; }
trap aufraeumen EXIT
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$port/api/testkey/fuer-claude" >/dev/null 2>&1 && break; sleep .1; done

# Nachgebildetes claude: zaehlt Aufrufe mit Argumenten und erzeugt nur dann Aussenwirkung,
# wenn es das auch soll - genau wie ein echter Lauf, der am Ende selbst an Tony schreibt.
cat > "$arbeit/claude-fake" <<'EOF'
#!/bin/bash
cat > "$TEST_ARBEIT/auftrag-$(date +%s%N).txt"
echo "$*" >> "$TEST_ARBEIT/aufrufe.txt"
if [ "${TEST_RESUME_FEHLT:-0}" = 1 ] && [[ "$*" == *--resume* ]]; then
  echo "No conversation found with session ID abc" >&2
  exit 1
fi
sleep "${TEST_CLAUDE_DAUER:-1.2}"
if [ "${TEST_CLAUDE_WIRKUNG:-1}" = 1 ]; then
  curl -s "$TEST_SIM/sim/antwort" >/dev/null
  echo wirkung >> "$TEST_ARBEIT/wirkung.txt"
fi
[ "${TEST_CLAUDE_CODE:-0}" != "0" ] && exit "$TEST_CLAUDE_CODE"
echo '{"session_id":"sitzung-1","duration_ms":1234,"result":"fertig"}'
EOF
chmod +x "$arbeit/claude-fake"

export TONY_WAECHTER_DIR="$arbeit/waechter"
export TONY_BOARD_API="http://127.0.0.1:$port/api/testkey"
export TONY_BOARD_ENV="$arbeit/geheim.env"
export TONY_CLAUDE_BIN="$arbeit/claude-fake"
export TONY_ARBEITSORDNER="$arbeit"
export TONY_PLATZ_WARTE=1
export TEST_ARBEIT="$arbeit"
export TEST_SIM="http://127.0.0.1:$port"
echo "TONY_BOARD_KEY=testkey" > "$arbeit/geheim.env"
mkdir -p "$TONY_WAECHTER_DIR/post" "$TONY_WAECHTER_DIR/locks"
post() { printf '[2026-10-12T13:%02d:00Z] %s\n' "$1" "$2" > "$TONY_WAECHTER_DIR/post/testfenster.$(date +%s%N).txt"; }
irgendeine() { ls "$TONY_WAECHTER_DIR/post"/*.txt 2>/dev/null | head -1; }
aufrufe() { [ -f "$arbeit/aufrufe.txt" ] && wc -l < "$arbeit/aufrufe.txt" | tr -d ' ' || echo 0; }
wirkungen() { [ -f "$arbeit/wirkung.txt" ] && wc -l < "$arbeit/wirkung.txt" | tr -d ' ' || echo 0; }
meldungen() { grep -c '"art": "an-tony"' "$protokoll" 2>/dev/null | head -1; }
frisch() { : > "$arbeit/aufrufe.txt"; : > "$arbeit/wirkung.txt"; : > "$protokoll";
           rm -f "$TONY_WAECHTER_DIR"/{laufend,ohne-ergebnis,fehlgeschlagen,unklar}/*.txt 2>/dev/null
           curl -s "http://127.0.0.1:$port/sim/stoerung?an-tony=0&mcp=0&state=0&haenge=0" >/dev/null; }

echo "== 1. Freie Bahn: Empfang, belegter Start, zugestelltes Ergebnis =="
frisch; post 10 "Bitte Statusleiste bauen"
bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
pruefe "$(hat "$protokoll" 'Arbeit gestartet und belegt')" "1 Start wird erst nach Beleg gemeldet"
pruefe "$(hat "$protokoll" 'Vorher war nur der Empfang bestaetigt')" "1 Start ist vom Empfang unterscheidbar"
pruefe "$(gleich "$(aufrufe)" 1)" "1 genau ein claude-Aufruf"
pruefe "$(gleich "$(wirkungen)" 1)" "1 genau eine Aussenwirkung"
pruefe "$([ ! -e "$TONY_WAECHTER_DIR/laufend/testfenster.txt" ] && echo ja || echo nein)" "1 Post erst nach belegtem Ergebnis entfernt"

echo "== 2. Mehrere Nachrichten werden EIN Lauf, nicht vier =="
frisch
for i in 20 21 22 23; do post $i "Nachricht $i"; sleep .01; done
for d in "$TONY_WAECHTER_DIR/post"/*.txt; do bash "$hier/bearbeite.sh" testfenster "$d" >/dev/null 2>&1; done
pruefe "$(gleich "$(aufrufe)" 1)" "2 vier Nachrichten -> ein claude-Aufruf (war: $(aufrufe))"
pruefe "$(gleich "$(wirkungen)" 1)" "2 nur eine Aussenwirkung (war: $(wirkungen))"
letzter=$(ls -t "$arbeit"/auftrag-*.txt | head -1)
pruefe "$(hat "$letzter" 'Nachricht 20')" "2 erste Nachricht enthalten"
pruefe "$(hat "$letzter" 'Nachricht 23')" "2 letzte Nachricht enthalten"

echo "== 3. Warten auf die Fenstersperre, mit Grund und vor dem Start =="
frisch
( exec 9>>"$TONY_WAECHTER_DIR/locks/fenster-testfenster.lock"; flock 9; sleep 3 ) & halter=$!
sleep .4; post 30 "kommt waehrend eines Laufs"
bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
wait $halter 2>/dev/null
pruefe "$(hat "$protokoll" 'laeuft bereits ein Arbeiter')" "3 Warten mit Grund gemeldet"
pruefe "$(python3 - "$protokoll" <<'PY'
import json,sys
t=[json.loads(l)["text"] for l in open(sys.argv[1],encoding='utf-8') if json.loads(l)["art"]=="an-tony"]
w=[i for i,s in enumerate(t) if s.startswith("Wartet:")]; g=[i for i,s in enumerate(t) if s.startswith("Arbeit gestartet")]
print("ja" if w and g and w[0] < g[0] else "nein")
PY
)" "3 erst Warten, dann Start"

echo "== 4. Zweiter Arbeiter ohne offene Post: kein Aufruf, keine Wirkung =="
frisch
bash "$hier/bearbeite.sh" testfenster "$TONY_WAECHTER_DIR/post/nicht-da.txt" >/dev/null 2>&1
pruefe "$(gleich "$(aufrufe)" 0)" "4 kein claude-Aufruf"
pruefe "$(gleich "$(wirkungen)" 0)" "4 keine Aussenwirkung"
pruefe "$(gleich "$(meldungen)" 0)" "4 auch keine Startmeldung"

echo "== 5. Fehlgeschlagener Lauf: melden, sichern, NICHT wiederholen =="
frisch; post 50 "geht schief"
TEST_CLAUDE_CODE=3 TEST_CLAUDE_WIRKUNG=0 bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
pruefe "$(hat "$protokoll" 'Fehlgeschlagen')" "5 Fehler gemeldet"
pruefe "$(gleich "$(aufrufe)" 1)" "5 genau ein Aufruf, kein stiller zweiter (war: $(aufrufe))"
pruefe "$([ -n "$(ls "$TONY_WAECHTER_DIR/fehlgeschlagen" 2>/dev/null)" ] && echo ja || echo nein)" "5 Text gesichert"

echo "== 6. Absturz nach Uebernahme: Nachricht geht nicht verloren =="
frisch
printf '[2026-10-12T13:60:00Z] war schon uebernommen\n' > "$TONY_WAECHTER_DIR/laufend/testfenster.txt"
bash "$hier/bearbeite.sh" testfenster "$TONY_WAECHTER_DIR/post/nicht-da.txt" >/dev/null 2>&1
pruefe "$(gleich "$(aufrufe)" 1)" "6 uebernommene Nachricht nachgeholt"
pruefe "$(hat "$(ls -t "$arbeit"/auftrag-*.txt | head -1)" 'war schon uebernommen')" "6 Inhalt erhalten"

echo "== 7./8. Verteiler: Empfang sofort, mit Grund wenn besetzt =="
frisch
mkdir -p "$arbeit/bin"; printf '#!/bin/bash\nexit 0\n' > "$arbeit/bin/systemd-run"; chmod +x "$arbeit/bin/systemd-run"
curl -sf "http://127.0.0.1:$port/sim/neu?text=neuer+Auftrag" >/dev/null
PATH="$arbeit/bin:$PATH" bash "$hier/waechter.sh" >/dev/null 2>&1
pruefe "$(hat "$protokoll" 'Empfang bestaetigt')" "7 Empfang sofort gemeldet"
pruefe "$(hat "$protokoll" 'Den tatsaechlichen Arbeitsstart melde ich gleich gesondert')" "7 Empfang ist kein Arbeitsstart"
: > "$protokoll"
( exec 9>>"$TONY_WAECHTER_DIR/locks/fenster-testfenster.lock"; flock 9; sleep 2 ) & halter=$!
sleep .4; curl -sf "http://127.0.0.1:$port/sim/neu?text=zweiter+Auftrag" >/dev/null
PATH="$arbeit/bin:$PATH" bash "$hier/waechter.sh" >/dev/null 2>&1
wait $halter 2>/dev/null
pruefe "$(hat "$protokoll" 'laeuft noch ein Arbeiter')" "8 wartender Empfang als solcher gemeldet"
rm -f "$TONY_WAECHTER_DIR/post"/*.txt

echo "== 9. Fehlendes Binary ergibt NIE 'arbeitet' =="
frisch; post 90 "Binary fehlt"
TONY_CLAUDE_BIN="$arbeit/gibt-es-nicht" bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
pruefe "$(gleich "$(grep -c 'Arbeit gestartet' "$protokoll")" 0)" "9 kein Arbeitsstart gemeldet"
pruefe "$(hat "$protokoll" 'Nicht gestartet')" "9 ausdrueckliche Nicht-Start-Meldung"
pruefe "$(gleich "$(wirkungen)" 0)" "9 keine Aussenwirkung"
pruefe "$([ -n "$(ls "$TONY_WAECHTER_DIR/unklar" 2>/dev/null)" ] && echo ja || echo nein)" "9 Text in eindeutigem Zustand gesichert"
pruefe "$(python3 - "$protokoll" <<'PY'
import json,sys
z=[json.loads(l) for l in open(sys.argv[1],encoding='utf-8')]
print("ja" if any(x["art"]=="fenster_zeigen" and x.get("fehler") for x in z) else "nein")
PY
)" "9 Karte bekommt den Fehler, nicht 'arbeitet'"

echo "== 10. Timeout mit Teilwirkung wird NICHT pauschal wiederholt =="
frisch; post 100 "laeuft in die Zeitgrenze"
echo "alte-sitzung" > "$TONY_WAECHTER_DIR/sitzungen/testfenster"
TEST_CLAUDE_CODE=124 TEST_CLAUDE_WIRKUNG=1 bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
pruefe "$(gleich "$(aufrufe)" 1)" "10 genau EIN Aufruf trotz Fehlercode (war: $(aufrufe))"
pruefe "$(gleich "$(wirkungen)" 1)" "10 genau EINE Aussenwirkung, keine Verdopplung (war: $(wirkungen))"
pruefe "$(hat "$protokoll" 'Fehlgeschlagen')" "10 als Fehler gemeldet"
pruefe "$([ -n "$(ls "$TONY_WAECHTER_DIR/fehlgeschlagen" 2>/dev/null)" ] && echo ja || echo nein)" "10 Text gesichert statt wiederholt"

echo "== 11. Nur ein vor Ausfuehrung gescheiterter Resume wird einmal neu gestartet =="
frisch; post 110 "Sitzung ist weg"
echo "tote-sitzung" > "$TONY_WAECHTER_DIR/sitzungen/testfenster"
TEST_RESUME_FEHLT=1 bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
pruefe "$(gleich "$(aufrufe)" 2)" "11 genau zwei Aufrufe: Resume + ein Neustart (war: $(aufrufe))"
pruefe "$(gleich "$(wirkungen)" 1)" "11 nur eine Aussenwirkung - der Resume wirkte nicht"
pruefe "$(hat "$protokoll" 'nicht mehr verwendbar')" "11 der Sonderfall wird ausdruecklich benannt"
pruefe "$(hat "$arbeit/aufrufe.txt" '--resume')" "11 erster Aufruf war wirklich ein Resume"

echo "== 12. Exit 0 ohne zugestelltes Ergebnis gilt NICHT als fertig =="
frisch; post 120 "endet ohne Antwort"
rm -f "$TONY_WAECHTER_DIR/sitzungen/testfenster"
TEST_CLAUDE_WIRKUNG=0 bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
pruefe "$(hat "$protokoll" 'keine Antwort von Claude im Board angekommen')" "12 fehlende Zustellung wird benannt"
pruefe "$([ -n "$(ls "$TONY_WAECHTER_DIR/ohne-ergebnis" 2>/dev/null)" ] && echo ja || echo nein)" "12 Inhalt in eindeutigem Zustand erhalten"
pruefe "$([ ! -e "$TONY_WAECHTER_DIR/laufend/testfenster.txt" ] && echo ja || echo nein)" "12 nichts bleibt in der Schwebe"
pruefe "$(gleich "$(aufrufe)" 1)" "12 kein automatischer Neuversuch"

echo "== 13. HTTP-Fehler der Meldewege werden nicht verschluckt =="
frisch; post 130 "Meldeweg gestoert"
curl -s "http://127.0.0.1:$port/sim/stoerung?an-tony=500&mcp=503" >/dev/null
bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
curl -s "http://127.0.0.1:$port/sim/stoerung?an-tony=0&mcp=0" >/dev/null
pruefe "$(hat "$TONY_WAECHTER_DIR/waechter.log" 'MELDUNG NICHT ZUGESTELLT')" "13 nicht zugestellte Meldung protokolliert"
pruefe "$(hat "$TONY_WAECHTER_DIR/waechter.log" 'KARTE NICHT GEMELDET')" "13 fehlgeschlagene Kartenmeldung protokolliert"
pruefe "$([ -s "$TONY_WAECHTER_DIR/meldefehler.log" ] && echo ja || echo nein)" "13 Meldefehler eigens festgehalten"

echo "== 14. Haengender Meldeweg bricht den Lauf nicht ab =="
frisch; post 140 "Meldeweg haengt"
curl -s "http://127.0.0.1:$port/sim/stoerung?haenge=2" >/dev/null
TONY_HTTP_FRIST=1 timeout 60 bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
ende=$?
curl -s "http://127.0.0.1:$port/sim/stoerung?haenge=0" >/dev/null
pruefe "$(gleich "$ende" 0)" "14 Arbeiter laeuft trotz Zeitueberschreitung sauber zu Ende"
pruefe "$(gleich "$(aufrufe)" 1)" "14 der Lauf selbst fand statt"
pruefe "$(hat "$TONY_WAECHTER_DIR/waechter.log" 'MELDUNG NICHT ZUGESTELLT')" "14 Haenger als nicht zugestellt vermerkt"

echo "== 15. Ende zu Ende: Empfang -> belegter Start -> gespeichertes Ergebnis =="
frisch; rm -f "$TONY_WAECHTER_DIR/sitzungen/testfenster"
curl -sf "http://127.0.0.1:$port/sim/neu?text=vollstaendiger+Durchlauf" >/dev/null
PATH="$arbeit/bin:$PATH" bash "$hier/waechter.sh" >/dev/null 2>&1
bash "$hier/bearbeite.sh" testfenster "$(irgendeine)" >/dev/null 2>&1
pruefe "$(python3 - "$protokoll" <<'PY'
import json,sys
t=[json.loads(l)["text"] for l in open(sys.argv[1],encoding='utf-8') if json.loads(l)["art"]=="an-tony"]
e=[i for i,s in enumerate(t) if s.startswith("Empfang bestaetigt")]
g=[i for i,s in enumerate(t) if s.startswith("Arbeit gestartet und belegt")]
print("ja" if e and g and e[0] < g[0] else "nein")
PY
)" "15 Reihenfolge Empfang vor belegtem Start"
pruefe "$(gleich "$(wirkungen)" 1)" "15 Ergebnis genau einmal zugestellt"
pruefe "$([ ! -e "$TONY_WAECHTER_DIR/laufend/testfenster.txt" ] && echo ja || echo nein)" "15 Auftrag erst nach Beleg abgeschlossen"
pruefe "$([ -s "$TONY_WAECHTER_DIR/sitzungen/testfenster" ] && echo ja || echo nein)" "15 Sitzung fuer das naechste Mal gemerkt"

echo
echo "$ok/$((ok+nok)) Pruefungen bestanden"
[ "$nok" = 0 ] || exit 1
