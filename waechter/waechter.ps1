# Tony-Board-Waechter: laeuft jede Minute (Windows-Aufgabenplanung).
# Schaut ohne KI nach, ob Tony an Claude geschrieben hat. Nur dann startet er claude -p.
$ErrorActionPreference = "Stop"
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $OutputEncoding
$hier = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $hier "waechter.log"
$sperre = Join-Path $hier "laeuft.lock"
$arbeitsordner = "C:\Users\m.gutthann\Desktop\NoraNotes.ai Claude"
$claude = "C:\Users\m.gutthann\.local\bin\claude.exe"

function Log($t) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) -Encoding UTF8 }

# Laeuft schon ein Durchgang (juenger als 30 Min.)? Dann nichts tun.
if ((Test-Path $sperre) -and ((Get-Date) - (Get-Item $sperre).LastWriteTime).TotalMinutes -lt 30) { exit 0 }

$schluessel = (Get-Content "$env:USERPROFILE\.claude\secrets\tony-board.env" | Where-Object { $_ -like "TONY_BOARD_KEY=*" }) -replace "^TONY_BOARD_KEY=", ""
$api = "https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api/$schluessel"

try { $offen = (Invoke-RestMethod -Uri "$api/fuer-claude" -TimeoutSec 20).offen } catch { Log "Abfrage fehlgeschlagen: $($_.Exception.Message)"; exit 0 }
if (-not $offen) { exit 0 }

New-Item -ItemType File -Path $sperre -Force | Out-Null
try {
  # Antwort selbst als UTF-8 lesen (PowerShell 5 raet sonst falsch und zerlegt Umlaute)
  $roh = Invoke-WebRequest -Method Post -Uri "$api/fuer-claude" -TimeoutSec 20 -UseBasicParsing
  $nachrichten = ([Text.Encoding]::UTF8.GetString($roh.RawContentStream.ToArray()) | ConvertFrom-Json).nachrichten
  $text = ($nachrichten | ForEach-Object { "[$($_.zeit)]$(if ($_.fenster_id) { " (Fenster $($_.fenster_id))" }) $($_.text)" }) -join "`n`n"
  Log "Tony hat geschrieben ($($nachrichten.Count)): $($text.Substring(0, [Math]::Min(200, $text.Length)))"

  $auftrag = @"
Du bist Claude, Marcels Coding-Agent auf seinem Laptop. Tony ist Marcels proaktiver ChatGPT-Agent (Dots, per Sprache auf dem iPad). Ihr teilt euch das Tony Board. Tony hat dir ueber das Board geschrieben:

$text

Arbeitsteilung: Tony macht Kommunikation (Mails, Kalender, Rueckfragen an Marcel). Du machst Code, App, Daten, Deploys auf staging, Tickets, Auswertungen.

So gehst du vor:
1. Wenn die Aufgabe in deinen Bereich faellt: erledige sie nach Marcels Regeln (CLAUDE.md, Gedaechtnis). Nie prod ausrollen, nie Mails senden, nie Geld bewegen, nichts loeschen ohne Marcel.
2. Wenn Marcel entscheiden muss: erledige alles bis dahin und schreib Tony genau die eine Frage, die er Marcel stellen soll.
3. Antworte Tony am Ende IMMER, kurz (hoechstens 6 Saetze), indem du dieses Kommando ausfuehrst (Text als JSON):
   curl -s -X POST "$api/an-tony" -H "content-type: application/json" --data-binary @antwort.json
   Schreib dazu vorher die Datei antwort.json im Ordner tony-board/waechter mit {"text": "...", "fenster_id": "..."} (fenster_id nur, wenn Tony eine genannt hat) und rufe curl in diesem Ordner auf.
Sag Tony, was erledigt ist und was er Marcel sagen oder fragen soll.
"@

  Push-Location $arbeitsordner
  $ausgabe = $auftrag | & $claude -p --permission-mode bypassPermissions 2>&1 | Out-String
  $code = $LASTEXITCODE
  Pop-Location
  Log "claude beendet (Code $code): $($ausgabe.Trim().Substring(0, [Math]::Min(300, $ausgabe.Trim().Length)))"
  if ($code -ne 0) {
    $fehler = @{ text = "Claude konnte deine Nachricht gerade nicht bearbeiten (Fehlercode $code). Bitte Marcel Bescheid geben." } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$api/an-tony" -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($fehler)) | Out-Null
  }
} catch {
  Log "Fehler: $($_.Exception.Message)"
} finally {
  Remove-Item $sperre -Force -ErrorAction SilentlyContinue
}
