"""Portraits for notable people via Wikidata (FamilySearch ID P2889 -> image P18), from Wikimedia Commons.

- People in the pedigree (notable ancestors, royal/noble ancestors, anyone notable) get a portrait added to
  site/public/portraits/index.json (only if they don't have one) so the fan chart and panel show it.
- Notable cousins (not in the tree) get site/public/portraits/kin/<fsId>.jpg, used on the Discover page.
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, io, pathlib, ssl, certifi, time, urllib.request, urllib.parse, hashlib
from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site/public/portraits"; KIN = OUT / "kin"; KIN.mkdir(parents=True, exist_ok=True)
CTX = ssl.create_default_context(cafile=certifi.where())
UA = {"User-Agent": KIT_UA}
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
KINL = json.loads((ROOT / "data/notable-kin.json").read_text(encoding="utf-8"))
ROY = json.loads((ROOT / "data/royal-descents.json").read_text(encoding="utf-8"))
_na = ROOT / "data/notable-ancestors-pre1550.json"
NA = json.loads(_na.read_text(encoding="utf-8")) if _na.exists() else {}
idx_f = OUT / "index.json"
index = json.loads(idx_f.read_text(encoding="utf-8"))

tree_fs = {}   # fsId -> pid
for r in ROY.get("viaGateway", []) + ROY.get("treeOnly", []):
    p = P.get(r.get("id"))
    if p and p.get("fsId"): tree_fs[p["fsId"]] = r["id"]
for lst in NA.values():
    for n in lst:
        p = P.get(n.get("id"))
        if p and p.get("fsId") and (p.get("ahnentafel") or p.get("altOf")): tree_fs[p["fsId"]] = n["id"]
for pid, p in P.items():
    if p.get("notable") and p.get("fsId") and p.get("ahnentafel"): tree_fs[p["fsId"]] = pid
kin_fs = {k["fsId"] for k in KINL if k.get("fsId")}
want = sorted((set(tree_fs) | kin_fs))
print("FamilySearch ids to look up:", len(want), flush=True)

def sparql(ids):
    q = "SELECT ?fs ?img WHERE { VALUES ?fs { %s } ?item wdt:P2889 ?fs; wdt:P18 ?img. }" % " ".join(f'"{i}"' for i in ids)
    u = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q, "format": "json"})
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=90, context=CTX) as r:
                return json.loads(r.read())["results"]["bindings"]
        except Exception as e:
            print("sparql retry", e, flush=True); time.sleep(10 * (a + 1))
    return []

CACHE = ROOT / "data/raw/wikidata-fs-images.json"
imgs = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
for k in (range(0, len(want), 250) if not imgs else []):
    for b in sparql(want[k:k + 250]):
        imgs.setdefault(b["fs"]["value"], b["img"]["value"])
    time.sleep(1.5)
CACHE.write_text(json.dumps(imgs), encoding="utf-8")
print("with images:", len(imgs), flush=True)

def thumb(data):
    im = Image.open(io.BytesIO(data)); im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size; s = min(w, h)
    top = 0 if h > w * 1.15 else (h - s) // 2
    if h > w * 1.15: top = int(min(h - s, h * 0.04))
    im = im.crop(((w - s) // 2, top, (w - s) // 2 + s, top + s)).resize((192, 192), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=82, optimize=True, progressive=True); return b.getvalue()

added = kin_n = 0
for n, (fs, url) in enumerate(imgs.items()):
    in_tree = fs in tree_fs and tree_fs[fs] not in index
    is_kin = fs in kin_fs and not (KIN / f"{fs}.jpg").exists()
    if not (in_tree or is_kin): continue
    fname = urllib.parse.unquote(url.rsplit("/", 1)[-1])
    src = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(fname) + "?width=320"
    data = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(src, headers=UA), timeout=60, context=CTX) as r:
                data = thumb(r.read())
            break
        except Exception as e:
            if "429" in str(e): time.sleep(20 * (attempt + 1)); continue
            print("skip", fs, e, flush=True); break
    if data is None: continue
    if in_tree:
        name = hashlib.md5(tree_fs[fs].encode()).hexdigest()[:12] + ".jpg"
        (OUT / name).write_bytes(data); index[tree_fs[fs]] = name; added += 1
    if fs in kin_fs:
        (KIN / f"{fs}.jpg").write_bytes(data); kin_n += 1
    time.sleep(1.2)
    if n % 50 == 0: idx_f.write_text(json.dumps(index), encoding="utf-8"); print(f"{n}/{len(imgs)} tree+{added} kin+{kin_n}", flush=True)
idx_f.write_text(json.dumps(index), encoding="utf-8")
print("added tree portraits:", added, "kin portraits:", kin_n)
