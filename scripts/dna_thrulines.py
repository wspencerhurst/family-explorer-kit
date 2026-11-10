"""DIY 'ThruLines': find which of the subject's ancestors appear in each DNA match's public Ancestry tree.

Inputs:  data/people.json, data/dna/dna-ancestry-matches.json, data/dna/dna-ancestry-match-trees.json
Outputs: data/dna/thrulines.json   per match: cM, closest shared ancestors (Ahnentafel numbers)
         data/dna/thrulines-summary.txt  per ancestor: supporting matches and total cM

A tree person counts as one of our ancestors when the first given name and surname match and the
birth years differ by <= 2. For each match we keep only the closest generation of hits, which is the likely common-ancestor couple.
"""
import json, re, collections, pathlib, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
M = {m["sampleId"]: m for m in json.loads((ROOT / "data/dna/dna-ancestry-matches.json").read_text(encoding="utf-8"))["matches"]}
TREES = json.loads((ROOT / "data/dna/dna-ancestry-match-trees.json").read_text(encoding="utf-8"))["trees"]

TITLES = {"sir", "lady", "dr", "rev", "col", "capt", "maj", "jr", "sr", "mrs", "mr", "esq", "ii", "iii", "iv"}
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return [w for w in re.sub(r"[^a-z ]", " ", s).split() if w not in TITLES and len(w) > 1]
def key(name):
    name = re.split(r"\s+of\s+|,|\(", name or "")[0]
    name = re.sub(r"[\"'“”‘’][^\"'“”‘’]*[\"'“”‘’]", " ", name)
    t = norm(name)
    return (t[0], t[-1]) if len(t) >= 2 else None
def yr(s):
    m = re.search(r"\b(1[0-9]{3}|20[0-2][0-9])\b", s or "")
    return int(m.group(1)) if m else None
def pyear(p):
    y = yr((p.get("birth") or {}).get("date") if isinstance(p.get("birth"), dict) else None)
    return y or yr(p.get("lifespan"))

# our ancestors, generations 3..14 (grandparents up), indexed by name key
anc = collections.defaultdict(list)
for pid, p in P.items():
    nums = [int(n) for n in p.get("ahnentafel", [])]
    if not nums or min(nums) < 4 or min(nums).bit_length() > 14:
        continue
    k, y = key(p.get("name")), pyear(p)
    if k and y:
        anc[k].append((pid, y, min(nums)))

results, per_anc = {}, collections.defaultdict(list)
for sid, t in TREES.items():
    m = M.get(sid)
    if not m or not t.get("people") or m["cM"] >= 1300:
        continue
    hits = {}
    for row in t["people"]:
        _, name, birth, _, _, _ = row
        k, y = key(name), yr((birth or ["", ""])[0])
        if not k or not y:
            continue
        for pid, ay, n in anc.get(k, []):
            if abs(ay - y) <= 2:
                hits[pid] = n
    if not hits:
        continue
    g = min(n.bit_length() for n in hits.values())
    closest = sorted((n, pid) for pid, n in hits.items() if n.bit_length() == g)
    results[sid] = {"name": m.get("name"), "cM": m["cM"], "assignment": (m.get("rel") or {}).get("assignment"),
                    "closest": [{"ahn": n, "id": pid, "name": P[pid].get("name")} for n, pid in closest],
                    "allHits": len(hits)}
    for n, pid in closest:
        per_anc[pid].append((m["cM"], m.get("name"), sid))

(ROOT / "data/dna/thrulines.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
by_ahn = sorted(per_anc.items(), key=lambda kv: min(int(n) for n in P[kv[0]]["ahnentafel"]))
lines = [f"matches with trees analysed: {sum(1 for s in TREES if TREES[s].get('people'))}; matches with >=1 hit: {len(results)}",
         "ancestor (lowest Ahnentafel) | supporting matches | total cM | top matches"]
for pid, lst in by_ahn:
    p = P[pid]
    lst.sort(reverse=True)
    flag = f" [{p['lineFlag']['verdict']} line]" if p.get("lineFlag") else ""
    lines.append(f"#{min(int(n) for n in p['ahnentafel'])} {p.get('name')} ({p.get('lifespan') or ''}) [{p.get('confidence')}]{flag} | {len(lst)} | {sum(c for c, _, _ in lst)} | "
                 + "; ".join(f"{nm} {c}cM" for c, nm, _ in lst[:4]))
(ROOT / "data/dna/thrulines-summary.txt").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines[:70]))
