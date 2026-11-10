"""Write research/claims/branch-<n>.txt for verification agents: unverified ('tree'/'conflict' tier) ancestors in
generations GMIN..GMAX under Ahnentafel branch n, with how many ancestors sit above each (prioritise big links).
Usage: python scripts/branch_claims.py [--gmin 8 --gmax 16] 16 17 ..."""
import json, sys, pathlib, collections
ROOT = pathlib.Path(__file__).resolve().parent.parent
args = sys.argv[1:]; gmin, gmax = 6, 13
if "--gmin" in args: i = args.index("--gmin"); gmin = int(args[i+1]); del args[i:i+2]
if "--gmax" in args: i = args.index("--gmax"); gmax = int(args[i+1]); del args[i:i+2]
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
by = {}
for p in P.values():
    for n in p.get("ahnentafel", []): by.setdefault(int(n), p)
above = {}
def count_above(pid, seen):
    stack = [pid]; c = 0
    while stack:
        x = stack.pop()
        for r in ("father", "mother"):
            q = P.get(x, {}).get(r)
            if q and q in P and q not in seen:
                seen.add(q); c += 1; stack.append(q)
    return c
def fmt(e): return " ".join(x for x in ((e or {}).get("date"), (e or {}).get("place")) if x) if isinstance(e, dict) else ""
for b in map(int, args):
    lines = [f"Branch #{b} {by[b]['name']}: unverified ancestors, generations {gmin}-{gmax} (n = Ahnentafel; parents of n are 2n, 2n+1)",
             "n | name | FS id | birth | death | confidence | tier | ancestors above | quality issues"]
    for n in sorted(by):
        g, gb = n.bit_length(), b.bit_length()
        if gmin <= g <= gmax and g >= gb and (n >> (g - gb)) == b:
            p = by[n]
            if p.get("tier") not in ("tree", "conflict"): continue
            lines.append(f"{n} | {p.get('name')} | {p.get('fsId') or p['id']} | {fmt(p.get('birth'))} | {fmt(p.get('death'))} | {p.get('confidence')} | {p.get('tier')} | {count_above(p['id'], set())} | {'; '.join(p.get('quality', []))}")
    (ROOT / f"research/claims/branch-{b}.txt").write_text("\n".join(lines), encoding="utf-8")
    print(b, len(lines) - 2)
