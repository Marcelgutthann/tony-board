#!/bin/bash
# Wiedervorlage-Prueflauf (ohne KI). Fragt das Board, welche Punkte aus "Bleibt im Blick" faellig
# sind, und laesst es Tony melden. Was gemeldet wird, entscheidet das Board selbst: nur faellige
# Punkte, die Tony noch nicht gemeldet bekommen hat (gemeldet_am), und Punkte ohne Prueftermin.
# Unveraenderte Punkte bleiben still, darum ist jeder Lauf unschaedlich und wiederholbar.
# Kein eigener Zustand, keine KI, ein HTTP-Aufruf je Lauf.
hier=${TONY_WAECHTER_DIR:-/opt/tony/waechter}
log=$hier/wiedervorlage.log

schluessel=$(grep '^TONY_BOARD_KEY=' "${TONY_BOARD_ENV:-/root/.claude/secrets/tony-board.env}" | cut -d= -f2-)
api=${TONY_BOARD_API:-"https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api/$schluessel"}

antwort=$(curl -sf --max-time 30 -X POST "$api/wiedervorlage") || {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  Prueflauf fehlgeschlagen" >> "$log"; exit 0; }

# Stille Laeufe nicht mitschreiben, damit im Log nur steht, was tatsaechlich gemeldet wurde
if [ "$(echo "$antwort" | jq -r '.gemeldet // 0')" != "0" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $antwort" >> "$log"
fi
