"""Improved DIY ThruLines (v2).

For each AncestryDNA match with a public linked tree, walk the HOME PERSON's ancestry (father/mother ids)
and compare to our ancestors (data/people.json) using
  name key (first given name + surname, nickname/spelling variants) + birth year (+-2, +-5 pre-1700)
  + birthplace-token compatibility + COUPLE agreement (both spouses of a pair match).
Hits are reduced to the most recent ones (a hit that is an ancestor of another hit is dropped).
Outputs data/dna/match2.json (per match) and data/dna/match2-by-ancestor.json (per ancestor).
Run: python scripts/dna_match2.py
"""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG
import json, re, collections, pathlib, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
M = {m["sampleId"]: m for m in json.loads((ROOT / "data/dna/dna-ancestry-matches.json").read_text(encoding="utf-8"))["matches"]}
TREES = json.loads((ROOT / "data/dna/dna-ancestry-match-trees.json").read_text(encoding="utf-8"))["trees"]

TITLES = {"sir", "lady", "dr", "rev", "col", "capt", "maj", "jr", "sr", "mrs", "mr", "esq", "ii", "iii", "iv", "the", "of", "gen", "hon"}
NICK = {"betsy": "elizabeth", "eliza": "elizabeth", "elisabeth": "elizabeth", "betty": "elizabeth", "bettie": "elizabeth", "liz": "elizabeth",
        "polly": "mary", "molly": "mary", "peggy": "margaret", "margret": "margaret", "meg": "margaret", "patsy": "martha", "sally": "sarah", "sallie": "sarah",
        "sary": "sarah", "nancy": "ann", "anne": "ann", "anna": "ann", "hannah": "ann", "jno": "john", "johnny": "john", "jack": "john", "wm": "william", "will": "william",
        "billy": "william", "bill": "william", "thos": "thomas", "tom": "thomas", "jas": "james", "jim": "james", "chas": "charles", "geo": "george", "benj": "benjamin",
        "kate": "catherine", "katherine": "catherine", "katharine": "catherine", "cathrine": "catherine", "kathrine": "catherine", "catharine": "catherine", "dolly": "dorothy", "hetty": "hester",
        "susannah": "susan", "susanna": "susan", "rebecka": "rebecca", "rachael": "rachel", "isabella": "isabel", "isabelle": "isabel",
        "fanny": "frances", "francis": "frances", "nelly": "ellen", "helen": "ellen", "mattie": "martha"}
SURV = {k.lower(): v.lower() for k, v in (CFG.get("surnameVariants") or {}).items()}   # spelling variant -> canonical, family.config.json

def deacc(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
def norm(s):
    return [w for w in re.sub(r"[^a-z ]", " ", deacc(s)).split() if w not in TITLES and len(w) > 1]
def key(name):
    name = re.split(r"\s+of\s+|,|\(", name or "")[0]
    name = re.sub(r"[\"'“”‘’][^\"'“”‘’]*[\"'“”‘’]", " ", name)
    t = norm(name)
    if len(t) < 2:
        return None
    return (NICK.get(t[0], t[0]), SURV.get(t[-1], t[-1]))
def yr(s):
    m = re.search(r"\b(1[0-9]{3}|20[0-2][0-9])\b", s or "")
    return int(m.group(1)) if m else None
def pyear(p):
    b = p.get("birth")
    y = yr(b.get("date")) if isinstance(b, dict) else None
    return y or yr(p.get("lifespan"))
GENERIC = {"usa", "united", "states", "america", "county", "twp", "township", "city", "parish", "near", "north", "south", "east", "west", "unknown", "probably"}
STATEABBR = {"va": "virginia", "md": "maryland", "nc": "north carolina", "sc": "south carolina", "ga": "georgia", "ky": "kentucky", "tn": "tennessee", "pa": "pennsylvania",
             "al": "alabama", "ms": "mississippi", "la": "louisiana", "tx": "texas", "mo": "missouri", "oh": "ohio", "il": "illinois", "in": "indiana", "ny": "new york", "nj": "new jersey",
             "ma": "massachusetts", "ct": "connecticut", "wv": "west virginia", "eng": "england", "ire": "ireland", "ca": "california", "fl": "florida"}
def ptoks(pl):
    s = deacc(pl)
    s = re.sub(r"\b([a-z]{2})\b", lambda m: STATEABBR.get(m.group(1), m.group(1)), s)
    return {w for w in re.sub(r"[^a-z ]", " ", s).split() if len(w) > 2 and w not in GENERIC}

def sidegroup(n):
    b = n.bit_length()
    if b < 2:
        return "S"
    return "P" if (n >> (b - 2)) == 2 else "M"

anc = collections.defaultdict(list)
AHN = {}
for pid, p in P.items():
    nums = sorted(int(n) for n in p.get("ahnentafel", []))
    if not nums or nums[0] < 4:
        continue
    AHN[pid] = nums
    k, y = key(p.get("name")), pyear(p)
    if k:
        b = p.get("birth") if isinstance(p.get("birth"), dict) else {}
        anc[k].append((pid, y, nums[0], ptoks(b.get("place"))))
spouse_of = collections.defaultdict(set)
for pid, p in P.items():
    if p.get("father") and p.get("mother"):
        spouse_of[p["father"]].add(p["mother"]); spouse_of[p["mother"]].add(p["father"])

def is_anc_of(a, b):
    for x in AHN[a]:
        for y in AHN[b]:
            if x > y and (x >> (x.bit_length() - y.bit_length())) == y:
                return True
    return False

def match_row(row):
    _, name, birth, _, _, _ = row
    k = key(name)
    if not k:
        return []
    y = yr((birth or ["", ""])[0]); bp = ptoks((birth or ["", ""])[1])
    out = []
    for pid, ay, n, ap in anc.get(k, []):
        tol = 2 if (ay or y or 1800) >= 1700 else 5
        if y and ay:
            if abs(y - ay) > tol:
                continue
            score = 2 if abs(y - ay) <= 1 else 1.5
        else:
            if not (bp and ap and bp & ap):
                continue
            score = 0.5
        if bp and ap:
            score += 1 if bp & ap else -0.75
        out.append((pid, score))
    return out

def run():
    results = {}
    for sid, t in TREES.items():
        m = M.get(sid)
        if not m or not t.get("people") or m["cM"] >= 1300:
            continue
        rows = {r[0]: r for r in t["people"]}
        home = t.get("homePerson")
        partners = collections.defaultdict(set)
        for r in rows.values():
            if r[4] and r[5]:
                partners[r[4]].add(r[5]); partners[r[5]].add(r[4])
        # the home person's own row is not included in the data; every row is one of the home person's ancestors
        scope = {i: None for i in rows}
        kids = collections.defaultdict(list)
        for r in rows.values():
            for par in (r[4], r[5]):
                if par in rows:
                    kids[par].append(r[0])
        memo = {}
        def dd(i, seen=()):
            if i in memo:
                return memo[i]
            ks = [c for c in kids.get(i, []) if c not in seen]
            v = 0 if not ks else 1 + min(dd(c, seen + (i,)) for c in ks)
            memo[i] = v
            return v
        hits = {}
        for i in scope:
            h = match_row(rows[i])
            if h:
                hits[i] = h
        best = {}
        for i, h in hits.items():
            for pid, sc in h:
                bonus = 0
                for q in partners.get(i, ()):
                    if q in hits and any(pq in spouse_of[pid] for pq, _ in hits[q]):
                        bonus = 1.5
                        break
                tot = sc + bonus
                if i not in best or tot > best[i][1]:
                    best[i] = (pid, tot, bonus > 0)
        good = {i: v for i, v in best.items() if v[1] >= 2.0}
        if not good:
            continue
        pids = {v[0] for v in good.values()}
        recent = {a for a in pids if not any(b != a and is_anc_of(a, b) for b in pids)}
        ent = []
        for a in sorted(recent, key=lambda x: AHN[x][0]):
            sup = sum(1 for b in pids if b != a and is_anc_of(b, a))
            ti = [i for i, v in good.items() if v[0] == a][0]
            dm = dd(ti) + 1
            mei = AHN[a][0].bit_length() - 1 + dm
            ent.append({"pid": a, "ahn": AHN[a][0], "matchDepth": dm, "meioses": mei, "plausible": mei <= 14, "name": P[a].get("name"), "score": round(good[ti][1], 2), "couple": good[ti][2],
                        "supportingAncestorsAlsoMatched": sup, "matchTreeName": rows[ti][1]})
        results[sid] = {"name": m.get("name"), "cM": m["cM"], "segs": m.get("segs"), "closest": ent, "nHits": len(good), "treeSize": t.get("count"),
                        "allHitPids": sorted(pids)}
    return results

if __name__ == "__main__":
    results = run()
    (ROOT / "data/dna/match2.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    per = collections.defaultdict(dict)
    for sid, r in results.items():
        for e in r["closest"]:
            if e["plausible"]:
                per[e["pid"]][sid] = (r["name"], r["cM"], e["couple"])
    out = {}
    for pid, ms in per.items():
        out[pid] = {"ahn": AHN[pid], "name": P[pid].get("name"), "conf": P[pid].get("confidence"), "lineFlag": (P[pid].get("lineFlag") or {}).get("verdict"),
                    "n": len(ms), "nCouple": sum(1 for v in ms.values() if v[2]), "totalcM": sum(v[1] for v in ms.values()),
                    "matches": sorted(ms.values(), key=lambda x: -x[1])}
    (ROOT / "data/dna/match2-by-ancestor.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(results), "matches with hits;", len(out), "closest-ancestors")
