// Prüfstand fuer das Board ohne Zugangsschluessel und ohne Live-Daten zu veraendern:
//   node pruefstand.mjs <state.json> [port]
// Liefert docs/ aus, die Seite spricht mit einer Nachbildung der API (Zustand im Speicher).
// Tony nachspielen: POST /sim/{neu|update|dich}  ->  neues Fenster | Stand eines laufenden Fensters aendern | Fenster braucht dich
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const zustand = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const port = +(process.argv[3] || 5181);
const docs = fileURLToPath(new URL('./docs/', import.meta.url));
const typ = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.js': 'text/javascript' };
const jetzt = () => new Date().toISOString();
let nr = 0;

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const body = await new Promise((r) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const p = url.pathname;
  if (p.endsWith('/state')) return json(zustand);
  if (p.endsWith('/archivieren')) { const f = zustand.fenster.find((x) => x.id === body.id); if (f && !body.zurueck) { zustand.fenster = zustand.fenster.filter((x) => x !== f); if (f.status !== 'fertig') zustand.blick.push({ id: 900 + ++nr, text: `${f.titel}: nicht fertig (archiviert)`, bereich: f.bereich, fenster_id: f.id, quelle: 'archiviert', erstellt: jetzt() }); } return json({ ok: true }); }
  if (p.endsWith('/blick-erledigt')) { zustand.blick = zustand.blick.filter((b) => String(b.id) !== String(body.id)); return json({ ok: true }); }
  if (p.endsWith('/ansicht')) { if (body.ansicht) zustand.ansicht = body.ansicht; return json({ ok: true }); }
  if (p.endsWith('/eingabe')) return json({ ok: true });
  if (p === '/sim/neu') { zustand.fenster.push({ id: 'sim-' + ++nr, titel: 'Neue Aufgabe ' + nr, app: 'code', bereich: 'technik', status: 'arbeitet', kernaussage: 'Tony arbeitet', widgets: [], schritte: [], verlauf: [], kopf: {}, inhalt: '', geaendert: jetzt() }); return json({ ok: true }); }
  if (p === '/sim/update') { const f = zustand.fenster.find((x) => x.status === 'arbeitet'); f.kernaussage = 'Stand ' + ++nr; f.geaendert = jetzt(); return json({ ok: true, id: f.id }); }
  if (p === '/sim/dich') { const f = zustand.fenster.find((x) => x.id === url.searchParams.get('id')) || zustand.fenster.find((x) => x.status !== 'braucht_dich'); f.status = 'braucht_dich'; f.von_dir = 'Soll das so raus?'; f.geaendert = jetzt(); return json({ ok: true, id: f.id }); }
  let datei = join(docs, p === '/' ? 'index.html' : decodeURIComponent(p));
  if (!existsSync(datei)) { res.writeHead(404); return res.end(); }
  let inhalt = readFileSync(datei);
  if (datei.endsWith('index.html')) inhalt = inhalt.toString().replace(/const API = "[^"]+";/, `const API = "http://localhost:${port}/api/";`);
  res.writeHead(200, { 'content-type': typ[extname(datei)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(inhalt);
}).listen(port, () => console.log('Pruefstand auf', port));
