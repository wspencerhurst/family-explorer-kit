# Brick-wall and verification pass

Read `research/AGENT_BRIEF.md`, `research/SCHEMA.md` (including `rejectLinks`), and `research/FS_RECORDS_BRIEF.md` first.

Use this pass after FamilySearch record search is working (it can be blocked with 403 for long stretches; when it comes back, many people have never been searched in the records). The `notes:` column in your batch file shows what earlier agents tried: don't repeat their dead ends, try the record angles they couldn't.

Browser: only the JavaScript tool (`mcp__Claude_Browser__javascript_tool`), `action: "javascript_exec"`, ALWAYS `tabId: "seed"`. Helpers `__RS(query, count)`, `__REC(id)` and `__TS(query, count)` are installed (see FS_RECORDS_BRIEF.md). They contain a shared throttle (one FamilySearch request every 2 s across all agents). Make AT MOST 2 helper calls per `javascript_exec` (the tool times out at about 45 s). If a helper returns "busy: ...", do some web research and retry that call shortly; that is normal queueing, not a block. Don't add your own sleeps. Never assign window globals (e.g. `window.T = ...`) in the page; use local `const` inside your script.
FS Family Tree search helper: `await __TS('q.givenName=X&q.surname=Y&q.birthLikeDate=1790', 5)` returns `FSID | name | lifespan | b. place | d. place | related: people (with ids)`. Use it to find the same person already in the FS tree with parents attached; confirm with `/platform/tree/persons?pids=ID` before using. If a helper returns "throttled/blocked", wait about 2 minutes (do other web research meanwhile) and continue. If `__RS` is undefined, stop and report it. Never navigate or use other browser tools.
Also allowed: FS tree search / persons endpoints (see DEADEND_BRIEF.md step 2), WebSearch, WebFetch, the WikiTree API.

## Brick-wall batches (`research/walls/walls-N.txt`) -> `research/lines/walls-N.{json,md}`, task `walls-N`
Generate the batch files from `data/people.json` (well-attested ancestors in generations 6-10 with a missing parent, about 30 per file) using the same method as the dead-end batches. Follow `research/DEADEND_BRIEF.md`. Goal: find the missing parent(s). Best record types: marriage records and bonds (name parents, especially in later 19th-century US records), death certificates (US state registers after about 1853 in Virginia and about 1900 elsewhere), censuses 1850-1880 (living with parents), SS NUMIDENT, obituaries, wills and deeds in published abstracts, county histories. For immigrants, look for naturalization, passenger lists, and the parents named on their own marriage or death record. A parent named on a record = CONFIRMED. Add parents as new persons with keys, and the father/mother link.

## Verification batches (`research/walls/verify-N.txt`) -> `research/lines/walls-verify-N.{json,md}`, task `walls-verify-N`
Follow `research/VERIFY_BRIEF.md`. For each person: confirm identity and the link to the listed child, using records first. Set confidence (CONFIRMED/PROBABLE with citations), fix dates/places if records disagree, and put wrong links in `rejectLinks` with reasons. CONFLICT rows: resolve the conflict.

## Both
Breadth first: every person gets at least 2 record searches. Save JSON and `.md` after every ~10 people. Cite arks as `https://www.familysearch.org/ark:/61903/1:1:<ID>`. Final reply under 120 words: how many resolved/extended/verified/rejected, and the top finds.

Realistic expectations: pre-1800 colonial-era people rarely have useful indexed records. Further progress usually needs original wills, deeds and order books that are not online in indexed form (see XARCH_BRIEF.md for published and non-FamilySearch sources, and PLAYBOOK "Brick walls" for what to hand the project owner as a to-do list).
