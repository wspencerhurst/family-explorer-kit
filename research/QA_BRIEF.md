# QA pass: errors in the ancestry data and how the site presents it

The family-history site (`site/`, React) is built from `data/people.json` etc. by `scripts/build_site_data.py` into `site/public/data/` (`core.json` columnar index; `details/NNN.json` per-person detail in chunks of 500, keyed by index; `notables.json`; `memorial.json`; `geo.json`; `consanguinity.json`; `stats.json`). The subject is Ahnentafel 1; ancestors have "ahnentafel" lists (generation = bit_length(min) - 1). The subject's id is the key of the Ahnentafel-1 person in `research/lines/core.json`, prefixed `R:`.

Your job: find ERRORS in the ancestry data and in what the site shows people (wrong, garbled, contradictory, misleading, or confusing facts, names, dates, places, relationships, labels, texts), work out WHY each class of error happens, and fix the cause and any related errors. Your prompt names one AREA (for example names, dates, places, relations, notables). Prioritise what a visitor sees most: generations 0-12 first, notable people, famous cousins, anything on the Overview/Discover pages. Then sample deeper generations for systematic problems.

## How to look
- Python against `data/people.json`, `data/media/index.json`, `data/places/geocode.json` and the built `site/public/data/*.json` (core.json fields: id, n (name), s (sex 1 M 2 F), b/d (birth/death year, 0 unknown), f/m (parent index), t (tier), c (confidence), g (generation), fl (flags), bp/dp (place index into places), lf (link flags), pt (portraits)).
- The site renders names via `site/src/store.ts` (displayName/splitName/years/relationLabel) and details via `site/src/panel/PersonPanel.tsx`; read those to understand presentation. You may also view the running site (`python site/serve.py` or `npm run dev`), but prefer reading data.
- Do NOT run `build_site_data.py`, `merge.py` or npm builds (other agents work in parallel); the coordinator rebuilds at the end.

## How to fix (so parallel agents don't collide)
1. Display/presentation fixes for the site data: write ONE module `scripts/site_fixes/<your_area>.py` with `def apply(ctx): ...; return "summary"` (see `scripts/site_fixes/__init__.py` for ctx). It may modify `ctx["P"]` person dicts in memory (e.g. clean a display name, drop a garbage place, correct an impossible estimated year, clear a wrong 'living' flag), `ctx["GEO"]` entries, `ctx["MEDIA"]`, notable lists, etc. Every change must be data-driven, minimal, and logged to `research/qa/<your_area>-fixes.json` (`{id, field, old, new, reason}`). Never delete people. Test it standalone: load the json files yourself, build a ctx, call apply, print the report and a few before/after examples.
2. Genuine genealogy errors (a wrong parent link, a duplicate person that should be merged): add them to `research/lines/qa-<your_area>.json` in the line-file schema (`research/SCHEMA.md`), using `"rejectLinks"` `[{child, rel: "father"|"mother", verdict: "REJECTED"|"UNSUPPORTED", reason}]` with evidence in the reason.
3. Front-end presentation bugs (wrong label text, formatting): you may edit ONLY the TypeScript file(s) assigned to you in your prompt, with small targeted edits, then run `cd site && npx tsc --noEmit` to type-check (no build).
4. Write `research/qa/<your_area>-report.md`: each error class found, how many, root cause, what you fixed, what remains.

Typical error classes seen in earlier projects (look for them first):
- BC dates read as AD; placeholder dates like "0000-00-00"; estimated birth years that contradict real neighbouring data; wide ranges ("abt 1700-1800") read as the first year.
- Garbled display names (stray punctuation, titles, "Unknown", FS suffix text); the same record in both parent slots; a parent whose sex contradicts the slot; cycles in the parent graph; "spouses" that are really parents or children.
- Place strings that are notes or sentences rather than places; geocodes that contradict a region word in the string (a Virginia place plotted in another state).
- Notable cousins whose common ancestor sits on a flagged line; duplicate notables from two sources; titles or one-word fragments used as descriptions.

Final reply under 150 words: error classes found, counts fixed, anything the coordinator must do.
