import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { C, FL, ahnPath, displayName, loadJSON, portraitUrl, sideOf, years, relationLabel } from '../store'
import { Icon } from '../components/Icon'

interface Geo { i: number[]; y: number[]; x: number[]; z: number[]; k: number[]; q: number[] }
interface Track { i: number; b: number; d: number; ys: Float32Array; xs: Float32Array; zs: Float32Array; q: Uint8Array }

interface Props { dark: boolean; selected: number; onSelect: (i: number) => void; year: number; setYear: (y: number) => void; rightInset: number }

const MIN_Y = 1000, MAX_Y = 2025

// OpenFreeMap: free vector tiles, no key (https://openfreemap.org)
function basemap(dark: boolean): string {
  return `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`
}

export function MapView({ dark, selected, onSelect, year, setYear, rightInset }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<MLMap | null>(null)
  const [tracks, setTracks] = useState<Track[] | null>(null)
  const [ready, setReady] = useState(false)
  const [styleVer, setStyleVer] = useState(0)
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect
  const [playing, setPlaying] = useState(false)
  const [sideF, setSideF] = useState<'all' | 'paternal' | 'maternal'>('all')
  const [doubt, setDoubt] = useState(false)
  const [weight, setWeight] = useState<'equal' | 'genetic'>('equal')
  const [count, setCount] = useState({ n: 0, am: 0, eu: 0 })
  const markers = useRef<maplibregl.Marker[]>([])
  const popup = useRef<maplibregl.Popup | null>(null)

  // ---- load + index geo events
  useEffect(() => {
    loadJSON<Geo>('geo.json').then(g => {
      const c = C()
      const by = new Map<number, number[]>()
      for (let k = 0; k < g.i.length; k++) { const i = g.i[k]; let a = by.get(i); if (!a) by.set(i, a = []); a.push(k) }
      const out: Track[] = []
      for (const [i, ks] of by) {
        ks.sort((a, b) => g.y[a] - g.y[b])
        const ys = Float32Array.from(ks.map(k => g.y[k]))
        const b = c.birth[i] || ys[0]
        const d = c.death[i] || Math.max(ys[ys.length - 1], b + 60)
        out.push({ i, b, d, ys, xs: Float32Array.from(ks.map(k => g.x[k])), zs: Float32Array.from(ks.map(k => g.z[k])), q: Uint8Array.from(ks.map(k => g.q[k])) })
      }
      setTracks(out)
    })
  }, [])

  // ---- histogram (located ancestors alive per decade)
  const hist = useMemo(() => {
    if (!tracks) return null
    const c = C()
    const bins = new Array(Math.ceil((MAX_Y - MIN_Y) / 10) + 1).fill(0)
    for (const t of tracks) {
      if (c.flags[t.i] & FL.doubtful || c.tier[t.i] === 3) continue
      for (let y = Math.max(MIN_Y, Math.ceil(t.b / 10) * 10); y <= Math.min(MAX_Y, t.d); y += 10) bins[(y - MIN_Y) / 10]++
    }
    const max = Math.max(...bins)
    return { bins, max }
  }, [tracks])

  // ---- map init
  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: basemap(dark), center: [-40, 45], zoom: 2.4, attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false })
    m.touchZoomRotate.disableRotation()
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    map.current = m
    m.on('load', () => { addLayers(m, dark); setReady(true) })
    return () => { m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // theme switch
  useEffect(() => {
    const m = map.current; if (!m || !ready) return
    m.setStyle(basemap(dark))
    m.once('style.load', () => { addLayers(m, dark); setStyleVer(v => v + 1) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark])
  useEffect(() => { map.current?.resize() }, [rightInset])

  function addLayers(m: MLMap, dk: boolean) {
    if (m.getSource('people')) return
    m.addSource('people', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    m.addLayer({
      id: 'heat', type: 'heatmap', source: 'people', maxzoom: 11,
      paint: {
        'heatmap-weight': ['get', 'w'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 1, 0.7, 5, 1.4, 9, 2.4],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 22, 7, 30, 10, 40],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.9, 10, 0.35],
        'heatmap-color': dk
          ? ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.08, 'rgba(56,90,150,0.45)', 0.25, 'rgba(70,150,170,0.7)', 0.5, 'rgba(217,179,108,0.85)', 0.8, 'rgba(244,140,90,0.92)', 1, 'rgba(255,240,215,1)']
          : ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,255,255,0)', 0.08, 'rgba(90,120,190,0.35)', 0.25, 'rgba(40,140,150,0.6)', 0.5, 'rgba(210,150,40,0.8)', 0.8, 'rgba(200,80,40,0.9)', 1, 'rgba(120,20,20,1)'],
      },
    })
    m.addLayer({
      id: 'pts', type: 'circle', source: 'people', minzoom: 4.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 9, 5, 13, 8],
        'circle-color': ['match', ['get', 's'], 'paternal', dk ? '#7fb2ff' : '#2f6fd6', 'maternal', dk ? '#ff9db0' : '#d0476a', dk ? '#e8d5ac' : '#8a6a2a'],
        'circle-stroke-width': 1, 'circle-stroke-color': dk ? 'rgba(13,16,22,0.8)' : 'rgba(255,255,255,0.9)',
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0, 6, 0.9],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0, 6, 0.9],
      },
    })
    m.addSource('trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, lineMetrics: true })
    m.addLayer({ id: 'trail', type: 'line', source: 'trail', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 3, 'line-opacity': 0.9, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, dk ? '#e9c27a' : '#a8741f', 1, dk ? '#7fb2ff' : '#2f6fd6'], 'line-dasharray': [1, 0] } })
    m.on('mouseenter', 'pts', () => { m.getCanvas().style.cursor = 'pointer' })
    m.on('mouseleave', 'pts', () => { m.getCanvas().style.cursor = ''; popup.current?.remove() })
    m.on('mousemove', 'pts', ev => {
      const f = ev.features?.[0]; if (!f) return
      const i = Number(f.properties!.i)
      popup.current?.remove()
      popup.current = new maplibregl.Popup({ closeButton: false, offset: 10, className: 'map-pop' })
        .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
        .setHTML(`<b>${escapeHtml(displayName(i))}</b><span>${escapeHtml([years(i), relationLabel(i)].filter(Boolean).join(' · '))}</span>`)
        .addTo(m)
    })
    m.on('click', 'pts', ev => { const f = ev.features?.[0]; if (f) onSelectRef.current(Number(f.properties!.i)) })
  }

  // ---- update heat for the year
  useEffect(() => {
    const m = map.current
    if (!m || !ready || !tracks) return
    const c = C()
    const feats: GeoJSON.Feature[] = []
    let am = 0, eu = 0
    const ws: number[] = []
    for (const t of tracks) {
      if (year < t.b || year > t.d) continue
      const i = t.i
      if (!doubt && (c.flags[i] & FL.doubtful || c.tier[i] === 3)) continue
      const s = sideOf(i)
      if (sideF !== 'all' && s !== sideF) continue
      let k = 0
      for (let j = 0; j < t.ys.length; j++) { if (t.ys[j] <= year) k = j; else break }
      const lon = t.xs[k], lat = t.zs[k]
      const g = Math.max(1, c.gen[i])
      const w = weight === 'equal' ? (t.q[k] === 0 ? 0.35 : 1) : Math.pow(2, -g)
      ws.push(w)
      if (lon < -25) am++; else eu++
      feats.push({ type: 'Feature', properties: { i, s, w }, geometry: { type: 'Point', coordinates: [lon, lat] } })
    }
    if (weight === 'genetic' && feats.length) {
      const mx = Math.max(...ws)
      for (const f of feats) f.properties!.w = Math.max(0.02, Math.pow((f.properties!.w as number) / mx, 0.35))
    }
    ;(m.getSource('people') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats })
    setCount({ n: feats.length, am, eu })
  }, [year, tracks, ready, sideF, doubt, weight, styleVer])

  // ---- selected person: ancestral trail of birthplaces from you to them
  useEffect(() => {
    const m = map.current
    markers.current.forEach(mk => mk.remove()); markers.current = []
    if (!m || !ready || !tracks) return
    const src = m.getSource('trail') as GeoJSONSource | undefined
    if (selected < 0) { src?.setData({ type: 'FeatureCollection', features: [] }); return }
    const byI = new Map(tracks.map(t => [t.i, t]))
    const path = (ahnPath(selected) ?? [selected]).slice().reverse() // oldest first
    const coords: [number, number][] = []
    const pts: { i: number; ll: [number, number] }[] = []
    for (const i of path) {
      const t = byI.get(i); if (!t) continue
      const ll: [number, number] = [t.xs[0], t.zs[0]]
      const last = coords[coords.length - 1]
      if (!last || Math.abs(last[0] - ll[0]) > 0.01 || Math.abs(last[1] - ll[1]) > 0.01) coords.push(ll)
      pts.push({ i, ll })
    }
    src?.setData({ type: 'FeatureCollection', features: coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] : [] })
    const seen = new Set<string>()
    for (const p of pts) {
      const key = p.ll.join(',')
      const isSel = p.i === selected
      if (seen.has(key) && !isSel) continue
      seen.add(key)
      const d = document.createElement('div')
      d.className = 'map-marker' + (isSel ? ' sel' : '')
      const pu = portraitUrl(p.i)
      d.innerHTML = pu ? `<img src="${pu}" alt="">` : `<span>${escapeHtml(displayName(p.i).split(' ').map(w => w[0]).slice(0, 2).join(''))}</span>`
      d.title = `${displayName(p.i)} ${years(p.i)}`
      d.onclick = () => onSelectRef.current(p.i)
      markers.current.push(new maplibregl.Marker({ element: d }).setLngLat(p.ll).addTo(m))
    }
    // also mark the selected person's own life events
    const t = byI.get(selected)
    if (t) {
      for (let j = 0; j < t.ys.length; j++) {
        const d = document.createElement('div'); d.className = 'map-dot'; d.title = String(Math.round(t.ys[j]))
        markers.current.push(new maplibregl.Marker({ element: d }).setLngLat([t.xs[j], t.zs[j]]).addTo(m))
      }
    }
    const all = [...coords, ...(t ? Array.from(t.xs, (x, j) => [x, t.zs[j]] as [number, number]) : [])]
    if (all.length) {
      const b = all.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(all[0], all[0]))
      m.fitBounds(b, { padding: { top: 120, bottom: 200, left: 80, right: 80 + rightInset }, maxZoom: 7, duration: 1200 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, ready, tracks, styleVer])

  // ---- playback
  useEffect(() => {
    if (!playing) return
    let y = year, raf = 0, last = performance.now()
    const step = (t: number) => {
      const dt = t - last; last = t
      y += dt * 0.012 * (y < 1500 ? 2.5 : 1)
      if (y >= MAX_Y) { y = MAX_Y; setYear(MAX_Y); setPlaying(false); return }
      setYear(Math.round(y))
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  return (
    <div className="mapview" style={{ ['--right' as any]: rightInset + 'px' }}>
      <div ref={el} className="map-canvas" />
      <div className="map-filters glass">
        <div className="seg small">{(['all', 'paternal', 'maternal'] as const).map(s => <button key={s} className={sideF === s ? 'on' : ''} onClick={() => setSideF(s)}>{s === 'all' ? 'Both sides' : s[0].toUpperCase() + s.slice(1)}</button>)}</div>
        <div className="seg small">{(['equal', 'genetic'] as const).map(s => <button key={s} className={weight === s ? 'on' : ''} onClick={() => setWeight(s)} title={s === 'genetic' ? 'Weight each ancestor by their expected share of your DNA (closer generations count more)' : 'Every ancestor counts equally'}>{s === 'equal' ? 'Every ancestor' : 'By DNA share'}</button>)}</div>
        <label className="switch"><input type="checkbox" checked={doubt} onChange={e => setDoubt(e.target.checked)} /><span />Doubtful &amp; legendary</label>
      </div>
      <div className="timebar glass" style={{ right: rightInset + 16 }}>
        <div className="tb-top">
          <button className="play" onClick={() => { if (year >= MAX_Y) setYear(1500); setPlaying(!playing) }} title={playing ? 'Pause' : 'Play through time'}><Icon name={playing ? 'pause' : 'play'} size={18} fill /></button>
          <div className="tb-year">{year}</div>
          <div className="tb-stats">
            <b>{count.n.toLocaleString()}</b> ancestors located alive
            {count.n > 0 && <span className="muted"> · {Math.round((100 * count.am) / count.n)}% Americas · {Math.round((100 * count.eu) / count.n)}% Europe &amp; elsewhere</span>}
          </div>
        </div>
        <div className="tb-track">
          {hist && (
            <svg className="hist" viewBox={`0 0 ${hist.bins.length} 100`} preserveAspectRatio="none" aria-hidden="true">
              <path d={'M0,100 ' + hist.bins.map((v, k) => `L${k},${100 - (v / hist.max) * 96}`).join(' ') + ` L${hist.bins.length - 1},100 Z`} />
            </svg>)}
          <input type="range" min={MIN_Y} max={MAX_Y} value={year} onChange={e => { setPlaying(false); setYear(Number(e.target.value)) }} aria-label="Year" />
          <div className="tb-ticks">{[1000, 1200, 1400, 1600, 1700, 1800, 1900, 2000].map(y => <span key={y} style={{ left: `${((y - MIN_Y) / (MAX_Y - MIN_Y)) * 100}%` }} onClick={() => setYear(y)}>{y}</span>)}</div>
        </div>
      </div>
      {!tracks && <div className="map-loading"><div className="spinner" /></div>}
    </div>
  )
}

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!)) }
