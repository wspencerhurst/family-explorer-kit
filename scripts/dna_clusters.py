"""Cluster 23andMe DNA relatives with their shared-match ("relatives in common") lists, then label each cluster.

Graph: nodes = relatives sharing 20-400 cM (4th cousins up to ~1st cousin once removed); an edge between two relatives
when either lists the other as a shared match. Louvain communities ~ ancestral lines.
Labels per cluster: 23andMe parental side, surname enrichment (vs. all relatives), grandparent birth locations,
known common ancestors (Ancestry matches linked by name+cM in xlink.json, whose tree common ancestor is in match2-by-ancestor.json),
and brick-wall ancestors (summary.json) whose surname, or whose spouse's surname, is enriched in the cluster.
Output: data/dna/clusters.json, research/dna-clusters.md
"""
import json, pathlib, collections, re
import networkx as nx

R = pathlib.Path(__file__).resolve().parent.parent
rel = {r["relative_profile_id"]: r for r in json.load(open(R / "data/dna/dna-23andme-relatives.json", encoding="utf-8"))["relatives"]}
ric = json.load(open(R / "data/dna/dna-23andme-ric.json", encoding="utf-8"))["map"]
xl = json.load(open(R / "data/dna/xlink.json", encoding="utf-8"))
m2 = json.load(open(R / "data/dna/match2-by-ancestor.json", encoding="utf-8"))
S = json.load(open(R / "data/summary.json", encoding="utf-8"))
P = json.loads((R / "data/people.json").read_text(encoding="utf-8"))

cm = lambda r: r["ibd_proportion"] * 6960
side = lambda r: "paternal" if r["is_paternal_side"] and not r["is_maternal_side"] else "maternal" if r["is_maternal_side"] and not r["is_paternal_side"] else "?"
nodes = {k for k, r in rel.items() if 20 <= cm(r) <= 400}
G = nx.Graph()
G.add_nodes_from(nodes)
for a, lst in ric.items():
    if a not in nodes: continue
    for e in lst:
        b = e.get("profile_id") if isinstance(e, dict) else e[0]
        if b in nodes and b != a: G.add_edge(a, b)
G.remove_nodes_from([n for n in list(G) if G.degree(n) == 0])
comms = sorted(nx.community.louvain_communities(G, seed=7, resolution=1.0), key=len, reverse=True)

# known ancestors for Ancestry matches (by name)
anc_of = collections.defaultdict(list)
for pid, v in m2.items():
    for name, c, _ in v["matches"]:
        anc_of[name.lower()].append(f"{v['name']} (#{min(v['ahn'])})")
x_by_profile = {x["profile"]: x for x in xl}

def norm(s): return re.sub(r"[^a-z]", "", (s or "").lower())
base = collections.Counter(norm(s) for r in rel.values() for s in set(r.get("surnames") or []))
N = len(rel)

walls = S["brickWalls"]
def surname(n):
    t = re.sub(r"\(.*?\)|\".*?\"|'.*?'", " ", n or "").split()
    t = [w for w in t if w.lower() not in ("jr", "sr", "jr.", "sr.", "ii", "iii")]
    return norm(t[-1]) if t else ""
A = {}
for pid, p in P.items():
    for n in p.get("ahnentafel") or []: A.setdefault(int(n), pid)

out = []
for i, c in enumerate(comms):
    if len(c) < 4: continue
    rs = [rel[k] for k in c]
    sides = collections.Counter(side(r) for r in rs)
    sc = collections.Counter(norm(s) for r in rs for s in set(r.get("surnames") or []))
    enr = sorted(((s, n, n / len(rs) / max(base[s] / N, 1e-9)) for s, n in sc.items() if n >= 3 and s), key=lambda x: -x[2])[:12]
    locs = collections.Counter()
    for r in rs:
        gl = r.get("grandparent_birth_locations") or {}
        for g in (gl.values() if isinstance(gl, dict) else gl):
            if isinstance(g, dict):
                s = ", ".join(x for x in (g.get("county") or g.get("city"), g.get("state") or g.get("country")) if x)
                if s: locs[s] += 1
    known = collections.Counter()
    for r in rs:
        x = x_by_profile.get(r["relative_profile_id"])
        if x:
            for a in anc_of.get(x["name"].lower(), []): known[a] += 1
    enr_set = {s for s, n, f in enr if f >= 3}
    wall_hits = []
    for w in walls:
        sn = surname(w["name"]); sp = P.get(A.get(w["ahnentafel"] ^ 1), {}).get("name")
        hit = [s for s in (sn, surname(sp)) if s and s in enr_set]
        if hit: wall_hits.append(f"#{w['ahnentafel']} {w['name']} (missing {','.join(w['missing'])}; surname match: {','.join(hit)})")
    top = sorted(rs, key=lambda r: -cm(r))[:5]
    out.append({"cluster": i + 1, "size": len(rs), "sides": dict(sides), "totalcM": round(sum(cm(r) for r in rs)),
                "topMatches": [f"{r.get('first_name','')} {r.get('last_name','')} {cm(r):.0f} cM" for r in top],
                "enrichedSurnames": [f"{s} ({n}, x{f:.1f})" for s, n, f in enr],
                "grandparentPlaces": [f"{l} ({n})" for l, n in locs.most_common(6)],
                "knownCommonAncestors": [f"{a} ({n})" for a, n in known.most_common(5)],
                "brickWallLeads": wall_hits, "members": sorted(c)})
json.dump(out, open(R / "data/dna/clusters.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
md = ["# DNA clusters (23andMe shared matches)", "",
      f"{G.number_of_nodes()} relatives (20-400 cM) with shared-match links, {G.number_of_edges()} links, {len(out)} clusters of 4+.",
      "Each cluster is a group of relatives who mostly share DNA with each other, so they likely descend from one ancestral couple or line.", ""]
for c in out:
    md += [f"## Cluster {c['cluster']}: {c['size']} relatives, {c['totalcM']} cM total, sides {c['sides']}",
           f"- Closest: {'; '.join(c['topMatches'])}",
           f"- Enriched surnames: {', '.join(c['enrichedSurnames']) or '-'}",
           f"- Grandparent birthplaces: {', '.join(c['grandparentPlaces']) or '-'}",
           f"- Known common ancestors (via Ancestry trees): {', '.join(c['knownCommonAncestors']) or 'none - unidentified line'}",
           f"- Brick-wall leads: {'; '.join(c['brickWallLeads']) or '-'}", ""]
(R / "research/dna-clusters.md").write_text("\n".join(md), encoding="utf-8")
print(md[2])
for c in out[:25]:
    print(c["cluster"], c["size"], c["sides"], "|", ", ".join(c["enrichedSurnames"][:6]), "|", ", ".join(c["knownCommonAncestors"][:3]), "|", len(c["brickWallLeads"]))
