"""Download each person's portrait (data/media/index.json 'portrait') and save a small square-cropped JPEG
thumbnail to site/public/portraits/<n>.jpg (face-friendly top-weighted crop, 192 px). Resumable.
Writes site/public/portraits/index.json  {personId: "<n>.jpg"}.
"""
import json, io, pathlib, urllib.request, ssl, certifi, time, hashlib, concurrent.futures as cf
from PIL import Image, ImageOps

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site/public/portraits"; OUT.mkdir(parents=True, exist_ok=True)
M = json.loads((ROOT / "data/media/index.json").read_text(encoding="utf-8"))
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
IDXF = OUT / "index.json"
index = json.loads(IDXF.read_text(encoding="utf-8")) if IDXF.exists() else {}
CTX = ssl.create_default_context(cafile=certifi.where())
UA = {"User-Agent": "Mozilla/5.0 (personal family-history site build)"}

def candidates(pid, e):
    out = []
    pr = e.get("portrait") or {}
    if pr.get("file"): out.append(("file", pr["file"]))
    for k in ("thumb", "url"):
        if pr.get(k): out.append(("url", pr[k]))
    for ph in e.get("photos") or []:
        if ph.get("kind") == "document": continue
        if ph.get("file"): out.append(("file", ph["file"]))
        elif ph.get("thumb"): out.append(("url", ph["thumb"]))
    return out[:4]

def make_thumb(data):
    im = Image.open(io.BytesIO(data)); im = ImageOps.exif_transpose(im).convert("RGB")
    w, h = im.size; s = min(w, h)
    top = 0 if h > w * 1.15 else (h - s) // 2      # portraits: keep the head (top) in frame
    im = im.crop(((w - s) // 2, top, (w - s) // 2 + s, top + s)).resize((192, 192), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, "JPEG", quality=82, optimize=True, progressive=True); return b.getvalue()

def work(pid):
    e = M[pid]
    for kind, v in candidates(pid, e):
        try:
            if kind == "file":
                data = (ROOT / "data/media" / v).read_bytes()
            else:
                with urllib.request.urlopen(urllib.request.Request(v, headers=UA), timeout=40, context=CTX) as r:
                    data = r.read()
            thumb = make_thumb(data)
            name = hashlib.md5(pid.encode()).hexdigest()[:12] + ".jpg"
            (OUT / name).write_bytes(thumb)
            return pid, name
        except Exception:
            time.sleep(0.5)
    return pid, None

todo = [pid for pid, e in M.items() if e.get("portrait") and pid in P and (P[pid].get("ahnentafel") or P[pid].get("altOf")) and pid not in index]
print("to fetch:", len(todo), flush=True)
done = 0
with cf.ThreadPoolExecutor(6) as ex:
    for pid, name in ex.map(work, todo):
        done += 1
        if name: index[pid] = name
        if done % 100 == 0:
            IDXF.write_text(json.dumps(index), encoding="utf-8"); print(f"{done}/{len(todo)} ok {len(index)}", flush=True)
IDXF.write_text(json.dumps(index), encoding="utf-8")
print("portraits:", len(index))
