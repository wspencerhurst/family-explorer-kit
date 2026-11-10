# PLAYBOOK: from zero to a published family-history site

This is the runbook a Claude Code session follows. It reproduces a project that traced a person's ancestry as deep as the records allow (more than 100,000 people in the main pedigree, most of them medieval or tree-only and clearly labeled) and published it as a private, password-protected interactive site (fan chart, map, famous cousins, brick walls, DNA, remembrance page).

Read this whole file first, then work phase by phase. Keep `research/STATUS.md` updated as the running log. All paths are relative to the project folder (the repo root).

Terms: **the subject** is the person whose ancestry this is (Ahnentafel #1). **Ahnentafel number**: subject = 1, the parents of person n are 2n (father) and 2n+1 (mother). Generation = `n.bit_length()` (subject = generation 1, parents 2, grandparents 3, great-grandparents 4). **FS** = FamilySearch. **Coordinator** = you, the main Claude Code session. **Agents** = subagents you spawn with the Agent tool, each given one brief from `research/`.

## Contents
- Rules that apply to every phase
- Step 0: setup
- Step 1: the starting brief
- Step 2: FamilySearch tree crawl
- Step 3: merge
- Step 4: verification agents
- Step 5: line research and FS record search
- Step 6: dead ends
- Step 7: brick walls and other archives
- Step 8: DNA (optional)
- Step 9: media and portraits
- Step 10: places
- Step 11: notable kin
- Step 12: royal descents, summaries, consanguinity
- Step 13: QA agents
- Step 14: build and run the site
- Step 15: hosting
- Step 16: publish and GEDCOM
- Data with no producer script (shapes to produce)
- Concurrency, usage and timeline
- Lessons learned

---

## Rules that apply to every phase

1. **Never type the user's passwords or other secrets.** The user signs in to FamilySearch, Ancestry, 23andMe, GitHub and Cloudflare themselves, in the browser. You never see or handle `SITE_PASSWORD`; the user sets it in Cloudflare.
2. **Do not bypass CAPTCHAs, bot checks, security blocks or paywalls.** If a site answers with a captcha, a Cloudflare challenge or a long run of 403s, stop using that site for a while, record it in `research/STATUS.md`, and try again later (blocks have cleared after a re-sign-in or some hours). Do not hammer.
3. **Rate limits.** Slow down at the first 429/403. About one request every 2 seconds per site is the default; 10 seconds between requests for sensitive endpoints (for example DNA match endpoints). Honor `Retry-After`. Use the identifying User-Agent from `family.config.json` for APIs (Wikidata, Nominatim, WikiTree) that ask for one.
4. **Respect site terms.** Use each site's own interface or public API for the user's own data. Do not scrape other people's private data, do not resell anything, and do not redistribute copyrighted images (the site links to or thumbnails public-domain / Commons images and the user's own photos).
5. **Privacy.**
   - Keep the family repository PRIVATE. The published site sits behind a password gate. The repo of this starter kit is public; the family's repo must never be.
   - **Living people:** by default, include living relatives only as the user explicitly approves, and then only basic genealogical facts (names, birth/marriage dates and places, relationships). Never addresses, phone numbers, emails, or other contact details. If unsure whether someone is living, treat them as living. FamilySearch marks people "living" and hides details; do not try to get around that.
   - Raw DNA match exports (`data/dna/`) contain other people's names. They stay out of git (`.gitignore`), and are never published.
   - Do not put personal data in URLs or query strings; do not send the user's data to any service the user did not choose.
6. **Be honest about evidence.** Every claim carries a confidence label (CONFIRMED / PROBABLE / UNVERIFIED / CONFLICT; see `research/SCHEMA.md`). User trees are leads, not proof. Published royal, noble and Pocahontas descents are often fabricated. Record disproven links as rejected rather than silently dropping them.
7. **Save incrementally.** Research agents write their `.md` and `.json` early and often. You commit to git at the end of each phase (to the private repo).

---

## Step 0: setup

### Prerequisites
| Need | Why |
|---|---|
| Claude Code on a paid plan (more usage = faster) | The research phase is many agent runs. On a small plan it still works but takes weeks, not days. |
| Python 3.11+ with `pip install certifi pillow` | All pipeline scripts. `certifi` for HTTPS on Windows; `pillow` for portrait thumbnails. `networkx` is also needed for `dna_clusters.py` (`pip install networkx`). |
| Node 20+ (22 recommended; the map library wants a recent Node) and npm | The site (Vite + React + TypeScript). |
| git | Version control and publishing. |
| The Claude desktop app's built-in browser (or Claude in Chrome) | The FamilySearch crawl and record search run inside a signed-in browser tab. Built-in browser sign-ins persist, but an app restart can wipe cookies and IndexedDB (see lessons). |
| A free FamilySearch account | The tree and records. Essential. |
| Optional: Ancestry account (for the user's own trees, DNA matches, census images) | Photos, match trees, slave schedules. |
| Optional: 23andMe or AncestryDNA kit | DNA features (step 8). |
| Optional: GitHub account and Cloudflare account (free) | Hosting (step 15). A domain name is optional; Cloudflare gives a free `*.pages.dev` address. |

### Fill in `family.config.json`
```json
{
  "familyName": "Example",
  "siteTitle": "Example Family Explorer",
  "domain": "family.example.com",
  "userAgent": "FamilyExplorerKit/1.0 (personal genealogy research; contact: you@example.com)",
  "wikitreeAppId": "exampleFamilyResearch",
  "fsAnchors": {},
  "overviewLede": "",
  "searchHint": "Smith 1800",
  "originsNote": "",
  "ancestryTrees": {},
  "surnameVariants": {"smyth": "smith"},
  "royalGateways": {}
}
```
- `familyName`: used for the GEDCOM file name and labels.
- `siteTitle`: heading shown in the site header and boot screen.
- `domain`: optional custom domain (used by `publish.py` messages). Leave empty to use the `*.pages.dev` address.
- `userAgent`: sent to Wikidata, Nominatim and WikiTree. Include a way to reach the user if the user agrees; a generic string is fine too. Do not put it anywhere public if it contains an email, but note that this file is committed to the private repo.
- `wikitreeAppId`: any short identifier for the WikiTree API.
- `fsAnchors`: filled in at step 2 (Ahnentafel number to FS person id).
- `overviewLede`, `originsNote`: short sentences shown on the Overview page; write them at step 14 once you know the story (for example "Most lines trace to Virginia and Ireland.").
- `searchHint`: a sample query shown in the search box ("Smith 1800").
- `ancestryTrees`: Ancestry tree id to `"father"`, `"mother"` or `"user"` for trees you export (step 8; used by `convert_ancestry_trees.py` and `build_media_index.py`).
- `surnameVariants`: spelling variant to canonical surname, used when matching DNA-match trees (`dna_match2.py`). Add the family's own variants as you meet them.
- `royalGateways`: for `royal_descent.py` (step 12). Each entry is `"Label": {"ahnentafel": [n, ...], "names": ["regex", ...]}`, naming immigrant ancestors whose royal or noble descent is accepted by Roberts' *Royal Descents of 900 Immigrants* or Richardson's *Plantagenet Ancestry*. Leave it empty until research confirms one.

Also: make sure `.gitignore` exists with at least `data/dna/`, `data/raw/` (large dumps; keep them locally or in cloud storage, up to the user), `node_modules/`, `site/dist/`, `__pycache__/`. If `.gitignore` is missing, create it. Run `git init` if the folder is not a repository, and create a PRIVATE GitHub repo (see step 15; the user must be signed in with `gh auth login`).

Create the working folders: `data/raw`, `data/media`, `data/dna`, `data/places`, `research/lines`, `research/claims`, `research/walls`, `research/deadends`, `research/qa`.

---

## Step 1: the starting brief

Goal: give every later agent a shared picture of what is known and believed. Interview the user (in chat; it takes 15 minutes):
- The subject's full name, birth year, and sex; whether the subject wants to be shown (the site is private, but ask).
- Parents, grandparents, and great-grandparents: names, birth/death years and places, maiden names. Siblings are not needed.
- Which of these people are living (and whether living people may be included; default to yes only with explicit consent).
- Known family lore: "descended from a founder / a duke / a Native American princess / came over on the Mayflower". Write each as a legend to test.
- Ethnic origins and immigration stories, famous or infamous relatives, military service, and any enslaved ancestors or enslavers the family knows of.
- Existing trees: FamilySearch (get the user's FS person id), Ancestry, WikiTree, Geni, MyHeritage; DNA tests taken and by whom (including parents).
- Where the user's FS account will sign in, and who else might help (a parent with access to more trees).

Write two things:
1. **`research/lines/core.json`**: generations 1-3 (subject, parents, grandparents; great-grandparents too if known) in the SCHEMA format. Use `"ahnentafel": [1]` for the subject, `[2]`/`[3]` for the parents, etc. Give each a `key` (surname-given-birthyear), `fsId` when known, `confidence`, `living: true` where applicable, `sources` (an interview source `S-interview` is fine: "Family members, interviewed YYYY-MM-DD"), and `father`/`mother` as keys. `merge.py` loads this file first and uses its Ahnentafel numbers as anchors; the FS tree is merged under it. The subject's site id will be `R:<subject key>`.
2. **`<family>-ancestry-research-brief.md`** at the repo root: a starting brief with sections: goal and instructions for the agent; confidence labels (copy from SCHEMA); an "Ahnentafel" table of what is known; family legends with the user's claim and "to test"; known conflicts; access and method notes; a priority work queue; privacy. The agents read this file first. Keep structure; the content is the user's.

Fill `fsAnchors` in `family.config.json` now if the user can give FS ids for living parents' parents (it is the Ahnentafel number to FS id map for the crawl's starting people; use the grandparents' and great-grandparents' FS ids, since living generations are not visible in the FS tree crawl). Example: `"fsAnchors": {"4": "XXXX-XXX", "5": "XXXX-XXX", "6": "XXXX-XXX", "7": "XXXX-XXX"}`. Use the highest-numbered known ancestors that are deceased and in the tree. If the user's own FS id is public to them, you may add it, but living people's records are hidden from API output.

---

## Step 2: the FamilySearch tree crawl

This pulls the FamilySearch Family Tree upward from your anchors, as far as it goes (tens of thousands of people for a well-connected American line; 100,000+ when it reaches medieval royalty). Everything it produces is UNVERIFIED tree data. It is the skeleton the research then verifies or rejects.

### Method
- `scripts/fs_crawl.js` runs in the built-in browser (or Claude in Chrome) **in a freshly loaded, signed-in familysearch.org tab**. The user signs in (never you). Name the tab "seed" if the browser supports tab naming; otherwise note the tabId and use it consistently. Agents must always target that tab.
- It walks breadth-first with `GET /platform/tree/persons?pids=<up to 200 ids>` (`Authorization: Bearer <fssessionid cookie>`, `Accept: application/x-fs-v1+json`). Each call returns 200 people with their parents' ids (`display.familiesAsChild`), so every call yields about 200 new people. That is about 40 times more efficient than the 8-generation `/platform/tree/ancestry?person=ID&generations=8` endpoint (8 generations is that endpoint's maximum). A full walk of about 50,000 people takes minutes to an hour.
- State is kept in IndexedDB (`familycrawl`) and resumes; the page is paced with `Retry-After`, 5xx back-off and recursive batch splitting. `window.__C.status()` shows progress.

### Procedure
1. Open the built-in browser, go to `https://www.familysearch.org`, have the user sign in. Confirm with a quick `fetch('/platform/tree/current-person')`-style call or just by loading a tree page. If the sign-in is lost, the crawl stops with a 401; sign in again, reload, re-run.
2. Reload the tab (fresh page), then run: `window.__ANCHORS = ['XXXX-XXX', 'YYYY-YYY', ...]` (the FS ids from `fsAnchors`), then paste and run `scripts/fs_crawl.js` with the browser's JavaScript tool (`javascript_exec`). It installs `window.__RS` and `window.__REC` (FS record search helpers) and `window.__C` (the crawler), and starts 2 workers.
3. Poll `window.__C.status()` every few minutes. **Do not poll in a tight loop**; background tabs throttle timers to about once a minute, which is why the crawl loops have no sleeps on the success path. Keep the tab in the foreground (or at least do not let the browser pane be hidden for long).
4. When the queue empties, the crawler calls `C.export()`, which downloads `fs-tree-dump.json`. Browsers allow only a few downloads per page load; if more are needed, reload and re-run (the state resumes from IndexedDB).
5. **Getting the download.** The file lands in the user's `~/Downloads`. In the built-in browser it often appears as a GUID-named `.tmp` file of the exact blob size even before the user clicks "Save"; copy it right away. A Windows "Save as" dialog sometimes appears and only the user can confirm it. If a download seems to vanish, ask the user to look for that dialog. Run `sh scripts/sync_dump.sh` (Git Bash on Windows): it finds the newest crawl export (also among `.tmp` files, by content) and moves it to `data/raw/fs-tree-dump-<date>.json`.
6. Run `python scripts/process_fs_dump.py`. It reads `data/raw/fs-tree-dump.json`, or the newest `data/raw/fs-tree-dump*.json` if that file does not exist, and, using `fsAnchors`, writes `data/fs-tree.json` and `data/fs-tree-summary.txt` with Ahnentafel numbers, generations and route counts. Read the summary: how many generations and people, and sanity-check the first few generations against the interview.

### Gotchas (all hit in practice)
- The app restart wipes the built-in browser's cookies and IndexedDB. FamilySearch then needs a re-sign-in and the crawl restarts from the anchors. Export often; a re-walk is cheap.
- The v4 walk takes parents from the first `familiesAsChild` entry, which may not be FamilySearch's preferred parent set. Persons with more than one parent set get `multiParents: true`; `merge.py` can keep alternates (`altParents`) if the dump carries an `alt` field. Check ambiguous cases in verification (step 4).
- FamilySearch may throttle (429) or return 5xx under load; the crawler handles it. A 403 on `/service/search/hr/v2/personas` (record search) is a different, stricter block that can last hours (see lessons); the tree endpoint may keep working while record search is blocked.
- Install the **`__TS` tree-search helper** (not in `fs_crawl.js`) for dead-end and wall agents. Run this once in the "seed" tab after the crawl script has defined `window.__RS`:
  ```js
  window.__TS = async function(q, count=5){
    const tok = (document.cookie.match(/fssessionid=([^;]+)/)||[])[1];
    const r = await fetch('https://www.familysearch.org/platform/tree/search?count='+count+'&'+q,
      {headers:{Accept:'application/x-gedcomx-atom+json', Authorization:'Bearer '+tok}});
    if(!r.ok) return 'HTTP '+r.status;
    const j = await r.json();
    return (j.entries||[]).map(e=>{ const p=(e.content&&e.content.gedcomx&&e.content.gedcomx.persons||[])[0]||{}; const d=p.display||{};
      return [p.id, d.name, d.lifespan, 'b. '+(d.birthPlace||''), 'd. '+(d.deathPlace||'')].join(' | '); }).join('\n') || 'no hits';
  };
  ```
  and wrap `__RS`, `__REC` and `__TS` in a shared throttle (a global promise chain that spaces calls 2 seconds apart and returns `"busy: ..."` when more than a few are queued), so several agents can use the one tab. Test it with a known person before agents rely on it.
- **Do not touch `window.__C` while a crawl runs.** Agents must never navigate the "seed" tab or open other tabs through it.
- If tab state is lost, helpers vanish. Agents must stop and report rather than reinstall.

### Notable-kin walk (do after the main crawl; see step 11 for use)
This is a second crawl pass; its producer is described in "Data with no producer script".

---

## Step 3: first merge

```
python scripts/merge.py
```
Reads `data/raw/fs-tree-dump*.json` (all of them; later files only add) and `research/lines/*.json` (core.json first), applies research over tree data, recomputes Ahnentafel numbers, applies `research/corrections.json` and `rejectLinks`, and writes `data/people.json` (id = FS id, else `R:<key>`), `data/sources.json`, `data/keymap.json` and `data/merge-report.txt`. Read the report (unparsed files, corrections that did not apply, name-match collisions).

What the merge adds per person: `ahnentafel[]` (up to 8 routes), `generation`, `routes`, `confidence`, `tier` (verified / tree / medieval / legendary / flagged / conflict), `birthYear` (+ `birthYearEst`), `quality[]` (implausible parent ages), `lineFlag` and `linkFlags` (hangs from a rejected, fabricated or unsupported link), `notes{task: text}`, `sources[]`, `origin[]` (which tasks mention the person; `fs-tree` alone means only the user tree supports them).

Then `python scripts/chain.py <ahnentafel numbers>` prints the descent chain from the subject to anyone. Record the headline counts in `research/STATUS.md`, and commit.

---

## Step 4: verification agents (per branch)

FamilySearch's tree is full of errors: merged namesakes, invented parents, fake royal links. This phase checks the claims on every branch.

1. Choose the branches. Branches are named by an Ahnentafel number: for example `16 17 18 ... 31` are the sixteen great-grandparent lines (generation 5). Run `python scripts/branch_claims.py 16 17 18 ...` (defaults to generations 6-13) to write `research/claims/branch-<n>.txt`. Each file lists the unverified ancestors in that branch with FS id, dates, confidence, flags, origin, and how many ancestors sit above each person.
2. Spawn one agent per branch with **`research/VERIFY_BRIEF.md`**, giving it the branch file and the list of `research/lines/*.md` to read first, and a task id (`verify-<n>`). Run about 4 at a time. Prefer a strong model (Sonnet or better).
3. After the batch, run `merge.py`, then **pass 2**: `python scripts/branch_claims.py --gmin 8 --gmax 16 <branches>` (now only unverified 'tree'-tier people, with "ancestors above" and "quality issues" columns) and run the agents again with VERIFY_BRIEF's second-pass section (tasks `verify2-<n>`).
4. Merge again. `rejectLinks` flag disproven or unsupported parent links; everyone above a flagged link gets `lineFlag` and is shown faded or hidden on the site. Typical result for a colonial American line: about 1% of people end up CONFIRMED/PROBABLE and a few hundred links are rejected.
5. Update `research/STATUS.md`.

---

## Step 5: line research and FS record search

Verification checks links; line research goes deep on specific families and answers legends.

1. **Line research agents** (`research/AGENT_BRIEF.md`): one agent per assigned line (a great-grandparent line, a famous-family legend, an immigrant ancestor). Assign each a task id and output `research/lines/<task>.{md,json}`. They use only WebSearch/WebFetch (and Python for JSON APIs), no browser.
2. **FS record search agents** (`research/FS_RECORDS_BRIEF.md`): agents that use the signed-in "seed" tab through `__RS`/`__REC` to confirm 19th and 20th century people with censuses, marriages, death certificates and NUMIDENT, and climb using the parents named on those records. This is where most CONFIRMED ratings in the recent generations come from.
3. Each agent returns a short summary; the files are the deliverable. After each batch: `python scripts/merge.py`, read the merge report, spot-check three new CONFIRMED people against their cited sources, update STATUS.

Where FS record search returns 403 for hours, switch to other sources (step 7) rather than waiting.

Special-purpose research, done by agents or by you directly:
- **Military service** (Revolutionary War, Civil War, others): the National Park Service Soldiers and Sailors Database (JSON endpoints), FamilySearch indexed service records and pension indexes, lineage-society records. Write results into the people's `notable` field and a line file (`research/lines/civilwar-*.json`).
- **Census slave schedules and enslaved people:** see "Data with no producer script".
- **Legends:** for each family legend, write a `legends` entry (`{legend, verdict, basis}`) in a line file; the site's Discover page shows the verdicts.

---

## Step 6: dead ends

A dead end is a post-1500, unflagged ancestor missing one or both parents.

1. **Scripted extenders first** (cheap, no agents):
   - `python scripts/wikitree_extend.py` searches WikiTree by name and birth year and accepts a profile only if one of its children matches our known child; then it imports the profile's ancestors (UNVERIFIED, source = the WikiTree profile). Resumable (`data/raw/wikitree-cache.json`). Output `research/lines/wikitree-ext.json`.
   - `python scripts/dnatrees_extend.py` (needs DNA data, step 8) does the same over the public Ancestry trees of DNA matches. Output `research/lines/dnatrees-ext.json`.
2. Re-run `merge.py`. Then generate batches of about 40 remaining dead ends into `research/deadends/batch-NN.txt` (a short Python script over `data/people.json`: id, name, dates, places, spouse, the child through whom they are our ancestor, which parent is missing, and notes), closest generation first.
3. Spawn agents with **`research/DEADEND_BRIEF.md`** (task `deadend-NN`). Yields are low for colonial lines (the first ten batches produced about 18 extensions, mostly tree-based). Use fewer, stronger agents; the small/fast model gave very poor results. Stop when batches stop producing.
4. Merge and update STATUS.

---

## Step 7: brick walls and other archives

A brick wall is a well-attested ancestor, generations 2-10, with no known parents.

1. Generate `research/walls/walls-N.txt` (about 30 per file) and verification batches `research/walls/verify-N.txt` (unverified or conflicting people, generations 5-10). Run agents with **`research/WALLS_BRIEF.md`** (needs working FS record search).
2. For walls FamilySearch cannot break, group them by region into `research/walls/x-<region>.txt` and run agents with **`research/XARCH_BRIEF.md`** (non-FamilySearch sources: published abstracts, parish transcription sites, state archives, chancery and probate indexes, newspapers). Most realistic wins are 19th-century immigrants (UK/Ireland/Germany) and early-colonial lines with chancery or probate evidence.
3. Hand the user a to-do list for things only a human can do: GRO certificates, parish register visits, archive requests, DNA tests of specific cousins, paid sources (ScotlandsPeople, Ancestry collections, newspaper archives). The Discover page's Brick walls list is the same idea.
4. Document blocked sources in STATUS (for example, sources that answered 403, 429 or expired certificates) so no one retries them blindly.

---

## Step 8: DNA (optional)

DNA is optional but powerful: it ties match trees to your ancestors and sorts relatives into ancestral clusters. Raw exports contain other people's data: keep `data/dna/` out of git and out of the site.

### What to gather (the user signs in; you drive the browser tab or the user exports)
- **23andMe** (if tested): the relatives list (each relative's profile id, shared DNA proportion, parental side, surnames, and so on) and the "relatives in common" shared-matches map. The 23andMe pages use ajax endpoints you can find in the browser's network tab; they need the header `X-Requested-With: XMLHttpRequest` (otherwise they return HTML). Poll relatives-in-common slowly (about one request per 10 seconds ran 900 requests with zero 429s; faster polling hit Cloudflare blocks. Do not bypass a block).
- **AncestryDNA** (if tested): the match list (sample id, name, shared cM, relationship) and each match's linked public tree (people rows with birth data) where available. Also the user's own and parents' Ancestry trees (via the tree "list" endpoint), which can be converted into UNVERIFIED line files.
- If both parents tested, record which parent each match is from: it gives the side of every match for free.
- Use the browser tool for exports. Large JSON blobs: build them in page memory, then download with the blob trick (see step 2) or read them in chunks through the javascript tool.

### Data shapes the scripts expect (put in `data/dna/`)
- `dna-ancestry-matches.json`: `{"matches": [{"sampleId": "...", "name": "...", "cM": 123, "rel": {"assignment": "paternal|maternal|..."}}]}`.
- `dna-ancestry-match-trees.json`: `{"trees": {"<sampleId>": {"people": [[id, "Name", ["birth date", "birth place"], ?, ?, ?], ...]}}}`; each row is six columns (id, name, birth, then three more used for parent ids and the like; see `match_row` in `scripts/dna_match2.py` and the `rows`/`par` handling beside it). Every row is one ancestor of the match's home person, whose own row is not included.
- `dna-23andme-relatives.json`: `{"relatives": [{"relative_profile_id": "...", "ibd_proportion": 0.01, "is_paternal_side": true, "is_maternal_side": false, "surnames": ["..."], ...}]}`.
- `dna-23andme-ric.json`: `{"map": {"<profile id>": [["<shared profile id>", pct], ...]}}` (entries may be `[id, pct]` pairs or `{"profile_id": ...}` objects).
- `xlink.json`: list of `{"profile": "<23andMe profile id>", "name": "<Ancestry match name>", ...}` linking a person who appears in both services (matched by name and cM). Needed only by `dna_clusters.py` to label clusters with known common ancestors.
- `ancestry-trees.json` (for `convert_ancestry_trees.py`): `{"fetched": "YYYY-MM-DD", "meta": {"<treeId>": {"name": "...", "owner": "..."}}, "trees": {"<treeId>": [person, ...]}}` where each person has `gid.v`, `Names[{g, s, sf}]`, `Events[{t: "Birth|Death|Burial|...", d, p}]`, `Family[{t: "F|M|H|W", tgid.v}]`, `Genders[{g}]`. **Note:** `convert_ancestry_trees.py` and `build_media_index.py` map Ancestry tree ids to labels (father/mother/user) in a small dict near the top; edit those dicts to the user's own tree ids before running.

### Run
1. `python scripts/convert_ancestry_trees.py` -> `research/lines/ancestry-tree-<label>.json` (UNVERIFIED lines from the user's and parents' trees; adds names and dates the FS tree lacks).
2. `python scripts/dna_thrulines.py` -> `data/dna/thrulines.json`, `thrulines-summary.txt`: a DIY ThruLines (which of our ancestors appear in each match's tree, matching first given name + surname and birth year within 2).
3. `python scripts/dna_match2.py` -> `data/dna/match2.json`, `match2-by-ancestor.json`: the stricter v2 matcher (name variants, birthplace compatibility, couple agreement, most-recent-hits only). **The nickname and surname-variant tables near the top of this script (`NICK`, `SURV`) are examples; edit `SURV` to your family's surname spellings** (for example variant spellings of your common surnames) before running.
4. `python scripts/dna_clusters.py` -> `data/dna/clusters.json`, `research/dna-clusters.md`: Louvain clusters of 23andMe relatives (20-400 cM) labeled by parental side, enriched surnames and known common ancestors (needs `pip install networkx`).
5. Write `research/lines/dna.md` summarising which ancestors DNA supports and which brick walls DNA clusters point at, and use cluster surnames and places as leads for step 7. DNA proves only that a match shares some ancestor; it never makes a paper trail CONFIRMED by itself.
6. Rerun `dnatrees_extend.py` (step 6).

---

## Step 9: media and portraits

1. **FS media** (no script; see "Data with no producer script"): `data/media/fs-media.json`.
2. **Ancestry photos** (optional): `data/media/ancestry-photos.json`.
3. **Find a Grave** (optional): `data/media/findagrave-climb.json`. Find a Grave rate-limits heavy use; pause the climb rather than push through, and resume later.
4. `python scripts/collect_wiki_media.py` -> `data/media/wiki-media.json` (WikiTree and Wikipedia portraits and bios for people with a WikiTree id, notable people, and CONFIRMED/PROBABLE people born before 1850; a Wikipedia page is accepted only if the intro mentions the person's birth or death year). Resumable.
5. `python scripts/build_media_index.py` -> `data/media/index.json` (per person: portrait, photos, stories, bios, facts, findagrave) and `data/media/img/` (Ancestry photos written out as files). Portrait priority: Ancestry family photo, Wikipedia, FamilySearch photo, Find a Grave photo, WikiTree.
6. `python scripts/fetch_portraits.py` -> small square JPEG thumbnails in `site/public/portraits/<n>.jpg` and `site/public/portraits/index.json`. Resumable.
7. `python scripts/fetch_notable_portraits.py` -> Wikidata/Commons portraits for notable ancestors and cousins (`site/public/portraits/kin/<fsId>.jpg`). Resumable.

Only use portraits from public sources (Commons, Wikipedia, FamilySearch memories the user can see, the user's own tree photos). Thumbnails are small (192 px).

---

## Step 10: places

`python scripts/geocode_places.py` geocodes birth, death, burial and residence place strings with OpenStreetMap Nominatim (max 1 request per second, identifying User-Agent from the config, cached in `data/places/geocode-cache.json`, resumable) and writes `data/places/geocode.json`. It tries the full string, then drops the most specific part. `GEO_MEDIEVAL=N` (environment variable) geocodes the top N medieval places in a second pass. Expect tens of thousands of lookups, i.e. hours; run it in the background. QA later fixes mis-geocodes (a state's name inside a place string contradicting the coordinates) in `scripts/site_fixes/places.py`.

---

## Step 11: notable kin

Famous cousins are people with Wikidata entries who share an ancestor with the subject. Two complementary methods:

1. **FS notable walk (upward from famous people).** There is no collector script in the kit (see "Data with no producer script"). Produce `data/raw/notable-kin-walk.json`, then run `python scripts/notable_kin.py` -> `data/notable-kin.json` and `research/notable-kin.md`: for each notable it finds every common ancestor in the main pedigree born 1550 or later, on an unflagged line, and labels the relationship (for example "3rd cousin 2x removed"); earlier common ancestors are ignored because everyone of European descent shares medieval ancestors.
2. **Wikidata descendant walk (downward from our ancestors).** `python scripts/notable_kin_wd.py [maxdepth]` finds Wikidata entries for our ancestors via their FamilySearch id (property P2889), walks down child links with SPARQL, and writes `data/notable-kin-wd.json` and `research/notable-kin-wd.md`. It filters out people who are our own ancestors. Cached in `data/raw/wd-cache.json`; resumable and polite (1.5 s between queries, back-off on errors).
3. `python scripts/notable_kin_routes.py [maxQueries] [maxDepth] [qid ...]` adds alternative kinship routes through Wikidata parent links (writes `data/notable-kin-routes.json`); the site uses them to show every route to each famous cousin.
4. `python scripts/fetch_wd_kin_portraits.py` fetches portraits for Wikidata cousins (`site/public/portraits/kin/<qid>.jpg`); `python scripts/portrait_status.py` reports progress. Both are resumable and back off on 429.
5. The `site_fixes/notables.py` module cleans stale common ancestors and duplicates at site-build time.

Notable-cousin lists are fun but easy to get wrong; label relationships to people reached only through flagged lines as "unsupported link" (the fix module does this).

---

## Step 12: royal descents, summaries, consanguinity

- `python scripts/royal_descent.py` classifies pre-1550 notable ancestors as reached through an **accepted gateway immigrant** (an immigrant whose English or Scottish ancestry is accepted by Roberts' *Royal Descents of 900 Immigrants* or Richardson's *Plantagenet / Magna Carta Ancestry*) or as tree-only. The gateway list is hard-coded at the top of the script as examples; edit it to the gateways that appear in your tree (a notable counts as "via accepted gateway" only if a path from the gateway up to the notable crosses no flagged link). Output: `data/royal-descents.json`, `research/royal-descents.md`.
- `python scripts/build_summaries.py` -> `data/summary.json` (for the site) and `research/summary-tables.md`: notable ancestors (from persons' `notable` fields), notable kin and legends (from line files), immigrants (persons' `immigrant`), brick walls, enslaved people and counts (`data/enslaved.json`), and statistics. **Run this after every merge.**
- `python scripts/consanguinity.py` -> `data/consanguinity.json`: pedigree collapse and cousin marriages (kinship coefficient per couple, with and without disproven links).
- `python scripts/build_family.py` -> `data/family.json` and `data/fs-sources.json`: family groups (spouses, children, siblings) and FS record citations (needs `data/raw/fs-relatives-sources.json`; see "Data with no producer script").
- `python scripts/export_gedcom.py` -> `data/<family>-ancestry.ged` (GEDCOM 5.5.1, only people connected to the subject).
- Write `research/SUMMARY.md` by hand: the database at a glance, tiers, coverage by generation, the lines (one paragraph per great-great-grandparent line), legends with verdicts, immigrants, notable relatives, and what remains. Keep it honest.

---

## Step 13: QA agents

After the data is complete, spawn QA agents with **`research/QA_BRIEF.md`**, one per area (suggested: names, dates, places, relations, notables). Each writes ONE module `scripts/site_fixes/<area>.py` with `apply(ctx)`, applied in memory by `build_site_data.py` (never edit `data/people.json` by hand), logs to `research/qa/<area>-fixes.json`, and writes a report. Genealogy errors found by QA become `rejectLinks` in `research/lines/qa-<area>.json`. The kit already ships starter modules (`dates`, `names`, `notables`, `places`, `relations`); keep them and let agents add or tune. The coordinator reruns the pipeline at the end.

---

## Step 14: build and run the site

```
python scripts/merge.py
python scripts/build_summaries.py
python scripts/consanguinity.py
python scripts/build_site_data.py        # -> site/public/data  (core.json, details/NNN.json, geo.json, notables.json, memorial.json, stats.json)
cd site
npm install
npm run dev                              # live reload at the URL Vite prints
npm run build                            # type-check + build -> site/dist
python serve.py                          # serves site/dist (or public data) with gzip at http://127.0.0.1:8765
```
Check the pages: Overview (headline numbers, coverage by generation), Tree (fan chart; click, double-click to re-root, color by line/birthplace/era/evidence, toggle doubtful lines), Map (heatmap by year with play-through, side and DNA filters, migration trail for a selected person), Discover (famous cousins and kinship chains, notable ancestors, royal descents, immigrants, soldiers, legends, brick walls, a historical record of enslaved people, collapse and cousin marriages), the Person panel (events, photos, bios, family, research notes, sources, evidence labels, "how you descend from them"). Look at three or four people you know and check that facts match the starting brief. Write `overviewLede` and `originsNote` in `family.config.json` and rebuild.

The data files can be large (tens of MB for 100,000 people; the site loads them on demand). Keep `site/public/data` in git only if the host's file limits allow (Cloudflare Pages allows 20,000 files and 25 MiB per file; details chunks of 500 people are well inside). If the repo gets heavy, keep `data/raw` and `data/media` out of git.

---

## Step 15: hosting (Cloudflare Pages via Git, password-protected)

1. **Private GitHub repo.** The user runs `gh auth login` (a browser sign-in; you never see credentials). Then: `gh repo create <name> --private --source . --remote origin --push`. If SSH keys don't work in your shell, use HTTPS remotes; `gh` configures a credential helper for HTTPS. Confirm the repo is Private before pushing family data.
2. **Cloudflare Pages.** In the Cloudflare dashboard (user signed in): Workers & Pages > Create > **Pages** > Connect to Git > pick the repo. **Choose "Continue to Pages"** if the dashboard offers Workers and Pages side by side; the new combined flow can default to Workers, but this site needs Pages (the password gate is a Pages Function in `site/functions/_middleware.js`, and Pages builds the static output with a simple `dist` folder). Settings:
   - Root directory: `site`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Node version: set the environment variable `NODE_VERSION` to `22` (the map library needs a recent Node; the build fails on Node 18).
3. **Secrets** (Settings > Variables and Secrets, add to Production, type "Secret" for the password):
   - `SITE_PASSWORD`: the shared password. **The user sets it; you never see it, type it or store it.** The gate sets an HMAC-signed cookie valid 30 days; changing the secret and redeploying signs everyone out.
   - `SITE_TITLE`: the heading on the login page (plain text; the middleware strips `<>&"`).
   Visit `/__logout` to sign out of the site.
4. **Custom domain (optional).** In the Pages project > Custom domains > add `family.example.com`. If DNS is at another registrar, add a **CNAME** record (name `family`, target the project's `<project>.pages.dev` address) and nothing else; Cloudflare verifies it. If the zone is on Cloudflare, it is added automatically. Allow a few minutes for the certificate.
5. Why Git-connected Pages: every push builds and deploys; the build runs on Cloudflare (so the repo needs `site/package.json` and the committed `site/public/data`, not `site/dist`); the password gate runs in front of all files including the data JSON. Without it the data would be public to anyone with the URL.

---

## Step 16: publish and GEDCOM

- `python scripts/publish.py --rebuild -m "what changed"` reruns the data pipeline (`merge.py`, `build_summaries.py`, `consanguinity.py`, `build_site_data.py`), commits everything and pushes; Cloudflare builds and deploys in a minute or two. Omit `--rebuild` if only site code changed. Check the deployment in the Cloudflare dashboard; if the build fails, read the log (Node version and missing files are the usual causes).
- Give the user the GEDCOM from `python scripts/export_gedcom.py` (`data/<family>-ancestry.ged`) for import into other tools. Warn the user that it contains the same living-people data you chose to include.
- Working on another computer: `git clone`, `cd site && npm install && npm run dev`; Python 3.11+ with `pip install certifi pillow` for the pipeline.

---

## Data with no producer script (shapes to produce)

These inputs are read by pipeline scripts but the kit has no collector for them (they depend on a signed-in browser tab and the user's accounts). Produce them yourself with the browser's JavaScript tool, writing JSON downloads as in step 2.

### FS notable walk: `data/raw/notable-kin-walk.json` (read by `notable_kin.py` and `build_site_data.py`)
```json
{
  "notables": [ {"fs": "XXXX-XXX", "name": "Jane Doe", "desc": "Wikidata description", "born": 1850, "links": 42} ],
  "V": { "XXXX-XXX": ["<father FS id or null>", "<mother FS id or null>", "Name", "1850-1920"] },
  "hits": { "XXXX-XXX": true }
}
```
- `notables`: Wikidata humans that have an FS id (property P2889), from a SPARQL query on `query.wikidata.org` (a few thousand; `links` = number of Wikipedia sitelinks, used to sort by fame; `born` = birth year; `desc` = English description). Keep only people born after about 1400 who plausibly connect.
- `V`: walk **upward** from every notable using the same batch call as the crawl (`/platform/tree/persons?pids=<200 ids>`), up to about 10 generations; store each visited person as `[fatherId, motherId, name, lifespan]`. Stop expanding a branch once you reach a person in our own pedigree. `V` is the graph the relationship and descent-chain code walks, so parents must be present for people between the notable and our common ancestors.
- `hits`: optional bookkeeping (ids in `V` that are also in our pedigree); the scripts do not require it.
Crawl politely: 200 ids per call, honor `Retry-After`, about 2 workers, and export in chunks.

### FS family groups and citations: `data/raw/fs-relatives-sources.json` (read by `build_family.py`)
```json
{
  "rel":   { "<FS id>": { "spouses": ["<FS id>"], "children": ["<FS id>"] } },
  "extra": { "<FS id of a spouse/child/sibling not in the pedigree>": {"name": "...", "sex": "...", "life": "1850-1920", "b": "1850", "bp": "place", "dd": "1920", "dp": "place"} },
  "src":   { "<FS id>": [ {"title": "...", "url": "https://www.familysearch.org/ark:/61903/1:1:XXXX-XXX", "citation": "..."} ] }
}
```
Produce `rel` and `extra` from the same batch persons endpoint (`display.familiesAsParent` for spouses and children, with `display` facts for `extra`), for every pedigree person. Produce `src` from each person's sources (the `/platform/tree/persons/<id>/sources` family of endpoints); it is slow, so do the people with CONFIRMED/PROBABLE status or all, at the user's priority. Siblings are derived as other children of the same parents.

### FS media: `data/media/fs-media.json` (read by `build_media_index.py`)
```json
{
  "facts":    { "<FS id>": [ ["Birth", "date", "place", "value"], ... ] },
  "memories": { "<FS id>": [ {"id": "...", "type": "image/jpeg | text/plain | ...", "title": "...", "desc": "...", "thumb": "https://...", "image": "https://...", "about": "https://...", "memory": "https://familysearch.org/memories/..."} ] },
  "stories":  { "<memory id>": "story text" }
}
```
Gather memories (images, documents, stories) and extra facts through the Memories API for pedigree persons; stories are the plain text of `text/plain` memories.

### Ancestry photos (optional): `data/media/ancestry-photos.json`
`{"photos": {"<key>": {"tree": "<treeId>", "pid": "<person id in that tree>", "name": "...", "birth": "...", "data": "data:image/jpeg;base64,..."}}}`: the primary photo of each person in the user's own (and parents') Ancestry trees. `build_media_index.py` decodes these into `data/media/img/`.

### Find a Grave (optional): `data/media/findagrave-climb.json`
`{"memorials": {"<memorial id>": {"name": "...", "birth": "...", "death": "...", "cemetery": "...", "inscription": "...", "photos": ["https://..."], "bio": "...", "parents": ["<memorial id>"]}}}`. A "climb" starts from the memorials of the closest ancestors and follows the memorials' family links upward, in the signed-in browser tab at a polite pace (Find a Grave rate-limits; pause and resume). Matches to tree people are made by name plus birth/death year, then propagated along parent links.

### Enslaved people and slave schedules (optional; see SCHEMA)
Collect, only if the research finds enslavers among the ancestors: named enslaved individuals from wills, inventories, deeds, chancery suits, and census **slave-schedule counts** (US federal censuses of 1850 and 1860 list enslaved people by sex and age, without names, under the enslaver's name). In the original project the schedules were searched through the Ancestry collections (the search result pages are server-rendered and each record page shows "Number of Enslaved People" and the age/sex table); the user's account was signed in in the browser tab and requests were paced. Record results in a line file (`research/lines/slave-schedules.json`) using the `enslavedCounts` shape in SCHEMA.md (`enslaver`, `year`, `place`, `count`, `enumeratedAs`, `confidence`, `url`, and `persons: [["F","42"], ...]` with sex and age) and `enslavedPeople` for named individuals. `build_summaries.py` writes `data/enslaved.json`; the site shows it on a remembrance page and in person panels. Large households may display only the first 50 persons on the record page; keep the stated total in `count`. Present this material with care, as the people they were, not as property or trivia.

### Pre-1550 notable ancestors: `data/notable-ancestors-pre1550.json` (read by `royal_descent.py` and `fetch_notable_portraits.py`)
Medieval and legendary ancestors with a Wikidata entry. Produce it by matching pedigree people born before 1550 to Wikidata (FamilySearch id P2889 via SPARQL in batches of about 200, cached; fame = sitelink count) and grouping them by the person's `tier` in `data/people.json`:
`{"medieval": [{"id": "<people.json id>", "name": "...", "born": 1066, "desc": "<Wikidata description>", "generation": 30, "fame": 120}], "legendary": [...], "flagged": [...], "tree": [...], "alternate": [...], "unattached": [...]}`.
Both scripts tolerate the file being absent (royal descents are then empty).

### FS tree dump fields (if you modify the crawler)
`data/raw/fs-tree-dump*.json` = `{"crawled": "...", "done": [...], "queue": [...], "persons": {"<FS id>": {"id", "name", "sex": "Male|Female", "life", "b": {"date","place"}, "d": {...}, "chr", "bur", "f": "<father id>", "m": "<mother id>", "multiParents": bool, "alt": [[fatherId, motherId], ...], "living": bool}}}`. `merge.py` consumes `chr`, `bur`, `alt` (alternate parent sets) and `living` if present; the stock crawler records `b`, `d`, `f`, `m`, `multiParents`. Alternate parent sets matter for lines where the FS tree has several parent sets per child.

---

## Concurrency, usage and timeline

- Run about **4 concurrent Sonnet-class agents**. Running many at once hit the plan's usage limit within hours in the original project. More agents do not finish sooner when the plan's usage window is the bottleneck.
- Prefer **fewer, stronger agents for hard problems** (dead ends, brick walls, chancery work). Haiku-class agents did poorly: low yield and more fabricated links.
- Give agents a bounded batch (about 30-40 people) and a clear output file; ask for a reply under 120-300 words so your context stays clean.
- Share the one signed-in browser tab for record search through the throttled helpers; only the coordinator navigates or clicks.
- Do crawl and download work in the background (`run_in_background`) and poll sparingly; do not busy-wait.
- Expected timeline: setup and interview 1 hour; the FS crawl a few hours (mostly waiting); first verification passes and line research 1-3 days of agent time; dead ends, walls, DNA and media another 2-4 days; geocoding runs overnight; QA and site polish 1 day; hosting 1 hour. A paid plan with plenty of usage compresses this into roughly a week of calendar time; a small plan stretches it to weeks.

---

## Lessons learned

- **FamilySearch tree data is a skeleton, not a source.** The deep (pre-1600) lines are mostly unsourced and often wrong. Keep them (users like to see them) but label them by tier and let research flag what it disproves. About 1 in 100 people ends up properly sourced.
- **Fabricated royal and noble descents are common**, especially for colonial Virginia and for Irish families. Check any "gateway" claim against Roberts and Richardson before treating the medieval part of a line as plausible; Pocahontas descents are mostly bogus.
- **Verify the links that carry the most ancestors first.** One wrong link at generation 8 can invalidate thousands of people above it. The claim files sort by "ancestors above" for this reason.
- **Impossible parent ages are the cheapest error detector.** `merge.py`'s `quality[]` flag found many merged namesakes.
- **Record search is the high-yield tool for 1850-1950**; before 1800 it yields little, and progress needs wills, deeds, chancery and parish records. Do not expect to break many colonial walls.
- **FamilySearch record search can be blocked (403) for hours or days** ("security block"), while the tree endpoint keeps working. After a re-sign-in it came back more than once. Plan work that does not depend on it.
- **Built-in browser quirks:** app restarts wipe cookies and IndexedDB; downloads can arrive as GUID `.tmp` files; the browser blocks more than a few downloads per page load; a "Save as" dialog sometimes needs the user; background tabs throttle timers to about once a minute; the built-in browser cannot fetch `http://127.0.0.1` from site pages (a localhost receiver for uploads does not work), so move data through downloads. Always pass the right `tabId` from subagents; a call without it hits whatever tab is active.
- **Do not bypass site protections.** 23andMe's Cloudflare blocks fast shared-matches polling; keep requests slow (about 10 s) and never evade a block. Other sources (HathiTrust with an expired certificate, Google Books API 429s, newspaper archives behind Cloudflare, national library sites that 403 scripts) were simply written off and noted.
- **Public archive sites often work from scripts where they refuse WebFetch.** Examples: the Library of Virginia chancery index (POST form, case images are PDFs), county parish clerks' static register pages (search forms reject scripts), the National Park Service Soldiers and Sailors JSON, Wikidata SPARQL, WikiTree's API (pages 403, API works), Nominatim with a User-Agent.
- **User-submitted FamilySearch parent sets can be wrong in both directions.** A link flagged "unsupported" is not "disproven": keep the two verdict levels distinct on the site (disproven hidden by default; unproven faded).
- **Matching people across sources** (tree vs DNA match trees vs WikiTree vs Find a Grave) needs name keys with nickname and spelling variants, birth years within a tolerance, a place check and "same child" or "both spouses" agreement. Name plus year alone merges namesakes.
- **Notable-cousin relationships need a sanity filter**: only common ancestors born 1550 or later on unflagged lines, with titles stripped when de-duplicating (so "Gov. X" isn't treated as a stranger).
- **Pedigree collapse is large.** A tree with 100,000 people in the pedigree is reached by many routes each; compute route counts and show the most likely routes, and do not describe every connection as unique. Medieval and legendary tiers are huge and mostly unreliable; hide or fade them by default.
- **Agent hygiene:** agents that are told to "be thorough" without a bounded batch wander. Give each a file of people and an output file name; require at least N searches per person, breadth before depth, save after every ~10 people, and a short final reply.
- **Cloudflare:** pick Pages (not Workers) in the combined create flow; set `NODE_VERSION`; the password is a secret only the user sets; changing it signs everyone out.
- **Git:** push over HTTPS via `gh` if SSH does not work from the shell. Keep `data/dna/` out of git.
- **Be kind to living people and to the enslaved.** The first by default (basic facts only, with the owner's consent); the second by naming people as the records name them and avoiding sensational presentation.
