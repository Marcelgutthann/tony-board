#!/usr/bin/env python3
"""Nachbildung der Board-API fuer den Pruefstand. Beruehrt nichts Produktives.

    python3 fake-board.py <port> <protokolldatei>

Haelt eine Liste von Nachrichten im Speicher und schreibt jeden eingehenden Aufruf als
JSON-Zeile ins Protokoll, damit der Test pruefen kann, was gemeldet wurde.
"""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port, protokoll = int(sys.argv[1]), sys.argv[2]
zustand = {"nachrichten": [], "fenster": [{"id": "testfenster", "titel": "Testfenster", "status": "arbeitet"}],
           "absprache": [],
           # Stoermodi fuer den Pruefstand: HTTP-Code erzwingen oder haengen lassen
           "stoerung": {"an-tony": 0, "mcp": 0, "state": 0, "haenge": 0.0}}
sperre = threading.Lock()

def notiere(eintrag):
    with sperre, open(protokoll, "a", encoding="utf-8") as f:
        f.write(json.dumps(eintrag, ensure_ascii=False) + "\n")

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def handle_one_request(self):
        # Beim Haengetest bricht curl die Verbindung ab - das ist erwartet, kein Fehler
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def _antwort(self, obj, code=200):
        roh = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(roh)))
        self.end_headers()
        self.wfile.write(roh)

    def _koerper(self):
        n = int(self.headers.get("content-length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def _stoert(self, name):
        import time
        st = zustand["stoerung"]
        if st["haenge"] and name in ("an-tony", "mcp"):
            time.sleep(st["haenge"])
        code = st.get(name, 0)
        if code:
            self._antwort({"error": "simulierte Stoerung"}, code)
            return True
        return False

    def do_GET(self):
        if self.path.startswith("/sim/stoerung"):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            for k in ("an-tony", "mcp", "state"):
                if k in q: zustand["stoerung"][k] = int(q[k][0])
            if "haenge" in q: zustand["stoerung"]["haenge"] = float(q["haenge"][0])
            return self._antwort({"ok": True, "stoerung": zustand["stoerung"]})
        if self.path.startswith("/sim/antwort"):
            # Claude stellt ein Ergebnis zu (das, was der echte Lauf am Ende selbst tut)
            from datetime import datetime, timezone
            zustand["absprache"].append({"von": "claude", "text": "Ergebnis", "fenster_id": "testfenster",
                                         "erstellt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")})
            return self._antwort({"ok": True})
        if self.path.endswith("/fuer-claude"):
            return self._antwort({"offen": len(zustand["nachrichten"])})
        if self.path.endswith("/state"):
            if self._stoert("state"): return
            return self._antwort({"fenster": zustand["fenster"], "eingang": [], "blick": [],
                                  "absprache": zustand["absprache"]})
        # Steuerung fuer den Test: Nachricht einstellen
        if self.path.startswith("/sim/neu"):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            zustand["nachrichten"].append({"text": q.get("text", ["hallo"])[0],
                                           "fenster_id": q.get("fenster", ["testfenster"])[0],
                                           "zeit": "2026-10-12T13:00:00Z"})
            return self._antwort({"ok": True})
        self._antwort({"error": "unbekannt"}, 404)

    def do_POST(self):
        b = self._koerper()
        if self.path.endswith("/fuer-claude"):
            raus = zustand["nachrichten"]
            zustand["nachrichten"] = []
            return self._antwort({"nachrichten": raus})
        if self.path.endswith("/an-tony"):
            if self._stoert("an-tony"): return
            notiere({"art": "an-tony", "text": b.get("text", ""), "fenster_id": b.get("fenster_id")})
            return self._antwort({"ok": True})
        if "/mcp/" in self.path:
            if self._stoert("mcp"): return
            arg = (b.get("params") or {}).get("arguments") or {}
            notiere({"art": "fenster_zeigen", "id": arg.get("id"), "taetigkeit": arg.get("taetigkeit"),
                     "zustaendig": arg.get("zustaendig"), "fehler": arg.get("fehler")})
            return self._antwort({"jsonrpc": "2.0", "id": 1,
                                  "result": {"content": [{"type": "text", "text": "{\"ok\":true}"}], "isError": False}})
        self._antwort({"error": "unbekannt"}, 404)

ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
