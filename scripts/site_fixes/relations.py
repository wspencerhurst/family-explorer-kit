"""QA area `relations`: presentation-level cleanup of impossible/garbled parent and spouse links.

Never deletes people.  Every edit is logged to research/qa/relations-fixes.json.
Classes handled (all data-driven, no per-person lists):
  1. father == mother (same record in both slots)            -> keep it in the slot matching its sex
  2. parent sex contradicts slot (father F / mother M)        -> fix the sex when the given name is clearly of the slot's sex,
                                                                  otherwise move to the empty slot, otherwise drop that link
  3. parent record is a duplicate of the child (same name, born within 12y after/before)  -> drop link
  4. a "parent" who is really the person's spouse (co-parent of the person's own child)    -> drop the implausible link
  5. cycles / self-loops in the parent graph (person recorded as own ancestor)             -> drop the back edge
  6. spouses lists: self, merged duplicates, repeated entries, own parents/children        -> removed
"""
import json, pathlib, re, collections

ROOT = pathlib.Path(__file__).resolve().parents[2]

MALE = set("""ascelin guislain llywelyn william john robert richard thomas henry walter roger geoffrey gilbert hugh ralph
baldwin bernard guillaume guy raoul ranulf roland osbert odo alan stephen simon nicholas peter philip humphrey
gauthier baudouin eustace fulk gerard gervase herbert hamo ivo jordan lambert maurice miles payn reginald reynold
rainald rainer theobald thurstan turold wulfric aelfric eadric ordgar edward edmund edgar harold ivar
cairthinn blat cas snaer kari erchinoald auguste adam andrew david george james joseph charles""".split())
FEMALE = set("""alice agnes maud maude matilda mabel margaret margred margery isabel isabella isabelle adelisa adelicia adeliza
avicia amicie sibyl sibylle sybil hawise bertrade elisabeth elizabeth eleanor emma joan joanna joane juliana lucy
beatrice cecily constance edith ela emmeline gundred hadewise helen helena lora marie mary muriel petronilla
rohese rose sarah susannah ursula cunigunde ermengarde ermentrude gunnor gerberga gersende ragnhilde""".split())


def _tok(name):
    n = re.sub(r"\(.*?\)|\"[^\"]*\"", " ", name or "")
    n = re.sub(r"^(sir|lady|dame|mrs\.?|mr\.?|dr\.?|king|queen|saint|st\.?|baroness|baron|lord|countess|count|princess|prince)\s+", "", n.strip(), flags=re.I)
    t = re.split(r"[\s,]+", n.strip().lower())
    return t[0] if t and t[0] else ""


def _norm(n):
    n = re.sub(r"\(.*?\)|\"[^\"]*\"", "", (n or "").lower())
    return " ".join(re.sub(r"[^a-z ]", "", n).split())


def apply(ctx):
    P = ctx["P"]
    log = []

    def L(i, field, old, new, reason):
        log.append({"id": i, "field": field, "old": old, "new": new, "reason": reason})

    S = [i for i, p in P.items() if (p.get("ahnentafel") or p.get("altOf")) and not p.get("mergedInto")]
    SS = set(S)

    def gen(p):
        a = p.get("ahnentafel") or []
        return min(int(x) for x in a).bit_length() - 1 if a else 10 ** 6
    S.sort(key=lambda i: gen(P[i]))

    # 1+2. parent slots
    for i in S:
        p = P[i]
        f, m = p.get("father"), p.get("mother")
        if f and f == m:
            q = P.get(f, {})
            sx = (q.get("sex") or "")[:1]
            drop = "father" if sx == "F" else "mother" if sx == "M" else None
            if drop is None:
                drop = "father" if _tok(q.get("name")) in FEMALE else "mother"
            L(i, drop, f, None, "same record %s recorded as both father and mother; kept in the slot matching its sex" % f)
            p[drop] = None
        for rel, want, other in (("father", "M", "mother"), ("mother", "F", "father")):
            q = P.get(p.get(rel) or "")
            if not q:
                continue
            sx = (q.get("sex") or "")[:1]
            if not sx or sx == want:
                continue
            tk = _tok(q.get("name"))
            if tk in (MALE if want == "M" else FEMALE) and tk not in (FEMALE if want == "M" else MALE):
                L(q["id"], "sex", q.get("sex"), "M" if want == "M" else "F",
                  "listed as %s of %s and given name '%s' is of that sex; recorded sex looks wrong" % (rel, i, tk))
                q["sex"] = "M" if want == "M" else "F"
            elif not p.get(other):
                L(i, rel, q["id"], None, "%s record is %s; moved to the empty %s slot" % (rel, q.get("sex"), other))
                p[other] = q["id"]
                p[rel] = None
            else:
                L(i, rel, q["id"], None, "%s record '%s' has sex %s; link dropped" % (rel, q.get("name"), q.get("sex")))
                p[rel] = None

    # 3. duplicate-of-child recorded as parent
    for i in S:
        p = P[i]
        for rel in ("father", "mother"):
            q = P.get(p.get(rel) or "")
            if q and _norm(q.get("name")) == _norm(p.get("name")) and p.get("birthYear") and q.get("birthYear") \
                    and -12 < p["birthYear"] - q["birthYear"] < 12 and _norm(p.get("name")).count(" ") >= 1:
                L(i, rel, q["id"], None, "parent record is a same-name duplicate of the person (born %s vs %s)" % (q["birthYear"], p["birthYear"]))
                p[rel] = None

    # 4. spouse recorded as parent
    def plaus(cb, pb, rel):
        if not cb or not pb:
            return True
        return 14 <= cb - pb <= (70 if rel == "father" else 50)
    for c in S:
        C_ = P[c]
        f, m = C_.get("father"), C_.get("mother")
        if not f or not m or f not in P or m not in P:
            continue
        for x, q, rx in ((f, m, "mother"), (m, f, "father")):
            X, Q = P[x], P[q]
            for rel in ("father", "mother"):
                if X.get(rel) != q:
                    continue
                if any(v.get("birthYearEst") for v in (X, Q, C_)):
                    continue
                p1 = plaus(X.get("birthYear"), Q.get("birthYear"), rel)
                p2 = plaus(C_.get("birthYear"), Q.get("birthYear"), rx)
                if p1 and not p2:
                    L(c, rx, q, None, "%s (b.%s) is the spouse of %s and co-parent of %s, but is also %s's %s; the age gap to %s is impossible, so this child link was dropped"
                      % (Q.get("name"), Q.get("birthYear"), X.get("name"), C_.get("name"), X.get("name"), rel, C_.get("name")))
                    C_[rx] = None
                else:
                    L(x, rel, q, None, "%s is the spouse of %s (co-parent of %s) yet also recorded as their %s (b.%s vs %s); the parent link was dropped"
                      % (Q.get("name"), X.get("name"), C_.get("name"), rel, Q.get("birthYear"), X.get("birthYear")))
                    X[rel] = None
                break

    # 4b. parent born after the child (or spouse with impossible age gap): link dropped
    for c in S:
        X = P[c]
        for rel in ("father", "mother"):
            q = X.get(rel)
            Q = P.get(q or "")
            if not Q or X.get("birthYearEst") or Q.get("birthYearEst"):
                continue
            if not X.get("birthYear") or not Q.get("birthYear"):
                continue
            spouse = q in (X.get("spouses") or []) or c in (Q.get("spouses") or [])
            if (X["birthYear"] - Q["birthYear"] <= -8 and gen(X) <= 12) or (spouse and not plaus(X["birthYear"], Q["birthYear"], rel)):
                L(c, rel, q, None, "%s (b.%s) %sis impossible as the %s of %s (b.%s: parent born after child%s); parent link dropped"
                  % (Q.get("name"), Q.get("birthYear"), "is also listed as their spouse and " if spouse else "", rel, X.get("name"), X.get("birthYear"), "" if X["birthYear"] - Q["birthYear"] < 0 else "/age gap"))
                X[rel] = None

    # 5. cycles
    for _ in range(6):
        color, back = {}, []

        def pars(i):
            return [(r, P[i][r]) for r in ("father", "mother") if P[i].get(r) in SS]
        for r0 in S:
            if r0 in color:
                continue
            color[r0] = 1
            path = [r0]
            stack = [iter(pars(r0))]
            while stack:
                n = path[-1]
                for rel, x in stack[-1]:
                    if color.get(x) == 1:
                        back.append((n, rel, x))
                        continue
                    if x not in color:
                        color[x] = 1
                        path.append(x)
                        stack.append(iter(pars(x)))
                        break
                else:
                    color[n] = 2
                    path.pop()
                    stack.pop()
        if not back:
            break
        for n, rel, x in back:
            if P[n].get(rel) == x:
                L(n, rel, x, None, "cycle/self-loop: %s would be their own ancestor; back edge dropped" % P[x].get("name"))
                P[n][rel] = None

    # 6. spouses
    kids_of = collections.defaultdict(set)
    for c in S:
        for r in ("father", "mother"):
            if P[c].get(r):
                kids_of[P[c][r]].add(c)
    for i in S:
        p = P[i]
        sp = p.get("spouses")
        if not sp:
            continue
        par = {p.get("father"), p.get("mother")}
        new = []
        for s in sp:
            t = P.get(s, {}).get("mergedInto") or s
            if t == i or t in new or t in par or t in kids_of[i]:
                continue
            new.append(t)
        if new != sp:
            L(i, "spouses", sp, new, "removed self / merged-duplicate / repeated / own parent-or-child spouse entries")
            p["spouses"] = new or None

    out = ROOT / "research/qa/relations-fixes.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    c = collections.Counter(("sex" if e["field"] == "sex" else "spouses" if e["field"] == "spouses" else "link") for e in log)
    return "%d edits (%s)" % (len(log), ", ".join("%s=%d" % kv for kv in c.most_common(8)))
