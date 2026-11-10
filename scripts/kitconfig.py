"""Shared settings from family.config.json (repo root). Import: from kitconfig import CFG, UA"""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / "family.config.json").read_text(encoding="utf-8"))
UA = CFG.get("userAgent") or "FamilyExplorerKit/1.0 (personal genealogy research)"
SLUG = "".join(c for c in (CFG.get("familyName") or "family").lower() if c.isalnum()) or "family"
