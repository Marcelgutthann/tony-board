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

---

## Wiedervorlage-Prueflauf (vorgeschlagen, **nicht installiert**)

| Datei hier | wuerde auf dem Server liegen unter |
|---|---|
| `wiedervorlage.sh` | `/opt/tony/waechter/wiedervorlage.sh` |
| `tony-wiedervorlage.service` | `/etc/systemd/system/tony-wiedervorlage.service` |
| `tony-wiedervorlage.timer` | `/etc/systemd/system/tony-wiedervorlage.timer` |

**Mechanik.** Ein `oneshot`-Dienst, den ein Timer alle 10 Minuten startet. Er macht genau einen
HTTP-Aufruf: `POST /api/<schluessel>/wiedervorlage`. Die Entscheidung, ob gemeldet wird, trifft das
Board selbst — gemeldet wird nur, was dran ist (`nachfassen_am <= heute` oder gar kein Prueftermin)
**und** seit der letzten Meldung ueber einen Tag her ist (`gemeldet_am`). Ein geaenderter Grund, ein
neuer Termin oder eine neue Pruefung setzen `gemeldet_am` zurueck, sodass der Punkt sofort wieder
dran ist. Innerhalb eines Tages bleibt derselbe Punkt still: der Lauf schreibt dann nichts, nicht
einmal ins Log. Ein Punkt ohne Prueftermin steht taeglich wieder in der Meldung, bis ein Termin
gesetzt ist - er verstummt nicht. Kein
eigener Zustand, keine KI, kein Schreibzugriff ausserhalb der Boardtabellen.

**Was er nicht tut.** Keine Mails, keine Discord-Nachrichten, keine Mail-/Discordueberwachung,
keine Deploys, keine neuen Zugangsdaten, keine erweiterten Rechte. Er nutzt denselben
Board-Schluessel aus `/root/.claude/secrets/tony-board.env`, den der Waechter schon liest. Der
laufende Waechter (`tony-waechter.service`) wird nicht angefasst; beide Dienste sind unabhaengig.

**Kosten.** 144 Edge-Function-Aufrufe am Tag (etwa 4.400 im Monat) im schon vorhandenen
Supabase-Projekt, dazu je Lauf eine kleine Abfrage. Keine zusaetzliche Rechnung, kein KI-Token.

**Aktivierung (erst nach Freigabe).**

```
cp waechter/server/wiedervorlage.sh /opt/tony/waechter/wiedervorlage.sh
chmod +x /opt/tony/waechter/wiedervorlage.sh
cp waechter/server/tony-wiedervorlage.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now tony-wiedervorlage.timer
```

Probelauf ohne Timer: `/opt/tony/waechter/wiedervorlage.sh` von Hand aufrufen — der erste Lauf
meldet alles Faellige, jeder weitere ist still. Rueckbau: `systemctl disable --now
tony-wiedervorlage.timer`, Unit-Dateien loeschen. Es bleibt nichts zurueck ausser den schon
gesetzten `gemeldet_am`-Zeitstempeln.

**Ohne Aktivierung geht trotzdem nichts verloren:** Faelliges steht bei jedem `board_lesen` im Feld
`wiedervorlage` und auf dem Board selbst oben in "Bleibt im Blick". Der Timer macht daraus nur eine
Meldung, auf die Tony nicht warten muss.
