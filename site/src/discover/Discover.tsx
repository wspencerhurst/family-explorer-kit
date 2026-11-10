import { useEffect, useMemo, useState } from 'react'
import { C, FL, ahnPath, ancestorPath, displayName, loadJSON, normalize, portraitUrl, relationLabel, sideOf, years, getRouteCounts, fmtCount } from '../store'
import { Icon } from '../components/Icon'

interface ChainP { fs?: string; qid?: string; name?: string; life?: string; born?: number; died?: number }
interface KRoute { rel: string; ca: number; caName?: string; line?: string[] | null; steps?: [number, number]; conf?: string | null; chain?: ChainP[] | null; source?: string; side?: 'paternal' | 'maternal' | 'both' | null }
interface Cousin { routes?: KRoute[]; side?: string | null; name: string; desc?: string; born?: number; died?: number; fame?: number; rel: string; ca: number; caName?: string; line?: string[]; steps?: [number, number]; conf?: string; fs?: string; qid?: string; img?: string; chain?: ChainP[] | null; source?: string }
interface Notables {
  ancestors: { i: number; text: string }[]
  cousins: Cousin[]
  royal: { i: number; desc?: string; born?: number; fame?: number; gateway?: string; up?: number; accepted: boolean; tier?: string }[]
  immigrants: { i: number; year?: string; from?: string; evidence?: string }[]
  military: { i: number; text: string }[]
  legends: { legend: string; verdict: string; basis?: string; task?: string }[]
  walls: { i: number; missing: string[] }[]
}
interface Memorial { people: { name: string; description?: string; place?: string; year?: string; notes?: string; by: number }[]; counts: { year: number; place: string; count: number; confidence?: string; enumeratedAs?: string; url?: string; persons?: [string, string][]; note?: string; by: number }[] }
interface Cons { rootF: number; rootFclean: number; note: string; couples: { child: number; f: number; m: number; F: number; Fclean: number; n1: number; n2: number; label: string; gen: number; nCommon: number; suspect: boolean; ca: number[] }[] }

type Tab = 'cousins' | 'ancestors' | 'royal' | 'immigrants' | 'military' | 'legends' | 'walls' | 'collapse' | 'enslaved'
const TABS: [Tab, string, string][] = [
  ['cousins', 'Famous cousins', 'star'], ['ancestors', 'Notable ancestors', 'crown'], ['royal', 'Royal & noble lines', 'shield'],
  ['immigrants', 'Immigrants', 'ship'], ['military', 'Soldiers & patriots', 'flag'], ['legends', 'Family legends', 'book'],
  ['walls', 'Brick walls', 'warn'], ['collapse', 'Collapse & cousin marriages', 'people'], ['enslaved', 'Enslaved people', 'book'],
]

export function Discover({ onGo, initialTab }: { onGo: (i: number) => void; initialTab?: string }) {
  const [n, setN] = useState<Notables | null>(null)
  const [mem, setMem] = useState<Memorial | null>(null)
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || 'cousins')
  const [q, setQ] = useState('')
  useEffect(() => { loadJSON<Notables>('notables.json').then(setN); loadJSON<Memorial>('memorial.json').then(setMem) }, [])
  const nq = normalize(q)
  const m = (s: string) => !nq || normalize(s).includes(nq)

  return (
    <div className="discover">
      <div className="d-head">
        <div>
          <h1>Discover</h1>
          <p className="lede">Famous relatives, remarkable ancestors, and the stories research has confirmed — or overturned.</p>
        </div>
        <label className="d-filter"><Icon name="search" size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter this list…" /></label>
      </div>
      <div className="d-tabs" role="tablist">
        {TABS.map(([k, l, ic]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon name={ic} size={15} />{l}{n && <span className="count">{countOf(n, mem, k)}</span>}</button>)}
      </div>
      {!n ? <div className="p-loading"><div className="spinner" /></div> : (
        <div className="d-body">
          {tab === 'cousins' && <Cousins list={n.cousins.filter(x => m(x.name + ' ' + (x.desc ?? '') + ' ' + (x.caName ?? '')))} onGo={onGo} />}
          {tab === 'ancestors' && <Grid items={n.ancestors.filter(x => m(displayName(x.i) + ' ' + x.text)).map(x => ({ i: x.i, text: x.text }))} onGo={onGo} />}
          {tab === 'royal' && <Royal list={n.royal.filter(x => x.i >= 0 && m(displayName(x.i) + ' ' + (x.desc ?? '')))} onGo={onGo} />}
          {tab === 'immigrants' && <Immigrants list={n.immigrants.filter(x => m(displayName(x.i) + ' ' + (x.from ?? '')))} onGo={onGo} />}
          {tab === 'military' && <Grid items={n.military.filter(x => m(displayName(x.i) + ' ' + x.text)).sort((a, b) => (C().birth[a.i] || 0) - (C().birth[b.i] || 0)).map(x => ({ i: x.i, text: x.text }))} onGo={onGo} />}
          {tab === 'legends' && <Legends list={n.legends.filter(x => m(x.legend + ' ' + x.verdict))} />}
          {tab === 'walls' && <Walls list={n.walls.filter(x => m(displayName(x.i)))} onGo={onGo} />}
          {tab === 'enslaved' && mem && <EnslavedView mem={mem} filter={m} onGo={onGo} />}
          {tab === 'collapse' && <CollapseView filter={m} onGo={onGo} />}
        </div>
      )}
    </div>
  )
}

function countOf(n: Notables, mem: Memorial | null, k: Tab) {
  switch (k) {
    case 'cousins': return n.cousins.length; case 'ancestors': return n.ancestors.length; case 'royal': return n.royal.filter(r => r.i >= 0).length
    case 'immigrants': return n.immigrants.length; case 'military': return n.military.length; case 'legends': return n.legends.length
    case 'walls': return n.walls.length; case 'enslaved': return mem ? (mem.people.length + mem.counts.reduce((s, c) => s + (c.by >= 0 ? c.count : 0), 0)).toLocaleString() : ''
    case 'collapse': return ''
  }
}

/** tidy descriptions: drop replacement characters, <place> junk and a trailing (years) that is already in the text */
function cleanDesc(d?: string): string {
  if (!d) return ''
  let s = d.replace(/�/g, '–').replace(/\s*<[^>]*>/g, '').trim()
  const m = s.match(/\s*\((\d{3,4})\s*[-–—]\s*(\d{0,4})\)\s*$/)
  if (m) s = s.slice(0, m.index)   // trailing (years) is shown elsewhere (born ...)
  s = s.trim()
  return /^[\d\s\-–?]*$/.test(s) ? '' : s
}

/** caveat for people whose line to you passes through a disproven / unproven link */
function caveat(i: number): string {
  const f = C().flags[i]
  return f & FL.disproven ? 'Link disproven' : (f & (FL.doubtful | FL.unproven)) ? 'Line unproven' : ''
}

function Avatar({ i, size = 52 }: { i: number; size?: number }) {
  const pu = i >= 0 ? portraitUrl(i) : null
  const nm = i >= 0 ? displayName(i) : '?'
  return <span className="avatar" style={{ width: size, height: size }}>{pu ? <img src={pu} alt="" loading="lazy" /> : nm.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('')}</span>
}

export function KinAvatar({ fs, small }: { fs?: string; small?: boolean }) {
  const [ok, setOk] = useState(!!fs)
  return (
    <span className={'avatar star' + (small ? ' small' : '')}>
      {ok && fs ? <img src={`./portraits/kin/${fs}.jpg`} alt="" loading="lazy" onError={() => setOk(false)} /> : <Icon name="star" size={small ? 16 : 22} />}
    </span>)
}

function Grid({ items, onGo }: { items: { i: number; text: string }[]; onGo: (i: number) => void }) {
  if (!items.length) return <Empty />
  return (
    <div className="cards">
      {items.map((x, k) => (
        <button key={k} className="card" onClick={() => onGo(x.i)}>
          <Avatar i={x.i} />
          <div className="card-main">
            <div className="card-name">{displayName(x.i)}</div>
            <div className="card-sub">{[years(x.i), relationLabel(x.i), sideOf(x.i)].filter(Boolean).join(' · ')}</div>
            <div className="card-text">{x.text}</div>
            {caveat(x.i) && <div className="card-tag">{caveat(x.i)}</div>}
          </div>
        </button>))}
    </div>
  )
}

const SIDE_LABEL: Record<string, string> = { paternal: "father's side", maternal: "mother's side", both: 'both sides' }
function routesOf(c: Cousin): KRoute[] {
  return c.routes && c.routes.length ? c.routes : [{ rel: c.rel, ca: c.ca, caName: c.caName, line: c.line, steps: c.steps, conf: c.conf, chain: c.chain, source: c.source, side: c.side as KRoute['side'] }]
}
function routeSummary(c: Cousin, rs: KRoute[]): string {
  const sides = new Set(rs.map(r => r.side).filter(Boolean))
  const both = sides.has('both') || (sides.has('paternal') && sides.has('maternal'))
  const first = c.name.split(',')[0].split(' ')[0]
  return both ? `You're related to ${first} through both of your parents' families.` : `${rs.length} separate lines connect you.`
}
/** your line from the common ancestor down to you, going up through the parent that belongs to this route's side */
function mineFor(r: KRoute): number[] {
  if (r.ca < 0) return []
  let up = ahnPath(r.ca)
  const side = r.side
  if ((side === 'paternal' || side === 'maternal') && sideOf(r.ca) !== side) {
    const c = C(); const par = side === 'paternal' ? c.father[c.root] : c.mother[c.root]
    const sub = par >= 0 ? ancestorPath(par, r.ca) : null
    if (sub) up = [c.root, ...sub]
  }
  return up ? up.slice(0, -1).reverse() : []
}

function Cousins({ list, onGo }: { list: Cousin[]; onGo: (i: number) => void }) {
  const [sort, setSort] = useState<'close' | 'fame' | 'born'>('close')
  const [era, setEra] = useState<'all' | 'modern' | 'living'>('all')
  const [open, setOpen] = useState<number | null>(null)
  const sorted = useMemo(() => {
    const l = list.map((x, k) => ({ x, k })).filter(({ x }) => era === 'all' || (era === 'modern' ? (x.born ?? 0) >= 1900 : (x.born ?? 0) >= 1920 && !x.died && x.source === 'wikidata'))
    if (sort === 'close') l.sort((a, b) => (a.x.steps![0] + a.x.steps![1]) - (b.x.steps![0] + b.x.steps![1]) || (b.x.fame ?? 0) - (a.x.fame ?? 0))
    if (sort === 'fame') l.sort((a, b) => (b.x.fame ?? 0) - (a.x.fame ?? 0))
    if (sort === 'born') l.sort((a, b) => (a.x.born ?? 0) - (b.x.born ?? 0))
    return l
  }, [list, sort, era])
  if (!list.length) return <Empty />
  return (
    <>
      <div className="d-sort"><div className="seg small">{(['all', 'modern', 'living'] as const).map(e => <button key={e} className={era === e ? 'on' : ''} onClick={() => setEra(e)}>{{ all: 'All eras', modern: 'Born 1900+', living: 'Possibly living' }[e]}</button>)}</div> Sort by <div className="seg small">{(['close', 'fame', 'born'] as const).map(s => <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>{{ close: 'Closest', fame: 'Most famous', born: 'Era' }[s]}</button>)}</div></div>
      <div className="cards">
        {sorted.slice(0, 300).map(({ x, k }) => (
          <div key={k} className={'card cousin' + (open === k ? ' open' : '')}>
            <button className="card-hit" onClick={() => setOpen(open === k ? null : k)}>
              <KinAvatar fs={x.fs ?? x.qid} />
              <div className="card-main">
                <div className="card-name">{x.name}</div>
                <div className="card-sub">Your {routesOf(x)[0].rel}{routesOf(x)[0].side ? ` · ${SIDE_LABEL[routesOf(x)[0].side!]}` : ''}{routesOf(x).length > 1 ? ` · +${routesOf(x).length - 1} more route${routesOf(x).length > 2 ? 's' : ''}` : ''}{x.born ? ` · b. ${x.born}` : ''}</div>
                {cleanDesc(x.desc) && <div className="card-text">{cleanDesc(x.desc)}</div>}
              </div>
            </button>
            {open === k && <Kinship c={x} onGo={onGo} />}
          </div>))}
      </div>
      {sorted.length > 300 && <p className="muted center">Showing 300 of {sorted.length}. Use the filter to find others.</p>}
    </>
  )
}

function KinNode({ i, p, you, ca, end }: { i?: number; p?: ChainP; you?: boolean; ca?: boolean; end?: boolean }) {
  const c = C()
  const name = i !== undefined ? (you ? 'You' : displayName(i)) : (p?.name ?? '?')
  const yrs = i !== undefined ? years(i) : (p?.life ?? [p?.born, p?.died].filter(Boolean).join('–'))
  const pu = i !== undefined ? portraitUrl(i) : null
  const flag = i !== undefined && (c.flags[i] & FL.disproven ? 'disproven' : c.flags[i] & FL.doubtful ? 'unproven' : '')
  return (
    <div className={'kt-node' + (ca ? ' ca' : '') + (end ? ' end' : '') + (you ? ' you' : '') + (flag ? ' ' + flag : '')}>
      <span className="kt-img">{pu ? <img src={pu} alt="" /> : end ? <Icon name="star" size={14} /> : name.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('')}</span>
      <span className="kt-text"><b>{name}</b><span>{yrs}</span></span>
    </div>)
}

function Kinship({ c: cousin, onGo }: { c: Cousin; onGo: (i: number) => void }) {
  const rs = routesOf(cousin)
  const [ri, setRi] = useState(0)
  const r = rs[Math.min(ri, rs.length - 1)]
  const c = { ...cousin, ...r }                            // the selected route's fields override the cousin's top-level ones
  const mine = mineFor(r)                                   // child of CA ... you (through the right parent for this route)
  // their side: prefer the documented chain (CA's child ... notable); otherwise the names list
  let theirs: ChainP[] = []
  if (c.chain && c.chain.length) theirs = c.chain
  else theirs = [...(c.line ?? []).slice(1, -1).reverse().map(n => ({ name: n })), { name: c.name, born: c.born }]
  if (theirs.length && (theirs[theirs.length - 1].name ?? '').toLowerCase() !== c.name.toLowerCase() && !c.chain) theirs.push({ name: c.name, born: c.born })
  const rows = Math.max(mine.length, theirs.length)
  const conf = c.ca >= 0 ? C().conf[c.ca] : 2
  const routeLabel = (x: KRoute, n: number) => `Route ${n + 1}${x.side ? ' · ' + SIDE_LABEL[x.side] : ''} · ${x.rel}${x.caName ? ' via ' + x.caName.replace(/\s*\(.*?\)/g, '').split(/\s+(?:of|the)\s/)[0] : ''}`
  return (
    <div className="kinship">
      {rs.length > 1 && <>
        <p className="kt-routes-note">{routeSummary(cousin, rs)}</p>
        <div className="kt-routes" role="tablist">{rs.map((x, n) => <button key={n} role="tab" aria-selected={n === ri} className={n === ri ? 'on' : ''} onClick={() => setRi(n)}>{routeLabel(x, n)}</button>)}</div>
      </>}
      <div className="kt" style={{ ['--rows' as any]: rows }}>
        <div className="kt-top">
          {c.ca >= 0 ? <button onClick={() => onGo(c.ca)}><KinNode i={c.ca} ca /></button> : <KinNode p={{ name: c.caName }} ca />}
          <div className="kt-note">common ancestor</div>
        </div>
        <svg className="kt-fork" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path d="M50 0 V10 M25 24 V10 H75 V24" /></svg>
        <div className="kt-cols">
          <ol className="kt-col">
            <li className="kt-head">Your line · {mine.length} generations</li>
            {mine.map((i, k) => <li key={k}><button onClick={() => onGo(i)}><KinNode i={i} you={k === mine.length - 1} /></button></li>)}
          </ol>
          <ol className="kt-col">
            <li className="kt-head">{c.name.split(' ')[0]}'s line · {theirs.length} generations</li>
            {theirs.map((p, k) => <li key={k}>{p.fs ? <a href={`https://www.familysearch.org/tree/person/details/${p.fs}`} target="_blank" rel="noreferrer"><KinNode p={p} end={k === theirs.length - 1} /></a> : p.qid ? <a href={`https://www.wikidata.org/wiki/${p.qid}`} target="_blank" rel="noreferrer"><KinNode p={p} end={k === theirs.length - 1} /></a> : <KinNode p={p} end={k === theirs.length - 1} />}</li>)}
          </ol>
        </div>
      </div>
      <div className="kin-foot">
        <span className="muted small">You are {c.rel.startsWith('half') ? '' : ''}<b>{c.rel}</b>. Your line to {c.caName} is {conf <= 1 ? 'documented' : 'from family trees'}{c.conf ? (/^UNSUPPORTED/.test(c.conf) ? `. Caution: ${c.conf.replace(/^UNSUPPORTED\s*[–-]\s*/, 'this relationship rests on a link research rejected: ')}` : `; their line is ${c.conf.toLowerCase()}`) : ''}{r.source === 'wikidata' ? ' (their line from Wikidata)' : ''}.</span>
        {c.ca >= 0 && <button className="btn small" onClick={() => onGo(c.ca)}><Icon name="target" size={14} />Show common ancestor</button>}
        {c.fs && <a className="btn small ghost" href={`https://www.familysearch.org/tree/person/details/${c.fs}`} target="_blank" rel="noreferrer">FamilySearch<Icon name="ext" size={12} /></a>}
        {c.qid && <a className="btn small ghost" href={`https://www.wikidata.org/wiki/${c.qid}`} target="_blank" rel="noreferrer">Wikidata<Icon name="ext" size={12} /></a>}
      </div>
    </div>
  )
}

function Royal({ list, onGo }: { list: Notables['royal']; onGo: (i: number) => void }) {
  const [acc, setAcc] = useState(true)
  // the same person can be reached through several gateways (pedigree collapse): show one card listing them all
  const byI = new Map<number, Notables['royal'][number] & { gws: string[] }>()
  for (const r of list.filter(r => r.accepted === acc)) {
    const e = byI.get(r.i)
    if (!e) byI.set(r.i, { ...r, gws: r.gateway ? [r.gateway] : [] })
    else if (r.gateway && !e.gws.includes(r.gateway)) e.gws.push(r.gateway)
  }
  const l = [...byI.values()].sort((a, b) => (b.fame ?? 0) - (a.fame ?? 0))
  return (
    <>
      <div className="d-note">
        <div className="seg small"><button className={acc ? 'on' : ''} onClick={() => setAcc(true)}>Through accepted gateways</button><button className={!acc ? 'on' : ''} onClick={() => setAcc(false)}>Tree-only claims</button></div>
        <p className="muted small">{acc
          ? 'Reached through colonial immigrants whose royal or noble ancestry is accepted by scholarly genealogists (e.g. Roberts, Royal Descents of 900 Immigrants; Richardson, Plantagenet Ancestry), with no doubtful link on the way. The medieval steps still come from online trees.'
          : 'Claims that exist only in online trees, or pass through a link research found doubtful. Treat as unproven.'}</p>
      </div>
      <div className="cards">
        {l.slice(0, 240).map((r, k) => (
          <button key={k} className="card" onClick={() => onGo(r.i)}>
            <Avatar i={r.i} />
            <div className="card-main">
              <div className="card-name">{displayName(r.i)}</div>
              <div className="card-sub">{[r.born && `b. ${r.born}`, relationLabel(r.i)].filter(Boolean).join(' · ')}</div>
              {cleanDesc(r.desc) && <div className="card-text">{cleanDesc(r.desc)}</div>}
              {r.gws.length > 0 && <div className="card-tag">via {r.gws.join('; ')}</div>}
              {caveat(r.i) && <div className="card-tag">{caveat(r.i)}</div>}
            </div>
          </button>))}
      </div>
      {!l.length && <Empty />}
    </>
  )
}

function Immigrants({ list, onGo }: { list: Notables['immigrants']; onGo: (i: number) => void }) {
  const yr = (s?: string) => Number((s ?? '').match(/\d{4}/)?.[0] ?? 9999)
  const l = [...list].sort((a, b) => yr(a.year) - yr(b.year))
  if (!l.length) return <Empty />
  return (
    <ol className="vtimeline">
      {l.map((x, k) => (
        <li key={k}>
          <div className="vt-year">{x.year ?? '—'}</div>
          <button className="vt-card" onClick={() => onGo(x.i)}>
            <Avatar i={x.i} size={40} />
            <div><div className="card-name">{displayName(x.i)}</div><div className="card-sub">{[years(x.i), relationLabel(x.i), sideOf(x.i)].filter(Boolean).join(' · ')}</div>{x.from && <div className="card-text">From {x.from}</div>}{caveat(x.i) && <div className="card-tag">{caveat(x.i)}</div>}{x.evidence && <div className="muted small">{x.evidence}</div>}</div>
          </button>
        </li>))}
    </ol>
  )
}

function Legends({ list }: { list: Notables['legends'] }) {
  if (!list.length) return <Empty />
  const kind = (v: string) => /^(DISPROVEN|FALSE|REFUTED|NOT)/i.test(v) ? 'no' : /^(CONFIRMED|TRUE|PROVEN|SUPPORTED)/i.test(v) ? 'yes' : 'maybe'
  return (
    <div className="legends">
      {list.map((l, k) => (
        <article key={k} className={'legend-card ' + kind(l.verdict)}>
          <div className="lg-claim">“{l.legend}”</div>
          <div className="lg-verdict">{l.verdict}</div>
          {l.basis && <div className="muted small">{String(l.basis).slice(0, 400)}</div>}
        </article>))}
    </div>
  )
}

function Walls({ list, onGo }: { list: Notables['walls']; onGo: (i: number) => void }) {
  const l = [...list].sort((a, b) => C().gen[a.i] - C().gen[b.i])
  if (!l.length) return <Empty />
  return (
    <>
      <p className="muted d-note">Ancestors within ten generations whose parents haven’t been identified yet. These are the best targets for future research.</p>
      <div className="cards compact">
        {l.map((w, k) => (
          <button key={k} className="card" onClick={() => onGo(w.i)}>
            <Avatar i={w.i} size={40} />
            <div className="card-main"><div className="card-name">{displayName(w.i)}</div><div className="card-sub">{[years(w.i), relationLabel(w.i)].filter(Boolean).join(' · ')}</div><div className="card-tag">Missing {w.missing.join(' & ')}</div></div>
          </button>))}
      </div>
    </>
  )
}

function EnslavedView({ mem, filter, onGo }: { mem: Memorial; filter: (s: string) => boolean; onGo: (i: number) => void }) {
  const named = useMemo(() => {
    const g = new Map<number, Memorial['people']>()
    for (const p of mem.people) { if (!filter(p.name + ' ' + (p.place ?? '') + ' ' + (p.by >= 0 ? displayName(p.by) : ''))) continue; const a = g.get(p.by) ?? []; a.push(p); g.set(p.by, a) }
    return [...g.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [mem, filter])
  const counts = mem.counts.filter(c => c.by >= 0 && filter(displayName(c.by) + ' ' + c.place)).sort((a, b) => (C().gen[a.by] - C().gen[b.by]) || a.year - b.year)
  const total = mem.counts.reduce((s, c) => s + (c.by >= 0 ? c.count : 0), 0)
  const itemized = mem.counts.reduce((s, c) => s + (c.persons?.length ?? 0), 0)
  return (
    <div className="memorial-page">
      <div className="mem-intro">
        <p>Records found so far show that {new Set([...mem.people.map(p => p.by), ...mem.counts.map(c => c.by)].filter(x => x >= 0)).size} of your ancestors held people in slavery. This section lists every enslaved person identified in those records: <b>{mem.people.length.toLocaleString()}</b> named in wills, estate inventories and court papers, and <b>{total.toLocaleString()}</b> counted in the 1850 and 1860 U.S. census slave schedules, which recorded people by sex and age but almost never by name.</p>
        <p className="muted small">Census matches are labelled by how certain the identification of the slaveholder is. {itemized ? `${itemized.toLocaleString()} individual census entries are listed below.` : ''}</p>
      </div>
      <h2 className="sec-title">Census slave schedules, 1850 & 1860</h2>
      <div className="sched">
        {counts.map((c, k) => (
          <section key={k} className="sched-row">
            <div className="sched-head">
              <div><button className="link sched-name" onClick={() => onGo(c.by)}>{displayName(c.by)}</button> <span className="muted small">{years(c.by)} · {relationLabel(c.by)}</span></div>
              <div className="sched-meta"><b>{c.count}</b> {c.count === 1 ? 'person' : 'people'} · {c.year} · {c.place}{c.confidence && c.confidence !== 'CONFIRMED' ? <span className="badge" style={{ marginLeft: 6 }}>{c.confidence.toLowerCase()} match</span> : null}{c.url && <a href={c.url} target="_blank" rel="noreferrer" className="small"> record <Icon name="ext" size={11} /></a>}</div>
            </div>
            {c.persons && c.persons.length > 0
              ? <><ul className="sched-people">{c.persons.map(([sx, age], j) => <li key={j} className={sx === 'F' ? 'f' : sx === 'M' ? 'm' : ''}>{sx === 'F' ? 'Female' : sx === 'M' ? 'Male' : 'Unknown'}{age ? `, ${age.includes('/') ? age.replace(/\/12$/, '') + ' months' : age}` : ''}</li>)}</ul>
                {c.persons.length < c.count && <p className="muted small">The first {c.persons.length} of {c.count} entries are listed; open the record for the rest.</p>}</>
              : <p className="muted small">The schedule lists {c.count} {c.count === 1 ? 'person' : 'people'} by sex and age; the itemized entries have not been transcribed here yet{c.enumeratedAs ? ` (enumerated as “${c.enumeratedAs}”)` : ''}.</p>}
          </section>))}
      </div>
      <h2 className="sec-title">Named in wills, inventories and court records</h2>
      {named.map(([by, ppl]) => (
        <section key={by} className="mem-group">
          <h3>{by >= 0 ? <button className="link" onClick={() => onGo(by)}>{displayName(by)}</button> : 'Unattributed'} <span className="muted small">{by >= 0 ? years(by) : ''} · {ppl.length} named</span></h3>
          <ul className="m-names">{ppl.map((p, k) => <li key={k} title={[p.description, p.place, p.year, p.notes].filter(Boolean).join(' · ')}>{p.name}{p.description && <span className="muted small"> — {p.description.replace(p.name, '').trim()}</span>}</li>)}</ul>
        </section>))}
    </div>
  )
}

function CollapseView({ filter, onGo }: { filter: (s: string) => boolean; onGo: (i: number) => void }) {
  const [cons, setCons] = useState<Cons | null>(null)
  const [showSuspect, setShowSuspect] = useState(false)
  const [showDoubt, setShowDoubt] = useState(false)
  useEffect(() => { loadJSON<Cons>('consanguinity.json').then(setCons).catch(() => setCons(null)) }, [])
  const c = C()
  const repeated = useMemo(() => {
    const rc = getRouteCounts().all
    const out: number[] = []
    for (let i = 0; i < c.N; i++) if (rc[i] > 1.5 && c.gen[i] >= 0 && !(c.flags[i] & FL.doubtful) && c.tier[i] <= 1) out.push(i)
    return out.sort((a, b) => rc[b] - rc[a] || c.gen[a] - c.gen[b]).slice(0, 60)
  }, [c])
  if (!cons) return <div className="p-loading"><div className="spinner" /></div>
  const parents = cons.couples.find(x => x.child === c.root)
  const list = cons.couples.filter(x => x.child !== c.root && (showSuspect || !x.suspect) && (showDoubt || !(c.flags[x.child] & FL.doubtful) && c.tier[x.child] <= 2) && filter(displayName(x.f) + ' ' + displayName(x.m) + ' ' + displayName(x.child)))
  const pct = (f: number) => (f * 100 < 0.01 ? (f * 100).toFixed(4) : (f * 100).toFixed(2)) + '%'
  return (
    <div className="collapse-page">
      <div className="mem-intro">
        <p><b>Pedigree collapse</b> happens when the same ancestors appear more than once in your tree, because their descendants married relatives. Go back far enough and it is universal: 30 generations would need over a billion separate ancestors.</p>
        <p>{parents ? <>Your parents are <b>{parents.label}</b>, related through {parents.ca.filter(x => x >= 0).slice(0, 2).map(x => displayName(x)).join(' and ')}. </> : null}Your inbreeding coefficient is about <b>{pct(cons.rootF)}</b> ({pct(cons.rootFclean)} counting only links research hasn't disproved). For scale, a child of first cousins is 6.25%; values under 0.1% are typical of any colonial American family.</p>
        <p className="muted small">{cons.note}</p>
      </div>
      <h2 className="sec-title">Ancestors you descend from many times</h2>
      <p className="muted small">Documented and tree-level ancestors (excluding medieval and doubtful lines) ranked by how many distinct routes lead from you to them. Open anyone to see every route, most likely first.</p>
      <div className="cards compact">
        {repeated.map(i => (
          <button key={i} className="card" onClick={() => onGo(i)}>
            <span className="avatar" style={{ width: 40, height: 40 }}>{portraitUrl(i) ? <img src={portraitUrl(i)!} alt="" /> : displayName(i).split(/\s+/).map(w => w[0]).slice(0, 2).join('')}</span>
            <div className="card-main"><div className="card-name">{displayName(i)}</div><div className="card-sub">{[years(i), relationLabel(i)].filter(Boolean).join(' · ')}</div><div className="card-tag">{fmtCount(getRouteCounts().all[i])} routes</div></div>
          </button>))}
      </div>
      <h2 className="sec-title">Couples in your tree who were related</h2>
      <div className="d-sort">
        <label className="switch"><input type="checkbox" checked={showDoubt} onChange={e => setShowDoubt(e.target.checked)} /><span />Include medieval & doubtful lines</label>
        <label className="switch"><input type="checkbox" checked={showSuspect} onChange={e => setShowSuspect(e.target.checked)} /><span />Include implausible (sibling/parent-level) pairs</label>
        <span className="muted small">{list.length.toLocaleString()} couples</span>
      </div>
      {showSuspect && <p className="muted small">Pairs recorded as siblings or parent and child are almost always duplicate or mistaken links in online trees, not real incest.</p>}
      <div className="table-wrap">
        <table className="data-table cons-table">
          <thead><tr><th>Couple</th><th>Related as</th><th>Child's F</th><th>Their child (your ancestor)</th><th>Gen</th></tr></thead>
          <tbody>{list.slice(0, 400).map((x, k) => (
            <tr key={k} className={x.suspect ? 'suspect' : ''}>
              <td><button className="link" onClick={() => onGo(x.f)}>{displayName(x.f)}</button> &amp; <button className="link" onClick={() => onGo(x.m)}>{displayName(x.m)}</button></td>
              <td>{x.label}{x.suspect ? ' ⚠' : ''}</td>
              <td>{pct(x.F)}</td>
              <td><button className="link" onClick={() => onGo(x.child)}>{displayName(x.child)}</button> <span className="muted small">{years(x.child)}</span></td>
              <td>{x.gen}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {list.length > 400 && <p className="muted small center">Showing the 400 closest to you. Use the filter to find others.</p>}
    </div>
  )
}

function Empty() { return <p className="muted center">Nothing matches.</p> }
