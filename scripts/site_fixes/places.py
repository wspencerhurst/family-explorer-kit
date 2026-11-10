"""QA fixes for places and the map (area: places).

1. Display place strings in ctx["P"] (birth/death/burial/christening) and ctx["MEDIA"] facts that are not places
   (notes such as "(inferred; ...)", "Burial Details Unknown", URLs, sentences, bare years, "?") are dropped, and
   trailing source/uncertainty notes are stripped from real places ("Guilford Co., NC (FS)" -> "Guilford Co., NC").
   A cleaned string inherits the geocode of the original string.
2. ctx["GEO"] entries whose geocoded point contradicts an explicit region word in the string (a Virginia place placed
   in Massachusetts, an English parish placed in Pennsylvania, "Virginia Colony" matched to a street in California) are
   re-geocoded from data/places/geocode-qa.json (a Nominatim pass with corrected queries) or removed.
   Entries matched only to a state/country-level result for a more specific string are marked exact=False.
Every change is logged to research/qa/places-fixes.json ({id, field, old, new, reason}; id None for geocode changes).
"""
import json, pathlib, re, unicodedata, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[2]
QA_CACHE = ROOT / "data/places/geocode-qa.json"
LOG = ROOT / "research/qa/places-fixes.json"

# ---------- 1. place strings ----------
NOTE_WORDS = re.compile(r"inferred|tradition|probable|probably|possibl|uncertain|unknown|unsupported|unproven|\bper\b|\bFS\b|\bSAR\b|find a grave|census|\bindex\b|\bbur\.|bapt\.|some sources|speculat|\bsee\b|memorial|\bsays\b|\bnow:|\bthen:|historical|\bnote\b|\bcompiled\b|\bgenealog|\btree\b|\?|\bDQ\b|\bsubject\b", re.I)
NOTE_ONLY = {"uncertain", "unknown", "probable", "possibly", "tradition", "unproven", "disputed", "unsupported", "tree only", "quaker", "osp", "of", "questionable"}


def clean(s):
    """Return (cleaned_or_None, reason_or_None). None means the value is not a place and is dropped."""
    if s is None or not isinstance(s, str):
        return s, None
    orig = s
    t = urllib.parse.unquote_plus(s) if "%" in s else s
    t = re.sub(r"\s+", " ", t).strip(" ,;")
    if not t:
        return None, "empty"
    if re.search(r"https?://|www\.", t):
        return None, "url"
    if re.fullmatch(r"[\W\d_]*", t) or re.fullmatch(r"\d{3,4}", t) or re.fullmatch(
            r"\?+\s*:?|xx|d|En|Sp|Chy|WASHI|wft \d+|Questionable|Of This Parish|Of,*\s*Wales|of,*\s*Wales", t, re.I):
        return None, "junk"
    if len(t) <= 2 and not re.fullmatch(r"[A-Z]{2}", t):
        return None, "junk"
    m = re.match(r"^Burial Details Unknown\.? Specifically:\s*(.*)$", t, re.I)
    if m:
        rest = re.split(r"\s+-\s+", m.group(1))[0].strip(" .")
        if re.search(r"possibl|buried|killed|memorial|\bwould\b|\bmost\b", rest, re.I) or len(rest) < 3:
            return None, "junk-burial"
        c, _ = clean(rest)
        return (c, "burial-specific") if c else (None, "junk-burial")
    m = re.match(r"^(unknown|burial details unknown|detail unknown|christening details unknown)\b[ ,;:]*(cemetery|churchyard|burial)?[ ,;:]*", t, re.I)
    if m:
        rest = t[m.end():].strip(" ,")
        if not rest or (re.search(r"\b1[5-9]\d\d\b|\bby\b", rest) and "," not in rest):
            return None, "junk-unknown"
        t = rest
        if rest.lower() in NOTE_ONLY:
            return None, "junk"
    t = re.sub(r"^FS:\s*", "", t)
    t = re.sub(r"^\d{4}\s+", "", t)
    t = re.sub(r"^VERIFIED-\s*", "", t)
    m = re.match(r"^Find A Grave #\s*\d+\s*-\s*(.*)$", t, re.I)
    if m and " - " in m.group(1):
        t = m.group(1).split(" - ")[-1].strip(" ,")
        if "," not in t:
            return None, "junk"
        return t, "findagrave-prefix-trimmed"
    SENT = (r"\b(was|were|is not|did not|according to|purely speculative|SEE NOTE|commanded|killed in|killed|conquered|"
            r"descendant in|after the death|created \(|requested that|nothing is|stone coffin|requested|listed as|granted|"
            r"inherited|who|which|sold|died)\b")
    bare = re.sub(r"\([^()]*\)", "", t)  # sentence words inside a parenthetical do not make the value a note
    if len(t) > 160 or re.search(SENT, bare, re.I):
        m2 = re.split(r"\s+-\s*(?=[A-Z])", t)
        if len(m2) > 1 and m2[0].count(",") >= 1 and not re.search(r"\b(was|killed|according)\b", m2[0], re.I):
            return m2[0].strip(" -,"), "sentence-trimmed"
        m3 = re.match(r"^Killed (?:in|at|on|during)\b\s*(?:the\s+|a\s+)?(?:battle|attack|siege)?\s*(?:of\s+|at\s+|on\s+)?(?:the\s+)?(.*)$", t, re.I)
        if m3 and "," in m3.group(1) and not re.search(SENT, m3.group(1), re.I):
            return m3.group(1).strip(" ,"), "killed-prefix-trimmed"
        if re.search(SENT, bare, re.I) or "," not in bare:
            return None, "sentence"
        t = bare.strip(" ,")  # the place part of a sentence-with-parenthetical, e.g. "Branxton, Northumberland, England (killed ...)"
    parens = re.findall(r"\(([^()]*)\)", t)
    reason = None
    if parens:
        base = re.sub(r"\s+", " ", re.sub(r"\([^()]*\)", "", t)).strip(" ,")
        if not base:
            return None, "junk"
        for p in parens:
            if NOTE_WORDS.search(p) or base.count(",") >= 1 or len(base) > 3:
                t = t.replace("(" + p + ")", "")
                reason = "paren-stripped"
        t = re.sub(r"\s+", " ", t).strip(" ,")
        t = re.sub(r"\s+,", ",", t)
        t = re.sub(r",\s*,+", ",", t).strip(" ,")
    t = re.sub(r";\s*(FS|per|but)\b.*$", "", t).strip(" ,")
    if t.count("(") and not t.count(")"):
        t = re.sub(r"\s*\((.*)$", "", t)
    t = t.strip(" ,")
    if not t or t.lower() in NOTE_ONLY or (t.startswith("(") and t.endswith(")")):
        return None, "junk"
    if re.fullmatch(r"\d{3,4}", t):
        return None, "junk"
    if t != orig and reason is None:
        reason = "normalised"
    return t, reason


# ---------- 2. geocode plausibility ----------
US_STATES = ["Virginia", "Maryland", "North Carolina", "South Carolina", "Georgia", "Pennsylvania", "New Jersey", "New York",
             "Massachusetts", "Connecticut", "Delaware", "Kentucky", "Tennessee", "Alabama", "Rhode Island", "New Hampshire",
             "Vermont", "Maine", "Ohio", "Indiana", "Illinois", "Missouri", "Mississippi", "Louisiana", "Texas", "Arkansas",
             "Michigan", "Wisconsin", "Iowa", "Kansas", "Nebraska", "Minnesota", "California", "Oregon", "West Virginia", "Florida"]
# rough lon0, lon1, lat0, lat1 boxes for countries/regions named in place strings
BOX = {"england": (-6, 2, 49.8, 55.9), "scotland": (-7.8, -0.6, 54.6, 61), "wales": (-5.4, -2.6, 51.3, 53.5),
       "ireland": (-10.6, -5.3, 51.4, 55.4), "france": (-5.2, 9.7, 42.2, 51.2), "germany": (5.8, 15.1, 47.2, 55.1),
       "netherlands": (3.3, 7.3, 50.7, 53.6), "belgium": (2.5, 6.5, 49.4, 51.6), "italy": (6.6, 18.6, 36.6, 47.1),
       "spain": (-9.4, 4.4, 36, 43.8), "sweden": (11, 24.2, 55.3, 69.1), "norway": (4.5, 31, 57.9, 71.2),
       "denmark": (8, 15.2, 54.5, 57.8), "switzerland": (5.9, 10.5, 45.8, 47.8), "egypt": (24.6, 35, 21.9, 31.7),
       "israel": (34.2, 35.9, 29.4, 33.4), "iraq": (38.7, 48.6, 29, 37.4), "china": (73, 135, 18, 53.6)}
ALIAS = {"germany": ["deutschland", "germany"], "netherlands": ["nederland", "netherlands", "holland"], "france": ["france"],
         "italy": ["italia", "italy"], "spain": ["españa", "spain", "espana"],
         "belgium": ["belgique", "belgien", "belgië", "belgie", "belgium"], "denmark": ["danmark", "denmark"],
         "sweden": ["sverige", "sweden"], "norway": ["norge", "norway"],
         "switzerland": ["schweiz", "suisse", "svizzera", "switzerland"], "egypt": ["egypt", "مصر", "egipto"],
         "israel": ["israel"], "iraq": ["iraq", "العراق"], "china": ["china", "中国"], "england": ["england"],
         "scotland": ["scotland", "alba"], "wales": ["wales", "cymru"], "ireland": ["ireland", "éire", "eire"]}
COLONIAL = re.compile(r"\b(british colonial america|pre-british colonial america|british colonial|british america|"
                      r"british colony|colonial america|american colonies|bca|colony of virginia|colony of|"
                      r"virginia colony|colony|british province|province of)\b\.?", re.I)


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def key_norm(s):
    """the string with colonial-era labels removed; used only for the plausibility test"""
    t = COLONIAL.sub("", s)
    t = re.sub(r"\bVirginia Colony\b", "Virginia", t)
    t = re.sub(r"\s+", " ", t).strip(" ,")
    return re.sub(r",\s*,", ",", t)


def region_problems(s, g):
    """Reasons (empty = consistent) why geocode g contradicts region words in string s."""
    reasons = []
    parts = [norm(p.strip(" ()")) for p in re.split(r"[,()]", key_norm(s)) if p.strip(" ()")]
    comps = [norm(c.strip()) for c in g["display"].split(",")]
    # a named non-US country (e.g. "Mayenne, Maine, France") means a US state word is not the region
    foreign = any(p in ALIAS[k] for k in BOX for p in parts[1:])
    for st in US_STATES:
        ns = norm(st)
        if foreign:
            break
        if ns in parts[1:] or (parts and parts[-1] == ns):
            if not (comps and comps[0] == ns) and ns not in comps[1:]:
                reasons.append("US state " + st + " not in result")
    for k, b in BOX.items():
        if any(p in ALIAS[k] for p in parts[1:]) or (parts and parts[-1] in ALIAS[k]) or (len(parts) == 1 and parts[0] in ALIAS[k]):
            if not (b[0] <= g["lon"] <= b[1] and b[2] <= g["lat"] <= b[3]):
                reasons.append("region " + k + " point outside")
    return reasons


def coarse(s, g):
    """True if the string names a place and the geocode is only a state/country-level result."""
    ks = key_norm(s).split(",")
    if len(ks) < 2:
        return False
    comps = [norm(c.strip()) for c in g["display"].split(",")]
    first = norm(ks[0].strip())
    return len(comps) <= 2 and first not in comps


# ---------- apply ----------
def apply(ctx):
    P, GEO, MEDIA = ctx["P"], ctx["GEO"], ctx["MEDIA"]
    log = []
    qa = json.loads(QA_CACHE.read_text(encoding="utf-8")) if QA_CACHE.exists() else {}
    mapping = {}

    def fix(pid, field, old, new, why, holder):
        log.append({"id": pid, "field": field, "old": old, "new": new, "reason": why})
        holder["place"] = new

    for pid, p in P.items():
        for k in ("birth", "death", "burial", "christening"):
            e = p.get(k)
            if isinstance(e, dict) and isinstance(e.get("place"), str):
                old = e["place"]
                new, why = clean(old)
                if new != old:
                    mapping.setdefault(old, new)
                    fix(pid, k + ".place", old, new, why or "not-a-place", e)
    for pid, m in MEDIA.items():
        for i, f in enumerate(m.get("facts") or []):
            if isinstance(f.get("place"), str):
                old = f["place"]
                new, why = clean(old)
                if new != old:
                    mapping.setdefault(old, new)
                    fix(pid, "facts[%d].place" % i, old, new, why or "not-a-place", f)

    # a cleaned string inherits the geocode of its original string
    for old, new in mapping.items():
        if new and new not in GEO and old in GEO:
            GEO[new] = GEO[old]
            log.append({"id": None, "field": "GEO[%s]" % new, "old": None, "new": "geocode copied from " + old,
                        "reason": "cleaned string inherits geocode"})

    # corrected strings that were never geocoded before (cleaned forms) get the reviewed geocode
    for K, q in qa.items():
        if K not in GEO and q.get("lat") is not None and not q.get("override"):
            GEO[K] = {"lat": q["lat"], "lon": q["lon"], "display": q["display"], "matched": q["matched"], "exact": False}
            log.append({"id": None, "field": "GEO[%s]" % K, "old": None,
                        "new": {"display": q["display"], "lat": round(q["lat"], 4), "lon": round(q["lon"], 4), "query": q["matched"]},
                        "reason": "corrected string geocoded (Nominatim, reviewed)"})

    for K in list(GEO.keys()):
        g = GEO[K]
        if not g:
            continue
        q = qa.get(K) or {}
        if q.get("override"):
            # a reviewed decision for a string that no region word can catch (e.g. bare "Jersey")
            if q.get("lat") is not None:
                GEO[K] = {"lat": q["lat"], "lon": q["lon"], "display": q["display"], "matched": q["matched"], "exact": False}
                log.append({"id": None, "field": "GEO[%s]" % K, "old": {"display": g["display"], "lat": round(g["lat"], 4), "lon": round(g["lon"], 4)},
                            "new": {"display": q["display"], "lat": round(q["lat"], 4), "lon": round(q["lon"], 4), "query": q["matched"]},
                            "reason": q.get("note", "reviewed override")})
            else:
                del GEO[K]
                log.append({"id": None, "field": "GEO[%s]" % K, "old": {"display": g["display"]}, "new": None, "reason": q.get("note", "reviewed override: no point")})
            continue
        why = region_problems(K, g)
        if why:
            old = {"display": g["display"], "lat": round(g["lat"], 4), "lon": round(g["lon"], 4)}
            q = qa.get(K)
            if q and q.get("lat") is not None:
                GEO[K] = {"lat": q["lat"], "lon": q["lon"], "display": q["display"], "matched": q["matched"], "exact": bool(q.get("exact"))}
                log.append({"id": None, "field": "GEO[%s]" % K, "old": old,
                            "new": {"display": q["display"], "lat": round(q["lat"], 4), "lon": round(q["lon"], 4), "query": q["matched"]},
                            "reason": "; ".join(why) + " -> re-geocoded with corrected query"})
            else:
                del GEO[K]
                log.append({"id": None, "field": "GEO[%s]" % K, "old": old, "new": None,
                            "reason": "; ".join(why) + " -> point removed (no corrected geocode)"})
            continue
        if g.get("exact") and coarse(K, g):
            g["exact"] = False
            log.append({"id": None, "field": "GEO[%s].exact" % K, "old": True, "new": False,
                        "reason": "only a state/country-level result (%s) for a more specific string" % g["display"][:80]})

    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, ensure_ascii=False, indent=0), encoding="utf-8")
    n_ev = sum(1 for x in log if x["id"] is not None)
    n_geo = sum(1 for x in log if x["id"] is None)
    return "%d place values cleaned or dropped; %d geocode changes (research/qa/places-fixes.json)" % (n_ev, n_geo)
