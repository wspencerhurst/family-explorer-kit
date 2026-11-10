import { useMemo } from 'react'
import { C, displayName, years, type Route } from '../store'

// A small braid diagram of the union of several routes: subject at the bottom, ancestor at the top.
// Only split / rejoin people are labelled; unbranched runs collapse into one edge ("12 generations").

const W = 360, ROW = 46, TOP = 34, BOT = 40, LANE = 44, MINGAP = 50, PAD = 58, MAXDOTS = 4

interface MEdge { from: number; to: number; mid: number[]; gens: number; routes: number[]; first: number }
interface MNode { id: number; row: number; x: number; y: number; split: boolean; join: boolean; routes: number[]; band: number; side: 'l' | 'r'; chars: number }

function buildMap(routes: Route[]) {
  const c = C()
  const succ = new Map<number, Set<number>>(), pred = new Map<number, Set<number>>()
  const er = new Map<string, number[]>()
  const nodeRoutes = new Map<number, number[]>()
  const add = (m: Map<number, Set<number>>, a: number, b: number) => { let s = m.get(a); if (!s) m.set(a, s = new Set()); s.add(b) }
  routes.forEach((r, k) => {
    r.path.forEach((x, j) => {
      let l = nodeRoutes.get(x); if (!l) nodeRoutes.set(x, l = []); l.push(k)
      if (j + 1 < r.path.length) {
        const y = r.path[j + 1]
        add(succ, x, y); add(pred, y, x)
        const key = x + '>' + y; let e = er.get(key); if (!e) er.set(key, e = []); e.push(k)
      }
    })
  })
  const subject = routes[0].path[0], target = routes[0].path[routes[0].path.length - 1]
  const size = (m: Map<number, Set<number>>, x: number) => m.get(x)?.size ?? 0
  const isLab = (x: number) => x === subject || x === target || size(succ, x) > 1 || size(pred, x) > 1
  // compressed edges between labelled people
  const edges: MEdge[] = []
  for (const x of nodeRoutes.keys()) {
    if (!isLab(x)) continue
    for (const p of succ.get(x) ?? []) {
      const mid: number[] = []
      let cur = p, guard = 0
      while (!isLab(cur) && guard++ < 500) { mid.push(cur); cur = [...succ.get(cur)!][0] }
      edges.push({ from: x, to: cur, mid, gens: mid.length + 1, routes: er.get(x + '>' + p) ?? [], first: p })
    }
  }
  // rows: longest path from the subject, long runs capped so the diagram stays compact
  const out = new Map<number, MEdge[]>(), inn = new Map<number, MEdge[]>()
  for (const e of edges) { (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e); (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e) }
  const row = new Map<number, number>([[subject, 0]])
  const indeg = new Map<number, number>()
  for (const x of nodeRoutes.keys()) if (isLab(x)) indeg.set(x, inn.get(x)?.length ?? 0)
  const queue = [subject]
  while (queue.length) {
    const x = queue.shift()!
    for (const e of out.get(x) ?? []) {
      const r = (row.get(x) ?? 0) + Math.min(e.gens, 3)
      if (r > (row.get(e.to) ?? 0)) row.set(e.to, r)
      const d = indeg.get(e.to)! - 1; indeg.set(e.to, d)
      if (d === 0) queue.push(e.to)
    }
  }
  const nodes = new Map<number, MNode>()
  for (const [id, r] of row) nodes.set(id, { id, row: r, x: W / 2, y: 0, split: size(succ, id) > 1, join: size(pred, id) > 1, routes: nodeRoutes.get(id) ?? [], band: 0, side: 'r', chars: 20 })
  const maxRow = Math.max(0, ...[...nodes.values()].map(n => n.row))
  // x positions: the main route down the middle; father branches left, mother branches right
  const byRow: MNode[][] = Array.from({ length: maxRow + 1 }, () => [])
  for (const n of nodes.values()) byRow[n.row].push(n)
  for (let r = 0; r <= maxRow; r++) {
    const list = byRow[r]
    const want = new Map<number, number>()
    for (const n of list) {
      if (n.routes.includes(0) || r === 0) { want.set(n.id, W / 2); continue }
      let sum = 0, cnt = 0
      for (const e of inn.get(n.id) ?? []) {
        const ch = nodes.get(e.from)!
        const two = (out.get(e.from)?.length ?? 0) > 1
        sum += ch.x + (two ? (c.father[e.from] === e.first ? -LANE : LANE) : 0); cnt++
      }
      want.set(n.id, cnt ? sum / cnt : W / 2)
    }
    list.sort((a, b) => want.get(a.id)! - want.get(b.id)!)
    const xs = list.map(n => want.get(n.id)!)
    for (let k = 1; k < xs.length; k++) xs[k] = Math.max(xs[k], xs[k - 1] + MINGAP)
    const over = xs.length ? xs[xs.length - 1] - (W - PAD) : 0
    if (over > 0) for (let k = 0; k < xs.length; k++) xs[k] -= over
    if (xs.length && xs[0] < PAD) { const u = PAD - xs[0]; for (let k = 0; k < xs.length; k++) xs[k] += u }
    list.forEach((n, k) => { n.x = xs[k] })
    // label side: where there is more room
    list.forEach((n, k) => {
      const left = n.x - (k > 0 ? list[k - 1].x + 12 : 6) - 14
      const right = (k + 1 < list.length ? list[k + 1].x - 12 : W - 6) - n.x - 14
      n.side = right >= left ? 'r' : 'l'
      n.chars = Math.max(7, Math.floor(Math.max(left, right) / 5.4))
    })
  }
  const H = TOP + maxRow * ROW + BOT
  for (const n of nodes.values()) n.y = H - BOT - n.row * ROW
  for (const e of edges) {
    const sp = Math.min(3.4, 20 / Math.max(1, e.routes.length))
    const half = ((e.routes.length - 1) * sp) / 2 + 4
    for (const id of [e.from, e.to]) { const n = nodes.get(id)!; n.band = Math.max(n.band, half) }
  }
  return { nodes: [...nodes.values()], edges, H, subject, target }
}

const pt = (x1: number, y1: number, x2: number, y2: number, t: number): [number, number] => {
  const ym = (y1 + y2) / 2, u = 1 - t
  return [u ** 3 * x1 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x2, u ** 3 * y1 + 3 * u * u * t * ym + 3 * u * t * t * ym + t ** 3 * y2]
}
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const dash = (k: number) => (k >= 16 ? '1.5 3.5' : k >= 8 ? '5 3' : undefined)

export function routeColor(k: number) { return `var(--rm${k % 8})` }

export function RouteMap({ routes, active, onHover, onPick, onGo }: {
  routes: Route[]
  active: number | null
  onHover: (k: number | null) => void
  onPick: (k: number) => void
  onGo: (i: number, path?: number[]) => void
}) {
  const g = useMemo(() => buildMap(routes), [routes])
  const nodeById = useMemo(() => new Map(g.nodes.map(n => [n.id, n])), [g])
  const dim = active !== null
  const order = routes.map((_, k) => k).filter(k => k !== active)
  if (active !== null && active < routes.length) order.push(active)
  const onRoute = (n: MNode) => active === null || n.routes.includes(active)
  const go = (n: MNode) => {
    const k = active !== null && n.routes.includes(active) ? active : n.routes[0]
    const p = routes[k].path
    onGo(n.id, p.slice(0, p.indexOf(n.id) + 1))
  }
  return (
    <svg className="rmap" viewBox={`0 0 ${W} ${g.H}`} width="100%" role="group" aria-label={`Map of the ${routes.length} most likely routes, you at the bottom`}>
      {/* edges, one line per route, bundled side by side */}
      {g.edges.map((e, ei) => {
        const a = nodeById.get(e.from)!, b = nodeById.get(e.to)!
        const n = e.routes.length, sp = Math.min(3.4, 20 / Math.max(1, n))
        const ym = (a.y + b.y) / 2
        const lines = [...e.routes].sort((p, q) => order.indexOf(p) - order.indexOf(q))
        const [mx, my] = pt(a.x, a.y, b.x, b.y, e.gens > MAXDOTS ? 0.62 : 0.5)
        const [bx, by] = pt(a.x, a.y, b.x, b.y, e.gens > MAXDOTS ? 0.34 : 0.5)
        return (
          <g key={ei}>
            {lines.map(k => {
              const o = (e.routes.indexOf(k) - (n - 1) / 2) * sp
              const d = `M${a.x + o},${a.y} C${a.x + o},${ym} ${b.x + o},${ym} ${b.x + o},${b.y}`
              const on = active === k
              return <path key={k} d={d} fill="none" stroke={routeColor(k)} strokeDasharray={dash(k)} strokeLinecap="round"
                strokeWidth={on ? 3.6 : dim ? 1.4 : 2.1} opacity={dim && !on ? 0.2 : 1} />
            })}
            {e.gens > 1 && e.gens <= MAXDOTS && Array.from({ length: e.gens - 1 }, (_, t) => {
              const [dx, dy] = pt(a.x, a.y, b.x, b.y, (t + 1) / e.gens)
              return <circle key={t} className="rm-dot" cx={dx} cy={dy} r={2.6} opacity={dim && !(active !== null && e.routes.includes(active)) ? 0.25 : 1} />
            })}
            {e.gens > MAXDOTS && <text className="rm-gens" x={mx + (n - 1) * sp / 2 + 7} y={my + 3.5}>×{e.gens} generations</text>}
            {n === 1 && <g className="rm-badge" transform={`translate(${bx},${by})`} opacity={dim && active !== e.routes[0] ? 0.35 : 1}>
              <circle r={7.5} stroke={routeColor(e.routes[0])} /><text y={3.4} textAnchor="middle">{e.routes[0] + 1}</text></g>}
            {lines.map(k => {
              const o = (e.routes.indexOf(k) - (n - 1) / 2) * sp
              const d = `M${a.x + o},${a.y} C${a.x + o},${ym} ${b.x + o},${ym} ${b.x + o},${b.y}`
              return <path key={'h' + k} d={d} fill="none" stroke="transparent" strokeWidth={Math.max(sp + 3, 8)} style={{ cursor: 'pointer' }}
                onMouseEnter={() => onHover(k)} onMouseLeave={() => onHover(null)} onClick={() => onPick(k)}><title>{`Route ${k + 1}`}</title></path>
            })}
          </g>)
      })}
      {/* labelled people */}
      {g.nodes.map(n => {
        const you = n.id === g.subject, end = n.id === g.target
        const tag = you ? '' : end ? 'ancestor' : n.split && n.join ? 'routes split and rejoin' : n.split ? 'routes split here' : 'routes rejoin here'
        const name = you ? 'You' : displayName(n.id)
        const yrs = years(n.id)
        const l2 = [yrs, tag].filter(Boolean).join(' · ')
        const w = Math.max(16, n.band * 2 + 4)
        const lx = n.side === 'r' ? n.x + w / 2 + 6 : n.x - w / 2 - 6
        const anchor = n.side === 'r' ? 'start' : 'end'
        return (
          <g key={n.id} className={'rm-node' + (you ? ' you' : '') + (end ? ' end' : '') + (onRoute(n) ? '' : ' off')} tabIndex={0} role="button"
            aria-label={`${name}${yrs ? ', ' + yrs : ''}${tag ? ', ' + tag : ''}. Show in tree`}
            onClick={() => go(n)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(n) } }}
            onMouseEnter={() => n.routes.length === 1 && onHover(n.routes[0])} onMouseLeave={() => n.routes.length === 1 && onHover(null)}>
            <title>{`${name} ${yrs}`.trim()}</title>
            <rect x={n.x - w / 2} y={n.y - 7} width={w} height={14} rx={7} />
            <text className="rm-name" x={lx} y={n.y - (l2 ? 1.5 : -4)} textAnchor={anchor}>{trunc(name, n.chars)}</text>
            {l2 && <text className="rm-sub" x={lx} y={n.y + 11} textAnchor={anchor}>{trunc(l2, n.chars + 6)}</text>}
          </g>)
      })}
    </svg>
  )
}
