#!/bin/bash
# Ein Arbeiter je Fenster: setzt die Claude-Sitzung dieses Fensters fort (--resume),
# hoechstens $MAX Arbeiter gleichzeitig.
fenster=$1; datei=$2
hier=/opt/tony/waechter
MAX=3
log=$hier/waechter.log
logz() { echo "$(date '+%Y-%m-%d %H:%M:%S')  [$fenster] $1" >> "$log"; }
schluessel=$(grep '^TONY_BOARD_KEY=' /root/.claude/secrets/tony-board.env | cut -d= -f2-)
api="https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api/$schluessel"
mkdir -p "$hier/sitzungen" "$hier/locks"

# Gleiches Fenster: warten, bis der vorige Arbeiter fertig ist.
exec 8>"$hier/locks/fenster-$fenster.lock"; flock 8
# Freien Platz suchen (hoechstens MAX gleichzeitig).
while :; do
  for i in $(seq 1 $MAX); do
    exec 7>"$hier/locks/platz-$i.lock"
    flock -n 7 && break 2
  done
  sleep 10
done

text=$(cat "$datei"); rm -f "$datei"
fid=""; [ "$fenster" != "ohne-fenster" ] && fid="$fenster"
antwortdatei="$hier/antwort-$fenster.json"

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
Sag Tony, was erledigt ist und was er Marcel sagen oder fragen soll."

cd /opt/tony
sitzung=""; [ -s "$hier/sitzungen/$fenster" ] && sitzung=$(cat "$hier/sitzungen/$fenster")
logz "Start (Platz frei${sitzung:+, setzt Sitzung $sitzung fort})"
lauf() { echo "$auftrag" | env -u ANTHROPIC_API_KEY IS_SANDBOX=1 CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 timeout 5400 /usr/local/bin/claude -p --permission-mode bypassPermissions --output-format json "$@" 2>>"$hier/fehler.log"; }
if [ -n "$sitzung" ]; then ausgabe=$(lauf --resume "$sitzung"); code=$?; else code=1; fi
if [ $code -ne 0 ] || [ -z "$ausgabe" ]; then ausgabe=$(lauf); code=$?; fi
neu=$(echo "$ausgabe" | jq -r '.session_id // empty' 2>/dev/null)
[ -n "$neu" ] && echo "$neu" > "$hier/sitzungen/$fenster"
logz "claude beendet (Code $code, $(echo "$ausgabe" | jq -r '.duration_ms // 0' 2>/dev/null | awk '{printf "%d s", $1/1000}')): $(echo "$ausgabe" | jq -r '.result // empty' 2>/dev/null | head -c 300)"
if [ $code -ne 0 ]; then
  jq -n --arg t "Claude konnte deine Nachricht gerade nicht bearbeiten (Fehlercode $code). Bitte Marcel Bescheid geben." --arg f "$fid" '{text: $t} + (if $f != "" then {fenster_id: $f} else {} end)' \
    | curl -s --max-time 20 -X POST "$api/an-tony" -H "content-type: application/json" --data-binary @- > /dev/null
fi
