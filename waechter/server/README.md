# Waechter auf dem Server (produktiv)

Diese drei Dateien sind wortgetreue Kopien des **tatsaechlich laufenden** Standes auf Marcels
Hetzner-Server, abgelegt am 12.10.2026 zur Pruefung. Sie enthalten keine Geheimnisse: der
Board-Schluessel wird zur Laufzeit aus `/root/.claude/secrets/tony-board.env` gelesen.

| Datei hier | laeuft auf dem Server unter |
|---|---|
| `waechter.sh` | `/opt/tony/waechter/waechter.sh` |
| `bearbeite.sh` | `/opt/tony/waechter/bearbeite.sh` |
| `tony-waechter.service` | `/etc/systemd/system/tony-waechter.service` |

**Achtung:** `../waechter.ps1` und `../start-versteckt.vbs` im Ordner darueber sind die **alte
Fassung fuer Marcels Windows-Laptop**. Auf dem Server existieren sie nicht und werden dort nicht
ausgefuehrt. Wer das Aktivierungsverhalten des Servers beurteilen will, liest die Dateien in
diesem Ordner.

Diese Kopien laufen nicht: der Dienst startet aus `/opt/tony/waechter/`. Eine Aenderung hier
veraendert das Serververhalten nicht.
