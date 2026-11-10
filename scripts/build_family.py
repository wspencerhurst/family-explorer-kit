"""Attach FamilySearch family groups (spouses, children) and record-source citations to pedigree people.

Input:  data/raw/fs-relatives-sources.json  {rel: {fsId: {spouses, children}}, extra: {fsId: basic facts}, src: {fsId: [citations]}}
Output: data/family.json   {personId: {"spouses": [ref], "children": [ref]}}  where ref = personId if the relative is
                           in people.json, else "FS:<id>" resolvable in "relatives"
                           plus {"relatives": {"FS:<id>": {name, sex, life, birth, birthPlace, death, deathPlace}}}
        data/fs-sources.json {personId: [{title, url, citation}]}
"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
D = json.loads((ROOT / "data/raw/fs-relatives-sources.json").read_text(encoding="utf-8"))
fs2pid = {p["fsId"]: pid for pid, p in P.items() if p.get("fsId")}
for pid in P:
    if not pid.startswith("R:") and pid not in fs2pid: fs2pid[pid] = pid

def ref(fsid):
    return fs2pid.get(fsid) or f"FS:{fsid}"

fam, relatives = {}, {}
for fsid, r in D["rel"].items():
    pid = fs2pid.get(fsid)
    if not pid: continue
    e = {"spouses": [ref(x) for x in r.get("spouses") or []], "children": [ref(x) for x in r.get("children") or []]}
    if e["spouses"] or e["children"]: fam[pid] = e
    for x in (r.get("spouses") or []) + (r.get("children") or []):
        if x not in fs2pid and x in D["extra"]:
            x_ = D["extra"][x]
            relatives[f"FS:{x}"] = {"name": x_.get("name"), "sex": x_.get("sex"), "life": x_.get("life"), "birth": x_.get("b"),
                                   "birthPlace": x_.get("bp"), "death": x_.get("dd"), "deathPlace": x_.get("dp")}
src = {fs2pid[f]: v for f, v in D["src"].items() if f in fs2pid and v}
(ROOT / "data/family.json").write_text(json.dumps({"families": fam, "relatives": relatives}, ensure_ascii=False), encoding="utf-8")
(ROOT / "data/fs-sources.json").write_text(json.dumps(src, ensure_ascii=False), encoding="utf-8")
print(f"family groups {len(fam)}; children {sum(len(e['children']) for e in fam.values())}; spouses {sum(len(e['spouses']) for e in fam.values())}; "
      f"non-pedigree relatives described {len(relatives)}; people with record sources {len(src)} ({sum(len(v) for v in src.values())} citations)")
