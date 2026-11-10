"""Presentation/data fixes applied by build_site_data.py before the site data is written.

Each module here defines `apply(ctx)` where ctx is a dict with:
  P      people.json dict (id -> person)  - mutate display fields here (do NOT edit data/people.json)
  GEO    geocode.json dict (place string -> {lat, lon, display, matched, exact})
  MEDIA  media index dict (id -> {portrait, photos, bios, facts, ...})
  KIN    notable-kin.json list;  KINWD  notable-kin-wd.json list
  SUM    summary.json dict;  ENSL  enslaved.json dict
and returns a short report string. Modules run in alphabetical order. Keep every fix data-driven and
logged (e.g. research/qa/<area>-fixes.json) so it is auditable.
"""
import importlib, pathlib

def run_all(ctx):
    reports = []
    for f in sorted(pathlib.Path(__file__).parent.glob("*.py")):
        if f.name.startswith("_"): continue
        mod = importlib.import_module(f"site_fixes.{f.stem}")
        if hasattr(mod, "apply"):
            reports.append(f"{f.stem}: {mod.apply(ctx)}")
    return reports
