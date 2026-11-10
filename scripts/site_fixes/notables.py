"""QA fixes for the Discover page notable-people data (area: notables).

Root causes handled here (data/notable-kin.json is stale relative to data/people.json, and notable_kin*.py
only validated the common ancestor when it was computed):
  1. KIN cousins whose common ancestor is now on a flagged / UNSUPPORTED line or is no longer in the pedigree are
     kept but labelled "(unsupported link)" so the card does not state a relationship as fact.
  2. KIN stepsSubject / relationship were computed against an older pedigree; recompute from the common ancestor's
     CURRENT generation (the label and the "Your line - N generations" column must agree).
  3. KIN duplicates (same FamilySearch id listed 2-3 times, once per path).
  4. KIN entries with no name (Wikidata/FS name missing) -> use the first name of the FS line.
  5. KINWD notables who are actually one of our own ancestors but slipped past the builder's name filter
     (titles such as "Gov." were not ignored, e.g. "Gov. John Doe").
  6. Same notable present in both KIN and KINWD under different spellings (builder only compared exact lowercase name).
  7. desc junk: duplicated "(1743-1826)" years, replacement characters, years-only or one-word fragments.
Every change is logged to research/qa/notables-fixes.json.
"""
import json, pathlib, re, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent

STOP = set("sir col colonel capt captain maj major dr rev reverend jr sr ii iii iv v of the president king lady lord gen general "
           "gov governor hon honorable mr mrs judge senator".split())


def _toks(n):
    n = re.sub(r"\(.*?\)", "", n or "")
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    return [w for w in re.sub(r"[^a-z ]", " ", n).split() if w not in STOP]


def _ordinal(n):
    return {1: "1st", 2: "2nd", 3: "3rd"}.get(n, f"{n}th")


def _great(k):
    return "" if k <= 0 else ("great-" if k == 1 else f"{k}x-great-")


def _relationship(a, b, half):
    # same logic as notable_kin.py
    h = "half " if half else ""
    if b == 0:
        return f"{_great(a-2)}grandparent" if a >= 2 else "parent"
    if b == 1:
        return f"{h}{_great(a-3)}{'grand' if a >= 3 else ''}uncle/aunt" if a >= 2 else "sibling"
    if a == 1:
        return f"{h}sibling"
    c = min(a, b) - 1
    r = abs(a - b)
    return f"{h}{_ordinal(c)} cousin" + (f" {r}x removed" if r else "")


def _gen(p):
    a = p.get("ahnentafel")
    return min(int(k) for k in a).bit_length() - 1 if a else None


def _clean_desc(d):
    if d is None:
        return d
    s = d.replace("�", "–")
    # a trailing "(1900-1965)" that repeats years already present earlier in the text
    m = re.search(r"\s*\((\d{3,4})\s*[-–—]\s*(\d{0,4})\)\s*$", s)
    if m:
        head = s[:m.start()]
        if re.search(r"\(\s*\d{3,4}\s*[-–—]\s*\d{0,4}\s*\)", head) or re.search(r"\b%s\s*[-–—]\s*%s\b" % (m.group(1), m.group(2) or r"\d{0,4}"), head):
            s = head
    s = re.sub(r"\s*<[^>]*>", "", s)          # "born 1020 <Novgorod,Novgorod,Ukraine>"
    s = s.strip()
    if re.fullmatch(r"[\d\s\-–?]*", s):   # years only: "1850-"
        return ""
    return s


def apply(ctx):
    P, KIN, KINWD, SUM = ctx["P"], ctx["KIN"], ctx["KINWD"], ctx["SUM"]
    log = []

    def L(who, field, old, new, reason):
        log.append({"id": who, "field": field, "old": old, "new": new, "reason": reason})

    # ---- ancestors by name for the "is actually our ancestor" test
    ped = {}
    for pid, p in P.items():
        if p.get("ahnentafel") and p.get("birthYear"):
            t = _toks(p.get("name"))
            if len(t) >= 2:
                ped.setdefault(t[-1], []).append((t[0], p["birthYear"], pid))

    def is_ancestor(name, born):
        t = _toks(name)
        if len(t) < 2 or not born:
            return None
        for f, y, pid in ped.get(t[-1], []):
            if f == t[0] and abs(y - born) <= 2:
                return pid
        return None

    # ---- 4. missing names
    for k in KIN + KINWD:
        if not (k.get("name") or "").strip():
            nm = (k.get("notableLine") or [None])[0]
            if nm:
                L(k.get("fsId") or k.get("qid"), "name", k.get("name"), nm, "notable has no name; used the first name of the FamilySearch line")
                k["name"] = nm

    # ---- 3. duplicate FS ids in KIN: keep the closest path
    seen = {}
    keep = []
    for k in KIN:
        f = k.get("fsId")
        if f and f in seen:
            prev = seen[f]
            if (k["stepsSubject"] + k["stepsNotable"]) < (prev["stepsSubject"] + prev["stepsNotable"]):
                keep[keep.index(prev)] = k
                seen[f] = k
            L(f, "entry", k.get("name"), "removed duplicate", "same FamilySearch person listed more than once (multiple paths through a collapsed pedigree)")
            continue
        seen[f] = k
        keep.append(k)
    KIN[:] = keep

    # ---- 1 + 2. validate common ancestors against the current pedigree
    for src, lst in (("KIN", KIN), ("KINWD", KINWD)):
        for k in lst:
            ca = k.get("commonAncestor") or {}
            p = P.get(ca.get("id"))
            who = k.get("fsId") or k.get("qid") or k.get("name")
            if not p:
                continue
            g = _gen(p)
            lf = p.get("lineFlag")
            if lf or p.get("tier") == "flagged" or g is None:
                if g is None:
                    why = "the common ancestor %s is no longer in the pedigree (a parent link above them was rejected)" % ca.get("name")
                else:
                    why = "the line through %s is %s: %s" % (ca.get("name"), (lf or {}).get("verdict", "flagged").lower(), (lf or {}).get("reason", ""))
                old = k.get("relationship")
                if "(unsupported link)" not in old:
                    k["relationship"] = old + " (unsupported link)"
                k["linkConfidence"] = "UNSUPPORTED – " + why.rstrip(". ")
                L(who + " " + str(k.get("name")), "relationship", old, k["relationship"], "cousin relationship rests on a link research rejected: " + why)
            if g is not None and g != k.get("stepsSubject"):
                half = (k.get("relationship") or "").startswith("half ")
                old = k.get("relationship")
                new = _relationship(g, k["stepsNotable"], half)
                if lf or p.get("tier") == "flagged":
                    new += " (unsupported link)"
                L(who + " " + str(k.get("name")), "stepsSubject/relationship", [k["stepsSubject"], old], [g, new],
                  "steps were computed against an older pedigree; common ancestor %s is now %d generations up" % (ca.get("name"), g))
                k["stepsSubject"] = g
                k["relationship"] = new

    # ---- 5. KINWD notables who are our own ancestors
    out = []
    for k in KINWD:
        pid = is_ancestor(k.get("name"), k.get("born"))
        if pid:
            L(k.get("qid"), "entry", k.get("name"), "removed", "is our own ancestor %s (%s), not a cousin" % (P[pid].get("name"), pid))
            continue
        out.append(k)
    KINWD[:] = out

    # ---- 6. KIN vs KINWD duplicates by normalised (first, last, born)
    kin_keys = {}
    for k in KIN:
        t = _toks(k.get("name"))
        if len(t) >= 2 and k.get("born"):
            kin_keys[(t[0], t[-1], k["born"])] = k
    out = []
    for k in KINWD:
        t = _toks(k.get("name"))
        if len(t) >= 2 and k.get("born") and (t[0], t[-1], k["born"]) in kin_keys:
            L(k.get("qid"), "entry", k.get("name"), "removed", "same person already listed from FamilySearch as %r" % kin_keys[(t[0], t[-1], k["born"])].get("name"))
            continue
        out.append(k)
    KINWD[:] = out

    # ---- 7. descriptions
    for src, lst in (("KIN", KIN), ("KINWD", KINWD)):
        for k in lst:
            d = k.get("desc")
            if d is None:
                continue
            nd = _clean_desc(d)
            if nd != d:
                L(k.get("fsId") or k.get("qid"), "desc", d, nd, "junk in description (duplicated years / replacement char / years only)")
                k["desc"] = nd

    outp = ROOT / "research" / "qa" / "notables-fixes.json"
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    import collections
    c = collections.Counter(e["field"] for e in log)
    return "%d changes %s" % (len(log), dict(c))
