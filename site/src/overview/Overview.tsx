import { FAMILY } from '../family'
import { useEffect, useMemo, useState } from 'react'
import { C, loadJSON, portraitUrl, displayName, years } from '../store'
import { COUNTRIES, countryColor } from '../colors'
import { Icon } from '../components/Icon'
import { KinAvatar } from '../discover/Discover'

interface Stats {
  people: number; pedigree: number; alternate: number; byGeneration: Record<string, number>; tiers: Record<string, number>; confidence: Record<string, number>
  portraits: number; photos: number; sources: number; places: number; geoEvents: number; countries: string[]; countryByGen: Record<string, Record<string, number>>
  maxGeneration: number; notableCousins: number; royal: number; enslaved: number
}

export function Overview({ dark, go }: { dark: boolean; go: (route: string, i?: number) => void }) {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => { loadJSON<Stats>('stats.json').then(setS) }, [])
  if (!s) return <div className="p-loading"><div className="spinner" /></div>
  const conf = s.confidence
  const docd = (conf.CONFIRMED ?? 0) + (conf.PROBABLE ?? 0)
  const root = C().root
  return (
    <div className="overview">
      <section className="ov-hero">
        <div className="ov-hero-text">
          <div className="eyebrow">The family of</div>
          <h1>{displayName(root)}</h1>
          <p className="lede">{s.pedigree.toLocaleString()} ancestors traced across {s.maxGeneration} generations{FAMILY.overviewLede ? <> — {FAMILY.overviewLede}</> : '.'}</p>
          <div className="ov-cta">
            <button className="btn primary" onClick={() => go('tree')}><Icon name="fan" size={17} />Explore the tree</button>
            <button className="btn" onClick={() => go('map')}><Icon name="map" size={17} />See where they lived</button>
            <button className="btn" onClick={() => go('discover')}><Icon name="star" size={17} />Famous relatives</button>
          </div>
        </div>
        <MiniFan />
      </section>

      <section className="kpis">
        <Kpi v={s.pedigree} l="ancestors in the tree" />
        <Kpi v={docd} l="documented by records" sub={`${conf.CONFIRMED ?? 0} confirmed · ${conf.PROBABLE ?? 0} probable`} />
        <Kpi v={s.notableCousins} l="notable cousins found" />
        <Kpi v={s.places} l="places mapped" />
        <Kpi v={s.portraits} l="portraits" sub={`${s.photos.toLocaleString()} photos & images`} />
        <Kpi v={s.sources} l="sources & citations" />
      </section>

      <section className="ov-grid">
        <Completeness s={s} />
        <Origins s={s} dark={dark} />
      </section>

      <section className="ov-grid">
        <div className="ov-card">
          <h2>How sure is each ancestor?</h2>
          <p className="muted">Every person carries an evidence label. Explore freely, but trust the labels.</p>
          <ul className="evidence">
            <li><span className="badge ok">Confirmed</span>Records name the relationship: birth, marriage or death records, wills, censuses.</li>
            <li><span className="badge prob">Probable</span>Strong circumstantial evidence or a reliable published genealogy.</li>
            <li><span className="badge tree">Tree · unverified</span>From FamilySearch or other trees, not yet checked against records.</li>
            <li><span className="badge med">Medieval</span>Older lines from online trees. Some are well known; many are copied without proof.</li>
            <li><span className="badge leg">Legendary</span>Ancient and mythical lines (Charlemagne’s ancestors and beyond) that trees repeat but history can’t support.</li>
            <li><span className="badge doubt">Doubtful line</span>Hangs from a parent link that research rejected. Hidden with one switch in the tree.</li>
          </ul>
        </div>
        <Closest go={go} />
      </section>
    </div>
  )
}

function Kpi({ v, l, sub }: { v: number; l: string; sub?: string }) {
  return <div className="kpi"><div className="kpi-v">{v.toLocaleString()}</div><div className="kpi-l">{l}</div>{sub && <div className="kpi-s">{sub}</div>}</div>
}

function MiniFan() {
  // decorative: the first 6 generations as a static fan
  const c = C()
  const rings = 6
  const paths: JSX.Element[] = []
  const R0 = 26, W = 22
  const visit = (i: number, g: number, a0: number, a1: number) => {
    if (g > rings) return
    if (g > 0) {
      const r0 = R0 + (g - 1) * W, r1 = r0 + W - 1.5
      const gap = 0.6 / r1
      const b0 = a0 + gap, b1 = a1 - gap
      const large = b1 - b0 > Math.PI ? 1 : 0
      const p = (r: number, a: number) => `${(150 + r * Math.cos(a)).toFixed(2)},${(150 + r * Math.sin(a)).toFixed(2)}`
      const d = `M${p(r1, b0)} A${r1},${r1} 0 ${large} 1 ${p(r1, b1)} L${p(r0, b1)} A${r0},${r0} 0 ${large} 0 ${p(r0, b0)} Z`
      const h = (((a0 + a1) / 2 - Math.PI / 2) / (2 * Math.PI)) * 360 + 205
      paths.push(<path key={paths.length} d={d} style={{ fill: `oklch(${0.72 - g * 0.035} 0.085 ${h % 360})` }} />)
    }
    const m = (a0 + a1) / 2
    if (c.father[i] >= 0) visit(c.father[i], g + 1, a0, m)
    if (c.mother[i] >= 0) visit(c.mother[i], g + 1, m, a1)
  }
  visit(c.root, 0, Math.PI / 2, Math.PI * 2.5)
  const pu = portraitUrl(c.root)
  return (
    <svg className="mini-fan" viewBox="0 0 300 300" aria-hidden="true">
      {paths}
      <circle cx="150" cy="150" r={R0 - 3} className="mf-center" />
      {pu && <image href={pu} x={150 - 20} y={150 - 20} width={40} height={40} clipPath="circle(20px)" />}
    </svg>
  )
}

function Completeness({ s }: { s: Stats }) {
  const [hov, setHov] = useState<number | null>(null)
  const gens = Array.from({ length: 16 }, (_, k) => k + 1)
  const data = gens.map(g => ({ g, n: s.byGeneration[g] ?? 0, poss: 2 ** g }))
  const W = 560, H = 220, pl = 34, pb = 26, pt = 10
  const bw = (W - pl) / data.length
  const y = (v: number) => pt + (H - pt - pb) * (1 - v)
  return (
    <div className="ov-card">
      <h2>How far back the tree reaches</h2>
      <p className="muted">Share of possible ancestors identified in each generation (you have 2 parents, 4 grandparents, 8 great-grandparents…).</p>
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Percent of ancestors known by generation">
          {[0, 0.25, 0.5, 0.75, 1].map(t => <g key={t}><line x1={pl} x2={W} y1={y(t)} y2={y(t)} className="grid" /><text x={pl - 6} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{t * 100}%</text></g>)}
          {data.map((d, k) => {
            const f = Math.min(1, d.n / d.poss)
            const x = pl + k * bw + bw * 0.18, w = bw * 0.64
            const top = y(f), h = Math.max(0, y(0) - top)
            return (
              <g key={d.g} onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)}>
                <rect x={pl + k * bw} y={pt} width={bw} height={H - pt - pb} fill="transparent" />
                <path d={roundedTop(x, top, w, h, Math.min(4, h))} className={'bar' + (hov === k ? ' hov' : '')} />
                <text x={x + w / 2} y={H - pb + 15} className="axis" textAnchor="middle">{d.g}</text>
              </g>)
          })}
        </svg>
        {hov !== null && (() => { const d = data[hov]; const f = Math.min(1, d.n / d.poss); return (
          <div className="chart-tip" style={{ left: `${((pl + (hov + 0.5) * bw) / W) * 100}%`, top: `${(y(f) / H) * 100}%` }}>
            <b>Generation {d.g}</b><span>{d.n.toLocaleString()} of {d.poss.toLocaleString()} known · {Math.round(f * 100)}%</span>
          </div>) })()}
        <div className="axis-title">Generation (1 = parents)</div>
      </div>
    </div>
  )
}
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return ''
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
}

function Origins({ s, dark }: { s: Stats; dark: boolean }) {
  const [hov, setHov] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const gens = Array.from({ length: 20 }, (_, k) => k + 1).filter(g => s.countryByGen[g])
  const rows = gens.map(g => {
    const v = s.countryByGen[g]; const tot = COUNTRIES.reduce((a, c) => a + (v[c] ?? 0), 0)
    return { g, tot, parts: COUNTRIES.map(c => ({ c, n: v[c] ?? 0, f: tot ? (v[c] ?? 0) / tot : 0 })) }
  })
  const W = 560, H = 240, pl = 34, pb = 26, pt = 8
  const bw = (W - pl) / rows.length
  return (
    <div className="ov-card">
      <div className="card-head-row">
        <h2>Where they were born, generation by generation</h2>
        <button className="btn small ghost" onClick={() => setTable(!table)}>{table ? 'Chart' : 'Table'}</button>
      </div>
      <p className="muted">Birthplaces of ancestors in each generation (excluding doubtful lines).{FAMILY.originsNote ? ' ' + FAMILY.originsNote : ''}</p>
      <div className="legend-row wrap chart-legend">{COUNTRIES.map(c => <span key={c} className="li"><span className="sw" style={{ background: countryColor(c, dark) }} />{c}</span>)}</div>
      {table ? (
        <div className="table-wrap"><table className="data-table"><thead><tr><th>Gen</th>{COUNTRIES.map(c => <th key={c}>{c}</th>)}<th>Known</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.g}><td>{r.g}</td>{r.parts.map(p => <td key={p.c}>{p.n ? `${Math.round(p.f * 100)}%` : '–'}</td>)}<td>{r.tot.toLocaleString()}</td></tr>)}</tbody></table></div>
      ) : (
        <div className="chart">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Birth country share by generation">
            {rows.map((r, k) => {
              let acc = 0
              const x = pl + k * bw + 1, w = bw - 2
              return (
                <g key={r.g} onMouseEnter={() => setHov(k)} onMouseLeave={() => setHov(null)} opacity={hov === null || hov === k ? 1 : 0.55}>
                  {r.parts.map(p => {
                    if (!p.f) return null
                    const y0 = pt + (H - pt - pb) * acc
                    acc += p.f
                    const h = (H - pt - pb) * p.f
                    const gap = h > 5 ? 1 : 0
                    return <rect key={p.c} x={x} y={y0 + gap} width={w} height={Math.max(0.5, h - 2 * gap)} rx={h > 5 ? 2 : 0} style={{ fill: countryColor(p.c, dark) }} />
                  })}
                  <text x={x + w / 2} y={H - pb + 15} className="axis" textAnchor="middle">{r.g}</text>
                </g>)
            })}
          </svg>
          {hov !== null && (
            <div className="chart-tip wide" style={{ left: `${((pl + (hov + 0.5) * bw) / W) * 100}%`, top: '8%' }}>
              <b>Generation {rows[hov].g} · {rows[hov].tot.toLocaleString()} known birthplaces</b>
              {rows[hov].parts.filter(p => p.n).sort((a, b) => b.n - a.n).map(p => <span key={p.c} className="tip-row"><i style={{ background: countryColor(p.c, dark) }} />{p.c}<em>{Math.round(p.f * 100)}%</em></span>)}
            </div>)}
          <div className="axis-title">Generation</div>
        </div>
      )}
    </div>
  )
}

function Closest({ go }: { go: (route: string, i?: number) => void }) {
  const [list, setList] = useState<any[]>([])
  useEffect(() => { loadJSON<any>('notables.json').then(n => setList([...n.cousins].sort((a: any, b: any) => (a.steps[0] + a.steps[1]) - (b.steps[0] + b.steps[1]) || (b.fame ?? 0) - (a.fame ?? 0)).slice(0, 8))) }, [])
  return (
    <div className="ov-card">
      <div className="card-head-row"><h2>Your closest famous relatives</h2><button className="btn small ghost" onClick={() => go('discover')}>All {''}<Icon name="chev" size={14} /></button></div>
      <ul className="closest">
        {list.map((k, n) => (
          <li key={n}>
            <button onClick={() => k.ca >= 0 && go('tree', k.ca)}>
              <KinAvatar fs={k.fs} small />
              <span><b>{k.name}</b><span className="muted small">{(k.desc ?? '').replace(/\s*\(\d{3,4}[–-]\d{3,4}\)\s*$/, '')}</span></span>
              <span className="rel-pill">{k.rel}</span>
            </button>
          </li>))}
      </ul>
    </div>
  )
}
