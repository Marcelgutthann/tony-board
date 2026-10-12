#!/usr/bin/env python3
"""Nachbildung der Board-API fuer den Pruefstand. Beruehrt nichts Produktives.

    python3 fake-board.py <port> <protokolldatei>

Haelt eine Liste von Nachrichten im Speicher und schreibt jeden eingehenden Aufruf als
JSON-Zeile ins Protokoll, damit der Test pruefen kann, was gemeldet wurde.
"""
import json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

port, protokoll = int(sys.argv[1]), sys.argv[2]
zustand = {"nachrichten": [], "fenster": [{"id": "testfenster", "titel": "Testfenster", "status": "arbeitet"}]}
sperre = threading.Lock()

def notiere(eintrag):
    with sperre, open(protokoll, "a", encoding="utf-8") as f:
        f.write(json.dumps(eintrag, ensure_ascii=False) + "\n")

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

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

    def do_GET(self):
        if self.path.endswith("/fuer-claude"):
            return self._antwort({"offen": len(zustand["nachrichten"])})
        if self.path.endswith("/state"):
            return self._antwort({"fenster": zustand["fenster"], "eingang": [], "blick": [], "absprache": []})
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
            notiere({"art": "an-tony", "text": b.get("text", ""), "fenster_id": b.get("fenster_id")})
            return self._antwort({"ok": True})
        if "/mcp/" in self.path:
            arg = (b.get("params") or {}).get("arguments") or {}
            notiere({"art": "fenster_zeigen", "id": arg.get("id"), "taetigkeit": arg.get("taetigkeit"),
                     "zustaendig": arg.get("zustaendig"), "fehler": arg.get("fehler")})
            return self._antwort({"jsonrpc": "2.0", "id": 1,
                                  "result": {"content": [{"type": "text", "text": "{\"ok\":true}"}], "isError": False}})
        self._antwort({"error": "unbekannt"}, 404)

HTTPServer(("127.0.0.1", port), H).serve_forever()
