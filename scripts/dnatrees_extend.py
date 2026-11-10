"""Extend dead-end ancestors using the public Ancestry trees of DNA matches (data/dna/dna-ancestry-match-trees.json).

A dead end = post-1500, non-flagged pedigree ancestor missing a parent. A tree person is accepted as the same person
only if first name + surname match, birth years are within 2, AND that tree person's child (in the same tree) matches
the first name + surname of our known child. Then the tree's ancestors above them are imported (UNVERIFIED), citing
the DNA match whose tree it is (a shared-DNA match makes the tree more likely to be on the right family, not proof).
Output: research/lines/dnatrees-ext.json
"""
import json, re, pathlib, unicodedata, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
TREES = json.loads((ROOT / "data/dna/dna-ancestry-match-trees.json").read_text(encoding="utf-8"))["trees"]
MATCH = {m["sampleId"]: m for m in json.loads((ROOT / "data/dna/dna-ancestry-matches.json").read_text(encoding="utf-8"))["matches"]}

STOP = {"sir", "lady", "dr", "rev", "col", "capt", "maj", "jr", "sr", "ii", "iii", "iv", "of", "the", "mrs", "mr"}
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return [w for w in re.sub(r"[^a-z ]", " ", re.sub(r"\(.*?\)|\".*?\"", " ", s)).split() if w not in STOP and len(w) > 1]
def nkey(name):
    t = norm(name); return (t[0], t[-1]) if len(t) >= 2 else None
def yr(s):
    m = re.search(r"(1[5-9]\d\d)", s or ""); return int(m.group(1)) if m else None

children = collections.defaultdict(list)
for pid, p in P.items():
    for r in ("father", "mother"):
        if p.get(r): children[p[r]].append(pid)
targets = {}
for pid, p in P.items():
    if not p.get("ahnentafel") or p.get("tier") not in ("verified", "tree", "conflict"): continue
    if p.get("father") and p.get("mother"): continue
    if not p.get("birthYear") or p["birthYear"] < 1500: continue
    kids = [P[c] for c in children.get(pid, []) if P[c].get("ahnentafel")]
    k = nkey(p.get("name"))
    if k and kids:
        targets.setdefault(k, []).append((pid, p, [nkey(c.get("name")) for c in kids]))

persons, hits = {}, []
for sid, t in TREES.items():
    rows = t.get("people") or []
    if not rows: continue
    by_id = {r[0]: r for r in rows}
    kids_of = collections.defaultdict(list)
    for r in rows:
        for par in (r[4], r[5]):
            if par: kids_of[par].append(r)
    m = MATCH.get(sid, {})
    for r in rows:
        k = nkey(r[1])
        if k not in targets: continue
        ry = yr((r[2] or ["", ""])[0])
        for pid, p, kidkeys in targets[k]:
            if ry is None or abs(ry - p["birthYear"]) > 2: continue
            if not any(nkey(c[1]) in kidkeys for c in kids_of.get(r[0], [])): continue
            if not (r[4] in by_id or r[5] in by_id): continue
            # import this person's ancestors from the tree
            src = f"S-dnatree-{t['treeId']}"
            def tkey(i): return f"dnatree-{t['treeId']}-{i}"
            link = {"key": pid[2:] if pid.startswith("R:") else "fs-" + pid, "name": p.get("name"), "confidence": "UNVERIFIED", "sources": [src],
                    "notes": f"Parents from the Ancestry tree of DNA match {m.get('name')} ({m.get('cM')} cM), tree {t['treeId']}."}
            if not pid.startswith("R:"): link["fsId"] = pid
            if r[4] in by_id and not p.get("father"): link["father"] = tkey(r[4])
            if r[5] in by_id and not p.get("mother"): link["mother"] = tkey(r[5])
            if "father" not in link and "mother" not in link: continue
            if link["key"] in persons:   # already extended from another tree: keep the first
                continue
            persons[link["key"]] = link
            hits.append({"ourId": pid, "name": p.get("name"), "match": m.get("name"), "cM": m.get("cM"), "treeId": t["treeId"]})
            stack = [x for x in (link.get("father"), link.get("mother")) if x]
            while stack:
                k2 = stack.pop()
                if k2 in persons: continue
                rid = k2.rsplit("-", 1)[1]; rr = by_id.get(rid)
                if not rr: continue
                e = {"key": k2, "name": rr[1], "confidence": "UNVERIFIED", "sources": [src],
                     "birth": {"date": rr[2][0], "place": rr[2][1]} if rr[2] else None,
                     "death": {"date": rr[3][0], "place": rr[3][1]} if rr[3] else None,
                     "notes": f"From the Ancestry tree of DNA match {m.get('name')} ({m.get('cM')} cM)."}
                if rr[4] in by_id: e["father"] = tkey(rr[4]); stack.append(e["father"])
                if rr[5] in by_id: e["mother"] = tkey(rr[5]); stack.append(e["mother"])
                persons[k2] = e
sources = [{"id": f"S-dnatree-{t['treeId']}", "title": f"Ancestry public tree {t['treeId']} of DNA match {MATCH.get(sid, {}).get('name')} ({MATCH.get(sid, {}).get('cM')} cM)",
            "url": f"https://www.ancestry.com/family-tree/tree/{t['treeId']}", "type": "user tree (DNA match)"}
           for sid, t in TREES.items() if t.get("treeId") and any(h["treeId"] == t["treeId"] for h in hits)]
doc = {"task": "dnatrees-ext", "updated": "2026-11-07", "persons": list(persons.values()), "sources": sources, "matched": hits}
(ROOT / "research/lines/dnatrees-ext.json").write_text(json.dumps(doc, ensure_ascii=False, indent=0), encoding="utf-8")
print(f"dead ends extended: {len(hits)}; persons written: {len(persons)}")
for h in hits[:25]: print(" ", h["name"], "<-", h["match"], h["cM"], "cM")
