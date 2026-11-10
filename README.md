# Family Explorer Kit

Research your whole family tree with Claude Code, then publish it as a private, password-protected family-history site.

The kit has two parts:

1. **A research method.** A step-by-step playbook, plus instructions for research agents and checking agents, that turns a few names into a database of tens of thousands of ancestors. Each person carries a confidence level and sources. Fabricated or doubtful lines are flagged rather than silently accepted.
2. **The Family Explorer site.** A fast, responsive React site built from that database.

## What the site does

- **Zoomable fan chart.** WebGL, about 100k people, with portraits and colour modes (line, birthplace, era, evidence, pedigree collapse). Doubtful lines can be hidden or faded.
- **Person pages.** Each person has life facts, sources, photos and stories. Each page also lists every route by which you descend from that person. Routes are ranked by likelihood, shown on a route map, and explained in plain words ("her parents were 3rd cousins").
- **Map.** A heatmap of where ancestors were alive in any year, with a year slider and paternal/maternal filters.
- **Discover.**
  - Famous cousins, with every route and a real family-tree chart for each.
  - Notable and royal ancestors, immigrants, soldiers.
  - Family legends checked against records.
  - Brick walls.
  - Cousin marriages and inbreeding.
  - A historical record of enslaved people named in the family's records.
- **Password gate** for hosting on Cloudflare Pages: one shared family password, not indexed by search engines.

## Quick look (demo family, about 5 minutes)

Needs Python 3.11+ and Node 20+.

```bash
pip install certifi pillow
python scripts/make_demo.py
python scripts/merge.py
python scripts/build_summaries.py
python scripts/consanguinity.py
python scripts/geocode_places.py
python scripts/build_site_data.py
cd site
npm install
npm run dev
```

The demo family is entirely fictional. Before starting real research, remove it:

```bash
python scripts/make_demo.py --clean
```

## Doing it for your family

1. Click **Use this template** on GitHub and create a **private** repository. Your tree will include living relatives.
2. Clone it, open the folder in Claude Code (the desktop app works best because of its built-in browser), and say:
   > Read PLAYBOOK.md and help me research my ancestry, starting with step 0.
3. Edit `family.config.json` with your family name, site title and domain.

The full process is in [PLAYBOOK.md](PLAYBOOK.md). It takes a few days of Claude working, with you signing in to FamilySearch and the other sites yourself and answering questions about your family. Claude never types your passwords.

## Layout

| Folder | What it holds |
|---|---|
| `PLAYBOOK.md` | The research and build runbook, phase by phase |
| `research/` | Agent briefs (`*_BRIEF.md`), the line-file format (`SCHEMA.md`), status log, and research line files (`lines/*.json`) |
| `scripts/` | Pipeline: crawl processing → `merge.py` → summaries → consanguinity → `build_site_data.py`, plus media, places, notable kin, DNA and QA tools |
| `site/` | The React + Vite site. `site/functions/_middleware.js` is the password gate |
| `data/` | Created by the pipeline (your family's data, never part of this template) |

## License

MIT. Data sources have their own terms (FamilySearch, Ancestry, WikiTree, Wikidata/Wikimedia Commons, OpenStreetMap Nominatim, OpenFreeMap); respect their rate limits and usage policies.
