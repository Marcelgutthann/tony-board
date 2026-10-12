// Prueft die Werkzeugschicht der Edge Function ohne Supabase: node compat-test.mjs supabase/tony-board/index.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
let src = fs.readFileSync(process.argv[2], "utf8");
src = src.replace(/^import \{ createClient \}.*$/m, "const createClient = () => globalThis.__db;");
src = src.replace(/Deno\.serve\(/, "(()=>{})(");
src += "\nexport { werkzeug };\n";
// Fake-DB: eine Tabelle Fenster im Speicher
const fenster = new Map();
const q = (tab) => { const s = { tab, f: null, op: "select", row: null,
  select(){ return s; }, eq(k,v){ s.f=[k,v]; return s; }, update(r){ s.op="update"; s.row=r; return s; },
  insert(r){ s.op="insert"; s.row=r; return s.run(); }, upsert(r){ return Promise.resolve({error:null}); },
  async run(){ if (s.tab!=="tony_board_fenster") return {data:{}, error:null};
    if (s.op==="insert"){ fenster.set(s.row.id,{...s.row}); return {error:null}; }
    if (s.op==="update"){ fenster.set(s.f[1],{...fenster.get(s.f[1]),...s.row}); return {error:null}; }
    return {data: fenster.get(s.f?.[1]) ?? null, error:null}; },
  maybeSingle(){ return s.run(); }, single(){ return s.run(); }, then(r,j){ return s.run().then(r,j); } }; return s; };
globalThis.__db = { from: q };
globalThis.Deno = { env: { get: () => "x" }, serve(){} };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tbcompat-"));
fs.writeFileSync(path.join(tmp, "fn.ts"), src);
import { pathToFileURL } from "node:url"; const { werkzeug } = await import(pathToFileURL(path.join(tmp, "fn.ts")).href);
let ok = 0, nok = 0; const t = async (name, fn) => { try { await fn(); console.log("OK  ", name); ok++; } catch (e) { console.log("FAIL", name, e.message); nok++; } };
const wirft = async (p) => { try { await p; } catch { return; } throw new Error("haette werfen muessen"); };
await t("altes Format: braucht_dich + Frage in hinweis, ohne von_dir (neues Fenster)", async () => {
  await werkzeug("fenster_zeigen", { id: "alt1", titel: "Alt", status: "braucht_dich", hinweis: "Soll der Umbau heute live gehen?" });
  if (fenster.get("alt1").von_dir !== "Soll der Umbau heute live gehen?") throw new Error("von_dir nicht aus hinweis uebernommen");
});
await t("altes Format: bestehendes Fenster auf braucht_dich mit Frage in hinweis", async () => {
  await werkzeug("fenster_zeigen", { id: "alt2", titel: "Alt2", status: "arbeitet", hinweis: "Ich lese Mails." });
  await werkzeug("fenster_zeigen", { id: "alt2", status: "braucht_dich", hinweis: "Darf ich Herrn Maier absagen?" });
  if (fenster.get("alt2").status !== "braucht_dich") throw new Error("status nicht gesetzt");
});
await t("neues Format: von_dir gesetzt, hinweis anders -> von_dir bleibt", async () => {
  await werkzeug("fenster_zeigen", { id: "neu1", status: "braucht_dich", von_dir: "Soll ich das Angebot annehmen?", hinweis: "Ich warte auf dich." });
  if (fenster.get("neu1").von_dir !== "Soll ich das Angebot annehmen?") throw new Error("von_dir ueberschrieben");
});
await t("braucht_dich ganz ohne Frage wird weiter abgelehnt", () => wirft(werkzeug("fenster_zeigen", { id: "leer1", status: "braucht_dich" })));
await t("Freigabe-Fenster ohne Frage bleibt erlaubt", async () => {
  await werkzeug("fenster_zeigen", { id: "fg1", titel: "Mail", inhalt: "x" });
  fenster.get("fg1").freigabe = "angefragt";
  await werkzeug("fenster_zeigen", { id: "fg1", status: "braucht_dich" });
});

// --- Statusfelder: Taetigkeit, Wartegrund, bestaetigtes Signal ---
await t("braucht_dich setzt warten_auf marcel", async () => {
  if (fenster.get("neu1").warten_auf !== "marcel") throw new Error("warten_auf fehlt: " + fenster.get("neu1").warten_auf);
});
await t("wartet ohne Wartegrund: alter Client wird angenommen, neuer abgelehnt", async () => {
  await werkzeug("fenster_zeigen", { id: "w1", titel: "Build", status: "wartet" });
  if (fenster.get("w1").status !== "wartet") throw new Error("alter Client faelschlich abgelehnt");
  await wirft(werkzeug("fenster_zeigen", { id: "w1b", titel: "Build", status: "wartet", zustaendig: "Claude" }));
});
await t("wartet nur mit Art, ohne Grund, wird abgelehnt", () =>
  wirft(werkzeug("fenster_zeigen", { id: "w2", titel: "Build", status: "wartet", warten_auf: "extern" })));
await t("wartet mit erfundener Art wird abgelehnt", () =>
  wirft(werkzeug("fenster_zeigen", { id: "w3", titel: "Build", status: "wartet", warten_auf: "wetter", wartegrund: "Der Build laeuft noch durch." })));
await t("wartet auf externen Job wird gespeichert", async () => {
  await werkzeug("fenster_zeigen", { id: "w4", titel: "CI", status: "wartet", warten_auf: "extern", wartegrund: "GitHub-Lauf 1148 muss durchlaufen, bricht bisher vor dem ersten Schritt ab.", naechste_aktion: "Ergebnis lesen und Regression pruefen." });
  const f = fenster.get("w4");
  if (f.warten_auf !== "extern" || !f.wartegrund.startsWith("GitHub-Lauf")) throw new Error("Felder nicht gespeichert");
});
await t("wartet auf Person und auf Zugang sind unterscheidbar", async () => {
  await werkzeug("fenster_zeigen", { id: "w5", titel: "AVV", status: "wartet", warten_auf: "marcel", wartegrund: "Marcel muss die Fassung 1.7 gegenlesen." });
  await werkzeug("fenster_zeigen", { id: "w6", titel: "Store", status: "wartet", warten_auf: "zugang", wartegrund: "Apple-Entwicklerkonto fehlt, nur Marcel kann es freigeben." });
  if (fenster.get("w5").warten_auf !== "marcel" || fenster.get("w6").warten_auf !== "zugang") throw new Error("Wartearten vermischt");
});
await t("altes wartet-Fenster ohne Grund bleibt aktualisierbar", async () => {
  fenster.set("w7", { id: "w7", titel: "Alt", status: "wartet", hinweis: "Wartet auf Antwort." });
  await werkzeug("fenster_zeigen", { id: "w7", kernaussage: "Stand neu" });
  if (fenster.get("w7").kernaussage !== "Stand neu") throw new Error("Aktualisierung blockiert");
});
await t("Wartegrund aus dem Fenster zaehlt beim erneuten Setzen von wartet", async () => {
  await werkzeug("fenster_zeigen", { id: "w4", status: "wartet" });
  if (fenster.get("w4").status !== "wartet") throw new Error("eigener Grund nicht anerkannt");
});
await t("taetigkeit ist das bestaetigte Signal: bestaetigt_am wird gesetzt", async () => {
  await werkzeug("fenster_zeigen", { id: "b1", titel: "Code", status: "arbeitet", taetigkeit: "Regressionstest fuer den PDF-Export geschrieben." });
  const f = fenster.get("b1");
  if (!f.bestaetigt_am || Date.now() - Date.parse(f.bestaetigt_am) > 5000) throw new Error("bestaetigt_am fehlt");
});
await t("arbeitet ohne taetigkeit setzt kein Signal und warnt", async () => {
  const r = await werkzeug("fenster_zeigen", { id: "b2", titel: "Code", status: "arbeitet" });
  if (fenster.get("b2").bestaetigt_am) throw new Error("Signal erfunden");
  if (!String(r.hinweis ?? "").includes("nicht aktuell bestaetigt")) throw new Error("kein Hinweis: " + r.hinweis);
});
await t("mitgegebenes bestaetigt_am gilt, Unsinn wird verworfen", async () => {
  await werkzeug("fenster_zeigen", { id: "b3", titel: "X", bestaetigt_am: "2026-10-12T10:00:00Z" });
  if (fenster.get("b3").bestaetigt_am !== "2026-10-12T10:00:00Z") throw new Error("Zeit verworfen");
  await werkzeug("fenster_zeigen", { id: "b3", bestaetigt_am: "neulich" });
  if (fenster.get("b3").bestaetigt_am !== "2026-10-12T10:00:00Z") throw new Error("Unsinn uebernommen");
});
await t("fehler setzen und wieder loeschen", async () => {
  await werkzeug("fenster_zeigen", { id: "e1", titel: "CI", status: "arbeitet", taetigkeit: "Lauf gestartet.", fehler: "Lauf bricht mit Abrechnungsfehler ab." });
  if (!fenster.get("e1").fehler) throw new Error("fehler nicht gesetzt");
  await werkzeug("fenster_zeigen", { id: "e1", fehler: "" });
  if (fenster.get("e1").fehler !== null) throw new Error("fehler nicht geloescht");
});
await t("Freigabe durch Marcel traegt Taetigkeit und Signal nach", async () => {
  // dieselbe Wirkung wie der Knopf im Board (Pfad /eingabe)
  await werkzeug("fenster_zeigen", { id: "f2", titel: "Mail", inhalt: "x" });
  await werkzeug("freigabe_anfragen", { id: "f2", frage: "Darf die Mail so raus?" });
  const f = fenster.get("f2");
  if (f.von_dir !== "Darf die Mail so raus?" || f.warten_auf !== "marcel") throw new Error("Freigabefrage nicht in von_dir/warten_auf");
});

// --- Altes Werkzeugschema (Tools in ChatGPT noch nicht aktualisiert) darf nicht scheitern ---
await t("alter Client: wartet ohne neue Felder wird angenommen, Grund aus hinweis", async () => {
  const r = await werkzeug("fenster_zeigen", { id: "ac1", titel: "CI", status: "wartet", hinweis: "Kein Job laeuft mehr, die Blockermeldung wird geprueft." });
  const f = fenster.get("ac1");
  if (f.status !== "wartet") throw new Error("status nicht gesetzt");
  if (f.wartegrund !== "Kein Job laeuft mehr, die Blockermeldung wird geprueft.") throw new Error("hinweis nicht als Wartegrund uebernommen");
  if (f.warten_auf) throw new Error("Warteart erfunden: " + f.warten_auf);
  if (!String(r.hinweis ?? "").includes("Tools aktualisieren")) throw new Error("kein Hinweis auf das Schema: " + r.hinweis);
});
await t("alter Client: wartet ganz ohne Text wird angenommen, aber benannt", async () => {
  const r = await werkzeug("fenster_zeigen", { id: "ac2", titel: "X", status: "wartet" });
  if (fenster.get("ac2").status !== "wartet") throw new Error("status nicht gesetzt");
  if (!String(r.hinweis ?? "").includes("unbestimmtes")) throw new Error("kein Hinweis: " + r.hinweis);
});
await t("neuer Client bleibt streng: ein neues Feld dabei, Wartegrund fehlt -> Fehler", () =>
  wirft(werkzeug("fenster_zeigen", { id: "ac3", titel: "X", status: "wartet", taetigkeit: "Lauf beobachtet." })));
await t("neuer Client mit vollstaendigen Feldern geht weiter durch", async () => {
  await werkzeug("fenster_zeigen", { id: "ac4", titel: "X", status: "wartet", warten_auf: "extern", wartegrund: "Lauf 1148 muss durchlaufen." });
  if (fenster.get("ac4").warten_auf !== "extern") throw new Error("nicht gespeichert");
});
console.log(`${ok}/${ok+nok}`); process.exit(nok ? 1 : 0);
