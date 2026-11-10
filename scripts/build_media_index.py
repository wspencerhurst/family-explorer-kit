"""Build data/media/index.json: per person (people.json id) -> portrait, photos, stories, bios, facts, findagrave.

Sources (all in data/media/):
  fs-media.json          FamilySearch facts, memories (images/documents/stories) keyed by FS id
  ancestry-photos.json   primary photos from the parents' Ancestry trees (base64), matched by name + birth year
  findagrave-climb.json  Find a Grave memorials (photos, bio, inscription, cemetery), matched by name + birth/death year
  wiki-media.json        WikiTree / Wikipedia portraits and bios keyed by person id
Ancestry images are written to data/media/img/ as files; other images are referenced by public URL.
Portrait priority: Ancestry family photo > Wikipedia > FamilySearch photo > Find a Grave photo > WikiTree.
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG
import json, re, pathlib, base64, unicodedata, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
MD = ROOT / "data/media"; IMG = MD / "img"; IMG.mkdir(exist_ok=True)
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
def load(n):
    f = MD / n
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
fs, anc, fag, wiki = load("fs-media.json"), load("ancestry-photos.json"), load("findagrave-climb.json"), load("wiki-media.json")

KEYMAP = json.loads((ROOT / "data/keymap.json").read_text(encoding="utf-8")) if (ROOT / "data/keymap.json").exists() else {}
fs2pid = {}
for pid, p in P.items():
    if p.get("fsId"): fs2pid[p["fsId"]] = pid
STOP = {"sir", "lady", "dr", "rev", "col", "capt", "maj", "jr", "sr", "ii", "iii", "iv", "of", "the", "mrs", "mr"}
def nkey(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)|\".*?\"|&amp;.*", " ", s)
    t = [w for w in re.sub(r"[^a-z ]", " ", s).split() if w not in STOP and len(w) > 1]
    return (t[0], t[-1]) if len(t) >= 2 else None
def yr(s):
    m = re.search(r"\b(1[0-9]{3}|20[0-2][0-9])\b", s or ""); return int(m.group(1)) if m else None
idx_name = collections.defaultdict(list)
for pid, p in P.items():
    if not (p.get("ahnentafel") or p.get("altOf")): continue
    k = nkey(p.get("name"))
    if k: idx_name[k].append(pid)
def match(name, by=None, dy=None):
    k = nkey(name)
    if not k: return None
    c = []
    for pid in idx_name.get(k, []):
        p = P[pid]
        pb = p.get("birthYear") if not p.get("birthYearEst") else None
        pd = yr((p.get("death") or {}).get("date") if isinstance(p.get("death"), dict) else None)
        ok = (by and pb and abs(by - pb) <= 1) or (dy and pd and abs(dy - pd) <= 1)
        bad = (by and pb and abs(by - pb) > 2) or (dy and pd and abs(dy - pd) > 2)
        if ok and not bad: c.append(pid)
    return c[0] if len(c) == 1 else None

index = collections.defaultdict(lambda: {"portrait": None, "photos": [], "stories": [], "bios": [], "facts": [], "findagrave": None})
# FamilySearch
for fsid, facts in (fs.get("facts") or {}).items():
    pid = fs2pid.get(fsid)
    if pid: index[pid]["facts"] = [{"type": t, "date": d, "place": pl, "value": v} for t, d, pl, v in facts]
stories = fs.get("stories") or {}
for fsid, mems in (fs.get("memories") or {}).items():
    pid = fs2pid.get(fsid)
    if not pid: continue
    for m in mems:
        t = (m.get("type") or "")
        if t.startswith("image"):
            index[pid]["photos"].append({"source": "FamilySearch", "title": m.get("title"), "desc": m.get("desc"), "thumb": m.get("thumb"), "url": m.get("image") or m.get("about"), "page": m.get("memory")})
        elif t == "text/plain" and stories.get(m["id"]):
            index[pid]["stories"].append({"source": "FamilySearch", "title": m.get("title"), "text": stories[m["id"]]})
        elif m.get("about"):
            index[pid]["photos"].append({"source": "FamilySearch", "kind": "document", "title": m.get("title"), "type": t, "url": m.get("about"), "page": m.get("memory")})
# Ancestry (base64 -> files)
n_anc = 0
for key, v in (anc.get("photos") or {}).items():
    if not v.get("data"): continue
    km = KEYMAP.get(f"anc{ (CFG.get('ancestryTrees') or {}).get(str(v['tree']),'') }-{v['pid']}")
    pid = km if km in P and (P[km].get("ahnentafel") or P[km].get("altOf")) else match(v.get("name"), yr(v.get("birth")))
    if not pid: continue
    head, b64 = v["data"].split(",", 1)
    ext = "png" if "png" in head else "jpg"
    fn = f"anc-{v['tree']}-{v['pid']}.{ext}"
    (IMG / fn).write_bytes(base64.b64decode(b64))
    index[pid]["photos"].insert(0, {"source": "Ancestry (family tree)", "title": v.get("name"), "file": f"img/{fn}"})
    n_anc += 1
# Find a Grave: direct name/year matches, then propagate along parent links (memorial parent <-> our parent, first name must agree)
mems = fag.get("memorials") or {}
fagmap = {}
for mid, m in mems.items():
    pid = match(m.get("name"), yr(m.get("birth")), yr(m.get("death")))
    if pid: fagmap[mid] = pid
def first(n):
    k = nkey(n); return k[0] if k else None
for _ in range(30):
    added = 0
    for mid, pid in list(fagmap.items()):
        for par in mems.get(mid, {}).get("parents") or []:
            if par in fagmap or par not in mems: continue
            for r in ("father", "mother"):
                op = P.get(P[pid].get(r))
                if op and first(op.get("name")) == first(mems[par].get("name")):
                    by, pb = yr(mems[par].get("birth")), (op.get("birthYear") if not op.get("birthYearEst") else None)
                    if by and pb and abs(by - pb) > 3: continue
                    fagmap[par] = P[pid][r]; added += 1; break
    if not added: break
n_fag = 0
for mid, pid in fagmap.items():
    m = mems[mid]
    n_fag += 1
    index[pid]["findagrave"] = {"memorial": f"https://www.findagrave.com/memorial/{mid}", "cemetery": m.get("cemetery"), "inscription": m.get("inscription"),
                                "birth": m.get("birth"), "death": m.get("death")}
    for ph in m.get("photos") or []:
        index[pid]["photos"].append({"source": "Find a Grave", "url": ph, "thumb": ph + "?size=photos250", "page": f"https://www.findagrave.com/memorial/{mid}"})
    if m.get("bio") and len(m["bio"]) > 40:
        index[pid]["bios"].append({"source": "Find a Grave", "url": f"https://www.findagrave.com/memorial/{mid}", "text": m["bio"]})
# WikiTree / Wikipedia
for pid, w in wiki.items():
    if pid not in P: continue
    for ph in w.get("portraits") or []:
        index[pid]["photos"].append({"source": ph.get("source"), "url": ph.get("url"), "thumb": ph.get("thumb") or ph.get("url"), "page": ph.get("page")})
    index[pid]["bios"].extend(w.get("bios") or [])
# portrait choice
order = ["Ancestry (family tree)", "Wikipedia", "FamilySearch", "Find a Grave", "WikiTree"]
for pid, e in index.items():
    imgs = [ph for ph in e["photos"] if ph.get("kind") != "document"]
    for src in order:
        cand = [ph for ph in imgs if ph.get("source") == src]
        if src == "FamilySearch":
            nm = (P[pid].get("name") or "").split()[-1:] or [""]
            cand.sort(key=lambda ph: 0 if re.search(r"portrait|photo|picture", (ph.get("title") or ""), re.I) or nm[0].lower() in (ph.get("title") or "").lower() else 1)
        if cand:
            e["portrait"] = {k: cand[0].get(k) for k in ("source", "url", "thumb", "file", "page") if cand[0].get(k)}; break
out = {pid: e for pid, e in index.items() if e["photos"] or e["stories"] or e["bios"] or e["facts"] or e["findagrave"]}
(MD / "index.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
ped = {pid for pid, p in P.items() if p.get("ahnentafel")}
print(f"people with media entries: {len(out)} (in pedigree {len(ped & set(out))})")
print(f"  with portrait: {sum(1 for e in out.values() if e['portrait'])}; photos: {sum(len(e['photos']) for e in out.values())}; stories: {sum(len(e['stories']) for e in out.values())}; bios: {sum(len(e['bios']) for e in out.values())}")
print(f"  Ancestry photos matched: {n_anc}; Find a Grave memorials matched: {n_fag}")
near = sorted((min(int(n) for n in P[pid]['ahnentafel']), P[pid]['name'], e['portrait']['source']) for pid, e in out.items() if e['portrait'] and pid in ped)
print("  closest ancestors with portraits:", near[:25])
