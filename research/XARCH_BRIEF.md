# Brick walls: sources beyond FamilySearch

Read `research/AGENT_BRIEF.md` and `research/SCHEMA.md` (including `rejectLinks`) first. Your batch file is `research/walls/x-<region>.txt`, grouped by region (so one agent knows one region's archives). Every person in it has already been searched in FamilySearch's indexes and the FS tree (see the notes column); don't repeat that. Your job: find evidence of the missing parent(s) in OTHER sources.

## Tools
- WebSearch and WebFetch.
- **Bash with Python `urllib` or curl** for public archive sites that WebFetch can't handle (403s, POST search forms, JSON APIs). Send at most one request every 2 s per site, use a plain User-Agent such as "Mozilla/5.0 (genealogy research)", and stop on any site that answers with a captcha or bot check. Put scratch scripts in your scratchpad or temp dir, not the project folder.
- Optional: FS helpers in browser tab "seed" (`__RS`, `__REC`, `__TS`; see FS_RECORDS_BRIEF.md and WALLS_BRIEF.md), at most 2 calls per `javascript_exec`. No other browser tools.

## Sources by region (try the ones that fit each person)

### All regions: full text of books and journals
Use these for printed wills, deeds, order books, parish registers, county histories, family genealogies and regional journals.
- Google Books API: `https://www.googleapis.com/books/v1/volumes?q="Jane Doe"&maxResults=20` (JSON with snippets and links). It rate-limits (429) under heavy use.
- HathiTrust full text: `https://babel.hathitrust.org/cgi/ls?q1=%22Jane%20Doe%22&anyall1=phrase&lmt=ft` (HTML; open the hits and their page-level search).
- Internet Archive: `https://archive.org/advancedsearch.php?q=<terms>&fl[]=identifier&fl[]=title&rows=50&output=json`. For full text inside a book, use `https://archive.org/stream/<id>/<id>_djvu.txt`, then grep it.
- WikiTree API (pages 403 for WebFetch, but the API works from Python): `https://api.wikitree.com/api.php?action=searchPerson&FirstName=..&LastName=..&BirthDate=..&appId=<wikitreeAppId from family.config.json>`, then `action=getProfile&key=X&fields=*&bioFormat=text`.

### Colonial Virginia (example: adapt to your family's regions)
- Library of Virginia Chancery Records Index (lva.virginia.gov/chancery; the older `old.lva.virginia.gov/chancery` interface can be scripted with a POST form from the signed-in browser tab, and case scans are PDFs you can read). Chancery suits name heirs, so they often prove parentage. Note unread leads in a `research/lines/chancery-leads.md`.
- LVA catalog (wills and deeds); USGenWeb Archives `files.usgwarchives.net/va/<county>/` (will and deed transcriptions).
- Published abstracts: Cavalier and Pioneers, county will books and order books, Virginia Land Office patents (LVA).
- Personal property and land tax lists (often transcribed).

### The rest of the American South, and the Mid-Atlantic and New England
- North Carolina, South Carolina, Georgia: NCpedia; SC Dept of Archives & History online index; Georgia Virtual Vault; USGenWeb archives for the state and county; Find a Grave search snippets.
- Maryland, New Jersey, Pennsylvania: Maryland State Archives (msa.maryland.gov) probate abstracts; NJ Archives "abstracts of wills" (in Google Books/HathiTrust); Pennsylvania Archives volumes.
- New England: NEHGR and the Great Migration Study (Anderson); town vital records "to 1850"; Connecticut Barbour Collection (in HathiTrust); probate indexes.

### Europe and elsewhere (high level; confirm each site's current URL before relying on it)
- **England (any county):** county Online Parish Clerks sites (several counties have one) have free transcriptions of baptisms, marriages and burials by parish; baptisms name the parents. Some search forms reject scripts, but the static register pages work. Also FreeREG (freereg.org.uk), FreeBMD (freebmd.org.uk, from 1837), FreeCEN, and The National Archives Discovery catalogue.
- **Ireland:** irishgenealogy.ie (civil and church records; GET search URLs); NLI Catholic parish registers (registers.nli.ie, images; may block scripted access); Griffith's Valuation. Civil registration starts 1864 (Catholic marriages 1864, all births/deaths 1864); church records before about 1820 are patchy.
- **Scotland:** ScotlandsPeople indexes (paid; skip); FreeCEN for Scotland; Old Parish Registers via FamilySearch.
- **The Netherlands:** OpenArch (openarch.nl) and WieWasWie: free aggregated civil and church records with an API.
- **Scandinavia:** Digitalarkivet (Norway) with census and church-book transcriptions; Swedish Riksarkivet and Rotter; Danish archives (Dansk Demografisk Database). Watch patronymics.
- **Germany and Pennsylvania German lines:** church records on FamilySearch and Archion (paid), village family books (Ortsfamilienbuecher), "Pennsylvania German Pioneers" (ship lists).
- **Latin America:** FamilySearch Catholic parish registers, national archives; consider notarial and "informacion matrimonial" files.
- **Anywhere:** local newspapers (Chronicling America and national equivalents), obituaries, county histories, cemetery transcriptions, military pension files.

## Recording
Same rules as the brick-wall pass:
- Add each parent as a person with a key, plus the father/mother link on the brick-wall person.
- Confidence: CONFIRMED if a record or abstract names the parent (e.g. a will naming "my daughter X wife of Y", a baptism naming the parents, a chancery suit naming heirs); PROBABLE for strong circumstantial evidence or good compiled sources; UNVERIFIED for trees.
- Cite exact sources and URLs (book, page). Use rejectLinks if you prove an existing link wrong.

Breadth first: give every person at least 3 distinct non-FS source attempts before going deep on anyone. Save JSON and `.md` after every ~8 people.
Output: `research/lines/xarch-<region>.{json,md}`, task `xarch-<region>`.
Final reply under 150 words: how many walls broken (with confidence), and the top finds. List sites that were blocked so the coordinator can note them in `research/STATUS.md`.
