import { C, FL, placeName, getRouteCounts } from './store'
import { linesColor } from './fan/shared'

export type ColorMode = 'lines' | 'confidence' | 'origin' | 'century' | 'collapse'

// OKLCH -> sRGB (perceptually even hues)
export function oklch(L: number, Cc: number, h: number, a = 1): string {
  const hr = (h * Math.PI) / 180
  const A = Cc * Math.cos(hr), B = Cc * Math.sin(hr)
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B
  const s_ = L - 0.0894841775 * A - 1.291485548 * B
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  let b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  const f = (x: number) => {
    x = Math.max(0, Math.min(1, x))
    return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055))
  }
  return a === 1 ? `rgb(${f(r)},${f(g)},${f(b)})` : `rgba(${f(r)},${f(g)},${f(b)},${a})`
}

const cache = new Map<string, string>()
function memo(k: string, f: () => string) {
  let v = cache.get(k)
  if (v === undefined) { v = f(); cache.set(k, v) }
  return v
}

// Validated categorical palette (dataviz reference instance), fixed order; 'Other' is a neutral fold-in bucket.
export const COUNTRIES = ['United States', 'England', 'Scotland', 'Ireland', 'Wales', 'France', 'Germany', 'Other']
export const COUNTRY_HEX: Record<string, [string, string]> = { // [light, dark]
  'United States': ['#2a78d6', '#3987e5'], England: ['#eb6834', '#d95926'], Scotland: ['#1baf7a', '#199e70'], Ireland: ['#eda100', '#c98500'],
  Wales: ['#e87ba4', '#d55181'], France: ['#008300', '#008300'], Germany: ['#6250d6', '#9085e9'], Other: ['#a3a29d', '#6b6a66'],
}
export const countryColor = (k: string, dark: boolean) => COUNTRY_HEX[k][dark ? 1 : 0]

let countryCode: Int8Array | null = null
const CC_LIST = COUNTRIES
function classify(p: string): string | null {
  const s = p.toLowerCase()
  if (!s) return null
  if (/virginia|carolina|maryland|georgia|alabama|tennessee|kentucky|pennsylvania|new york|jersey|massachusetts|connecticut|united states|usa\b|colonial america|delaware|ohio|texas|mississippi|missouri|louisiana|indiana|illinois|d\.c\.|\bva\b|\bnc\b|\bsc\b|rhode island|new hampshire|vermont|maine|florida|arkansas|oklahoma|minnesota|dakota|california|michigan|wisconsin|iowa|kansas/.test(s)) return 'United States'
  if (/barbados|antigua|jamaica|bermuda|west indies|leeward/.test(s)) return 'Caribbean'
  if (/scotland|edinburgh|glasgow|stirling|aberdeen|fife|perth/.test(s)) return 'Scotland'
  if (/ireland|tyrone|dublin|cork|ulster|antrim|down\b|kerry|galway/.test(s)) return 'Ireland'
  if (/wales|glamorgan|pembroke|carmarthen|monmouth/.test(s)) return 'Wales'
  if (/england|lancashire|yorkshire|london|kent|norfolk|devon|essex|wiltshire|cheshire|gloucester|somerset|sussex|surrey|lincoln|suffolk|northampton|hampshire|warwick|derby|nottingham|leicester|oxford|berkshire|cornwall|dorset|stafford|shropshire|hereford|worcester|cumberland|westmorland|durham|northumberland|bedford|buckingham|hertford|cambridge|huntingdon|rutland|middlesex|united kingdom/.test(s)) return 'England'
  if (/france|normand|bretagne|brittany|anjou|aquitaine|poitou|burgund|bourgogne|champagne|picardie|flandre|provence|toulouse|paris|maine,|blois|vermandois|chartres/.test(s)) return 'France'
  if (/germany|deutschland|prussia|bayern|bavaria|saxony|sachsen|holy roman|franconia|swabia|thuringia|westphalia|hesse|lorraine|lothringen|alsace/.test(s)) return 'Germany'
  if (/netherlands|holland|flanders|belgium|brabant|hainaut|luxembourg|zeeland|friesland/.test(s)) return 'Low Countries'
  if (/spain|castil|le[oó]n|aragon|navarr|portugal|galicia|catalon|barcelona/.test(s)) return 'Iberia'
  if (/italy|italia|rome|lombard|tuscany|savoy|sicily|naples|venice|milan/.test(s)) return 'Italy'
  if (/sweden|norway|denmark|scandinav|iceland|norge|danmark/.test(s)) return 'Scandinavia'
  return 'Other'
}
export function countryOf(i: number): string | null {
  const c = C()
  if (!countryCode) countryCode = new Int8Array(c.N).fill(-2)
  let v = countryCode[i]
  if (v === -2) {
    const p = placeName(c.bplace[i]) || placeName(c.dplace[i])
    const k = p ? classify(p) : null
    v = k ? CC_LIST.indexOf(CC_LIST.includes(k) ? k : 'Other') : -1
    countryCode[i] = v
  }
  return v >= 0 ? CC_LIST[v] : null
}

export const CONF_COLORS = {
  verified: [0.72, 0.13, 155], probable: [0.76, 0.12, 125], tree: [0.62, 0.035, 250], medieval: [0.6, 0.08, 295],
  legendary: [0.56, 0.06, 320], doubtful: [0.58, 0.13, 30], conflict: [0.72, 0.14, 70],
} as const

export function confKey(i: number): keyof typeof CONF_COLORS {
  const c = C()
  if (c.flags[i] & FL.doubtful) return 'doubtful'
  const conf = c.conf[i], t = c.tier[i]
  if (conf === 3 || t === 5) return 'conflict'
  if (conf === 0) return 'verified'
  if (conf === 1) return 'probable'
  if (t === 3) return 'legendary'
  if (t === 2) return 'medieval'
  return 'tree'
}

export interface Theme { dark: boolean }

/** Fill color for a wedge. frac = angular position 0..1 around the fan, g = ring (generation from focus). */
export function wedgeColor(mode: ColorMode, i: number, frac: number, g: number, dark: boolean, hi = false): string {
  const c = C()
  const dim = c.flags[i] & FL.doubtful || c.tier[i] === 3
  const dl = hi ? 0.07 : 0
  switch (mode) {
    case 'lines':
      return linesColor(frac, g, !!dim, dark, hi)
    case 'confidence': {
      const k = confKey(i)
      const [L, ch, h] = CONF_COLORS[k]
      const LL = dark ? L - 0.08 : L + 0.1
      return memo(`c${k}${dark}${hi}`, () => oklch(LL + dl, ch * (dark ? 0.9 : 0.75), h))
    }
    case 'origin': {
      const k = countryOf(i)
      if (!k) return memo(`o-none${dark}${hi}`, () => oklch((dark ? 0.36 : 0.86) + dl, 0.01, 260))
      return hi ? memo(`oh${k}${dark}`, () => mix(countryColor(k, dark), dark ? '#ffffff' : '#ffffff', 0.18)) : countryColor(k, dark)
    }
    case 'collapse': {
      // pedigree collapse: how many distinct routes lead from you to this ancestor (sequential, one hue)
      const n = getRouteCounts().all[i] || 1
      if (n < 1.5) return memo(`k1${dark}${hi}`, () => oklch((dark ? 0.34 : 0.88) + dl, 0.012, 250))
      const t = Math.min(1, Math.log10(n) / 6)          // 2 routes .. a million+
      const step = Math.round(t * 12)
      const L = dark ? 0.82 - step * 0.035 : 0.84 - step * 0.042
      return memo(`k${step}${dark}${hi}`, () => oklch(L + dl, 0.07 + step * 0.008, 55 - step * 2.5))
    }
    case 'century': {
      const b = c.birth[i]
      if (!b) return memo(`y-none${dark}${hi}`, () => oklch((dark ? 0.36 : 0.86) + dl, 0.01, 260))
      const t = Math.max(0, Math.min(1, (b - 1000) / 1000))
      const h = 300 - t * 230 // violet (old) -> teal -> warm (recent)
      const L = dark ? 0.45 + t * 0.3 : 0.6 + t * 0.25
      return memo(`y${Math.round(t * 60)}${dark}${hi}`, () => oklch(L + dl, 0.11, h))
    }
  }
}

export function centuryLegend(): { label: string; color: string }[] {
  const out = []
  for (const y of [1100, 1300, 1500, 1700, 1850, 2000]) {
    const t = (y - 1000) / 1000
    out.push({ label: String(y), color: oklch(0.5 + t * 0.28, 0.11, 300 - t * 230) })
  }
  return out
}

function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map(o => parseInt(h.slice(o, o + 2), 16))
  const x = p(a), y = p(b)
  return `rgb(${x.map((v, k) => Math.round(v + (y[k] - v) * t)).join(',')})`
}
