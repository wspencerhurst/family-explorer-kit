"""Find notable cousins by walking DOWN Wikidata child links from our pedigree ancestors (matched via FamilySearch ID P2889).
Re-runnable; SPARQL responses cached in data/raw/wd-cache.json.  Output: data/notable-kin-wd.json, research/notable-kin-wd.md
Usage: python notable_kin_wd.py [maxdepth]
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, pathlib, ssl, sys, time, urllib.request, urllib.parse, collections, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE_F = ROOT / "data/raw/wd-cache.json"
MAXD = int(sys.argv[1]) if len(sys.argv) > 1 else 12
UA = KIT_UA
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()

P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
K = json.loads((ROOT / "data/notable-kin.json").read_text(encoding="utf-8"))
cache = json.loads(CACHE_F.read_text(encoding="utf-8")) if CACHE_F.exists() else {"fs": {}, "kids": {}, "det": {}}
_last = [0.0]
_unsaved = [0]


def save():
    CACHE_F.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    _unsaved[0] = 0


def sparql(q):
    for attempt in range(8):
        dt = time.time() - _last[0]
        if dt < 1.5:
            time.sleep(1.5 - dt)
        _last[0] = time.time()
        req = urllib.request.Request("https://query.wikidata.org/sparql",
                                     data=urllib.parse.urlencode({"query": q, "format": "json"}).encode(),
                                     headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
        try:
            with urllib.request.urlopen(req, context=CTX, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))["results"]["bindings"]
        except Exception as e:
            code = getattr(e, "code", 0)
            wait = min(120, 5 * 2 ** attempt)
            print("  retry", attempt, code or e, "wait", wait, flush=True)
            time.sleep(wait)
    raise RuntimeError("sparql failed")


def qid(u):
    return u.rsplit("/", 1)[-1]


def chunks(l, n):
    for i in range(0, len(l), n):
        yield l[i:i + n]


def gen(p):
    return min(int(k) for k in p["ahnentafel"]).bit_length() - 1


def ordinal(n):
    return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")


def great(k):
    return "" if k <= 0 else ("great-" if k == 1 else f"{k}x-great-")


def relationship(a, b, half):
    h = "half " if half else ""
    if b == 0:
        return f"{great(a-2)}grandparent" if a >= 2 else "parent"
    if b == 1:
        return f"{h}{great(a-3)}{'grand' if a >= 3 else ''}uncle/aunt" if a >= 2 else "sibling"
    if a == 1:
        return f"{h}sibling"
    c = min(a, b) - 1
    r = abs(a - b)
    return f"{h}{ordinal(c)} cousin" + (f" {r}x removed" if r else "")


# ---- 1. ancestors -> QIDs
allanc = {pid: p for pid, p in P.items() if p.get("ahnentafel") and p.get("tier") in ("verified", "tree", "conflict")}
qual = {pid: p for pid, p in allanc.items() if p.get("tier") in ("verified", "tree", "conflict")
        and not p.get("lineFlag") and (p.get("birthYear") or 0) >= 1550}


def fs_of(pid, p):
    return p.get("fsId") or pid


need = sorted({fs_of(pid, p) for pid, p in allanc.items()} - set(cache["fs"]))
need = [f for f in need if re.fullmatch(r"[A-Z0-9]{4}-[A-Z0-9]{3,4}", f)]
print("fs ids to map:", len(need), flush=True)
for ch in chunks(need, 200):
    rows = sparql("SELECT ?fs ?i WHERE { VALUES ?fs {%s} ?i wdt:P2889 ?fs }" % " ".join('"%s"' % f for f in ch))
    for f in ch:
        cache["fs"].setdefault(f, [])
    for r in rows:
        cache["fs"][r["fs"]["value"]].append(qid(r["i"]["value"]))
    save()
extra = {}   # pid -> set(qid) from WikiTree id and name+birth-year matching
cache.setdefault("wt", {}); cache.setdefault("nm", {})
TITLES = r"(rev|maj|col|capt|cpt|dr|gen|sir|hon|lt|gov|sgt|judge|president|colonel|major|captain|general|reverend|esq|jr|sr|mr|mrs|ii|iii|iv|the|lord|lady|dame)\.?"


def variants(name):
    n = re.sub(r"\(.*?\)|\{.*?\}|\[.*?\]|\".*?\"", " ", name)
    n = re.sub(TITLES, " ", n, flags=re.I)
    n = re.sub(r"[^\w\s'\-\.]", " ", n).replace(".", " ")
    t = n.split()
    out = set()
    if len(t) >= 2:
        out.add(" ".join(t))
        out.add(t[0] + " " + t[-1])
    return out


wts = sorted({p["wikitreeId"] for p in qual.values() if p.get("wikitreeId")} - set(cache["wt"]))
for ch in chunks(wts, 150):
    rows = sparql("SELECT ?w ?i WHERE { VALUES ?w {%s} ?i wdt:P2949 ?w }" % " ".join('"%s"' % w for w in ch))
    for w in ch:
        cache["wt"].setdefault(w, [])
    for r in rows:
        cache["wt"][r["w"]["value"]].append(qid(r["i"]["value"]))
    save()
pairs = {}
for pid, p in qual.items():
    if p.get("birthYearEst") or not p.get("birthYear"):
        continue
    for v in variants(p["name"]):
        pairs.setdefault((v, p["birthYear"]), []).append(pid)
todo_pairs = [k for k in sorted(pairs) if "%s|%d" % k not in cache["nm"]]
print("name/year pairs to query:", len(todo_pairs), flush=True)
for ch in chunks(todo_pairs, 60):
    vals = " ".join('("%s"@en %d)' % (n.replace("\\", "").replace('"', ""), y) for n, y in ch)
    rows = sparql("""SELECT ?l ?y ?i ?by ?dy WHERE { VALUES (?l ?y) {%s} ?i rdfs:label ?l . ?i wdt:P31 wd:Q5 ; wdt:P569 ?b .
      BIND(YEAR(?b) AS ?by) FILTER(ABS(?by - ?y) <= 1) OPTIONAL { ?i wdt:P570 ?d BIND(YEAR(?d) AS ?dy) } }""" % vals)
    for n, y in ch:
        cache["nm"]["%s|%d" % (n, y)] = []
    for r in rows:
        n = r["l"]["value"]; y = int(float(r["y"]["value"]))
        k = "%s|%d" % (n, y)
        if k in cache["nm"]:
            cache["nm"][k].append([qid(r["i"]["value"]), int(float(r["by"]["value"])), int(float(r["dy"]["value"])) if "dy" in r else None])
    save()
for pid, p in qual.items():
    for w in [p.get("wikitreeId")] if p.get("wikitreeId") else []:
        for q in cache["wt"].get(w, []):
            extra.setdefault(pid, set()).add(q)
    dy_ours = None
    m = re.search(r"-(\d{4})", p.get("lifespan") or "")
    if m: dy_ours = int(m.group(1))
    for v in variants(p["name"]):
        for q, by, dy in cache["nm"].get("%s|%s" % (v, p.get("birthYear")), []):
            if p.get("birthYearEst"): continue
            if dy_ours and dy and abs(dy - dy_ours) > 1: continue
            extra.setdefault(pid, set()).add(q)
print("name/wikitree matches:", len(extra), flush=True)
anc_q = {}
for pid, p in allanc.items():
    for q in cache["fs"].get(fs_of(pid, p), []):
        anc_q[q] = pid
starts = {}
for pid, p in qual.items():
    for q in cache["fs"].get(fs_of(pid, p), []):
        starts[q] = pid
for pid, qs in extra.items():
    for q in qs:
        anc_q.setdefault(q, pid); starts.setdefault(q, pid)
print("qualifying ancestors", len(qual), "matched to Wikidata", len(starts), "all ancestors matched", len(anc_q), flush=True)


# ---- 2. walk down
def get_kids(ids):
    todo = [i for i in ids if i not in cache["kids"]]
    for ch in chunks(todo, 80):
        v = " ".join("wd:" + i for i in ch)
        rows = sparql("SELECT ?p ?c WHERE { VALUES ?p {%s} { ?p wdt:P40 ?c } UNION { ?c wdt:P22 ?p } UNION { ?c wdt:P25 ?p } }" % v)
        for i in ch:
            cache["kids"][i] = []
        for r in rows:
            p_, c_ = qid(r["p"]["value"]), qid(r["c"]["value"])
            if c_ not in cache["kids"][p_]:
                cache["kids"][p_].append(c_)
        _unsaved[0] += 1
        if _unsaved[0] >= 5:
            save()
    save()
    return {i: cache["kids"][i] for i in ids}


best = {}   # node -> (score, start, parent)
frontier = []
for q, pid in starts.items():
    best[q] = (gen(P[pid]), q, None)
    frontier.append(q)
for d in range(1, MAXD + 1):
    if not frontier:
        break
    kids = get_kids(sorted(set(frontier)))
    nxt = []
    for par in set(frontier):
        sc, st, _ = best[par]
        for c in kids[par]:
            if c in anc_q:
                continue
            ns = sc + 1
            if c in best and best[c][0] <= ns:
                continue
            best[c] = (ns, st, par)
            nxt.append(c)
    frontier = nxt
    print(f"depth {d}: {len(nxt)} new/improved nodes, total {len(best)}", flush=True)

# ---- 3. details
cands = sorted(q for q in best if q not in starts)
print("candidates", len(cands), flush=True)
todo = [q for q in cands if q not in cache["det"]]
for ch in chunks(todo, 250):
    v = " ".join("wd:" + i for i in ch)
    rows = sparql("""SELECT ?i (SAMPLE(?l) AS ?label) (SAMPLE(?d) AS ?desc) (MIN(?b) AS ?birth) (MIN(?dd) AS ?death) (SAMPLE(?sl) AS ?sl) (SAMPLE(?im) AS ?img) (SAMPLE(?fs) AS ?fs) (SAMPLE(?w) AS ?wp) WHERE {
      VALUES ?i {%s} ?i wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl .
      OPTIONAL { ?i rdfs:label ?l FILTER(lang(?l)="en") } OPTIONAL { ?i schema:description ?d FILTER(lang(?d)="en") }
      OPTIONAL { ?i wdt:P569 ?bd BIND(YEAR(?bd) AS ?b) } OPTIONAL { ?i wdt:P570 ?ddt BIND(YEAR(?ddt) AS ?dd) }
      OPTIONAL { ?i wdt:P18 ?im } OPTIONAL { ?i wdt:P2889 ?fs }
      OPTIONAL { ?w schema:about ?i ; schema:isPartOf <https://en.wikipedia.org/> }
    } GROUP BY ?i""" % v)
    for i in ch:
        cache["det"][i] = None
    for r in rows:
        def g(k):
            return r[k]["value"] if k in r else None
        cache["det"][qid(r["i"]["value"])] = {
            "name": g("label"), "desc": g("desc"), "born": int(float(g("birth"))) if g("birth") else None,
            "died": int(float(g("death"))) if g("death") else None, "fame": int(g("sl")), "wp": bool(g("wp")),
            "image": urllib.parse.unquote(g("img").rsplit("/", 1)[-1]) if g("img") else None, "fs": g("fs")}
    save()
    print("  details", len(cache["det"]), flush=True)

# ---- 4. build output
known_fs = {k.get("fsId") for k in K}
known_nb = {((k["name"] or "").lower(), k.get("born")) for k in K}


def chain_of(n):
    c = []
    while best[n][2] is not None:
        c.append(n)
        n = best[n][2]
    return list(reversed(c)), n


def short(q):
    d = cache["det"].get(q) or {}
    return {"qid": q, "name": d.get("name") or q, "born": d.get("born"), "died": d.get("died")}


out = []
for q in cands:
    d = cache["det"].get(q)
    if not d or not (d["fame"] >= 4 or d["wp"]) or not d["name"] or re.fullmatch(r"Q\d+", d["name"]):
        continue
    if d["fs"] in known_fs or (d["name"].lower(), d["born"]) in known_nb:
        continue
    ch, root = chain_of(q)
    pid = starts[root]
    X = P[pid]
    pre = []
    half = False
    a, b = gen(X), len(ch) + len(pre)
    out.append({"name": d["name"], "desc": d["desc"], "born": d["born"], "died": d["died"], "qid": q, "fame": d["fame"],
                "image": d["image"], "relationship": relationship(a, b, half), "stepsSubject": a, "stepsNotable": b,
                "commonAncestor": {"id": pid, "name": X["name"], "ahnentafel": min(int(k) for k in X["ahnentafel"])},
                "chain": pre + [short(x) for x in ch]})
out.sort(key=lambda r: (r["stepsSubject"] + r["stepsNotable"], -r["fame"]))
(ROOT / "data/notable-kin-wd.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

# ---- 5. report
cent = collections.Counter(((r["born"] // 100 + 1) if r["born"] else 0) for r in out)
after1900 = [r for r in out if r["born"] and r["born"] >= 1900]
living = [r for r in after1900 if not r["died"]]
md = ["# Notable relatives via Wikidata descendant walk", "",
      f"Walked down child links (P40, P22/P25 inverse, up to {MAXD} generations) from {len(starts)} Wikidata-matched pedigree ancestors "
      f"(of {len(qual)} qualifying), reaching {len(best)} people. {len(out)} new notable people (human, >=4 sitelinks or an enwiki article), "
      "not already in notable-kin.json. All shown as full (not half) relations (Wikidata rarely lets us tell).",
      f"Born 1900 or later: {len(after1900)}; apparently living (no death date, born >=1900): {len(living)}.", "", "## Birth century", ""]
for c in sorted(cent):
    md.append(f"- {'unknown' if c == 0 else str(c) + 'th century'}: {cent[c]}")
md += ["", "## Top 40 closest", "", "| Name | Born | Who | Relationship | Via | Fame |", "|---|---|---|---|---|---|"]
for r in out[:40]:
    md.append(f"| {r['name']} | {r['born']} | {(r['desc'] or '')[:60]} | {r['relationship']} | {r['commonAncestor']['name']} (#{r['commonAncestor']['ahnentafel']}) | {r['fame']} |")
md += ["", "## Closest born after 1900", ""]
for r in sorted(after1900, key=lambda r: (r["stepsSubject"] + r["stepsNotable"], -r["fame"]))[:40]:
    md.append(f"- {r['name']} ({r['born']}-{r['died'] or ''}) {(r['desc'] or '')[:50]}: {r['relationship']} via {r['commonAncestor']['name']}")
(ROOT / "research/notable-kin-wd.md").write_text("\n".join(md), encoding="utf-8")
print(len(out), "notables;", len(after1900), "born>=1900;", len(living), "living")
