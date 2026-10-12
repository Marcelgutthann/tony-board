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
const WARTEN = ["marcel", "extern", "agent", "zugang"];
const WARTEN_TEXT = "marcel = Marcel muss entscheiden oder etwas liefern, extern = ein Vorgang ausserhalb laeuft (CI-Lauf, Build, Deploy, Antwort einer Firma), agent = ein anderer Agent ist dran (Claude), zugang = ein Zugang, Recht oder Schluessel fehlt.";
const BEREICHE = ["technik", "vertrieb", "organisation"];
// Ohne bestaetigtes Signal gilt laufende Arbeit nach dieser Zeit als unbestaetigt (gleiche Grenze wie im Board)
const FRISCH_MIN = 15;
// Ohne Angabe: Einordnung nach App, Tony bekommt einen Hinweis zum Korrigieren
const bereichAusApp = (app: string) =>
  ["code", "github", "jira"].includes(app) ? "technik" : ["gmail", "outlook"].includes(app) ? "vertrieb" : "organisation";
const BEREICH_TEXT = "technik = Technische Entwicklung (Code, App, Daten, Deploys), vertrieb = Vertrieb/Sales (Kunden, Interessenten, Partner, Angebote, Aussenauftritt), organisation = Organisation (Buero, Termine, Verwaltung, Einkauf, Persoenliches).";

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
        bereich: { type: "string", enum: BEREICHE, description: "PFLICHT beim Anlegen: in welchem Rondell das Fenster steht. " + BEREICH_TEXT },
        app: { type: "string", enum: APPS, description: "Logo oben links im Fenster." },
        art: { type: "string", enum: ["mail", "text", "code", "chat"], description: "mail = Kopfzeilen An/Betreff + Text; code = Monospace; chat = Verlauf steht im Vordergrund." },
        kopf: {
          type: "object",
          description: "Kopfzeilen, bei Mails z. B. {\"An\": \"...\", \"Betreff\": \"...\"}.",
          additionalProperties: { type: "string" },
        },
        inhalt: { type: "string", description: "Details zum Nachlesen (Mailtext, Notiz, Begruendung). Wird eingeklappt angezeigt, ausser bei Mails. Kurz halten; was sich als Widget zeigen laesst, gehoert ins Widget." },
        status: { type: "string", enum: STATUS, description: "arbeitet | braucht_dich | wartet | fertig. Der Status allein ist kein Beweis, dass gearbeitet wird: bei arbeitet gehoert taetigkeit dazu, bei wartet warten_auf und wartegrund." },
        taetigkeit: {
          type: "string",
          description:
            "Was in diesem Moment tatsaechlich getan wird oder zuletzt nachweislich getan wurde, konkret und in einem Satz (z. B. 'Regressionstest fuer den PDF-Export geschrieben, laeuft jetzt gegen staging'). Keine Statuswoerter wie 'in Arbeit' oder 'laeuft'. Jedes Setzen zaehlt als bestaetigtes Signal: ohne taetigkeit zeigt das Board 'Status nicht aktuell bestaetigt'.",
        },
        zustaendig: { type: "string", description: "Wer gerade daran arbeitet oder worauf es ankommt: 'Tony', 'Claude', 'Marcel', 'GitHub Actions', 'Kanzlei Weber'." },
        warten_auf: { type: "string", enum: WARTEN, description: "PFLICHT bei status wartet: auf welche Art von Sache gewartet wird. " + WARTEN_TEXT },
        wartegrund: { type: "string", description: "PFLICHT bei status wartet: die konkrete Abhaengigkeit in einem Satz (z. B. 'GitHub-Actions-Lauf 1148101 muss durchlaufen, bisher bricht er vor dem ersten Schritt ab'). Nicht 'wartet auf Antwort', sondern worauf genau und von wem." },
        naechste_aktion: { type: "string", description: "Der naechste konkrete Schritt, der passiert, sobald es weitergeht - und wer ihn macht. Leer lassen, wenn es wirklich keinen gibt." },
        bestaetigt_am: { type: "string", description: "Optional, Zeitpunkt des letzten bestaetigten Signals als ISO-Zeit. Ohne Angabe setzt das Board die Zeit dieses Aufrufs, sobald taetigkeit mitkommt. Nie setzen, ohne tatsaechlich nachgesehen zu haben." },
        fehler: { type: "string", description: "Ein Fehler, der die Arbeit anhaelt, im Klartext (z. B. 'CI-Lauf bricht mit Abrechnungsfehler ab, kein Testschritt ausgefuehrt'). Leerer String loescht ihn wieder." },
        schritte: {
          type: "array",
          description: "Arbeitsschritte. Genau ein Schritt sollte aktuell sein. Bei status fertig oder wartet zeigt das Board den aktuellen Schritt nicht als laufend an, sondern als angehalten.",
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
        hinweis: { type: "string", description: "Veraltet: nutze taetigkeit (was du tust), wartegrund (worauf du wartest) und von_dir (was du von Marcel brauchst). Wird nur noch als Ersatz angezeigt, wenn diese Felder fehlen." },
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
    name: "im_blick_behalten",
    title: "Im Blick behalten",
    description:
      "Legt einen Punkt in 'Bleibt im Blick' an: etwas, das nicht fertig ist und weiterverfolgt werden muss, auch wenn das Fenster dazu fertig ist. Pflicht, sobald eine Reaktion von aussen aussteht (Mail gesendet und Antwort/Termin erwartet, Angebot raus, Zusage offen) oder eine Aufgabe liegen bleibt. Beispiel: Mail an Herrn Arends mit Terminvorschlag gesendet -> text 'Antwort auf Terminvorschlag abwarten', wer 'Christian Arends'. Der Punkt bleibt, bis du ihn mit im_blick_erledigt abhakst oder Marcel ihn abhakt. Gleiche fenster_id und offener Punkt = wird aktualisiert statt doppelt angelegt.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Was offen ist, ein kurzer Satz." },
        wer: { type: "string", description: "Von wem etwas aussteht oder um wen es geht." },
        bereich: { type: "string", enum: BEREICHE, description: BEREICH_TEXT },
        fenster_id: { type: "string", description: "Fenster, zu dem der Punkt gehoert." },
        nachfassen_am: { type: "string", description: "Optional: ab wann nachfassen, JJJJ-MM-TT." },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "im_blick_erledigt",
    title: "Im Blick: erledigt",
    description: "Hakt einen Punkt aus 'Bleibt im Blick' ab (id aus board_lesen), z. B. wenn die erwartete Antwort gekommen ist.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "todos_setzen",
    title: "To-dos setzen (alt)",
    description: "Veraltet, nutze im_blick_behalten. Legt jeden Eintrag als Punkt in 'Bleibt im Blick' an; erledigt:true hakt einen gleichlautenden offenen Punkt ab. Entfernt nie etwas.",
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
    description: "Nimmt ein erledigtes Fenster vom Board ins Archiv. Es bleibt ueber archiv_suchen auffindbar. Ist der status nicht fertig, landet es automatisch in 'Bleibt im Blick'.",
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
  const [{ data: fenster }, { data: z }, { data: eingang }, { data: absprache }, { data: archiv }, { data: blick }] = await Promise.all([
    db.from("tony_board_fenster").select("*").eq("geschlossen", false).order("erstellt"),
    db.from("tony_board_zustand").select("fokus, ansicht, geaendert").eq("id", 1).single(),
    db.from("tony_board_eingang").select("*").order("id", { ascending: false }).limit(30),
    db.from("tony_board_absprache").select("*").order("id", { ascending: false }).limit(30),
    db.from("tony_board_fenster").select("id, titel, kernaussage, app, bereich, geaendert").eq("geschlossen", true).order("geaendert", { ascending: false }).limit(100),
    db.from("tony_board_blick").select("id, text, wer, bereich, fenster_id, nachfassen_am, quelle, erstellt").is("erledigt_am", null).order("erstellt"),
  ]);
  return { fenster: fenster ?? [], fokus: z?.fokus ?? null, ansicht: z?.ansicht ?? "rondell", blick: blick ?? [], eingang: eingang ?? [], absprache: absprache ?? [], archiv: archiv ?? [] };
}

// Punkt in "Bleibt im Blick": offener Punkt zum selben Fenster wird aktualisiert statt verdoppelt
async function blickMerken(p: { text: string; wer?: string | null; bereich?: string; fenster_id?: string | null; nachfassen_am?: string | null; quelle: string }) {
  const text = String(p.text ?? "").trim().slice(0, 500);
  if (!text) throw new Error("text fehlt");
  let bereich = BEREICHE.includes(p.bereich as string) ? p.bereich : null;
  if (!bereich && p.fenster_id) {
    const { data: f } = await db.from("tony_board_fenster").select("bereich").eq("id", p.fenster_id).maybeSingle();
    bereich = f?.bereich ?? null;
  }
  const felder: Record<string, unknown> = { text, bereich: bereich ?? "organisation", quelle: p.quelle };
  if (p.wer !== undefined) felder.wer = p.wer || null;
  if (p.fenster_id !== undefined) felder.fenster_id = p.fenster_id || null;
  if (p.nachfassen_am !== undefined) felder.nachfassen_am = /^\d{4}-\d{2}-\d{2}$/.test(String(p.nachfassen_am)) ? p.nachfassen_am : null;
  const { data: alt } = p.fenster_id
    ? await db.from("tony_board_blick").select("id").eq("fenster_id", p.fenster_id).is("erledigt_am", null).limit(1).maybeSingle()
    : await db.from("tony_board_blick").select("id").eq("text", text).is("erledigt_am", null).limit(1).maybeSingle();
  if (alt) {
    const { error } = await db.from("tony_board_blick").update(felder).eq("id", alt.id);
    if (error) throw new Error(error.message);
    return alt.id;
  }
  const { data, error } = await db.from("tony_board_blick").insert(felder).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

// Archivieren: was nicht fertig ist, geht nicht verloren, sondern bleibt im Blick
async function archivieren(id: string) {
  const { data: f } = await db.from("tony_board_fenster").select("titel, status, kernaussage, bereich").eq("id", id).maybeSingle();
  const { error } = await db.from("tony_board_fenster").update({ geschlossen: true, geaendert: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  if (f && f.status !== "fertig") {
    const stand = String(f.kernaussage ?? "").replace(/\*\*/g, "").trim();
    await blickMerken({ text: `${f.titel}: ${stand || "nicht fertig"} (archiviert, Status ${f.status})`, bereich: f.bereich, fenster_id: id, quelle: "archiviert" });
  }
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
      // Das Board zeigt laufende Arbeit nur mit frischem bestaetigtem Signal; dieselbe Grenze gilt hier
      const unbestaetigt = z.fenster.filter((f: any) =>
        f.status === "arbeitet" && (!f.bestaetigt_am || Date.now() - Date.parse(f.bestaetigt_am) > FRISCH_MIN * 60000));
      return {
        fokus: z.fokus,
        ansicht: z.ansicht,
        bleibt_im_blick: z.blick,
        fenster: z.fenster.map((f: any) => ({
          id: f.id, titel: f.titel, app: f.app, bereich: f.bereich, status: f.status, freigabe: f.freigabe,
          freigabe_kommentar: f.freigabe_kommentar, von_dir: f.von_dir,
          taetigkeit: f.taetigkeit, zustaendig: f.zustaendig, warten_auf: f.warten_auf, wartegrund: f.wartegrund,
          naechste_aktion: f.naechste_aktion, bestaetigt_am: f.bestaetigt_am, fehler: f.fehler, hinweis: f.hinweis,
        })),
        ...(unbestaetigt.length ? { hinweis: `Marcel sieht bei ${unbestaetigt.map((f: any) => f.id).join(", ")} 'Status nicht aktuell bestaetigt', weil seit ueber ${FRISCH_MIN} Minuten keine taetigkeit gemeldet wurde. Melde dort die echte Taetigkeit nach oder setze den passenden Status (wartet mit warten_auf und wartegrund, fertig, oder fehler).` } : {}),
        neue_eingaben_von_marcel: neu.reverse().map((e: any) => ({ fenster_id: e.fenster_id, art: e.art, text: e.text, zeit: e.erstellt })),
        neue_nachrichten_von_claude: await absprachenHolen("claude"),
      };
    }
    case "fenster_zeigen": {
      if (!a.id) throw new Error("id fehlt");
      const { data: alt } = await db.from("tony_board_fenster").select("id, von_dir, freigabe, warten_auf, wartegrund").eq("id", a.id).maybeSingle();
      const felder: Record<string, unknown> = { geaendert: new Date().toISOString(), geschlossen: false };
      for (const k of ["titel", "auftrag", "kernaussage", "von_dir", "bereich", "app", "art", "kopf", "inhalt", "status", "schritte", "hinweis", "verlauf", "widgets",
                       "taetigkeit", "zustaendig", "warten_auf", "wartegrund", "naechste_aktion", "bestaetigt_am", "fehler"]) {
        if (a[k] !== undefined) felder[k] = a[k];
      }
      if (felder.app && !APPS.includes(felder.app as string)) felder.app = "notiz";
      let bereichHinweis: string | undefined, altesSchema: string | undefined;
      if (felder.bereich !== undefined && !BEREICHE.includes(felder.bereich as string)) delete felder.bereich;
      if (!alt && felder.bereich === undefined) {
        felder.bereich = bereichAusApp(String(felder.app ?? "notiz"));
        bereichHinweis = `bereich fehlte, eingeordnet als '${felder.bereich}'. Falls falsch: fenster_zeigen mit id und bereich (${BEREICHE.join(" | ")}).`;
      }
      if (felder.status && !STATUS.includes(felder.status as string)) felder.status = "arbeitet";
      if (felder.warten_auf !== undefined && !WARTEN.includes(felder.warten_auf as string)) delete felder.warten_auf;
      if (felder.bestaetigt_am !== undefined && isNaN(Date.parse(String(felder.bestaetigt_am)))) delete felder.bestaetigt_am;
      if (felder.fehler !== undefined && !String(felder.fehler).trim()) felder.fehler = null;
      // Eine genannte Taetigkeit ist das bestaetigte Signal; die Zeit einer Aktualisierung allein ist keines
      if (felder.bestaetigt_am === undefined && typeof felder.taetigkeit === "string" && felder.taetigkeit.trim()) {
        felder.bestaetigt_am = new Date().toISOString();
      }
      // braucht_dich nur mit konkreter Frage; technisches Warten ist "wartet", Freigaben laufen ueber freigabe_anfragen
      if (felder.status === "braucht_dich") {
        // Rueckwaertskompatibel: aeltere Clients ohne von_dir im Schema schreiben die Frage in hinweis
        if (felder.von_dir === undefined && typeof felder.hinweis === "string" && felder.hinweis.trim()) felder.von_dir = felder.hinweis;
        const frage = String(felder.von_dir ?? alt?.von_dir ?? "").trim();
        if (alt?.freigabe !== "angefragt" && (frage.length < 10 || /^von dir\b/i.test(frage))) throw new Error("status braucht_dich braucht in von_dir die konkrete Frage an Marcel (ganzer Satz). Wartest du nur technisch (Deploy, Build, Antwort von Claude), setze status wartet und von_dir leer. Fuer Freigaben nutze freigabe_anfragen.");
        if (felder.warten_auf === undefined && alt?.warten_auf !== "marcel") felder.warten_auf = "marcel";
      }
      // Kennt der Aufrufer die neuen Felder ueberhaupt? Ein Client mit altem Schema (Tools in
      // ChatGPT noch nicht aktualisiert) kann sie nicht senden und darf daran nicht scheitern.
      const kenntNeu = ["taetigkeit", "zustaendig", "warten_auf", "wartegrund", "naechste_aktion", "bestaetigt_am", "fehler"]
        .some((k) => a[k] !== undefined);
      // wartet ohne Wartegrund ist genau das, was Marcel am Board nicht lesen kann
      if (felder.status === "wartet") {
        // Rueckwaertskompatibel: altes Schema schreibt den Grund in hinweis
        if (!kenntNeu && felder.wartegrund === undefined && typeof felder.hinweis === "string" && felder.hinweis.trim()) {
          felder.wartegrund = felder.hinweis;
        }
        const grund = String(felder.wartegrund ?? alt?.wartegrund ?? "").trim();
        const art = String(felder.warten_auf ?? alt?.warten_auf ?? "").trim();
        if (grund.length < 10 || !WARTEN.includes(art)) {
          // Nur wer die Felder kennt, wird darauf festgenagelt; alle anderen bekommen einen Hinweis
          if (kenntNeu) {
            throw new Error(`status wartet braucht warten_auf (${WARTEN.join(" | ")}) und wartegrund, die konkrete Abhaengigkeit als ganzen Satz. ${WARTEN_TEXT} Wartet niemand und nichts, sondern du arbeitest, ist der status arbeitet mit taetigkeit.`);
          }
          altesSchema = `status wartet wurde ohne warten_auf und wartegrund uebernommen, das Board zeigt darum nur ein unbestimmtes 'Wartet'. Dein Werkzeugschema ist veraltet: in ChatGPT unter Plugins > Tony Board > Verwalten 'Tools aktualisieren' klicken, dann warten_auf (${WARTEN.join(" | ")}) und wartegrund mitgeben.`;
        }
      }
      // Neuer Inhalt nach Freigabe = neue Freigabe noetig
      if (alt && (a.inhalt !== undefined || a.kopf !== undefined)) {
        if (alt.freigabe === "freigegeben" || alt.freigabe === "abgelehnt") felder.freigabe = "keine";
      }
      if (alt) {
        const { error } = await db.from("tony_board_fenster").update(felder).eq("id", a.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from("tony_board_fenster").insert({ id: a.id, titel: a.titel ?? a.id, ...felder });
        if (error) throw new Error(error.message);
      }
      // Nach vorne nur auf Wunsch oder wenn Marcel gebraucht wird; laufende Arbeit draengt sich nicht vor
      if (a.fokus || (!alt && felder.status === "braucht_dich")) await setzeZustand({ fokus: a.id });
      const hinweise = bereichHinweis ? [bereichHinweis] : [];
      if (altesSchema) hinweise.push(altesSchema);
      if (felder.status === "arbeitet" && !String(felder.taetigkeit ?? "").trim()) {
        hinweise.push("Ohne taetigkeit zeigt das Board 'Status nicht aktuell bestaetigt' statt laufender Arbeit. Nenne in einem Satz, was du gerade tatsaechlich tust.");
      }
      return { ok: true, id: a.id, angelegt: !alt, ...(hinweise.length ? { hinweis: hinweise.join(" ") } : {}),
        ...(felder.status === "fertig" ? { pruefen: "Steht nach 'fertig' noch etwas aus (Antwort, Termin, Zusage)? Dann im_blick_behalten." } : {}) };
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
        von_dir: a.frage ?? "Bitte gegenlesen und freigeben.", warten_auf: "marcel",
        hinweis: a.frage ?? "Bitte gegenlesen und freigeben.", geaendert: new Date().toISOString(),
      }).eq("id", a.id);
      if (error) throw new Error(error.message);
      await setzeZustand({ fokus: a.id });
      return { ok: true, hinweis: "Marcel sieht die Anfrage. Mit board_lesen pruefen, ob freigegeben wurde." };
    }
    case "im_blick_behalten": {
      const id = await blickMerken({ text: a.text, wer: a.wer, bereich: a.bereich, fenster_id: a.fenster_id, nachfassen_am: a.nachfassen_am, quelle: "tony" });
      return { ok: true, id };
    }
    case "im_blick_erledigt": {
      const { error } = await db.from("tony_board_blick").update({ erledigt_am: new Date().toISOString() }).eq("id", a.id).is("erledigt_am", null);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    case "todos_setzen": {
      // Alt-Werkzeug: nie ersetzen, nur anlegen bzw. gleichlautend abhaken
      for (const t of a.todos ?? []) {
        const text = String(t?.text ?? "").trim();
        if (!text) continue;
        if (t.erledigt) await db.from("tony_board_blick").update({ erledigt_am: new Date().toISOString() }).eq("text", text).is("erledigt_am", null);
        else await blickMerken({ text, quelle: "tony" });
      }
      return { ok: true, hinweis: "todos_setzen ist veraltet und entfernt nichts mehr. Nutze im_blick_behalten / im_blick_erledigt." };
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
      await archivieren(a.id);
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
        serverInfo: { name: "tony-board", title: "Tony Board", version: "1.5.0" },
        instructions:
          "Tony Board ist Marcels Bildschirm fuer deine Arbeit. Oberste Regel: Marcel muss jedes Fenster in 5 Sekunden verstehen, ohne zu lesen. Darum beginnt jedes Fenster mit auftrag (ein Satz), kernaussage als Stand (hoechstens 12 Woerter, Schluesselwoerter fett) und von_dir (die eine Frage an Marcel, sonst leer), dazu mindestens ein Widget; Fliesstext ist nur Detail. Lege fuer jede Aufgabe, an der du arbeitest, ein Fenster an (fenster_zeigen, immer mit bereich: technik, vertrieb oder organisation - jeder Bereich ist ein eigenes Rondell) und halte Inhalt, Schritte und Status aktuell. 'fertig' heisst: dein Teil ist getan. Bleibt danach etwas offen (Antwort auf eine gesendete Mail, Terminzusage, Freigabe von aussen) oder bleibt eine Aufgabe liegen, legst du es sofort mit im_blick_behalten an; kommt die Antwort, hakst du es mit im_blick_erledigt ab. Pruefe bei board_lesen die Liste bleibt_im_blick und fasse nach, was faellig ist. Bereite Ergebnisse visuell auf: Kennzahlen, Tabellen, Vergleiche, Link-Karten oder kleine Mockups als widgets, Mailwechsel als verlauf. Bei einem fertigen Feature ist die erste Link-Karte immer der Direktlink auf die Stelle in der App, ein GitHub-PR nur danach als technische Quelle. Hole das Fenster nach vorne, ueber das ihr gerade sprecht. Jede Karte traegt eine Statusleiste, die Marcel sofort sagt, wer was tut: taetigkeit (was gerade tatsaechlich passiert, als Satz), zustaendig (Tony, Claude, Marcel, GitHub Actions, eine Firma), bei Warten warten_auf (marcel | extern | agent | zugang) und wartegrund (die konkrete Abhaengigkeit), naechste_aktion (was als Naechstes passiert und wer es macht) und bei einem Abbruch fehler. Die Statuszeile allein beweist nichts: ohne taetigkeit schreibt das Board 'Status nicht aktuell bestaetigt', und wartende Karten zeigen keine laufende Arbeit an. Melde darum bei jedem Zwischenschritt die echte Taetigkeit nach, erfinde nie Prozentzahlen oder Restzeiten, und setze statt eines stillen Weiterwartens den passenden Status. status braucht_dich nur, wenn Marcel wirklich entscheiden oder etwas liefern muss, und dann immer mit der konkreten Frage in von_dir; wartest du nur technisch (Deploy, Build, Claude), ist der status wartet mit warten_auf und wartegrund und von_dir leer. Vor dem Senden einer Mail: freigabe_anfragen, dann board_lesen bis freigegeben. Lies mit board_lesen regelmaessig, was Marcel eingegeben und Claude geantwortet hat. Code-, App-, Daten- und Deploy-Themen gibst du mit an_claude an Claude weiter.",
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
      // Marcels Klick ist ein bestaetigtes Signal: die Karte darf danach ehrlich "arbeitet" zeigen
      await db.from("tony_board_fenster").update({
        freigabe: art === "freigabe" ? "freigegeben" : "abgelehnt",
        freigabe_kommentar: text || null,
        status: art === "freigabe" ? "arbeitet" : "braucht_dich",
        taetigkeit: art === "freigabe"
          ? "Marcel hat freigegeben, Tony nimmt die Arbeit wieder auf."
          : "Marcel hat eine Aenderung gewuenscht, Tony ueberarbeitet.",
        bestaetigt_am: new Date().toISOString(),
        warten_auf: art === "freigabe" ? null : "marcel",
        wartegrund: null,
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
    if (b.zurueck) {
      await db.from("tony_board_fenster").update({ geschlossen: false, geaendert: new Date().toISOString() }).eq("id", b.id);
      await setzeZustand({ fokus: b.id });
    } else await archivieren(b.id);
    return json({ ok: true });
  }

  // Board: Marcel hakt einen Punkt in "Bleibt im Blick" ab
  if (bereich === "api" && aktion === "blick-erledigt" && req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (!b.id) return json({ error: "id fehlt" }, 400);
    await db.from("tony_board_blick").update({ erledigt_am: new Date().toISOString() }).eq("id", b.id).is("erledigt_am", null);
    await db.from("tony_board_eingang").insert({ fenster_id: null, art: "nachricht", text: `[Bleibt im Blick] abgehakt: ${String(b.text ?? b.id).slice(0, 300)}` });
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
