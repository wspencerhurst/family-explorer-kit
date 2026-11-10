// Data layer: loads the compact columnar index once, exposes typed arrays and helpers,
// and lazily loads per-person detail chunks.

export const TIER = ['verified', 'tree', 'medieval', 'legendary', 'flagged', 'conflict', 'alternate'] as const
export const CONF = ['CONFIRMED', 'PROBABLE', 'UNVERIFIED', 'CONFLICT'] as const
export const FL = {
  notable: 1, immigrant: 2, portrait: 4, living: 8, doubtful: 16, alternate: 32, quality: 64,
  birthEstimated: 128, photos: 256, military: 512, disproven: 1024, unproven: 2048,
} as const

export interface Core {
  N: number
  root: number
  ids: string[]
  names: string[]
  sex: Uint8Array
  birth: Int16Array // 0 = unknown
  death: Int16Array // 0 = unknown
  father: Int32Array
  mother: Int32Array
  tier: Uint8Array
  conf: Uint8Array
  gen: Int16Array // generation from root, -1 = not in pedigree (alternate lineage)
  ahn: string[] // lowest Ahnentafel number (as decimal string), '' if none
  flags: Uint16Array
  bplace: Int32Array
  dplace: Int32Array
  routes: Uint16Array
  altParents: (number[][] | 0)[]
  linkFlags: Uint8Array // bits: 1 father disproven, 2 father unproven, 4 mother disproven, 8 mother unproven
  places: string[]
  portrait: Map<number, string>
  children: Int32Array[] | null // pedigree children (computed lazily)
  search: string[] // normalized names
}

export interface Event { type: string; date?: string; place?: string; value?: string; y?: number }
export interface RelRef { i?: number; name?: string; life?: string; b?: string; bp?: string; dp?: string; sex?: string; fs?: string }
export interface Detail {
  name: string; fs?: string; wt?: string; life?: string
  events?: Event[]; notable?: string; immigrant?: { year?: string; from?: string; evidence?: string } | string; occupation?: string
  notes?: Record<string, string>; sources?: { title?: string; url?: string; type?: string; citation?: string; publisher?: string; author?: string }[]; nsrc?: number
  spouses?: RelRef[]; children?: RelRef[]
  photos?: { source?: string; title?: string; thumb?: string; url?: string; page?: string; file?: string; kind?: string }[]
  bios?: { source?: string; url?: string; text: string }[]
  stories?: { title?: string; text: string }[]
  sketch?: string
  fag?: { memorial: string; cemetery?: string; inscription?: string; birth?: string; death?: string }
  portrait?: { source?: string; url?: string; thumb?: string; file?: string; page?: string }
  linkFlags?: Record<string, { verdict: string; reason: string; task?: string }>
  lineFlag?: { verdict: string; reason?: string; via?: string }
  quality?: string[]; origin?: string[]; altOf?: number; routes?: number; ahn?: string[]
  enslaved?: { name: string; description?: string; place?: string; year?: string; notes?: string }[]
  enslavedCounts?: { year: number; place: string; count: number; confidence?: string; enumeratedAs?: string; url?: string }[]
}

let core: Core | null = null

export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function loadCore(onProgress?: (f: number) => void): Promise<Core> {
  if (core) return core
  const res = await fetch('./data/core.json')
  const total = Number(res.headers.get('content-length')) || 0
  let text: string
  if (res.body && total && onProgress) {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value); got += value.length; onProgress(Math.min(0.95, got / total))
    }
    const all = new Uint8Array(got); let o = 0
    for (const c of chunks) { all.set(c, o); o += c.length }
    text = new TextDecoder().decode(all)
  } else text = await res.text()
  const j = JSON.parse(text)
  const N: number = j.id.length
  const i16 = (a: (number | null)[]) => { const t = new Int16Array(N); for (let i = 0; i < N; i++) t[i] = a[i] ?? 0; return t }
  const i32 = (a: number[]) => Int32Array.from(a)
  const portrait = new Map<number, string>()
  for (const k in j.pt) portrait.set(Number(k), j.pt[k])
  core = {
    N, root: j.root, ids: j.id, names: j.n,
    sex: Uint8Array.from(j.s), birth: i16(j.b), death: i16(j.d),
    father: i32(j.f), mother: i32(j.m), tier: Uint8Array.from(j.t), conf: Uint8Array.from(j.c),
    gen: Int16Array.from(j.g), ahn: j.a, flags: Uint16Array.from(j.fl),
    bplace: i32(j.bp), dplace: i32(j.dp), routes: Uint16Array.from(j.r.map((x: number) => Math.min(x, 65535))),
    altParents: j.ap, linkFlags: Uint8Array.from(j.lf ?? []), places: j.places, portrait, children: null,
    search: (j.n as string[]).map(normalize),
  }
  onProgress?.(1)
  return core
}

export function C(): Core { if (!core) throw new Error('core not loaded'); return core }

// ---------- details ----------
const chunkCache = new Map<number, Promise<Record<string, Detail>>>()
export function loadDetail(i: number): Promise<Detail | undefined> {
  const c = Math.floor(i / 500)
  let p = chunkCache.get(c)
  if (!p) {
    p = fetch(`./data/details/${String(c).padStart(3, '0')}.json`).then(r => r.json())
    chunkCache.set(c, p)
  }
  return p.then(d => d[String(i)])
}

let jsonCache = new Map<string, Promise<any>>()
export function loadJSON<T = any>(name: string): Promise<T> {
  let p = jsonCache.get(name)
  if (!p) { p = fetch(`./data/${name}`).then(r => r.json()); jsonCache.set(name, p) }
  return p
}

// ---------- relationships ----------
export function ahnPath(i: number): number[] | null {
  // indices from root (inclusive) to i following the Ahnentafel bits
  const c = C(); const a = c.ahn[i]
  if (!a) return null
  const n = BigInt(a)
  const bits = n.toString(2)
  const path = [c.root]
  let cur = c.root
  for (let k = 1; k < bits.length; k++) {
    cur = bits[k] === '0' ? c.father[cur] : c.mother[cur]
    if (cur < 0) return null
    path.push(cur)
  }
  return path[path.length - 1] === i ? path : null
}

/** path (list of indices) from `from` up to ancestor `to`, via parent links (BFS, shortest). */
export function ancestorPath(from: number, to: number, maxDepth = 200): number[] | null {
  if (from === to) return [from]
  const c = C()
  const prev = new Map<number, number>()
  let frontier = [from]
  prev.set(from, -1)
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next: number[] = []
    for (const x of frontier) {
      for (const p of [c.father[x], c.mother[x]]) {
        if (p < 0 || prev.has(p)) continue
        prev.set(p, x)
        if (p === to) {
          const out = [p]; let y = x
          while (y !== -1) { out.push(y); y = prev.get(y)! }
          return out.reverse()
        }
        next.push(p)
      }
    }
    frontier = next
  }
  return null
}

export function sideOf(i: number): 'paternal' | 'maternal' | '' {
  const a = C().ahn[i]
  if (!a || a === '1') return ''
  const b = BigInt(a).toString(2)
  return b[1] === '0' ? 'paternal' : 'maternal'
}

export function relationLabel(i: number, gen?: number): string {
  const c = C()
  const g = gen ?? c.gen[i]
  // unknown sex: fall back to the Ahnentafel slot (even = father line slot, odd = mother slot)
  let sx = c.sex[i]
  if (!sx && g > 0 && c.ahn[i]) { try { sx = BigInt(c.ahn[i]) % 2n === 0n ? 1 : 2 } catch { /* keep unknown */ } }
  const w = (m: string, f: string, n: string) => (sx === 1 ? m : sx === 2 ? f : n)
  if (g < 0) return 'Alternate lineage'
  if (g === 0) return 'You'
  if (g === 1) return w('Father', 'Mother', 'Parent')
  if (g === 2) return w('Grandfather', 'Grandmother', 'Grandparent')
  if (g === 3) return w('Great-grandfather', 'Great-grandmother', 'Great-grandparent')
  return `${ordinalTimes(g - 2)} great-${w('grandfather', 'grandmother', 'grandparent')}`
}
function ordinalTimes(n: number) { return `${n}×` }

export function years(i: number): string {
  const c = C()
  const b = c.birth[i]
  let d = c.death[i]
  const est = c.flags[i] & FL.birthEstimated
  // negative years are BC. Death years of BC people can arrive as positive numbers (the date parser drops "BC"):
  // a death "after" a BC birth that is not later than the birth's own magnitude is the BC year.
  if (b && b < 0 && d && d > 0 && d <= -b) d = -d
  const fmt = (y: number) => (y < 0 ? `${-y} BC` : `${y}`)
  if (!b && !d) return ''
  if (c.flags[i] & FL.living && !d) return b ? `b. ${fmt(b)}` : ''
  return `${b ? (est ? 'c. ' : '') + fmt(b) : '?'}–${d ? fmt(d) : '?'}`
}

export function displayName(i: number): string {
  return C().names[i].replace(/\s+/g, ' ').trim()
}

// Titles and honorifics belong to the display name, not the given name used in fan labels.
const TITLE_RE = /^(sir|lady|lord|dr|rev|col|capt|captain|gen|maj|major|lt|brig|gov|mr|mrs|miss|hon|dame|baron|baroness|count|countess|earl|duke|king|queen|prince|princess|bt|esq)\.?$/i

export function splitName(name: string): [string, string] {
  // drop notes in parentheses, quoted nicknames and footnote markers before splitting
  const clean = name
    .replace(/\(.*?\)/g, ' ')
    .replace(/["“”][^"“”]*["“”]/g, ' ')
    .replace(/(^|\s)['‘][^'’]*['’](?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ').trim()
  const parts = clean.split(' ')
  if (parts.length <= 1) return [clean, '']
  // keep suffixes / particles with the surname
  let k = parts.length - 1
  while (k > 1 && /^(jr\.?|sr\.?|ii|iii|iv|v|esq\.?)$/i.test(parts[k])) k--
  while (k > 1 && /^(de|du|del|van|von|la|le|of|fitz|d')$/i.test(parts[k - 1])) k--
  const given = parts.slice(0, k)
  while (given.length > 1 && TITLE_RE.test(given[0])) given.shift()
  return [given.join(' '), parts.slice(k).join(' ')]
}

export function placeName(idx: number): string { return idx >= 0 ? C().places[idx] : '' }

export function portraitUrl(i: number): string | null {
  const f = C().portrait.get(i)
  return f ? `./portraits/${f}` : null
}

export function computeChildren(): Int32Array[] {
  const c = C()
  if (c.children) return c.children
  const lists: number[][] = Array.from({ length: c.N }, () => [])
  for (let i = 0; i < c.N; i++) {
    if (c.father[i] >= 0) lists[c.father[i]].push(i)
    if (c.mother[i] >= 0) lists[c.mother[i]].push(i)
  }
  c.children = lists.map(l => Int32Array.from(l))
  return c.children
}

// ---------- search ----------
export interface Hit { i: number; score: number }
export function search(q: string, limit = 30): Hit[] {
  const c = C()
  const nq = normalize(q)
  if (!nq) return []
  const toks = nq.split(' ')
  const yearTok = toks.find(t => /^\d{3,4}$/.test(t))
  const words = toks.filter(t => t !== yearTok)
  const year = yearTok ? Number(yearTok) : 0
  const hits: Hit[] = []
  for (let i = 0; i < c.N; i++) {
    const s = c.search[i]
    let ok = true, score = 0
    for (const w of words) {
      const pos = s.indexOf(w)
      if (pos < 0) { ok = false; break }
      if (pos === 0 || s[pos - 1] === ' ') {
        score += 10
        const end = pos + w.length
        if (end === s.length || s[end] === ' ') score += 6
      } else score += 2
    }
    if (!ok) continue
    if (year) {
      const b = c.birth[i]
      if (!b) continue
      const dist = Math.abs(b - year)
      if (dist > 15) continue
      score += 10 - dist / 2
    }
    const g = c.gen[i]
    score += g >= 0 ? Math.max(0, 14 - g) * 0.9 : -6
    score += (3 - c.conf[i]) * 1.5
    if (c.flags[i] & FL.portrait) score += 2
    if (c.flags[i] & FL.notable) score += 3
    if (c.flags[i] & FL.doubtful) score -= 4
    hits.push({ i, score })
  }
  hits.sort((a, b) => b.score - a.score)
  // collapse duplicates of the same FamilySearch person appearing as alternates
  return hits.slice(0, limit)
}


// ---------- routes (pedigree collapse) ----------
/** evidence weight of a person (how much we trust them to be who the tree says) */
function personW(i: number): number {
  const c = C()
  const conf = c.conf[i], t = c.tier[i]
  if (conf === 0) return 1
  if (conf === 1) return 0.93
  if (conf === 3 || t === 5) return 0.6
  if (t === 3) return 0.4
  if (t === 2) return 0.7
  return 0.82
}
/** weight of the link child -> parent */
export function linkW(child: number, parent: number): number {
  const c = C()
  const lf = c.linkFlags[child] ?? 0
  const isF = c.father[child] === parent
  const bits = isF ? lf & 3 : (lf >> 2) & 3
  const flag = bits & 1 ? 0.03 : bits & 2 ? 0.35 : 1
  return flag * personW(parent)
}
export function linkVerdict(child: number, parent: number): 'disproven' | 'unproven' | null {
  const c = C()
  const lf = c.linkFlags[child] ?? 0
  const bits = c.father[child] === parent ? lf & 3 : (lf >> 2) & 3
  return bits & 1 ? 'disproven' : bits & 2 ? 'unproven' : null
}

let topo: { order: Int32Array; back: Uint8Array } | null = null
/** Depth-first order of the subject's pedigree with loop-closing edges marked (bad tree data contains cycles).
 *  order lists every ancestor with each child before its parents; back[x] bit 1 = father edge closes a loop, bit 2 = mother edge. */
export function pedigreeOrder() {
  if (topo) return topo
  const c = C(), N = c.N
  const state = new Uint8Array(N) // 0 new, 1 on stack, 2 done
  const back = new Uint8Array(N)
  const post: number[] = []
  const stack: number[] = [c.root], edge: number[] = [0]
  state[c.root] = 1
  while (stack.length) {
    const x = stack[stack.length - 1], e = edge[edge.length - 1]
    if (e < 2) {
      edge[edge.length - 1] = e + 1
      const p = e === 0 ? c.father[x] : c.mother[x]
      if (p < 0) continue
      if (state[p] === 1) { back[x] |= e === 0 ? 1 : 2; continue }
      if (state[p] === 0) { state[p] = 1; stack.push(p); edge.push(0) }
      continue
    }
    stack.pop(); edge.pop(); state[x] = 2; post.push(x)
  }
  // post-order puts parents before children; reverse it so children come first
  topo = { order: Int32Array.from(post.reverse()), back }
  return topo
}

let routeCounts: { all: Float64Array; clean: Float64Array } | null = null
/** number of distinct routes from the subject to every ancestor (all links / excluding disproven links) */
export function getRouteCounts() {
  if (routeCounts) return routeCounts
  const c = C(), N = c.N
  const { order, back } = pedigreeOrder()
  const all = new Float64Array(N), clean = new Float64Array(N)
  all[c.root] = 1; clean[c.root] = 1
  for (let k = 0; k < order.length; k++) {
    const x = order[k]
    const f = c.father[x], m = c.mother[x], lf = c.linkFlags[x] ?? 0
    if (f >= 0 && !(back[x] & 1)) { all[f] += all[x]; if (!(lf & 1)) clean[f] += clean[x] }
    if (m >= 0 && !(back[x] & 2)) { all[m] += all[x]; if (!(lf & 4)) clean[m] += clean[x] }
  }
  routeCounts = { all, clean }
  return routeCounts
}
export function fmtCount(n: number): string {
  if (n < 1e4) return Math.round(n).toLocaleString()
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e5 ? 1 : 0)} thousand`
  if (n < 1e9) return `${(n / 1e6).toFixed(1)} million`
  if (n < 1e12) return `${(n / 1e9).toFixed(1)} billion`
  return n.toExponential(1).replace('e+', ' × 10^')
}

export interface Route { path: number[]; score: number; weakest: { child: number; parent: number; w: number } | null; disproven: number; unproven: number }
/** the k most likely routes from the subject up to `target` (path = subject ... target) */
export function topRoutes(target: number, K = 20): Route[] {
  const c = C()
  const { order, back } = pedigreeOrder()
  // nodes that have `target` as an ancestor (walk children down from the target, following non-loop edges)
  const kids = computeChildren()
  const inS = new Uint8Array(c.N)
  inS[target] = 1
  const st = [target]
  while (st.length) {
    const x = st.pop()!
    for (const ch of kids[x]) {
      if (inS[ch] || c.gen[ch] < 0) continue
      const bit = c.father[ch] === x ? 1 : 2
      if (back[ch] & bit) continue
      inS[ch] = 1; st.push(ch)
    }
  }
  if (!inS[c.root]) return []
  type Entry = { score: number; via: number; rank: number }
  const best = new Map<number, Entry[]>()
  best.set(target, [{ score: 1, via: -1, rank: 0 }])
  // parents before children: walk the child-first order backwards
  for (let k = order.length - 1; k >= 0; k--) {
    const x = order[k]
    if (!inS[x] || x === target) continue
    const cand: Entry[] = []
    for (const [p, bit] of [[c.father[x], 1], [c.mother[x], 2]] as [number, number][]) {
      if (p < 0 || !inS[p] || back[x] & bit) continue
      const lst = best.get(p)
      if (!lst) continue
      const w = linkW(x, p)
      for (let r = 0; r < lst.length; r++) cand.push({ score: lst[r].score * w, via: p, rank: r })
    }
    if (!cand.length) continue
    cand.sort((a, b) => b.score - a.score)
    if (cand.length > K) cand.length = K
    best.set(x, cand)
  }
  const out: Route[] = []
  for (const e of best.get(c.root) ?? []) {
    const path = [c.root]
    let ent: Entry | undefined = e
    while (ent && ent.via >= 0) {
      path.push(ent.via)
      ent = (best.get(ent.via) ?? [])[ent.rank]
    }
    if (path[path.length - 1] !== target) continue
    let weakest: Route['weakest'] = null, dis = 0, unp = 0
    for (let j = 1; j < path.length; j++) {
      const w = linkW(path[j - 1], path[j])
      const v = linkVerdict(path[j - 1], path[j])
      if (v === 'disproven') dis++; else if (v === 'unproven') unp++
      if (!weakest || w < weakest.w) weakest = { child: path[j - 1], parent: path[j], w }
    }
    out.push({ path, score: e.score, weakest, disproven: dis, unproven: unp })
  }
  return out
}
