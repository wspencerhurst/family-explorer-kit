"""Process the raw FamilySearch ancestry crawl into an Ahnentafel-indexed table.

Input:  data/raw/fs-tree-dump.json  ({persons: {id: {...,f,m}}})
Output: data/fs-tree.json  (persons with ahnentafel numbers, generation, route count)
        data/fs-tree-summary.txt
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, sys, collections, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
_f = ROOT / "data/raw/fs-tree-dump.json"
if not _f.exists():
    _c = sorted((ROOT / "data/raw").glob("fs-tree-dump*.json"), key=lambda p: p.stat().st_mtime)
    if not _c: raise SystemExit("No data/raw/fs-tree-dump*.json yet (run the FS crawl first).")
    _f = _c[-1]
raw = json.loads(_f.read_text(encoding="utf-8"))
P = raw["persons"]

# Known anchors of the subject's pedigree (living generations are not in the FS crawl).
ANCHORS = {int(k): v for k, v in (CFG.get("fsAnchors") or {}).items()}  # Ahnentafel number -> FS id (family.config.json)
if not ANCHORS: raise SystemExit("Set fsAnchors in family.config.json first (see PLAYBOOK.md step 2).")
MAX_NUMS = 8  # keep at most this many Ahnentafel numbers per person

ahn = collections.defaultdict(list)   # id -> list of ints (smallest first)
routes = collections.Counter()        # id -> number of distinct routes
gens = collections.defaultdict(set)

# BFS by Ahnentafel number. Count routes without enumerating all (could explode).
frontier = collections.Counter()
for n, pid in ANCHORS.items():
    frontier[(pid, n)] += 1
queue = collections.deque(ANCHORS.items())
seen_num = set()
while queue:
    n, pid = queue.popleft()
    if (pid, n) in seen_num:
        continue
    seen_num.add((pid, n))
    routes[pid] += 1
    g = n.bit_length()
    gens[pid].add(g)
    if len(ahn[pid]) < MAX_NUMS:
        ahn[pid].append(n)
    p = P.get(pid)
    if not p:
        continue
    # Once a person has been reached by many routes, stop expanding further routes
    # (ancestors are already reached; this only limits route counting).
    if routes[pid] > MAX_NUMS:
        continue
    if p.get("f"):
        queue.append((2 * n, p["f"]))
    if p.get("m"):
        queue.append((2 * n + 1, p["m"]))

out = []
for pid, p in P.items():
    if pid not in ahn:
        continue
    q = dict(p)
    q["ahnentafel"] = [str(x) for x in sorted(ahn[pid])]
    q["generation"] = min(gens[pid])
    q["routes"] = routes[pid]
    out.append(q)
out.sort(key=lambda q: int(q["ahnentafel"][0]))
(ROOT / "data/fs-tree.json").write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")

by_gen = collections.Counter(q["generation"] for q in out)
collapse = [q for q in out if q["routes"] > 1]
lines = [f"persons in pedigree: {len(out)} (raw crawl {len(P)})",
         f"max generation: {max(by_gen)}", "per generation (count / possible):"]
for g in sorted(by_gen):
    lines.append(f"  gen {g:3d}: {by_gen[g]:6d} / {2**(g-1)}")
lines.append(f"persons reached by >1 route (pedigree collapse): {len(collapse)}")
for q in collapse[:60]:
    lines.append(f"  {q['name']} ({q.get('life')}) {q['id']}: #{', #'.join(q['ahnentafel'][:5])}")
(ROOT / "data/fs-tree-summary.txt").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines[:80]))
