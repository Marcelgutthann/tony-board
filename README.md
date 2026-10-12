# Tony Board

Live-Anzeige fuer Tonys Arbeit (ChatGPT-Agent). Die Seite zeigt nur etwas mit Zugangsschluessel (`#k=...`); Daten liegen in Supabase (Projekt Agentic OS, Tabellen `tony_board_*`), MCP-Connector = Edge Function `tony-board`.

## Statusdarstellung

Jede Karte traegt eine Statusleiste. Sie wird nicht aus dem `status` allein abgeleitet, sondern aus
`status`, `warten_auf`, `wartegrund`, `fehler` und `bestaetigt_am` - an genau einer Stelle (`lage()` in
`docs/index.html`). Marke, Statusleiste, Sitzungsleiste und Schrittauszeichnung lesen alle daraus, darum
koennen sie nicht auseinanderlaufen. Laufende Arbeit zeigt das Board nur mit einem bestaetigten Signal,
das juenger als 15 Minuten ist; sonst steht dort "Status nicht aktuell bestaetigt". Ein bestaetigtes
Signal entsteht nur, wenn Tony eine `taetigkeit` meldet - die blosse Aenderungszeit zaehlt nicht.

## Pruefen

```
node compat-test.mjs supabase/tony-board/index.ts                  # Schnittstelle, ohne Supabase
CHROME=<pfad-zu-chrome> node sidebar-test.mjs                      # Sitzungsleiste, Auswahl, Geraete
CHROME=<pfad-zu-chrome> node status-test.mjs [bilderordner]        # Statusleiste je Zustand + Verlauf
node pruefstand.mjs <state.json> [port]                            # Board von Hand anschauen
```

Auf dem Server: `ln -s /opt/tony/browser/node_modules node_modules` und
`CHROME=/opt/tony/browser/browsers/chromium-1246/chrome-linux64/chrome`.
