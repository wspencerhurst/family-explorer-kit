"""Convert data/dna/ancestry-trees.json (Ancestry treesui-list person dumps) into research line files
research/lines/ancestry-tree-<label>.json, so merge.py can match them against the FS tree (all UNVERIFIED)."""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
d = json.loads((ROOT / "data/dna/ancestry-trees.json").read_text(encoding="utf-8"))
LABEL = CFG.get("ancestryTrees") or {}   # {"<Ancestry tree id>": "father" | "mother" | "user"} in family.config.json

def name(p):
    n = (p.get("Names") or [{}])[0]
    return " ".join(x for x in (n.get("g"), n.get("s"), n.get("sf")) if x).strip() or "Unknown"

def event(p, t):
    for e in p.get("Events") or []:
        if e.get("t") == t and (e.get("d") or e.get("p")):
            return {"date": e.get("d") or None, "place": e.get("p") or None}
    return None

for tid, persons in d["trees"].items():
    label = LABEL.get(tid, tid)
    key = lambda gid: f"anc{label}-{gid.split(':')[0]}"
    out = []
    for p in persons:
        gid = p["gid"]["v"]
        fam = {"F": None, "M": None, "spouses": []}
        for f in p.get("Family") or []:
            if f.get("t") in ("F", "M") and not fam[f["t"]]:
                fam[f["t"]] = key(f["tgid"]["v"])
            elif f.get("t") in ("H", "W"):
                fam["spouses"].append(key(f["tgid"]["v"]))
        sex = ((p.get("Genders") or [{}])[0].get("g") or "").upper()[:1] or None
        others = {e.get("t") for e in p.get("Events") or []} - {"Birth", "Death", "Burial"}
        out.append({
            "key": key(gid), "name": name(p), "sex": sex if sex in ("M", "F") else None,
            "birth": event(p, "Birth"), "death": event(p, "Death"), "burial": event(p, "Burial"),
            "father": fam["F"], "mother": fam["M"], "spouses": fam["spouses"],
            "confidence": "UNVERIFIED", "sources": [f"S-ancestry-tree-{tid}"],
            "notes": f"From Ancestry tree {tid} ({d['meta'][tid]['owner']}); other events: {', '.join(sorted(x for x in others if x))}" if others else f"From Ancestry tree {tid} ({d['meta'][tid]['owner']})",
        })
    doc = {"task": f"ancestry-tree-{label}", "updated": d["fetched"][:10], "persons": out,
           "sources": [{"id": f"S-ancestry-tree-{tid}", "title": f"Ancestry member tree '{d['meta'][tid]['name']}' ({d['meta'][tid]['owner']})",
                        "url": f"https://www.ancestry.com/family-tree/tree/{tid}", "type": "user tree"}]}
    (ROOT / f"research/lines/ancestry-tree-{label}.json").write_text(json.dumps(doc, ensure_ascii=False, indent=0), encoding="utf-8")
    print(label, len(out))
