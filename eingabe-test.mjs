import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
const DATEI = new URL("docs/index.html", pathToFileURL(import.meta.dirname + "/")).href + "#k=test";
const BILDER = "/tmp/eingabe-test/";
mkdirSync(BILDER, {recursive:true});
const vor = m => new Date(Date.now()-m*60000).toISOString();
const tag = d => new Date(Date.now()+d*864e5).toLocaleDateString("sv-SE");
const kurz = d => new Date(d).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"});
const HEUTE = tag(0), FRUEHER = tag(-3), SPAETER = tag(5);

// Drei Karten im gleichen Bereich, damit das Blaettern im Rondell etwas bewirkt.
// Alle "arbeitet" mit frischem Signal: gleiche Prioritaet, also bleibt die Anlage-Reihenfolge.
const F = [
  {id:"a", app:"github", titel:"Karte A Logo", bereich:"technik", status:"arbeitet", kernaussage:"Logo liegt bereit.",
   taetigkeit:"Logo im Rondell gegengesehen.", zustaendig:"Claude", bestaetigt_am:vor(1), geaendert:vor(1)},
  {id:"b", app:"jira", titel:"Karte B Nachweise", bereich:"technik", status:"arbeitet", kernaussage:"Sechs Punkte abgeglichen.",
   taetigkeit:"Beleg 4 von 6 wird nachgestellt.", zustaendig:"Claude", bestaetigt_am:vor(2), geaendert:vor(2)},
  {id:"c", app:"notiz", titel:"Karte C Sync", bereich:"technik", status:"arbeitet", kernaussage:"Sync laeuft durch.",
   taetigkeit:"Sync-Lauf angestossen.", zustaendig:"Claude", bestaetigt_am:vor(3), geaendert:vor(3)},
];
// Absichtlich verdrehte Reihenfolge: der Test prueft, dass die Seite selbst sortiert
const BLICK = [
  {id:3, text:"Rechte beim Kunden klaeren", wer:"Tony"},
  {id:4, text:"Spaetere Abnahme vorbereiten", wer:"Tony", nachfassen_am:SPAETER, fenster_id:"c", karte_titel:"Karte C Sync",
   geprueft_am:HEUTE, pruefstand:"laeuft noch"},
  {id:2, text:"Abnahme von Marcel holen", wer:"Tony", nachfassen_am:HEUTE, fenster_id:"weg", karte_titel:"Geschlossene Karte Z"},
  {id:1, text:"Antwort der Kanzlei nachfassen", wer:"Tony", nachfassen_am:FRUEHER, fenster_id:"a", karte_titel:"Karte A Logo",
   geprueft_am:FRUEHER, pruefstand:"Noch keine Antwort"},
];
let zustand = {fenster:F, fokus:"b", ansicht:"rondell", blick:BLICK, absprache:[], eingang:[], archiv:[]};
const posts = [];
let n = 0, gut = 0;
const ok = (b,m) => { n++; if (b) gut++; console.log((b?"OK   ":"FEHL ")+m); if(!b) process.exitCode=1; };
const browser = await chromium.launch({executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe"});
async function seite(opts){
  const ctx = await browser.newContext(opts);
  await ctx.route("https://lzrfyxejlejxfpvqpket.supabase.co/**", r => r.fulfill({contentType:"application/json", body: (()=>{
    const q = r.request();
    if (q.method() === "POST"){
      const pfad = new URL(q.url()).pathname.split("/").pop();
      const body = JSON.parse(q.postData() || "{}");
      posts.push({pfad, body});
      if (pfad === "ansicht") zustand = {...zustand, ansicht: body.ansicht};
      return "{}";
    }
    return JSON.stringify(zustand);
  })()}));
  await ctx.route("https://fonts.**", r => r.abort());
  const p = await ctx.newPage(); const fehler = []; p.on("pageerror", e => fehler.push(e.message));
  await p.goto(DATEI); await p.waitForSelector("#rondell .fenster.vorn"); p.fehler = fehler; return p;
}
const warte = ms => new Promise(r=>setTimeout(r,ms));
const ziel = p => p.$eval("#ziel", e => e.textContent);
const fest = p => p.$eval("#ziel", e => e.classList.contains("fest"));
const feld = p => p.$eval("#text", e => e.value);
// Senden und auf den Netzaufruf warten, damit der Rumpf sicher vorliegt
async function absenden(p){
  const alt = posts.length;
  await p.press("#text", "Enter");
  for (let i = 0; i < 60 && posts.length === alt; i++) await warte(50);
  return posts.at(-1);
}
const blickListe = (p, sel) => p.$$eval(sel + " li", es => es.map(e => {
  const t = e.querySelector(".b-text");
  return {klasse: e.className,
          text: t ? t.childNodes[0].textContent.trim() : e.textContent.trim(),
          termin: e.querySelector(".termin")?.textContent || "",
          meta: t ? (t.querySelector("small:last-child")?.textContent || "") : ""};
}));

const p = await seite({viewport:{width:1440,height:900}});

// A) Bezug der Nachricht auf die Karte
ok(await ziel(p) === "Zu: Karte A Logo", "1 Ohne Eingabe folgt die Zielanzeige der vorderen Karte");
await p.click("#vor"); await warte(150);
ok(await ziel(p) === "Zu: Karte B Nachweise", "1 Weiterblaettern zieht die Zielanzeige mit");
await p.click("#zurueck"); await warte(150);
ok(await ziel(p) === "Zu: Karte A Logo", "1 Zurueckblaettern ebenso");

await p.fill("#text", "Bitte das Logo noch einmal pruefen");
ok(await ziel(p) === "Zu: Karte A Logo" && await fest(p), "2 Tippen haelt die Karte fest (Klasse fest)");
await p.click("#vor"); await warte(150); await p.click("#vor"); await warte(150);
ok(await p.$eval("#rondell .fenster.vorn", e => e.dataset.id) === "c", "2 Rondell steht jetzt auf Karte C");
ok(await ziel(p) === "Zu: Karte A Logo" && await fest(p), "2 Festgehaltene Karte bleibt trotz Weiterblaettern");
await p.screenshot({path:BILDER+"1-festgehalten.png"});

let e = await absenden(p);
ok(e.pfad === "eingabe" && e.body.fenster_id === "a", "3 Gesendet wird die festgehaltene Karte: " + JSON.stringify(e.body.fenster_id));
ok(e.body.art === "nachricht" && e.body.text === "Bitte das Logo noch einmal pruefen", "3 Rumpf traegt Text und Art");
await warte(150);
ok(await feld(p) === "", "4 Feld ist nach dem Absenden leer");
ok(!await fest(p), "4 Klasse fest ist weg");
ok(await ziel(p) === "Zu: Karte C Sync", "4 Zielanzeige folgt wieder der vorderen Karte");
await p.fill("#text", "Und hier noch der Sync");
e = await absenden(p);
ok(e.body.fenster_id === "c", "4 Zweite Nachricht geht an die neue Karte: " + JSON.stringify(e.body.fenster_id));

await warte(150);
await p.fill("#text", "Zwischendurch getippt");
await p.click("#vor"); await warte(150);
ok(await ziel(p) === "Zu: Karte C Sync" && await fest(p), "5 Karte ist festgehalten");
await p.fill("#text", "");
ok(await ziel(p) === "Zu: Karte A Logo" && !await fest(p), "5 Feld leeren gibt die Karte wieder frei");

// B) Bleibt im Blick als Wiedervorlage (Rondell-Liste)
const B = await blickListe(p, "#todos");
ok(B.length === 4, "8 Vier Punkte in der Liste");
ok(B[0].termin === "überfällig seit 3 Tagen (" + kurz(FRUEHER) + ")", "8 Vergangener Termin wird als ueberfaellig benannt: " + B[0].termin);
ok(B[1].termin === "heute fällig", "8 Termin heute wird als heute faellig benannt: " + B[1].termin);
ok(B[2].termin === "Prüftermin fehlt", "8 Punkt ohne Termin wird benannt: " + B[2].termin);
ok(B[3].termin === "Prüfung am " + kurz(SPAETER), "8 Zukuenftiger Termin nennt das Datum: " + B[3].termin);
ok(B.map(x=>x.text).join("|") === "Antwort der Kanzlei nachfassen|Abnahme von Marcel holen|Rechte beim Kunden klaeren|Spaetere Abnahme vorbereiten",
   "9 Reihenfolge faellig, ohne Termin, spaeter: " + B.map(x=>x.text).join("|"));
ok(B[0].klasse === "faellig" && B[1].klasse === "faellig", "9 Faellige Punkte sind als faellig markiert");
ok(B[0].meta.includes("Karte: Karte A Logo"), "10 Punkt nennt die offene Karte: " + B[0].meta);
ok(B[1].meta.includes("Karte: Geschlossene Karte Z"), "10 Punkt nennt auch die nicht mehr offene Karte: " + B[1].meta);
ok(B[2].meta.includes("ohne Karte"), "10 Punkt ohne Karte sagt es: " + B[2].meta);
ok(await p.$eval('#todos li:nth-child(2) .b-text', el => !el.hasAttribute("data-zeige")), "10 Nicht mehr offene Karte ist kein Sprungziel");
ok(B[0].meta.includes("geprüft " + kurz(FRUEHER) + ": Noch keine Antwort"), "11 Letzte Pruefung mit Datum und Stand: " + B[0].meta);
ok(B[3].meta.includes("geprüft " + kurz(HEUTE) + ": laeuft noch"), "11 Auch beim spaeteren Punkt: " + B[3].meta);
ok(B[2].meta.includes("noch nicht geprüft"), "11 Ohne Pruefung steht es ausdruecklich da: " + B[2].meta);
ok(await p.$eval("#hblick", el => el.textContent) === "Bleibt im Blick · 2 fällig", "12 Ueberschrift nennt die Zahl der faelligen Punkte");
await p.screenshot({path:BILDER+"2-blick.png"});
zustand = {...zustand, blick: BLICK.filter(b => b.id === 3 || b.id === 4)};
await warte(1900);
ok(await p.$eval("#hblick", el => el.textContent) === "Bleibt im Blick", "12 Ohne faellige Punkte steht nur Bleibt im Blick");
zustand = {...zustand, blick: BLICK};
await warte(1900);

// A6) Archiv: keine Karte vorne, also ausdruecklich ohne Karte an Tony
await p.click('#umschalter button[data-a="archiv"]'); await warte(200);
ok(await ziel(p) === "Ohne Karte · an Tony", "6 Im Archiv sagt die Zielanzeige, dass es ohne Karte an Tony geht");
await p.fill("#text", "Frage ohne Kartenbezug");
ok(await ziel(p) === "Ohne Karte · an Tony", "6 Auch beim Tippen wird im Archiv keine Karte zugeordnet");
e = await absenden(p);
ok(e.body.fenster_id === null, "6 Gesendeter Rumpf hat fenster_id null: " + JSON.stringify(e.body.fenster_id));
await p.screenshot({path:BILDER+"3-archiv.png"});

// A7) Mehrfenster: die links gewaehlte Sitzung zaehlt, nicht Tonys Fokus
await p.click('#umschalter button[data-a="mehrfenster"]'); await warte(400);
await p.click('#lliste [data-sid="c"]'); await warte(200);
ok(await ziel(p) === "Zu: Karte C Sync", "7 Nachricht bezieht sich auf die gewaehlte Sitzung, nicht auf Tonys Fokus b");
await p.fill("#text", "Zur gewaehlten Sitzung");
await p.click('#lliste [data-sid="a"]'); await warte(200);
ok(await ziel(p) === "Zu: Karte C Sync" && await fest(p), "2 Andere Auswahl verdraengt die festgehaltene Karte nicht");
zustand = {...zustand, fokus:"a"}; await warte(1900);
ok(await ziel(p) === "Zu: Karte C Sync" && await fest(p), "2 Tonys neuer Fokus verdraengt die festgehaltene Karte nicht");
e = await absenden(p);
ok(e.body.fenster_id === "c", "7 Gesendet wird die gewaehlte Sitzung: " + JSON.stringify(e.body.fenster_id));
await warte(200);
ok(await ziel(p) === "Zu: Karte A Logo", "7 Danach folgt die Zielanzeige wieder der Auswahl");
const L = await blickListe(p, "#ltodos");
ok(L.map(x=>x.text).join("|") === B.map(x=>x.text).join("|"), "9 Mehrfenster-Liste zeigt dieselbe Reihenfolge");
ok(await p.$eval("#lblick", el => el.textContent) === "Bleibt im Blick · 4 · 2 fällig", "12 Leisten-Ueberschrift nennt Gesamtzahl und faellige");
await p.screenshot({path:BILDER+"4-mehrfenster.png"});

ok(p.fehler.length === 0, "Keine JS-Fehler: " + p.fehler.join("|"));
await browser.close();
console.log(`\nGesamt: ${gut}/${n} Pruefungen gruen`);
