# Instructions for Claude Code sessions in this repo

This repo is a starter kit that reproduces a deep-research ancestry project plus a private, polished family-history site, for the user's own family.

1. **Read `PLAYBOOK.md` first, completely.** Follow its phases in order (Step 0 setup, then Step 1 starting brief, through Step 16 publish). Do not skip the interview in Step 1.
2. **Keep `research/STATUS.md` updated** as the running log: tick the phase checklist, record counts after each merge, blocked sources, and next steps. Read it at the start of every session to resume where the last session stopped.
3. **Research briefs** live in `research/*_BRIEF.md`; `research/SCHEMA.md` defines the output format for every research agent. Give each subagent one brief, a bounded batch of people, an output file name, and a task id. Run about 4 agents at a time.
4. **Scripts** are in `scripts/` and each has a docstring; PLAYBOOK names the right one for each step. The pipeline order after any new research is `merge.py`, `build_summaries.py`, `consanguinity.py`, `build_site_data.py`. Publishing is `python scripts/publish.py --rebuild -m "message"`.
5. **Configuration** is `family.config.json`. Edit it for this family. Do not hard-code family names, places or ids in scripts or site code; if a script contains a family-specific table (for example surname variants in `dna_match2.py`, or the gateway list in `royal_descent.py`), edit the table to this family's data.

## Safety and privacy rules (always)
- **Never type or ask for the user's passwords or tokens.** The user signs in to FamilySearch, Ancestry, 23andMe, GitHub and Cloudflare themselves. `SITE_PASSWORD` is set by the user in Cloudflare; you never see it.
- **Do not bypass CAPTCHAs, bot checks, security blocks or paywalls.** Stop, record the block in STATUS.md, and try later or use another source.
- **Slow down on rate limits** (429/403): about 2 seconds between requests per site, longer if asked. Respect each site's terms.
- **Keep the family's repository private.** Raw DNA exports (`data/dna/`) and raw crawl dumps stay out of git. Never publish living people's details: living relatives get basic genealogical facts only, with the user's consent, and never contact information.
- **Be honest about evidence.** Use the confidence labels in `research/SCHEMA.md`. Treat user trees as leads, and royal, noble or Pocahontas descent claims as suspect until sourced.
- Don't commit, push or publish without the user's go-ahead on the first publish; after that, `publish.py` is fine when asked.
- Don't put personal data in URLs, and don't send the user's data to services the user didn't choose.
