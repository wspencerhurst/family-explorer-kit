# Branch verification agents: instructions

Read `research/AGENT_BRIEF.md` and `research/SCHEMA.md` first, including the `rejectLinks` section at the end of SCHEMA.md.

Your input is `research/claims/branch-<n>.txt` (written by `python scripts/branch_claims.py <n> ...`). It lists every ancestor the merged database holds in generations 6-13 of your branch, with FS id, dates, current confidence, any line flag, and the origin (`fs-tree` alone means only the FamilySearch user tree supports it). Before you start, also read the `research/lines/*.md` files listed in your prompt, so you don't redo finished work.

Goal: go through the branch generation by generation, from the bottom (generation 6) upward. For every person whose origin is only `fs-tree`:
1. Check the claimed parent-child link against independent evidence, in this order of preference:
   - wills, deeds, court and order books, tax lists, parish registers and Bible records, as printed or abstracted in published works;
   - scholarly compiled genealogies and journals for the region (for example VMHB, WMQ and Tyler's Quarterly for Virginia, NEHGR for New England, county histories, standard compiled family works);
   - FamilySearch indexed records via the `__RS`/`__REC` helpers (see `research/FS_RECORDS_BRIEF.md`);
   - well-sourced WikiTree profiles (WikiTree API: `https://api.wikitree.com/api.php?action=getProfile&key=<ID>&fields=*&bioFormat=text&appId=<wikitreeAppId from family.config.json>`).
2. Record each person you assess in your JSON, with fsId, ahnentafel, confidence and sources. CONFIRMED and PROBABLE need real citations.
3. If a link is wrong or unsupported, add it to `rejectLinks` with a reason. Common FS-tree problems: invented parents, merged namesakes, impossible dates (a mother aged 8 or 60), "royal" or "noble" attachments, and parents chosen only because the names are similar.
4. Note new ancestors the tree lacks, with proper keys.

Prioritise the lowest generations, and links that carry many ancestors above them (the gateway immigrants). Breadth across the branch matters. A short, well-cited verdict on many links beats exhaustive work on one. Put "UNCHECKED" in the `.md` for whatever you didn't reach.

Browser: you may use the browser JavaScript tool (`mcp__Claude_Browser__javascript_tool`) with tabId "seed" for the FS helpers only. Don't use other browser tools unless your prompt names a tab for you.

## Second pass
Regenerate the claim files to list only UNVERIFIED people ('tree' tier) in deeper generations: `python scripts/branch_claims.py --gmin 8 --gmax 16 <n> ...`. They carry two extra columns:
- **ancestors above**: how many tree ancestors depend on this person's parent links. Check the high numbers first. A wrong link there invalidates a whole sub-tree.
- **quality issues**: implausible parent ages found automatically by merge.py, e.g. "mother born 1677 (3 yrs before child)". These are usually a wrong FS link or a merged namesake. Investigate them, and reject the link when no evidence supports it.

Your first-pass file (`research/lines/verify-<branch>.json`) already covers the earlier generations, so don't redo those. Write a NEW file, `verify2-<branch>.{md,json}`, with task id `verify2-<branch>`. Use rejectLinks for bad links, and give every CONFIRMED/PROBABLE person a citation.
