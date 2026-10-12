#!/bin/bash
# Ein Arbeiter je Fenster: setzt die Claude-Sitzung dieses Fensters fort (--resume),
# hoechstens $MAX Arbeiter gleichzeitig.
#
# Grundsatz, der hier ueberall gilt: Es wird nur gemeldet, was nachweisbar passiert ist.
#  - "Arbeit gestartet" erst, wenn ein Prozess nachweislich laeuft (PID lebt). Ein fehlendes
#    Binary oder ein gescheiterter Spawn ergibt NIE "arbeitet", sondern einen Fehler.
#  - Gar kein automatischer zweiter fachlicher Aufruf. Scheitert ein Lauf, wird er als unklar
#    gemeldet und der Text gesichert - nie wiederholt.
#  - Exit 0 allein ist kein Beleg fuer ein Ergebnis. Es zaehlt nur eine Antwort, die ueber die
#    Lauf-ID DIESES Laufs und den Ergebnistyp zugeordnet ist. Eigene Meldungen des Runners
#    tragen das Kennzeichen [Runner] und koennen nie als Ergebnis gelten.
#  - Meldewege verschlucken keine Fehler: jede nicht zugestellte Meldung wird gezaehlt und geloggt.
fenster=$1; datei=$2
hier=${TONY_WAECHTER_DIR:-/opt/tony/waechter}
MAX=${TONY_MAX_PLAETZE:-3}
log=$hier/waechter.log
logz() { echo "$(date '+%Y-%m-%d %H:%M:%S')  [$fenster] $1" >> "$log"; }
schluessel=$(grep '^TONY_BOARD_KEY=' "${TONY_BOARD_ENV:-/root/.claude/secrets/tony-board.env}" | cut -d= -f2-)
api=${TONY_BOARD_API:-"https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api/$schluessel"}
mcp=${api/\/api\//\/mcp\/}
claude_bin=${TONY_CLAUDE_BIN:-/usr/local/bin/claude}
mkdir -p "$hier/sitzungen" "$hier/locks" "$hier/laufend" "$hier/fehlgeschlagen" "$hier/ohne-ergebnis" "$hier/unklar"

fid=""; [ "$fenster" != "ohne-fenster" ] && fid="$fenster"
antwortdatei="$hier/antwort-$fenster.json"
# Eindeutige Kennung dieses Laufs: nur ein Ergebnis mit genau dieser Kennung zaehlt als Ergebnis.
lauf_id="$fenster-$(date +%s%N)-$$"
meldefehler=0

# Meldung an Tony. Schlucken ist verboten: ein Fehlschlag wird gezaehlt und protokolliert.
an_tony() {
  local http
  # Kennzeichen: Meldungen des Runners sind keine Arbeitsergebnisse und duerfen nie so zaehlen.
  http=$(jq -n --arg t "[Runner] $1" --arg f "$fid" '{text:$t} + (if $f != "" then {fenster_id:$f} else {} end)' \
    | curl -s -o /dev/null -w '%{http_code}' --max-time "${TONY_HTTP_FRIST:-10}" \
        -X POST "$api/an-tony" -H 'content-type: application/json' --data-binary @- 2>/dev/null)
  if [ "$http" != "200" ]; then
    meldefehler=$((meldefehler+1))
    logz "MELDUNG NICHT ZUGESTELLT (HTTP ${http:-000}): $(echo "$1" | head -c 120)"
    return 1
  fi
  return 0
}

# Statusfelder der Karte setzen: $1 Taetigkeit, $2 Zustaendiger, $3 optional Fehlertext.
# Nur wenn die Karte existiert - sonst entstuende aus einer Meldung eine Geisterkarte.
karte_melden() {
  [ -n "$fid" ] || return 0
  local zustand http antwort
  zustand=$(curl -s --max-time "${TONY_HTTP_FRIST:-10}" "$api/state" 2>/dev/null) || zustand=""
  if [ -z "$zustand" ]; then
    meldefehler=$((meldefehler+1)); logz "KARTE NICHT GEMELDET: Board nicht erreichbar"; return 1
  fi
  echo "$zustand" | jq -e --arg f "$fid" '.fenster[]? | select(.id==$f)' >/dev/null 2>&1 || return 0
  antwort=$(jq -n --arg id "$fid" --arg t "$1" --arg z "$2" --arg e "${3:-}" \
    '{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"fenster_zeigen",arguments:
       ({id:$id,taetigkeit:$t} + (if $z != "" then {zustaendig:$z} else {} end)
                              + (if $e != "" then {fehler:$e} else {} end))}}' \
    | curl -s -w '\n%{http_code}' --max-time "${TONY_HTTP_FRIST:-10}" \
        -X POST "$mcp" -H 'content-type: application/json' --data-binary @- 2>/dev/null)
  http=$(echo "$antwort" | tail -1)
  if [ "$http" != "200" ] || echo "$antwort" | head -n -1 | jq -e '.result.isError == true' >/dev/null 2>&1; then
    meldefehler=$((meldefehler+1))
    logz "KARTE NICHT GEMELDET (HTTP ${http:-000}): $(echo "$antwort" | head -c 160)"
    return 1
  fi
  return 0
}

# Beleg 1 (lokal): Hat Claude fuer GENAU diesen Lauf ein Ergebnis hinterlegt?
# Die Antwortdatei muss die Lauf-ID dieses Laufs und den Ergebnistyp tragen.
ergebnis_lokal() {
  [ -s "$antwortdatei" ] || return 1
  jq -e --arg l "$lauf_id" '.lauf_id == $l and .art == "ergebnis"' "$antwortdatei" >/dev/null 2>&1
}

# Beleg 2 (Board): Ist seit $1 eine Antwort angekommen, die NICHT vom Runner stammt?
# Eigene Status- und Startmeldungen tragen [Runner] und werden hier ausdruecklich ausgeschlossen.
ergebnis_zugestellt() {
  curl -s --max-time "${TONY_HTTP_FRIST:-10}" "$api/state" 2>/dev/null \
    | jq -e --arg s "$1" --arg f "$fid" \
        '[.absprache[]? | select(.von=="claude" and .erstellt >= $s
                                 and ($f == "" or .fenster_id == $f or .fenster_id == null)
                                 and ((.text // "") | startswith("[Runner]") | not))] | length > 0' \
        >/dev/null 2>&1
}

# Post in einen eindeutigen Zustand ueberfuehren, statt sie zu verlieren oder fertig zu nennen.
ablegen() {   # $1 = Unterordner
  local ziel="$hier/$1/$fenster.$(date +%s).txt"
  mv "$laufend" "$ziel" 2>/dev/null && echo "$ziel"
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
5. Antworte Tony am Ende IMMER, kurz (hoechstens 6 Saetze): schreib die Datei $antwortdatei mit {\"text\": \"...\"${fid:+, \"fenster_id\": \"$fid\"}, \"lauf_id\": \"$lauf_id\", \"art\": \"ergebnis\"} und fuehre aus:
   curl -s -X POST \"$api/an-tony\" -H \"content-type: application/json\" --data-binary @$antwortdatei
Sag Tony, was erledigt ist und was er Marcel sagen oder fragen soll.

Hinweis: Stehen oben mehrere Nachrichten, sind sie waehrend eines laufenden Auftrags eingegangen und zusammengefasst worden. Reine Statusnachfragen beantwortest du kurz aus dem, was du schon weisst, und beginnst dafuer keine neue Umsetzung."

cd "${TONY_ARBEITSORDNER:-/opt/tony}"
sitzung=""; [ -s "$hier/sitzungen/$fenster" ] && sitzung=$(cat "$hier/sitzungen/$fenster")

# Binary vorab pruefen: ein fehlendes claude darf nie als laufende Arbeit erscheinen.
if ! [ -x "$claude_bin" ] && ! command -v "$claude_bin" >/dev/null 2>&1; then
  ziel=$(ablegen unklar)
  logz "ABBRUCH: claude nicht ausfuehrbar ($claude_bin), Text gesichert unter ${ziel:-?}"
  an_tony "Nicht gestartet: Auf dem Server ist '$claude_bin' nicht ausfuehrbar, es laeuft also KEINE Arbeit an '$fenster'. Der Nachrichtentext ist unter ${ziel:-dem Wartebereich} gesichert und wird nicht automatisch wiederholt."
  karte_melden "Kein Lauf gestartet: Claude ist auf dem Server nicht ausfuehrbar." "Claude" "claude-Binary $claude_bin fehlt oder ist nicht ausfuehrbar."
  exit 1
fi

# Lauf anstossen, OHNE auf das Ende zu warten. Setzt $pid, $gestartet, $beendet, ggf. $code.
# Getrennt vom Abwarten, damit die Startmeldung waehrend des laufenden Prozesses rausgeht.
lauf_starten() {
  ausgabedatei=$(mktemp); fehlerdatei=$(mktemp); t0=$(date +%s)
  printf '%s' "$auftrag" | env -u ANTHROPIC_API_KEY IS_SANDBOX=1 CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 \
    timeout "${TONY_ZEITGRENZE:-5400}" "$claude_bin" -p --permission-mode bypassPermissions --output-format json "$@" \
    >"$ausgabedatei" 2>"$fehlerdatei" &
  pid=$!
  beendet=nein
  # Ueberpruefbares Ereignis: lebt die PID nach kurzer Zeit, laeuft der Prozess wirklich.
  sleep "${TONY_STARTPROBE:-0.4}"
  if kill -0 "$pid" 2>/dev/null; then gestartet=ja; return 0; fi
  wait "$pid"; code=$?; beendet=ja
  # 126/127 = nicht ausfuehrbar / nicht gefunden -> es lief nie etwas
  if [ "$code" = 127 ] || [ "$code" = 126 ]; then gestartet=nein; else gestartet=ja; fi
}

lauf_abwarten() {
  [ "$beendet" = ja ] || { wait "$pid"; code=$?; }
  dauer=$(( $(date +%s) - t0 ))
  ausgabe=$(cat "$ausgabedatei"); fehlertext=$(cat "$fehlerdatei")
  cat "$fehlerdatei" >> "$hier/fehler.log"
  rm -f "$ausgabedatei" "$fehlerdatei"
}

seit=$(date -u +%Y-%m-%dT%H:%M:%S)
if [ -n "$sitzung" ]; then lauf_starten --resume "$sitzung"; else lauf_starten; fi

if [ "$gestartet" != ja ]; then
  ziel=$(ablegen unklar)
  logz "ABBRUCH: Prozess startete nicht (Code $code), Text gesichert unter ${ziel:-?}"
  an_tony "Nicht gestartet: Der Prozess fuer '$fenster' konnte nicht gestartet werden (Code $code). Es laeuft keine Arbeit. Text gesichert, kein automatischer Neuversuch."
  karte_melden "Prozess konnte nicht gestartet werden." "Claude" "Spawn fehlgeschlagen, Code $code."
  exit 1
fi

# Der Prozess laeuft jetzt nachweislich - und genau jetzt, nicht erst nach seinem Ende,
# geht die Startmeldung raus.
logz "Prozess belegt gestartet (PID $pid, Lauf $lauf_id), $anzahl Nachricht(en) zusammengefasst"
an_tony "Arbeit gestartet und belegt: Fuer '$fenster' laeuft jetzt ein Prozess (PID $pid, Lauf $lauf_id), $anzahl Nachricht(en) zusammengefasst, Sitzung ${sitzung:-neu}. Vorher war nur der Empfang bestaetigt."
karte_melden "Claude-Lauf fuer dieses Fenster belegt gestartet (PID $pid), $anzahl Nachricht(en) uebernommen." "Claude"

lauf_abwarten

neu=$(echo "$ausgabe" | jq -r '.session_id // empty' 2>/dev/null)
[ -n "$neu" ] && echo "$neu" > "$hier/sitzungen/$fenster"
logz "claude beendet (Code $code, ${dauer}s): $(echo "$ausgabe" | jq -r '.result // empty' 2>/dev/null | head -c 300)"

# Abschluss nur mit doppeltem Beleg: ein Ergebnis dieses Laufs (Lauf-ID + Ergebnistyp) UND
# eine im Board angekommene Antwort, die nicht vom Runner selbst stammt.
if [ "$code" -ne 0 ]; then
  # Ein einziger Fehlerpfad: ob der Resume oder die Arbeit scheiterte, laesst sich nicht sicher
  # trennen - also wird beides gleich behandelt, gesichert und nie wiederholt.
  ziel=$(ablegen fehlgeschlagen)
  sitzungshinweis=""
  [ -n "$sitzung" ] && sitzungshinweis=" Der Lauf setzte Sitzung $sitzung fort; scheitert das wiederholt, ist sie vermutlich unbrauchbar und jemand muss $hier/sitzungen/$fenster von Hand entfernen."
  logz "Lauf fehlgeschlagen (Code $code nach ${dauer}s), Text gesichert unter ${ziel:-?}"
  an_tony "Fehlgeschlagen: Claude konnte '$fenster' nicht bearbeiten (Code $code nach ${dauer}s). Ob dabei schon etwas gewirkt hat, ist unklar - deshalb wird NICHTS automatisch wiederholt. Der Nachrichtentext ist unter ${ziel:-dem Wartebereich} gesichert.$sitzungshinweis Bitte Marcel Bescheid geben."
  karte_melden "Claude-Lauf abgebrochen, Wirkung unklar - kein automatischer Neuversuch." "Claude" "Code $code nach ${dauer}s; Text gesichert unter ${ziel:-Wartebereich}."
elif ergebnis_lokal && ergebnis_zugestellt "$seit"; then
  rm -f "$laufend"
  logz "Ergebnis fuer Lauf $lauf_id belegt und zugestellt - Post abgeschlossen"
else
  fehlt=""
  ergebnis_lokal || fehlt="keine Antwortdatei mit der Lauf-ID $lauf_id"
  ergebnis_zugestellt "$seit" || fehlt="${fehlt:+$fehlt und }keine Antwort von Claude im Board (Runner-Meldungen zaehlen nicht)"
  ziel=$(ablegen ohne-ergebnis)
  logz "Lauf endete mit Code 0, aber ohne belegtes Ergebnis ($fehlt) - Text unter ${ziel:-?}"
  an_tony "Unklar: Der Lauf fuer '$fenster' endete ohne Fehler, aber es gibt kein belegtes Ergebnis - $fehlt. Ich erklaere das deshalb NICHT fuer fertig. Der Nachrichtentext ist unter ${ziel:-dem Wartebereich} unveraendert erhalten und wird nicht automatisch wiederholt."
  karte_melden "Lauf beendet, aber ohne belegtes Ergebnis - nicht als fertig gewertet." "Claude" "Kein zuordenbares Ergebnis fuer Lauf $lauf_id: $fehlt."
fi

if [ "$meldefehler" -gt 0 ]; then
  logz "ACHTUNG: $meldefehler Meldung(en) konnten nicht zugestellt werden - Board-Stand und Wirklichkeit koennen auseinanderlaufen"
  echo "$(date '+%Y-%m-%d %H:%M:%S') $fenster $meldefehler nicht zugestellte Meldung(en)" >> "$hier/meldefehler.log"
fi
