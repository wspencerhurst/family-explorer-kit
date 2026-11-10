// Route comparison and kinship wording.
// Any two routes from the subject to the same ancestor share a prefix, split at a person D (one route goes through D's
// father, the other through D's mother) and rejoin at some ancestor Q. That means D's parents were related through Q.
import { C, linkVerdict, loadJSON, type Route } from './store'

export interface ConsCouple { f: number; m: number; child: number; n1: number; n2: number; label: string; F: number; ca: number[]; suspect: boolean; gen: number }
let consP: Promise<Map<number, ConsCouple>> | null = null
/** precomputed related couples, keyed by their child */
export function loadCons(): Promise<Map<number, ConsCouple>> {
  if (!consP) {
    consP = loadJSON<{ couples: ConsCouple[] }>('consanguinity.json')
      .then(d => { const m = new Map<number, ConsCouple>(); for (const x of d.couples) m.set(x.child, x); return m })
      .catch(() => new Map<number, ConsCouple>())
  }
  return consP
}

// ---------- wording ----------
export function ordinal(n: number): string {
  const suf = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (suf[(v - 20) % 10] || suf[v] || suf[0])
}
const removedWord = (n: number) => (n === 1 ? 'once removed' : n === 2 ? 'twice removed' : `${n} times removed`)
function greatPrefix(n: number) { return n <= 0 ? '' : n <= 2 ? 'great-'.repeat(n) : `${n}× great-` }
/** "child", "grandchild", "great-grandchild", "2× great-grandchild" ... (gap generations below an ancestor) */
export function descendantWord(gap: number, plural = false): string {
  const base = gap === 1 ? 'child' : gap === 2 ? 'grandchild' : gap === 3 ? 'great-grandchild' : `${gap - 2}× great-grandchild`
  return plural ? (gap === 1 ? 'children' : base + 'ren') : base
}
function lineal(gap: number, ancMale: boolean): string {
  const a = ancMale ? 'father' : 'mother', d = ancMale ? 'daughter' : 'son'
  if (gap >= 4) return `ancestor and descendant (${gap} generations apart)`
  if (gap === 1) return `${a} and ${d}`
  const g = gap === 2 ? 'grand' : 'great-grand'
  return `${g}${a} and ${g}${d}`
}

export interface Kin { label: string; close: boolean; kind: 'lineal' | 'sibling' | 'avuncular' | 'cousin'; degree: number }
/** relationship between two people who are `a` and `b` generations below their common ancestor
 *  (a = the father's side, b = the mother's side when used for a couple). `full`: true/false/null for full/half/unknown siblings. */
export function kinship(a: number, b: number, full: boolean | null = null): Kin {
  const lo = Math.min(a, b), hi = Math.max(a, b)
  if (lo === 0) return { label: lineal(hi, a === 0), close: true, kind: 'lineal', degree: 0 }
  if (lo === 1 && hi === 1) return { label: full === false ? 'half-siblings' : 'siblings', close: true, kind: 'sibling', degree: 0 }
  if (lo === 1) {
    const gap = hi - 1, older = a < b // the father is the older generation
    const g = greatPrefix(gap - 1)
    return { label: older ? `${g}uncle and ${g}niece` : `${g}aunt and ${g}nephew`, close: true, kind: 'avuncular', degree: 0 }
  }
  const deg = lo - 1
  return { label: `${ordinal(deg)} cousins${hi > lo ? ' ' + removedWord(hi - lo) : ''}`, close: false, kind: 'cousin', degree: deg }
}

// ---------- route differences ----------
export interface Split {
  d: number                 // last person shared with the reference route
  q: number                 // person where this route rejoins it
  from: number; to: number  // indices of d and q in this route's path
  take: 'father' | 'mother' | null // which parent of d this route goes through
  routeSeg: number[]        // people strictly between d and q on this route
  refSeg: number[]          // people strictly between d and q on the reference route
  gF: number | null         // generations from d's father up to q
  gM: number | null         // generations from d's mother up to q
  flag: 'disproven' | 'unproven' | null // worst flagged link on either side
}
export interface RouteDiff {
  ref: number               // index of the reference route
  splits: Split[]
  kind: ('shared' | 'diff' | 'pivot')[] // per person on the path
  refName: number
}

const ek = (a: number, b: number) => a * 1e7 + b

export function computeDiffs(routes: Route[]): (RouteDiff | null)[] {
  const c = C()
  const edges = routes.map(r => { const s = new Set<number>(); for (let j = 0; j + 1 < r.path.length; j++) s.add(ek(r.path[j], r.path[j + 1])); return s })
  return routes.map((r, k) => {
    if (k === 0) return null
    const p = r.path
    let best = 0, bestN = Infinity
    for (let q = 0; q < k; q++) {
      let n = 0
      for (let j = 0; j + 1 < p.length; j++) if (!edges[q].has(ek(p[j], p[j + 1]))) n++
      if (n < bestN) { bestN = n; best = q }
    }
    const ref = routes[best].path
    const refPos = new Map<number, number>()
    ref.forEach((x, j) => refPos.set(x, j))
    const sh: boolean[] = []
    for (let j = 0; j + 1 < p.length; j++) sh.push(edges[best].has(ek(p[j], p[j + 1])))
    const kind: RouteDiff['kind'] = p.map(() => 'shared')
    const splits: Split[] = []
    let j = 0
    while (j < sh.length) {
      if (sh[j]) { j++; continue }
      let e = j
      while (e < sh.length && !sh[e]) e++
      const D = p[j], Q = p[e]
      kind[j] = 'pivot'; kind[e] = 'pivot'
      for (let t = j + 1; t < e; t++) kind[t] = 'diff'
      const jD = refPos.get(D), jQ = refPos.get(Q)
      const ok = jD !== undefined && jQ !== undefined && jQ > jD
      const take = c.father[D] === p[j + 1] ? 'father' : c.mother[D] === p[j + 1] ? 'mother' : null
      const gRoute = e - (j + 1), gRef = ok ? jQ! - (jD! + 1) : 0
      const fl: { v: Split['flag'] } = { v: null }
      const note = (ch: number, pa: number) => { const v = linkVerdict(ch, pa); if (v === 'disproven' || (v && !fl.v)) fl.v = v }
      for (let t = j; t < e; t++) note(p[t], p[t + 1])
      if (ok) for (let t = jD!; t < jQ!; t++) note(ref[t], ref[t + 1])
      splits.push({
        d: D, q: Q, from: j, to: e, take,
        routeSeg: p.slice(j + 1, e), refSeg: ok ? ref.slice(jD! + 1, jQ!) : [],
        gF: ok && take ? (take === 'father' ? gRoute : gRef) : null,
        gM: ok && take ? (take === 'father' ? gRef : gRoute) : null,
        flag: fl.v,
      })
      j = e
    }
    return { ref: best, splits, kind, refName: best + 1 }
  })
}

/** full sibling / half-sibling test for a couple that are children of the same ancestor */
export function fullSiblings(F: number, M: number, cons?: ConsCouple | null): boolean | null {
  if (cons) return cons.ca.filter(x => x >= 0).length >= 2
  const c = C()
  if (c.father[F] >= 0 && c.mother[F] >= 0 && c.father[M] >= 0 && c.mother[M] >= 0) return c.father[F] === c.father[M] && c.mother[F] === c.mother[M]
  return null
}

/** is any parent link on the way from `x` up to `anc` flagged? (shortest path in the tree) */
export function flaggedBetween(x: number, anc: number): 'disproven' | 'unproven' | null {
  const c = C()
  // breadth-first upward search that tracks the path
  if (x === anc) return null
  const prev = new Map<number, number>([[x, -1]])
  let frontier = [x]
  for (let d = 0; d < 40 && frontier.length; d++) {
    const next: number[] = []
    for (const y of frontier) for (const p of [c.father[y], c.mother[y]]) {
      if (p < 0 || prev.has(p)) continue
      prev.set(p, y)
      if (p === anc) {
        let worst: 'disproven' | 'unproven' | null = null
        for (let cur = p; prev.get(cur)! >= 0; cur = prev.get(cur)!) {
          const v = linkVerdict(prev.get(cur)!, cur)
          if (v === 'disproven') return v
          if (v) worst = v
        }
        return worst
      }
      next.push(p)
    }
    frontier = next
  }
  return null
}
