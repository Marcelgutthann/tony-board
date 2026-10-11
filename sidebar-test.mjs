import { chromium } from "playwright-core";
const DATEI = "file:///C:/Users/m.gutthann/Desktop/NoraNotes.ai%20Claude/tony-board/docs/index.html#k=test";
const vor = m => new Date(Date.now()-m*60000).toISOString();
const F = [
  {id:"logo", app:"noranotes", titel:"Echtes NoraNotes-Logo im Board", status:"fertig", kernaussage:"Logo und Aktivitaetsanzeige liegen bereit.", geaendert:vor(5), schritte:[{text:"Bauen",erledigt:true}]},
  {id:"volker", app:"gmail", titel:"Volker Maegdefrau – Nachweise fuer Termin 12.10.", status:"arbeitet", kernaussage:"Sechs Punkte abgeglichen, Belege werden nachgeschaerft.", auftrag:"Funktionsnachweise zeigen", geaendert:vor(2), widgets:[{typ:"kennzahlen",titel:"Stand",daten:{werte:[{wert:"6",label:"Punkte"},{wert:"0",label:"live getestet"}]}}], schritte:[{text:"Abgleich",erledigt:true},{text:"Belege",aktuell:true}]},
  {id:"mail", app:"outlook", titel:"Antwort an Kanzlei zum AVV", status:"braucht_dich", kernaussage:"Entwurf fertig.", von_dir:"Darf die Mail so raus?", freigabe:"angefragt", geaendert:vor(1), inhalt:"Sehr geehrte Damen und Herren,\n\nanbei ..."},
  {id:"alt", app:"jira", titel:"NN-240 Sync pruefen", status:"arbeitet", kernaussage:"Seit Laengerem ohne Meldung.", geaendert:vor(25)},
  {id:"kal", app:"kalender", titel:"Termine naechste Woche", status:"wartet", kernaussage:"Wartet auf Rueckmeldung von Sebastian.", von_dir:"Build laeuft noch", geaendert:vor(40)},
  {id:"ohne", app:"notiz", titel:"Frage vergessen", status:"braucht_dich", kernaussage:"Tony hat keine Frage gesetzt.", geaendert:vor(3)},
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
ok(reihen.length===6, "Leiste zeigt alle 6 Sitzungen");
ok(reihen[0]==="mail", "Braucht-dich steht oben: "+reihen.join(","));
ok(await p.$eval("#lliste", e=>e.querySelector(".gruppe").textContent)==="Braucht dich", "Gruppenueberschrift Braucht dich");
ok((await detailTitel(p)).startsWith("Volker"), "Ohne Auswahl folgt Inhalt Tonys Fokus");
ok(await p.$eval('[data-sid="volker"] .tony', e=>!!e), "Marke 'Tony hier' an Fokus-Sitzung");
ok(await p.$eval('[data-sid="alt"]', e=>e.classList.contains("still")), "Arbeitet ohne Meldung 25 Min -> still");
ok(await p.$eval('[data-sid="volker"]', e=>!e.classList.contains("still")), "Frische arbeitet-Sitzung animiert");
ok(await p.$eval(".todos", e=>getComputedStyle(e).display)==="none", "Schwebende To-dos in Mehrfenster ausgeblendet");
ok((await p.$$("#ltodos li")).length===2, "To-dos in der Leiste");
ok(await p.$eval('[data-sid="mail"] .s-stand', e=>e.textContent)==="Darf die Mail so raus?", "Braucht-dich zeigt die konkrete Frage in der Leiste");
ok(await p.$eval('[data-sid="ohne"] .s-stand', e=>e.textContent.startsWith("Frage fehlt")), "Braucht-dich ohne Frage wird als fehlend benannt");
ok(await p.$$eval("#lliste .sitzung", es=>es.every(e=>{const s=e.querySelector(".status"); return s && s.getBoundingClientRect().width>20 && getComputedStyle(s).visibility!=="hidden";})), "Status in jedem Leistenknopf sichtbar, ohne Hover");
await p.screenshot({path:"1-desktop.png"});
// Hover
await p.hover('[data-sid="kal"]'); await warte(350);
ok((await detailTitel(p)).startsWith("Termine"), "Hover oeffnet Sitzung gross");
ok(await p.$eval('[data-sid="kal"] .logo', e=>new DOMMatrix(getComputedStyle(e).transform).a > 1.05), "Hover vergroessert das Logo im Knopf");
ok(await p.$$eval("#detail .lage .z", es=>es.some(e=>e.querySelector("span").textContent==="Offen" && !e.classList.contains("vondir")) && !es.some(e=>e.classList.contains("vondir"))), "Wartet mit von_dir wird nicht als Frage an Marcel gezeigt");
await p.screenshot({path:"2-hover.png"});
await p.mouse.move(1300,450); await warte(100);
ok((await detailTitel(p)).startsWith("Termine"), "Maus raus -> Sitzung bleibt gross stehen");
await p.hover('[data-sid="logo"]'); await warte(350); await p.mouse.move(1300,450); await warte(100);
ok((await detailTitel(p)).startsWith("Echtes"), "Naechster Hover wechselt den Inhalt");
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
// Auswahl bleibt dauerhaft: Hover, Maus raus, 10 Min. spaeter neuer Fokus + neue Frage
{ const b = await p.$eval('[data-sid="kal"]', e=>{const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2+3];}); await p.mouse.move(b[0], b[1], {steps:5}); }
await warte(350); ok((await detailTitel(p)).startsWith("Termine"), "Hover waehlt Sitzung"); await p.mouse.move(1300,450, {steps:5});
await p.evaluate("{ const r = Date.now; Date.now = () => r() + 600000; }");
zustand = {...zustand, fokus:"logo", fenster:[...F, {id:"neu", app:"notiz", titel:"Neue Rueckfrage", status:"braucht_dich", von_dir:"Passt das?", geaendert:vor(0)}]}; await warte(1800);
ok((await detailTitel(p)).startsWith("Termine"), "Nach Mausleave und spaeterem Tony-Fokus bleibt die Auswahl stehen");
ok(await p.$eval("#detail .band", e=>e.textContent.includes("Echtes")), "Neuer Fokus erscheint nur als Hinweis-Band");
ok(await p.$eval('[data-sid="neu"] .s-stand', e=>e.textContent)==="Passt das?", "Neue Rueckfrage steht als Hinweis in der Leiste");
zustand = {...zustand, fenster:F, fokus:"mail"};
// Tastatur
await p.click('[data-sid="mail"]'); await p.keyboard.press("ArrowDown"); await warte(100);
ok((await detailTitel(p)).startsWith("Frage vergessen"), "Pfeil runter waehlt naechste Sitzung");
// Rondell unberuehrt
await p.click('#umschalter [data-a="rondell"]'); await warte(700);
ok((await p.$$("#rondell .fenster")).length===6 && await p.$eval("#mehr", e=>getComputedStyle(e).display)==="none", "Rondell eigene Ansicht mit 6 Fenstern");
await p.screenshot({path:"4-rondell.png"});
ok(p.fehler.length===0, "Keine JS-Fehler Desktop "+p.fehler.join("|"));
zustand = {...zustand, fokus:"volker", ansicht:"mehrfenster"};
// Reduced motion: kein Vergroessern
p = await seite({viewport:{width:1440,height:900}, reducedMotion:"reduce"});
await p.hover('[data-sid="kal"]'); await warte(350);
ok(await p.$eval('[data-sid="kal"] .logo', e=>getComputedStyle(e).transform)==="none", "Reduced motion: keine Vergroesserung");
ok((await detailTitel(p)).startsWith("Termine"), "Reduced motion: Hover oeffnet trotzdem");
// iPad Touch quer + hoch
for (const [w,h,n] of [[1180,820,"5-ipad-quer"],[820,1180,"6-ipad-hoch"]]){
  p = await seite({viewport:{width:w,height:h}, hasTouch:true, isMobile:true});
  await p.tap('[data-sid="kal"]'); await warte(400);
  ok((await detailTitel(p)).startsWith("Termine"), `${n}: Antippen waehlt direkt, keine Vorschau`);
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
