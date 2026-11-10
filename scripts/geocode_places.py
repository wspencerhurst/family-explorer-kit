"""Geocode place strings used in the pedigree (births, deaths, burials, residences/facts) with OpenStreetMap Nominatim.

Respects the Nominatim usage policy: max 1 request/second, identifying User-Agent, results cached in
data/places/geocode-cache.json (resumable). Tries the full string, then progressively drops the most specific part.
Output: data/places/geocode.json {place string: {"lat","lon","display","matched"}}
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, re, time, pathlib, urllib.request, urllib.parse, ssl, certifi, os
MEDIEVAL = int(os.environ.get("GEO_MEDIEVAL", "0"))  # >0: geocode the top-N pre-1500 places and add to geocode.json

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTD = ROOT / "data/places"; OUTD.mkdir(exist_ok=True)
CACHE = OUTD / "geocode-cache.json"
cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
CTX = ssl.create_default_context(cafile=certifi.where())
UA = {"User-Agent": KIT_UA}
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
media = ROOT / "data/media/index.json"
M = json.loads(media.read_text(encoding="utf-8")) if media.exists() else {}

places = {}
def add(s, w=1):
    if not s or not isinstance(s, str): return
    s = re.sub(r"\s+", " ", s).strip(" ,")
    if len(s) < 3 or re.fullmatch(r"[\d\s,\-]+", s): return
    places[s] = places.get(s, 0) + w
for pid, p in P.items():
    if not (p.get("ahnentafel") or p.get("altOf")): continue
    if ((p.get("birthYear") or 0) < 1500) != bool(MEDIEVAL): continue
    for k in ("birth", "death", "burial", "christening"):
        e = p.get(k)
        if isinstance(e, dict): add(e.get("place"), 3 if p.get("ahnentafel") else 1)
    if MEDIEVAL: continue
    for f in (M.get(pid) or {}).get("facts", []):
        add(f.get("place"))
GEO = OUTD / "geocode.json"
prev = json.loads(GEO.read_text(encoding="utf-8")) if (MEDIEVAL and GEO.exists()) else {}
todo = sorted((s for s in places if s not in prev), key=lambda s: -places[s])
if MEDIEVAL: todo = todo[:MEDIEVAL]
print("unique places:", len(todo), flush=True)

def query(q):
    if q in cache: return cache[q]
    u = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({"q": q, "format": "json", "limit": 1})
    res = None
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60, context=CTX) as r:
                d = json.loads(r.read().decode("utf-8"))
            res = {"lat": float(d[0]["lat"]), "lon": float(d[0]["lon"]), "display": d[0]["display_name"]} if d else None
            break
        except Exception as e:
            time.sleep(30 if "429" in str(e) else 5)
    cache[q] = res; time.sleep(1.1)
    return res

out = dict(prev)
for i, s in enumerate(todo):
    parts = [x.strip() for x in s.split(",") if x.strip()]
    hit = None
    for k in range(len(parts)):
        q = ", ".join(parts[k:])
        q = re.sub(r"\b(Colony of|British Colonial America|Province of)\b", "", q).strip(" ,")
        if not q: continue
        hit = query(q)
        if hit:
            out[s] = {**hit, "matched": q, "exact": k == 0}; break
    if i % 100 == 0:
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        (OUTD / "geocode.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        print(f"{i}/{len(todo)} geocoded {len(out)}", flush=True)
CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
(OUTD / "geocode.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print("done:", len(out), "of", len(todo))
