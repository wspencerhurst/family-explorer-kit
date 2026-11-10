"""Portrait thumbnails for Wikidata-found notable cousins (data/notable-kin-wd.json 'image' = Commons file name)
-> site/public/portraits/kin/<qid>.jpg. Closest / most famous first; resumable; backs off on 429."""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, io, pathlib, ssl, certifi, time, urllib.request, urllib.parse
from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site/public/portraits/kin"; OUT.mkdir(parents=True, exist_ok=True)
CTX = ssl.create_default_context(cafile=certifi.where())
UA = {"User-Agent": KIT_UA}
D = json.loads((ROOT / "data/notable-kin-wd.json").read_text(encoding="utf-8"))
todo = [k for k in D if k.get("image") and k.get("qid") and not (OUT / f"{k['qid']}.jpg").exists()]
todo.sort(key=lambda k: ((k.get("stepsSubject") or 0) + (k.get("stepsNotable") or 0), -(k.get("fame") or 0)))
todo = todo[:600]
print("to fetch:", len(todo), flush=True)

def thumb(data):
    im = Image.open(io.BytesIO(data)); im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size; s = min(w, h)
    top = int(min(h - s, h * 0.04)) if h > w * 1.15 else (h - s) // 2
    im = im.crop(((w - s) // 2, top, (w - s) // 2 + s, top + s)).resize((192, 192), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=82, optimize=True, progressive=True); return b.getvalue()

ok = 0
for n, k in enumerate(todo):
    src = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(k["image"]) + "?width=320"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(src, headers=UA), timeout=60, context=CTX) as r:
                (OUT / f"{k['qid']}.jpg").write_bytes(thumb(r.read())); ok += 1
            break
        except Exception as e:
            if "429" in str(e): time.sleep(20 * (attempt + 1)); continue
            break
    time.sleep(1.2)
    if n % 50 == 0: print(f"{n}/{len(todo)} ok {ok}", flush=True)
print("done", ok)
