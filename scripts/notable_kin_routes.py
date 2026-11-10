"""Alternative kinship routes through Wikidata parent links.

For every notable (FamilySearch cousins in data/notable-kin.json, and Wikidata cousins in data/notable-kin-wd.json) walk UP Wikidata
parent links (P22/P25, inverse P40) and collect every distinct qualifying ancestor of ours reached, like notable_kin.py does for FamilySearch.
Uses the existing cache data/raw/wd-cache.json (kids inverted into a parent map) and fills gaps with polite SPARQL queries
(cache keys added: fsn = fsId -> [qid] for notables, par = qid -> [parent qids], lbl = qid -> [name, born, died]).
Output: data/notable-kin-routes.json  {qid: {name, fs, routes:[{pid, a, b, side, half, chain:[{qid,name,born,died}]}]}}
Usage: python notable_kin_routes.py [maxQueries=400] [maxDepth=14] [only-qid ...]
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, pathlib, ssl, sys, time, urllib.request, urllib.parse, collections, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
CACHE_F = ROOT / "data/raw/wd-cache.json"
MAXQ = int(sys.argv[1]) if len(sys.argv) > 1 else 400
MAXD = int(sys.argv[2]) if len(sys.argv) > 2 else 14
ONLY = set(sys.argv[3:])
UA = KIT_UA
try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    CTX = ssl.create_default_context()

P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
K = json.loads((ROOT / "data/notable-kin.json").read_text(encoding="utf-8"))
KW = json.loads((ROOT / "data/notable-kin-wd.json").read_text(encoding="utf-8"))
cache = json.loads(CACHE_F.read_text(encoding="utf-8"))
for k in ("fsn", "par", "lbl"):
    cache.setdefault(k, {})
_last = [0.0]; nq = [0]


def save():
    CACHE_F.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def sparql(q):
    for attempt in range(7):
        dt = time.time() - _last[0]
        if dt < 1.5: time.sleep(1.5 - dt)
        _last[0] = time.time(); nq[0] += 1
        req = urllib.request.Request("https://query.wikidata.org/sparql", data=urllib.parse.urlencode({"query": q, "format": "json"}).encode(),
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


def qid(u): return u.rsplit("/", 1)[-1]
def chunks(l, n):
    for i in range(0, len(l), n): yield l[i:i + n]


def gen(p): return min(int(k) for k in p["ahnentafel"]).bit_length() - 1
def ordinal(n): return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")
def great(k): return "" if k <= 0 else ("great-" if k == 1 else f"{k}x-great-")
def relationship(a, b, half=False):
    h = "half " if half else ""
    if b == 0: return f"{great(a-2)}grandparent" if a >= 2 else "parent"
    if b == 1: return f"{h}{great(a-3)}{'grand' if a >= 3 else ''}uncle/aunt" if a >= 2 else "sibling"
    if a == 1: return f"{h}sibling"
    c = min(a, b) - 1; r = abs(a - b)
    return f"{h}{ordinal(c)} cousin" + (f" {r}x removed" if r else "")


def side_of(p):
    sides = set()
    for k in p["ahnentafel"]:
        k = int(k); g = k.bit_length() - 1
        if g >= 1: sides.add("maternal" if (k >> (g - 1)) & 1 else "paternal")
    return "both" if len(sides) > 1 else (sides.pop() if sides else "paternal")


# ---- our ancestors as qids
def fs_of(pid, p): return p.get("fsId") or pid
allanc = {pid: p for pid, p in P.items() if p.get("ahnentafel")}
qual = {pid for pid, p in allanc.items() if p.get("tier") in ("verified", "tree", "conflict") and not p.get("lineFlag") and (p.get("birthYear") or 0) >= 1550}
anc_q = {}; qual_q = {}
for pid, p in allanc.items():
    for q in cache["fs"].get(fs_of(pid, p), []):
        anc_q[q] = pid
        if pid in qual: qual_q[q] = pid

# extra Wikidata matches for ancestors without an FS id on Wikidata (WikiTree id, name + birth year), same rules as notable_kin_wd.py
TITLES = r"(rev|maj|col|capt|cpt|dr|gen|sir|hon|lt|gov|sgt|judge|president|colonel|major|captain|general|reverend|esq|jr|sr|mr|mrs|ii|iii|iv|the|lord|lady|dame)\.?"
def variants(name):
    n = re.sub(r"\(.*?\)|\{.*?\}|\[.*?\]|\".*?\"", " ", name)
    n = re.sub(TITLES, " ", n, flags=re.I)
    n = re.sub(r"[^\w\s'\-\.]", " ", n).replace(".", " ")
    t = n.split()
    return {" ".join(t), t[0] + " " + t[-1]} if len(t) >= 2 else set()
for pid in qual:
    p = P[pid]; m = re.search(r"-(\d{4})", p.get("lifespan") or ""); dy_ours = int(m.group(1)) if m else None
    qs = set(cache["wt"].get(p.get("wikitreeId"), [])) if p.get("wikitreeId") else set()
    if not p.get("birthYearEst") and p.get("birthYear"):
        for v in variants(p["name"]):
            for q, by, dy in cache["nm"].get("%s|%s" % (v, p["birthYear"]), []):
                if dy_ours and dy and abs(dy - dy_ours) > 1: continue
                qs.add(q)
    for q in qs:
        anc_q.setdefault(q, pid); qual_q.setdefault(q, pid)

# ---- notable qids
targets = {}   # qid -> {name, fs, born}
need = [k["fsId"] for k in K if k.get("fsId") and k["fsId"] not in cache["fsn"] and k["fsId"] not in cache["fs"]]
for ch in chunks(need, 150):
    rows = sparql("SELECT ?fs ?i WHERE { VALUES ?fs {%s} ?i wdt:P2889 ?fs }" % " ".join('"%s"' % f for f in ch))
    for f in ch: cache["fsn"][f] = []
    for r in rows: cache["fsn"][r["fs"]["value"]].append(qid(r["i"]["value"]))
    save()
for k in K:
    qs = cache["fsn"].get(k.get("fsId")) or cache["fs"].get(k.get("fsId")) or []
    if qs: targets[qs[0]] = {"name": k["name"], "fs": k["fsId"], "born": k.get("born")}
for k in KW:
    targets.setdefault(k["qid"], {"name": k["name"], "fs": None, "born": k.get("born")})
if ONLY: targets = {q: v for q, v in targets.items() if q in ONLY}
print("targets", len(targets), "with qid from FS cousins", sum(1 for v in targets.values() if v["fs"]), flush=True)

# ---- parent map: inverse of cached kids + queried parents
pm = collections.defaultdict(set)
for p, ks in cache["kids"].items():
    for c in ks: pm[c].add(p)
for c, ps in cache["par"].items():
    for p in ps: pm[c].add(p)


def fill(nodes):
    todo = [n for n in nodes if n not in cache["par"]]
    for ch in chunks(todo, 120):
        if nq[0] >= MAXQ: return False
        v = " ".join("wd:" + i for i in ch)
        rows = sparql("SELECT ?c ?p WHERE { VALUES ?c {%s} { ?c wdt:P22 ?p } UNION { ?c wdt:P25 ?p } UNION { ?p wdt:P40 ?c } }" % v)
        for i in ch: cache["par"][i] = []
        for r in rows:
            c_, p_ = qid(r["c"]["value"]), qid(r["p"]["value"])
            if p_ not in cache["par"][c_]: cache["par"][c_].append(p_)
            pm[c_].add(p_)
        if nq[0] % 10 == 0: save()
    save()
    return True


# ---- level-by-level shared frontier fill (only nodes not yet expanded and not our ancestors)
level = {q for q, v in targets.items() if v['fs']}   # network fill only for FamilySearch cousins; Wikidata cousins use the cached down-walk
seen_all = set(level)
for d in range(MAXD):
    todo = {n for n in level if n not in anc_q}
    if not todo: break
    ok = fill(sorted(todo))
    nxt = set()
    for n in todo:
        for p in pm.get(n, ()):
            if p not in seen_all: seen_all.add(p); nxt.add(p)
    print(f"level {d}: expanded {len(todo)}, next {len(nxt)}, queries {nq[0]}", flush=True)
    level = nxt
    if not ok: print("query budget reached"); break
save()

# ---- BFS up per target; keep each distinct qualifying ancestor of ours
res = {}
for t, info in targets.items():
    if t in anc_q: continue
    found = []
    q = collections.deque([(t, [t])]); seen = {t}
    while q:
        x, path = q.popleft()
        if x in anc_q:
            if x in qual_q: found.append((x, path))
            continue
        if len(path) - 1 >= MAXD: continue
        for p in sorted(pm.get(x, ())):
            if p not in seen:
                seen.add(p); q.append((p, path + [p]))
    groups = collections.OrderedDict()
    for x, path in found: groups.setdefault(tuple(path[:-1]), []).append((x, path))
    cand = []
    for key, g in groups.items():
        g.sort(key=lambda xp: (gen(P[qual_q[xp[0]]]), min(int(k) for k in P[qual_q[xp[0]]]["ahnentafel"])))
        x, path = g[0]
        cand.append({"q": x, "path": path, "pid": qual_q[x], "partner": qual_q[g[1][0]] if len(g) > 1 else None})
    cas = {c["q"] for c in cand}
    cand = [c for c in cand if not any(n in cas for n in c["path"][1:-1])]
    routes = []
    for c in cand:
        X = P[c["pid"]]; a = gen(X); b = len(c["path"]) - 1
        sd = side_of(X)
        if c["partner"] and side_of(P[c["partner"]]) != sd: sd = "both"
        routes.append({"pid": c["pid"], "partner": c["partner"], "a": a, "b": b, "side": sd, "half": False,
                       "rel": relationship(a, b), "chain": list(reversed(c["path"][:-1]))})
    routes.sort(key=lambda r: (r["a"] + r["b"], r["a"]))
    if routes: res[t] = {"name": info["name"], "fs": info["fs"], "routes": routes[:8]}

# ---- labels for chain nodes
need = sorted({n for r in res.values() for rt in r["routes"] for n in rt["chain"]} - set(cache["lbl"]) - set(cache["det"]))
for ch in chunks(need, 200):
    if nq[0] >= MAXQ + 40: break
    v = " ".join("wd:" + i for i in ch)
    rows = sparql("""SELECT ?i (SAMPLE(?l) AS ?label) (MIN(?b) AS ?birth) (MIN(?d) AS ?death) WHERE { VALUES ?i {%s}
      OPTIONAL { ?i rdfs:label ?l FILTER(lang(?l)="en") } OPTIONAL { ?i wdt:P569 ?bd BIND(YEAR(?bd) AS ?b) } OPTIONAL { ?i wdt:P570 ?dd BIND(YEAR(?dd) AS ?d) } } GROUP BY ?i""" % v)
    for i in ch: cache["lbl"][i] = [None, None, None]
    for r in rows:
        g = lambda k: r[k]["value"] if k in r else None
        cache["lbl"][qid(r["i"]["value"])] = [g("label"), int(float(g("birth"))) if g("birth") else None, int(float(g("death"))) if g("death") else None]
    save()


def lab(n):
    d = cache["det"].get(n)
    if d and d.get("name"): return [d["name"], d.get("born"), d.get("died")]
    return cache["lbl"].get(n) or [n, None, None]


for r in res.values():
    for rt in r["routes"]:
        rt["chain"] = [{"qid": n, "name": lab(n)[0] or n, "born": lab(n)[1], "died": lab(n)[2]} for n in rt["chain"]]
(ROOT / "data/notable-kin-routes.json").write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")
cnt = collections.Counter(len(r["routes"]) for r in res.values())
print("notables with routes:", len(res), "route-count histogram:", sorted(cnt.items()), "queries", nq[0])
