#!/bin/bash
# Tony-Board-Waechter (Server): laeuft als Dauerdienst, schaut alle 5 s nach Post von Tony.
# Schaut ohne KI nach, ob Tony an Claude geschrieben hat, und verteilt die Post je Fenster
# an eigene Arbeiter (bearbeite.sh). Verschiedene Fenster laufen parallel, ein Fenster nacheinander.
# Neu: meldet Tony sofort den Empfang und sagt dabei, ob gleich gearbeitet wird oder noch jemand laeuft.
hier=${TONY_WAECHTER_DIR:-/opt/tony/waechter}
log=$hier/waechter.log
logz() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $1" >> "$log"; }

exec 9>"$hier/verteiler.lock"
flock -n 9 || exit 0

schluessel=$(grep '^TONY_BOARD_KEY=' "${TONY_BOARD_ENV:-/root/.claude/secrets/tony-board.env}" | cut -d= -f2-)
api=${TONY_BOARD_API:-"https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api/$schluessel"}

# Kurze Meldung an Tony, ohne KI. Darf nie blockieren und nie den Lauf abbrechen.
an_tony() {
  jq -n --arg t "$1" --arg f "$2" \
    '{text:$t} + (if $f != "" and $f != "ohne-fenster" then {fenster_id:$f} else {} end)' \
    | curl -s --max-time 10 -X POST "$api/an-tony" -H 'content-type: application/json' --data-binary @- >/dev/null 2>&1 || true
}

offen=$(curl -sf --max-time 20 "$api/fuer-claude" | jq -r '.offen') || { logz "Abfrage fehlgeschlagen"; exit 0; }
[ "${offen:-0}" -gt 0 ] 2>/dev/null || exit 0

nachrichten=$(curl -sf --max-time 20 -X POST "$api/fuer-claude") || { logz "Abholen fehlgeschlagen"; exit 0; }
mkdir -p "$hier/post" "$hier/locks"
for fenster in $(echo "$nachrichten" | jq -r '.nachrichten | map(.fenster_id // "ohne-fenster") | unique | .[]'); do
  anzahl=$(echo "$nachrichten" | jq -r --arg f "$fenster" '[.nachrichten[] | select((.fenster_id // "ohne-fenster") == $f)] | length')
  datei="$hier/post/$fenster.$(date +%s%N).txt"
  echo "$nachrichten" | jq -r --arg f "$fenster" '.nachrichten | map(select((.fenster_id // "ohne-fenster") == $f)) | map("[\(.zeit)] \(.text)") | join("\n\n")' > "$datei"
  logz "Post fuer $fenster: $(head -c 200 "$datei")"

  # Empfang sofort bestaetigen. Die Fenstersperre wird nur kurz probiert und gleich wieder
  # losgelassen, damit Tony erfaehrt, ob er auf einen laufenden Arbeiter wartet.
  if (exec {p}>>"$hier/locks/fenster-$fenster.lock"; flock -n "$p") 2>/dev/null; then
    an_tony "Empfang bestaetigt: $anzahl Nachricht(en) zu '$fenster' uebernommen, ein Arbeiter wird jetzt gestartet. Den tatsaechlichen Arbeitsstart melde ich gleich gesondert." "$fenster"
    logz "[$fenster] Empfang gemeldet (frei)"
  else
    an_tony "Empfang bestaetigt: $anzahl Nachricht(en) zu '$fenster' uebernommen. Zu diesem Fenster laeuft noch ein Arbeiter, deine Nachricht wartet darauf und wird danach gemeinsam mit allem anderen Offenen in EINEM Lauf bearbeitet - sie startet keinen zusaetzlichen Lauf." "$fenster"
    logz "[$fenster] Empfang gemeldet (wartet auf laufenden Arbeiter)"
  fi

  systemd-run --quiet --collect --unit "tony-$(echo "$fenster" | tr -c 'a-zA-Z0-9-' '-' | cut -c1-40)-$(date +%s%N | cut -c10-16)" \
    -p Environment=HOME=/root /opt/tony/waechter/bearbeite.sh "$fenster" "$datei"
done
