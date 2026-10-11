import { chromium } from "playwright-core";
const DATEI = "file:///C:/Users/m.gutthann/Desktop/NoraNotes.ai%20Claude/tony-board/docs/index.html#k=test";
const vor = m => new Date(Date.now()-m*60000).toISOString();
const F = [
  {id:"logo", app:"noranotes", titel:"Echtes NoraNotes-Logo im Board", status:"fertig", kernaussage:"Logo und Aktivitaetsanzeige liegen bereit.", geaendert:vor(5), schritte:[{text:"Bauen",erledigt:true}]},
  {id:"volker", app:"gmail", titel:"Volker Maegdefrau – Nachweise fuer Termin 12.10.", status:"arbeitet", kernaussage:"Sechs Punkte abgeglichen, Belege werden nachgeschaerft.", auftrag:"Funktionsnachweise zeigen", geaendert:vor(2), widgets:[{typ:"kennzahlen",titel:"Stand",daten:{werte:[{wert:"6",label:"Punkte"},{wert:"0",label:"live getestet"}]}}], schritte:[{text:"Abgleich",erledigt:true},{text:"Belege",aktuell:true}]},
  {id:"mail", app:"outlook", titel:"Antwort an Kanzlei zum AVV", status:"braucht_dich", kernaussage:"Entwurf fertig.", von_dir:"Darf die Mail so raus?", freigabe:"angefragt", geaendert:vor(1), inhalt:"Sehr geehrte Damen und Herren,\n\nanbei ..."},
  {id:"alt", app:"jira", titel:"NN-240 Sync pruefen", status:"arbeitet", kernaussage:"Seit Laengerem ohne Meldung.", geaendert:vor(25)},
  {id:"kal", app:"kalender", titel:"Termine naechste Woche", status:"wartet", kernaussage:"Wartet auf Rueckmeldung von Sebastian.", geaendert:vor(40)},
];
let zustand = {fenster:F, fokus:"volker", ansicht:"mehrfenster", todos:[{text:"AVV klaeren"},{text:"Logo live",erledigt:true}], absprache:[], eingang:[], archiv:[]};
const ok = (b,m) => { console.log((b?"OK   ":"FEHL ")+m); if(!b) process.exitCode=1; };
const browser = await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe"});
async function seite(opts){
  const ctx = await browser.newContext(opts);
  await ctx.route("https://lzrfyxejlejxfpvqpket.supabase.co/**", r => r.fulfill({contentType:"application/json", body: (()=>{ const q=r.request(); if(q.method()==="POST"&&q.url().endsWith("/ansicht")) zustand={...zustand, ansicht:JSON.parse(q.postData()).ansicht}; return q.method()==="GET" ? JSON.stringify(zustand) : "{}"; })()}));
  await ctx.route("https://fonts.**", r => r.abort());
  const p = await ctx.newPage(); const fehler=[]; p.on("pageerror", e=>fehler.push(e.message));
  await p.goto(DATEI); await p.waitForSelector("#lliste .sitzung"); p.fehler = fehler; return p;
}
const detailTitel = p => p.$eval("#detail .f-titel b", e=>e.textContent);
const warte = ms => new Promise(r=>setTimeout(r,ms));

// Desktop
let p = await seite({viewport:{width:1440,height:900}});
const reihen = await p.$$eval("#lliste .sitzung", es=>es.map(e=>e.dataset.sid));
ok(reihen.length===5, "Leiste zeigt alle 5 Sitzungen");
ok(reihen[0]==="mail", "Braucht-dich steht oben: "+reihen.join(","));
ok(await p.$eval("#lliste", e=>e.querySelector(".gruppe").textContent)==="Braucht dich", "Gruppenueberschrift Braucht dich");
ok((await detailTitel(p)).startsWith("Volker"), "Ohne Auswahl folgt Inhalt Tonys Fokus");
ok(await p.$eval('[data-sid="volker"] .tony', e=>!!e), "Marke 'Tony hier' an Fokus-Sitzung");
ok(await p.$eval('[data-sid="alt"]', e=>e.classList.contains("still")), "Arbeitet ohne Meldung 25 Min -> still");
ok(await p.$eval('[data-sid="volker"]', e=>!e.classList.contains("still")), "Frische arbeitet-Sitzung animiert");
ok(await p.$eval(".todos", e=>getComputedStyle(e).display)==="none", "Schwebende To-dos in Mehrfenster ausgeblendet");
ok((await p.$$("#ltodos li")).length===2, "To-dos in der Leiste");
ok(await p.$eval('[data-sid="mail"] .s-stand', e=>e.textContent)==="Darf die Mail so raus?", "Braucht-dich zeigt 'Von dir' in der Leiste");
await p.screenshot({path:"1-desktop.png"});
// Hover
await p.hover('[data-sid="kal"]'); await warte(350);
ok((await detailTitel(p)).startsWith("Termine"), "Hover zeigt Vorschau");
ok(await p.$eval("#detail .band", e=>e.textContent.includes("Vorschau")), "Vorschau ist als solche markiert");
await p.screenshot({path:"2-hover.png"});
await p.mouse.move(1300,450); await warte(100);
ok((await detailTitel(p)).startsWith("Volker"), "Maus raus -> zurueck zur Auswahl");
// Klick haelt Auswahl gegen neuen Fokus
await p.click('[data-sid="kal"]'); await warte(100);
ok((await detailTitel(p)).startsWith("Termine"), "Klick waehlt Sitzung");
ok(await p.$eval("#ziel", e=>e.textContent)==="Zu: Termine naechste Woche", "Eingabe geht an gewaehlte Sitzung");
zustand = {...zustand, fokus:"mail"}; await warte(1800);
ok((await detailTitel(p)).startsWith("Termine"), "Neuer Tony-Fokus verdraengt frische Auswahl nicht");
ok(await p.$eval("#detail .band", e=>e.textContent.includes("Antwort an Kanzlei")), "Band nennt, wo Tony jetzt ist / was dich braucht");
await p.screenshot({path:"3-gehalten.png"});
await p.click("[data-folgen]"); await warte(100);
ok((await detailTitel(p)).startsWith("Antwort"), "'Dorthin' folgt Tony");
// Nach Ruhezeit folgt neuer Fokus
await p.click('[data-sid="kal"]'); console.log("  auswahl vor Ruhe:", await p.evaluate("auswahl"), await p.evaluate("bedient = Date.now()-100000, typeof window.bedient"));
zustand = {...zustand, fokus:"logo"}; await warte(1800);
console.log("  detail:", await detailTitel(p), await p.evaluate("vorschau+\"/\"+auswahl")); ok((await detailTitel(p)).startsWith("Echtes"), "Nach 90 s ohne Bedienung folgt Ansicht Tony");
// Tastatur
await p.click('[data-sid="mail"]'); await p.keyboard.press("ArrowDown"); await warte(100);
ok((await detailTitel(p)).startsWith("Volker"), "Pfeil runter waehlt naechste Sitzung");
// Rondell unberuehrt
await p.click('#umschalter [data-a="rondell"]'); await warte(700);
ok((await p.$$("#rondell .fenster")).length===5 && await p.$eval("#mehr", e=>getComputedStyle(e).display)==="none", "Rondell eigene Ansicht mit 5 Fenstern");
await p.screenshot({path:"4-rondell.png"});
ok(p.fehler.length===0, "Keine JS-Fehler Desktop "+p.fehler.join("|"));
zustand = {...zustand, fokus:"volker", ansicht:"mehrfenster"};
// iPad Touch quer + hoch
for (const [w,h,n] of [[1180,820,"5-ipad-quer"],[820,1180,"6-ipad-hoch"]]){
  p = await seite({viewport:{width:w,height:h}, hasTouch:true, isMobile:true});
  await p.tap('[data-sid="kal"]'); await warte(400);
  ok((await detailTitel(p)).startsWith("Termine") && !(await p.$eval("#detail", e=>e.classList.contains("vorschau"))), `${n}: Antippen waehlt direkt, keine Vorschau`);
  const lb = await p.$eval(".leiste", e=>e.getBoundingClientRect().width);
  ok(lb > 200, `${n}: Leiste sichtbar (${Math.round(lb)} px)`);
  await p.screenshot({path:n+".png"}); ok(p.fehler.length===0, n+": keine JS-Fehler");
}
// Handy
p = await seite({viewport:{width:390,height:844}, hasTouch:true, isMobile:true});
const box = await p.$eval(".leiste", e=>{const r=e.getBoundingClientRect(); return [r.width,r.height];});
ok(box[0] > 300, "Handy: Leiste oben in voller Breite");
await p.tap('[data-sid="mail"]'); await warte(300);
ok((await detailTitel(p)).startsWith("Antwort"), "Handy: Antippen waehlt");
await p.screenshot({path:"7-handy.png"}); ok(p.fehler.length===0, "Handy: keine JS-Fehler");
// Leer
zustand = {...zustand, fenster:[], fokus:null};
p = await seite({viewport:{width:1440,height:900}}).catch(()=>null);
await browser.close();
