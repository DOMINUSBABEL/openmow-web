"""Smoke test of the running asset server (must be started first on :8080)."""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8080"
URLS = [
    "/api/health",
    "/viewer.html",
    "/conv/model-report/entity/-vehicle/tank_heavy/jagdtiger/jagdtiger.def.json",
    "/conv/model/entity/-vehicle/tank_heavy/jagdtiger/jagdtiger.def.glb",
    "/conv/model/entity/humanskin/eng_com/eng_com.def.glb",
    "/conv/sdl/map/single/01_usa-skirmish/01_usa-overlord/0.mi.json",
    "/conv/tex/map/single/01_usa-skirmish/01_usa-overlord/minimap.dds.png",
]

ok = True
for u in URLS:
    t = time.time()
    try:
        with urllib.request.urlopen(BASE + u, timeout=120) as r:
            data = r.read()
            ct = r.headers.get("Content-Type")
            print(f"OK  {r.status} {len(data):>10} B {time.time()-t:6.2f}s {ct} {u}")
            if u.endswith(".json") or u == "/api/health":
                j = json.loads(data)
                s = json.dumps(j)[:300]
                print("    ", s)
    except Exception as e:  # noqa
        ok = False
        body = ""
        if hasattr(e, "read"):
            body = e.read()[:400]
        print(f"ERR {u}: {e} {body}")
sys.exit(0 if ok else 1)
