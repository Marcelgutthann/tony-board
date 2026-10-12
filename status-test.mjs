// Statusdarstellung je Zustand und ueber einen ganzen Verlauf hinweg:
//   CHROME=<chrome> node status-test.mjs [bilderordner]
// Schreibt je Zustand ein Kartenbild in den Bilderordner (Standard: /tmp/board-status).
import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DATEI = new URL("docs/index.html", pathToFileURL(import.meta.dirname + "/")).href + "#k=test";
const BILDER = process.argv[2] || "/tmp/board-status";
mkdirSync(BILDER, { recursive: true });
const vor = m => new Date(Date.now() - m * 60000).toISOString();
const ok = (b, m) => { console.log((b ? "OK   " : "FEHL ") + m); if (!b) process.exitCode = 1; };
const warte = ms => new Promise(r => setTimeout(r, ms));

// Schaudaten, bewusst ohne Kundennamen: der Fall wandert durch alle Zustaende
const SCHRITTE = [
  { text: "Lücke im PDF-Export eingegrenzt", erledigt: true },
  { text: "Codeprüfung abgeschlossen", erledigt: true },
  { text: "Lücke beheben und Regressionen testen", aktuell: true },
  { text: "Vollständigen Export auf Staging abnehmen" },
];
const basis = {
  id: "fall", app: "code", bereich: "technik", titel: "PDF-Export: fehlende Zeilen beheben",
  auftrag: "Fehlende Zeilen im PDF-Export finden und beheben.", schritte: SCHRITTE,
  kopf: {}, inhalt: "", verlauf: [], geaendert: vor(1),
  widgets: [{ typ: "kennzahlen", titel: "Export", daten: { werte: [
    { wert: "4", label: "fehlende Zeilen", hinweis: "in der Schaudatei" },
    { wert: "1", label: "Ursache", hinweis: "Seitenumbruch" },
    { wert: "0", label: "offene Regressionen" }] } }],
};
const FAELLE = {
  arbeitet: { ...basis, status: "arbeitet", kernaussage: "Ursache gefunden, **Regressionstest** läuft gegen staging.",
    taetigkeit: "Regressionstest für den PDF-Export geschrieben, er läuft jetzt gegen staging.", zustaendig: "Claude",
    naechste_aktion: "Testergebnis lesen und den Fix auf staging abnehmen.", bestaetigt_am: vor(2) },
  marcel: { ...basis, status: "braucht_dich", kernaussage: "Fix liegt bereit, **kostenpflichtiger** Prüflauf offen.",
    taetigkeit: "Fix und Testfall liegen fertig im Zweig.", zustaendig: "Claude", warten_auf: "marcel",
    von_dir: "Darf ich den kostenpflichtigen Prüflauf starten?", freigabe: "angefragt",
    naechste_aktion: "Nach deiner Freigabe den Prüflauf starten und das Ergebnis prüfen.", bestaetigt_am: vor(3) },
  extern: { ...basis, status: "wartet", kernaussage: "Prüflauf gestartet, **Ergebnis** steht aus.",
    taetigkeit: "Prüflauf 1148 gestartet und beobachtet.", zustaendig: "GitHub Actions", warten_auf: "extern",
    wartegrund: "Prüflauf 1148 muss durchlaufen; er hängt seit vier Minuten in der Warteschlange.",
    naechste_aktion: "Ergebnis lesen, dann den Export auf staging abnehmen.", bestaetigt_am: vor(4) },
  fertig: { ...basis, status: "fertig", kernaussage: "**Fix auf staging** abgenommen, Export vollständig.",
    taetigkeit: "Fix auf staging abgenommen, alle vier Zeilen stehen im Export.", zustaendig: "Claude",
    bestaetigt_am: vor(6), schritte: [...SCHRITTE.slice(0, 2), { ...SCHRITTE[2], erledigt: true }, { ...SCHRITTE[3], aktuell: true }] },
  unbestaetigt: { ...basis, status: "arbeitet", kernaussage: "Soll laufen, aber **seit 40 Minuten** keine Meldung.",
    taetigkeit: "Regressionstest gegen staging gestartet.", zustaendig: "Claude", bestaetigt_am: vor(40) },
  fehler: { ...basis, status: "wartet", kernaussage: "Prüflauf bricht **vor dem ersten Schritt** ab.",
    taetigkeit: "Abbruchmeldung des Prüflaufs ausgelesen.", zustaendig: "Claude", warten_auf: "extern",
    wartegrund: "Prüflauf 1148 bricht ab, bevor ein Testschritt läuft.",
    fehler: "Prüflauf bricht mit einem Abrechnungsfehler ab; kein Testschritt wurde ausgeführt.",
    naechste_aktion: "Abrechnung prüfen, erst danach erneut starten.", bestaetigt_am: vor(5) },
  zugang: { ...basis, status: "wartet", kernaussage: "Abnahme **blockiert**: Zugang fehlt.",
    taetigkeit: "Abnahmeschritte vorbereitet.", zustaendig: "Marcel", warten_auf: "zugang",
    wartegrund: "Der Schlüssel für den PDF-Dienst fehlt auf staging; nur Marcel kann ihn setzen.",
    naechste_aktion: "Mit gesetztem Schlüssel den Export abnehmen.", bestaetigt_am: vor(7) },
  // Fenster von vorher: nur status und der alte hinweis, keine neuen Felder
  altArbeitet: { ...basis, status: "arbeitet", kernaussage: "Altes Fenster ohne neue Felder.",
    hinweis: "Ich gehe die Exportvorlage Zeile für Zeile durch." },
  altWartet: { ...basis, status: "wartet", kernaussage: "Altes Fenster ohne neue Felder.",
    hinweis: "Kein Job läuft mehr. Die Blockermeldung wird geprüft." },
};

let zustand = { fenster: [FAELLE.arbeitet], fokus: "fall", ansicht: "mehrfenster", blick: [], absprache: [], eingang: [], archiv: [] };
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route("https://lzrfyxejlejxfpvqpket.supabase.co/**", r =>
  r.fulfill({ contentType: "application/json", body: r.request().method() === "GET" ? JSON.stringify(zustand) : "{}" }));
await ctx.route("https://fonts.**", r => r.abort());
const p = await ctx.newPage();
const fehler = []; p.on("pageerror", e => fehler.push(e.message));
await p.goto(DATEI);
await p.waitForSelector("#detail .sl");

// Zustand setzen und warten, bis die Karte neu gezeichnet ist
async function zeige(fall, felder = {}){
  zustand = { ...zustand, fenster: [{ ...FAELLE[fall], ...felder }] };
  await warte(1900);
  return p.$eval("#detail .sl", e => ({
    klassen: [...e.classList], wort: e.querySelector(".wort span").textContent.trim(),
    zeilen: Object.fromEntries([...e.querySelectorAll(".z")].map(z => [z.querySelector("span").textContent, z.querySelector("p").textContent])),
    aktion: e.querySelector(".aktion")?.innerText ?? null, ruhig: e.querySelector(".ruhig")?.textContent ?? null,
    signal: e.querySelector(".signal").textContent, puls: getComputedStyle(e.querySelector(".wort i")).animationName,
  }));
}
const marke = () => p.$eval("#detail .status", e => e.textContent.trim());
const schritte = () => p.$$eval("#detail .schritt", es => es.map(e => ({
  k: [...e.classList].filter(c => c !== "schritt").join(""), dreh: getComputedStyle(e.querySelector(".k")).animationName })));
const bild = async name => p.$eval("#detail .fenster", e => e.scrollIntoView())
  .then(() => p.locator("#detail .fenster").screenshot({ path: path.join(BILDER, name + ".png") }));

// --- Verlauf: arbeitet -> wartet auf Person -> wartet auf externen Job -> fertig ---
let L = await zeige("arbeitet");
ok(L.klassen.includes("arbeitet") && await marke() === "Arbeitet", "1 arbeitet: Leiste und Marke sagen beide 'Arbeitet'");
ok(L.zeilen["Tätigkeit"].startsWith("Regressionstest"), "1 arbeitet: echte Taetigkeit statt Statuswort");
ok(L.zeilen["Als nächstes"].length > 10 && L.ruhig?.includes("Keine Aktion"), "1 arbeitet: naechste Aktion da, keine Aktion von Marcel");
ok(L.signal.startsWith("Zuletzt bestätigt") && !/%|ETA|voraussichtlich/.test(JSON.stringify(L)), "1 arbeitet: bestaetigtes Signal, keine erfundene Zahl");
ok(L.puls === "puls", "1 arbeitet: dezente Bewegung an");
ok((await schritte()).map(s => s.k).join(",") === "erl,erl,akt," && (await schritte())[2].dreh === "dreh", "1 arbeitet: genau ein laufender Schritt");
await bild("1-arbeitet");

L = await zeige("marcel");
ok(L.klassen.includes("marcel") && await marke() === "Braucht dich", "2 wartet auf Person: Marke und Leiste einig");
ok(L.wort === "Wartet auf dich", "2 wartet auf Person: Zustand benannt");
ok(L.aktion?.includes("kostenpflichtigen Prüflauf"), "2 wartet auf Person: konkrete Frage im Aktionskasten");
ok(L.ruhig === null, "2 wartet auf Person: kein 'keine Aktion noetig'");
ok((await p.$$("#detail .sl .aktion .glasknopf")).length === 2, "2 wartet auf Person: Freigeben und Aendern direkt bei der Frage");
ok(L.puls === "none", "2 wartet auf Person: keine Bewegung");
ok((await schritte()).map(s => s.k).join(",") === "erl,erl,halt," && (await schritte())[2].dreh === "none", "2 wartet auf Person: Schritt angehalten, kein Kreisel");
await bild("2-wartet-person");

L = await zeige("extern");
ok(L.klassen.includes("extern") && await marke() === "Wartet extern", "3 externer Job: Marke und Leiste einig");
ok(L.zeilen["Wartet auf"].includes("1148"), "3 externer Job: konkrete Abhaengigkeit statt 'wartet auf Antwort'");
ok(L.zeilen["Als nächstes"].length > 10 && L.ruhig?.includes("Keine Aktion"), "3 externer Job: naechste Aktion da, Marcel muss nichts tun");
ok(L.puls === "none" && (await schritte())[2].dreh === "none", "3 externer Job: nichts dreht sich dauerhaft");
ok((await schritte()).map(s => s.k).join(",") === "erl,erl,halt,", "3 externer Job: Schritt angehalten");
await bild("3-wartet-extern");

L = await zeige("fertig");
ok(L.klassen.includes("fertig") && await marke() === "Fertig", "4 fertig: Marke und Leiste einig");
ok(L.zeilen["Getan"]?.startsWith("Fix auf staging"), "4 fertig: was getan wurde");
ok((await schritte()).every(s => s.k === "erl" || s.k === ""), "4 fertig: kein Schritt mehr als laufend oder angehalten markiert");
ok(L.signal.startsWith("Abschluss gemeldet"), "4 fertig: Abschluss mit Zeitpunkt");
await bild("4-fertig");

// --- Veraltetes Signal, Fehler, fehlender Zugang ---
L = await zeige("unbestaetigt");
ok(L.klassen.includes("unbestaetigt") && L.wort.startsWith("Status nicht aktuell bestätigt"), "5 veraltet: Board behauptet keine laufende Arbeit");
ok(L.wort.endsWith("· Claude"), "5 veraltet: Zustaendiger steht trotzdem dabei");
ok(await marke() === "Nicht bestätigt", "5 veraltet: auch die Marke sagt es");
ok(L.puls === "none" && (await schritte())[2].dreh === "none", "5 veraltet: Bewegung aus");
ok(L.signal.startsWith("Zuletzt bestätigt vor 40"), "5 veraltet: letztes bestaetigtes Signal mit Zeit");
await bild("5-nicht-bestaetigt");

L = await zeige("fehler");
ok(L.klassen.includes("fehler") && await marke() === "Fehler", "6 Fehler: Marke und Leiste einig");
ok(L.zeilen["Fehler"].includes("Abrechnungsfehler"), "6 Fehler: Meldung im Klartext, zuerst");
ok(L.zeilen["Als nächstes"].includes("Abrechnung"), "6 Fehler: naechste Aktion statt Spinner");
ok(L.puls === "none" && (await schritte())[2].k === "halt", "6 Fehler: angehalten");
await bild("6-fehler");

L = await zeige("zugang");
ok(L.klassen.includes("zugang") && await marke() === "Zugang fehlt", "7 Zugang: eigener Zustand, nicht nur 'wartet'");
ok(L.zeilen["Wartet auf"].includes("Schlüssel"), "7 Zugang: woran es genau haengt");
await bild("7-zugang-fehlt");

// --- Fenster von vorher: ohne neue Felder trotzdem brauchbar ---
L = await zeige("altArbeitet");
ok(L.klassen.includes("unbestaetigt"), "8 altes Fenster arbeitet: ohne Signal keine Laufbehauptung");
ok(L.zeilen["Tätigkeit"].startsWith("Ich gehe die Exportvorlage"), "8 altes Fenster: alter hinweis steht als Taetigkeit in der Karte");
await bild("8-alt-arbeitet");

L = await zeige("altWartet");
ok(L.klassen.includes("wartet") && await marke() === "Wartet", "9 altes Fenster wartet: neutrales Warten, keine erfundene Art");
ok(L.zeilen["Wartet auf"].startsWith("Kein Job läuft"), "9 altes Fenster: alter hinweis steht als Wartegrund in der Karte");
await bild("9-alt-wartet");

L = await zeige("altWartet", { hinweis: "" });
ok(L.zeilen["Wartet auf"].includes("Grund nicht genannt"), "10 ganz ohne Grund: Luecke wird benannt, nicht geraten");

// --- Sitzungsleiste: jeder Zustand knapp sichtbar ---
zustand = { ...zustand, fenster: [FAELLE.arbeitet, { ...FAELLE.marcel, id: "f2", titel: "Entwurf für die Kanzlei" },
  { ...FAELLE.extern, id: "f3", titel: "Prüflauf für den Import" }, { ...FAELLE.unbestaetigt, id: "f4", titel: "Sync nachts prüfen" },
  { ...FAELLE.fehler, id: "f5", titel: "Nachtlauf Protokolle" }, { ...FAELLE.fertig, id: "f6", titel: "Spaltenbreiten im Export" }], fokus: "fall" };
await warte(1900);
const leiste = await p.$$eval("#lliste .sitzung", es => es.map(e => ({
  marke: e.querySelector(".status").textContent.trim(), signal: e.querySelector(".signal").textContent,
  unter: e.querySelector(".s-stand")?.textContent ?? "" })));
ok(leiste.length === 6 && leiste.every(z => z.marke && z.unter), "11 Leiste: jede Sitzung mit Marke und einer Zeile");
ok(leiste.map(z => z.marke).join(",") === "Braucht dich,Fehler,Fertig,Wartet extern,Nicht bestätigt,Arbeitet", "11 Leiste: Reihenfolge nach Dringlichkeit: " + leiste.map(z => z.marke).join(","));
ok(leiste.find(z => z.marke === "Wartet extern").unter.startsWith("Wartet auf:"), "11 Leiste: Wartegrund schon in der Leiste");
ok(leiste.every(z => !/letzte Meldung|^vor \d/.test(z.signal)), "11 Leiste: keine blosse Aenderungszeit als Lebenszeichen");
ok(await p.$eval("#lkopf span", e => e.textContent) === "1 braucht dich · 1 mit Fehler · 1 arbeitet · 1 wartet · 1 ohne bestätigtes Signal",
  "11 Leiste: Kopfzeile sagt, warum nichts vorangeht (" + await p.$eval("#lkopf span", e => e.textContent) + ")");
await p.locator(".leiste").screenshot({ path: path.join(BILDER, "10-leiste.png") });

// --- Rondell: dieselbe Leiste in der Karte ---
await p.click('#umschalter [data-a="rondell"]'); await warte(900);
ok(await p.$eval("#rondell .fenster.vorn .sl", e => !!e), "12 Rondell: Statusleiste steht auch dort in der Karte");
ok(await p.$eval("#rondell .fenster.vorn .sl .wort span", e => e.textContent.trim()) === "Wartet auf dich", "12 Rondell: vorderste Karte ist die, die dich braucht");
await p.screenshot({ path: path.join(BILDER, "11-rondell.png") });
ok(fehler.length === 0, "13 Keine JS-Fehler: " + fehler.join(" | "));
await browser.close();
