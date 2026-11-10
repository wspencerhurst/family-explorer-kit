import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { C, FL, CONF, TIER, displayName, loadDetail, placeName, portraitUrl, relationLabel, sideOf, years, getRouteCounts, topRoutes, fmtCount, linkVerdict, type Detail, type RelRef, type Route } from '../store'
import { Icon } from '../components/Icon'
import { RouteMap, routeColor } from './RouteMap'
import { ParentsKin, SplitExplain, routeSummary } from './RouteExplain'
import { computeDiffs, loadCons, type ConsCouple, type RouteDiff } from '../routeDiff'

interface Props {
  i: number
  onClose: () => void
  onGo: (i: number, path?: number[]) => void       // select + fly to in the fan (optionally along a given route)
  onFocus: (i: number) => void    // make the fan's center
  onMap: (i: number) => void
}

const TASK_LABEL: Record<string, string> = {
  core: 'Core research', dna: 'DNA', 'fs-tree': 'FamilySearch tree', enslaved: 'Enslaved people research',
}
function taskLabel(t: string) {
  if (TASK_LABEL[t]) return TASK_LABEL[t]
  return t.replace(/^verify2?-/, 'Verification ').replace(/^walls-verify-/, 'Verification ').replace(/^walls-/, 'Brick-wall research ')
    .replace(/^xarch-/, 'Archive search: ').replace(/^deadend-/, 'Dead-end research ').replace(/^ancestry-tree-/, 'Ancestry tree: ')
    .replace(/-/g, ' ')
}

export function PersonPanel({ i, onClose, onGo, onFocus, onMap }: Props) {
  const c = C()
  const [d, setD] = useState<Detail | null>(null)
  const [photo, setPhoto] = useState<number | null>(null)
  const [tab, setTab] = useState<'life' | 'family' | 'sources'>('life')
  useEffect(() => { let live = true; setD(null); setTab('life'); loadDetail(i).then(x => { if (live) setD(x ?? null) }); return () => { live = false } }, [i])

  const pu = portraitUrl(i)
  const conf = CONF[c.conf[i]], tier = TIER[c.tier[i]]
  const doubtful = !!(c.flags[i] & FL.doubtful)
  const disproven = !!(c.flags[i] & FL.disproven)
  const side = sideOf(i)
  const name = displayName(i)

  return (
    <aside className="panel" aria-label={`Details for ${name}`}>
      <button className="icon-btn panel-close" onClick={onClose} title="Close (Esc)"><Icon name="close" /></button>
      <header className="p-head">
        <div className={'p-portrait' + (pu ? '' : ' empty')} onClick={() => d?.photos?.length && setPhoto(0)}>
          {pu ? <img src={pu} alt="" /> : <span>{initials(name)}</span>}
        </div>
        <div className="p-title">
          <div className="p-rel">{relationLabel(i)}{side ? ` · ${side}` : ''}{c.gen[i] > 0 ? ` · generation ${c.gen[i]}` : ''}</div>
          <h2>{name}</h2>
          <div className="p-years">{years(i) || 'Dates unknown'}</div>
          <div className="badges">
            <Badge conf={conf} tier={tier} doubtful={doubtful} disproven={disproven} />
            {c.flags[i] & FL.living ? <span className="badge living">Living</span> : null}
            {getRouteCounts().all[i] > 1.5 && <span className="badge" title="Pedigree collapse: the number of different routes from you to this ancestor">{fmtCount(getRouteCounts().all[i])} routes to you</span>}
          </div>
        </div>
      </header>

      <div className="p-actions">
        <button className="btn" onClick={() => onGo(i)}><Icon name="target" size={16} />Show in tree</button>
        <button className="btn" onClick={() => onFocus(i)}><Icon name="fan" size={16} />Their ancestors</button>
        <button className="btn" onClick={() => onMap(i)}><Icon name="map" size={16} />On the map</button>
      </div>

      <ParentsKin i={i} onGo={onGo} />

      {d?.notable && <div className="callout notable"><Icon name="star" size={16} /><div>{d.notable}</div></div>}
      {d?.immigrant && <div className="callout"><Icon name="ship" size={16} /><div><b>Immigrant</b>{typeof d.immigrant === 'string' ? ` — ${d.immigrant}` : <> — {[d.immigrant.year && `arrived ${d.immigrant.year}`, d.immigrant.from && `from ${d.immigrant.from}`].filter(Boolean).join(', ')}{d.immigrant.evidence && <div className="muted small">{d.immigrant.evidence}</div>}</>}</div></div>}
      {doubtful && d?.lineFlag && <div className={'callout ' + (disproven ? 'bad' : 'warn')}><Icon name="warn" size={16} /><div>
        <b>{disproven ? 'Disproven connection.' : 'Unproven connection.'}</b> {disproven ? 'Every known route from you to this person passes through a parent link research showed to be wrong' : 'Every known route from you to this person passes through a parent link that no evidence supports yet'}{d.lineFlag.via && C().ids.indexOf(d.lineFlag.via) >= 0 ? <> (at <button className="link" onClick={() => onGo(C().ids.indexOf(d.lineFlag!.via!))}>{displayName(C().ids.indexOf(d.lineFlag.via))}</button>)</> : null}.
        {d.lineFlag.reason && <div className="muted small" style={{ marginTop: 4 }}>{d.lineFlag.reason}</div>}
        {disproven && <div className="muted small" style={{ marginTop: 4 }}>Kept so nothing is lost if the research proves wrong, but hidden in the tree unless “Disproven links” is switched on.</div>}
      </div></div>}
      {d?.linkFlags && Object.entries(d.linkFlags).map(([rel, f]) => (
        <div className="callout warn" key={rel}><Icon name="warn" size={16} /><div><b>{rel === 'father' ? 'Father' : 'Mother'} link {f.verdict.toLowerCase()}.</b> {f.reason}</div></div>))}
      {d?.quality?.map((q, k) => <div className="callout soft" key={k}><Icon name="warn" size={16} /><div>Date check: {q}</div></div>)}

      <div className="tabs">
        {(['life', 'family', 'sources'] as const).map(t => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{{ life: 'Life', family: 'Family', sources: `Sources${d?.nsrc ? ` (${d.nsrc})` : ''}` }[t]}</button>)}
      </div>

      {!d && <div className="p-loading"><div className="spinner" /></div>}
      {d && tab === 'life' && <Life d={d} i={i} onPhoto={setPhoto} />}
      {d && tab === 'family' && <Family d={d} i={i} onGo={onGo} />}
      {d && tab === 'sources' && <Sources d={d} />}

      {c.gen[i] > 0 && <Routes i={i} onGo={onGo} />}

      {photo !== null && d?.photos && <Lightbox photos={d.photos} at={photo} onClose={() => setPhoto(null)} onAt={setPhoto} />}
    </aside>
  )
}

function initials(n: string) { return n.replace(/\(.*?\)|".*?"/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() }

function Badge({ conf, tier, doubtful, disproven }: { conf: string; tier: string; doubtful: boolean; disproven?: boolean }) {
  if (disproven) return <span className="badge bad" title="Every known route to this person passes through a parent link research disproved">Disproven line</span>
  if (doubtful) return <span className="badge doubt" title="Every known route to this person passes through a parent link no evidence supports yet">Unproven line</span>
  if (conf === 'CONFIRMED') return <span className="badge ok" title="Documented by records that name the relationship">Confirmed</span>
  if (conf === 'PROBABLE') return <span className="badge prob" title="Strong circumstantial evidence or a reliable compiled source">Probable</span>
  if (conf === 'CONFLICT') return <span className="badge conflict" title="Sources disagree">Conflicting sources</span>
  if (tier === 'legendary') return <span className="badge leg" title="Ancient or legendary line copied between online trees; not historically verified">Legendary</span>
  if (tier === 'medieval') return <span className="badge med" title="Medieval line from online trees; may be correct but unverified">Medieval · unverified</span>
  if (tier === 'alternate') return <span className="badge leg">Alternate lineage</span>
  return <span className="badge tree" title="From the FamilySearch tree; not independently verified">Tree · unverified</span>
}

const EV_ICON: Record<string, string> = { Birth: 'heart', Christening: 'heart', Death: 'flag', Burial: 'flag', Residence: 'home', 'Military service': 'shield', Occupation: 'book', Marriage: 'people', Immigration: 'ship', Title: 'crown' }

function Life({ d, i, onPhoto }: { d: Detail; i: number; onPhoto: (n: number) => void }) {
  const [more, setMore] = useState<Record<number, boolean>>({})
  const events = d.events ?? []
  const bios = [
    ...(d.bios ?? []).map(b => ({ title: b.source ?? 'Biography', url: b.url, text: b.text })),
    ...(d.sketch ? [{ title: 'Life sketch (FamilySearch)', url: undefined, text: d.sketch }] : []),
    ...(d.stories ?? []).map(s => ({ title: s.title || 'Family story', url: undefined, text: s.text })),
  ]
  const photos = (d.photos ?? []).filter(p => p.kind !== 'document')
  const docs = (d.photos ?? []).filter(p => p.kind === 'document')
  return (
    <div className="p-body">
      {events.length > 0 && (
        <section>
          <h3>Life events</h3>
          <ol className="timeline">
            {events.map((e, k) => (
              <li key={k}>
                <span className="t-icon"><Icon name={EV_ICON[e.type] ?? 'pin'} size={13} /></span>
                <div className="t-main">
                  <div className="t-type">{e.type}{e.value && e.type !== 'Title' && e.type !== 'Occupation' ? '' : ''}{e.date ? <span className="t-date">{e.date}</span> : null}</div>
                  {e.value && <div className="t-value">{e.value}</div>}
                  {e.place && <div className="t-place">{e.place}</div>}
                </div>
              </li>))}
          </ol>
        </section>
      )}
      {d.occupation && <p className="muted">Occupation: {d.occupation}</p>}
      {photos.length > 0 && (
        <section>
          <h3>Photos &amp; images <span className="count">{photos.length}</span></h3>
          <div className="gallery">
            {photos.slice(0, 18).map((p, k) => (
              <button key={k} className="g-item" onClick={() => onPhoto((d.photos ?? []).indexOf(p))} title={p.title || p.source}>
                <img loading="lazy" src={p.file ? `./media/${p.file}` : (p.thumb || p.url)} alt={p.title || ''} onError={ev => ((ev.target as HTMLImageElement).parentElement!.style.display = 'none')} />
              </button>))}
          </div>
        </section>
      )}
      {bios.length > 0 && (
        <section>
          <h3>Biography &amp; stories</h3>
          {bios.map((b, k) => {
            const long = b.text.length > 700
            return (
              <article className="bio" key={k}>
                <div className="bio-src">{b.title}{b.url && <a href={b.url} target="_blank" rel="noreferrer"><Icon name="ext" size={13} /></a>}</div>
                <p className={long && !more[k] ? 'clamp' : ''}>{b.text}</p>
                {long && <button className="link" onClick={() => setMore({ ...more, [k]: !more[k] })}>{more[k] ? 'Show less' : 'Read more'}</button>}
              </article>)
          })}
        </section>
      )}
      {d.fag && (
        <section>
          <h3>Grave</h3>
          <div className="card-row">
            <div><b>{d.fag.cemetery ?? 'Find a Grave memorial'}</b>{d.fag.inscription && <div className="muted small">“{d.fag.inscription}”</div>}</div>
            <a className="btn small" href={d.fag.memorial} target="_blank" rel="noreferrer">Find a Grave<Icon name="ext" size={13} /></a>
          </div>
        </section>
      )}
      {(d.enslaved?.length || d.enslavedCounts?.length) ? <Enslaved d={d} /> : null}
      {docs.length > 0 && (
        <section>
          <h3>Documents</h3>
          <ul className="plain">{docs.map((p, k) => <li key={k}><a href={p.page || p.url} target="_blank" rel="noreferrer">{p.title || 'Document'}</a></li>)}</ul>
        </section>
      )}
      <ExternalLinks d={d} />
      {events.length === 0 && !bios.length && !photos.length && <p className="muted">No life details recorded beyond the dates above.</p>}
    </div>
  )
}

function Enslaved({ d }: { d: Detail }) {
  const [all, setAll] = useState(false)
  const ppl = d.enslaved ?? []
  return (
    <section className="memorial">
      <h3>People enslaved by {d.name?.split(' ')[0]}</h3>
      <p className="muted small">These people's names survive only because they were listed as property. They are recorded here so they are remembered.</p>
      {d.enslavedCounts?.map((e, k) => <div key={k} className="m-count"><b>{e.count}</b> people in the {e.year} census slave schedule, {e.place}{e.confidence && e.confidence !== 'CONFIRMED' ? ` (${e.confidence.toLowerCase()} match)` : ''}{e.url && <a href={e.url} target="_blank" rel="noreferrer"> <Icon name="ext" size={12} /></a>}</div>)}
      {ppl.length > 0 && <ul className="m-names">{(all ? ppl : ppl.slice(0, 40)).map((e, k) => <li key={k} title={[e.description, e.place, e.year].filter(Boolean).join(' · ')}>{e.name}</li>)}</ul>}
      {ppl.length > 40 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${ppl.length} names`}</button>}
    </section>
  )
}

function ExternalLinks({ d }: { d: Detail }) {
  const links: [string, string][] = []
  if (d.fs && !d.fs.startsWith('R:')) links.push(['FamilySearch', `https://www.familysearch.org/tree/person/details/${d.fs}`])
  if (d.wt) links.push(['WikiTree', `https://www.wikitree.com/wiki/${d.wt}`])
  const wp = d.bios?.find(b => b.source === 'Wikipedia')?.url; if (wp) links.push(['Wikipedia', wp])
  if (!links.length) return null
  return <div className="ext-links">{links.map(([l, u]) => <a key={l} className="btn small ghost" href={u} target="_blank" rel="noreferrer">{l}<Icon name="ext" size={13} /></a>)}</div>
}

function Person({ r, onGo, role }: { r: RelRef | number; onGo: (i: number) => void; role?: string }) {
  const c = C()
  if (typeof r === 'number' || r.i !== undefined) {
    const i = typeof r === 'number' ? r : r.i!
    const pu = portraitUrl(i)
    return (
      <button className="person-chip" onClick={() => onGo(i)}>
        <span className="pc-img">{pu ? <img src={pu} alt="" /> : initials(c.names[i])}</span>
        <span className="pc-text"><b>{displayName(i)}</b><span>{[role, years(i), c.gen[i] >= 0 ? relationLabel(i) : ''].filter(Boolean).join(' · ')}</span></span>
        {c.gen[i] >= 0 && <span className="pc-anc" title="Your direct ancestor">◆</span>}
      </button>)
  }
  return (
    <div className="person-chip static">
      <span className="pc-img">{initials(r.name ?? '?')}</span>
      <span className="pc-text"><b>{r.name ?? 'Unknown'}</b><span>{[role, r.life, r.bp].filter(Boolean).join(' · ')}</span></span>
      {r.fs && <a className="pc-link" href={`https://www.familysearch.org/tree/person/details/${r.fs}`} target="_blank" rel="noreferrer" title="Open on FamilySearch"><Icon name="ext" size={13} /></a>}
    </div>)
}

/** key identifying who a relative reference is, so the same person shown as a linked and an unlinked entry collapses */
let _idIdx: Map<string, number> | null = null
function idIndex() { if (!_idIdx) { _idIdx = new Map(); C().ids.forEach((x, k) => _idIdx!.set(x, k)) } return _idIdx }
function relKey(r: RelRef): string {
  if (r.i !== undefined) return 'i' + r.i
  if (r.fs) { const j = idIndex().get(r.fs); if (j !== undefined) return 'i' + j }
  return 'n' + (r.name ?? '').toLowerCase().replace(/[^a-z]/g, '') + '|' + (r.life ?? '')
}
const nameKey = (r: RelRef) => (r.i !== undefined ? C().names[r.i] : r.name ?? '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '')

/** drop self, own parents, repeated entries, and unlinked entries that duplicate a linked relative (same name) */
function cleanRels(list: RelRef[] | undefined, i: number, exclude: Set<string>, extra?: (r: RelRef, x: number) => boolean): RelRef[] {
  const c = C()
  const seen = new Set<string>(exclude)
  const linkedNames = new Set<string>()
  for (const r of list ?? []) { const k = relKey(r); if (k.startsWith('i')) linkedNames.add(nameKey(r)) }
  const me = nameKey({ i })
  const out: RelRef[] = []
  for (const r of list ?? []) {
    const k = relKey(r)
    if (seen.has(k)) continue
    const linked = k.startsWith('i')
    if (!linked && (nameKey(r) === me || linkedNames.has(nameKey(r)))) continue
    if (linked && extra && extra(r, Number(k.slice(1)))) continue
    seen.add(k)
    out.push(linked && r.i === undefined ? { i: Number(k.slice(1)) } : r)
  }
  return out
}

function Family({ d, i, onGo }: { d: Detail; i: number; onGo: (i: number) => void }) {
  const c = C()
  const [sibs, setSibs] = useState<{ r: RelRef; half: boolean }[] | null>(null)
  const parents = [c.father[i], c.mother[i]]
  const self = 'i' + i
  const parentKeys = new Set(parents.filter(p => p >= 0).map(p => 'i' + p))
  // a relative whose own recorded parents rule out `i` is a mis-filed link (e.g. a spouse stored as a child)
  const notMine = (x: number) => c.sex[i] === 1 ? (c.father[x] >= 0 && c.father[x] !== i) : c.sex[i] === 2 ? (c.mother[x] >= 0 && c.mother[x] !== i) : (c.father[x] >= 0 || c.mother[x] >= 0) && c.father[x] !== i && c.mother[x] !== i
  const children = useMemo(() => cleanRels(d.children, i, new Set([self, ...parentKeys]), (_r, x) => notMine(x)), [d, i])
  const childKeys = new Set(children.map(relKey))
  const spouses = useMemo(() => cleanRels(d.spouses, i, new Set([self, ...parentKeys, ...childKeys])), [d, i])
  useEffect(() => {
    const ps = parents.filter(p => p >= 0)
    if (!ps.length) { setSibs([]); return }
    let live = true
    Promise.all(ps.map(p => loadDetail(p))).then(pds => {
      if (!live) return
      const all = pds.flatMap(pd => pd?.children ?? [])
      const mine = cleanRels(all, i, new Set([self, ...parentKeys]), (_r, x) => (c.father[x] >= 0 || c.mother[x] >= 0) && !ps.some(p => c.father[x] === p || c.mother[x] === p))
      setSibs(mine.map(r => {
        const x = r.i
        // half-sibling: a known sibling parent that differs from mine on either side
        const half = x !== undefined && ((c.father[x] >= 0 && c.father[i] >= 0 && c.father[x] !== c.father[i]) || (c.mother[x] >= 0 && c.mother[i] >= 0 && c.mother[x] !== c.mother[i]))
        return { r, half }
      }))
    })
    return () => { live = false }
  }, [i])
  return (
    <div className="p-body">
      <section>
        <h3>Parents</h3>
        <div className="chips">
          {parents.map((p, k) => p >= 0 ? <Person key={k} r={p} onGo={onGo} role={k ? 'Mother' : 'Father'} /> : <div key={k} className="person-chip static empty"><span className="pc-img">?</span><span className="pc-text"><b>Unknown {k ? 'mother' : 'father'}</b><span>Not yet identified</span></span></div>)}
        </div>
        {Array.isArray(c.altParents[i]) && (c.altParents[i] as number[][]).length > 0 && (
          <div className="alt-par">
            <div className="muted small">Other online trees give different parents:</div>
            <div className="chips">{(c.altParents[i] as number[][]).flat().filter(x => x >= 0 && x !== c.father[i] && x !== c.mother[i]).map(x => <Person key={x} r={x} onGo={onGo} role="Alternate parent" />)}</div>
          </div>)}
      </section>
      {spouses.length > 0 && <section><h3>Spouses</h3><div className="chips">{spouses.map((s, k) => <Person key={k} r={s} onGo={onGo} />)}</div></section>}
      {children.length > 0 && <section><h3>Children <span className="count">{children.length}</span></h3><div className="chips">{children.map((s, k) => <Person key={k} r={s} onGo={onGo} />)}</div></section>}
      {sibs && sibs.length > 0 && <section><h3>Siblings <span className="count">{sibs.length}</span></h3><div className="chips">{sibs.map((s, k) => <Person key={k} r={s.r} onGo={onGo} role={s.half ? 'Half-sibling' : undefined} />)}</div></section>}
    </div>
  )
}

function Sources({ d }: { d: Detail }) {
  const notes = Object.entries(d.notes ?? {})
  return (
    <div className="p-body">
      {notes.length > 0 && (
        <section>
          <h3>Research notes</h3>
          {notes.map(([t, n]) => <div className="note" key={t}><div className="note-src">{taskLabel(t)}</div><p>{n}</p></div>)}
        </section>)}
      <section>
        <h3>Sources {d.nsrc ? <span className="count">{d.nsrc}</span> : null}</h3>
        {!d.sources?.length && <p className="muted">No sources attached yet. This person comes from {d.origin?.includes('fs-tree') ? 'the FamilySearch family tree' : 'compiled trees'}.</p>}
        <ul className="sources">
          {d.sources?.map((s, k) => (
            <li key={k}>
              {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a> : <span>{s.title}</span>}
              {(s.publisher || s.author) && <span className="muted small"> — {[s.author, s.publisher].filter(Boolean).join(', ')}</span>}
              {s.citation && <div className="muted small cite">{s.citation}</div>}
            </li>))}
        </ul>
        {d.origin && <p className="muted small">Data from: {d.origin.map(taskLabel).join(' · ')}</p>}
      </section>
    </div>
  )
}

function routeQuality(r: Route): { label: string; cls: string } {
  const c = C()
  if (r.disproven) return { label: `Through ${r.disproven} disproven link${r.disproven > 1 ? 's' : ''}`, cls: 'bad' }
  if (r.unproven) return { label: `Through ${r.unproven} unproven link${r.unproven > 1 ? 's' : ''}`, cls: 'warn' }
  const docs = r.path.slice(1).every(x => c.conf[x] <= 1)
  if (docs) return { label: 'Documented all the way', cls: 'ok' }
  if (r.path.some(x => c.tier[x] === 3)) return { label: 'Through legendary generations', cls: 'leg' }
  const firstTree = r.path.findIndex((x, k) => k > 0 && c.conf[x] > 1)
  return { label: firstTree > 1 ? `Documented for ${firstTree - 1} generation${firstTree === 2 ? '' : 's'}, then family trees` : 'From family trees', cls: 'tree' }
}

function Routes({ i, onGo }: { i: number; onGo: (i: number, path?: number[]) => void }) {
  const counts = getRouteCounts()
  const all = counts.all[i], clean = counts.clean[i]
  const routes = useMemo(() => topRoutes(i, 20), [i])
  const diffs = useMemo(() => computeDiffs(routes), [routes])
  const [cons, setCons] = useState<Map<number, ConsCouple> | null>(null)
  const [open, setOpen] = useState<number>(0)
  const [hover, setHover] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const [full, setFull] = useState(false)
  const [mapAll, setMapAll] = useState(false)
  useEffect(() => { setOpen(0); setMore(false); setHover(null); setFull(false); setMapAll(false) }, [i])
  useEffect(() => { let live = true; loadCons().then(m => { if (live) setCons(m) }); return () => { live = false } }, [])
  const nMap = mapAll ? routes.length : Math.min(5, routes.length)
  const mapRoutes = useMemo(() => routes.slice(0, nMap), [routes, nMap])
  if (!routes.length) return null
  const shown = more ? routes : routes.slice(0, 5)
  const sel = hover ?? (open >= 0 ? open : null)
  const mapActive = sel !== null && sel < nMap ? sel : null
  const pick = (k: number) => {
    setOpen(k)
    if (k >= 5) setMore(true)
    setTimeout(() => document.getElementById('route-' + k)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30)
  }
  return (
    <section className="p-line">
      <h3>How you descend from them</h3>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        {all > 1.5
          ? <>You reach this ancestor by <b>{fmtCount(all)}</b> different routes{clean < all - 0.5 ? <> ({clean > 0.5 ? fmtCount(clean) : 'none'} avoid disproven links)</> : null}, because the same people appear in several branches of your tree (pedigree collapse). Each extra route exists because someone’s parents were related to each other. The most likely routes are listed first.</>
          : 'One route connects you.'}
      </p>
      {routes.length > 1 && (
        <div className="rm-wrap">
          <div className="rm-bar">
            <span className="rm-title">Route map</span>
            <div className="rm-legend" role="group" aria-label="Routes in the map">
              {mapRoutes.map((_, k) => (
                <button key={k} className={'rm-chip' + (sel === k ? ' on' : '')} onClick={() => pick(k)} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(k)} onBlur={() => setHover(null)} aria-label={`Route ${k + 1}`} aria-pressed={open === k}>
                  <svg width="22" height="8" aria-hidden="true"><line x1="1" y1="4" x2="21" y2="4" stroke={routeColor(k)} strokeWidth="3" strokeLinecap="round" strokeDasharray={k >= 16 ? '1.5 3.5' : k >= 8 ? '5 3' : undefined} /></svg>{k + 1}
                </button>))}
            </div>
            {routes.length > 5 && <button className="link small" onClick={() => setMapAll(!mapAll)}>{mapAll ? 'Top 5 only' : `All ${routes.length}`}</button>}
          </div>
          <div className="rm-scroll"><RouteMap routes={mapRoutes} active={mapActive} onHover={setHover} onPick={pick} onGo={onGo} /></div>
          <p className="muted small rm-note">Lines are routes; numbers mark where a route runs alone. Named people are where routes split or rejoin. Tap a line or a number to select it, a name to show it in the tree.</p>
        </div>)}
      <ol className="routes">
        {shown.map((r, k) => {
          const q = routeQuality(r)
          const isOpen = open === k
          const d = diffs[k]
          return (
            <li key={k} id={'route-' + k} className={'route ' + q.cls + (isOpen ? ' open' : '') + (sel === k ? ' sel' : '')} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
              <button className="route-head" onClick={() => setOpen(isOpen ? -1 : k)} aria-expanded={isOpen}>
                <span className="route-rank" style={{ borderColor: routeColor(k) }}>{k + 1}</span>
                <span className="route-main"><b>{r.path.length - 1} generations</b><span className={'route-q ' + q.cls}>{q.label}</span>
                  {d ? <span className="route-diff">{routeSummary(d)}</span> : routes.length > 1 ? <span className="route-diff">Main route: the most likely one.</span> : null}</span>
                <Icon name="chev" size={14} />
              </button>
              {isOpen && (
                <div className="route-body">
                  {d && d.splits.map((sp, s) => <SplitExplain key={s} sp={sp} path={r.path} onGo={onGo} cons={cons} />)}
                  <ol className="line-list rd-list">{chainRows(r, d, full, onGo)}</ol>
                  <div className="route-actions">
                    <button className="btn small" onClick={() => onGo(i, r.path)}><Icon name="target" size={14} />Show this route on the fan</button>
                    {d && <button className="link small" onClick={() => setFull(!full)}>{full ? 'Collapse shared stretches' : 'Show the full chain'}</button>}
                  </div>
                </div>)}
            </li>)
        })}
      </ol>
      {routes.length > 5 && <button className="link" onClick={() => setMore(!more)}>{more ? 'Show fewer routes' : `Show ${routes.length - 5} more routes`}</button>}
      {more && all > routes.length + 0.5 && <p className="muted small">Showing the {routes.length} most likely of {fmtCount(all)} routes.</p>}
    </section>
  )
}

/** the people on a route; stretches shared with the reference route collapse into a chip, differing people are highlighted */
function chainRows(r: Route, d: RouteDiff | null, full: boolean, onGo: (i: number, path?: number[]) => void) {
  const n = r.path.length
  const rows: ReactNode[] = []
  const row = (j: number) => {
    const x = r.path[j]
    const v = j > 0 ? linkVerdict(r.path[j - 1], x) : null
    const kind = d?.kind[j]
    const tags: string[] = []
    if (d && kind === 'pivot') {
      if (d.splits.some(s => s.from === j)) tags.push('routes split here')
      if (d.splits.some(s => s.to === j)) tags.push(`rejoins route ${d.refName}`)
    }
    return (
      <li key={j} className={[v ? 'flag-' + v : '', kind === 'diff' ? 'rd-diff' : '', kind === 'pivot' ? 'rd-pivot' : ''].filter(Boolean).join(' ')}>
        <button onClick={() => onGo(x, r.path.slice(0, j + 1))}>
          <span className="ll-name">{j === 0 ? 'You' : displayName(x)}{tags.map(t => <span key={t} className="rd-tag">{t}</span>)}{v && <span className={'ll-flag ' + v} title={v === 'disproven' ? 'Research disproved this parent link' : 'No evidence supports this parent link yet'}>{v === 'disproven' ? ' ✕ disproven link' : ' ? unproven link'}</span>}</span>
          <span className="ll-yrs">{years(x)}</span>
        </button>
      </li>)
  }
  let j = 0
  while (j < n) {
    if (d && !full && d.kind[j] === 'shared' && j !== 0 && j !== n - 1) {
      let e = j
      while (e + 1 < n - 1 && d.kind[e + 1] === 'shared') e++
      const cnt = e - j + 1
      if (cnt >= 2) {
        rows.push(<li key={'c' + j} className="rd-chip"><span>{cnt} generations shared with route {d.refName}</span></li>)
        j = e + 1
        continue
      }
    }
    rows.push(row(j)); j++
  }
  return rows
}

function Lightbox({ photos, at, onClose, onAt }: { photos: NonNullable<Detail['photos']>; at: number; onClose: () => void; onAt: (n: number) => void }) {
  const p = photos[at]
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight') onAt((at + 1) % photos.length); if (e.key === 'ArrowLeft') onAt((at - 1 + photos.length) % photos.length) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [at, photos.length, onAt, onClose])
  const src = p.file ? `./media/${p.file}` : (p.url || p.thumb)
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <figure onClick={e => e.stopPropagation()}>
        <img src={src} alt={p.title || ''} />
        <figcaption>{p.title && <span>{p.title}</span>}<span className="muted">{p.source}</span>{p.page && <a href={p.page} target="_blank" rel="noreferrer">Source <Icon name="ext" size={12} /></a>}<span className="muted">{at + 1} / {photos.length}</span></figcaption>
      </figure>
      {photos.length > 1 && <>
        <button className="lb-nav prev" onClick={e => { e.stopPropagation(); onAt((at - 1 + photos.length) % photos.length) }}>‹</button>
        <button className="lb-nav next" onClick={e => { e.stopPropagation(); onAt((at + 1) % photos.length) }}>›</button>
      </>}
    </div>
  )
}
