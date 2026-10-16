# Tony Board

Live-Anzeige fuer Tonys Arbeit (ChatGPT-Agent). Die Seite zeigt nur etwas mit Zugangsschluessel (`#k=...`); Daten liegen in Supabase (Projekt Agentic OS, Tabellen `tony_board_*`), MCP-Connector = Edge Function `tony-board`.

## Statusdarstellung

Jede Karte traegt eine Statusleiste. Sie wird nicht aus dem `status` allein abgeleitet, sondern aus
`status`, `warten_auf`, `wartegrund`, `fehler` und `bestaetigt_am` - an genau einer Stelle (`lage()` in
`docs/index.html`). Marke, Statusleiste, Sitzungsleiste und Schrittauszeichnung lesen alle daraus, darum
koennen sie nicht auseinanderlaufen. Laufende Arbeit zeigt das Board nur mit einem bestaetigten Signal,
das juenger als 15 Minuten ist; sonst steht dort "Status nicht aktuell bestaetigt". Ein bestaetigtes
Signal entsteht nur, wenn Tony eine `taetigkeit` meldet - die blosse Aenderungszeit zaehlt nicht.

## Bezug der Eingabe

Eine Nachricht im unteren Eingabefeld gehoert immer zu der Karte, die beim Schreiben vor Marcel
stand. Sobald er tippt, wird diese Karte festgehalten (`zielFest` in `docs/index.html`) und nicht
mehr gewechselt - auch dann nicht, wenn Tony den Fokus weiterdreht oder Marcel weiterblaettert.
Beim Absenden geht genau diese `fenster_id` mit und bleibt in `tony_board_eingang` stehen. Steht
keine Karte vorne (Archiv, Absprache), sagt die Zielanzeige das ausdruecklich und es geht
`fenster_id: null` mit; es wird nie eine Karte auf Verdacht zugeordnet. Beim Lesen liefert
`board_lesen` zu jeder Eingabe das Feld `bezug` mit Kartentitel und id.

## Bleibt im Blick = Wiedervorlage

Jeder Punkt fuehrt vier Dinge: den offenen Grund (`text`), den naechsten Prueftermin
(`nachfassen_am`), die zugehoerige Karte (`fenster_id`, Titel kommt als `karte_titel` mit) und den
Stand der letzten Pruefung (`pruefstand`, `geprueft_am`). Faelliges steht oben und ist als
ueberfaellig oder heute faellig benannt; ein Punkt ohne Termin wird als "Prueftermin fehlt"
gezeigt, weil er sonst nie faellig wird. Tony haelt eine Pruefung mit `im_blick_geprueft` fest
(Stand + neuer Termin) und hakt mit `im_blick_erledigt` ab.

Der Prueflauf `POST /api/<schluessel>/wiedervorlage` laeuft alle 10 Minuten und meldet Tony nach
zwei Regeln (`gemeldet_am`):

* **Mit Prueftermin:** ist der Punkt faellig, erinnert er hoechstens einmal je
  `WV_ERINNERUNG_STD` (24 h), solange er faellig bleibt.
* **Ohne Prueftermin:** genau eine Meldung zur Sichtung ("kein Prueftermin gesetzt"), danach nie
  wieder. Unsichtbar wird der Punkt dadurch nicht - `board_lesen` nennt ihn bei jedem Lesen im Feld
  `wiedervorlage`, und das Board zeigt ihn als "Prueftermin fehlt".

Ein geaenderter Grund, ein neuer Termin oder eine Pruefung setzen `gemeldet_am` zurueck; der Punkt
ist damit wieder meldbar. Der Prueflauf braucht keine KI und keinen Zustand; der Timer dazu liegt
in `waechter/server/` und laeuft seit dem 16.10.2026 auf dem Server
(`tony-wiedervorlage.timer`, alle 10 Minuten).

## Pruefen

```
node compat-test.mjs supabase/tony-board/index.ts                  # Schnittstelle, ohne Supabase
node wiedervorlage-test.mjs supabase/tony-board/index.ts           # Wiedervorlage, Prueflauf, Kartenbezug
CHROME=<pfad-zu-chrome> node eingabe-test.mjs                      # Bezug der Eingabe + Wiedervorlage-Liste
CHROME=<pfad-zu-chrome> node sidebar-test.mjs                      # Sitzungsleiste, Auswahl, Geraete
CHROME=<pfad-zu-chrome> node status-test.mjs [bilderordner]        # Statusleiste je Zustand + Verlauf
node pruefstand.mjs <state.json> [port]                            # Board von Hand anschauen
```

Auf dem Server: `ln -s /opt/tony/browser/node_modules node_modules` und
`CHROME=/opt/tony/browser/browsers/chromium-1246/chrome-linux64/chrome`.
