#!/bin/bash
# Pruefstand fuer die Empfangs-/Start-/Warterueckmeldung.
#   bash test-aktivierung.sh
# Laeuft vollstaendig in einem Wegwerf-Ordner gegen eine nachgebildete Board-API und ein
# nachgebildetes claude. Der produktive Runner unter /opt/tony/waechter wird NICHT angefasst.
set -u
hier=$(cd "$(dirname "$0")" && pwd)
ok=0; nok=0
pruefe() { if [ "$1" = "ja" ]; then echo "OK   $2"; ok=$((ok+1)); else echo "FEHL $2"; nok=$((nok+1)); fi; }
hat() { grep -qF "$2" "$1" && echo ja || echo nein; }

arbeit=$(mktemp -d); port=$(( (RANDOM % 2000) + 18000 )); protokoll=$arbeit/api.log
: > "$protokoll"
python3 "$hier/fake-board.py" "$port" "$protokoll" & fakepid=$!
aufraeumen() { kill $fakepid 2>/dev/null; rm -rf "$arbeit"; }
trap aufraeumen EXIT
for _ in $(seq 1 50); do curl -sf "http://127.0.0.1:$port/api/testkey/fuer-claude" >/dev/null 2>&1 && break; sleep .1; done

# Nachgebildetes claude: liest den Auftrag, legt ihn ab und antwortet wie das Original.
cat > "$arbeit/claude-fake" <<'EOF'
#!/bin/bash
cat > "$TEST_ARBEIT/auftrag-$(date +%s%N).txt"
echo "$TEST_CLAUDE_LAUF" >> "$TEST_ARBEIT/laeufe.txt"
sleep "${TEST_CLAUDE_DAUER:-0}"
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
echo "TONY_BOARD_KEY=testkey" > "$arbeit/geheim.env"
mkdir -p "$TONY_WAECHTER_DIR/post" "$TONY_WAECHTER_DIR/locks"
post() { printf '[2026-10-12T13:%02d:00Z] %s\n' "$1" "$2" > "$TONY_WAECHTER_DIR/post/testfenster.$(date +%s%N).txt"; }
laeufe() { [ -f "$arbeit/laeufe.txt" ] && wc -l < "$arbeit/laeufe.txt" | tr -d ' ' || echo 0; }

echo "== 1. Freie Bahn: Empfang, Start, Abschluss =="
post 10 "Bitte Statusleiste bauen"
bash "$hier/bearbeite.sh" testfenster "$TONY_WAECHTER_DIR/post/$(ls "$TONY_WAECHTER_DIR/post")" >/dev/null 2>&1
pruefe "$(hat "$protokoll" 'Arbeit gestartet')" "1 Arbeitsstart wird gemeldet"
pruefe "$(hat "$protokoll" 'Vorher war nur der Empfang bestaetigt')" "1 Start ist vom Empfang unterscheidbar"
pruefe "$([ "$(laeufe)" = 1 ] && echo ja || echo nein)" "1 genau ein claude-Lauf"
pruefe "$(hat "$protokoll" 'Claude-Sitzung fuer dieses Fenster')" "1 Karte bekommt Taetigkeit und Zustaendigen"
pruefe "$([ ! -s "$TONY_WAECHTER_DIR/laufend/testfenster.txt" ] && echo ja || echo nein)" "1 uebernommene Post nach Erfolg weggeraeumt"
pruefe "$([ -s "$TONY_WAECHTER_DIR/sitzungen/testfenster" ] && echo ja || echo nein)" "1 Sitzungs-ID gemerkt"

echo "== 2. Mehrere Nachrichten werden EIN Lauf, nicht vier =="
: > "$arbeit/laeufe.txt"; : > "$protokoll"
post 20 "fachlicher Auftrag"; sleep .01
post 21 "Statusfrage eins"; sleep .01
post 22 "Statusfrage zwei"; sleep .01
post 23 "Statusfrage drei"
for d in "$TONY_WAECHTER_DIR/post"/*.txt; do
  bash "$hier/bearbeite.sh" testfenster "$d" >/dev/null 2>&1
done
pruefe "$([ "$(laeufe)" = 1 ] && echo ja || echo nein)" "2 vier Nachrichten -> genau ein claude-Lauf (war: $(laeufe))"
letzter=$(ls -t "$arbeit"/auftrag-*.txt | head -1)
pruefe "$(hat "$letzter" 'fachlicher Auftrag')" "2 erste Nachricht im Auftrag enthalten"
pruefe "$(hat "$letzter" 'Statusfrage drei')" "2 letzte Nachricht im Auftrag enthalten"
pruefe "$(hat "$letzter" 'Reine Statusnachfragen beantwortest du kurz')" "2 Hinweis gegen endloses Nachlaufen im Auftrag"
pruefe "$([ "$(ls "$TONY_WAECHTER_DIR/post" | wc -l)" = 0 ] && echo ja || echo nein)" "2 Postfach danach leer"

echo "== 3. Warten auf die Fenstersperre wird mit Grund gemeldet =="
: > "$arbeit/laeufe.txt"; : > "$protokoll"
( exec 9>>"$TONY_WAECHTER_DIR/locks/fenster-testfenster.lock"; flock 9; sleep 3 ) &
halter=$!
sleep .4
post 30 "kommt waehrend eines Laufs"
zeitstart=$(date +%s)
bash "$hier/bearbeite.sh" testfenster "$TONY_WAECHTER_DIR/post/$(ls "$TONY_WAECHTER_DIR/post")" >/dev/null 2>&1
wait $halter 2>/dev/null
pruefe "$(hat "$protokoll" 'Wartet: Zu ')" "3 Warten wird gemeldet"
pruefe "$(hat "$protokoll" 'laeuft bereits ein Arbeiter')" "3 Grund des Wartens wird genannt"
reihenfolge=$(python3 - "$protokoll" <<'PY'
import json,sys
z=[json.loads(l) for l in open(sys.argv[1],encoding='utf-8')]
t=[x["text"] for x in z if x["art"]=="an-tony"]
print("ja" if any(s.startswith("Wartet:") for s in t) and any(s.startswith("Arbeit gestartet:") for s in t)
      and next(i for i,s in enumerate(t) if s.startswith("Wartet:")) < next(i for i,s in enumerate(t) if s.startswith("Arbeit gestartet:")) else "nein")
PY
)
pruefe "$reihenfolge" "3 erst Warten, dann Arbeitsstart"
pruefe "$([ $(( $(date +%s) - zeitstart )) -ge 2 ] && echo ja || echo nein)" "3 Arbeiter hat tatsaechlich gewartet"

echo "== 4. Zweiter Arbeiter ohne offene Post startet kein claude =="
: > "$arbeit/laeufe.txt"; : > "$protokoll"
bash "$hier/bearbeite.sh" testfenster "$TONY_WAECHTER_DIR/post/nicht-da.txt" >/dev/null 2>&1
pruefe "$([ "$(laeufe)" = 0 ] && echo ja || echo nein)" "4 kein Lauf, keine Kosten"
pruefe "$([ "$(grep -c 'Arbeit gestartet' "$protokoll")" = 0 ] && echo ja || echo nein)" "4 kein falscher Arbeitsstart gemeldet"

echo "== 5. Fehlgeschlagener Lauf: sauber melden, Text sichern, nicht wiederholen =="
: > "$arbeit/laeufe.txt"; : > "$protokoll"
post 50 "geht schief"
TEST_CLAUDE_CODE=3 bash "$hier/bearbeite.sh" testfenster "$TONY_WAECHTER_DIR/post/$(ls "$TONY_WAECHTER_DIR/post")" >/dev/null 2>&1
pruefe "$(hat "$protokoll" 'Fehlgeschlagen')" "5 Fehler wird gemeldet"
pruefe "$(hat "$protokoll" 'NICHT automatisch wiederholt')" "5 kein stiller Neuversuch"
pruefe "$([ -n "$(ls "$TONY_WAECHTER_DIR/fehlgeschlagen" 2>/dev/null)" ] && echo ja || echo nein)" "5 Nachrichtentext gesichert"
pruefe "$([ ! -s "$TONY_WAECHTER_DIR/laufend/testfenster.txt" ] && echo ja || echo nein)" "5 nichts bleibt in der Schwebe"
pruefe "$(python3 - "$protokoll" <<'PY'
import json,sys
z=[json.loads(l) for l in open(sys.argv[1],encoding='utf-8')]
print("ja" if any(x["art"]=="fenster_zeigen" and x.get("fehler") for x in z) else "nein")
PY
)" "5 Karte bekommt den Fehlertext"

echo "== 6. Absturz nach Uebernahme, vor Start: Nachricht geht nicht verloren =="
: > "$arbeit/laeufe.txt"; : > "$protokoll"
printf '[2026-10-12T13:60:00Z] war schon uebernommen\n' > "$TONY_WAECHTER_DIR/laufend/testfenster.txt"
bash "$hier/bearbeite.sh" testfenster "$TONY_WAECHTER_DIR/post/nicht-da.txt" >/dev/null 2>&1
pruefe "$([ "$(laeufe)" = 1 ] && echo ja || echo nein)" "6 uebernommene Nachricht wird nachgeholt"
pruefe "$(hat "$(ls -t "$arbeit"/auftrag-*.txt | head -1)" 'war schon uebernommen')" "6 Inhalt vollstaendig erhalten"

echo "== 7. Verteiler meldet Empfang sofort =="
: > "$protokoll"
curl -sf "http://127.0.0.1:$port/sim/neu?text=neuer+Auftrag&fenster=testfenster" >/dev/null
# systemd-run durch eine Attrappe ersetzen, damit der Test keinen Dienst anlegt
mkdir -p "$arbeit/bin"; printf '#!/bin/bash\nexit 0\n' > "$arbeit/bin/systemd-run"; chmod +x "$arbeit/bin/systemd-run"
PATH="$arbeit/bin:$PATH" bash "$hier/waechter.sh" >/dev/null 2>&1
pruefe "$(hat "$protokoll" 'Empfang bestaetigt')" "7 Empfang wird sofort gemeldet"
pruefe "$(hat "$protokoll" 'Den tatsaechlichen Arbeitsstart melde ich gleich gesondert')" "7 Empfang wird nicht als Arbeitsstart ausgegeben"
pruefe "$([ "$(ls "$TONY_WAECHTER_DIR/post" | wc -l)" -ge 1 ] && echo ja || echo nein)" "7 Post liegt fuer den Arbeiter bereit"

echo "== 8. Verteiler nennt den Grund, wenn schon jemand laeuft =="
: > "$protokoll"
( exec 9>>"$TONY_WAECHTER_DIR/locks/fenster-testfenster.lock"; flock 9; sleep 2 ) &
halter=$!
sleep .4
curl -sf "http://127.0.0.1:$port/sim/neu?text=zweiter+Auftrag&fenster=testfenster" >/dev/null
PATH="$arbeit/bin:$PATH" bash "$hier/waechter.sh" >/dev/null 2>&1
wait $halter 2>/dev/null
pruefe "$(hat "$protokoll" 'laeuft noch ein Arbeiter')" "8 wartender Empfang wird als solcher gemeldet"
pruefe "$(hat "$protokoll" 'startet keinen zusaetzlichen Lauf')" "8 Tony erfaehrt, dass sich nichts stapelt"

echo
echo "$ok/$((ok+nok)) Pruefungen bestanden"
[ "$nok" = 0 ] || exit 1
