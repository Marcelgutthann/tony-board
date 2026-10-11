// Tony Board: MCP-Connector fuer Tony (ChatGPT) + Lese-/Eingabe-API fuer die Board-Seite.
// Pfade (alle mit Schluessel aus tony_board_zustand.schluessel):
//   POST /tony-board/mcp/<schluessel>          MCP (Streamable HTTP, zustandslos)
//   GET  /tony-board/api/<schluessel>/state    Zustand fuer das Board
//   POST /tony-board/api/<schluessel>/eingabe  Nachricht/Freigabe vom Board
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

let schluesselCache: string | null = null;
async function schluesselOk(s: string | undefined) {
  if (!s) return false;
  if (!schluesselCache) {
    const { data } = await db.from("tony_board_zustand").select("schluessel").eq("id", 1).single();
    schluesselCache = data?.schluessel ?? null;
  }
  return s === schluesselCache;
}

const APPS = ["gmail", "outlook", "github", "jira", "kalender", "drive", "slack", "notion", "web", "code", "notiz", "noranotes", "dokument"];
const STATUS = ["arbeitet", "braucht_dich", "wartet", "fertig"];

const TOOLS = [
  {
    name: "board_lesen",
    title: "Board lesen",
    description:
      "Liest das Tony Board: alle offenen Fenster, Fokus, To-dos und neue Eingaben von Marcel (Nachrichten, Freigaben, Ablehnungen). Neue Eingaben werden dabei als gelesen markiert. Vor jedem Senden einer Mail hier pruefen, ob Marcel freigegeben hat.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "fenster_zeigen",
    title: "Fenster zeigen",
    description:
      "Legt ein Glasfenster auf dem Board an oder aktualisiert es (gleiche id = gleiches Fenster). Nutze es fuer jede Aufgabe, an der du arbeitest: Mailentwurf, Originalnachricht, Recherche, Pruefplan. Zeige dort genau das, was Marcel gerade sehen muss. Fehlende Felder bleiben unveraendert.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Kurze feste Kennung der Aufgabe, z. B. 'mail-mueller-angebot'." },
        titel: { type: "string", description: "Titel der Aufgabe, z. B. 'Antwort an Herrn Mueller'." },
        app: { type: "string", enum: APPS, description: "Logo oben links im Fenster." },
        art: { type: "string", enum: ["mail", "text", "code"], description: "mail = Kopfzeilen An/Betreff + Text; code = Monospace." },
        kopf: {
          type: "object",
          description: "Kopfzeilen, bei Mails z. B. {\"An\": \"...\", \"Betreff\": \"...\"}.",
          additionalProperties: { type: "string" },
        },
        inhalt: { type: "string", description: "Der Inhalt im Fenster (Mailtext, Nachricht, Notiz). Markdown-Ueberschriften und Listen sind erlaubt." },
        status: { type: "string", enum: STATUS, description: "arbeitet | braucht_dich | wartet | fertig" },
        schritte: {
          type: "array",
          description: "Arbeitsschritte. Genau ein Schritt sollte aktuell sein.",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              erledigt: { type: "boolean" },
              aktuell: { type: "boolean" },
            },
            required: ["text"],
          },
        },
        hinweis: { type: "string", description: "Ein Satz unter dem Fenster: was du gerade tust oder was du von Marcel brauchst." },
        fokus: { type: "boolean", description: "true = dieses Fenster nach vorne holen." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "fokus_setzen",
    title: "Fokus setzen",
    description: "Holt ein Fenster nach vorne und/oder wechselt die Ansicht (rondell = drehbares Karussell, mehrfenster = nebeneinander).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Fenster-id, die nach vorne soll." },
        ansicht: { type: "string", enum: ["rondell", "mehrfenster"] },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "freigabe_anfragen",
    title: "Freigabe anfragen",
    description:
      "Markiert ein Fenster als 'braucht Freigabe'. Marcel liest gegen und gibt auf dem Board frei oder lehnt ab. Danach mit board_lesen pruefen. Nie eine Mail senden, bevor freigabe = freigegeben ist oder Marcel muendlich zugestimmt hat.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        frage: { type: "string", description: "Was Marcel pruefen soll, ein Satz." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "todos_setzen",
    title: "To-dos setzen",
    description: "Ersetzt die feste To-do-Liste oben links auf dem Board.",
    inputSchema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" }, erledigt: { type: "boolean" } },
            required: ["text"],
          },
        },
      },
      required: ["todos"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "fenster_schliessen",
    title: "Fenster schliessen",
    description: "Nimmt ein erledigtes Fenster vom Board.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

async function zustandLesen() {
  const [{ data: fenster }, { data: z }, { data: eingang }] = await Promise.all([
    db.from("tony_board_fenster").select("*").eq("geschlossen", false).order("erstellt"),
    db.from("tony_board_zustand").select("fokus, ansicht, todos, geaendert").eq("id", 1).single(),
    db.from("tony_board_eingang").select("*").order("id", { ascending: false }).limit(30),
  ]);
  return { fenster: fenster ?? [], fokus: z?.fokus ?? null, ansicht: z?.ansicht ?? "rondell", todos: z?.todos ?? [], eingang: eingang ?? [] };
}

async function setzeZustand(felder: Record<string, unknown>) {
  const { error } = await db.from("tony_board_zustand").update({ ...felder, geaendert: new Date().toISOString() }).eq("id", 1);
  if (error) throw new Error(error.message);
}

async function werkzeug(name: string, a: Record<string, any>): Promise<unknown> {
  switch (name) {
    case "board_lesen": {
      const z = await zustandLesen();
      const neu = z.eingang.filter((e: any) => !e.gelesen);
      if (neu.length) {
        await db.from("tony_board_eingang").update({ gelesen: new Date().toISOString() }).in("id", neu.map((e: any) => e.id));
      }
      return {
        fokus: z.fokus,
        ansicht: z.ansicht,
        todos: z.todos,
        fenster: z.fenster.map((f: any) => ({
          id: f.id, titel: f.titel, app: f.app, status: f.status, freigabe: f.freigabe,
          freigabe_kommentar: f.freigabe_kommentar, hinweis: f.hinweis,
        })),
        neue_eingaben_von_marcel: neu.reverse().map((e: any) => ({ fenster_id: e.fenster_id, art: e.art, text: e.text, zeit: e.erstellt })),
      };
    }
    case "fenster_zeigen": {
      if (!a.id) throw new Error("id fehlt");
      const { data: alt } = await db.from("tony_board_fenster").select("id").eq("id", a.id).maybeSingle();
      const felder: Record<string, unknown> = { geaendert: new Date().toISOString(), geschlossen: false };
      for (const k of ["titel", "app", "art", "kopf", "inhalt", "status", "schritte", "hinweis"]) {
        if (a[k] !== undefined) felder[k] = a[k];
      }
      if (felder.app && !APPS.includes(felder.app as string)) felder.app = "notiz";
      if (felder.status && !STATUS.includes(felder.status as string)) felder.status = "arbeitet";
      // Neuer Inhalt nach Freigabe = neue Freigabe noetig
      if (alt && (a.inhalt !== undefined || a.kopf !== undefined)) {
        const { data: f } = await db.from("tony_board_fenster").select("freigabe").eq("id", a.id).single();
        if (f?.freigabe === "freigegeben" || f?.freigabe === "abgelehnt") felder.freigabe = "keine";
      }
      if (alt) {
        const { error } = await db.from("tony_board_fenster").update(felder).eq("id", a.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from("tony_board_fenster").insert({ id: a.id, titel: a.titel ?? a.id, ...felder });
        if (error) throw new Error(error.message);
      }
      if (a.fokus || !alt) await setzeZustand({ fokus: a.id });
      return { ok: true, id: a.id, angelegt: !alt };
    }
    case "fokus_setzen": {
      const felder: Record<string, unknown> = {};
      if (a.id) felder.fokus = a.id;
      if (a.ansicht) felder.ansicht = a.ansicht;
      await setzeZustand(felder);
      return { ok: true, ...felder };
    }
    case "freigabe_anfragen": {
      const { error } = await db.from("tony_board_fenster").update({
        freigabe: "angefragt", freigabe_kommentar: null, status: "braucht_dich",
        hinweis: a.frage ?? "Bitte gegenlesen und freigeben.", geaendert: new Date().toISOString(),
      }).eq("id", a.id);
      if (error) throw new Error(error.message);
      await setzeZustand({ fokus: a.id });
      return { ok: true, hinweis: "Marcel sieht die Anfrage. Mit board_lesen pruefen, ob freigegeben wurde." };
    }
    case "todos_setzen": {
      await setzeZustand({ todos: (a.todos ?? []).map((t: any) => ({ text: String(t.text), erledigt: !!t.erledigt })) });
      return { ok: true };
    }
    case "fenster_schliessen": {
      const { error } = await db.from("tony_board_fenster").update({ geschlossen: true, geaendert: new Date().toISOString() }).eq("id", a.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
  }
  throw new Error(`Unbekanntes Werkzeug: ${name}`);
}

async function mcp(msg: any): Promise<any | null> {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return null; // Notification
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tony-board", title: "Tony Board", version: "1.0.0" },
        instructions:
          "Tony Board ist Marcels Bildschirm fuer deine Arbeit. Lege fuer jede Aufgabe, an der du arbeitest, ein Fenster an (fenster_zeigen) und halte Inhalt, Schritte und Status aktuell. Hole das Fenster nach vorne, ueber das ihr gerade sprecht. Vor dem Senden einer Mail: freigabe_anfragen, dann board_lesen bis freigegeben. Lies mit board_lesen regelmaessig, was Marcel eingegeben hat.",
      });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      try {
        const r = await werkzeug(params?.name, params?.arguments ?? {});
        return ok({ content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r, isError: false });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `Fehler: ${(e as Error).message}` }], isError: true });
      }
    }
    case "resources/list":
      return ok({ resources: [] });
    case "prompts/list":
      return ok({ prompts: [] });
    default:
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Methode nicht unterstuetzt: ${method}` } };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const teile = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = teile.indexOf("tony-board");
  const [bereich, schluessel, aktion] = teile.slice(i + 1);

  if (!(await schluesselOk(schluessel))) return json({ error: "nicht gefunden" }, 404);

  if (bereich === "mcp") {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });
    const body = await req.json().catch(() => null);
    if (!body) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
    if (Array.isArray(body)) {
      const antworten = (await Promise.all(body.map(mcp))).filter(Boolean);
      return antworten.length ? json(antworten) : new Response(null, { status: 202, headers: CORS });
    }
    const antwort = await mcp(body);
    return antwort ? json(antwort) : new Response(null, { status: 202, headers: CORS });
  }

  if (bereich === "api" && aktion === "state" && req.method === "GET") {
    return json(await zustandLesen());
  }

  if (bereich === "api" && aktion === "eingabe" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const text = String(b.text ?? "").trim().slice(0, 8000);
    const art = ["nachricht", "freigabe", "ablehnung"].includes(b.art) ? b.art : "nachricht";
    if (!text && art === "nachricht") return json({ error: "leer" }, 400);
    await db.from("tony_board_eingang").insert({ fenster_id: b.fenster_id ?? null, art, text: text || art });
    if (b.fenster_id && art !== "nachricht") {
      await db.from("tony_board_fenster").update({
        freigabe: art === "freigabe" ? "freigegeben" : "abgelehnt",
        freigabe_kommentar: text || null,
        status: art === "freigabe" ? "arbeitet" : "braucht_dich",
        geaendert: new Date().toISOString(),
      }).eq("id", b.fenster_id);
    }
    return json({ ok: true });
  }

  if (bereich === "api" && aktion === "ansicht" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const f: Record<string, unknown> = {};
    if (b.ansicht === "rondell" || b.ansicht === "mehrfenster") f.ansicht = b.ansicht;
    if (typeof b.fokus === "string") f.fokus = b.fokus;
    await setzeZustand(f);
    return json({ ok: true });
  }

  return json({ error: "nicht gefunden" }, 404);
});
