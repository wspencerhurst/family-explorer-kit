"""Build the static data the family-explorer site loads (site/public/data/).

Outputs (all JSON, gzip twins written alongside for the local server):
  core.json      columnar index of every person in the pedigree + alternate lineages
  details/NNN.json  per-person detail, chunked by index (500 per file) - loaded on demand
  geo.json       dated, geocoded life events for the map (person index, year, lon, lat, kind, precision)
  notables.json  notable ancestors, notable cousins (with descent lines), royal/noble descents, immigrants,
                 military service, legends, brick walls
  memorial.json  enslaved people named in ancestors' records, and census counts
  stats.json     overview figures (counts by generation/tier/confidence, birth-country mix by generation)
Portrait thumbnails are downloaded separately by scripts/fetch_portraits.py into site/public/portraits/.
"""
import json, re, gzip, pathlib, collections, unicodedata, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "site/public/data"
(OUT / "details").mkdir(parents=True, exist_ok=True)

def load(p, default=None):
    f = ROOT / p
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else default

P = load("data/people.json")
SRC = load("data/sources.json", {})
MEDIA = load("data/media/index.json", {})
FAM = load("data/family.json", {"families": {}, "relatives": {}})
FSSRC = load("data/fs-sources.json", {})
GEO = load("data/places/geocode.json", {})
SUM = load("data/summary.json", {})
KIN = load("data/notable-kin.json", [])
ROYAL = load("data/royal-descents.json", {"viaGateway": [], "treeOnly": []})
ENSL = load("data/enslaved.json", {"people": [], "counts": []})
PORTRAITS = load("site/public/portraits/index.json", {})   # pid -> file name (from fetch_portraits.py)
KINWD = load("data/notable-kin-wd.json", [])
import sys as _sys
_sys.path.insert(0, str(ROOT / "scripts"))
from site_fixes import run_all as _run_fixes
for _r in _run_fixes({"P": P, "GEO": GEO, "MEDIA": MEDIA, "KIN": KIN, "KINWD": KINWD, "SUM": SUM, "ENSL": ENSL}):
    print("fix", _r)

TIERS = ["verified", "tree", "medieval", "legendary", "flagged", "conflict", "alternate"]
CONFS = ["CONFIRMED", "PROBABLE", "UNVERIFIED", "CONFLICT"]

# ---------- who is in ----------
ids = [pid for pid, p in P.items() if (p.get("ahnentafel") or p.get("altOf")) and not p.get("mergedInto")]
def sortkey(pid):
    p = P[pid]
    a = p.get("ahnentafel")
    return (0, min(int(n) for n in a)) if a else (1, pid)
ids.sort(key=sortkey)
IDX = {pid: i for i, pid in enumerate(ids)}
N = len(ids)
print("people in site:", N)

# ---------- helpers ----------
def yr(s):
    if not s: return None
    s = str(s)
    m = re.search(r"\b(\d{1,4})\s*B\.?\s?C\.?", s, re.I)
    if m: return -int(m.group(1))
    m = re.search(r"\b(\d{3,4})\b", s)
    if not m: return None
    y = int(m.group(1))
    return y if 1 <= y <= 2030 else None

def ev(p, k):
    e = p.get(k)
    if isinstance(e, dict): return e.get("date"), e.get("place")
    if isinstance(e, str): return e, None
    return None, None

def clean_place(s):
    if not s or not isinstance(s, str): return None
    s = re.sub(r"\s+", " ", s).strip(" ,")
    return s or None

places, PLACE_IDX = [], {}
def place_id(s):
    s = clean_place(s)
    if not s: return -1
    if s not in PLACE_IDX:
        PLACE_IDX[s] = len(places); places.append(s)
    return PLACE_IDX[s]

def country_of(s):
    s = clean_place(s)
    if not s: return None
    g = GEO.get(s)
    disp = (g or {}).get("display") or s
    last = disp.split(",")[-1].strip()
    low = s.lower()
    if re.search(r"virginia|carolina|maryland|georgia|alabama|tennessee|kentucky|pennsylvania|new york|jersey|massachusetts|connecticut|united states|usa|colonial america|delaware|ohio|texas|mississippi|missouri|louisiana|indiana|illinois|d\.c\.|west virginia", low): return "United States"
    if re.search(r"england|lancashire|yorkshire|london|kent|norfolk|devon|essex|wiltshire|cheshire|gloucester|somerset|sussex|surrey|lincoln", low): return "England"
    if "scotland" in low: return "Scotland"
    if "wales" in low: return "Wales"
    if "ireland" in low or "tyrone" in low: return "Ireland"
    if "france" in low or "normandie" in low or "normandy" in low or "bretagne" in low: return "France"
    if re.search(r"germany|deutschland|prussia|bayern|saxony|holy roman", low): return "Germany"
    if re.search(r"netherlands|holland|flanders|belgium|brabant", low): return "Low Countries"
    if re.search(r"spain|castil|leon|aragon|navarre|portugal", low): return "Iberia"
    if re.search(r"italy|italia|rome|lombard", low): return "Italy"
    if re.search(r"sweden|norway|denmark|scandinav", low): return "Scandinavia"
    if last in ("United Kingdom",): return "England"
    if last in ("United States", "USA"): return "United States"
    return last if g else None

LIVING_IDS = {pid for pid, p in P.items() if p.get("living") or p.get("possiblyLiving")}

# ---------- core ----------
core = {k: [] for k in ("id", "n", "s", "b", "d", "f", "m", "t", "c", "g", "a", "fl", "bp", "dp", "r", "ap", "lf")}
side_of = {}
for pid in ids:
    p = P[pid]
    a = p.get("ahnentafel") or []
    amin = min((int(x) for x in a), default=0)
    by = p.get("birthYear")
    est = bool(p.get("birthYearEst"))
    _, bplace = ev(p, "birth")
    if not bplace: _, bplace = ev(p, "christening")
    ddate, dplace = ev(p, "death")
    if not dplace: _, dplace = ev(p, "burial")
    dy = yr(ddate) or yr((p.get("lifespan") or "").split("-")[-1] if p.get("lifespan") else None)
    if dy is not None and by is not None and dy < by: dy = None
    fl = 0
    if p.get("notable"): fl |= 1
    if p.get("immigrant"): fl |= 2
    if pid in PORTRAITS: fl |= 4
    if pid in LIVING_IDS: fl |= 8
    if p.get("lineFlag"): fl |= 16
    if p.get("altOf") and not a: fl |= 32
    if p.get("quality"): fl |= 64
    if est: fl |= 128
    if (MEDIA.get(pid) or {}).get("photos"): fl |= 256
    lv = (p.get("lineFlag") or {}).get("verdict")
    if lv in ("REJECTED", "FABRICATED"): fl |= 1024
    elif lv: fl |= 2048
    nt = str(p.get("notable") or "")
    if re.search(r"Revolutionary War|Civil War|patriot|Confederate|militia|regiment", nt, re.I): fl |= 512
    core["id"].append(pid)
    core["n"].append(p.get("name") or "?")
    core["s"].append({"M": 1, "Male": 1, "F": 2, "Female": 2}.get(p.get("sex"), 0))
    core["b"].append(by if by else None)
    core["d"].append(dy)
    core["f"].append(IDX.get(p.get("father"), -1))
    core["m"].append(IDX.get(p.get("mother"), -1))
    core["t"].append(TIERS.index(p.get("tier")) if p.get("tier") in TIERS else 2)
    core["c"].append(CONFS.index(p.get("confidence")) if p.get("confidence") in CONFS else 2)
    core["g"].append(amin.bit_length() - 1 if amin else -1)
    core["a"].append(str(amin) if amin else "")
    core["fl"].append(fl)
    core["bp"].append(place_id(bplace))
    core["dp"].append(place_id(dplace))
    core["r"].append(p.get("routes") or (len(a) if a else 0))
    alts = []
    for pair in p.get("altParents") or []:
        if isinstance(pair, list):
            alts.append([IDX.get(pair[0], -1) if pair[0] else -1, IDX.get(pair[1], -1) if len(pair) > 1 and pair[1] else -1])
    core["ap"].append(alts or 0)
    lfb = 0
    for rel, bit in (("father", 0), ("mother", 2)):
        v = ((p.get("linkFlags") or {}).get(rel) or {}).get("verdict")
        if v in ("REJECTED", "FABRICATED"): lfb |= 1 << bit
        elif v: lfb |= 2 << bit
    core["lf"].append(lfb)
core["places"] = places
core["tiers"] = TIERS
core["confs"] = CONFS
core["root"] = IDX.get(next(pid for pid in ids if "1" in (P[pid].get("ahnentafel") or [])), 0)

# ---------- portraits ----------
core["pt"] = {str(IDX[pid]): f for pid, f in PORTRAITS.items() if pid in IDX}

# ---------- details ----------
SKIP_FACT = re.compile(r"^(Lds|NFS ID|AFN|NationalId|Alt|Fact$|Other$|Title %28|Affiliation|Clan|TribeName)", re.I)
def src_obj(sid):
    s = SRC.get(sid)
    if s:
        return {k: s.get(k) for k in ("title", "url", "type", "publisher", "author", "citation") if s.get(k)}
    if sid.startswith("FS:"):
        return {"title": "FamilySearch record " + sid[3:], "url": "https://www.familysearch.org/ark:/61903/1:1:" + sid[3:], "type": "record"}
    return {"title": sid}

def rel_ref(ref):
    if ref in IDX: return {"i": IDX[ref]}
    r = FAM["relatives"].get(ref) or {}
    if not r and ref in P:
        q = P[ref]; return {"name": q.get("name"), "life": q.get("lifespan"), "fs": q.get("fsId")}
    return {"name": r.get("name"), "life": (r.get("life") or "").replace("Deceased", "").strip("-") or None,
            "b": r.get("birth"), "bp": r.get("birthPlace"), "dp": r.get("deathPlace"), "sex": r.get("sex"),
            "fs": ref[3:] if ref.startswith("FS:") else None}

ensl_by = collections.defaultdict(list)
for e in ENSL["people"]:
    if e.get("enslaverId") in IDX: ensl_by[e["enslaverId"]].append({k: e.get(k) for k in ("name", "description", "place", "year", "notes")})
cnt_by = collections.defaultdict(list)
for e in ENSL["counts"]:
    if e.get("enslaverId") in IDX: cnt_by[e["enslaverId"]].append({k: e.get(k) for k in ("year", "place", "count", "confidence", "enumeratedAs", "note", "url")})

details = {}
for pid in ids:
    p = P[pid]; i = IDX[pid]; m = MEDIA.get(pid) or {}
    events = []
    for k, label in (("birth", "Birth"), ("christening", "Christening"), ("death", "Death"), ("burial", "Burial")):
        d, pl = ev(p, k)
        if d or pl: events.append({"type": label, "date": d, "place": clean_place(pl), "y": yr(d)})
    seen = {(e["type"], e["y"]) for e in events}
    sketch = None
    for f in m.get("facts") or []:
        t = urllib.parse.unquote_plus(f.get("type") or "").strip()
        if t == "LifeSketch":
            if f.get("value") and len(f["value"]) > 30: sketch = f["value"]
            continue
        if SKIP_FACT.search(t): continue
        label = {"Birth": "Birth", "Death": "Death", "Burial": "Burial", "Christening": "Christening", "Residence": "Residence",
                 "Occupation": "Occupation", "MilitaryService": "Military service", "Marriage": "Marriage", "Immigration": "Immigration",
                 "Emigration": "Emigration", "TitleOfNobility": "Title", "Title (Nobility)": "Title", "Title": "Title", "Religion": "Religion",
                 "Census": "Census", "Probate": "Probate", "Will": "Will", "Naturalization": "Naturalization", "Education": "Education"}.get(t, t)
        y = yr(f.get("date"))
        if (label, y) in seen and label in ("Birth", "Death", "Burial", "Christening"): continue
        seen.add((label, y))
        events.append({"type": label, "date": f.get("date"), "place": clean_place(f.get("place")), "value": f.get("value"), "y": y})
    events.sort(key=lambda e: (e["y"] is None, e["y"] or 0, ["Birth", "Christening"].index(e["type"]) if e["type"] in ("Birth", "Christening") else 2))
    fam = FAM["families"].get(pid) or {}
    spouses = [rel_ref(s) for s in dict.fromkeys((p.get("spouses") or []) + fam.get("spouses", []))]
    spouses = [s for s in spouses if s.get("i") != i]
    children = [rel_ref(c) for c in fam.get("children", [])]
    sources = []
    seen_s = set()
    for s in p.get("sources") or []:
        if s in seen_s: continue
        seen_s.add(s); sources.append(src_obj(s))
    for s in FSSRC.get(pid) or []:
        sources.append({"title": s.get("title"), "url": s.get("url"), "citation": re.sub(r"<.*?>", "", s.get("citation") or "")[:400], "type": "fs"})
    notes = p.get("notes") or {}
    if not isinstance(notes, dict): notes = {"note": str(notes)}
    det = {
        "name": p.get("name"), "fs": p.get("fsId"), "wt": p.get("wikitreeId"), "life": p.get("lifespan"),
        "events": events, "notable": p.get("notable"), "immigrant": p.get("immigrant"), "occupation": p.get("occupation"),
        "notes": notes, "sources": sources[:120], "nsrc": len(sources),
        "spouses": spouses, "children": children,
        "photos": [{k: ph.get(k) for k in ("source", "title", "thumb", "url", "page", "file", "kind") if ph.get(k)} for ph in (m.get("photos") or [])[:60]],
        "bios": [{"source": b.get("source"), "url": b.get("url"), "text": (b.get("text") or "")[:12000]} for b in (m.get("bios") or [])],
        "stories": [{"title": s.get("title"), "text": (s.get("text") or "")[:12000]} for s in (m.get("stories") or [])],
        "sketch": sketch, "fag": m.get("findagrave"), "portrait": m.get("portrait"),
        "linkFlags": p.get("linkFlags"), "lineFlag": p.get("lineFlag"), "quality": p.get("quality"),
        "origin": p.get("origin"), "altOf": IDX.get(p.get("altOf"), None) if p.get("altOf") else None,
        "routes": p.get("routes"), "ahn": (p.get("ahnentafel") or [])[:12],
        "enslaved": ensl_by.get(pid), "enslavedCounts": cnt_by.get(pid),
    }
    details[i] = {k: v for k, v in det.items() if v not in (None, [], {}, "")}
CH = 500
for c in range(0, N, CH):
    chunk = {str(i): details[i] for i in range(c, min(N, c + CH))}
    (OUT / "details" / f"{c // CH:03d}.json").write_text(json.dumps(chunk, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

# ---------- geo ----------
KIND = {"Birth": 0, "Christening": 0, "Residence": 1, "Census": 1, "Military service": 1, "Marriage": 1, "Immigration": 1, "Occupation": 1,
        "Death": 2, "Burial": 3, "Probate": 2, "Will": 2}
geo = {"i": [], "y": [], "x": [], "z": [], "k": [], "q": []}
for pid in ids:
    i = IDX[pid]
    if core["fl"][i] & 32: continue
    for e in details[i].get("events", []):
        if e["type"] not in KIND or not e.get("place"): continue
        y = e.get("y")
        if y is None:
            if e["type"] in ("Birth", "Christening"): y = core["b"][i]
            elif e["type"] in ("Death", "Burial"): y = core["d"][i]
        if y is None: continue
        g = GEO.get(e["place"])
        if not g: continue
        prec = 2 if g.get("exact") else (1 if len((g.get("matched") or "").split(",")) >= 2 else 0)
        geo["i"].append(i); geo["y"].append(y); geo["x"].append(round(g["lon"], 3)); geo["z"].append(round(g["lat"], 3))
        geo["k"].append(KIND[e["type"]]); geo["q"].append(prec)
print("geo events:", len(geo["i"]))

# ---------- notables ----------
def ref(pid):
    return IDX.get(pid, -1)
notables = {"ancestors": [], "cousins": [], "royal": [], "immigrants": [], "military": [], "legends": SUM.get("legends", []), "walls": []}
for pid in ids:
    p = P[pid]
    if p.get("notable") and p.get("ahnentafel"):
        notables["ancestors"].append({"i": IDX[pid], "text": p["notable"]})
        if re.search(r"Revolutionary War|Civil War|patriot|Confederate|militia|regiment|War of 1812", str(p["notable"]), re.I):
            notables["military"].append({"i": IDX[pid], "text": p["notable"]})
    if p.get("immigrant") and p.get("ahnentafel"):
        im = p["immigrant"]
        notables["immigrants"].append({"i": IDX[pid], "year": im.get("year") if isinstance(im, dict) else None,
                                       "from": im.get("from") if isinstance(im, dict) else str(im), "evidence": im.get("evidence") if isinstance(im, dict) else None})
WALK = load("data/raw/notable-kin-walk.json", {"V": {}})["V"]
def descent_chain(notable_fs, ca_fs):
    """chain [{fs,name,life}] from the common ancestor's child down to the notable, via the walk's parent links"""
    if not notable_fs or not ca_fs: return None
    prev = {notable_fs: None}; q = [notable_fs]
    for _ in range(30):
        nq = []
        for x in q:
            v = WALK.get(x)
            if not v: continue
            for par in v[:2]:
                if par and par not in prev:
                    prev[par] = x
                    if par == ca_fs:
                        chain = []; y = x
                        while y:
                            vv = WALK.get(y) or [None, None, None, None]
                            chain.append({"fs": y, "name": vv[2], "life": vv[3]}); y = prev[y]
                        return chain
                    nq.append(par)
        q = nq
    return None
ROUTES = load("data/notable-kin-routes.json", {})   # qid -> alternative Wikidata routes (scripts/notable_kin_routes.py)
def _ord(n): return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")
def _great(k): return "" if k <= 0 else ("great-" if k == 1 else f"{k}x-great-")
def _relationship(a, b, half):
    h = "half " if half else ""
    if b == 0: return f"{_great(a-2)}grandparent" if a >= 2 else "parent"
    if b == 1: return f"{h}{_great(a-3)}{'grand' if a >= 3 else ''}uncle/aunt" if a >= 2 else "sibling"
    if a == 1: return f"{h}sibling"
    c = min(a, b) - 1; r = abs(a - b)
    return f"{h}{_ord(c)} cousin" + (f" {r}x removed" if r else "")
def _side(p):
    sides = set()
    for kk in p.get("ahnentafel") or []:
        kk = int(kk); g = kk.bit_length() - 1
        if g >= 1: sides.add("maternal" if (kk >> (g - 1)) & 1 else "paternal")
    return "both" if len(sides) > 1 else (sides.pop() if sides else None)
def mkroute(pid, b, half, source, chain, conf=None, line=None, partner=None):
    """one kinship route, normalised against the CURRENT pedigree (steps, side, unsupported flags)"""
    p = P.get(pid) or {}
    ah = p.get("ahnentafel")
    g = min(int(x) for x in ah).bit_length() - 1 if ah else None
    rel = None
    if g is not None: rel = _relationship(g, b, half)
    lf = p.get("lineFlag")
    if lf or p.get("tier") == "flagged" or g is None:
        why = ("the common ancestor %s is no longer in the pedigree" % p.get("name")) if g is None else "the line through %s is %s: %s" % (p.get("name"), (lf or {}).get("verdict", "flagged").lower(), (lf or {}).get("reason", ""))
        conf = "UNSUPPORTED – " + why.rstrip(". ")
        if rel: rel += " (unsupported link)"
    elif conf is None and source == "fs":
        conf = "PROBABLE" if p.get("confidence") in ("CONFIRMED", "PROBABLE") else "UNVERIFIED (FamilySearch tree on both sides)"
    return {"rel": rel, "ca": ref(pid), "caName": p.get("name"), "steps": [g, b], "side": _side(p) if g is not None else None, "conf": conf,
            "source": source, "chain": chain, "line": line, "pid": pid, "partner": partner}
def route_rank(r):
    p = P.get(r["pid"]) or {}
    bad = 1 if (r.get("conf") or "").startswith("UNSUPPORTED") else 0
    good = 0 if (p.get("confidence") in ("CONFIRMED", "PROBABLE") or p.get("tier") == "verified") else 1
    return (bad, good, (r["steps"][0] or 99) + r["steps"][1], 0 if r["source"] == "fs" else 1)
def fs_chain(path):
    out = []
    for y in reversed(path[:-1]):
        vv = WALK.get(y) or [None, None, None, None]
        out.append({"fs": y, "name": vv[2], "life": vv[3]})
    return out
def add_routes(c, routes, cap=8, slack=8):
    """merge routes into cousin c: drop duplicates (same ancestor or couple, same length; FS preferred), sort by reliability then steps"""
    allr = c["routes"] + routes
    allr.sort(key=route_rank)
    keep = []
    for r in allr:
        ids = {r["pid"], r.get("partner")} - {None}
        if any(ids & ({q["pid"], q.get("partner")} - {None}) and q["steps"] == r["steps"] for q in keep): continue
        keep.append(r)
    keep = [r for r in keep if r["rel"]]
    if keep:
        best = min((r["steps"][0] or 99) + r["steps"][1] for r in keep)
        keep = [r for r in keep if (r["steps"][0] or 99) + r["steps"][1] <= best + slack][:cap]
    c["routes"] = keep
    if keep:
        t = keep[0]
        c.update({"rel": t["rel"], "ca": t["ca"], "caName": t["caName"], "steps": t["steps"], "conf": t["conf"], "chain": t["chain"], "line": t.get("line"), "side": t["side"]})
for k in KIN:
    rts = k.get("routes") or [dict(k, partner=None, path=None)]
    c = {"name": k.get("name"), "desc": k.get("desc"), "born": k.get("born"), "fame": k.get("fame"), "fs": k.get("fsId"), "routes": []}
    rr = []
    for r in rts:
        ca = r.get("commonAncestor") or {}
        pid = ca.get("id")
        half = (r.get("relationship") or "").startswith("half ")
        chain = fs_chain(r["path"]) if r.get("path") else descent_chain(k.get("fsId"), (P.get(pid) or {}).get("fsId") or pid)
        rr.append(mkroute(pid, r["stepsNotable"], half, "fs", chain, r.get("linkConfidence"), r.get("notableLine"), r.get("partner")))
    add_routes(c, rr)
    notables["cousins"].append(c)
# notable cousins found by walking Wikidata descendants of our ancestors (scripts/notable_kin_wd.py)
known = {(x.get("fs") or "") for x in notables["cousins"]} | {((x.get("name") or "").lower(), x.get("born")) for x in notables["cousins"]}
def _nk(n):
    t = [w for w in re.sub(r"[^a-z ]", " ", unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode().lower()).split()
         if w not in ("sir", "col", "capt", "maj", "dr", "rev", "jr", "sr", "ii", "iii", "iv", "v", "of", "the", "president", "king", "lady", "lord")]
    return (t[0], t[-1]) if len(t) >= 2 else None
ped_names = collections.defaultdict(list)
for pid in ids:
    p = P[pid]
    if p.get("ahnentafel"):
        kk = _nk(p.get("name"))
        if kk and p.get("birthYear"): ped_names[kk].append(p["birthYear"])
def chain_ok(chain):
    return not any(_nk(c.get("name")) and c.get("born") and any(abs(y - c["born"]) <= 2 for y in ped_names.get(_nk(c.get("name")), [])) for c in (chain or [])[:-1])
n_wd_skip = 0
for k in KINWD or []:
    if ((k.get("name") or "").lower(), k.get("born")) in known: continue
    kk = _nk(k.get("name"))
    if kk and k.get("born") and any(abs(y - k["born"]) <= 2 for y in ped_names.get(kk, [])):
        n_wd_skip += 1; continue   # actually one of our own ancestors
    if not chain_ok(k.get("chain")):
        n_wd_skip += 1; continue   # their line runs through one of our own ancestors, so the relationship is miscounted
    ca = k.get("commonAncestor") or {}
    ch = [{"qid": c.get("qid"), "name": c.get("name"), "born": c.get("born"), "died": c.get("died")} for c in (k.get("chain") or [])]
    c = {"name": k.get("name"), "desc": k.get("desc"), "born": k.get("born"), "fame": k.get("fame"), "qid": k.get("qid"), "source": "wikidata", "died": k.get("died"), "routes": []}
    add_routes(c, [mkroute(ca.get("id"), k.get("stepsNotable"), (k.get("relationship") or "").startswith("half "), "wikidata", ch)])
    if not c["routes"]:
        c.update({"rel": k.get("relationship"), "ca": -1, "caName": ca.get("name"), "steps": [k.get("stepsSubject"), k.get("stepsNotable")], "chain": ch})
    notables["cousins"].append(c)
print("wikidata cousins skipped as own ancestors / miscounted:", n_wd_skip)

# alternative routes through Wikidata parent links (scripts/notable_kin_routes.py), merged into the same person
_by_fs = {c.get("fs"): c for c in notables["cousins"] if c.get("fs")}
_by_qid = {c.get("qid"): c for c in notables["cousins"] if c.get("qid")}
_by_nm = collections.defaultdict(list)
for c in notables["cousins"]:
    kk = _nk(c.get("name"))
    if kk and c.get("born"): _by_nm[kk].append(c)
n_multi = 0
for qid_, e in ROUTES.items():
    c = _by_fs.get(e.get("fs")) or _by_qid.get(qid_)
    if not c:
        kk = _nk(e.get("name"))
        c = next((x for x in _by_nm.get(kk, []) if kk), None)
        if c and not any(abs(x["born"] - c["born"]) <= 1 for x in [c]): c = None
    if not c: continue
    rr = []
    for r in e["routes"]:
        if not chain_ok(r["chain"]): continue
        rr.append(mkroute(r["pid"], r["b"], r.get("half", False), "wikidata", r["chain"], None, None, r.get("partner")))
    if rr: add_routes(c, rr)
for c in notables["cousins"]:
    if len(c.get("routes") or []) > 1: n_multi += 1
for c in notables["cousins"]:   # slim the output: route 0 is already the top-level fields; internal ids and nulls are dropped
    c["routes"] = [{k: v for k, v in r.items() if v is not None and k not in ("pid", "partner", "line") and not (n == 0 and k == "chain")} for n, r in enumerate(c.get("routes") or [])]
    if len(c["routes"]) < 2: c.pop("routes", None)
print("cousins with more than one route:", n_multi, "of", len(notables["cousins"]))
for r in ROYAL.get("viaGateway", []):
    notables["royal"].append({"i": ref(r.get("id")), "desc": r.get("desc"), "born": r.get("born"), "fame": r.get("fame"),
                              "gateway": r.get("gateway"), "up": r.get("generationsAboveGateway"), "accepted": True})
for r in ROYAL.get("treeOnly", [])[:600]:
    notables["royal"].append({"i": ref(r.get("id")), "desc": r.get("desc"), "born": r.get("born"), "fame": r.get("fame"), "accepted": False, "tier": r.get("tier")})
notables["royal"] = [r for r in notables["royal"] if r["i"] >= 0]
for w in SUM.get("brickWalls", []):
    if w["id"] in IDX: notables["walls"].append({"i": IDX[w["id"]], "missing": w["missing"]})

# ---------- memorial ----------
_cnt = {}
for e in ENSL["counts"]:
    key = (e.get("enslaverId"), e.get("year"))
    if key not in _cnt or (e.get("persons") and not _cnt[key].get("persons")): _cnt[key] = e
ENSL["counts"] = list(_cnt.values())
memorial = {"people": [{**{k: e.get(k) for k in ("name", "description", "place", "year", "notes")}, "by": ref(e.get("enslaverId"))} for e in ENSL["people"]],
            "counts": [{**{k: e.get(k) for k in ("year", "place", "count", "confidence", "enumeratedAs", "url", "persons", "note")}, "by": ref(e.get("enslaverId"))} for e in ENSL["counts"]]}

# ---------- stats ----------
gen_c = collections.Counter(); tier_c = collections.Counter(); conf_c = collections.Counter()
country_by_gen = collections.defaultdict(collections.Counter)
for i in range(N):
    g = core["g"][i]
    if g < 0: continue
    gen_c[g] += 1; tier_c[TIERS[core["t"][i]]] += 1; conf_c[CONFS[core["c"][i]]] += 1
    if core["fl"][i] & 16: continue
    bp = core["bp"][i]
    if g <= 30 and bp >= 0:
        c = country_of(places[bp])
        if c: country_by_gen[g][c] += 1
top = ['United States', 'England', 'Scotland', 'Ireland', 'Wales', 'France', 'Germany']
stats = {"people": N, "pedigree": sum(gen_c.values()), "alternate": sum(1 for i in range(N) if core["fl"][i] & 32),
         "byGeneration": {g: gen_c[g] for g in sorted(gen_c)}, "tiers": dict(tier_c), "confidence": dict(conf_c),
         "portraits": len(core["pt"]), "photos": sum(len((MEDIA.get(pid) or {}).get("photos") or []) for pid in ids),
         "sources": len(SRC) + sum(len(v) for v in FSSRC.values()), "places": len(GEO), "geoEvents": len(geo["i"]),
         "countries": top, "countryByGen": {g: {c: country_by_gen[g].get(c, 0) for c in top} | {"Other": sum(v for c, v in country_by_gen[g].items() if c not in top)} for g in sorted(country_by_gen)},
         "maxGeneration": max(gen_c), "notableCousins": len(KIN), "royal": len(notables["royal"]), "enslaved": len(ENSL["people"])}

def write(name, obj):
    s = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    (OUT / name).write_text(s, encoding="utf-8")
    print(f"{name}: {len(s) / 1e6:.1f} MB")
CONS = load("data/consanguinity.json", None)
if CONS:
    cons = {"rootF": CONS["rootF"], "rootFclean": CONS["rootFclean"], "note": CONS["note"],
            "couples": [{**{k: c[k] for k in ("F", "Fclean", "n1", "n2", "label", "gen", "nCommon", "suspect")},
                         "child": IDX.get(c["child"], -1), "f": IDX.get(c["f"], -1), "m": IDX.get(c["m"], -1),
                         "ca": [IDX.get(x, -1) for x in c["ca"]]} for c in CONS["couples"] if c["child"] in IDX]}
    write("consanguinity.json", cons)
write("core.json", core); write("geo.json", geo); write("notables.json", notables); write("memorial.json", memorial); write("stats.json", stats)
print("details chunks:", (N + CH - 1) // CH)
