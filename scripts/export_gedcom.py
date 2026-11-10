"""Export data/people.json + data/sources.json to data/<family>-ancestry.ged (GEDCOM 5.5.1).
Only persons connected to the subject (non-empty ahnentafel) are exported."""
import sys as _s; _s.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent)); from kitconfig import CFG, UA as KIT_UA, SLUG
import json, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
P = json.loads((ROOT / "data/people.json").read_text(encoding="utf-8"))
S = json.loads((ROOT / "data/sources.json").read_text(encoding="utf-8"))
people = {k: v for k, v in P.items() if v.get("ahnentafel")}
xref = {k: f"@I{i}@" for i, k in enumerate(sorted(people, key=lambda k: int(people[k]["ahnentafel"][0])), 1)}
sxref = {k: f"@S{i}@" for i, k in enumerate(S, 1)}

def clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()

def name_line(n):
    n = clean(n) or "Unknown"
    parts = n.rsplit(" ", 1)
    return f"{parts[0]} /{parts[1]}/" if len(parts) == 2 else f"{n} //"

out = ["0 HEAD", "1 SOUR FAMILY_EXPLORER_KIT", "1 GEDC", "2 VERS 5.5.1", "2 FORM LINEAGE-LINKED", "1 CHAR UTF-8"]
families = {}
for pid, p in people.items():
    f, m = p.get("father") if p.get("father") in people else None, p.get("mother") if p.get("mother") in people else None
    if f or m:
        families.setdefault((f, m), []).append(pid)
for pid, p in people.items():
    for s in p.get("spouses") or []:
        if s in people:
            key = (pid, s) if p.get("sex") != "F" else (s, pid)
            families.setdefault(key, [])
fxref = {k: f"@F{i}@" for i, k in enumerate(families, 1)}
famc, fams = {}, {}
for k, kids in families.items():
    for c in kids:
        famc.setdefault(c, []).append(fxref[k])
    for spouse in k:
        if spouse:
            fams.setdefault(spouse, []).append(fxref[k])

for pid, p in people.items():
    out += [f"0 {xref[pid]} INDI", f"1 NAME {name_line(p.get('name'))}"]
    if p.get("sex") in ("M", "F"): out.append(f"1 SEX {p['sex']}")
    for tag, key in (("BIRT", "birth"), ("CHR", "christening"), ("DEAT", "death"), ("BURI", "burial")):
        e = p.get(key)
        if e and (e.get("date") or e.get("place")):
            out.append(f"1 {tag}")
            if e.get("date"): out.append(f"2 DATE {clean(e['date'])}")
            if e.get("place"): out.append(f"2 PLAC {clean(e['place'])}")
    if p.get("occupation"): out.append(f"1 OCCU {clean(p['occupation'])}")
    if p.get("fsId"): out.append(f"1 _FSFTID {p['fsId']}")
    out.append(f"1 NOTE Confidence: {p.get('confidence')}; Ahnentafel: {', '.join(p['ahnentafel'][:5])}")
    if p.get("lineFlag"):
        out.append(f"1 NOTE Line flag: {p['lineFlag']['verdict']} (hangs from a {p['lineFlag']['verdict'].lower()} parent link: {clean(p['lineFlag'].get('reason'))})")
    for rel, f in (p.get("linkFlags") or {}).items():
        out.append(f"1 NOTE {rel.title()} link flagged {f['verdict']}: {clean(f.get('reason'))}")
    for task, note in (p.get("notes") or {}).items():
        out.append(f"1 NOTE [{task}] {clean(note)}")
    for s in p.get("sources") or []:
        if s in sxref: out.append(f"1 SOUR {sxref[s]}")
    out += [f"1 FAMC {fx}" for fx in famc.get(pid, [])]
    out += [f"1 FAMS {fx}" for fx in fams.get(pid, [])]
for k, fx in fxref.items():
    out.append(f"0 {fx} FAM")
    if k[0]: out.append(f"1 HUSB {xref[k[0]]}")
    if k[1]: out.append(f"1 WIFE {xref[k[1]]}")
    for c in families[k]: out.append(f"1 CHIL {xref[c]}")
for sid, s in S.items():
    out += [f"0 {sxref[sid]} SOUR", f"1 TITL {clean(s.get('title'))}"]
    if s.get("url"): out.append(f"1 NOTE {clean(s['url'])}")
    if s.get("detail"): out.append(f"1 PAGE {clean(s['detail'])}")
out.append("0 TRLR")
(ROOT / f"data/{SLUG}-ancestry.ged").write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"GEDCOM: {len(people)} individuals, {len(families)} families, {len(S)} sources")
