#!/bin/bash
# Ein Arbeiter je Fenster: setzt die Claude-Sitzung dieses Fensters fort (--resume),
# hoechstens $MAX Arbeiter gleichzeitig.
# Neu: meldet Warten mit Grund, bestaetigt den Arbeitsstart erst nach Erwerb der Sperre und
# Prozessstart, fasst alles Offene zu einem Fenster in EINEN Lauf zusammen und meldet den
# Abschluss bzw. den Fehler sauber zurueck.
fenster=$1; datei=$2
hier=${TONY_WAECHTER_DIR:-/opt/tony/waechter}
MAX=${TONY_MAX_PLAETZE:-3}
log=$hier/waechter.log
logz() { echo "$(date '+%Y-%m-%d %H:%M:%S')  [$fenster] $1" >> "$log"; }
schluessel=$(grep '^TONY_BOARD_KEY=' "${TONY_BOARD_ENV:-/root/.claude/secrets/tony-board.env}" | cut -d= -f2-)
api=${TONY_BOARD_API:-"https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api/$schluessel"}
mcp=${api/\/api\//\/mcp\/}
mkdir -p "$hier/sitzungen" "$hier/locks" "$hier/laufend" "$hier/fehlgeschlagen"

fid=""; [ "$fenster" != "ohne-fenster" ] && fid="$fenster"
antwortdatei="$hier/antwort-$fenster.json"

# Meldung an Tony. Darf nie blockieren und nie den Lauf abbrechen.
an_tony() {
  jq -n --arg t "$1" --arg f "$fid" '{text:$t} + (if $f != "" then {fenster_id:$f} else {} end)' \
    | curl -s --max-time 10 -X POST "$api/an-tony" -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 || true
}

# Statusfelder der Karte setzen: $1 Taetigkeit, $2 Zustaendiger, $3 optional Fehlertext.
# Nur wenn die Karte schon existiert - sonst entstuende aus einer Meldung eine Geisterkarte.
karte_melden() {
  [ -n "$fid" ] || return 0
  curl -sf --max-time 10 "$api/state" | jq -e --arg f "$fid" '.fenster[] | select(.id==$f)' >/dev/null 2>&1 || return 0
  jq -n --arg id "$fid" --arg t "$1" --arg z "$2" --arg e "${3:-}" \
    '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"fenster_zeigen",arguments:
       ({id:$id,taetigkeit:$t} + (if $z != "" then {zustaendig:$z} else {} end)
                              + (if $e != "" then {fehler:$e} else {} end))}}' \
    | curl -s --max-time 10 -X POST "$mcp" -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 || true
}

# Gleiches Fenster: warten, bis der vorige Arbeiter fertig ist - und das sichtbar machen.
exec 8>>"$hier/locks/fenster-$fenster.lock"
if ! flock -n 8; then
  haelt=$(fuser "$hier/locks/fenster-$fenster.lock" 2>/dev/null | tr -s ' ' | sed 's/^ *//' | cut -d' ' -f1)
  logz "wartet auf die Fenstersperre (haelt: ${haelt:-unbekannt})"
  an_tony "Wartet: Zu '$fenster' laeuft bereits ein Arbeiter${haelt:+ (Prozess $haelt)}. Dein Auftrag ist uebernommen und wird bearbeitet, sobald der laufende fertig ist - er wird dann mit allem anderen Offenen in einem Lauf zusammengefasst."
  flock 8
fi

# Freien Platz suchen (hoechstens MAX gleichzeitig).
gemeldet=0
while :; do
  for i in $(seq 1 "$MAX"); do
    exec 7>>"$hier/locks/platz-$i.lock"
    flock -n 7 && break 2
  done
  if [ "$gemeldet" = 0 ]; then
    logz "alle $MAX Plaetze belegt, wartet"
    an_tony "Wartet: '$fenster' ist an der Reihe, aber alle $MAX Arbeitsplaetze sind belegt. Der Lauf startet, sobald einer frei wird."
    gemeldet=1
  fi
  sleep "${TONY_PLATZ_WARTE:-10}"
done

# Erst unter der Fenstersperre anfassen: alles Offene zu diesem Fenster wird EIN Lauf.
# Dadurch stapeln sich Statusnachfragen nicht zu je einem eigenen fachlichen Auftrag.
laufend="$hier/laufend/$fenster.txt"
mapfile -t offen < <(ls -1 "$hier/post/$fenster".*.txt 2>/dev/null | sort)
if [ -s "$laufend" ] || [ ${#offen[@]} -gt 0 ]; then
  {
    [ -s "$laufend" ] && cat "$laufend"
    for d in "${offen[@]}"; do [ -s "$d" ] && { cat "$d"; echo; }; done
  } > "$laufend.neu"
  mv "$laufend.neu" "$laufend"
  for d in "${offen[@]}"; do rm -f "$d"; done
fi
# Nichts mehr da: ein vorheriger Arbeiter hat die Post bereits mitgenommen. Kein Lauf, keine Kosten.
if [ ! -s "$laufend" ]; then
  logz "nichts offen - ein frueherer Arbeiter hat die Post uebernommen, kein Lauf"
  exit 0
fi
text=$(cat "$laufend")
anzahl=$(grep -c '^\[' "$laufend"); [ "$anzahl" -gt 0 ] 2>/dev/null || anzahl=1

auftrag="Du bist Claude auf Marcels Hetzner-Server. Tony ist Marcels proaktiver ChatGPT-Agent (Dots, per Sprache auf dem iPad). Ihr teilt euch das Tony Board. Tony hat dir ueber das Board geschrieben${fid:+ (Fenster $fid)}:

$text

Arbeitsteilung: Tony macht Kommunikation (Mails, Kalender, Rueckfragen an Marcel). Du machst Code, App, Daten, Deploys auf staging, Tickets, Auswertungen.

So gehst du vor:
1. Erledige die Aufgabe vollstaendig nach Marcels Regeln (CLAUDE.md, Gedaechtnis). Nie prod ausrollen, nie Mails senden, nie Geld bewegen, nichts loeschen ohne Marcel.
2. Parallel zu dir arbeiten andere Claude-Sitzungen an anderen Fenstern. Arbeite in Git nie direkt in /opt/tony/repos/<repo>, sondern in einem eigenen Worktree: git -C /opt/tony/repos/<repo> worktree add /opt/tony/arbeit/${fenster}/<repo> <branch> (gibt es ihn schon, dort weitermachen). Bleib bei einem Branch je Fenster, statt neue -v2-Branches anzulegen.
3. Ist die Aufgabe gross, teile sie und lass Teile parallel von Subagenten (Agent-Werkzeug) erledigen. Du laeufst nicht interaktiv: deine Sitzung endet, sobald du aufhoerst zu antworten. Starte darum nichts im Hintergrund (kein run_in_background, kein Monitor, kein ScheduleWakeup) und warte auf jeden Subagenten, bevor du Tony antwortest.
4. Halte nur an, wenn wirklich Marcel entscheiden muss; dann erledige vorher alles, was ohne ihn geht, und schreib Tony genau die eine Frage.
5. Antworte Tony am Ende IMMER, kurz (hoechstens 6 Saetze): schreib die Datei $antwortdatei mit {\"text\": \"...\"${fid:+, \"fenster_id\": \"$fid\"}} und fuehre aus:
   curl -s -X POST \"$api/an-tony\" -H \"content-type: application/json\" --data-binary @$antwortdatei
Sag Tony, was erledigt ist und was er Marcel sagen oder fragen soll.

Hinweis: Stehen oben mehrere Nachrichten, sind sie waehrend eines laufenden Auftrags eingegangen und zusammengefasst worden. Reine Statusnachfragen beantwortest du kurz aus dem, was du schon weisst, und beginnst dafuer keine neue Umsetzung."

cd "${TONY_ARBEITSORDNER:-/opt/tony}"
sitzung=""; [ -s "$hier/sitzungen/$fenster" ] && sitzung=$(cat "$hier/sitzungen/$fenster")

# Ab hier laeuft wirklich ein Prozess: erst jetzt den Arbeitsstart bestaetigen.
logz "Start (Platz frei${sitzung:+, setzt Sitzung $sitzung fort}), $anzahl Nachricht(en) zusammengefasst"
an_tony "Arbeit gestartet: Claude bearbeitet '$fenster' seit $(date '+%H:%M:%S') UTC, $anzahl Nachricht(en) zusammengefasst, Sitzung ${sitzung:-neu}. Vorher war nur der Empfang bestaetigt, jetzt laeuft der Prozess."
karte_melden "Claude-Sitzung fuer dieses Fenster um $(date '+%H:%M') gestartet, $anzahl Nachricht(en) uebernommen." "Claude"

lauf() { echo "$auftrag" | env -u ANTHROPIC_API_KEY IS_SANDBOX=1 CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 timeout "${TONY_ZEITGRENZE:-5400}" "${TONY_CLAUDE_BIN:-/usr/local/bin/claude}" -p --permission-mode bypassPermissions --output-format json "$@" 2>>"$hier/fehler.log"; }
if [ -n "$sitzung" ]; then ausgabe=$(lauf --resume "$sitzung"); code=$?; else code=1; fi
if [ $code -ne 0 ] || [ -z "$ausgabe" ]; then ausgabe=$(lauf); code=$?; fi
neu=$(echo "$ausgabe" | jq -r '.session_id // empty' 2>/dev/null)
[ -n "$neu" ] && echo "$neu" > "$hier/sitzungen/$fenster"
logz "claude beendet (Code $code, $(echo "$ausgabe" | jq -r '.duration_ms // 0' 2>/dev/null | awk '{printf "%d s", $1/1000}')): $(echo "$ausgabe" | jq -r '.result // empty' 2>/dev/null | head -c 300)"

if [ $code -eq 0 ]; then
  # Erst nach einem sauberen Lauf wird die uebernommene Post endgueltig weggeraeumt.
  rm -f "$laufend"
else
  # Inhalt sichern statt verlieren - und ausdruecklich NICHT automatisch wiederholen.
  gesichert="$hier/fehlgeschlagen/$fenster.$(date +%s).txt"
  mv "$laufend" "$gesichert" 2>/dev/null
  logz "Lauf fehlgeschlagen (Code $code), Text gesichert unter $gesichert"
  an_tony "Fehlgeschlagen: Claude konnte '$fenster' nicht bearbeiten (Code $code). Der Nachrichtentext ist gesichert und wird NICHT automatisch wiederholt. Bitte Marcel Bescheid geben."
  karte_melden "Claude-Lauf abgebrochen, kein automatischer Neuversuch." "Claude" "Arbeiter mit Code $code beendet; Nachrichtentext gesichert unter $gesichert."
fi
