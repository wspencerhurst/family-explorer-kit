# Dead-end agents: instructions

You extend "dead ends": ancestors of the subject who are missing one or both parents in our database. Your batch file (`research/deadends/batch-NN.txt`) lists about 40 of them, each with id, dates, places, spouse, the child through whom they're our ancestor, which parent is missing, and prior notes. Generate batch files from `data/people.json`: post-1500, non-flagged pedigree people missing a parent, ordered by generation (closest first), 40 per file.

Read `research/SCHEMA.md` (output format, including `rejectLinks`) and `research/FS_RECORDS_BRIEF.md` (FamilySearch record helpers). Always pass tabId "seed" to the browser JavaScript tool, and use no other browser tool. Use WebSearch and WebFetch for everything else.

For each person, spend at most a few searches:
1. **FamilySearch records** (`__RS`, then `__REC` on promising hits): the person's marriage record (it often names both sets of parents), their death record (names parents after about 1853 in Virginia and after about 1900 in most other places), and any census household where they live with their parents. For a woman, the maiden name may come from a child's death certificate.
2. **FamilySearch Family Tree search** for the same person with parents attached (exists in FS but is not linked to us). Use `__TS`, or directly:
   `await (await fetch('https://www.familysearch.org/platform/tree/search?q.givenName=X&q.surname=Y&q.birthLikeDate=1790&count=5',{headers:{Accept:'application/x-gedcomx-atom+json',Authorization:'Bearer '+(document.cookie.match(/fssessionid=([^;]+)/)||[])[1]}})).json()`
   If you find a candidate, confirm it with the batch persons endpoint `/platform/tree/persons?pids=ID` (`display.familiesAsChild` gives parents, `display.familiesAsParent` gives children). Accept it only if a child matches our known child. Then record `"fsId"` on the person in your JSON, and the merge will pull in their ancestry.
3. **Web:** WikiTree (`api.wikitree.com` searchPerson/getAncestors), county histories, published genealogies, Find a Grave (search-result snippets only).

Record every parent you find as a person with a key, plus the father/mother link on the dead-end person (key = `fs-<FS id>` with `"fsId": "<FS id>"` for FS people, or the `R:` key without the `R:` prefix). Confidence:
- CONFIRMED: a record names the parent.
- PROBABLE: strong circumstantial evidence, or a good compiled source.
- UNVERIFIED: a tree only.
Cite everything. If you prove an existing link wrong, add it to rejectLinks.

Work through the whole batch with breadth over depth. Save your JSON and `.md` after every ~10 people. Output: `research/lines/deadend-NN.{md,json}` (task id `deadend-NN`). Final reply: under 120 words, giving how many dead ends you extended and the most important finds.

**Important:** Work through EVERY person in your batch before replying. Do at least 2 FS record searches per person (marriage, and death or a childhood census) and open promising hits with `__REC`. A light pass that extends nobody is not acceptable.

Scripted extenders (run by the coordinator, not agents): `python scripts/wikitree_extend.py` and `python scripts/dnatrees_extend.py` apply the same accept rule (name + birth year within 2 + a child that matches our known child) in bulk, over WikiTree and over the public trees of DNA matches. Run them before the agents so agents skip those people.

Model note: dead-end work on colonial-era people has a low yield. Use a few strong agents on the hardest cases rather than many weak ones. Small/fast models did very poorly on this task.
