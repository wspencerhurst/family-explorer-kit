"""Extend dead-end ancestors (missing a parent) using WikiTree.

For each post-1500, non-flagged ancestor missing a parent:
  1. searchPerson by first given name + surname + birth year
  2. accept a profile only if the birth year is within 2 years (when known) AND one of its children matches the
     first name + surname of our known child (the person through whom they are our ancestor)
  3. getAncestors (depth 10) and record every new ancestor with parent links
Output: research/lines/wikitree-ext.json (UNVERIFIED; source = WikiTree profile), resumable via data/raw/wikitree-cache.json
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, re, time, pathlib, urllib.request, urllib.parse, unicodedata, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
CACHE_F = ROOT / "data/raw/wikitree-cache.json"
cache = json.loads(CACHE_F.read_text(encoding="utf-8")) if CACHE_F.exists() else {}
API = "https://api.wikitree.com/api.php"

def api(**params):
    params["appId"] = CFG.get("wikitreeAppId", "familyExplorerKit")
    url = API + "?" + urllib.parse.urlencode(params)
    if url in cache: return cache[url]
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": KIT_UA}), timeout=60) as r:
                data = json.loads(r.read().decode("utf-8"))
            cache[url] = data; time.sleep(1.0); return data
        except Exception as e:
            wait = 15 * (attempt + 1) if "429" in str(e) else 5
            time.sleep(wait)
    return None

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return [w for w in re.sub(r"[^a-z ]", " ", re.sub(r"\(.*?\)|\".*?\"", " ", s)).split()
            if w not in {"sir", "lady", "dr", "rev", "col", "capt", "maj", "jr", "sr", "ii", "iii", "iv", "of", "the", "mrs", "mr"} and len(w) > 1]
def yr(s):
    m = re.search(r"(\d{4})", s or ""); y = int(m.group(1)) if m else None
    return y if y and y > 1000 else None

children = {}
for pid, p in P.items():
    for r in ("father", "mother"):
        if p.get(r): children.setdefault(p[r], []).append(pid)

targets = []
for pid, p in P.items():
    if not p.get("ahnentafel") or p.get("tier") not in ("verified", "tree", "conflict"): continue
    if p.get("father") and p.get("mother"): continue
    by = p.get("birthYear")
    if not by or by < 1500: continue
    kids = [P[c] for c in children.get(pid, []) if c in P and P[c].get("ahnentafel")]
    if not kids: continue
    targets.append((pid, p, kids[0]))
print(f"targets: {len(targets)}", flush=True)

persons, matched, n = {}, [], 0
def wt_key(name): return "wt-" + name
for pid, p, kid in targets:
    n += 1
    t = norm(p.get("name"))
    if len(t) < 2: continue
    first, last, by = t[0], t[-1], p.get("birthYear")
    res = api(action="searchPerson", FirstName=first.title(), LastName=last.title(), BirthDate=str(by), limit=10,
              fields="Id,Name,FirstName,LastNameAtBirth,LastNameCurrent,BirthDate,DeathDate,BirthLocation,Father,Mother")
    matches = (res or [{}])[0].get("matches", []) if isinstance(res, list) else []
    kt = norm(kid.get("name"))
    hit = None
    for m in matches:
        if (m.get("FirstName") or "").lower().split(" ")[0] != first: continue
        ln = {(m.get("LastNameAtBirth") or "").lower(), (m.get("LastNameCurrent") or "").lower()}
        if last not in ln: continue
        wy = yr(m.get("BirthDate"))
        if wy and abs(wy - by) > 2: continue
        rel = api(action="getRelatives", keys=m["Name"], getChildren=1, fields="Id,Name,FirstName,LastNameAtBirth,BirthDate")
        try:
            kids = rel[0]["items"][0]["person"].get("Children", {}) or {}
        except Exception:
            kids = {}
        if any((c.get("FirstName") or "").lower().split(" ")[0] == kt[0] and (c.get("LastNameAtBirth") or "").lower() == kt[-1]
               for c in kids.values()):
            hit = m; break
    if not hit: continue
    anc = api(action="getAncestors", key=hit["Name"], depth=10,
              fields="Id,Name,FirstName,MiddleName,LastNameAtBirth,BirthDate,DeathDate,BirthLocation,DeathLocation,Gender,Father,Mother")
    try:
        ancestors = anc[0]["ancestors"]
    except Exception:
        continue
    by_id = {a["Id"]: a for a in ancestors}
    me = by_id.get(hit["Id"])
    if not me: continue
    matched.append({"ourId": pid, "name": p.get("name"), "wikitree": hit["Name"], "new": len(ancestors) - 1})
    link = {"key": pid[2:] if pid.startswith("R:") else "fs-" + pid, "fsId": None if pid.startswith("R:") else pid,
            "name": p.get("name"), "wikitreeId": hit["Name"], "confidence": "UNVERIFIED", "sources": ["S-wikitree"],
            "notes": f"Matched to WikiTree {hit['Name']} (name, birth year, child {kid.get('name')})."}
    if pid.startswith("R:"): link["key"] = pid[2:]
    f, mo = by_id.get(me.get("Father")), by_id.get(me.get("Mother"))
    if f and not p.get("father"): link["father"] = wt_key(f["Name"])
    if mo and not p.get("mother"): link["mother"] = wt_key(mo["Name"])
    persons[link["key"]] = link
    for a in ancestors:
        if a["Id"] == hit["Id"]: continue
        k = wt_key(a["Name"])
        if k in persons: continue
        nm = " ".join(x for x in (a.get("FirstName"), a.get("MiddleName"), a.get("LastNameAtBirth")) if x)
        e = {"key": k, "name": nm, "wikitreeId": a["Name"], "sex": {"Male": "M", "Female": "F"}.get(a.get("Gender")),
             "birth": {"date": a.get("BirthDate"), "place": a.get("BirthLocation")} if a.get("BirthDate") or a.get("BirthLocation") else None,
             "death": {"date": a.get("DeathDate"), "place": a.get("DeathLocation")} if a.get("DeathDate") or a.get("DeathLocation") else None,
             "confidence": "UNVERIFIED", "sources": ["S-wikitree"], "notes": f"WikiTree {a['Name']} (https://www.wikitree.com/wiki/{a['Name']})"}
        if by_id.get(a.get("Father")): e["father"] = wt_key(by_id[a["Father"]]["Name"])
        if by_id.get(a.get("Mother")): e["mother"] = wt_key(by_id[a["Mother"]]["Name"])
        persons[k] = e
    if n % 25 == 0:
        CACHE_F.write_text(json.dumps(cache), encoding="utf-8")
        print(f"{n}/{len(targets)} processed, {len(matched)} matched, {len(persons)} persons", flush=True)

CACHE_F.write_text(json.dumps(cache), encoding="utf-8")
doc = {"task": "wikitree-ext", "updated": time.strftime("%Y-%m-%d"), "persons": list(persons.values()),
       "sources": [{"id": "S-wikitree", "title": "WikiTree profiles (user-contributed; sourced to varying degrees)", "url": "https://www.wikitree.com/", "type": "user tree"}],
       "matched": matched}
(ROOT / "research/lines/wikitree-ext.json").write_text(json.dumps(doc, ensure_ascii=False, indent=0), encoding="utf-8")
print(f"done: {len(matched)} dead ends extended, {len(persons)} persons written")
