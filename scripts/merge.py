"""Merge the FamilySearch tree crawl and all researched line files into one master database.

Inputs:
  data/raw/fs-tree-dump*.json   FS ancestry crawl(s) (persons keyed by FS id, with f/m links)
  research/lines/*.json         researched persons and sources (see research/SCHEMA.md)
Outputs:
  data/people.json    {id: person}   id = FS id when known, else "R:<key>"
  data/sources.json   {id: source}
  data/merge-report.txt
Researched data overrides tree data. Ahnentafel numbers are recomputed from the final graph.
"""
import json, glob, re, collections, pathlib, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
RANK = {"CONFIRMED": 4, "PROBABLE": 3, "CONFLICT": 2, "UNVERIFIED": 1, None: 0}
report = []

# ---------- 1. FS tree ----------
people = {}
for f in sorted(glob.glob(str(ROOT / "data/raw/fs-tree-dump*.json"))):
    for pid, p in json.loads(pathlib.Path(f).read_text(encoding="utf-8"))["persons"].items():
        q = people.setdefault(pid, {"id": pid, "fsId": pid, "origin": ["fs-tree"]})
        q.setdefault("name", p.get("name"))
        q.setdefault("sex", {"Male": "M", "Female": "F"}.get(p.get("sex")))
        for src, dst in (("b", "birth"), ("chr", "christening"), ("d", "death"), ("bur", "burial")):
            if p.get(src) and not q.get(dst):
                q[dst] = p[src]
        q.setdefault("lifespan", p.get("life"))
        if p.get("f"): q.setdefault("father", p["f"])
        if p.get("m"): q.setdefault("mother", p["m"])
        if p.get("multiParents"): q["multiParents"] = True
        if p.get("alt"):
            alts = [list(a) for a in p["alt"] if any(a)]
            if alts: q["altParents"] = alts
        if p.get("living"): q["fsLiving"] = True
        q.setdefault("confidence", "UNVERIFIED")
report.append(f"FS tree persons: {len(people)}")

# ---------- 2. Research lines ----------
def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]", " ", s).split()

def year(d):
    m = re.search(r"\b(1[0-9]{3}|20[0-9]{2})\b", (d or {}).get("date") or "")
    return int(m.group(1)) if m else None

def ahn_index():
    """Current Ahnentafel number -> person id, from the graph built so far."""
    idx, seen = {}, set()
    roots = [(n, pid) for pid, p in people.items() for n in p.get("_anchor", [])]
    stack = list(roots)
    while stack:
        n, pid = stack.pop()
        if (n, pid) in seen or n > 2**20 or pid not in people:
            continue
        seen.add((n, pid)); idx.setdefault(n, pid)
        p = people[pid]
        if p.get("father"): stack.append((2 * n, p["father"]))
        if p.get("mother"): stack.append((2 * n + 1, p["mother"]))
    return idx

sources, keymap, line_files = {}, {}, sorted(glob.glob(str(ROOT / "research/lines/*.json")))
# core.json first so anchors exist before matching by Ahnentafel number
line_files.sort(key=lambda f: (not f.endswith("core.json"), f))
all_line_persons = []
for f in line_files:
    try:
        d = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
    except Exception as e:
        report.append(f"!! could not parse {f}: {e}"); continue
    task = d.get("task") or pathlib.Path(f).stem
    for s in d.get("sources", []):
        if s.get("id"): sources.setdefault(s["id"], {**s, "task": task})
    for p in d.get("persons", []):
        all_line_persons.append((task, p))

TITLES = {"sir", "lady", "dr", "rev", "col", "capt", "maj", "major", "colonel", "captain", "jr", "sr", "mrs", "mr", "esq", "of", "the", "ii", "iii", "iv"}

def name_key(name):
    name = re.split(r"\s+of\s+|,|\(", name or "")[0]
    name = re.sub(r"[\"'“”‘’][^\"'“”‘’]*[\"'“”‘’]", " ", name)   # drop nicknames
    t = [w for w in norm(name) if w not in TITLES and len(w) > 1]
    return (t[0], t[-1]) if len(t) >= 2 else None

def pyear(p):
    y = year(p.get("birth") if isinstance(p.get("birth"), dict) else {"date": p.get("birth")})
    if y: return y
    m = re.match(r"(\d{4})", p.get("lifespan") or "")
    if m: return int(m.group(1))
    m = re.search(r"-(\d{4})$", p.get("key") or "")
    return int(m.group(1)) if m else None

by_name = collections.defaultdict(list)
def index_name(pid):
    k = name_key(people[pid].get("name"))
    if k: by_name[k].append(pid)
for pid in list(people):
    index_name(pid)

def match(task, p, idx):
    if p.get("fsId") and p["fsId"] in people:
        return p["fsId"]
    if p.get("key") in keymap:
        return keymap[p["key"]]
    toks = set(norm(p.get("name")))
    for n in p.get("ahnentafel") or []:
        pid = idx.get(int(n))
        if pid and toks & set(norm(people[pid].get("name"))):
            return pid
    # fallback: same first given name + surname and birth years within 2
    k, y = name_key(p.get("name")), pyear(p)
    if k and y:
        cands = {c for c in by_name.get(k, []) if pyear(people[c]) and abs(pyear(people[c]) - y) <= 2}
        if len(cands) == 1:
            return cands.pop()
    return None

def merge_into(pid, task, p):
    q = people[pid]
    q.setdefault("origin", [])
    if task not in q["origin"]: q["origin"].append(task)
    better = RANK.get(p.get("confidence"), 0) >= RANK.get(q.get("confidence"), 0)
    for k in ("name", "sex", "birth", "death", "burial", "christening", "occupation", "living"):
        v = p.get(k)
        if k in ("birth", "death", "burial", "christening") and isinstance(v, str):
            v = {"date": v, "place": None}
        if v not in (None, "", {}) and (better or not q.get(k)):
            q[k] = v
    for k in ("wikitreeId", "fagId", "immigrant"):
        if p.get(k) and not q.get(k): q[k] = p[k]
    nv = p.get("notable")
    if isinstance(nv, str) and nv.strip():
        cur = q.get("notable")
        if not cur: q["notable"] = nv
        elif isinstance(cur, str) and nv.lower()[:40] not in cur.lower(): q["notable"] = cur + "; " + nv
    elif nv and not q.get("notable"): q["notable"] = nv
    if better: q["confidence"] = p.get("confidence") or q.get("confidence")
    q.setdefault("sources", [])
    for s in p.get("sources") or []:
        if s not in q["sources"]: q["sources"].append(s)
    if p.get("notes"):
        q.setdefault("notes", {})[task] = p["notes"]
    if task == "core" and p.get("ahnentafel"):
        q["_anchor"] = [int(x) for x in p["ahnentafel"]]

# core persons first (they carry the anchors), then everything else matched against the anchored tree
idx = {}
for phase in ("core", "rest"):
    if phase == "rest":
        idx = ahn_index()
    for task, p in all_line_persons:
        if not p.get("key") or (task == "core") != (phase == "core"): continue
        pid = match(task, p, idx)
        if pid is None:
            pid = "R:" + p["key"]
            people.setdefault(pid, {"id": pid, "origin": [], "confidence": p.get("confidence"), "key": p["key"]})
            people[pid]["name"] = p.get("name")
            people[pid]["birth"] = p.get("birth") if isinstance(p.get("birth"), dict) else None
            index_name(pid)
        keymap[p["key"]] = pid
        merge_into(pid, task, p)
# core.json is hand-curated: re-apply it last so its facts win
for task, p in all_line_persons:
    if task == "core" and p.get("key") in keymap:
        merge_into(keymap[p["key"]], task, p)

conflicts = []
by_key = collections.defaultdict(list)
for task, p in all_line_persons:
    if p.get("key"): by_key[p["key"]].append((task, p))
for _pass in range(2):  # 2nd pass re-applies links after duplicate records were folded together
  conflicts = []
  for task, p in all_line_persons:
      pid = keymap.get(p.get("key"))
      if not pid: continue
      q = people[pid]
      for rel in ("father", "mother"):
          k = p.get(rel)
          if not k: continue
          target = keymap.get(k) or (k if k in people else None)
          if not target: continue
          cur = q.get(rel)
          if cur and cur != target and cur in people and target.startswith("R:"):
              a, b = name_key(people[cur].get("name")), name_key(people[target].get("name"))
              if a and b and a[1] == b[1] and (a[0] == b[0] or a[0][:3] == b[0][:3]):
                  # same person under two ids: fold the researched record into the tree person
                  for t2, rp in by_key.get(target[2:], []):
                      merge_into(cur, t2, rp)
                  people[target]["mergedInto"] = cur
                  keymap[target[2:]] = cur
                  continue
          if q.get(rel) and q[rel] != target and RANK.get(p.get("confidence"), 0) < 3:
              conflicts.append(f"{q.get('name')} {rel}: tree={people.get(q[rel], {}).get('name')} vs {task}={people[target].get('name')} (kept tree; research conf {p.get('confidence')})")
              continue
          if q.get(rel) and q[rel] != target:
              conflicts.append(f"{q.get('name')} {rel}: tree={people.get(q[rel], {}).get('name')} replaced by {task}={people[target].get('name')}")
          q[rel] = target
      for s in p.get("spouses") or []:
          t = keymap.get(s) or (s if s in people else None)
          if t:
              q.setdefault("spouses", [])
              if t not in q["spouses"]: q["spouses"].append(t)

# ---------- 3. Recompute Ahnentafel ----------
for p in people.values():
    p.pop("ahnentafel", None)
anchors = [(n, pid) for pid, p in people.items() for n in p.get("_anchor", [])]
nums = collections.defaultdict(list); routes = collections.Counter()
queue = collections.deque(sorted(anchors))
seen = set()
while queue:
    n, pid = queue.popleft()
    if (n, pid) in seen or pid not in people: continue
    seen.add((n, pid)); routes[pid] += 1
    if len(nums[pid]) < 8: nums[pid].append(n)
    if routes[pid] > 8: continue
    p = people[pid]
    if p.get("father"): queue.append((2 * n, p["father"]))
    if p.get("mother"): queue.append((2 * n + 1, p["mother"]))
for pid, p in people.items():
    p.pop("_anchor", None)
    if pid in nums:
        p["ahnentafel"] = [str(x) for x in sorted(nums[pid])]
        p["generation"] = min(nums[pid]).bit_length()
        p["routes"] = routes[pid]
    else:
        p["ahnentafel"] = []

# ---------- 4. Flagged (fabricated / unsupported / rejected) parent links ----------
corr_path = ROOT / "research/corrections.json"
flags = json.loads(corr_path.read_text(encoding="utf-8"))["links"] if corr_path.exists() else []
for f in line_files:
    try:
        d = json.loads(pathlib.Path(f).read_text(encoding="utf-8"))
        flags += [{**x, "task": d.get("task") or pathlib.Path(f).stem} for x in d.get("rejectLinks", [])]
    except Exception:
        pass
flagged = {}
ahn_to_id = {}
for pid_, nl in nums.items():
    for n_ in nl: ahn_to_id.setdefault(n_, pid_)
for c in flags:
    if not c.get("child") and c.get("childAhnentafel"):
        c = {**c, "child": ahn_to_id.get(int(c["childAhnentafel"]), "?")}
    if c["child"] not in people:   # allow research keys ("R:key" or "key") as well as FS ids
        k = c["child"][2:] if c["child"].startswith("R:") else c["child"]
        c = {**c, "child": keymap.get(k, c["child"])}
    q = people.get(c["child"])
    if not q or not q.get(c["rel"]):
        report.append(f"!! correction not applied (no such link): {c['child']} {c['rel']}"); continue
    q.setdefault("linkFlags", {})[c["rel"]] = {k: c[k] for k in ("verdict", "reason", "task") if k in c}
    flagged[(c["child"], c["rel"])] = c
# people reachable without crossing a flagged link
clean, stack = set(), [pid for pid, p in people.items() if p["ahnentafel"] and int(p["ahnentafel"][0]) < 16]
while stack:
    pid = stack.pop()
    if pid in clean or pid not in people: continue
    clean.add(pid)
    for rel in ("father", "mother"):
        if people[pid].get(rel) and (pid, rel) not in flagged:
            stack.append(people[pid][rel])
# everyone else in the pedigree inherits the verdict of the flagged link they hang from
for (child, rel), c in flagged.items():
    stack = [people[child][rel]]
    while stack:
        pid = stack.pop()
        p = people.get(pid)
        if not p or pid in clean or p.get("lineFlag"): continue
        p["lineFlag"] = {"verdict": c["verdict"], "via": child, "reason": c.get("reason")}
        stack += [p[r] for r in ("father", "mother") if p.get(r)]
n_flag = collections.Counter(p["lineFlag"]["verdict"] for p in people.values() if p.get("lineFlag") and p["ahnentafel"])
report.append("flagged lines: " + (", ".join(f"{k}={v}" for k, v in n_flag.items()) or "none"))


# ---------- 5. Data quality: parent sex fix, estimated birth years, chronology flags, tiers ----------
swapped = 0
for p in people.values():
    f, m = people.get(p.get("father")), people.get(p.get("mother"))
    if f and m and f.get("sex") == "F" and m.get("sex") == "M":
        p["father"], p["mother"] = p["mother"], p["father"]; swapped += 1
    elif f and not m and f.get("sex") == "F" and not p.get("mother"):
        p["mother"] = p.pop("father"); swapped += 1
    elif m and not f and m.get("sex") == "M" and not p.get("father"):
        p["father"] = p.pop("mother"); swapped += 1
def _y(e):
    if isinstance(e, dict):
        m = re.search(r"\b(\d{3,4})\b", e.get("date") or "")
        return int(m.group(1)) if m else None
    return None
for p in people.values():
    y = _y(p.get("birth")) or _y(p.get("christening"))
    if not y:
        m = re.match(r"(\d{3,4})", p.get("lifespan") or "")
        y = int(m.group(1)) if m else None
    if y and 1 <= y <= 2030:
        p["birthYear"] = y; p["birthYearEst"] = False
# estimate missing birth years from children (child - 30) and parents (parent + 30), iterating
children = collections.defaultdict(list)
for pid, p in people.items():
    for r in ("father", "mother"):
        if p.get(r): children[p[r]].append(pid)
for _ in range(60):
    changed = 0
    for pid, p in people.items():
        if p.get("birthYear"): continue
        ks = [people[c]["birthYear"] for c in children.get(pid, []) if people[c].get("birthYear")]
        ps = [people[p[r]]["birthYear"] for r in ("father", "mother") if p.get(r) in people and people[p[r]].get("birthYear")]
        if ks: p["birthYear"] = min(ks) - 30; p["birthYearEst"] = True; changed += 1
        elif ps: p["birthYear"] = max(ps) + 30; p["birthYearEst"] = True; changed += 1
    if not changed: break
chrono = 0
for p in people.values():
    y = p.get("birthYear")
    if not y or p.get("birthYearEst"): continue
    for r, lo, hi in (("father", 13, 85), ("mother", 12, 55)):
        q = people.get(p.get(r))
        if q and q.get("birthYear") and not q.get("birthYearEst"):
            d = y - q["birthYear"]
            if d < lo or d > hi:
                p.setdefault("quality", []).append(f"{r} born {q['birthYear']} ({d} yrs before child): implausible")
                chrono += 1
# people reachable only through alternate parent sets (FamilySearch's competing parent attachments)
alt_reach = {}
stack = [(pid, pid) for pid, p in people.items() if p.get("ahnentafel") and p.get("altParents")]
seen_alt = set()
while stack:
    pid, via = stack.pop()
    p = people.get(pid)
    if not p: continue
    nexts = []
    if p.get("ahnentafel") and pid == via:
        nexts = [x for a in p.get("altParents", []) for x in a if x]
    elif not p.get("ahnentafel"):
        nexts = [p.get("father"), p.get("mother")] + [x for a in p.get("altParents", []) for x in a if x]
    for x in nexts:
        if x and x in people and not people[x].get("ahnentafel") and x not in seen_alt:
            seen_alt.add(x); alt_reach[x] = via; stack.append((x, via))
for x, via in alt_reach.items():
    people[x]["altOf"] = via
report.append(f"alternate-parent lineages: {len(alt_reach)} people reachable only via alternate parent sets")
LIVING_CUTOFF = 1925
for p in people.values():
    y = p.get("birthYear")
    if p.get("altOf") and not p.get("ahnentafel"):
        tier = "alternate"
    elif p.get("lineFlag"):
        tier = "flagged"
    elif p.get("confidence") in ("CONFIRMED", "PROBABLE"):
        tier = "verified"
    elif p.get("confidence") == "CONFLICT":
        tier = "conflict"
    elif (y is not None and y < 1000) or (p.get("ahnentafel") and int(p["ahnentafel"][0]).bit_length() >= 40):
        tier = "legendary"
    elif (y is not None and y < 1500) or (p.get("ahnentafel") and int(p["ahnentafel"][0]).bit_length() >= 26):
        tier = "medieval"
    else:
        tier = "tree"
    p["tier"] = tier
    if p.get("living") is None and y and y >= LIVING_CUTOFF and not p.get("death"):
        p["possiblyLiving"] = True
report.append(f"quality: parent sex swaps fixed={swapped}; implausible parent ages flagged={chrono}")

in_tree = [p for p in people.values() if p["ahnentafel"]]
conf = collections.Counter(p.get("confidence") for p in in_tree)
report += [f"line files: {len(line_files)}; researched persons: {len(all_line_persons)}; sources: {len(sources)}",
           f"persons in pedigree: {len(in_tree)} (others unattached: {len(people) - len(in_tree)})",
           "confidence: " + ", ".join(f"{k}={v}" for k, v in conf.most_common()),
           "tiers: " + ", ".join(f"{k}={v}" for k, v in collections.Counter(p["tier"] for p in in_tree).most_common()),
           f"max generation: {max(p['generation'] for p in in_tree)}",
           "", "unattached researched persons (no route to subject):"]
report += [f"  {p['id']} {p.get('name')}" for p in people.values() if not p["ahnentafel"] and p["id"].startswith("R:") and not p.get("mergedInto")]
report += ["", f"parent-link conflicts ({len(conflicts)}):"] + ["  " + c for c in conflicts]
(ROOT / "data/keymap.json").write_text(json.dumps(keymap, ensure_ascii=False), encoding="utf-8")
(ROOT / "data/people.json").write_text(json.dumps(people, ensure_ascii=False, indent=0), encoding="utf-8")
(ROOT / "data/sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=1), encoding="utf-8")
(ROOT / "data/merge-report.txt").write_text("\n".join(report), encoding="utf-8")
print("\n".join(report[:12]))
