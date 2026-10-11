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
        auftrag: { type: "string", description: "PFLICHT: Der Auftrag in einem Satz, so wie Marcel ihn gegeben hat." },
        kernaussage: {
          type: "string",
          description:
            "PFLICHT, wird als 'Stand' angezeigt: was jetzt gilt, in hoechstens 12 Woertern, die Marcel in 5 Sekunden erfasst. Wichtigste Woerter mit **fett**. Trenne ehrlich zwischen erledigt und nur vorbereitet. Beispiel: '**3 Versprechen** auf der Website ohne Beleg, **Impressum** veraltet.'",
        },
        von_dir: { type: "string", description: "Die EINE konkrete Frage an Marcel als ganzer Satz (z. B. \"Soll der Umbau live gehen?\"), Pflicht bei status braucht_dich. Leer lassen (\"\"), wenn nichts von Marcel noetig ist; technisches Warten ist kein von_dir." },
        app: { type: "string", enum: APPS, description: "Logo oben links im Fenster." },
        art: { type: "string", enum: ["mail", "text", "code", "chat"], description: "mail = Kopfzeilen An/Betreff + Text; code = Monospace; chat = Verlauf steht im Vordergrund." },
        kopf: {
          type: "object",
          description: "Kopfzeilen, bei Mails z. B. {\"An\": \"...\", \"Betreff\": \"...\"}.",
          additionalProperties: { type: "string" },
        },
        inhalt: { type: "string", description: "Details zum Nachlesen (Mailtext, Notiz, Begruendung). Wird eingeklappt angezeigt, ausser bei Mails. Kurz halten; was sich als Widget zeigen laesst, gehoert ins Widget." },
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
        verlauf: {
          type: "array",
          description: "Chatverlauf im Fenster, z. B. ein Mailwechsel oder dein Arbeitsprotokoll als Nachrichten. Ersetzt den bisherigen Verlauf.",
          items: {
            type: "object",
            properties: {
              wer: { type: "string", description: "Absender, z. B. 'Tony', 'Herr Mueller', 'Marcel'." },
              text: { type: "string" },
              zeit: { type: "string", description: "Optional, z. B. '14:05' oder '10.10.'" },
              eigen: { type: "boolean", description: "true = rechts als eigene Nachricht (Tony/Marcel)." },
            },
            required: ["wer", "text"],
          },
        },
        widgets: {
          type: "array",
          description:
            "Das Herz des Fensters: visuelle Bausteine, die Marcel ohne Lesen versteht. Jedes Ergebnis-Fenster braucht mindestens ein Widget. Zahlen als kennzahlen oder balken, Gegenueberstellungen als vergleich, Quellen als links, Status als checkliste. Typen und daten: " +
            "kennzahlen {werte:[{label,wert,hinweis?}]}; " +
            "tabelle {spalten:[..], zeilen:[[..]]}; " +
            "checkliste {punkte:[{text,erledigt}]}; " +
            "vergleich {links:{titel,punkte:[..]}, rechts:{titel,punkte:[..]}}; " +
            "balken {werte:[{label,wert}], einheit?}; " +
            "links {eintraege:[{titel,url,beschreibung?}]} = bei einem fertigen Feature steht zuerst der Direktlink auf die Stelle in der App (z. B. https://staging.noranotes.ai/style), ein GitHub-PR nur danach als technische Quelle (privates Repo: im Browser ohne GitHub-Login immer 404); " +
            "zitat {text, quelle?}; " +
            "bild {url, alt?}; " +
            "mockup {html} = kleines selbst gebautes HTML/CSS-Mockup (inline Styles, ohne externe Skripte), z. B. ein Entwurf einer Oberflaeche oder Grafik.",
          items: {
            type: "object",
            properties: {
              typ: { type: "string", enum: ["kennzahlen", "tabelle", "checkliste", "vergleich", "balken", "links", "zitat", "bild", "mockup"] },
              titel: { type: "string" },
              daten: { type: "object", description: "Inhalt je nach typ, siehe oben." },
            },
            required: ["typ", "daten"],
          },
        },
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
    name: "an_claude",
    title: "An Claude schreiben",
    description:
      "Schreibt Claude (Marcels Coding-Agent auf dem Laptop) eine Nachricht. Claude schaut jede Minute nach und antwortet ueber das Board; die Antwort steht danach in board_lesen unter neue_nachrichten_von_claude. Nutze es fuer Aufgaben, die Code, App, Daten, Deploys, Tickets oder Auswertungen betreffen, und um euch abzustimmen, was ihr Marcel abnehmen koennt. Gib allen Kontext mit, den Claude braucht.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Die Nachricht an Claude, mit Kontext." },
        fenster_id: { type: "string", description: "Optional: Fenster, um das es geht." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "archiv_suchen",
    title: "Archiv durchsuchen",
    description:
      "Durchsucht archivierte (geschlossene) Fenster nach einem Suchbegriff in Titel, Kernaussage und Inhalt. Nutze es, bevor du etwas neu recherchierst oder schreibst, das Marcel schon einmal hatte. Ein gefundenes Fenster holst du mit fenster_zeigen und derselben id zurueck aufs Board.",
    inputSchema: {
      type: "object",
      properties: { suchbegriff: { type: "string" } },
      required: ["suchbegriff"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "fenster_schliessen",
    title: "Fenster archivieren",
    description: "Nimmt ein erledigtes Fenster vom Board ins Archiv. Es bleibt ueber archiv_suchen auffindbar.",
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
  const [{ data: fenster }, { data: z }, { data: eingang }, { data: absprache }, { data: archiv }] = await Promise.all([
    db.from("tony_board_fenster").select("*").eq("geschlossen", false).order("erstellt"),
    db.from("tony_board_zustand").select("fokus, ansicht, todos, geaendert").eq("id", 1).single(),
    db.from("tony_board_eingang").select("*").order("id", { ascending: false }).limit(30),
    db.from("tony_board_absprache").select("*").order("id", { ascending: false }).limit(30),
    db.from("tony_board_fenster").select("id, titel, kernaussage, app, geaendert").eq("geschlossen", true).order("geaendert", { ascending: false }).limit(100),
  ]);
  return { fenster: fenster ?? [], fokus: z?.fokus ?? null, ansicht: z?.ansicht ?? "rondell", todos: z?.todos ?? [], eingang: eingang ?? [], absprache: absprache ?? [], archiv: archiv ?? [] };
}

// Ungelesene Nachrichten eines Absenders holen und als gelesen markieren
async function absprachenHolen(von: string) {
  const { data } = await db.from("tony_board_absprache").select("*").eq("von", von).is("gelesen", null).order("id");
  if (data?.length) {
    await db.from("tony_board_absprache").update({ gelesen: new Date().toISOString() }).in("id", data.map((m: any) => m.id));
  }
  return (data ?? []).map((m: any) => ({ text: m.text, fenster_id: m.fenster_id, zeit: m.erstellt }));
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
        neue_nachrichten_von_claude: await absprachenHolen("claude"),
      };
    }
    case "fenster_zeigen": {
      if (!a.id) throw new Error("id fehlt");
      const { data: alt } = await db.from("tony_board_fenster").select("id").eq("id", a.id).maybeSingle();
      const felder: Record<string, unknown> = { geaendert: new Date().toISOString(), geschlossen: false };
      for (const k of ["titel", "auftrag", "kernaussage", "von_dir", "app", "art", "kopf", "inhalt", "status", "schritte", "hinweis", "verlauf", "widgets"]) {
        if (a[k] !== undefined) felder[k] = a[k];
      }
      if (felder.app && !APPS.includes(felder.app as string)) felder.app = "notiz";
      if (felder.status && !STATUS.includes(felder.status as string)) felder.status = "arbeitet";
      // braucht_dich nur mit konkreter Frage; technisches Warten ist "wartet", Freigaben laufen ueber freigabe_anfragen
      if (felder.status === "braucht_dich") {
        const { data: f } = alt ? await db.from("tony_board_fenster").select("von_dir, freigabe").eq("id", a.id).single() : { data: null };
        // Rueckwaertskompatibel: aeltere Clients ohne von_dir im Schema schreiben die Frage in hinweis
        if (felder.von_dir === undefined && typeof felder.hinweis === "string" && felder.hinweis.trim()) felder.von_dir = felder.hinweis;
        const frage = String(felder.von_dir ?? f?.von_dir ?? "").trim();
        if (f?.freigabe !== "angefragt" && (frage.length < 10 || /^von dir\b/i.test(frage))) throw new Error("status braucht_dich braucht in von_dir die konkrete Frage an Marcel (ganzer Satz). Wartest du nur technisch (Deploy, Build, Antwort von Claude), setze status wartet und von_dir leer. Fuer Freigaben nutze freigabe_anfragen.");
      }
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
    case "an_claude": {
      const text = String(a.text ?? "").trim();
      if (!text) throw new Error("text fehlt");
      const { error } = await db.from("tony_board_absprache").insert({ von: "tony", text: text.slice(0, 20000), fenster_id: a.fenster_id ?? null });
      if (error) throw new Error(error.message);
      return { ok: true, hinweis: "Claude schaut innerhalb von etwa einer Minute nach. Antwort spaeter mit board_lesen holen." };
    }
    case "archiv_suchen": {
      const q = String(a.suchbegriff ?? "").replace(/[%,()]/g, " ").trim();
      if (!q) throw new Error("suchbegriff fehlt");
      const { data, error } = await db.from("tony_board_fenster")
        .select("id, titel, kernaussage, app, inhalt, widgets, geaendert")
        .eq("geschlossen", true)
        .or(`titel.ilike.%${q}%,kernaussage.ilike.%${q}%,inhalt.ilike.%${q}%`)
        .order("geaendert", { ascending: false }).limit(10);
      if (error) throw new Error(error.message);
      return { treffer: data ?? [] };
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
        serverInfo: { name: "tony-board", title: "Tony Board", version: "1.3.0" },
        instructions:
          "Tony Board ist Marcels Bildschirm fuer deine Arbeit. Oberste Regel: Marcel muss jedes Fenster in 5 Sekunden verstehen, ohne zu lesen. Darum beginnt jedes Fenster mit auftrag (ein Satz), kernaussage als Stand (hoechstens 12 Woerter, Schluesselwoerter fett) und von_dir (die eine Frage an Marcel, sonst leer), dazu mindestens ein Widget; Fliesstext ist nur Detail. Lege fuer jede Aufgabe, an der du arbeitest, ein Fenster an (fenster_zeigen) und halte Inhalt, Schritte und Status aktuell. Bereite Ergebnisse visuell auf: Kennzahlen, Tabellen, Vergleiche, Link-Karten oder kleine Mockups als widgets, Mailwechsel als verlauf. Bei einem fertigen Feature ist die erste Link-Karte immer der Direktlink auf die Stelle in der App, ein GitHub-PR nur danach als technische Quelle. Hole das Fenster nach vorne, ueber das ihr gerade sprecht. status braucht_dich nur, wenn Marcel wirklich entscheiden oder etwas liefern muss, und dann immer mit der konkreten Frage in von_dir; wartest du nur technisch (Deploy, Build, Claude), ist der status wartet und von_dir leer. Vor dem Senden einer Mail: freigabe_anfragen, dann board_lesen bis freigegeben. Lies mit board_lesen regelmaessig, was Marcel eingegeben und Claude geantwortet hat. Code-, App-, Daten- und Deploy-Themen gibst du mit an_claude an Claude weiter.",
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

  // Claude: ungelesene Nachrichten von Tony holen (markiert sie als gelesen)
  if (bereich === "api" && aktion === "fuer-claude" && req.method === "POST") {
    return json({ nachrichten: await absprachenHolen("tony") });
  }
  // Claude: nur zaehlen, ohne zu markieren (fuer den Minuten-Waechter)
  if (bereich === "api" && aktion === "fuer-claude" && req.method === "GET") {
    const { count } = await db.from("tony_board_absprache").select("id", { count: "exact", head: true }).eq("von", "tony").is("gelesen", null);
    return json({ offen: count ?? 0 });
  }
  // Claude: Antwort an Tony
  if (bereich === "api" && aktion === "an-tony" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    const text = String(b.text ?? "").trim();
    if (!text) return json({ error: "leer" }, 400);
    await db.from("tony_board_absprache").insert({ von: "claude", text: text.slice(0, 20000), fenster_id: b.fenster_id ?? null });
    return json({ ok: true });
  }

  // Board: Fenster archivieren oder zurueckholen
  if (bereich === "api" && aktion === "archivieren" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!b.id) return json({ error: "id fehlt" }, 400);
    await db.from("tony_board_fenster").update({ geschlossen: !b.zurueck, geaendert: new Date().toISOString() }).eq("id", b.id);
    if (b.zurueck) await setzeZustand({ fokus: b.id });
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
