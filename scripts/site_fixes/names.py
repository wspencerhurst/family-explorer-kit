"""Display-name cleanup (QA area: names & titles).

Rewrites garbled or misleading display names in ctx["P"] (people.json dicts) in memory. The raw
data/people.json is never touched. Every change is logged to research/qa/names-fixes.json with the
rules that fired. Rules are conservative: nicknames in quotes or single-word parentheses are kept,
and peerage/title text is not stripped.
"""
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOG = ROOT / "research" / "qa" / "names-fixes.json"

ROMAN = r"(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XX)"
TITLE_WORDS = r"(?:Earl|Duke|Baron|Baroness|Lord|Viscount|Count|Countess|King|Queen|Prince|Princess|Bt|Baronet|Gov|Abbot|Bishop|Sheriff|Lady|Sir|Dame)"
NICK_RE = re.compile(r"^[A-Z][\w'’.\-/?]*(?:\s[A-Z][\w'’.\-]*)?$")  # short capitalised nickname / alt spelling
UNKNOWN_TOKENS = {"n", "?", "??", "???", "unknown"}
SUFFIX_RE = re.compile(rf"^(?:Jr|Sr|{ROMAN})\.?$")
PARTICLES = {"DE", "DU", "DI", "DA", "VAN", "VON", "LA", "LE", "DES", "DEL", "DER", "DEN", "TE", "TER", "ZU", "AF", "AP", "OF", "AND", "THE"}
FEMALE_GIVEN = {
    "mary", "ann", "anne", "elizabeth", "sarah", "margaret", "jane", "susan", "catherine", "katherine",
    "hannah", "martha", "alice", "joan", "eleanor", "agnes", "rebecca", "lucy", "judith", "frances",
    "mildred", "lydia", "ruth", "esther", "phebe", "phoebe", "dorothy", "elinor", "isabel", "isabella",
    "grace", "emma", "helen", "nancy", "betty", "bettie", "sally", "rachel", "rose", "amy", "ellen",
    "elisabeth", "charity", "priscilla", "mabel", "jean", "maud", "matilda", "amice", "beatrice",
}


def _dedupe(tokens):
    out = []
    for t in tokens:
        if out and out[-1].lower() == t.lower():
            continue
        out.append(t)
    return out


def _title_word(w):
    """Title-case one all-caps word, keeping Mc prefixes and particles readable."""
    if len(w) < 3 or not w.isupper() or SUFFIX_RE.match(w) or w in ("USA", "UK"):
        return w
    if w.startswith("MC") and len(w) > 2:
        return "Mc" + w[2:].capitalize()
    return w.capitalize()


def _caps_token(tok, first):
    m = re.fullmatch(r"([^A-Za-z]*)([A-Za-z][A-Za-z\-]*)([^A-Za-z]*)", tok)
    if not m:
        return tok
    pre, core, post = m.groups()
    if core.upper() == core and len(core.replace("-", "")) >= 2:
        if core.upper() in PARTICLES and not first and len(core) <= 3:
            core = core.lower()
        elif core.upper() == "MRS" or core.upper() == "MISS" or core.upper() == "MR":
            core = core.capitalize()
        elif "-" in core:
            core = "-".join(_title_word(p) for p in core.split("-"))
        else:
            core = _title_word(core)
    # doubled initial capital ("LLoyd")
    core = re.sub(r"^([A-Z])([A-Z])([a-z])", lambda mm: mm.group(1) + mm.group(2).lower() + mm.group(3), core)
    return pre + core + post


def clean(name):
    """Return (new_name, [rule ids that fired])."""
    s = name
    rules = []

    def sub(pat, rep, rule, flags=0):
        nonlocal s
        new = re.sub(pat, rep, s, flags=flags)
        if new != s:
            rules.append(rule)
            s = new

    # 1. whitespace, asterisk footnote markers, and stray spacing
    sub(r"\*+", " ", "footnote_star")
    sub(r"\s+", " ", "ws")
    s = s.strip()
    # 2. leftover list markers from source tables ("*E ", ".E ", "* ", ". ")
    sub(r"^[\*\.\"]+\s*E?\s+(?=\S)", "", "marker")
    sub(r"^[\*\.]\s*(?=[A-Za-z])", "", "marker")
    sub(r"[\s*]+$", "", "trailing_star")
    # 3. placeholder blanks and uncertainty brackets
    sub(r"\s*_{2,}\s*", " ", "blank")
    sub(r"\s*\[\s*\]\s*", " ", "blank")
    sub(r"\s*\[[^\]]*\?[^\]]*\]", "", "uncertain_bracket")
    # 4. alternate spellings separated by backslash
    sub(r"\s*\\+\s*", " / ", "backslash")
    # 5. FamilySearch alias notes, and unknown-part notes
    sub(r"\s*\(FS:.*\)\s*$", "", "fs_alias")
    if re.search(r"\(first name unknown\)", s, re.I):
        s = re.sub(r"\s*\(first name unknown\)", "", s, flags=re.I).strip()
        s = "Unknown " + s
        rules.append("first_name_unknown")
    sub(r"\s*\((?:surname|name|maiden name|given name|first and last name) unknown\)", "", "name_unknown_note", re.I)
    # 6. generational / suffix parentheticals become plain suffixes
    sub(r"\s*\((Sr|Jr)\.?\)", r" \1.", "paren_suffix")
    sub(rf"\s*\(({ROMAN})\)", r" \1", "paren_roman")
    # 7. dates and catalogue codes stuffed into names
    sub(r"\s*\((?=[^()]*(?:\d{3,4}|\bb\.|\bd\.|\bc\.|\bbc\b|\bBC\b))[^()]*\)", "", "date_paren")
    sub(r"\s+[A-Z]{2,}-\d+[A-Z]?$", "", "catalogue_code")
    # 7b. relationship notes written after the name ("Jane (Doe?) wife of John Roe")
    sub(r"\s+(?:wife|husband|widow|daughter|son) of .+$", "", "relation_note", re.I)
    # 7c. clerical titles in parentheses before the name ("(Rev) John Doe")
    sub(r"^\((Rev|Sir|Dr|Capt|Col|Lt|Gen|Maj)\.?\)\s*", r"\1. ", "leading_title_paren")
    # 8. "(or X)" alternates keep the text but lose the parentheses
    sub(r"\((or [^()]+)\)", r"\1", "paren_or")

    # 9. generic note parentheticals (wife of, immigrant, place notes) are dropped; short nicknames are kept
    def _note(m):
        inner = m.group(1).strip()
        if NICK_RE.match(inner):
            return m.group(0)
        if re.fullmatch(r"(?:Mrs\.?|Miss) .*", inner) or re.search(
                r"\b(of|wife|husband|son|dau|immigrant|progenitor|burgess|possible|later|London|Ireland|England|"
                r"Virginia|Scotland|alias|unknown|goldsmith|Bay|surname|first|Colonel|Duke|Earl|Heiress)\b",
                inner, re.I) or inner[:1].islower():
            rules.append("note_paren")
            return ""
        return m.group(0)
    s = re.sub(r"\s*\(([^()]*)\)", _note, s)
    # 10a. stray unmatched double quotes left by note removal
    if s.count('"') % 2:
        s = s.replace('"', "")
        rules.append("stray_quote")
    # 10. stray unmatched parentheses left by note removal
    if s.count("(") != s.count(")"):
        s = s.replace("(", " ").replace(")", " ")
        rules.append("stray_paren")
    # 11. quoted note (single quotes) around "of X"
    sub(r"'of ([^']+)'", r"of \1", "quoted_of_note")
    # 12. trailing ", Jr." / ", III" and comma spacing, stray trailing punctuation
    sub(rf",\s*(Jr|Sr)\.?\s*$", r" \1.", "suffix_comma")
    sub(rf",\s*({ROMAN})\s*$", r" \1", "suffix_comma")
    sub(r"\s*,\s*", ", ", "comma_space")
    sub(r"[\s,;:|/\-]+$", "", "trailing_punct")
    sub(r"^[\s,;:|\-]+", "", "leading_punct")
    sub(r",\s*later\s.*$", "", "later_note")
    s = s.strip()
    # 13. "Wife of X" / "Mrs. X Y" placeholders: the wife is unnamed in the record
    m = re.match(r"^(Wife|Widow|Husband) of (.+)$", s, re.I)
    if m:
        s = f"Unknown ({m.group(1).lower()} of {m.group(2).strip()})"
        rules.append("wife_of_placeholder")
    else:
        m = re.match(r"^Mrs\.?\s+(\S+(?:\s\S+)?)$", s, re.I)
        if m and "(" not in s:
            words = m.group(1).split()
            if words[0].lower() in FEMALE_GIVEN and len(words) == 2:
                s = m.group(1)  # "Mrs Mary Thomas": a normal married-name form, keep the given name
                rules.append("mrs_given_name")
            elif len(words) <= 2:
                s = f"Unknown (wife of {m.group(1)})"
                rules.append("mrs_placeholder")
    # 14. placeholder tokens -> Unknown; collapse runs of Unknown and duplicated words
    toks = s.split(" ")
    newtoks = ["Unknown" if (t.lower() in UNKNOWN_TOKENS) else t for t in toks]
    if newtoks != toks:
        rules.append("unknown_placeholder")
    toks = _dedupe(newtoks)
    if toks != newtoks:
        rules.append("duplicate_word")
    s = " ".join(toks)
    # 15. titles stuck at the end ("John Henry Doe Sir") move to the front
    m = re.match(r"^(.*?)[\s,]+(Sir|Lady|Lord|Baron|Baroness|Dame)$", s)
    if m and not re.search(r"\d|\sof\s|^(Mrs|Mr|Miss)\b", m.group(1)):
        rest, title = m.group(1).strip(), m.group(2)
        if rest.split(" ")[0] in ("Sir", "Lady", "Lord", "Baron", "Baroness", "Dame"):
            s = rest
        else:
            s = f"{title} {rest}"
        rules.append("title_moved_front")
    # 16. ALL-CAPS surnames, particles, and "LLoyd"-style doubled capitals
    toks = s.split(" ")
    newtoks = [_caps_token(t, i == 0) for i, t in enumerate(toks)]
    if newtoks != toks:
        rules.append("caps_or_doubled")
    s = " ".join(newtoks)
    # 17. place stuffed onto the end of a plain name ("John Doe of Example Farm")
    m = None if "(" in s else re.match(r"^(.+?)\s+of\s+([A-Z][^\d,]*)$", s)
    if m:
        pre, post = m.group(1), m.group(2)
        if (len(pre.split(" ")) >= 2 and len(post.split(" ")) <= 2
                and not re.search(rf"\b{TITLE_WORDS}\b|\d|,|\bof$|\bde$|\bthe$|\band$", pre)
                and not re.search(r"\bof\b|\bde\b", post)):
            s = pre
            rules.append("place_suffix")
    s = re.sub(r"\s+", " ", s.replace("*", " ")).strip(" ,;:")
    if not s or re.fullmatch(r"[\s.\-,]*", s):
        s = "Unknown"
        rules.append("empty_unknown")
    return s, rules


def apply(ctx):
    P = ctx["P"]
    log = []
    counts = {}
    for pid, p in P.items():
        old = p.get("name")
        if not isinstance(old, str) or not old:
            continue
        new, rules = clean(old)
        if new == old:
            continue
        p["name"] = new
        for r in rules:
            counts[r] = counts.get(r, 0) + 1
        log.append({"id": pid, "field": "name", "old": old, "new": new, "reason": ",".join(sorted(set(rules)))})
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
    top = ", ".join(f"{k}={v}" for k, v in sorted(counts.items(), key=lambda kv: -kv[1]))
    return f"{len(log)} names cleaned ({top})"
