# Research output schema

Each research task writes TWO files in `research/lines/`:

1. `<task>.md`: narrative findings. What was checked, reasoning, conflicts, dead ends, next steps.
2. `<task>.json`: structured data, merged into the master database later by `scripts/merge.py`.

All paths in this kit are relative to the project folder (`<project folder>`, the root of your clone).

## JSON format

```json
{
  "task": "smith-line-a",
  "updated": "2026-01-15",
  "persons": [
    {
      "key": "doe-john-1742",                      // stable slug: surname-given-birthyear (unique across ALL line files)
      "ahnentafel": [320],                         // subject = 1; parents of n are 2n, 2n+1. [] if not a direct ancestor / unknown
      "fsId": "XXXX-XXX",                          // FamilySearch tree ID if known
      "wikitreeId": null, "fagId": null,
      "name": "John Doe",
      "sex": "M",
      "birth": {"date": "1742", "place": "Example County, Virginia"},
      "death": {"date": "1782", "place": "..."},
      "burial": null,
      "father": "doe-james-1693",                  // key of father (or an FS id, or null)
      "mother": "roe-anne-1702",
      "spouses": ["roe-mary-1739"],
      "occupation": "planter; state senator",
      "confidence": "CONFIRMED | PROBABLE | UNVERIFIED | CONFLICT",
      "sources": ["S-doe-county-history-1893"],    // source ids (see below)
      "notable": "optional one-line reason this person is notable",
      "immigrant": null,                           // or {"year": "c.1633", "from": "England", "evidence": "..."}
      "notes": "short notes; conflicts with both versions"
    }
  ],
  "sources": [
    {"id": "S-doe-county-history-1893", "title": "Smith, History of Example County (1893)", "url": "https://...", "type": "compiled genealogy", "detail": "p. 45"}
  ],
  "legends": [ {"legend": "...", "verdict": "...", "basis": "..."} ],
  "notableKin": [ {"name": "...", "relation": "...", "via": "...", "confidence": "..."} ],
  "rejectLinks": [ {"child": "XXXX-XXX", "rel": "father", "verdict": "FABRICATED", "reason": "..."} ],
  "enslavedPeople": [ {"enslaver": "doe-john-1742", "name": "Harry", "description": "...", "place": "...", "year": 1790, "notes": "..."} ],
  "enslavedCounts": [ {"enslaver": "doe-john-1742", "year": 1850, "place": "...", "count": 27, "enumeratedAs": "...",
                       "confidence": "CONFIRMED", "note": "...", "url": "...", "persons": [["F", "42"], ["M", "18"]]} ]
}
```

(The `//` comments above are explanation only; real JSON has none.) Only `task`, `persons` and `sources` are required; the other top-level arrays are optional.

Rules:
- Confidence labels, as defined in the starting brief (`<family>-ancestry-research-brief.md`, section "Confidence labels"):
  - `CONFIRMED`: a primary or near-primary record (Bible record, census, vital or court record, will, parish register, lineage-society filing, or a scholarly compiled genealogy), or two independent sources.
  - `PROBABLE`: one good secondary source with consistent dates and names.
  - `UNVERIFIED`: user-submitted trees (FamilySearch Family Tree, Geni, Ancestry trees, Find a Grave family links, WikiTree without sources) or family tradition.
  - `CONFLICT`: sources disagree. Record both versions in `notes`.
- Cite every claim with a URL where possible. `CONFIRMED` and `PROBABLE` need real citations.
- Living relatives may be recorded with basic genealogical facts only (names, birth/marriage dates and places, relationships), and only if the project owner approved it. Set `"living": true` on them. No addresses, phone numbers, emails or other contact details, ever.
- Dates as written in the source: "12 Apr 1777", "c. 1720", "1695/99".
- `key` must be unique and stable. Other files refer to people by `key` (father/mother/spouses), by FS id, or with an `R:` prefix. `merge.py` writes `data/keymap.json` (key to final person id).
- The subject is Ahnentafel 1 and is written in `research/lines/core.json` (see PLAYBOOK step 1).

## Flagging bad links in the FamilySearch tree
If you find that a parent link in the FS tree is wrong, add a top-level `"rejectLinks"` array to your JSON:
`{"child": "<FS id or key of the child>", "rel": "father|mother", "verdict": "FABRICATED|UNSUPPORTED|REJECTED", "reason": "..."}`.
- `FABRICATED` / `REJECTED`: disproven.
- `UNSUPPORTED`: no evidence either way, or the evidence is too weak.

The merge keeps the link but flags everyone above it whose only route to the subject runs through a flagged link (`lineFlag`, `linkFlags`). To REPLACE a wrong parent, also give the child person with the correct `father`/`mother` key and confidence PROBABLE or better.
Project-wide corrections that do not belong to one research task go in `research/corrections.json` as `{"links": [ {child, rel, verdict, reason}, ... ]}`.

## Enslaved people (optional, handle with care)
If research finds that an ancestor enslaved people (wills, inventories, deeds, slave schedules), record them in `enslavedPeople` (named individuals) and `enslavedCounts` (census slave-schedule households). `enslaver` is the ancestor's `key` (or FS id). `build_summaries.py` collects these into `data/enslaved.json`, and the site shows them on a memorial page. Record only what the documents say, name people as the records name them, and never infer the ancestry of enslaved people.
