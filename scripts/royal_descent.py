"""Classify pre-1550 notable ancestors as reached through an accepted gateway immigrant (royal/noble descent accepted
by Roberts, Royal Descents of 900 Immigrants / Richardson, Plantagenet & Magna Carta Ancestry) or not.

Gateways (immigrants whose royal/noble ancestry those references accept) come from family.config.json "royalGateways":
  {"Label": {"ahnentafel": [n, ...], "names": ["regex", ...]}}. A notable counts as 'via accepted gateway' if there is a path from the gateway up to the notable
that crosses no flagged link (people.json linkFlags). Everything else stays a tree claim.
Output: data/royal-descents.json, research/royal-descents.md
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG
import json, pathlib, re, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
_nf = ROOT / "data/notable-ancestors-pre1550.json"   # {tier: [{"id", "name", "desc", "born", "fame"}]} (see PLAYBOOK step 12)
NOT = json.loads(_nf.read_text(encoding="utf-8")) if _nf.exists() else {}
by_ahn = {}
for pid, p in P.items():
    for n in p.get("ahnentafel", []): by_ahn.setdefault(int(n), pid)

def find(pattern, max_gen=20):
    out = []
    for pid, p in P.items():
        if p.get("ahnentafel") and not p.get("lineFlag") and re.search(pattern, p.get("name") or "", re.I):
            if min(int(n) for n in p["ahnentafel"]).bit_length() <= max_gen: out.append(pid)
    return out
gateways = {label: [by_ahn.get(int(n)) for n in g.get("ahnentafel", [])] + [x for rx in g.get("names", []) for x in find(rx)]
            for label, g in (CFG.get("royalGateways") or {}).items()}
gateways = {k: [x for x in dict.fromkeys(v) if x] for k, v in gateways.items()}

def ancestors_clean(start):
    """ancestor id -> (parent-path list) without crossing flagged links."""
    seen = {start: [start]}; q = collections.deque([start])
    while q:
        x = q.popleft(); p = P.get(x, {})
        for r in ("father", "mother"):
            par = p.get(r)
            if not par or par not in P or par in seen: continue
            if (p.get("linkFlags") or {}).get(r): continue
            seen[par] = seen[x] + [par]; q.append(par)
    return seen

reach = {}   # notable id -> (gateway, path)
for gname, ids in gateways.items():
    for g in ids:
        for aid, path in ancestors_clean(g).items():
            if aid not in reach or len(path) < len(reach[aid][1]):
                reach[aid] = (gname, path)

out = {"gateways": {k: [{"id": i, "name": P[i].get("name"), "ahnentafel": min(int(n) for n in P[i]["ahnentafel"])} for i in v] for k, v in gateways.items()},
       "viaGateway": [], "treeOnly": []}
for tier, lst in NOT.items():
    if tier in ("alternate", "unattached"): continue
    for n in lst:
        pid = n["id"]
        no_issue = re.search(r"William Wallace|Wu Zetian|Joan of Arc|Elizabeth I of England|Richard I of England|Edward the Confessor", n.get("name") or "")
        if pid in reach and (n.get("born") or 0) >= 600 and not no_issue:
            g, path = reach[pid]
            out["viaGateway"].append({**n, "gateway": g, "generationsAboveGateway": len(path) - 1,
                                      "chainFromGateway": [P[x].get("name") for x in path]})
        else:
            out["treeOnly"].append({**n, "tier": "legendary/implausible" if pid in reach else tier})
out["viaGateway"].sort(key=lambda x: -(x.get("fame") or 0)); out["treeOnly"].sort(key=lambda x: -(x.get("fame") or 0))
(ROOT / "data/royal-descents.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
md = ["# Royal and noble descents", "",
      f"{len(out['viaGateway'])} notable pre-1550 ancestors are reached through an accepted gateway immigrant with no flagged link on the way;",
      f"{len(out['treeOnly'])} more are FamilySearch-tree claims only (unchecked or through doubtful links).", "",
      "Gateways found in the pedigree: " + "; ".join(f"{k} ({len(v)})" for k, v in gateways.items()), "",
      "## Via accepted gateways (most famous first)", "| Ancestor | Born | Who | Gateway | Generations above gateway |", "|---|---|---|---|---|"]
md += [f"| {x['name']} | {x['born']} | {(x.get('desc') or '')[:70]} | {x['gateway']} | {x['generationsAboveGateway']} |" for x in out["viaGateway"][:150]]
md += ["", "## Tree-only claims (top 60 by fame; treat as unverified)", "| Ancestor | Born | Tier |", "|---|---|---|"]
md += [f"| {x['name']} | {x['born']} | {x['tier']} |" for x in out["treeOnly"][:60]]
(ROOT / "research/royal-descents.md").write_text("\n".join(md), encoding="utf-8")
print("gateways:", {k: len(v) for k, v in gateways.items()})
print("via gateway:", len(out["viaGateway"]), "tree-only:", len(out["treeOnly"]))
for x in out["viaGateway"][:30]: print(f"  {x['name']} ({x['born']}) via {x['gateway']}, {x['generationsAboveGateway']} gens up")
