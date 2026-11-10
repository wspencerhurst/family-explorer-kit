"""QA area `dates`: dates & chronology fixes (applied to the in-memory people dict before site data is built).

Root causes addressed
  1. merge.py / build_site_data.yr() ignore "BC": "0884 BC" became year 884 AD, so ~6,000 ancient people were
     born in the Middle Ages and their descendants' estimated years (child-30, parent+30) were wrong too.
     Fix: BC (and bare years > 2026 that can only be BC) become NEGATIVE birthYear; estimates around them are
     recomputed.  store.years() prints negative years as "N BC".
  2. Placeholder dates "0000-00-00" are shown as dates / parsed as nothing useful -> cleared.
  3. Estimated birth years (child-30 / parent+30) that contradict real neighbouring data (born after own death,
     before a real parent's birth+13, after a real child's birth-13) are re-estimated.
  4. FamilySearch "lifespan" strings that disagree with the birth/death events (used for relative chips) are
     rebuilt from the events.
  5. Wide birth ranges ("abt 1700-1800") were read as the first year; now midpoint, flagged as estimate.
  6. Quality notes: stale/garbled BC notes removed; death-before-birth and "born after parent's death" noted.
"""
import json, pathlib, re, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
BC_RE = re.compile(r"\b(\d{1,4})\s*B\.?\s?C\.?(?:E\.?)?(?![A-Za-z])", re.I)
ZERO_RE = re.compile(r"^\s*0+([-/ ]0+)*\s*$")
QUAL_AFTER = re.compile(r"\b(aft|after)\b", re.I)
QUAL_ANY = re.compile(r"\b(bef|before|aft|after|bet|between|from)\b", re.I)
RANGE_RE = re.compile(r"\b(\d{3,4})\s*(?:-|–|to|and)\s*(\d{3,4})\b", re.I)
LS_RE = re.compile(r"^\s*(\d{3,4})?\s*-\s*(\d{3,4}|Deceased)?\s*$", re.I)
IMPL_RE = re.compile(r"^(father|mother) born (-?\d+)(?: BC)? \(-?\d+ yrs before child\): implausible$")


def _date(p, k):
    e = p.get(k)
    if isinstance(e, dict): return e.get("date")
    return e if isinstance(e, str) else None


def _tokens(d):
    return re.findall(r"\b(\d{3,4})\b", d or "")


def _year(d):
    """signed year from a date string: BC -> negative; bare year > 2026 -> negative (can only be BC); else None-safe."""
    if not d: return None
    m = BC_RE.search(d)
    if m: return -int(m.group(1))
    t = _tokens(d)
    if not t: return None
    y = int(t[0])
    if y > 2026: return -y
    return y if y >= 1 else None


def apply(ctx):
    P = ctx["P"]
    log = []
    def L(pid, field, old, new, reason):
        log.append({"id": pid, "field": field, "old": old, "new": new, "reason": reason})

    # ---- 2. placeholder dates
    zero = 0
    for pid, p in P.items():
        for k in ("birth", "death", "burial", "christening"):
            e = p.get(k)
            if isinstance(e, dict) and isinstance(e.get("date"), str) and ZERO_RE.match(e["date"]):
                L(pid, k + ".date", e["date"], None, "placeholder date 0000-00-00")
                e["date"] = None; zero += 1

    # ---- 1. BC / ancient years -> negative birthYear
    changed = set()
    ndec = 0
    for pid, p in P.items():
        bd = _date(p, "birth") or _date(p, "christening")
        dd = _date(p, "death") or _date(p, "burial")
        by = p.get("birthYear")
        newy = None
        if bd:
            y = _year(bd)
            if y is not None and y < 0:
                newy = y
        if newy is None and dd and by and by > 0 and not p.get("birthYearEst"):
            y = _year(dd)
            if y is not None and y < 0:
                newy = None     # AD year (from a lifespan string) but death is BC: invalid
                L(pid, "birthYear", by, None, "birth year taken as AD but death date is BC")
                p["birthYear"] = None; p["birthYearEst"] = True
                changed.add(pid)
        if newy is not None and (by != newy or p.get("birthYearEst")):
            L(pid, "birthYear", by, newy, "BC/ancient date read as AD")
            p["birthYear"] = newy; p["birthYearEst"] = False
            changed.add(pid); ndec += 1
    # death year for BC deaths (signed), used below
    def dyear(p):
        return _year(_date(p, "death"))

    # relations for estimate propagation
    children = collections.defaultdict(list)
    for pid, p in P.items():
        for r in ("father", "mother"):
            if p.get(r) in P: children[p[r]].append(pid)
    def nbrs(pid):
        p = P[pid]
        yield from (p[r] for r in ("father", "mother") if p.get(r) in P)
        yield from children.get(pid, [])

    # reset estimates connected (through estimated people) to a changed person, then re-estimate
    reset = set()
    stack = [c for c in changed]
    seen = set(stack)
    while stack:
        pid = stack.pop()
        if P[pid].get("birthYearEst") or P[pid].get("birthYear") is None:
            if pid in changed or P[pid].get("birthYearEst"): reset.add(pid)
        for n in nbrs(pid):
            if n in seen: continue
            q = P[n]
            if q.get("birthYearEst") or not q.get("birthYear"):
                seen.add(n); reset.add(n); stack.append(n)
    old_est = {pid: P[pid].get("birthYear") for pid in reset}
    for pid in reset: P[pid]["birthYear"] = None
    def estimate(pid):
        p = P[pid]
        ks = [P[c]["birthYear"] for c in children.get(pid, []) if P[c].get("birthYear") is not None]
        ps = [P[p[r]]["birthYear"] for r in ("father", "mother") if p.get(r) in P and P[p[r]].get("birthYear") is not None]
        if ks: return min(ks) - 30
        if ps: return max(ps) + 30
        return None
    for _ in range(80):
        ch = 0
        for pid in reset:
            if P[pid].get("birthYear") is None:
                e = estimate(pid)
                if e is not None:
                    if e == 0: e = -1
                    P[pid]["birthYear"] = e; P[pid]["birthYearEst"] = True; ch += 1
        if not ch: break
    nreset = 0
    for pid in reset:
        if old_est[pid] != P[pid].get("birthYear"):
            L(pid, "birthYear", old_est[pid], P[pid].get("birthYear"), "estimate recomputed after BC years corrected"); nreset += 1

    # ---- 5. wide birth ranges -> midpoint estimate
    nrange = 0
    for pid, p in P.items():
        if p.get("birthYearEst") or not p.get("birthYear") or p["birthYear"] < 0: continue
        bd = _date(p, "birth")
        if not bd or BC_RE.search(bd): continue
        m = RANGE_RE.search(bd)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            if 15 <= b - a <= 150 and a == p["birthYear"] and a < 1950:
                mid = (a + b) // 2
                L(pid, "birthYear", p["birthYear"], mid, f"birth date is a wide range ({bd}); midpoint, shown as estimate")
                p["birthYear"] = mid; p["birthYearEst"] = True; nrange += 1

    # ---- 3. estimates contradicting real neighbours / own death
    nest = 0
    for pid, p in P.items():
        if not p.get("birthYearEst") or p.get("birthYear") is None: continue
        e = p["birthYear"]
        lo = hi = None
        for r in ("father", "mother"):
            q = P.get(p.get(r))
            if q and q.get("birthYear") is not None and not q.get("birthYearEst"):
                v = q["birthYear"] + 13
                lo = v if lo is None else max(lo, v)
        for c in children.get(pid, []):
            q = P[c]
            if q.get("birthYear") is not None and not q.get("birthYearEst"):
                v = q["birthYear"] - 13
                hi = v if hi is None else min(hi, v)
        dy = dyear(p)
        if dy is not None:
            hi = dy if hi is None else min(hi, dy)
        new = e
        if lo is not None and hi is not None and lo > hi:
            new = (lo + hi) // 2
        elif hi is not None and e > hi:
            new = hi - 17 if lo is None else max(lo, hi - 17)
        elif lo is not None and e < lo:
            new = lo + 17 if hi is None else min(hi, lo + 17)
        if new != e:
            if new == 0: new = -1
            L(pid, "birthYear", e, new, "estimated birth year contradicted own death / real parent or child dates")
            p["birthYear"] = new; nest += 1

    # ---- 4. lifespan strings that disagree with events
    nls = 0
    for pid, p in P.items():
        ls = p.get("lifespan")
        if not ls or not isinstance(ls, str): continue
        m = LS_RE.match(ls)
        if not m: continue
        a, b = m.group(1), m.group(2)
        bd, dd = _date(p, "birth") or _date(p, "christening"), _date(p, "death")
        by = p.get("birthYear")
        na, nb = a, b
        if bd and len(_tokens(bd)) == 1 and not BC_RE.search(bd) and by and by > 0 and not p.get("birthYearEst") and by == int(_tokens(bd)[0]) and (a is None or int(a) != by):
            na = str(by)
        if dd and len(_tokens(dd)) == 1 and not BC_RE.search(dd) and not QUAL_ANY.search(dd):
            dy = int(_tokens(dd)[0])
            if dy <= 2026 and (b is None or b.lower() == "deceased" or int(b) != dy):
                nb = str(dy)
        if (na, nb) != (a, b):
            new = f"{na or ''}-{nb or ''}"
            L(pid, "lifespan", ls, new, "lifespan string disagreed with birth/death events")
            p["lifespan"] = new; nls += 1

    # ---- 6. quality notes
    nq = 0
    skip_links = set()
    try:
        d = json.loads((ROOT / "research/lines/qa-dates.json").read_text(encoding="utf-8"))
        skip_links = {(x["child"], x["rel"]) for x in d.get("rejectLinks", [])}
    except Exception:
        pass
    touched = set(changed) | reset
    def fmt(y): return f"{-y} BC" if y < 0 else str(y)
    for pid, p in P.items():
        if p.get("mergedInto") or not (p.get("ahnentafel") or p.get("altOf")): continue
        q_ = p.get("quality")
        by = p.get("birthYear")
        involved = pid in touched or any(p.get(r) in touched for r in ("father", "mother"))
        if q_ and involved:
            keep = [s for s in q_ if not IMPL_RE.match(s)]
            if len(keep) != len(q_):
                L(pid, "quality", q_, keep, "parent-age notes computed with BC years read as AD; recomputed")
                q_ = keep; p["quality"] = keep
        notes = []
        if by is not None and not p.get("birthYearEst"):
            for r, lo, hi in (("father", 13, 85), ("mother", 12, 55)):
                q = P.get(p.get(r))
                if not q: continue
                if involved and q.get("birthYear") is not None and not q.get("birthYearEst"):
                    dd_ = by - q["birthYear"]
                    if dd_ < lo or dd_ > hi:
                        notes.append(f"{r} born {fmt(q['birthYear'])} ({dd_} yrs before child): implausible")
                if (pid, r) in skip_links or (p.get("linkFlags") or {}).get(r): continue
                qds = _date(q, "death")
                qd = _year(qds)
                if qd is not None and not QUAL_AFTER.search(qds or "") and not QUAL_ANY.search(_date(p, "birth") or ""):
                    lim = 1 if r == "father" else 0
                    if by - qd > lim + 1:
                        notes.append(f"born {by - qd} yrs after {r}'s death ({fmt(qd)}): check the {r} link")
            dy = dyear(p)
            if dy is not None and dy < by and not QUAL_ANY.search(_date(p, "birth") or ""):
                notes.append(f"death ({fmt(dy)}) is before birth ({fmt(by)}): one of the dates is wrong")
        for n in notes:
            if n not in (p.get("quality") or []):
                p.setdefault("quality", []).append(n); nq += 1

    out = ROOT / "research/qa/dates-fixes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(log, ensure_ascii=False, indent=0), encoding="utf-8")
    return (f"BC->negative years={ndec}; estimates recomputed={nreset}; wide ranges={nrange}; contradicting estimates={nest}; "
            f"lifespans rebuilt={nls}; placeholder dates cleared={zero}; quality notes added={nq}; log entries={len(log)}")
