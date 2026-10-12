#!/usr/bin/env python3
"""Probe fuer die Kontrolle ohne KI: zeigt, was ein Herzschlag JETZT melden wuerde.

    TONY_BOARD_KEY=... python3 herzschlag-probe.py [--json]

Nichts davon laeuft von selbst: kein Dienst, kein Timer, kein KI-Aufruf, kein neuer Zugang.
Das Skript liest einmal GET /state (denselben Weg, den die Board-Seite ohnehin nimmt) und
rechnet. board_lesen wird bewusst NICHT aufgerufen - das wuerde Marcels Eingaben als von
Tony gelesen markieren.

Gemeldet wird nur, was sich aus Tatsachen ergibt. Nie wird ein Lebenszeichen erfunden:
Die Probe setzt selbst nichts im Board.
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone

API = "https://lzrfyxejlejxfpvqpket.supabase.co/functions/v1/tony-board/api"
FRISCH_MIN = 15  # dieselbe Grenze wie im Board

def zeit(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None

def minuten(t, jetzt):
    return None if t is None else (jetzt - t).total_seconds() / 60

def pruefe(z, jetzt):
    """Gibt je Fenster die Befunde zurueck, die ohne KI feststellbar sind."""
    eingang = [e for e in z.get("eingang", []) if e.get("art") == "nachricht"]
    befunde = []
    for f in z.get("fenster", []):
        best = zeit(f.get("bestaetigt_am"))
        alter = minuten(best, jetzt)
        warten = f.get("warten_auf")
        # Hat sich nach Marcels Eingabe etwas getan? Bestes Mass ist das bestaetigte Signal.
        # Fehlt es (Fenster von vor der Umstellung), nehmen wir ersatzweise die Aenderungszeit -
        # das ist kein Beweis fuer Arbeit, reicht aber fuer die Frage "hat ueberhaupt jemand angefasst".
        seit, sicher = (best, True) if best else (zeit(f.get("geaendert")), False)
        neuer = [e for e in eingang if e.get("fenster_id") == f["id"]
                 and (seit is None or (zeit(e.get("erstellt")) or jetzt) > seit)]

        for grund, text in _befunde(f, alter, warten, neuer):
            befunde.append({"fenster": f["id"], "titel": f.get("titel"), "grund": grund,
                            "text": text, "zustaendig": f.get("zustaendig") or "nicht genannt",
                            "sicher": sicher or grund != "antwort_offen"})
    return befunde

def _befunde(f, alter, warten, neuer):
    status = f.get("status")
    # 1. Soll arbeiten, hat aber seit FRISCH_MIN kein bestaetigtes Signal gemeldet
    if status == "arbeitet" and (alter is None or alter > FRISCH_MIN):
        yield ("signal_veraltet",
               "meldet 'arbeitet', aber " + ("nie ein bestaetigtes Signal"
                                             if alter is None else f"seit {alter:.0f} Min. keine Taetigkeit"))
    # 2. Marcel hat auf der Karte geantwortet, danach kam kein bestaetigtes Signal
    if neuer:
        yield ("antwort_offen",
               f"Marcel hat {len(neuer)}x geschrieben, seitdem keine bestaetigte Reaktion: "
               + (neuer[-1].get("text") or "")[:90])
    # 3. Freigabe liegt da, die Karte wartet trotzdem weiter
    if f.get("freigabe") == "freigegeben" and status in ("wartet", "braucht_dich"):
        yield ("freigabe_ungenutzt", "Freigabe ist erteilt, die Karte wartet aber weiter")
    # 4. Wartet auf einen externen Vorgang: ist der maschinell nachpruefbar?
    if warten == "extern":
        quelle = _quelle(f)
        yield (("extern_pruefbar", f"externer Vorgang nachpruefbar: {quelle}") if quelle
               else ("extern_blind", "wartet auf einen externen Vorgang, aber ohne maschinell "
                                     "pruefbare Quelle (keine Run-Nummer, kein Link) - so kann keine "
                                     "Kontrolle feststellen, ob er noch laeuft"))
    # 5. Wartet auf einen fehlenden Zugang: das loest sich nie von selbst
    if warten == "zugang":
        yield ("zugang_offen", "wartet auf einen fehlenden Zugang - das geht nur ueber Marcel")

def _quelle(f):
    """Eine Run-Nummer oder ein Link im Text macht den externen Vorgang nachpruefbar."""
    text = " ".join(str(f.get(k) or "") for k in ("wartegrund", "taetigkeit", "naechste_aktion"))
    m = re.search(r"https?://\S+", text) or re.search(r"\b(?:Lauf|Run|Job)\s*#?(\d{4,})\b", text, re.I)
    return m.group(0) if m else None

def selbsttest():
    """Belegt, dass die Regeln greifen - sonst sagt ein Lauf mit 0 Befunden nichts aus."""
    from datetime import timedelta
    jetzt = datetime.now(timezone.utc)
    vor = lambda m: (jetzt - timedelta(minutes=m)).isoformat()
    faelle = [
        ("signal_veraltet", {"id": "a", "status": "arbeitet", "bestaetigt_am": vor(40)}, []),
        ("signal_veraltet", {"id": "b", "status": "arbeitet"}, []),
        (None, {"id": "c", "status": "arbeitet", "bestaetigt_am": vor(3)}, []),
        ("antwort_offen", {"id": "d", "status": "wartet", "warten_auf": "marcel",
                           "wartegrund": "Marcel muss entscheiden", "bestaetigt_am": vor(60)},
         [{"art": "nachricht", "fenster_id": "d", "text": "ja mach", "erstellt": vor(5)}]),
        (None, {"id": "e", "status": "wartet", "warten_auf": "marcel",
                "wartegrund": "Marcel muss entscheiden", "bestaetigt_am": vor(2)},
         [{"art": "nachricht", "fenster_id": "e", "text": "ja mach", "erstellt": vor(5)}]),
        ("freigabe_ungenutzt", {"id": "f", "status": "wartet", "warten_auf": "marcel",
                                "freigabe": "freigegeben", "bestaetigt_am": vor(2)}, []),
        ("extern_pruefbar", {"id": "g", "status": "wartet", "warten_auf": "extern",
                             "wartegrund": "Lauf 1148101 muss durchlaufen", "bestaetigt_am": vor(2)}, []),
        ("extern_blind", {"id": "h", "status": "wartet", "warten_auf": "extern",
                          "wartegrund": "wartet auf Antwort", "bestaetigt_am": vor(2)}, []),
        ("zugang_offen", {"id": "i", "status": "wartet", "warten_auf": "zugang",
                          "wartegrund": "Schluessel fehlt", "bestaetigt_am": vor(2)}, []),
    ]
    fehler = 0
    for erwartet, fenster, eingang in faelle:
        gruende = {b["grund"] for b in pruefe({"fenster": [fenster], "eingang": eingang}, jetzt)}
        ok = (erwartet in gruende) if erwartet else not gruende
        print(("OK   " if ok else "FEHL ") + f"{fenster['id']}: erwartet {erwartet or 'nichts'}, bekommen {gruende or 'nichts'}")
        fehler += not ok
    sys.exit(1 if fehler else 0)

def main():
    if "--selbsttest" in sys.argv:
        return selbsttest()
    key = os.environ.get("TONY_BOARD_KEY")
    if not key:
        sys.exit("TONY_BOARD_KEY fehlt")
    with urllib.request.urlopen(f"{API}/{key}/state", timeout=20) as r:
        z = json.load(r)
    jetzt = datetime.now(timezone.utc)
    befunde = pruefe(z, jetzt)
    if "--json" in sys.argv:
        print(json.dumps(befunde, ensure_ascii=False, indent=2))
        return
    print(f"{len(z.get('fenster', []))} offene Fenster, {len(befunde)} Befunde "
          f"({jetzt.strftime('%d.%m.%Y %H:%M')} UTC)\n")
    for b in befunde:
        print(f"  [{b['grund']:<18}] {b['fenster']}{'' if b['sicher'] else '   (unsicher: Fenster ohne bestaetigtes Signal)'}")
        print(f"       {b['text']}")
        print(f"       zustaendig: {b['zustaendig']}")
    if not befunde:
        print("  Nichts zu melden - ein Herzschlag haette hier niemanden geweckt.")

if __name__ == "__main__":
    main()
