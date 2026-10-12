#!/bin/bash
# Tony-Board-Waechter (Server): laeuft jede Minute per systemd-Timer.
# Schaut ohne KI nach, ob Tony an Claude geschrieben hat, und verteilt die Post je Fenster
# an eigene Arbeiter (bearbeite.sh). Verschiedene Fenster laufen parallel, ein Fenster nacheinander.
hier=/opt/tony/waechter
log=$hier/waechter.log
logz() { echo "$(date '+%Y-%m-%d %H:%M:%S')  $1" >> "$log"; }

exec 9>"$hier/verteiler.lock"
flock -n 9 || exit 0

schluessel=$(grep '^TONY_BOARD_KEY=' /root/.claude/secrets/tony-board.env | cut -d= -f2-)
api="https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api/$schluessel"

offen=$(curl -sf --max-time 20 "$api/fuer-claude" | jq -r '.offen') || { logz "Abfrage fehlgeschlagen"; exit 0; }
[ "${offen:-0}" -gt 0 ] 2>/dev/null || exit 0

nachrichten=$(curl -sf --max-time 20 -X POST "$api/fuer-claude") || { logz "Abholen fehlgeschlagen"; exit 0; }
mkdir -p "$hier/post"
for fenster in $(echo "$nachrichten" | jq -r '.nachrichten | map(.fenster_id // "ohne-fenster") | unique | .[]'); do
  datei="$hier/post/$fenster.$(date +%s%N).txt"
  echo "$nachrichten" | jq -r --arg f "$fenster" '.nachrichten | map(select((.fenster_id // "ohne-fenster") == $f)) | map("[\(.zeit)] \(.text)") | join("\n\n")' > "$datei"
  logz "Post fuer $fenster: $(head -c 200 "$datei")"
  systemd-run --quiet --collect --unit "tony-$(echo "$fenster" | tr -c 'a-zA-Z0-9-' '-' | cut -c1-40)-$(date +%s%N | cut -c10-16)" \
    -p Environment=HOME=/root /opt/tony/waechter/bearbeite.sh "$fenster" "$datei"
done
