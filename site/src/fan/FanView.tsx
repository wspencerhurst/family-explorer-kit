import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FanEngine, R1, type Hit } from './engine'
import { C, FL, ahnPath, ancestorPath, relationLabel, years, displayName, placeName, portraitUrl, getRouteCounts, fmtCount } from '../store'
import { COUNTRIES, countryColor, CONF_COLORS, centuryLegend, oklch, type ColorMode } from '../colors'
import { Icon } from '../components/Icon'

export interface NavRequest { i: number; nonce: number; zoom?: 'wedge' | 'context'; path?: number[] }

interface Props {
  focus: number
  setFocus: (i: number) => void
  selected: number
  setSelected: (i: number) => void
  request: NavRequest | null
  mode: ColorMode
  setMode: (m: ColorMode) => void
  hideDoubtful: boolean
  hideDisproven: boolean
  setHideDisproven: (v: boolean) => void
  setHideDoubtful: (v: boolean) => void
  showPhotos: boolean
  setShowPhotos: (v: boolean) => void
  weighted: boolean
  setWeighted: (v: boolean) => void
  dark: boolean
  rightInset: number
  bottomInset: number
}

export function FanView(p: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const glCanvas = useRef<HTMLCanvasElement>(null)
  const eng = useRef<FanEngine | null>(null)
  const [tip, setTipState] = useState<{ x: number; y: number; hit: Hit } | null>(null)
  const tipRef = useRef<typeof tip>(null)
  const setTip = (t: typeof tip) => { if (t === null && tipRef.current === null) return; tipRef.current = t; setTipState(t) }
  const [zoomPct, setZoomPct] = useState(1)
  const [explore, setExplore] = useState<Hit | null>(null)
  const [hint, setHint] = useState(() => { try { return !localStorage.getItem('fanHintSeen') } catch { return true } })
  const dismissHint = () => { setHint(false); try { localStorage.setItem('fanHintSeen', '1') } catch { /* ignore */ } }
  const propsRef = useRef(p); propsRef.current = p

  // ---- engine lifecycle
  useLayoutEffect(() => {
    const e = new FanEngine(canvas.current!, glCanvas.current)
    eng.current = e
    ;(window as any).__fan = e
    e.focus = p.focus
    const ro = new ResizeObserver(() => {
      const r = wrap.current!.getBoundingClientRect()
      const first = e.w === 0
      e.resize(r.width, r.height)
      if (first) e.setView(e.homeView())
    })
    ro.observe(wrap.current!)
    let last = 0
    e.onChange = () => {
      const t = performance.now()
      if (t - last < 120) return
      last = t; setZoomPct(e.view.k)
      // when zoomed deep into a branch, offer to re-center on the ancestor at the middle of the view
      const ins = e.insets
      const cx = ins.left + (e.w - ins.left - ins.right) / 2, cy = ins.top + (e.h - ins.top - ins.bottom) / 2
      const h = e.view.k > e.homeView().k * 2.6 ? e.hitTest(cx, cy) : null
      setExplore(prev => (h && h.i >= 0 && h.g >= 3 ? (prev && prev.i === h.i && prev.g === h.g ? prev : h) : null))
    }
    return () => { ro.disconnect(); e.destroy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { const e = eng.current!; e.mode = p.mode; e.dark = p.dark; e.hideDoubtful = p.hideDoubtful; e.hideDisproven = p.hideDisproven; e.showPhotos = p.showPhotos; e.request() }, [p.mode, p.dark, p.hideDoubtful, p.hideDisproven, p.showPhotos])
  useEffect(() => { const e = eng.current!; if (e.weighted !== p.weighted) { e.weighted = p.weighted; updateSelection(); e.request() } }, [p.weighted])
  useEffect(() => {
    const e = eng.current!
    const old = e.insets
    e.insets = { left: 0, right: p.rightInset, top: 64, bottom: p.bottomInset }
    // keep the picture centered in the visible area when the panel opens/closes
    const dx = (old.right - p.rightInset) / 2, dy = (old.bottom - p.bottomInset) / 2
    if (e.w && (dx || dy)) e.flyTo({ ...e.view, x: e.view.x + dx, y: e.view.y + dy }, 300)
    e.request()
  }, [p.rightInset, p.bottomInset])

  // focus changes coming from outside (breadcrumb, panel)
  useEffect(() => {
    const e = eng.current!
    if (e.focus !== p.focus) { e.focus = p.focus; e.setView({ ...e.homeView(), k: e.homeView().k * 0.6 }); e.flyTo(e.homeView(), 550) }
    updateSelection()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus])

  function updateSelection() {
    const e = eng.current!
    const sel = propsRef.current.selected
    if (sel < 0) { e.setSelected(-1, null); return }
    const path = ancestorPath(e.focus, sel, 90)
    e.setSelected(sel, path)
  }
  useEffect(updateSelection, [p.selected])

  // ---- navigation requests (search, notables, panel links)
  useEffect(() => {
    if (!p.request) return
    const e = eng.current!
    const c = C()
    const i = p.request.i
    const given = p.request.path && p.request.path[p.request.path.length - 1] === i ? p.request.path : null
    // make sure the lines on this route are shown (a disproven or unproven link would otherwise hide it)
    const route = given ?? ahnPath(i)
    if (route) {
      if (route.some(x => c.flags[x] & FL.disproven) && p.hideDisproven) { p.setHideDisproven(false); e.hideDisproven = false }
      if (route.some(x => (c.flags[x] & FL.doubtful) || c.tier[x] === 3) && p.hideDoubtful) { p.setHideDoubtful(false); e.hideDoubtful = false }
    }
    // 1) already comfortably visible from the current center: just fly there
    let near = ancestorPath(e.focus, i, 5)
    if (given) { const k0 = given.indexOf(e.focus); near = k0 >= 0 && given.length - 1 - k0 <= 5 ? given.slice(k0) : null }
    if (near) {
      const s = e.slotOfPath(near)!
      p.setSelected(i); e.setSelected(i, near)
      if (s.g <= 3) e.flyTo(e.homeView(), 700)
      else { const w = s.a1 - s.a0, d = s.rOut - s.rIn; e.flyTo(e.fitWedge(Math.max(0, s.rIn - d * 2), s.rOut + d * 1.5, s.a0 - w * 1.2, s.a1 + w * 1.2, 0.08), 800) }
      return
    }
    // 2) re-center three generations below the target so it is large and its own ancestry fans out beyond it
    const rp = given ?? ahnPath(i)
    let nf: number, path: number[]
    if (rp) {
      const d = rp.length - 1
      nf = d <= 4 ? rp[0] : rp[d - 3]
      path = rp.slice(rp.indexOf(nf))
    } else { nf = i; path = [i] } // alternate lineage: center on them
    e.focus = nf; p.setFocus(nf)
    p.setSelected(i); e.setSelected(i, path)
    const home = e.homeView()
    e.setView({ ...home, k: home.k * 0.55 })
    e.flyTo(home, 750)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.request?.nonce])

  // ---- pointer interaction
  useEffect(() => {
    const el = canvas.current!
    const e = eng.current!
    const pts = new Map<number, { x: number; y: number }>()
    let down: { x: number; y: number; t: number; moved: number } | null = null
    let lastMove = { x: 0, y: 0, t: 0 }
    let vel = { x: 0, y: 0 }
    let pinch: { d: number; mx: number; my: number } | null = null
    let lastClick: { t: number; i: number; g: number; a0: number } | null = null
    let hoverRaf = 0

    const rel = (ev: PointerEvent | WheelEvent | MouseEvent) => { const r = el.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top } }

    const onDown = (ev: PointerEvent) => {
      el.setPointerCapture(ev.pointerId)
      const q = rel(ev); pts.set(ev.pointerId, q)
      e.stopMotion()
      if (pts.size === 1) { down = { ...q, t: performance.now(), moved: 0 }; lastMove = { ...q, t: performance.now() }; vel = { x: 0, y: 0 } }
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
        down = null
      }
    }
    const onMove = (ev: PointerEvent) => {
      const q = rel(ev)
      if (pts.has(ev.pointerId)) {
        const prev = pts.get(ev.pointerId)!
        pts.set(ev.pointerId, q)
        if (pts.size === 2 && pinch) {
          const [a, b] = [...pts.values()]
          const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
          e.panBy(mx - pinch.mx, my - pinch.my)
          e.zoomAt(mx, my, d / pinch.d, false)
          pinch = { d, mx, my }
          return
        }
        if (down) {
          const dx = q.x - prev.x, dy = q.y - prev.y
          down.moved += Math.abs(dx) + Math.abs(dy)
          if (down.moved > 3) {
            e.panBy(dx, dy); setTip(null)
            const t = performance.now(), dt = Math.max(1, t - lastMove.t)
            vel = { x: 0.8 * vel.x + 0.2 * (dx / dt) * 16, y: 0.8 * vel.y + 0.2 * (dy / dt) * 16 }
            lastMove = { ...q, t }
            el.style.cursor = 'grabbing'
          }
        }
        return
      }
      // hover
      cancelAnimationFrame(hoverRaf)
      hoverRaf = requestAnimationFrame(() => {
        const h = e.hitTest(q.x, q.y)
        const same = h && e.hover && h.i === e.hover.i && h.g === e.hover.g && h.a0 === e.hover.a0
        if (!same) { e.hover = h; e.request() }
        el.style.cursor = h ? 'pointer' : 'grab'
        setTip(h ? { x: q.x, y: q.y, hit: h } : null)
      })
    }
    const onUp = (ev: PointerEvent) => {
      const q = rel(ev)
      pts.delete(ev.pointerId)
      if (pts.size < 2) pinch = null
      el.style.cursor = 'grab'
      if (!down) return
      const d = down; down = null
      const dt = performance.now() - d.t
      if (d.moved <= 5 && dt < 450) {
        const h = e.hitTest(q.x, q.y)
        const now = performance.now()
        if (h && lastClick && now - lastClick.t < 320 && lastClick.i === h.i && lastClick.g === h.g) {
          lastClick = null
          if (h.i >= 0 && h.g > 0) refocus(h)
          return
        }
        lastClick = h ? { t: now, i: h.i, g: h.g, a0: h.a0 } : null
        if (h && h.i >= 0) propsRef.current.setSelected(h.i)
        else if (!h) propsRef.current.setSelected(-1)
      } else if (performance.now() - lastMove.t < 80) {
        e.fling(vel.x, vel.y)
      }
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const q = rel(ev)
      const isPinch = ev.ctrlKey
      const dy = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY
      if (!isPinch && Math.abs(ev.deltaX) > Math.abs(dy) * 0.6 && ev.deltaMode === 0 && Math.abs(dy) < 40) { e.panBy(-ev.deltaX, -ev.deltaY); return }
      const f = Math.exp(-dy * (isPinch ? 0.012 : 0.0022))
      e.zoomAt(q.x, q.y, f, !isPinch)
      setTip(null)
    }
    const onLeave = () => { e.hover = null; e.request(); setTip(null) }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel); el.removeEventListener('pointerleave', onLeave)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keyboard
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return
      const e = eng.current!
      if (ev.key === '+' || ev.key === '=') e.zoomAt(e.w / 2, e.h / 2, 1.5)
      else if (ev.key === '-' || ev.key === '_') e.zoomAt(e.w / 2, e.h / 2, 1 / 1.5)
      else if (ev.key === '0') e.flyTo(e.homeView(), 500)
      else if (ev.key === 'Backspace' || ev.key === 'h') stepDown()
      else return
      ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function refocus(h: Hit) {
    const e = eng.current!
    const target = e.fitWedge(h.rIn, h.rOut, h.a0, h.a1, 0.1)
    e.flyTo(target, 380, () => {
      // the wedge now fills the view; swap in the new focus with its center disc at the same spot
      const v = e.view
      const mid = (h.a0 + h.a1) / 2, rm = (h.rIn + h.rOut) / 2
      const sx = v.x + Math.cos(mid) * rm * v.k, sy = v.y + Math.sin(mid) * rm * v.k
      const sizePx = Math.min((h.rOut - h.rIn) * v.k, (h.a1 - h.a0) * rm * v.k)
      e.focus = h.i
      propsRef.current.setFocus(h.i)
      propsRef.current.setSelected(h.i)
      e.setView({ x: sx, y: sy, k: sizePx / (2 * R1) })
      e.flyTo(e.homeView(), 700)
    })
  }

  // breadcrumb: path from root to focus
  const crumbs = useMemo(() => {
    const c = C()
    const path = ahnPath(p.focus) ?? (p.focus === c.root ? [c.root] : [c.root, p.focus])
    return path
  }, [p.focus])
  function stepDown() {
    if (crumbs.length < 2) return
    propsRef.current.setFocus(crumbs[crumbs.length - 2])
  }

  const e = eng.current
  const showCrumbs = crumbs.length > 1
  const shown = crumbs.length <= 6 ? crumbs : [crumbs[0], -1, ...crumbs.slice(-4)]

  return (
    <div className="fan" ref={wrap}>
      <canvas ref={glCanvas} className="fan-gl" aria-hidden="true" />
      <canvas ref={canvas} className="fan-canvas" aria-label="Fan chart of ancestors" />

      {showCrumbs && (
        <nav className="crumbs glass" aria-label="Path from you">
          {shown.map((i, k) => i === -1
            ? <span key={'gap' + k} className="crumb-gap">…</span>
            : <button key={i + ':' + k} className={'crumb' + (i === p.focus ? ' on' : '')} onClick={() => p.setFocus(i)} title={relationLabel(i)}>
                {k === 0 ? 'You' : crumbName(i)}
              </button>)}
          <button className="crumb-down icon-btn" title="Back toward you (Backspace)" onClick={stepDown}><Icon name="down" /></button>
        </nav>
      )}

      {tip && <Tooltip tip={tip} />}
      {hint && (
        <div className="fan-hint glass" role="note">
          <span><b>Scroll</b> or pinch to zoom</span><span><b>Drag</b> to pan</span><span><b>Click</b> anyone for their story</span><span><b>Double-click</b> to center their ancestors</span>
          <button className="icon-btn" onClick={dismissHint} title="Got it"><Icon name="close" size={15} /></button>
        </div>)}

      <div className="fan-controls" style={{ right: p.rightInset + 16, bottom: p.bottomInset + 16 }}>
        <button className="icon-btn glass" title="Zoom in (+)" onClick={() => e?.zoomAt(e.w / 2, e.h / 2, 1.6)}><Icon name="plus" /></button>
        <button className="icon-btn glass" title="Zoom out (−)" onClick={() => e?.zoomAt(e.w / 2, e.h / 2, 1 / 1.6)}><Icon name="minus" /></button>
        <button className="icon-btn glass" title="Fit (0)" onClick={() => e?.flyTo(e.homeView(), 550)}><Icon name="fit" /></button>
        {p.focus !== C().root && <button className="icon-btn glass accent" title="Back to you" onClick={() => { p.setFocus(C().root) }}><Icon name="home" /></button>}
      </div>

      <div className="fan-legend glass" style={{ bottom: p.bottomInset + 16 }}>
        <div className="seg" role="tablist" aria-label="Color by">
          {(['lines', 'origin', 'century', 'confidence', 'collapse'] as ColorMode[]).map(m => (
            <button key={m} role="tab" aria-selected={p.mode === m} className={p.mode === m ? 'on' : ''} onClick={() => p.setMode(m)}>
              {{ lines: 'Lines', origin: 'Birthplace', century: 'Era', confidence: 'Evidence', collapse: 'Collapse' }[m]}
            </button>))}
        </div>
        <Legend mode={p.mode} dark={p.dark} />
        <div className="legend-toggles">
          <label className="switch"><input type="checkbox" checked={p.showPhotos} onChange={ev => p.setShowPhotos(ev.target.checked)} /><span />Photos</label>
          <label className="switch" title="Give wider slices to ancestors with more known ancestry behind them, so long lines stay visible; off = classic equal halves"><input type="checkbox" checked={p.weighted} onChange={ev => p.setWeighted(ev.target.checked)} /><span />Size by ancestry</label>
          <label className="switch" title="Ancestors whose link has no supporting evidence yet, and ancient/legendary lines. Shown faded."><input type="checkbox" checked={!p.hideDoubtful} onChange={ev => p.setHideDoubtful(!ev.target.checked)} /><span />Unproven &amp; legendary</label>
          <label className="switch" title="Lines that hang from a parent link research showed to be wrong (rejected or fabricated). Hidden unless you turn this on."><input type="checkbox" checked={!p.hideDisproven} onChange={ev => p.setHideDisproven(!ev.target.checked)} /><span />Disproven links</label>
        </div>
      </div>
      {explore && (
        <button className="explore-pill glass" style={{ bottom: p.bottomInset + 24 }} onClick={() => { const h = explore; setExplore(null); refocus(h) }} title="Make this ancestor the center so you can keep exploring further back (or double-click any wedge)">
          {portraitUrl(explore.i) ? <img src={portraitUrl(explore.i)!} alt="" /> : <Icon name="fan" size={16} />}
          <span>Explore further from <b>{displayName(explore.i)}</b></span>
          <Icon name="chev" size={16} />
        </button>)}
      <div className="zoom-readout">{zoomPct > 0 ? `${Math.round(zoomPct * 100)}%` : ''}</div>
    </div>
  )
}

function Tooltip({ tip }: { tip: { x: number; y: number; hit: Hit } }) {
  const c = C()
  const h = tip.hit
  const style = { left: tip.x + 16, top: tip.y + 16 }
  if (h.i < 0) {
    return <div className="tip" style={style}><div className="tip-name muted">Unknown {h.empty}</div><div className="tip-sub">Parent of {displayName(h.child!)} not yet identified</div></div>
  }
  const i = h.i
  const pu = portraitUrl(i)
  const bp = placeName(c.bplace[i])
  const doubt = c.flags[i] & FL.doubtful
  return (
    <div className="tip" style={style}>
      {pu && <img className="tip-img" src={pu} alt="" />}
      <div>
        <div className="tip-name">{displayName(i)}</div>
        <div className="tip-sub">{[years(i), relationLabel(i)].filter(Boolean).join(' · ')}</div>
        {bp && <div className="tip-place">{bp}</div>}
        {c.flags[i] & FL.disproven ? <div className="tip-flag">Disproven connection</div> : doubt ? <div className="tip-flag">Unproven connection</div> : c.tier[i] === 3 ? <div className="tip-flag">Legendary / unverified ancient line</div> : null}
        {getRouteCounts().all[i] > 1.5 && <div className="tip-note">Reached by {fmtCount(getRouteCounts().all[i])} routes</div>}
      </div>
    </div>
  )
}

function Legend({ mode, dark }: { mode: ColorMode; dark: boolean }) {
  if (mode === 'collapse') return (
    <div className="legend-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 3 }}>
      <span className="legend-note">How many different routes lead from you to each ancestor (pedigree collapse)</span>
      <div className="gradient" style={{ background: `linear-gradient(90deg, ${[0, 2, 4, 6, 8, 10, 12].map(s => oklch(dark ? 0.82 - s * 0.035 : 0.84 - s * 0.042, 0.07 + s * 0.008, 55 - s * 2.5)).join(',')})` }} />
      <div className="gradient-labels"><span>2</span><span>10</span><span>100</span><span>1,000</span><span>10k</span><span>100k</span><span>1M+</span></div>
    </div>)
  if (mode === 'lines') return (
    <div className="legend-row">
      <span className="legend-note">Each color follows one ancestral line outward.</span>
      <span className="sw hatch" /> <span className="legend-note">faded = doubtful or legendary</span>
    </div>
  )
  if (mode === 'confidence') {
    const items: [keyof typeof CONF_COLORS, string][] = [['verified', 'Confirmed'], ['probable', 'Probable'], ['tree', 'Tree only'], ['medieval', 'Medieval'], ['legendary', 'Legendary'], ['doubtful', 'Doubtful link'], ['conflict', 'Conflict']]
    return <div className="legend-row wrap">{items.map(([k, l]) => { const [L, ch, h] = CONF_COLORS[k]; return <span key={k} className="li"><span className="sw" style={{ background: oklch(dark ? L - 0.08 : L + 0.1, ch, h) }} />{l}</span> })}</div>
  }
  if (mode === 'origin') return <div className="legend-row wrap">{COUNTRIES.map(k => <span key={k} className="li"><span className="sw" style={{ background: countryColor(k, dark) }} />{k}</span>)}</div>
  const cl = centuryLegend()
  return (
    <div className="legend-row">
      <div className="gradient" style={{ background: `linear-gradient(90deg, ${cl.map(x => x.color).join(',')})` }} />
      <div className="gradient-labels">{cl.map(x => <span key={x.label}>{x.label}</span>)}</div>
    </div>
  )
}

function crumbName(i: number) {
  const parts = displayName(i).replace(/\(.*?\)|".*?"/g, '').replace(/(Rev|Col|Capt|Maj|Dr|Sir|Lt|Gen|Brig|Hon|Mrs|Mr|Lady)\.?\s+/g, '').split(/\s+/).filter(Boolean)
  if (parts.length <= 2) return parts.join(' ')
  let last = parts.length - 1
  while (last > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts[last])) last--
  return parts[0] + ' ' + parts[last]
}
