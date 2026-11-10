# FamilySearch record-search agents: instructions

You have the same rules as `research/AGENT_BRIEF.md` (read it and `research/SCHEMA.md` first). In addition you may use exactly ONE browser tool: the JavaScript tool (`mcp__Claude_Browser__javascript_tool`; load it with ToolSearch `select:mcp__Claude_Browser__javascript_tool`), with `action: "javascript_exec"` and ALWAYS `tabId: "seed"` (the signed-in FamilySearch tab; omitting tabId hits whatever tab is active, which may be another site). Do NOT navigate, click, type, open tabs, or call any other browser tool, and never touch `window.__C` (a crawl may be running there). Other agents use the same tab concurrently; that's fine because these calls are stateless fetches.

Helpers installed in the page (`scripts/fs_crawl.js` installs `__RS` and `__REC`; the `__TS` snippet is in PLAYBOOK step 2):

- `await __RS(query, count)` runs a historical-records search and returns one line per hit: `ark:1:1:<ID> | collection | principal | facts | with: other people on the record (with birth years)`.
  Query params (URL-encoded, joined with &): `q.givenName`, `q.surname`, `q.birthLikeDate.from`, `q.birthLikeDate.to`, `q.birthLikePlace`, `q.deathLikeDate.from/to`, `q.deathLikePlace`, `q.marriageLikeDate.from/to`, `q.marriageLikePlace`, `q.residencePlace`, `q.fatherGivenName`, `q.fatherSurname`, `q.motherGivenName`, `q.motherSurname`, `q.spouseGivenName`, `q.spouseSurname`, `q.anyDate.from/to`, `q.anyPlace`.
  Example: `await __RS('q.givenName=John%20Henry&q.surname=Doe&q.birthLikeDate.from=1880&q.birthLikeDate.to=1886', 20)`
- `await __REC('XXXX-XXX')` returns the full detail of one record (all persons on it with facts, ages, and relationships). Use it on promising hits: marriage records (which name both sets of parents), death certificates (parents and informant), Social Security NUMIDENT (parents), and censuses (household, ages, birthplaces).
- `await __TS('q.givenName=X&q.surname=Y&q.birthLikeDate=1790', 5)` searches the FamilySearch Family Tree (not records) and returns `FSID | name | lifespan | b. place | d. place | related: people (with ids)`.

Throttle: the helpers share a 2-second throttle across agents. If a helper returns "busy: ...", do some web research and retry shortly; that is normal queueing, not a block. Make at most 2 helper calls per `javascript_exec` (the tool times out at about 45 s). Don't add your own sleeps. Never assign window globals in the page; use local `const` inside your script.

If the helpers are missing (page reloaded), stop and report that to the coordinator; don't reinstall anything.

Method: confirm each person with records (census in every year they were alive, marriage, death certificate, SS NUMIDENT, draft cards, obituaries), then use the parents named on those records to climb. A death certificate or marriage record naming parents, plus consistent censuses, = CONFIRMED. Cite arks as `https://www.familysearch.org/ark:/61903/1:1:<ID>`. Keep queries purposeful. FamilySearch throttles heavy use, so expect occasional "throttled" or "blocked" results: wait about 2 minutes (do web research meanwhile) and continue. If searches return 403 for a long stretch, the account has hit a security block. Report it; do not try to bypass it. It has cleared by itself after a re-sign-in or some hours.

Record types by period (US examples; adapt to the country): censuses 1850-1950 (1850 onward list everyone; 1880 onward give relationships), marriage bonds and registers, state death certificates (about 1900 onward, earlier in some states), SS NUMIDENT (after 1936), WWI/WWII draft cards, naturalization, passenger lists, probate indexes. For other countries use the national collections FamilySearch indexes (civil registration, parish registers).
