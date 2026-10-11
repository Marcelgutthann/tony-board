import fs from "node:fs";
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
fs.writeFileSync(process.env.TEMP + "/tbcompat/fn.ts", src);
import { pathToFileURL } from "node:url"; const { werkzeug } = await import(pathToFileURL(process.env.TEMP + "/tbcompat/fn.ts").href);
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
console.log(`${ok}/${ok+nok}`); process.exit(nok ? 1 : 0);
