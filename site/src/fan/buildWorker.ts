/// <reference lib="webworker" />
// Builds the tessellated fan geometry for one zoom band + region off the main thread.
import { MAXG, R1, TAU, THETA0, ringW, wedgeGeom, linesColor, type Clip } from './shared'
import { Tess, packColor } from './glfill'

interface Init { type: 'init'; father: Int32Array; mother: Int32Array; dim: Uint8Array; disp: Uint8Array; frac: Float32Array; depth: Uint8Array }
interface Colors { type: 'colors'; key: string; packed: Uint32Array }
export interface BuildReq {
  type: 'build'; id: number; key: string; focus: number; k: number
  region: { x0: number; y0: number; x1: number; y1: number }
  weighted: boolean; hideDoubtful: boolean; hideDisproven: boolean; mode: string; dark: boolean; colorsKey: string
}

let father: Int32Array, mother: Int32Array, dimA: Uint8Array, dispA: Uint8Array, fracW: Float32Array, depthW: Uint8Array
const personColors = new Map<string, Uint32Array>()

self.onmessage = (ev: MessageEvent<Init | Colors | BuildReq>) => {
  const m = ev.data
  if (m.type === 'init') { father = m.father; mother = m.mother; dimA = m.dim; dispA = m.disp; fracW = m.frac; depthW = m.depth; return }
  if (m.type === 'colors') { personColors.set(m.key, m.packed); return }
  if (m.type === 'build') {
    const out = build(m)
    ;(self as unknown as Worker).postMessage(out, [out.verts, out.cand.buffer, out.empties.buffer])
  }
}

function build(q: BuildReq) {
  const { k, region, dark } = q
  const pc = q.mode === 'lines' ? null : personColors.get(q.colorsKey) ?? null
  const dimAlpha = dark ? 0.42 : 0.5
  const inside = region.x0 <= 0 && region.x1 >= 0 && region.y0 <= 0 && region.y1 >= 0
  const cxp = Math.max(region.x0, Math.min(0, region.x1)), cyp = Math.max(region.y0, Math.min(0, region.y1))
  const dmin = inside ? 0 : Math.hypot(cxp, cyp)
  let dmax = 0
  const corners = [[region.x0, region.y0], [region.x1, region.y0], [region.x0, region.y1], [region.x1, region.y1]]
  for (const [x, y] of corners) dmax = Math.max(dmax, Math.hypot(x, y))
  const full = inside || dmin < R1
  let va0 = 0, vspan = TAU
  if (!full) {
    const ca = Math.atan2((region.y0 + region.y1) / 2, (region.x0 + region.x1) / 2)
    let lo = 0, hi = 0
    for (const [x, y] of corners) {
      let d = Math.atan2(y, x) - ca
      while (d > Math.PI) d -= TAU
      while (d < -Math.PI) d += TAU
      lo = Math.min(lo, d); hi = Math.max(hi, d)
    }
    va0 = ca + lo; vspan = hi - lo
  }
  const angVisible = (a0: number, a1: number) => {
    if (full) return true
    let s0 = (a0 - va0) % TAU; if (s0 < 0) s0 += TAU
    return s0 <= vspan || s0 + (a1 - a0) >= TAU
  }
  const clip: Clip | null = full ? null : { wa0: va0 - Math.max(0.002, vspan * 0.05), wspan: vspan + 2 * Math.max(0.002, vspan * 0.05), lo: Math.max(0, dmin - 6 / k), hi: dmax + 6 / k }
  const tess = new Tess()
  const cand: number[] = []
  const empties: number[] = []
  let n = 0
  const split = (i: number) => (q.weighted ? fracW[i] : 0.5)
  const color = (i: number, frac: number, g: number, dim: boolean): number => {
    if (pc) { const c = pc[i]; return dim ? ((c & 0xffffff00) | Math.round((c & 255) * dimAlpha)) >>> 0 : c }
    return packColor(linesColor(frac, g, dim, dark), dim ? dimAlpha : 1)
  }
  const fill = (rgba: number, a0: number, a1: number, rIn: number, rOut: number, gapPx: number) => {
    const gm = wedgeGeom(k, a0, a1, rIn, rOut, gapPx, clip)
    if (!gm) return false
    const segs = Math.max(1, Math.min(96, Math.ceil(((gm[1] - gm[0]) * gm[3] * k) / 6)))
    tess.sector(gm[0], gm[1], gm[2], gm[3], segs, rgba)
    return true
  }
  const minPx = 0.9
  // explicit stack instead of recursion (deep lines can be ~200 generations)
  const st: number[] = [q.focus, 0, THETA0, THETA0 + TAU, 0, R1]
  while (st.length) {
    const rOut = st.pop()!, rIn = st.pop()!, a1 = st.pop()!, a0 = st.pop()!, g = st.pop()!, i = st.pop()!
    if (rIn > dmax || !angVisible(a0, a1)) continue
    const arcPx = (a1 - a0) * rOut * k
    const dim = dimA[i] === 1
    const frac = ((a0 + a1) / 2 - THETA0) / TAU
    if (g > 0 && rOut >= dmin) {
      if (fill(color(i, frac, g, dim), a0, a1, rIn, rOut, 1.2)) n++
      cand.push(i, g, a0, a1, rIn, rOut, 0)
    }
    if (g >= MAXG - 1) continue
    const f = father[i], m = mother[i]
    if (arcPx < minPx * 2) {
      if ((f >= 0 || m >= 0) && rOut >= dmin) {
        const d = Math.max(1, depthW[i] - 1)
        fill(color(i, frac, g + 1, dim), a0, a1, rOut, rOut + (rOut - rIn) * Math.min(2, 0.9 * d), 0)
      }
      continue
    }
    const mid = a0 + (a1 - a0) * split(i)
    const hidden = (x: number) => (q.hideDisproven && dispA[x] === 1) || (q.hideDoubtful && dimA[x] === 1)
    const showF = f >= 0 && !hidden(f)
    const showM = m >= 0 && !hidden(m)
    const pw = rOut - rIn
    const roF = rOut + ringW(g + 1, rOut, mid - a0, pw), roM = rOut + ringW(g + 1, rOut, a1 - mid, pw)
    // push mother first so the father's side is processed first (matches the recursive order)
    if (showM) st.push(m, g + 1, mid, a1, rOut, roM)
    else if (g + 1 <= 10 && rOut <= dmax && (a1 - mid) * roM * k > 9 && angVisible(mid, a1)) { empties.push(mid, a1, rOut, roM); cand.push(-1, g + 1, mid, a1, rOut, roM, 2) }
    if (showF) st.push(f, g + 1, a0, mid, rOut, roF)
    else if (g + 1 <= 10 && rOut <= dmax && (mid - a0) * roF * k > 9 && angVisible(a0, mid)) { empties.push(a0, mid, rOut, roF); cand.push(-1, g + 1, a0, mid, rOut, roF, 1) }
  }
  return { type: 'built' as const, id: q.id, key: q.key, kb: k, region, verts: tess.data(), count: tess.count, cand: Float64Array.from(cand), empties: Float64Array.from(empties), n }
}
