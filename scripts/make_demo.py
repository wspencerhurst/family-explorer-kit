"""Generate a FICTIONAL demo family so the whole pipeline and site can be tried before any real research.

  python scripts/make_demo.py            # writes demo inputs (refuses if real data is present)
  python scripts/merge.py && python scripts/build_summaries.py && python scripts/consanguinity.py && python scripts/build_site_data.py
  cd site && npm install && npm run dev

Writes data/raw/fs-tree-dump-demo.json (an FS-crawl-shaped tree, ~14 generations with some pedigree collapse)
and research/lines/core.json (the subject and parents). Delete both (python scripts/make_demo.py --clean) before real work.
Every person, place pairing and date here is invented.
"""
import json, pathlib, random, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DUMP = ROOT / "data/raw/fs-tree-dump-demo.json"
CORE = ROOT / "research/lines/core.json"

if "--clean" in sys.argv:
    for f in (DUMP, CORE):
        if f.exists(): f.unlink(); print("removed", f.relative_to(ROOT))
    sys.exit()
real = [f for f in (ROOT / "data/raw").glob("fs-tree-dump*.json") if f != DUMP]
if real or (CORE.exists() and "DEMO" not in CORE.read_text(encoding="utf-8")):
    sys.exit("Real data found (data/raw/fs-tree-dump*.json or research/lines/core.json); not overwriting it.")

rnd = random.Random(7)
MALE = "John William James Thomas George Henry Samuel Robert Charles Edward Joseph Richard Benjamin Daniel Peter Hugh Walter".split()
FEMALE = "Mary Elizabeth Sarah Anne Margaret Jane Catherine Martha Hannah Alice Susanna Eleanor Rebecca Agnes Frances Ruth Lydia".split()
SUR = ("Ambrel Barlow Carver Dunmore Ellery Fairweather Garrow Hollis Ingram Jessop Kettering Langdon Merrow Norbury Oakes "
       "Prescott Quarles Radley Sudwick Thorne Underhill Vance Wexley Yardley Ashwin Bramley Colby Denholm Everett Fenwick").split()
PLACES = {  # era -> places (real places, fictional people)
    "modern": ["Columbus, Franklin, Ohio, United States", "Richmond, Virginia, United States", "Atlanta, Fulton, Georgia, United States",
               "Nashville, Davidson, Tennessee, United States", "Philadelphia, Pennsylvania, United States"],
    "early": ["Lexington, Fayette, Kentucky, United States", "Charleston, South Carolina, United States", "Baltimore, Maryland, United States",
              "Raleigh, Wake, North Carolina, United States", "Boston, Suffolk, Massachusetts, United States"],
    "colonial": ["Williamsburg, James City, Virginia, British Colonial America", "Annapolis, Anne Arundel, Maryland, British Colonial America",
                 "New Haven, Connecticut, British Colonial America", "Germantown, Philadelphia, Pennsylvania, British Colonial America"],
    "old": ["Bristol, Gloucestershire, England", "Norwich, Norfolk, England", "Preston, Lancashire, England", "Edinburgh, Midlothian, Scotland",
            "Cork, County Cork, Ireland", "Cardiff, Glamorgan, Wales", "Rouen, Seine-Maritime, France", "Heidelberg, Baden, Germany"],
}
def place(y):
    era = "modern" if y > 1870 else "early" if y > 1780 else "colonial" if y > 1640 else "old"
    return rnd.choice(PLACES[era])

persons = {}
n = [0]
def new_id():
    n[0] += 1
    return f"DEMO-{n[0]:04d}"
def person(sex, by, sur):
    pid = new_id()
    given = rnd.choice(MALE if sex == "M" else FEMALE)
    dy = by + rnd.randint(35, 85)
    persons[pid] = {"name": f"{given} {sur}", "sex": "Male" if sex == "M" else "Female",
                    "b": {"date": str(by), "place": place(by)}, "d": {"date": str(dy), "place": place(dy)} if dy < 2025 else None,
                    "life": f"{by}-{dy if dy < 2025 else 'Living'}"}
    return pid

# grandparents (generation 2) are the crawl's anchors; the subject and parents come from core.json
anchors = {}
pool = []   # earlier people available for pedigree collapse
def build(pid, ahn, gen, sur):
    p = persons[pid]; by = int(p["b"]["date"])
    if gen >= 14 or (gen > 6 and rnd.random() < 0.06 * (gen - 6)):
        return
    fby = by - rnd.randint(24, 38); mby = by - rnd.randint(20, 32)
    # occasional pedigree collapse: reuse an existing person of the right sex and era
    reuse = [q for q in pool if abs(int(persons[q]["b"]["date"]) - fby) < 6 and persons[q]["sex"] == "Male"] if gen > 5 and rnd.random() < 0.04 else []
    if reuse:
        p["f"] = rnd.choice(reuse)
    else:
        p["f"] = person("M", fby, sur); pool.append(p["f"]); build(p["f"], ahn * 2, gen + 1, sur)
    msur = rnd.choice(SUR)
    p["m"] = person("F", mby, msur); pool.append(p["m"]); build(p["m"], ahn * 2 + 1, gen + 1, msur)

for ahn, sex, by, sur in ((4, "M", 1948, "Carver"), (5, "F", 1950, "Langdon"), (6, "M", 1946, "Prescott"), (7, "F", 1949, "Wexley")):
    pid = person(sex, by, sur); anchors[ahn] = pid
    build(pid, ahn, 2, sur)

DUMP.parent.mkdir(parents=True, exist_ok=True)
DUMP.write_text(json.dumps({"crawled": "demo", "persons": persons}), encoding="utf-8")
core = {"task": "core", "updated": "DEMO", "persons": [
    {"key": "demo-subject", "ahnentafel": [1], "name": "Alex Carver", "sex": "M", "living": True, "father": "demo-father", "mother": "demo-mother",
     "confidence": "CONFIRMED", "sources": [], "notes": "DEMO subject (fictional).", "birth": {"date": "2000", "place": "Columbus, Franklin, Ohio, United States"}},
    {"key": "demo-father", "ahnentafel": [2], "name": "Michael Carver", "sex": "M", "living": True, "fsId": None,
     "father": anchors[4], "mother": anchors[5], "spouses": ["demo-mother"], "confidence": "CONFIRMED", "sources": [], "birth": {"date": "1972", "place": "Richmond, Virginia, United States"}},
    {"key": "demo-mother", "ahnentafel": [3], "name": "Laura Prescott", "sex": "F", "living": True,
     "father": anchors[6], "mother": anchors[7], "spouses": ["demo-father"], "confidence": "CONFIRMED", "sources": [], "birth": {"date": "1974", "place": "Atlanta, Fulton, Georgia, United States"}},
]}
CORE.parent.mkdir(parents=True, exist_ok=True)
CORE.write_text(json.dumps(core, indent=1), encoding="utf-8")
print(f"demo family: {len(persons)} people in the tree; anchors {anchors}")
