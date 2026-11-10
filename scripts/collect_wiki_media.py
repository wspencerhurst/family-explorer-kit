"""Collect portraits and life text from WikiTree and Wikipedia/Wikidata for people in the pedigree.

- WikiTree: for persons with a wikitreeId (or a WikiTree id in their notes), getProfile -> Photo/PhotoData + Bio text.
- Wikipedia: for 'notable' persons, CONFIRMED/PROBABLE persons born before 1850, and persons with a Wikipedia link
  in notes/sources, search Wikipedia by name + years and accept a page only if its intro mentions the person's
  birth or death year; take the lead image (pageimages) and the plain-text intro extract.
Output: data/media/wiki-media.json  {personId: {"portraits":[{url,source,credit,page}], "bios":[{source,url,text}]}}
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, re, time, pathlib, urllib.request, urllib.parse, ssl, certifi
CTX = ssl.create_default_context(cafile=certifi.where())

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
OUT = ROOT / "data/media/wiki-media.json"; OUT.parent.mkdir(exist_ok=True)
out = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
UA = {"User-Agent": KIT_UA}

def get(url, params, sleep=1.0):
    u = url + "?" + urllib.parse.urlencode(params)
    for a in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60, context=CTX) as r:
                d = json.loads(r.read().decode("utf-8")); time.sleep(sleep); return d
        except Exception as e:
            time.sleep(10 * (a + 1) if "429" in str(e) else 3)
    return None

def add(pid, kind, item):
    e = out.setdefault(pid, {"portraits": [], "bios": []})
    if item not in e[kind]: e[kind].append(item)

# --- WikiTree ---
wt = {}
for pid, p in P.items():
    if not (p.get("ahnentafel") or p.get("altOf")): continue
    w = p.get("wikitreeId")
    if not w:
        m = re.search(r"wikitree\.com/wiki/([A-Za-z\-']+-\d+)", json.dumps(p.get("notes") or {}))
        w = m.group(1) if m else None
    if w: wt[pid] = w
print("WikiTree profiles to fetch:", len(wt), flush=True)
items = list(wt.items())
for i in range(0, len(items), 50):
    chunk = items[i:i+50]
    d = get("https://api.wikitree.com/api.php", {"action": "getPeople", "keys": ",".join(w for _, w in chunk),
            "fields": "Name,Photo,PhotoData,Bio", "bioFormat": "text", "appId": CFG.get("wikitreeAppId", "familyExplorerKit")})
    if not d: continue
    by_name = {}
    for entry in d if isinstance(d, list) else []:
        for prof in (entry.get("people") or {}).values():
            if isinstance(prof, dict) and prof.get("Name"): by_name[prof["Name"]] = prof
    for pid, w in chunk:
        prof = by_name.get(w)
        if not prof: continue
        pd = prof.get("PhotoData") or {}
        if pd.get("url") or prof.get("Photo"):
            url = pd.get("url") or ""
            if url.startswith("/"): url = "https://www.wikitree.com" + url
            add(pid, "portraits", {"url": url, "file": prof.get("Photo"), "source": "WikiTree", "page": f"https://www.wikitree.com/wiki/{w}"})
        bio = (prof.get("bio") or prof.get("Bio") or "").strip()
        if len(bio) > 200:
            add(pid, "bios", {"source": "WikiTree", "url": f"https://www.wikitree.com/wiki/{w}", "text": bio[:15000]})
    OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print(f"wikitree {i+len(chunk)}/{len(items)}", flush=True)

# --- Wikipedia ---
def yrs(p):
    ys = set()
    for k in ("birth", "death"):
        m = re.search(r"\b(1[0-9]{3})\b", str((p.get(k) or {}).get("date") if isinstance(p.get(k), dict) else ""))
        if m: ys.add(m.group(1))
    m = re.findall(r"\b(1[0-9]{3})\b", p.get("lifespan") or "")
    ys.update(m)
    return ys
cands = []
for pid, p in P.items():
    if not p.get("ahnentafel") or p.get("lineFlag"): continue
    notable = bool(p.get("notable"))
    wp = "wikipedia.org" in json.dumps(p.get("notes") or {}) + json.dumps(p.get("sources") or [])
    early = p.get("confidence") in ("CONFIRMED", "PROBABLE") and (p.get("birthYear") or 9999) < 1850
    if (notable or wp or early) and yrs(p): cands.append(pid)
print("Wikipedia candidates:", len(cands), flush=True)
for n, pid in enumerate(cands):
    p = P[pid]; name = re.sub(r"\(.*?\)|\".*?\"", "", p.get("name") or "").strip()
    s = get("https://en.wikipedia.org/w/api.php", {"action": "query", "list": "search", "srsearch": name, "srlimit": 3, "format": "json"}, 0.3)
    for hit in ((s or {}).get("query", {}).get("search", []))[:3]:
        d = get("https://en.wikipedia.org/w/api.php", {"action": "query", "prop": "extracts|pageimages|info", "exintro": 1, "explaintext": 1,
                "piprop": "original|thumbnail", "pithumbsize": 400, "inprop": "url", "titles": hit["title"], "format": "json"}, 0.3)
        pg = next(iter(((d or {}).get("query", {}).get("pages", {})).values()), {})
        intro = pg.get("extract") or ""
        if not intro or not any(y in intro[:600] for y in yrs(p)): continue
        last = name.split()[-1].lower() if name.split() else ""
        if last and last not in (pg.get("title", "") + intro[:200]).lower(): continue
        if pg.get("original") or pg.get("thumbnail"):
            add(pid, "portraits", {"url": (pg.get("original") or {}).get("source") or pg["thumbnail"]["source"],
                                   "thumb": (pg.get("thumbnail") or {}).get("source"), "source": "Wikipedia", "page": pg.get("fullurl")})
        add(pid, "bios", {"source": "Wikipedia", "url": pg.get("fullurl"), "text": intro[:6000]})
        break
    if n % 25 == 0:
        OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8"); print(f"wikipedia {n}/{len(cands)}", flush=True)
OUT.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print("done:", sum(1 for v in out.values() if v["portraits"]), "with portraits;", sum(1 for v in out.values() if v["bios"]), "with bios")
