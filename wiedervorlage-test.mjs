// Prueft die Wiedervorlage ("Bleibt im Blick") ohne Supabase: node wiedervorlage-test.mjs supabase/tony-board/index.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
let src = fs.readFileSync(process.argv[2], "utf8");
src = src.replace(/^import \{ createClient \}.*$/m, "const createClient = () => globalThis.__db;");
src = src.replace(/Deno\.serve\(/, "(()=>{})(");
src += "\nexport { werkzeug, wiedervorlageMelden, zustandLesen };\n";
// Fake-DB: fuenf Tabellen im Speicher, nur so viel Supabase wie der Code wirklich aufruft.
// Fehlende Spalten lesen sich als null, insert vergibt eine aufsteigende id.
const tab = {
  tony_board_fenster: [],
  tony_board_blick: [],
  tony_board_eingang: [],
  tony_board_absprache: [],
  tony_board_zustand: [{ id: 1, schluessel: "x", fokus: null, ansicht: "rondell" }],
};
const LEERZEILE = {
  tony_board_blick: { text: null, wer: null, bereich: null, fenster_id: null, nachfassen_am: null, pruefstand: null, geprueft_am: null, gemeldet_am: null, erledigt_am: null, quelle: null },
  tony_board_absprache: { von: null, text: null, fenster_id: null, gelesen: null },
  tony_board_eingang: { fenster_id: null, art: null, text: null, gelesen: null },
};
let laufendeId = 0;
const nimm = (r, sp) => sp === "*" ? { ...r } : Object.fromEntries(sp.split(",").map((k) => k.trim()).map((k) => [k, r[k] ?? null]));
const vergleich = (a, b) => typeof a === "number" && typeof b === "number" ? a - b : String(a ?? "").localeCompare(String(b ?? ""));
const q = (name) => { const s = {
  op: "select", sp: "*", werte: null, pruef: [], sortier: null, grenze: null,
  select(sp = "*"){ if (typeof sp === "string") s.sp = sp; return s; },
  eq(k, v){ s.pruef.push((r) => r[k] === v); return s; },
  is(k){ s.pruef.push((r) => r[k] === null || r[k] === undefined); return s; },
  in(k, l){ s.pruef.push((r) => l.includes(r[k])); return s; },
  or(){ return s; },
  order(k, o){ s.sortier = [k, o?.ascending !== false]; return s; },
  limit(n){ s.grenze = n; return s; },
  insert(r){ s.op = "insert"; s.werte = r; return s; },
  update(r){ s.op = "update"; s.werte = r; return s; },
  async lauf(){
    if (s.op === "insert") {
      const zeile = { ...(LEERZEILE[name] ?? {}), id: ++laufendeId, erstellt: new Date().toISOString(), ...s.werte };
      tab[name].push(zeile);
      return { data: nimm(zeile, s.sp), error: null };
    }
    let zeilen = tab[name].filter((r) => s.pruef.every((p) => p(r)));
    if (s.op === "update") for (const r of zeilen) Object.assign(r, s.werte);
    else if (s.sortier) zeilen = [...zeilen].sort((a, b) => (s.sortier[1] ? 1 : -1) * vergleich(a[s.sortier[0]], b[s.sortier[0]]));
    if (s.grenze !== null) zeilen = zeilen.slice(0, s.grenze);
    return { data: zeilen.map((r) => nimm(r, s.sp)), error: null };
  },
  async einzel(pflicht){ const { data } = await s.lauf();
    const eine = Array.isArray(data) ? (data[0] ?? null) : data;
    return { data: eine, error: pflicht && !eine ? { message: `keine Zeile in ${name}` } : null }; },
  single(){ return s.einzel(true); }, maybeSingle(){ return s.einzel(false); },
  then(res, rej){ return s.lauf().then(res, rej); } }; return s; };
globalThis.__db = { from: q };
globalThis.Deno = { env: { get: () => "x" }, serve(){} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tbwv-"));
fs.writeFileSync(path.join(tmp, "fn.ts"), src);
const { werkzeug, wiedervorlageMelden, zustandLesen } = await import(pathToFileURL(path.join(tmp, "fn.ts")).href);
let ok = 0, nok = 0; const t = async (name, fn) => { try { await fn(); console.log("OK  ", name); ok++; } catch (e) { console.log("FAIL", name, e.message); nok++; } };
const wirft = async (p) => { try { await p; } catch { return; } throw new Error("haette werfen muessen"); };
const wirftMit = async (p, teil) => { try { await p; } catch (e) {
  if (!String(e.message).includes(teil)) throw new Error(`Meldung nennt '${teil}' nicht: ${e.message}`); return; } throw new Error("haette werfen muessen"); };
// Zeitrechnung wie im Code: Tagesgrenze in Europe/Berlin
const heute = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
const tag = (n) => new Date(Date.parse(heute) + n * 864e5).toISOString().slice(0, 10);
const gestern = tag(-1), morgen = tag(1);
const karte = (id, titel, extra = {}) => tab.tony_board_fenster.push({ id, titel, status: "fertig", bereich: "organisation",
  kernaussage: null, app: "notiz", geschlossen: false, erstellt: new Date().toISOString(), geaendert: new Date().toISOString(), ...extra });
const punkt = (id) => tab.tony_board_blick.find((b) => b.id === id);
const leeren = () => { tab.tony_board_blick.length = 0; tab.tony_board_absprache.length = 0; tab.tony_board_eingang.length = 0; };
const wvZeilen = () => tab.tony_board_absprache.filter((m) => m.von === "claude" && String(m.text).startsWith("[Wiedervorlage]"));

// --- Punkt anlegen und aktualisieren ---
karte("k1", "Mail an Arends");
let id1, id2;
await t("ohne nachfassen_am wird der Punkt angelegt, aber der fehlende Prueftermin benannt", async () => {
  const r = await werkzeug("im_blick_behalten", { text: "Antwort auf Terminvorschlag abwarten", fenster_id: "k1" });
  id1 = r.id;
  if (!punkt(id1)) throw new Error("Punkt nicht angelegt");
  if (punkt(id1).nachfassen_am !== null) throw new Error("Termin erfunden: " + punkt(id1).nachfassen_am);
  if (!String(r.hinweis ?? "").includes("nachfassen_am")) throw new Error("kein Hinweis: " + r.hinweis);
});
karte("k2", "Angebot Huber");
await t("nachfassen_am und pruefstand werden gespeichert, ohne Hinweis", async () => {
  const r = await werkzeug("im_blick_behalten", { text: "Zusage abwarten", fenster_id: "k2", nachfassen_am: morgen, pruefstand: "Angebot ist raus." });
  id2 = r.id;
  const b = punkt(id2);
  if (b.nachfassen_am !== morgen) throw new Error("Termin nicht gespeichert: " + b.nachfassen_am);
  if (b.pruefstand !== "Angebot ist raus.") throw new Error("pruefstand nicht gespeichert: " + b.pruefstand);
  if (r.hinweis) throw new Error("ungefragter Hinweis: " + r.hinweis);
});
await t("gleiche fenster_id und offener Punkt: Aktualisierung statt zweitem Punkt", async () => {
  const r = await werkzeug("im_blick_behalten", { text: "Zusage abwarten, Frist laeuft", fenster_id: "k2", nachfassen_am: morgen });
  if (r.id !== id2) throw new Error("neue id: " + r.id);
  if (tab.tony_board_blick.filter((b) => b.fenster_id === "k2" && !b.erledigt_am).length !== 1) throw new Error("zweiter Punkt angelegt");
  if (punkt(id2).text !== "Zusage abwarten, Frist laeuft") throw new Error("Text nicht aktualisiert");
});
await t("geaenderter text setzt gemeldet_am zurueck", async () => {
  punkt(id2).gemeldet_am = new Date().toISOString();
  await werkzeug("im_blick_behalten", { text: "Zusage abwarten, zweite Mahnung", fenster_id: "k2", nachfassen_am: morgen });
  if (punkt(id2).gemeldet_am !== null) throw new Error("bleibt als gemeldet stehen");
});
await t("neuer nachfassen_am setzt gemeldet_am zurueck", async () => {
  punkt(id2).gemeldet_am = new Date().toISOString();
  await werkzeug("im_blick_behalten", { text: "Zusage abwarten, zweite Mahnung", fenster_id: "k2", nachfassen_am: tag(3) });
  if (punkt(id2).gemeldet_am !== null) throw new Error("bleibt als gemeldet stehen");
});
await t("Aktualisierung ohne neue Information meldet nicht erneut", async () => {
  const marke = new Date().toISOString();
  punkt(id2).gemeldet_am = marke;
  await werkzeug("im_blick_behalten", { text: "Zusage abwarten, zweite Mahnung", fenster_id: "k2", nachfassen_am: tag(3) });
  if (punkt(id2).gemeldet_am !== marke) throw new Error("ohne Not neu gemeldet");
});

// --- Pruefung festhalten ---
await t("im_blick_geprueft setzt Stand, verschiebt den Termin und macht den Punkt wieder meldbar", async () => {
  const r = await werkzeug("im_blick_geprueft", { id: id2, pruefstand: "Noch keine Antwort.", nachfassen_am: tag(5) });
  const b = punkt(id2);
  if (b.pruefstand !== "Noch keine Antwort." || !b.geprueft_am) throw new Error("Stand nicht festgehalten");
  if (b.nachfassen_am !== tag(5)) throw new Error("Termin nicht verschoben: " + b.nachfassen_am);
  if (b.gemeldet_am !== null) throw new Error("gemeldet_am nicht zurueckgesetzt");
  if (r.hinweis) throw new Error("ungefragter Hinweis: " + r.hinweis);
});
await t("im_blick_geprueft ohne pruefstand wirft", () => wirft(werkzeug("im_blick_geprueft", { id: id2 })));
await t("im_blick_geprueft auf einen erledigten Punkt wirft und nennt die id", async () => {
  await werkzeug("im_blick_erledigt", { id: id1 });
  await wirftMit(werkzeug("im_blick_geprueft", { id: id1, pruefstand: "Nachgesehen." }), String(id1));
});
await t("im_blick_geprueft auf eine unbekannte id wirft und nennt die id", () =>
  wirftMit(werkzeug("im_blick_geprueft", { id: 9999, pruefstand: "Nachgesehen." }), "9999"));

// --- Prueflauf: nur neu Faelliges wird gemeldet ---
let id3;
await t("faelliger Punkt wird genau einmal gemeldet, mit id, Kartentitel und Prueftermin", async () => {
  leeren();
  karte("k3", "Terminvorschlag Arends");
  id3 = (await werkzeug("im_blick_behalten", { text: "Antwort auf Terminvorschlag abwarten", wer: "Christian Arends", fenster_id: "k3", nachfassen_am: gestern })).id;
  const r = await wiedervorlageMelden();
  if (r.faellig !== 1 || r.gemeldet !== 1) throw new Error("Zaehler falsch: " + JSON.stringify(r));
  if (wvZeilen().length !== 1) throw new Error("Zeilen in absprache: " + wvZeilen().length);
  const m = wvZeilen()[0];
  if (m.von !== "claude") throw new Error("von: " + m.von);
  for (const teil of ["[Wiedervorlage]", `#${id3}`, "Terminvorschlag Arends", gestern]) {
    if (!String(m.text).includes(teil)) throw new Error("Text ohne '" + teil + "'");
  }
  if (!punkt(id3).gemeldet_am) throw new Error("gemeldet_am nicht gesetzt");
});
await t("zweiter Lauf direkt danach ist still", async () => {
  const r = await wiedervorlageMelden();
  if (r.gemeldet !== 0) throw new Error("erneut gemeldet: " + JSON.stringify(r));
  if (wvZeilen().length !== 1) throw new Error("zweite Zeile angelegt");
});
await t("nach im_blick_geprueft mit Termin in der Zukunft bleibt der Punkt still", async () => {
  await werkzeug("im_blick_geprueft", { id: id3, pruefstand: "Noch keine Antwort, erneut nachgefasst.", nachfassen_am: morgen });
  const r = await wiedervorlageMelden();
  if (r.faellig !== 0 || r.gemeldet !== 0) throw new Error("wieder faellig: " + JSON.stringify(r));
  if (wvZeilen().length !== 1) throw new Error("zweite Zeile angelegt");
});
await t("Punkt mit Termin in der Zukunft wird nie gemeldet", async () => {
  leeren();
  karte("k4", "Angebot Meier");
  await werkzeug("im_blick_behalten", { text: "Zusage abwarten", fenster_id: "k4", nachfassen_am: morgen });
  const r = await wiedervorlageMelden();
  if (r.faellig !== 0 || r.gemeldet !== 0 || wvZeilen().length) throw new Error("trotzdem gemeldet: " + JSON.stringify(r));
});
await t("Punkt ohne Prueftermin wird genau einmal gemeldet, mit diesem Grund", async () => {
  leeren();
  karte("k5", "Rueckruf Bauamt");
  await werkzeug("im_blick_behalten", { text: "Rueckruf offen", fenster_id: "k5" });
  const r1 = await wiedervorlageMelden();
  if (r1.ohne_prueftermin !== 1 || r1.gemeldet !== 1) throw new Error("nicht gemeldet: " + JSON.stringify(r1));
  if (!String(wvZeilen()[0].text).includes("kein Prueftermin gesetzt")) throw new Error("Grund fehlt im Text");
  const r2 = await wiedervorlageMelden();
  if (r2.gemeldet !== 0 || wvZeilen().length !== 1) throw new Error("zweite Meldung: " + JSON.stringify(r2));
});
await t("erledigter Punkt taucht nirgends mehr auf", async () => {
  leeren();
  karte("k6", "Altes Thema");
  const id = (await werkzeug("im_blick_behalten", { text: "Alt und faellig", fenster_id: "k6", nachfassen_am: gestern })).id;
  await werkzeug("im_blick_erledigt", { id });
  const r = await wiedervorlageMelden();
  if (r.offen !== 0 || r.faellig !== 0 || r.gemeldet !== 0 || wvZeilen().length) throw new Error("erledigt zaehlt noch: " + JSON.stringify(r));
  if ((await zustandLesen()).blick.length) throw new Error("steht noch im Zustand");
});

// --- Archivieren ist Wiedervorlage, kein Archiv ---
await t("unfertig archiviertes Fenster wird ein sofort faelliger Punkt", async () => {
  leeren();
  karte("k7", "Umbau Pfatter", { status: "arbeitet", kernaussage: "**Statik** fehlt noch" });
  await werkzeug("fenster_schliessen", { id: "k7" });
  const b = tab.tony_board_blick.find((x) => x.fenster_id === "k7");
  if (!b) throw new Error("kein Wiedervorlage-Punkt angelegt");
  if (b.nachfassen_am !== heute) throw new Error("nicht sofort faellig: " + b.nachfassen_am);
  if (!String(b.text).includes("Umbau Pfatter")) throw new Error("Text ohne Kartentitel: " + b.text);
  if (!tab.tony_board_fenster.find((f) => f.id === "k7").geschlossen) throw new Error("Fenster nicht archiviert");
});

// --- board_lesen: Bezug der Eingaben und Reihenfolge der Wiedervorlage ---
await t("board_lesen: jede Eingabe nennt Kartentitel und id, auch bei archivierter Karte", async () => {
  leeren();
  karte("k8", "Offene Karte");
  karte("k9", "Archivierte Karte", { geschlossen: true });
  const jetzt = new Date().toISOString();
  for (const [id, fenster_id, text] of [[101, "k8", "a"], [102, "k9", "b"], [103, null, "c"], [104, "gibtsnicht", "d"]]) {
    tab.tony_board_eingang.push({ id, fenster_id, art: "nachricht", text, gelesen: null, erstellt: jetzt });
  }
  const r = await werkzeug("board_lesen", {});
  const bezug = Object.fromEntries(r.neue_eingaben_von_marcel.map((e) => [e.text, String(e.bezug ?? "")]));
  if (!bezug.a?.includes("Offene Karte") || !bezug.a.includes("k8")) throw new Error("offene Karte: " + bezug.a);
  if (!bezug.b?.includes("Archivierte Karte") || !bezug.b.includes("k9")) throw new Error("archivierte Karte: " + bezug.b);
  if (!bezug.c?.includes("ohne Karte")) throw new Error("ohne Karte: " + bezug.c);
  if (!bezug.d?.includes("Karte nicht gefunden")) throw new Error("unbekannte id: " + bezug.d);
  if (/Offene Karte|Archivierte Karte/.test(bezug.d)) throw new Error("fremder Karte zugeordnet: " + bezug.d);
});
await t("board_lesen: Faelliges zuerst, mit tage_ueberfaellig und Hinweis auf im_blick_geprueft", async () => {
  leeren();
  karte("k10", "Spaeter dran");
  karte("k11", "Zusage offen");
  karte("k12", "Laengst ueberfaellig");
  await werkzeug("im_blick_behalten", { text: "erst naechste Woche pruefen", fenster_id: "k10", nachfassen_am: tag(4) });
  await werkzeug("im_blick_behalten", { text: "Zusage einholen", fenster_id: "k11", nachfassen_am: gestern });
  await werkzeug("im_blick_behalten", { text: "Rechnung anmahnen", fenster_id: "k12", nachfassen_am: tag(-3) });
  const r = await werkzeug("board_lesen", {});
  if (r.bleibt_im_blick.length !== 3) throw new Error("Anzahl: " + r.bleibt_im_blick.length);
  const reihe = r.bleibt_im_blick.map((b) => b.fenster_id).join(",");
  if (reihe !== "k12,k11,k10") throw new Error("Reihenfolge: " + reihe);
  const erste = r.bleibt_im_blick[0];
  if (erste.faellig !== true) throw new Error("Faelliges nicht als faellig gezeigt");
  if (erste.tage_ueberfaellig !== 3) throw new Error("tage_ueberfaellig: " + erste.tage_ueberfaellig);
  if (r.bleibt_im_blick[2].faellig !== false) throw new Error("Spaeteres als faellig gezeigt");
  if (!String(r.wiedervorlage ?? "").includes("im_blick_geprueft")) throw new Error("kein Hinweis: " + r.wiedervorlage);
});
console.log(`${ok}/${ok+nok}`); process.exit(nok ? 1 : 0);
