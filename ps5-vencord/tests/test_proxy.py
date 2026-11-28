#!/usr/bin/env python3
"""Pruebas de extremo a extremo del proxy (build host) contra un Discord simulado.

Uso: python3 tests/test_proxy.py ./vencord-host
"""
import hashlib
import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BIG = os.urandom(3 * 1024 * 1024)
FAKE_VENCORD = ("// fake Vencord build\nwindow.VencordLoaded = true;\n" + "/*" + "x" * 4096 + "*/\n").encode()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


UP_PORT = free_port()
VC_PORT = free_port()
UP = f"http://127.0.0.1:{UP_PORT}"
SELF = f"http://127.0.0.1:{VC_PORT}"


class Upstream(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *a):
        pass

    def send(self, code, body=b"", ctype="text/plain", extra=()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD" and code not in (204, 304):
            self.wfile.write(body)

    def do_GET(self):
        if self.path == "/app":
            html = (
                "<!DOCTYPE html><html><HEAD lang=en><meta charset=utf-8>"
                "<script>window.GLOBAL_ENV={API_ENDPOINT:'//127.0.0.1:%d/api',"
                "WEBAPP_ENDPOINT:'//127.0.0.1:%d',LINK:'%s/channels'};</script>"
                "</head><body><header>x</header></body></html>" % (UP_PORT, UP_PORT, UP)
            ).encode()
            self.send(200, html, "text/html; charset=utf-8", [
                ("Content-Security-Policy", "default-src 'self'"),
                ("Strict-Transport-Security", "max-age=1"),
                ("X-Frame-Options", "DENY"),
                ("Set-Cookie", "__dcfduid=abc; Domain=discord.com; Path=/; Secure; HttpOnly; SameSite=None"),
                ("X-Keep", "yes"),
            ])
        elif self.path == "/assets/big.js":
            self.send(200, BIG, "application/javascript")
        elif self.path == "/redirect":
            self.send(302, b"", extra=[("Location", UP + "/app")])
        elif self.path == "/nocontent":
            self.send(204)
        elif self.path == "/vdl":
            self.send(302, b"", extra=[("Location", UP + "/Vencord.user.js")])
        elif self.path == "/Vencord.user.js":
            self.send(200, FAKE_VENCORD, "application/javascript")
        elif self.path == "/theme.css":
            self.send(200, b"body{color:red}", "text/css", [("Set-Cookie", "tracker=1")])
        else:
            self.send(404, b"nope")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(n)
        info = {
            "path": self.path,
            "body": body.decode(),
            "origin": self.headers.get("Origin"),
            "referer": self.headers.get("Referer"),
            "ua": self.headers.get("User-Agent"),
            "cookie": self.headers.get("Cookie"),
            "auth": self.headers.get("Authorization"),
            "ae": self.headers.get("Accept-Encoding"),
        }
        self.send(200, json.dumps(info).encode(), "application/json")


failures = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f"  -> {detail}"))
    if not cond:
        failures.append(name)


def req(conn, method, path, body=None, headers=None):
    h = {"Host": f"127.0.0.1:{VC_PORT}"}
    h.update(headers or {})
    conn.request(method, path, body=body, headers=h)
    r = conn.getresponse()
    return r, r.read()


def main():
    binary = sys.argv[1]
    srv = ThreadingHTTPServer(("127.0.0.1", UP_PORT), Upstream)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    data_dir = tempfile.mkdtemp()
    env = dict(os.environ, VC_PORT=str(VC_PORT), VC_UPSTREAM=UP,
               VC_VENCORD_URL=UP + "/vdl", VC_DATA_DIR=data_dir)
    proc = subprocess.Popen([binary, "--no-browser"], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", VC_PORT), 0.2).close()
                break
            except OSError:
                time.sleep(0.1)

        c = http.client.HTTPConnection("127.0.0.1", VC_PORT, timeout=10)

        print("HTML de Discord")
        r, b = req(c, "GET", "/app")
        html = b.decode()
        check("status 200", r.status == 200, r.status)
        check("CSP eliminada", r.getheader("Content-Security-Policy") is None)
        check("HSTS eliminada", r.getheader("Strict-Transport-Security") is None)
        check("X-Frame-Options eliminada", r.getheader("X-Frame-Options") is None)
        check("otras cabeceras se conservan", r.getheader("X-Keep") == "yes")
        ck = r.getheader("Set-Cookie") or ""
        check("cookie sin Domain/Secure", "Domain" not in ck and "Secure" not in ck and "__dcfduid=abc" in ck, ck)
        check("cookie SameSite=Lax", "SameSite=Lax" in ck, ck)
        check("scripts inyectados tras <head>",
              '<HEAD lang=en><script src="/__vc/prelude.js"></script><script src="/__vc/vencord.js"></script><meta' in html, html[:200])
        check("no inyecta en <header>", html.count("/__vc/prelude.js") == 1)
        check("API_ENDPOINT reescrito", f"API_ENDPOINT:'//127.0.0.1:{VC_PORT}/api'" in html, html)
        check("URL absoluta reescrita", f"LINK:'{SELF}/channels'" in html, html)
        check("no quedan referencias al origen real", f"127.0.0.1:{UP_PORT}" not in html, html)

        print("Keep-alive y binarios grandes")
        r, b = req(c, "GET", "/assets/big.js")
        check("3 MB intactos", hashlib.sha256(b).digest() == hashlib.sha256(BIG).digest(), len(b))
        r, b = req(c, "GET", "/nocontent")
        check("204 sin cuerpo", r.status == 204 and b == b"", (r.status, b))

        print("API (POST)")
        r, b = req(c, "POST", "/api/v9/test", body=b'{"content":"hola"}', headers={
            "Content-Type": "application/json", "Origin": SELF, "Referer": SELF + "/channels/@me",
            "Cookie": "__dcfduid=abc", "Authorization": "tok", "User-Agent": "Mozilla/5.0 (PlayStation 5)",
            "Accept-Encoding": "gzip"})
        info = json.loads(b)
        check("cuerpo reenviado", info["body"] == '{"content":"hola"}', info)
        check("Origin reescrito a upstream", info["origin"] == UP, info["origin"])
        check("Referer reescrito", info["referer"] == UP + "/channels/@me", info["referer"])
        check("User-Agent falso de Chrome", "Chrome/" in (info["ua"] or "") and "PlayStation" not in info["ua"], info["ua"])
        check("Cookie y Authorization reenviadas", info["cookie"] == "__dcfduid=abc" and info["auth"] == "tok", info)
        check("sin compresion", info["ae"] == "identity", info["ae"])

        print("Redirecciones")
        r, b = req(c, "GET", "/redirect")
        check("Location reescrito", r.status == 302 and r.getheader("Location") == SELF + "/app", r.getheader("Location"))
        r, b = req(c, "GET", "/")
        check("/ -> /app", r.status == 302 and r.getheader("Location") == SELF + "/app", r.getheader("Location"))

        print("Recursos internos")
        r, b = req(c, "GET", "/__vc/prelude.js")
        check("prelude con GM_xmlhttpRequest", r.status == 200 and b"GM_xmlhttpRequest" in b)
        r, b = req(c, "GET", "/__vc/vencord.js")
        check("Vencord descargado siguiendo redireccion y envuelto", b == b"(function(){\n" + FAKE_VENCORD + b"\n})();\n", b[:60])
        check("Vencord cacheado en disco", os.path.exists(os.path.join(data_dir, "Vencord.user.js")))
        r, b = req(c, "GET", "/__vc/")
        check("pagina de inicio", r.status == 200 and b"Vencord PS5" in b)
        r, b = req(c, "GET", "/__vc/login")
        check("pagina de token", r.status == 200 and b"localStorage" in b)
        r, b = req(c, "POST", "/__vc/update", body=b"", headers={"Origin": "https://evil.example"})
        check("update rechaza otros origenes", r.status == 403, r.status)
        r, b = req(c, "POST", "/__vc/update", body=b"", headers={"Origin": SELF})
        check("update ok", r.status == 200, (r.status, b))

        print("Puente GM_xmlhttpRequest (/__vc/fetch)")
        target = "/__vc/fetch?url=" + (UP + "/theme.css").replace(":", "%3A").replace("/", "%2F")
        r, b = req(c, "GET", target)
        check("sin X-Vc-Fetch -> 403", r.status == 403, r.status)
        r, b = req(c, "GET", target, headers={"X-Vc-Fetch": "1", "Origin": "https://evil.example"})
        check("otro origen -> 403", r.status == 403, r.status)
        r, b = req(c, "GET", target, headers={"X-Vc-Fetch": "1", "Origin": SELF, "Cookie": "secret=1"})
        check("fetch ok", r.status == 200 and b == b"body{color:red}", (r.status, b))
        check("fetch no reenvia Set-Cookie", r.getheader("Set-Cookie") is None)
        r, b = req(c, "GET", "/__vc/fetch?url=file%3A%2F%2F%2Fetc%2Fpasswd", headers={"X-Vc-Fetch": "1"})
        check("solo http(s)", r.status == 400, r.status)

        print("Seguridad")
        c2 = http.client.HTTPConnection("127.0.0.1", VC_PORT, timeout=10)
        c2.request("GET", "/app", headers={"Host": "evil.example"})
        r = c2.getresponse(); r.read()
        check("Host ajeno (DNS rebinding) -> 403", r.status == 403, r.status)

        print("Segunda instancia")
        out = subprocess.run([binary, "--no-browser"], env=env, capture_output=True, timeout=5)
        check("detecta instancia en marcha y sale con 0", out.returncode == 0 and b"ya estaba" in out.stdout, out.stdout)
    finally:
        proc.kill()
        srv.shutdown()

    print()
    if failures:
        print(f"{len(failures)} prueba(s) fallida(s)")
        sys.exit(1)
    print("Todas las pruebas pasaron")


if __name__ == "__main__":
    main()
