// Pure geometry + color helpers shared by the main thread and the build worker (no DOM, no store).

export const TAU = Math.PI * 2
export const THETA0 = Math.PI / 2
export const MAXG = 220
export const R1 = 118

/** radial depth of a wedge in generation g starting at radius rIn, spanning dTheta, whose child ring was prevW deep */
export function ringW(g: number, rIn: number, dTheta: number, prevW: number): number {
  if (g <= 1) return 112
  const square = rIn * dTheta * 0.95
  const cap = g <= 3 ? 124 : 140
  const floor = g <= 4 ? 64 : 0
  let w = Math.max(floor, Math.min(cap, square))
  // beyond the first generations every step is at most 80% as deep as the last, so all lines converge
  if (g >= 5) w = Math.min(w, prevW * 0.8)
  return w
}

export type Clip = { wa0: number; wspan: number; lo: number; hi: number }

/** gap-shrunk, window-trimmed sector [b0, b1, ri, ro], or null if nothing remains */
export function wedgeGeom(k: number, a0: number, a1: number, rIn: number, rOut: number, gapPx: number, clip: Clip | null): [number, number, number, number] | null {
  const arcPx = (a1 - a0) * rOut * k
  let ga = 0, gr = 0
  if (gapPx > 0) {
    const t = Math.max(0, Math.min(1, (arcPx - 3) / 7))           // gaps fade in smoothly
    ga = t * Math.min((a1 - a0) * 0.2, gapPx / (rOut * k))
    gr = t * Math.min((rOut - rIn) * 0.12, gapPx / (2 * k))
  }
  let b0 = a0 + ga / 2, b1 = a1 - ga / 2
  let ri = rIn === 0 ? 0 : rIn + gr, ro = rOut - gr
  if (clip) {
    let s0 = (b0 - clip.wa0) % TAU; if (s0 < 0) s0 += TAU
    const w = b1 - b0
    if (s0 + w <= TAU) {
      const lo = Math.max(s0, 0), hi = Math.min(s0 + w, clip.wspan)
      if (hi <= lo) return null
      b0 = clip.wa0 + lo; b1 = clip.wa0 + hi
    }
    if (ri > 0) ri = Math.max(ri, clip.lo)
    ro = Math.min(ro, clip.hi)
  }
  return ro > ri ? [b0, b1, ri, ro] : null
}

// OKLCH -> sRGB (perceptually even hues)
export function oklch(L: number, Cc: number, h: number, a = 1): string {
  const hr = (h * Math.PI) / 180
  const A = Cc * Math.cos(hr), B = Cc * Math.sin(hr)
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const f = (x: number) => {
    x = Math.max(0, Math.min(1, x))
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
  }
  return a === 1 ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${a})`
}

const linesCache = new Map<number, string>()
/** 'Lines' color mode: hue follows the angular position, lightness the generation; muted for doubtful lines */
export function linesColor(frac: number, g: number, dim: boolean, dark: boolean, hi = false): string {
  const hq = Math.round(((((frac * 360 + 205) % 360) + 360) % 360) / 3)   // 0..120
  const gq = Math.min(g, 14)
  const key = ((hq * 16 + gq) * 2 + (dim ? 1 : 0)) * 4 + (dark ? 2 : 0) + (hi ? 1 : 0)
  let v = linesCache.get(key)
  if (v === undefined) {
    const L = dark ? Math.max(0.42, 0.7 - gq * 0.02) : Math.min(0.9, 0.7 + gq * 0.013)
    const ch = dim ? 0.025 : dark ? 0.085 : 0.075
    v = oklch(L + (hi ? 0.07 : 0), ch, hq * 3)
    linesCache.set(key, v)
  }
  return v
}
