"""Compute relationships between the subject and notable people (Wikidata humans with FamilySearch IDs).

Input:  data/raw/notable-kin-walk.json  {notables:[{fs,name,desc,born,links}], V:{id:[father,mother,name,lifespan]}, hits:{id:true}}
        data/people.json
Output: data/notable-kin.json, research/notable-kin.md
Only common ancestors in the main pedigree, not on flagged lines, born >= 1550, count (earlier ones are meaningless:
everyone of European descent shares medieval ancestors).
"""
import json, pathlib, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
W = json.loads((ROOT / "data/raw/notable-kin-walk.json").read_text(encoding="utf-8"))
V = W["V"]
fs2pid = {p.get("fsId") or pid: pid for pid, p in P.items()}

def ours(fs):
    pid = fs2pid.get(fs)
    p = P.get(pid) if pid else None
    if not p or not p.get("ahnentafel") or p.get("lineFlag"): return None
    if (p.get("birthYear") or 0) < 1550 or p.get("tier") not in ("verified", "tree", "conflict"): return None
    return pid

def ordinal(n): return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")
def great(k): return "" if k <= 0 else ("great-" if k == 1 else f"{k}x-great-")
def relationship(a, b, half):
    """a = generations from subject up to the common ancestor, b = from notable up to it."""
    h = "half " if half else ""
    if b == 0: return f"{great(a-2)}grandparent" if a >= 2 else "parent"
    if b == 1: return f"{h}{great(a-3)}{'grand' if a >= 3 else ''}uncle/aunt" if a >= 2 else "sibling"
    if a == 1: return f"{h}sibling"
    c = min(a, b) - 1; r = abs(a - b)
    return f"{h}{ordinal(c)} cousin" + (f" {r}x removed" if r else "")

def side_of(p):
    """'paternal' / 'maternal' / 'both': second-most-significant bit of the ahnentafel number (0 = father's side)."""
    sides = set()
    for k in p["ahnentafel"]:
        k = int(k); g = k.bit_length() - 1
        if g >= 1: sides.add("maternal" if (k >> (g - 1)) & 1 else "paternal")
    return "both" if len(sides) > 1 else (sides.pop() if sides else "paternal")

MAX_ROUTES = 8
results = []
for n in W["notables"]:
    start = n["fs"]
    # BFS upward from the notable through walked persons; each branch stops at the first ancestor of ours (all distinct connections kept)
    found = []
    q = collections.deque([(start, 0, [start])]); seen = {start}
    while q:
        x, d, path = q.popleft()
        pid = ours(x)
        if pid:
            a = min(int(k) for k in P[pid]["ahnentafel"]).bit_length() - 1
            found.append({"a": a, "b": d, "pid": pid, "path": path})
            continue
        rec = V.get(x)
        if not rec or d >= 12: continue
        for par in rec[:2]:
            if par and par not in seen:
                seen.add(par); q.append((par, d + 1, path + [par]))
    if not found: continue
    # a couple reached through the same child is one "full" route (primary = the closer / lower-numbered of the two)
    groups = collections.OrderedDict()
    for f_ in found: groups.setdefault(tuple(f_["path"][:-1]), []).append(f_)
    cand = []
    for key, g in groups.items():
        g.sort(key=lambda f_: (f_["a"], min(int(k) for k in P[f_["pid"]]["ahnentafel"])))
        f_ = dict(g[0]); f_["partner"] = g[1]["pid"] if len(g) > 1 else None
        path = f_["path"]; half = True
        if len(path) >= 2:
            child = V.get(path[-2]) or [None, None]
            other = child[1] if child[0] == path[-1] else child[0]
            if f_["partner"] or (other and ours(other)): half = False
        else:
            half = False
        f_["half"] = half
        cand.append(f_)
    ca_set = {f_["path"][-1] for f_ in cand}
    # drop a route whose notable-side path runs through another common ancestor (derived from that one)
    cand = [f_ for f_ in cand if not any(x in ca_set for x in f_["path"][1:-1])]
    cand.sort(key=lambda f_: (f_["a"] + f_["b"], f_["a"]))
    routes = []
    for best in cand[:MAX_ROUTES]:
        path = best["path"]
        X = P[best["pid"]]
        sd = side_of(X)
        if best["partner"]: sd = "both" if side_of(P[best["partner"]]) != sd else sd
        routes.append({"relationship": relationship(best["a"], best["b"], best["half"]),
                    "commonAncestor": {"id": best["pid"], "name": X.get("name"), "lifespan": X.get("lifespan"),
                                       "ahnentafel": min(int(k) for k in X["ahnentafel"]), "confidence": X.get("confidence"), "tier": X.get("tier")},
                    "partner": best["partner"], "side": sd,
                    "stepsSubject": best["a"], "stepsNotable": best["b"], "path": path,
                    "notableLine": [(V.get(x) or [None, None, x])[2] for x in path],
                    "linkConfidence": "PROBABLE" if X.get("confidence") in ("CONFIRMED", "PROBABLE") else "UNVERIFIED (FamilySearch tree on both sides)"})
    results.append({"name": n.get("name"), "desc": n.get("desc"), "born": n.get("born"), "fame": n.get("links"), "fsId": start,
                    **{k: routes[0][k] for k in ("relationship", "commonAncestor", "stepsSubject", "stepsNotable", "notableLine", "linkConfidence", "side")},
                    "routes": routes})
results.sort(key=lambda r: (r["stepsSubject"] + r["stepsNotable"], -(r["fame"] or 0)))
(ROOT / "data/notable-kin.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
md = ["# Notable relatives (computed from FamilySearch tree links)", "",
      f"{len(results)} notable people connect to the subject through a common ancestor born after 1550 on a non-flagged line.",
      "Each relationship rests on FamilySearch tree links on the notable's side, and on our research or the FS tree on the subject's side.", "",
      "| Notable | Born | Who | Relationship | Common ancestor (#) | Confidence |", "|---|---|---|---|---|---|"]
for r in sorted(results, key=lambda r: -(r["fame"] or 0))[:400]:
    ca = r["commonAncestor"]
    md.append(f"| {r['name']} | {r['born']} | {(r['desc'] or '')[:60]} | {r['relationship']} | {ca['name']} ({ca['lifespan'] or ''}, #{ca['ahnentafel']}) | {r['linkConfidence']} |")
(ROOT / "research/notable-kin.md").write_text("\n".join(md), encoding="utf-8")
print(len(results), "notable relatives")
for r in sorted(results, key=lambda r: -(r["fame"] or 0))[:40]:
    print(f"  {r['name']} ({r['born']}): {r['relationship']} via {r['commonAncestor']['name']} #{r['commonAncestor']['ahnentafel']}")
