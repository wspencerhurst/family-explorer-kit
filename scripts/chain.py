"""Print the descent chain from the subject to Ahnentafel number(s): python scripts/chain.py 2093 9509"""
import json, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
by = {}
for p in P.values():
    for n in p.get("ahnentafel", []):
        by[int(n)] = p
for arg in sys.argv[1:]:
    n = int(arg); chain = []
    while n >= 1:
        chain.append(n); n //= 2
    print(f"--- #{arg}")
    for n in reversed(chain):
        p = by.get(n)
        print(f"  #{n:<8} {p['name'] if p else '?':40} {(p or {}).get('lifespan') or ''} {(p or {}).get('id','')} [{(p or {}).get('confidence','')}]")
