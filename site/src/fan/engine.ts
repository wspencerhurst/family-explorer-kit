// Canvas fan-chart engine. World coordinates: the focus person is a disc of radius R1 at the origin.
// Each ancestor's wedge sits just outside its child's; its radial depth is set from its own angular
// width so cells stay roughly square at every depth (the whole ancestry fits inside a bounded disc and
// keeps revealing detail as you zoom). Angles run clockwise from the bottom: father's side left, mother's right.
import { C, FL, splitName, years, portraitUrl, relationLabel } from '../store'
import { wedgeColor, type ColorMode } from '../colors'
import { GLFill, Tess, packColor, rgbOf, type GLMesh } from './glfill'
import { TAU, THETA0, MAXG, R1, ringW, wedgeGeom } from './shared'
import type { BuildReq } from './buildWorker'

export interface View { x: number; y: number; k: number }
export interface Hit { i: number; g: number; a0: number; a1: number; rIn: number; rOut: number; empty?: 'father' | 'mother'; child?: number }
export interface Insets { left: number; right: number; top: number; bottom: number }

export { R1, ringW }

const q = (n: number) => Math.round(n * 2) / 2
function expand(r: { x0: number; y0: number; x1: number; y1: number }, f: number) {
  const w = (r.x1 - r.x0) * f, h = (r.y1 - r.y0) * f
  return { x0: r.x0 - w, y0: r.y0 - h, x1: r.x1 + w, y1: r.y1 + h }
}
function contains(a: { x0: number; y0: number; x1: number; y1: number } | null, b: { x0: number; y0: number; x1: number; y1: number }) {
  return !!a && a.x0 <= b.x0 && a.y0 <= b.y0 && a.x1 >= b.x1 && a.y1 >= b.y1
}
/** Append an annular wedge to path p. space maps world radius r to drawing units (ox + r*s);
 *  k is the current screen scale (for pixel-sized gaps). clip trims to an angular/radial window. */
function addWedge(p: Path2D, space: { ox: number; oy: number; s: number }, k: number, a0: number, a1: number, rIn: number, rOut: number, gapPx: number,
  clip: { wa0: number; wspan: number; lo: number; hi: number } | null): boolean {
  const gm = wedgeGeom(k, a0, a1, rIn, rOut, gapPx, clip)
  if (!gm) return false
  const [b0, b1, ri, ro] = gm
  const S = space.s, cx = space.ox, cy = space.oy
  const Ro = ro * S, Ri = ri * S
  if (Ro * (S === 1 ? k : 1) < 20000) {
    p.moveTo(cx + Ro * Math.cos(b0), cy + Ro * Math.sin(b0))
    p.arc(cx, cy, Ro, b0, b1)
    if (Ri > 0) p.arc(cx, cy, Ri, b1, b0, true); else p.lineTo(cx, cy)
    p.closePath()
  } else {
    const n = Math.min(48, Math.max(1, Math.ceil(((b1 - b0) * ro * k) / 80)))
    p.moveTo(cx + Ro * Math.cos(b0), cy + Ro * Math.sin(b0))
    for (let j = 1; j <= n; j++) { const a = b0 + ((b1 - b0) * j) / n; p.lineTo(cx + Ro * Math.cos(a), cy + Ro * Math.sin(a)) }
    for (let j = n; j >= 0; j--) { const a = b0 + ((b1 - b0) * j) / n; p.lineTo(cx + Ri * Math.cos(a), cy + Ri * Math.sin(a)) }
    p.closePath()
  }
  return true
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

type Label = { i: number; g: number; a0: number; a1: number; rIn: number; rOut: number; empty?: string }
type Rect = { x0: number; y0: number; x1: number; y1: number }
/** geometry built once for a zoom band + region and reused across frames */
interface Built {
  key: string; base: string; kb: number; region: Rect | null; world: boolean
  fills: Map<string, Path2D>; dims: Map<string, Path2D>; empties: Path2D
  cand: ArrayLike<number>   // per wedge: i, g, a0, a1, rIn, rOut, empty(0|1 father|2 mother)
  n: number
  mesh: GLMesh | null
}

export class FanEngine {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  dpr = 1
  w = 0; h = 0
  view: View = { x: 0, y: 0, k: 0.5 }
  focus = 0
  mode: ColorMode = 'lines'
  dark = true
  hideDoubtful = false
  /** hide ancestors who hang only from links research disproved */
  hideDisproven = true
  /** size each parent's slice by how much ancestry lies behind them (vs. classic equal halves) */
  weighted = true
  private fracW: Float32Array | null = null
  private depthW: Uint8Array | null = null
  /** share of the angle given to the father's side of person i */
  split(i: number): number {
    if (!this.weighted) return 0.5
    if (!this.fracW) this.computeWeights()
    return this.fracW![i]
  }
  /** generations of known ancestry above i (capped at 255) */
  depthOf(i: number): number { if (!this.depthW) this.computeWeights(); return this.depthW![i] }
  private computeWeights() {
    const c = C(), N = c.N
    const cnt = new Float64Array(N)
    const dep = new Uint8Array(N)
    const state = new Uint8Array(N) // 0 new, 1 on stack, 2 done (cycles in bad tree data are cut)
    const stack: number[] = []
    const ok = (p: number) => p >= 0 && state[p] !== 1
    for (let r = 0; r < N; r++) {
      if (state[r]) continue
      stack.push(r); state[r] = 1
      while (stack.length) {
        const x = stack[stack.length - 1]
        const f = c.father[x], m = c.mother[x]
        if (f >= 0 && state[f] === 0) { state[f] = 1; stack.push(f); continue }
        if (m >= 0 && state[m] === 0) { state[m] = 1; stack.push(m); continue }
        stack.pop()
        const cf = ok(f) ? cnt[f] : 0, cm = ok(m) ? cnt[m] : 0
        cnt[x] = Math.min(1e12, 1 + cf + cm)
        dep[x] = Math.min(255, 1 + Math.max(ok(f) ? dep[f] : 0, ok(m) ? dep[m] : 0))
        state[x] = 2
      }
    }
    const w = (i: number) => 1 + Math.log2(1 + cnt[i])
    const fr = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const f = c.father[i], m = c.mother[i]
      if (f >= 0 && m >= 0) fr[i] = Math.max(0.1, Math.min(0.9, w(f) / (w(f) + w(m))))
      else if (f >= 0) fr[i] = 0.88
      else if (m >= 0) fr[i] = 0.12
      else fr[i] = 0.5
    }
    this.fracW = fr; this.depthW = dep
  }
  showPhotos = true
  insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 }
  selected = -1
  selSlot: { g: number; mid: number } | null = null
  hover: Hit | null = null
  onChange?: () => void
  private dirty = true
  private raf = 0
  private anim: { from: View; to: View; t0: number; dur: number; done?: () => void } | null = null
  private wheelTarget: View | null = null
  private vel = { x: 0, y: 0 }
  private imgs = new Map<number, HTMLImageElement | null>()
  private measure = new Map<string, number>()
  private alive = true
  private builds: Built[] = []
  private selChain: { a0: number; a1: number; rIn: number; rOut: number }[] = []
  private warmQueued = false

  glf: GLFill | null = null
  private worker: Worker | null = null
  private workerInit = false
  private workerColors = new Set<string>()
  private pending = new Map<string, Rect>()
  private reqId = 0
  constructor(canvas: HTMLCanvasElement, glCanvas?: HTMLCanvasElement | null) {
    this.canvas = canvas
    this.glf = glCanvas ? GLFill.create(glCanvas) : null
    if (this.glf) {
      try {
        this.worker = new Worker(new URL('./buildWorker.ts', import.meta.url), { type: 'module' })
        this.worker.onmessage = ev => this.onBuilt(ev.data)
        this.worker.onerror = () => { this.worker = null }
      } catch { this.worker = null }
    }
    this.ctx = canvas.getContext('2d', { alpha: !!this.glf })!
    this.loop = this.loop.bind(this)
    this.raf = requestAnimationFrame(this.loop)
    document.fonts?.ready.then(() => { this.measure.clear(); this.request() })
    document.fonts?.addEventListener?.('loadingdone', () => { this.measure.clear(); this.request() })
  }
  destroy() { this.alive = false; cancelAnimationFrame(this.raf); this.worker?.terminate(); for (const b of this.builds) if (b.mesh) this.glf?.free(b.mesh); this.builds = [] }

  resize(w: number, h: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = w; this.h = h
    this.canvas.width = Math.round(w * this.dpr); this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px'
    this.glf?.resize(w, h, this.dpr)
    this.request()
  }
  request() { this.dirty = true }

  // ---------------- camera ----------------
  private extentCache = new Map<string, number>()
  /** outer radius reached by the visible ancestry of the focus (cached) */
  extent(): number {
    const key = this.focus + '|' + (this.weighted ? 1 : 0) + '|' + (this.hideDoubtful ? 1 : 0) + (this.hideDisproven ? 1 : 0)
    let r = this.extentCache.get(key)
    if (r !== undefined) return r
    const c = C()
    let best = R1, budget = 40000
    const go = (i: number, g: number, a0: number, a1: number, rOut: number, w: number) => {
      if (--budget < 0 || g > 60) return
      best = Math.max(best, rOut)
      if ((a1 - a0) * rOut < 0.6) return
      const mid = a0 + (a1 - a0) * this.split(i)
      const f = c.father[i], m = c.mother[i]
      if (f >= 0 && !(this.hideDoubtful && this.isHidden(f))) { const wf = ringW(g + 1, rOut, mid - a0, w); go(f, g + 1, a0, mid, rOut + wf, wf) }
      if (m >= 0 && !(this.hideDoubtful && this.isHidden(m))) { const wm = ringW(g + 1, rOut, a1 - mid, w); go(m, g + 1, mid, a1, rOut + wm, wm) }
    }
    go(this.focus, 0, THETA0, THETA0 + TAU, R1, R1)
    r = best
    this.extentCache.set(key, r)
    return r
  }
  homeView(): View {
    const ins = this.insets
    const aw = Math.max(200, this.w - ins.left - ins.right), ah = Math.max(200, this.h - ins.top - ins.bottom)
    const k = Math.min(aw, ah) / (2 * this.extent() * 1.03)
    return { k, x: ins.left + aw / 2, y: ins.top + ah / 2 }
  }
  setView(v: View) { this.view = { ...v }; this.anim = null; this.wheelTarget = null; this.request() }
  flyTo(to: View, dur = 650, done?: () => void) {
    this.wheelTarget = null; this.vel = { x: 0, y: 0 }
    this.anim = { from: { ...this.view }, to, t0: performance.now(), dur, done }
    this.request()
  }
  /** view that fits the annular sector rIn..rOut, a0..a1 */
  fitWedge(rIn: number, rOut: number, a0: number, a1: number, pad = 0.18): View {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const add = (r: number, a: number) => {
      const x = r * Math.cos(a), y = r * Math.sin(a)
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    const n = 24
    for (let s = 0; s <= n; s++) { const a = a0 + ((a1 - a0) * s) / n; add(rIn, a); add(rOut, a) }
    const ins = this.insets
    const aw = Math.max(200, this.w - ins.left - ins.right), ah = Math.max(200, this.h - ins.top - ins.bottom)
    const bw = Math.max(1e-9, x1 - x0), bh = Math.max(1e-9, y1 - y0)
    const k = Math.min((aw * (1 - pad)) / bw, (ah * (1 - pad)) / bh, 2e7)
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
    return { k, x: ins.left + aw / 2 - cx * k, y: ins.top + ah / 2 - cy * k }
  }
  zoomAt(sx: number, sy: number, factor: number, smooth = true) {
    const base = this.wheelTarget ?? this.view
    const k = Math.max(0.05, Math.min(2e7, base.k * factor))
    const f = k / base.k
    const t = { k, x: sx - (sx - base.x) * f, y: sy - (sy - base.y) * f }
    this.anim = null
    if (smooth) { this.wheelTarget = t } else { this.view = t }
    this.request()
  }
  panBy(dx: number, dy: number) {
    this.anim = null
    if (this.wheelTarget) { this.wheelTarget.x += dx; this.wheelTarget.y += dy }
    this.view.x += dx; this.view.y += dy; this.request()
  }
  fling(vx: number, vy: number) { this.vel = { x: vx, y: vy }; this.request() }
  stopMotion() { this.vel = { x: 0, y: 0 }; this.anim = null; this.wheelTarget = null }

  // ---------------- geometry ----------------
  toWorld(sx: number, sy: number) { return { x: (sx - this.view.x) / this.view.k, y: (sy - this.view.y) / this.view.k } }

  /** sector reached by following `path` (indices) outward from the focus */
  slotOfPath(path: number[]): { g: number; a0: number; a1: number; rIn: number; rOut: number } | null {
    const c = C()
    let a0 = THETA0, a1 = THETA0 + TAU, rIn = 0, rOut = R1
    for (let k = 1; k < path.length; k++) {
      const prev = path[k - 1], cur = path[k]
      const m = a0 + (a1 - a0) * this.split(prev)
      if (c.father[prev] === cur) a1 = m
      else if (c.mother[prev] === cur) a0 = m
      else return null
      const pw = rOut - rIn
      rIn = rOut; rOut = rIn + ringW(k, rIn, a1 - a0, pw)
    }
    return { g: path.length - 1, a0, a1, rIn, rOut }
  }
  bitsOfPath(path: number[]): number[] | null {
    const c = C(); const bits: number[] = []
    for (let k = 1; k < path.length; k++) {
      const prev = path[k - 1], cur = path[k]
      if (c.father[prev] === cur) bits.push(0)
      else if (c.mother[prev] === cur) bits.push(1)
      else return null
    }
    return bits
  }
  setSelected(i: number, pathFromFocus: number[] | null) {
    this.selected = i
    this.selSlot = null
    this.selChain = []
    if (i >= 0 && pathFromFocus && pathFromFocus[0] === this.focus) {
      for (let n = 2; n <= pathFromFocus.length; n++) {
        const sl = this.slotOfPath(pathFromFocus.slice(0, n))
        if (!sl) { this.selChain = []; break }
        this.selChain.push({ a0: sl.a0, a1: sl.a1, rIn: sl.rIn, rOut: sl.rOut })
      }
      const sl = this.slotOfPath(pathFromFocus)
      if (sl) this.selSlot = { g: sl.g, mid: (sl.a0 + sl.a1) / 2 }
    }
    this.request()
  }

  hitTest(sx: number, sy: number): Hit | null {
    const c = C()
    const p = this.toWorld(sx, sy)
    const r = Math.hypot(p.x, p.y)
    if (r < R1) return { i: this.focus, g: 0, a0: THETA0, a1: THETA0 + TAU, rIn: 0, rOut: R1 }
    let ang = Math.atan2(p.y, p.x)
    while (ang < THETA0) ang += TAU
    while (ang >= THETA0 + TAU) ang -= TAU
    let node = this.focus, a0 = THETA0, a1 = THETA0 + TAU, rOut = R1, pw = R1
    for (let g = 0; g < MAXG; g++) {
      const m = a0 + (a1 - a0) * this.split(node)
      const isF = ang < m
      const next = isF ? c.father[node] : c.mother[node]
      const b0 = isF ? a0 : m, b1 = isF ? m : a1
      const rIn = rOut, ro = rIn + ringW(g + 1, rIn, b1 - b0, pw)
      const hidden = next < 0 || (this.hideDoubtful && this.isHidden(next))
      if (r < ro) {
        if (hidden) return g + 1 <= 10 ? { i: -1, g: g + 1, a0: b0, a1: b1, rIn, rOut: ro, empty: isF ? 'father' : 'mother', child: node } : null
        return { i: next, g: g + 1, a0: b0, a1: b1, rIn, rOut: ro }
      }
      if (hidden || (b1 - b0) * ro * this.view.k < 1.2) return null
      node = next; a0 = b0; a1 = b1; pw = ro - rIn; rOut = ro
    }
    return null
  }
  private isHidden(i: number) {
    const c = C()
    if (this.hideDisproven && c.flags[i] & FL.disproven) return true
    return this.hideDoubtful && (!!(c.flags[i] & FL.doubtful) || c.tier[i] === 3)
  }

  // ---------------- loop ----------------
  private loop(t: number) {
    if (!this.alive) return
    this.raf = requestAnimationFrame(this.loop)
    let moving = false
    if (this.anim) {
      const a = this.anim
      const u = Math.min(1, (t - a.t0) / a.dur)
      const e = easeInOut(u)
      // interpolate in log-zoom space, keeping the screen-center world point path smooth
      const lk0 = Math.log(a.from.k), lk1 = Math.log(a.to.k)
      const k = Math.exp(lk0 + (lk1 - lk0) * e)
      const cx = this.w / 2, cy = this.h / 2
      const w0 = { x: (cx - a.from.x) / a.from.k, y: (cy - a.from.y) / a.from.k }
      const w1 = { x: (cx - a.to.x) / a.to.k, y: (cy - a.to.y) / a.to.k }
      // weight the world-center interpolation by zoom progress so dives feel natural
      const kk = (1 / a.from.k - 1 / k) / (1 / a.from.k - 1 / a.to.k || 1)
      const wt = Math.abs(lk1 - lk0) > 0.05 ? Math.max(0, Math.min(1, kk)) : e
      const wx = w0.x + (w1.x - w0.x) * wt, wy = w0.y + (w1.y - w0.y) * wt
      this.view = { k, x: cx - wx * k, y: cy - wy * k }
      moving = true
      if (u >= 1) { this.view = { ...a.to }; this.anim = null; a.done?.() }
    } else if (this.wheelTarget) {
      const tg = this.wheelTarget
      const f = 0.28
      this.view = { k: this.view.k + (tg.k - this.view.k) * f, x: this.view.x + (tg.x - this.view.x) * f, y: this.view.y + (tg.y - this.view.y) * f }
      if (Math.abs(tg.k - this.view.k) / tg.k < 0.002 && Math.abs(tg.x - this.view.x) < 0.3 && Math.abs(tg.y - this.view.y) < 0.3) { this.view = { ...tg }; this.wheelTarget = null }
      moving = true
    } else if (Math.abs(this.vel.x) + Math.abs(this.vel.y) > 0.05) {
      this.view.x += this.vel.x; this.view.y += this.vel.y
      this.vel.x *= 0.92; this.vel.y *= 0.92
      moving = true
    }
    if (moving) this.dirty = true
    if (this.dirty) { this.dirty = false; this.draw(); this.onChange?.() }
  }

  // ---------------- drawing ----------------
  private img(i: number): HTMLImageElement | null {
    if (this.imgs.has(i)) { const im = this.imgs.get(i)!; return im && im.complete && im.naturalWidth ? im : null }
    const url = portraitUrl(i)
    if (!url) { this.imgs.set(i, null); return null }
    const im = new Image(); im.decoding = 'async'; im.src = url
    im.onload = () => this.request()
    im.onerror = () => this.imgs.set(i, null)
    this.imgs.set(i, im)
    return null
  }
  // Text widths scale linearly with font size, so each string is measured once per typeface at a
  // reference size and scaled arithmetically. Zooming (continuously changing sizes) never re-measures.
  private faceCache = new Map<string, { face: string; ref: string; size: number }>()
  private parseFont(font: string) {
    let p = this.faceCache.get(font)
    if (!p) {
      const m = font.match(/^(.*?)(\d+(?:\.\d+)?)px (.*)$/)
      p = m ? { face: m[1] + '|' + m[3], ref: `${m[1]}100px ${m[3]}`, size: parseFloat(m[2]) } : { face: font, ref: font, size: 100 }
      if (this.faceCache.size > 4000) this.faceCache.clear()
      this.faceCache.set(font, p)
    }
    return p
  }
  private unitW(p: { face: string; ref: string }, s: string) {
    const key = p.face + '\u241f' + s
    let w = this.measure.get(key)
    if (w === undefined) {
      const prev = this.ctx.font
      this.ctx.font = p.ref
      w = this.ctx.measureText(s).width / 100
      this.ctx.font = prev
      if (this.measure.size > 400000) this.measure.clear()
      this.measure.set(key, w)
    }
    return w
  }
  private textW(font: string, s: string) { const p = this.parseFont(font); return this.unitW(p, s) * p.size }
  private fit(font: string, s: string, max: number) {
    if (!s) return ''
    const p = this.parseFont(font)
    const budgetAll = max / p.size
    const full = this.unitW(p, s)
    if (full <= budgetAll) return s
    const budget = budgetAll - this.unitW(p, '…')
    if (budget <= 0) return ''
    let n = Math.max(1, Math.min(s.length - 1, Math.floor((s.length * budget) / full)))
    while (n > 1 && this.unitW(p, s.slice(0, n)) > budget) n--
    while (n < s.length - 1 && this.unitW(p, s.slice(0, n + 1)) <= budget) n++
    return n <= 1 ? '' : s.slice(0, n).trimEnd() + '…'
  }

  private trimBuilds() {
    while (this.builds.length > 10) { const b = this.builds.pop()!; if (b.mesh) this.glf?.free(b.mesh) }
  }
  private baseKey() { return `${this.focus}|${this.weighted ? 1 : 0}|${this.hideDoubtful ? 1 : 0}${this.hideDisproven ? 1 : 0}|${this.mode}|${this.dark ? 1 : 0}` }
  private geoKey(kb: number) { return `${this.baseKey()}|${kb}` }

  // ---------- background builds (worker) ----------
  private ensureWorker(): boolean {
    const w = this.worker
    if (!w) return false
    const c = C()
    if (!this.workerInit) {
      this.split(0) // make sure weights exist
      const dim = new Uint8Array(c.N)
      const disp = new Uint8Array(c.N)
      for (let i = 0; i < c.N; i++) { dim[i] = (c.flags[i] & FL.doubtful) || c.tier[i] === 3 ? 1 : 0; disp[i] = c.flags[i] & FL.disproven ? 1 : 0 }
      w.postMessage({ type: 'init', father: c.father, mother: c.mother, dim, disp, frac: this.fracW, depth: this.depthW })
      this.workerInit = true
    }
    if (this.mode !== 'lines') {
      const ck = `${this.mode}|${this.dark ? 1 : 0}`
      if (!this.workerColors.has(ck)) {
        const packed = new Uint32Array(c.N)
        for (let i = 0; i < c.N; i++) packed[i] = packColor(wedgeColor(this.mode, i, 0, 0, this.dark))
        w.postMessage({ type: 'colors', key: ck, packed })
        this.workerColors.add(ck)
      }
    }
    return true
  }
  private requestBuild(kb: number, vr: Rect) {
    if (kb > 1024 || !this.ensureWorker()) return
    const key = this.geoKey(kb)
    if (this.builds.some(b => b.key === key && contains(b.region, vr))) return
    const pend = this.pending.get(key)
    if (pend && contains(pend, vr)) return
    const region = expand(vr, 0.35)
    this.pending.set(key, region)
    const req: BuildReq = { type: 'build', id: ++this.reqId, key, focus: this.focus, k: kb, region, weighted: this.weighted, hideDoubtful: this.hideDoubtful, hideDisproven: this.hideDisproven, mode: this.mode, dark: this.dark, colorsKey: `${this.mode}|${this.dark ? 1 : 0}` }
    this.worker!.postMessage(req)
  }
  private onBuilt(m: { key: string; kb: number; region: Rect; verts: ArrayBuffer; count: number; cand: Float64Array; empties: Float64Array; n: number }) {
    const pend = this.pending.get(m.key)
    if (pend === m.region || (pend && pend.x0 === m.region.x0 && pend.y0 === m.region.y0)) this.pending.delete(m.key)
    if (!this.glf || !this.alive) return
    const empties = new Path2D()
    const ws = { ox: 0, oy: 0, s: 1 }
    for (let j = 0; j < m.empties.length; j += 4) addWedge(empties, ws, m.kb, m.empties[j], m.empties[j + 1], m.empties[j + 2], m.empties[j + 3], 1.2, null)
    const base = m.key.slice(0, m.key.lastIndexOf('|'))
    const b: Built = { key: m.key, base, kb: m.kb, region: m.region, world: true, fills: new Map(), dims: new Map(), empties, cand: m.cand, n: m.n, mesh: this.glf.upload(m.verts, m.count) }
    this.builds.unshift(b)
    this.trimBuilds()
    this.request()
  }
  /** after a frame, pre-build the next zoom band for this region while the browser is idle */
  private queueWarm(kb: number, vr: Rect) {
    if (this.warmQueued) return
    const next = kb * 2
    if (next > 1024) return
    const key = this.geoKey(next)
    if (this.builds.some(b => b.key === key && contains(b.region, vr))) return
    this.warmQueued = true
    const ric: (cb: () => void) => void = (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 80))
    const opts = { timeout: 120 }
    ;((window as any).requestIdleCallback ? (cb: () => void) => (window as any).requestIdleCallback(cb, opts) : ric)(() => {
      this.warmQueued = false
      if (this.anim || this.wheelTarget) { return }
      const v = this.view
      const vr2: Rect = { x0: -v.x / v.k, y0: -v.y / v.k, x1: (this.w - v.x) / v.k, y1: (this.h - v.y) / v.k }
      const kb2 = Math.pow(2, Math.ceil(Math.log2(v.k) - 1e-9)) * 2
      if (kb2 > 1024) return
      const key2 = this.geoKey(kb2)
      if (this.builds.some(b => b.key === key2 && contains(b.region, vr2))) return
      const b = this.build(kb2, expand(vr2, 0.35), true)
      this.builds.splice(1, 0, b)
      this.trimBuilds()
    })
  }

  /** Build wedge geometry at zoom `k`, restricted to `region` (world rect). world=true: coordinates in world
   *  units (drawn with a scaling transform, cached); false: screen pixels (double precision, per frame). */
  private build(k: number, region: Rect, world: boolean): Built {
    const c = C()
    const dark = this.dark
    const self = this
    const view = this.view
    const inside = region.x0 <= 0 && region.x1 >= 0 && region.y0 <= 0 && region.y1 >= 0
    const cxp = Math.max(region.x0, Math.min(0, region.x1)), cyp = Math.max(region.y0, Math.min(0, region.y1))
    const dmin = inside ? 0 : Math.hypot(cxp, cyp)
    let dmax = 0
    for (const [x, y] of [[region.x0, region.y0], [region.x1, region.y0], [region.x0, region.y1], [region.x1, region.y1]]) dmax = Math.max(dmax, Math.hypot(x, y))
    const full = inside || dmin < R1
    let va0 = 0, vspan = TAU
    if (!full) {
      const ca = Math.atan2((region.y0 + region.y1) / 2, (region.x0 + region.x1) / 2)
      let lo = 0, hi = 0
      for (const [x, y] of [[region.x0, region.y0], [region.x1, region.y0], [region.x0, region.y1], [region.x1, region.y1]]) {
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
    const clip = full ? null : { wa0: va0 - Math.max(0.002, vspan * 0.05), wspan: vspan + 2 * Math.max(0.002, vspan * 0.05), lo: Math.max(0, dmin - 6 / k), hi: dmax + 6 / k }
    const space = world ? { ox: 0, oy: 0, s: 1 } : { ox: view.x, oy: view.y, s: k }
    const fills = new Map<string, Path2D>(), dims = new Map<string, Path2D>()
    const tess = world && this.glf ? new Tess() : null
    const dimA = dark ? 0.42 : 0.5
    const empties = new Path2D()
    const cand: number[] = []
    let n = 0
    const add = (dim: boolean, col: string) => {
      const m = dim ? dims : fills
      let p = m.get(col); if (!p) { p = new Path2D(); m.set(col, p) }
      return p
    }
    const minPx = 0.9
    const fill = (dim: boolean, col: string, a0: number, a1: number, rIn: number, rOut: number, gapPx: number): boolean => {
      if (!tess) return addWedge(add(dim, col), space, k, a0, a1, rIn, rOut, gapPx, clip)
      const gm = wedgeGeom(k, a0, a1, rIn, rOut, gapPx, clip)
      if (!gm) return false
      const segs = Math.max(1, Math.min(96, Math.ceil(((gm[1] - gm[0]) * gm[3] * k) / 6)))
      tess.sector(gm[0], gm[1], gm[2], gm[3], segs, packColor(col, dim ? dimA : 1))
      return true
    }

    function visit(i: number, g: number, a0: number, a1: number, rIn: number, rOut: number) {
      if (rIn > dmax) return
      if (!angVisible(a0, a1)) return
      const arcPx = (a1 - a0) * rOut * k
      const dim = !!(c.flags[i] & FL.doubtful) || c.tier[i] === 3
      const frac = ((a0 + a1) / 2 - THETA0) / TAU
      if (g > 0 && rOut >= dmin) {
        if (fill(dim, wedgeColor(self.mode, i, frac, g, dark), a0, a1, rIn, rOut, 1.2)) n++
        cand.push(i, g, a0, a1, rIn, rOut, 0)
      }
      if (g >= MAXG - 1) return
      const f = c.father[i], m = c.mother[i]
      if (arcPx < minPx * 2) {
        // too small to split further: one solid cap in this line's color, about as deep as what it hides
        if ((f >= 0 || m >= 0) && rOut >= dmin) {
          const d = Math.max(1, self.depthOf(i) - 1)
          fill(dim, wedgeColor(self.mode, i, frac, g + 1, dark), a0, a1, rOut, rOut + (rOut - rIn) * Math.min(2, 0.9 * d), 0)
        }
        return
      }
      const mid = a0 + (a1 - a0) * self.split(i)
      const showF = f >= 0 && !(self.hideDoubtful && self.isHidden(f))
      const showM = m >= 0 && !(self.hideDoubtful && self.isHidden(m))
      const pw = rOut - rIn
      const roF = rOut + ringW(g + 1, rOut, mid - a0, pw), roM = rOut + ringW(g + 1, rOut, a1 - mid, pw)
      if (showF) visit(f, g + 1, a0, mid, rOut, roF)
      else if (g + 1 <= 10 && rOut <= dmax && (mid - a0) * roF * k > 9 && angVisible(a0, mid)) { addWedge(empties, space, k, a0, mid, rOut, roF, 1.2, clip); cand.push(-1, g + 1, a0, mid, rOut, roF, 1) }
      if (showM) visit(m, g + 1, mid, a1, rOut, roM)
      else if (g + 1 <= 10 && rOut <= dmax && (a1 - mid) * roM * k > 9 && angVisible(mid, a1)) { addWedge(empties, space, k, mid, a1, rOut, roM, 1.2, clip); cand.push(-1, g + 1, mid, a1, rOut, roM, 2) }
    }
    visit(this.focus, 0, THETA0, THETA0 + TAU, 0, R1)
    const mesh = tess && this.glf ? this.glf.upload(tess.data(), tess.count) : null
    return { key: world ? this.geoKey(k) : '', base: this.baseKey(), kb: k, region: world ? region : null, world, fills, dims, empties, cand, n, mesh }
  }

  draw() {
    const { ctx, dpr, view } = this
    const c = C()
    const dark = this.dark
    const bg = dark ? '#0d1016' : '#f6f3ec'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (this.glf) { this.glf.clear(rgbOf(bg)); ctx.clearRect(0, 0, this.w, this.h) }
    else { ctx.fillStyle = bg; ctx.fillRect(0, 0, this.w, this.h) }
    // soft vignette glow behind the fan (2D-only renderer; the GPU layer sits under this canvas)
    if (!this.glf) {
    const gr = ctx.createRadialGradient(view.x, view.y, 0, view.x, view.y, Math.max(200, this.extent() * view.k))
    gr.addColorStop(0, dark ? 'rgba(217,179,108,0.07)' : 'rgba(160,120,50,0.07)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gr; ctx.fillRect(0, 0, this.w, this.h)
    }

    const k = view.k
    const vr: Rect = { x0: -view.x / k, y0: -view.y / k, x1: (this.w - view.x) / k, y1: (this.h - view.y) / k }
    const t0 = performance.now()
    const kb = Math.pow(2, Math.ceil(Math.log2(k) - 1e-9))
    const worldOK = kb <= 1024
    let B: Built
    if (worldOK) {
      const key = this.geoKey(kb)
      let hit = this.builds.find(b => b.key === key && contains(b.region, vr))
      if (!hit && this.worker) {
        // ask the worker for this band and, meanwhile, show the nearest band we already have
        this.requestBuild(kb, vr)
        const base = this.baseKey()
        let bestD = Infinity
        for (const b of this.builds) {
          if (b.base !== base || !contains(b.region, vr)) continue
          const d = Math.abs(Math.log2(b.kb / kb)) + (b.kb < kb ? 0.01 : 0)
          if (d < bestD) { bestD = d; hit = b }
        }
      }
      if (!hit) {
        hit = this.build(kb, expand(vr, 0.35), true)
        this.builds.unshift(hit)
        this.trimBuilds()
      }
      B = hit
      if (this.worker) { this.requestBuild(kb * 2, vr); if (kb / 2 >= 1 / 64) this.requestBuild(kb / 2, vr) }
      else this.queueWarm(kb, vr)
    } else {
      B = this.build(k, vr, false)
    }
    const t1 = performance.now()

    // --- fills
    if (B.world) ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.x, dpr * view.y)
    else ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const px = B.world ? 1 / k : 1          // one screen pixel in the current drawing space
    if (B.mesh && this.glf) this.glf.draw(B.mesh, view)
    else {
      for (const [col, p] of B.fills) { ctx.fillStyle = col; ctx.fill(p) }
      ctx.globalAlpha = dark ? 0.42 : 0.5
      for (const [col, p] of B.dims) { ctx.fillStyle = col; ctx.fill(p) }
      ctx.globalAlpha = 1
    }
    ctx.lineWidth = 1.2 * px
    ctx.setLineDash([4 * px, 4 * px])
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)'
    ctx.stroke(B.empties)
    ctx.setLineDash([])

    // --- overlays (hover, selection path, other appearances of the selected person)
    const space = B.world ? { ox: 0, oy: 0, s: 1 } : { ox: view.x, oy: view.y, s: k }
    const ov = (a0: number, a1: number, rIn: number, rOut: number) => { const p = new Path2D(); addWedge(p, space, k, a0, a1, rIn, rOut, 1.2, null); return p }
    if (this.hover && this.hover.i >= 0 && this.hover.g > 0) {
      const h = this.hover
      ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.4)'
      ctx.fill(ov(h.a0, h.a1, h.rIn, h.rOut))
    }
    if (this.selChain.length) {
      const p = new Path2D()
      for (const w of this.selChain) addWedge(p, space, k, w.a0, w.a1, w.rIn, w.rOut, 1.2, null)
      ctx.lineJoin = 'round'
      ctx.fillStyle = dark ? 'rgba(233,194,122,0.10)' : 'rgba(168,116,31,0.10)'
      ctx.fill(p)
      ctx.strokeStyle = dark ? '#e9c27a' : '#a8741f'
      ctx.lineWidth = 2.4 * px
      ctx.stroke(p)
    }
    if (this.selected >= 0) {
      const p = new Path2D(); let any = false
      const last = this.selChain[this.selChain.length - 1]
      const cd = B.cand
      for (let j = 0; j < cd.length; j += 7) {
        if (cd[j] !== this.selected || cd[j + 6]) continue
        if (last && Math.abs(cd[j + 2] - last.a0) < 1e-12 && Math.abs(cd[j + 4] - last.rIn) < 1e-9) continue
        addWedge(p, space, k, cd[j + 2], cd[j + 3], cd[j + 4], cd[j + 5], 1.2, null); any = true
      }
      if (any) { ctx.strokeStyle = dark ? '#e9c27a' : '#a8741f'; ctx.setLineDash([3 * px, 3 * px]); ctx.lineWidth = 1.6 * px; ctx.stroke(p); ctx.setLineDash([]) }
    }
    const t2 = performance.now()

    // --- label candidates from the cached geometry, filtered for this frame
    const labels: Label[] = []
    const cd = B.cand
    const mx = 40 / k
    for (let j = 0; j < cd.length && labels.length < 700; j += 7) {
      const rIn = cd[j + 4], rOut = cd[j + 5], a0 = cd[j + 2], a1 = cd[j + 3], e = cd[j + 6]
      const ringPx = (rOut - rIn) * k, arcPx = (a1 - a0) * ((rIn + rOut) / 2) * k
      if (e) { if (ringPx <= 40 || (a1 - a0) * rOut * k <= 30) continue }
      else if (ringPx <= 16 || arcPx <= 12) continue
      const am = (a0 + a1) / 2, rm = (rIn + rOut) / 2
      const x = Math.cos(am) * rm, y = Math.sin(am) * rm
      if (x < vr.x0 - mx - (rOut - rIn) || x > vr.x1 + mx + (rOut - rIn) || y < vr.y0 - mx - (rOut - rIn) || y > vr.y1 + mx + (rOut - rIn)) continue
      labels.push({ i: cd[j], g: cd[j + 1], a0, a1, rIn, rOut, empty: e === 1 ? 'father' : e === 2 ? 'mother' : undefined })
    }
    const nWedges = B.n

    // --- center disc
    this.drawCenter()
    // --- labels (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const L of labels) this.drawLabel(L)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const t3 = performance.now()
    this.stats = { wedges: nWedges, labels: labels.length, build: +(t1 - t0).toFixed(2), fill: +(t2 - t1).toFixed(2), text: +(t3 - t2).toFixed(2) }
  }
  stats = { wedges: 0, labels: 0, build: 0, fill: 0, text: 0 }

  private drawCenter() {
    const { ctx, dpr, view } = this
    const c = C(); const i = this.focus
    const k = view.k
    const r = R1 * k
    const cx = view.x, cy = view.y
    if (cx + r < 0 || cy + r < 0 || cx - r > this.w || cy - r > this.h) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const dark = this.dark
    // disc
    ctx.beginPath(); ctx.arc(cx, cy, r - 1.5, 0, TAU)
    ctx.fillStyle = dark ? '#1a1f29' : '#fffdf8'; ctx.fill()
    ctx.lineWidth = Math.max(1.5, 2.5 * Math.min(1, k)); ctx.strokeStyle = dark ? '#d9b36c' : '#a8741f'; ctx.stroke()
    if (this.selected === i) { ctx.lineWidth = 3; ctx.stroke() }
    if (r < 18) return
    const im = this.showPhotos ? this.img(i) : null
    const name = c.names[i]
    const [given, sur] = splitName(name)
    let y = cy
    if (im && r > 50) {
      const d = r * 0.9
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy - r * 0.32, d / 2, 0, TAU); ctx.clip()
      ctx.drawImage(im, cx - d / 2, cy - r * 0.32 - d / 2, d, d); ctx.restore()
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.32, d / 2, 0, TAU); ctx.lineWidth = 1.5; ctx.strokeStyle = dark ? 'rgba(217,179,108,0.6)' : 'rgba(168,116,31,0.6)'; ctx.stroke()
      y = cy + r * 0.3
    }
    const fs = Math.max(9, Math.min(24, r * 0.16))
    const fontN = `600 ${q(fs)}px "Fraunces Variable", Georgia, serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = dark ? '#f3ece0' : '#1d1a15'
    const maxw = r * 1.6
    if (im && r > 50) {
      ctx.font = fontN; ctx.fillText(this.fit(fontN, name.replace(/\(.*?\)/g, '').trim(), maxw), cx, y)
      const yr = years(i), rel = relationLabel(i)
      const f2 = `500 ${q(Math.max(8, fs * 0.62))}px "Inter Variable", system-ui, sans-serif`
      ctx.font = f2; ctx.fillStyle = dark ? 'rgba(243,236,224,0.66)' : 'rgba(29,26,21,0.6)'
      ctx.fillText(this.fit(f2, [yr, this.focus === c.root ? '' : rel].filter(Boolean).join(' · '), maxw), cx, y + fs * 1.05)
    } else {
      ctx.font = fontN; ctx.fillText(this.fit(fontN, given, maxw), cx, cy - fs * 0.85)
      ctx.fillText(this.fit(fontN, sur, maxw), cx, cy + fs * 0.3)
      const f2 = `500 ${q(Math.max(8, fs * 0.62))}px "Inter Variable", system-ui, sans-serif`
      ctx.font = f2; ctx.fillStyle = dark ? 'rgba(243,236,224,0.66)' : 'rgba(29,26,21,0.6)'
      ctx.fillText(this.fit(f2, [years(i), this.focus === c.root ? '' : relationLabel(i)].filter(Boolean).join(' · '), maxw), cx, cy + fs * 1.45)
    }
  }

  private drawLabel(L: Label) {
    const { ctx, view } = this
    const c = C()
    const dark = this.dark
    const k = view.k
    const rm = ((L.rIn + L.rOut) / 2)
    const mid = (L.a0 + L.a1) / 2
    const ringPx = (L.rOut - L.rIn) * k
    const arcPx = (L.a1 - L.a0) * rm * k
    const cx = view.x + Math.cos(mid) * rm * k, cy = view.y + Math.sin(mid) * rm * k
    if (cx < -ringPx || cy < -ringPx || cx > this.w + ringPx || cy > this.h + ringPx) return
    const tangential = arcPx > ringPx * 0.95
    let rot: number, bw: number, bh: number
    if (tangential) {
      rot = mid + Math.PI / 2
      bw = Math.min(arcPx * 0.86, 2 * Math.sin(Math.min(Math.PI / 2, (L.a1 - L.a0) / 2)) * L.rIn * k * 0.95 || arcPx * 0.86); bh = ringPx * 0.86
      bw = Math.max(bw, Math.min(arcPx * 0.86, ringPx))
    } else { rot = mid; bw = ringPx * 0.9; bh = arcPx * 0.84; if (bh < 9) return }
    let n = rot % TAU; if (n < 0) n += TAU
    const flip = n > Math.PI / 2 && n < (3 * Math.PI) / 2
    if (flip) rot += Math.PI
    const cr = Math.cos(rot), sr = Math.sin(rot), dd = this.dpr
    ctx.setTransform(dd * cr, dd * sr, -dd * sr, dd * cr, dd * cx, dd * cy)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const ink = dark ? '#f6f0e4' : '#1b1813'
    const sub = dark ? 'rgba(246,240,228,0.68)' : 'rgba(27,24,19,0.62)'
    if (L.empty) {
      const fs = Math.max(9, Math.min(15, bh * 0.28))
      ctx.font = `italic 400 ${q(fs)}px "Fraunces Variable", Georgia, serif`; ctx.fillStyle = dark ? 'rgba(255,255,255,0.32)' : 'rgba(0,0,0,0.35)'
      ctx.fillText(this.fit(ctx.font, L.empty === 'father' ? 'Unknown father' : 'Unknown mother', bw * 0.9), 0, 0)
      return
    }
    const i = L.i
    const name = c.names[i].replace(/\(.*?\)|".*?"/g, '').replace(/\s+/g, ' ').trim()
    const [given, sur] = splitName(name)
    const yr = years(i)
    const hasImg = this.showPhotos && c.portrait.has(i)
    // layout
    let im: HTMLImageElement | null = null
    let photo = 0
    if (hasImg && Math.min(bw, bh) >= 46) { im = this.img(i); photo = Math.min(Math.min(bw, bh) * (tangential ? 0.58 : 0.8), tangential ? bh * 0.55 : bh * 0.86, 132) }
    if (tangential) {
      // stack: photo, given, SURNAME, years along the radial axis (y)
      const lines: { t: string; f: string; c: string }[] = []
      const fsBase = Math.max(8.5, Math.min(20, Math.min(bh * 0.17, bw * 0.16)))
      const fN = `600 ${q(fsBase)}px "Fraunces Variable", Georgia, serif`
      const fY = `500 ${q(Math.max(7.5, fsBase * 0.7))}px "Inter Variable", system-ui, sans-serif`
      const twoLine = bh - photo > fsBase * 3.4
      if (twoLine) { lines.push({ t: given, f: fN, c: ink }); if (sur) lines.push({ t: sur, f: fN, c: ink }) }
      else lines.push({ t: name, f: fN, c: ink })
      if (yr && bh - photo > fsBase * (lines.length + 1.6)) lines.push({ t: yr, f: fY, c: sub })
      const lh = fsBase * 1.12
      const total = (photo ? photo + fsBase * 0.35 : 0) + lines.length * lh
      let y = -total / 2
      if (photo) {
        if (im) this.drawPortrait(im, 0, y + photo / 2, photo / 2)
        else this.drawPortraitPlaceholder(0, y + photo / 2, photo / 2)
        y += photo + fsBase * 0.35
      }
      for (const ln of lines) { ctx.font = ln.f; ctx.fillStyle = ln.c; const t = this.fit(ln.f, ln.t, bw * 0.94); if (t) ctx.fillText(t, 0, y + lh / 2); y += lh }
    } else {
      // radial: text runs along the radius (x); photo at the outer end
      const outerSign = flip ? -1 : 1
      const fs = Math.max(7.5, Math.min(17, bh * (bh > 26 ? 0.36 : 0.62)))
      const fN = `600 ${q(fs)}px "Fraunces Variable", Georgia, serif`
      const fY = `500 ${q(Math.max(7, fs * 0.74))}px "Inter Variable", system-ui, sans-serif`
      let textW = bw
      let tx = 0
      if (photo) {
        const pr = photo / 2
        const px = outerSign * (bw / 2 - pr)
        if (im) this.drawPortrait(im, px, 0, pr); else this.drawPortraitPlaceholder(px, 0, pr)
        textW = bw - photo - 6
        tx = -outerSign * (photo + 6) / 2
      }
      const two = bh > fs * 2.5
      ctx.fillStyle = ink; ctx.font = fN
      if (two) {
        const t1 = this.fit(fN, name, textW)
        ctx.fillText(t1, tx, -fs * 0.55)
        if (yr) { ctx.font = fY; ctx.fillStyle = sub; ctx.fillText(this.fit(fY, yr, textW), tx, fs * 0.62) }
      } else {
        const t1 = this.fit(fN, name + (yr && this.textW(fN, name) + this.textW(fY, yr) < textW * 0.9 ? '' : ''), textW)
        ctx.fillText(t1, tx, 0)
      }
    }
  }
  private drawPortrait(im: HTMLImageElement, x: number, y: number, r: number) {
    const ctx = this.ctx
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip()
    ctx.drawImage(im, x - r, y - r, 2 * r, 2 * r); ctx.restore()
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.lineWidth = 1.25
    ctx.strokeStyle = this.dark ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.9)'; ctx.stroke()
  }
  private drawPortraitPlaceholder(x: number, y: number, r: number) {
    const ctx = this.ctx
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = this.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'; ctx.fill()
  }
}

export { THETA0, TAU }
