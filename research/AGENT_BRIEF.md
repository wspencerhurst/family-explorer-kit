# Common instructions for research subagents

You are researching one line of the ancestry of **the subject** (Ahnentafel #1, the person this project is about).
Project folder: `<project folder>` (the repo root; every path below is relative to it).

1. FIRST read the starting brief (`<family>-ancestry-research-brief.md`, written in PLAYBOOK step 1: known pedigree, family lore, confidence labels, conflicts) and `research/SCHEMA.md` (output format). Also read `research/STATUS.md` and any `research/lines/*.md` files your prompt names, so you don't redo finished work.
2. Tools: use WebSearch and WebFetch, plus Bash with Python or curl for open JSON APIs. Do NOT use any browser tools (built-in browser, Claude in Chrome, computer use) unless your own brief names one. The browser is reserved for the coordinator.
   - Find a Grave blocks WebFetch; use search-result snippets and record the memorial IDs you find so the coordinator can fetch them later.
   - FamilySearch record pages (`familysearch.org/ark:/61903/1:1:XXXX-XXX`) sometimes fetch without sign-in; tree pages don't. Record FS IDs you find.
   - General sources (all regions):
     - WikiTree (`wikitree.com/wiki/<ID>`, sourced profiles). Pages may 403 for WebFetch, but the WikiTree API works from Python.
     - Google Books full view (`books.google.com/books?id=<ID>&pg=PA<n>&output=text`) and the Google Books API.
     - Internet Archive full texts (`archive.org/stream/<id>/<id>_djvu.txt`) and the `archive.org/advancedsearch.php` API.
     - HathiTrust full-text search (`babel.hathitrust.org/cgi/ls?q1=...`).
     - Chronicling America and the Library of Congress (`loc.gov`) for newspapers.
     - USGenWeb archives and county sites, RootsWeb freepages, Geni (UNVERIFIED), the soc.genealogy.medieval archives and the Medieval Lands project for medieval lines.
     - Wikipedia and Wikidata for notable people.
   - Regional sources. The Virginia list is an EXAMPLE of how detailed a list can be; build the equivalent for your family's regions as you learn where they lived.
     - **Colonial Virginia and the South (example: adapt to your family's regions):** Library of Virginia (chancery index, wills, deeds, land patents), VMHB / WMQ / Tyler's Quarterly via JSTOR early-journal content and archive.org, county will and order-book abstracts, "Cavalier and Pioneers", personal property and land tax lists.
     - **New England:** NEHGR (the Register), the Great Migration Study volumes, town vital records "to 1850" series, the Barbour Collection (Connecticut), probate records.
     - **Pennsylvania and Germany:** Pennsylvania Archives, "Pennsylvania German Pioneers" (Strassburger and Hinke), church registers (Lutheran/Reformed), local village family books (Ortsfamilienbuecher), FamilySearch German parish collections.
     - **Ireland:** irishgenealogy.ie (civil and church records), National Library of Ireland Catholic parish registers (images), PRONI, Griffith's Valuation. Records before about 1820 are sparse.
     - **Scotland:** ScotlandsPeople (paid), FreeCEN; Old Parish Registers are indexed on FamilySearch.
     - **England:** FreeBMD (from 1837), FreeREG, FreeCEN, county Online Parish Clerks, The National Archives Discovery catalogue (wills in PROB 11).
     - **The Netherlands:** WieWasWie and OpenArch (openarch.nl), which aggregate civil and church records.
     - **Scandinavia:** Digitalarkivet (Norway), the Swedish Riksarkivet, the Danish archives. Patronymic names need care.
     - **Latin America:** FamilySearch's Catholic parish collections (often the only online source) and national archives; spellings vary widely.
3. Go as DEEP as sources allow on your assigned lines: every ancestor, both parents of each person, as many generations as you can actually support. Breadth across all branches of your assigned section matters as much as depth.
4. Be honest about confidence. Published fabrications are common, especially:
   - royal and noble descents attached to colonial-era families, and "gateway ancestor" claims that are not in Roberts' *Royal Descents of 900 Immigrants* or Richardson's *Magna Carta Ancestry* / *Plantagenet Ancestry*;
   - Pocahontas descents (many are bogus; only a few lines are well documented, so check any claim against the scholarly literature);
   - noble Irish or Scottish clan pedigrees, and "Mayflower" claims without proof;
   - same-name merges (two men with the same name conflated into one).
   Record such claims as fabricated or unsupported instead of repeating them.
5. Living relatives MAY be included only if the project owner has approved it: record basic facts (names, birth/marriage dates and places, relationships) found in public sources like wedding announcements and obituaries. Keep it to genealogical facts. No addresses, phone numbers or other contact details. If you are unsure whether someone is living, treat them as living (born within the last 100 years with no death record).
6. Save progress incrementally (write your `.md` and `.json` files early and update them every few people) so work isn't lost if the session ends.
7. Respect site terms and rate limits: at most one request every 2 seconds per site, a plain User-Agent, and stop on captchas or bot checks. Never try to bypass them.
8. Final reply to the coordinator: a concise summary (300 words at most) of key findings, conflicts resolved, new ancestors added (count), and the most promising next steps. The files are the real deliverable.
