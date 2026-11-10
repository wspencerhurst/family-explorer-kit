# Status (updated YYYY-MM-DD)

This file is the running log for the project. Update it at the end of every work session (what ran, counts, what is blocked, what is next). Phases and step numbers refer to PLAYBOOK.md.

## Phase checklist
- [ ] 0. Setup: prerequisites installed, `family.config.json` filled in, repo private on GitHub
- [ ] 1. Starting brief: interview done, `research/lines/core.json` (generations 1-3), `<family>-ancestry-research-brief.md`
- [ ] 2. FamilySearch tree crawl: `data/raw/fs-tree-dump-*.json`, `fsAnchors` set, `process_fs_dump.py` run
- [ ] 3. First merge: `python scripts/merge.py` -> `data/people.json`; counts recorded below
- [ ] 4. Verification agents per branch (`branch_claims.py` + VERIFY_BRIEF), pass 1 and pass 2
- [ ] 5. Line research agents (AGENT_BRIEF) and FS record search (FS_RECORDS_BRIEF)
- [ ] 6. Dead ends (DEADEND_BRIEF, `wikitree_extend.py`, `dnatrees_extend.py`)
- [ ] 7. Brick walls (WALLS_BRIEF) and sources beyond FamilySearch (XARCH_BRIEF)
- [ ] 8. DNA (optional): exports gathered, `dna_thrulines.py`, `dna_match2.py`, `dna_clusters.py`
- [ ] 9. Media and portraits: `build_media_index.py`, `collect_wiki_media.py`, `fetch_portraits.py`
- [ ] 10. Places: `geocode_places.py`
- [ ] 11. Notable kin: FS notable walk, `notable_kin.py`, `notable_kin_wd.py`, `notable_kin_routes.py`, portraits
- [ ] 12. Royal descents, summaries, consanguinity: `royal_descent.py`, `build_summaries.py`, `consanguinity.py`
- [ ] 13. QA agents (QA_BRIEF) and `site_fixes/` modules
- [ ] 14. Site data and local site: `build_site_data.py`, `npm install`, `npm run dev`, `serve.py`
- [ ] 15. Hosting: Cloudflare Pages, `SITE_PASSWORD`, `SITE_TITLE`, custom domain
- [ ] 16. Publish and GEDCOM: `publish.py`, `export_gedcom.py`

## Database (fill in after each merge)
- people in pedigree: 
- tiers (verified / tree / medieval / legendary / flagged / conflict): 
- CONFIRMED / PROBABLE: 
- deepest generation: 
- brick walls (generations 2-10): 

## Pipeline notes
(Anything that differs from PLAYBOOK for this family: tab names, source quirks, tools that worked.)

## Blocked sources / rate limits
(Site, date, symptom, what finally worked.)

## Next steps
1. 
