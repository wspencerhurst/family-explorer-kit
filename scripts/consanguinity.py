"""Pedigree collapse and consanguinity (cousin marriages) in the subject's tree.

For every couple who are parents of a pedigree ancestor, compute the kinship coefficient phi(father, mother)
(= the inbreeding coefficient F of their child) with the recursive method, expanding the younger person
(smaller minimum generation from the subject) first so an ancestor is never expanded before its descendant.
Depth is limited (each side ~12 generations beyond the couple) and computed twice: using all links, and
excluding links research disproved (REJECTED/FABRICATED). Also finds each related couple's closest common
ancestor(s) and labels the relationship (1st cousins, 2nd cousins once removed, ...).
Output: data/consanguinity.json
"""
import json, pathlib, sys, collections
sys.setrecursionlimit(20000)

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
ped = {pid: p for pid, p in P.items() if p.get("ahnentafel") and not p.get("mergedInto")}
gen = {pid: min(int(a) for a in p["ahnentafel"]).bit_length() - 1 for pid, p in ped.items()}
root = next(pid for pid, p in ped.items() if "1" in p["ahnentafel"])

def parents(pid, clean):
    p = P.get(pid) or {}
    out = []
    for rel in ("father", "mother"):
        q = p.get(rel)
        if not q or q not in P: out.append(None); continue
        v = ((p.get("linkFlags") or {}).get(rel) or {}).get("verdict")
        if clean and v in ("REJECTED", "FABRICATED"): out.append(None); continue
        out.append(q)
    return out

def order(pid):  # larger = older (expand the smaller first)
    return gen.get(pid, 999)

def make_phi(clean, maxdepth=26):
    memo = {}
    def F(x, d):
        f, m = parents(x, clean)
        return phi(f, m, d - 1) if f and m else 0.0
    def phi(a, b, d):
        if a is None or b is None or d <= 0: return 0.0
        if a == b: return 0.5 * (1 + F(a, d))
        key = (a, b) if a < b else (b, a)
        if key in memo: return memo[key]
        y, o = (a, b) if order(a) <= order(b) else (b, a)
        f, m = parents(y, clean)
        v = 0.5 * (phi(f, o, d - 1) + phi(m, o, d - 1))
        memo[key] = v
        return v
    return phi, F

def ancestors_with_depth(pid, clean, maxd=12):
    """closest distance (in generations) from pid up to each ancestor"""
    dist = {pid: 0}
    frontier = [pid]
    for d in range(1, maxd + 1):
        nxt = []
        for x in frontier:
            for q in parents(x, clean):
                if q and q not in dist: dist[q] = d; nxt.append(q)
        frontier = nxt
    return dist

def ordinal(n): return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")
def rel_label(n1, n2):
    a, b = min(n1, n2), max(n1, n2)
    if a == 0: return "parent and child" if b == 1 else ("grandparent and grandchild" if b == 2 else f"ancestor and descendant ({b} generations)")
    if a == 1: return "siblings" if b == 1 else ("uncle/aunt and niece/nephew" if b == 2 else f"great{'-' * 0}{'grand-' * (b - 3)}uncle/aunt and niece/nephew".replace("great", "great-" if b >= 3 else ""))
    deg, rem = a - 1, b - a
    return f"{ordinal(deg)} cousins" + ("" if rem == 0 else f" {'once' if rem == 1 else 'twice' if rem == 2 else f'{rem}x'} removed")

phi_all, F_all = make_phi(False)
phi_clean, F_clean = make_phi(True)

couples = []
seen = set()
items = sorted(ped, key=lambda x: gen[x])
for n, pid in enumerate(items):
    p = P[pid]
    f, m = p.get("father"), p.get("mother")
    if not (f in P and m in P) or (f, m) in seen: continue
    seen.add((f, m))
    if gen[pid] > 40: continue
    Fa = phi_all(f, m, 26)
    if Fa <= 0: continue
    Fc = phi_clean(f, m, 26)
    da, dm = ancestors_with_depth(f, False), ancestors_with_depth(m, False)
    common = [(da[x] + dm[x], da[x], dm[x], x) for x in set(da) & set(dm)]
    if not common:
        continue
    common.sort()
    best = common[0][0]
    # keep only "closest" common ancestors (not ancestors of another common ancestor at the same depth sum)
    closest = [c for c in common if c[0] == best][:4]
    n1, n2 = closest[0][1], closest[0][2]
    couples.append({"child": pid, "f": f, "m": m, "F": Fa, "Fclean": Fc, "n1": n1, "n2": n2, "label": rel_label(n1, n2),
                    "ca": [c[3] for c in closest], "gen": gen[pid], "nCommon": len(common),
                    "suspect": n1 <= 1 or n2 <= 1})
    if n % 5000 == 0: print(f"{n}/{len(items)} related couples {len(couples)}", flush=True)

rootF = F_all(root, 28)
rootFc = F_clean(root, 28)
# collapse curve: distinct known ancestors vs possible, by generation
by_gen = collections.Counter(gen[x] for x in ped)
couples.sort(key=lambda c: (c["gen"], -c["F"]))
out = {"root": root, "rootF": rootF, "rootFclean": rootFc, "couples": couples,
       "byGeneration": {g: by_gen[g] for g in sorted(by_gen)},
       "note": "Kinship computed recursively, limited to about 26 generations; medieval tree data contain many duplicated and erroneous links, so deep values are indicative only."}
(ROOT / "data/consanguinity.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print("root F:", rootF, "clean:", rootFc, "related couples:", len(couples), "suspect (sibling/parent-level):", sum(c["suspect"] for c in couples))
print("closest examples:", [(P[c['child']]['name'], c['label'], round(c['F'], 5)) for c in couples[:8]])
