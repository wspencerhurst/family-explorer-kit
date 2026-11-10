import { FAMILY } from './family'
import { useCallback, useEffect, useState } from 'react'
import { C, loadCore } from './store'
import { FanView, type NavRequest } from './fan/FanView'
import { PersonPanel } from './panel/PersonPanel'
import { MapView } from './map/MapView'
import { Discover } from './discover/Discover'
import { Overview } from './overview/Overview'
import { Search } from './components/Search'
import { Icon } from './components/Icon'
import type { ColorMode } from './colors'

type Route = 'overview' | 'tree' | 'map' | 'discover'
const ROUTES: [Route, string, string][] = [['overview', 'Overview', 'chart'], ['tree', 'Tree', 'fan'], ['map', 'Map', 'map'], ['discover', 'Discover', 'star']]

function readHash(): { route: Route; person?: string } {
  const h = location.hash.replace(/^#\/?/, '')
  const [r, qs] = h.split('?')
  const route = (['overview', 'tree', 'map', 'discover'].includes(r) ? r : 'overview') as Route
  const person = new URLSearchParams(qs ?? '').get('p') ?? undefined
  return { route, person }
}
const stored = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) } catch { return d } }
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export function App() {
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { loadCore(setProgress).then(() => setReady(true)).catch(e => setErr(String(e))) }, [])
  if (err) return <div className="boot"><div className="boot-inner"><h1>Couldn’t load the family data</h1><p className="muted">{err}</p><p className="muted small">Open the site with the “Open Family Explorer” launcher so the data files can be served.</p></div></div>
  if (!ready) return (
    <div className="boot"><div className="boot-inner">
      <svg className="boot-logo" viewBox="0 0 64 64"><g fill="none" strokeWidth="4"><path d="M8 52 A24 24 0 0 1 56 52" /><path d="M18 52 A14 14 0 0 1 46 52" /></g><circle cx="32" cy="52" r="5" /></svg>
      <div className="boot-title">{FAMILY.siteTitle}</div>
      <div className="boot-bar"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="muted small">Loading 130,000 people…</div>
    </div></div>)
  return <Shell />
}

function Shell() {
  const c = C()
  const init = readHash()
  const [route, setRoute] = useState<Route>(init.route)
  const [focus, setFocus] = useState(c.root)
  const [selected, setSelectedRaw] = useState<number>(() => { const k = init.person ? c.ids.indexOf(init.person) : -1; return k })
  const [request, setRequest] = useState<NavRequest | null>(() => (init.route === 'tree' && selected >= 0 ? { i: selected, nonce: 1 } : null))
  const [mode, setMode] = useState<ColorMode>(() => stored('mode', 'lines'))
  const [hideDoubtful, setHideDoubtful] = useState<boolean>(() => stored('hideDoubtful', false))
  const [hideDisproven, setHideDisproven] = useState<boolean>(() => stored('hideDisproven', true))
  const [showPhotos, setShowPhotos] = useState<boolean>(() => stored('photos', true))
  const [weighted, setWeighted] = useState<boolean>(() => stored('weighted', true))
  const [theme, setTheme] = useState<'dark' | 'light'>(() => stored('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  const [year, setYear] = useState(1750)
  const [mobile, setMobile] = useState(() => innerWidth < 760)
  const dark = theme === 'dark'

  useEffect(() => { document.documentElement.dataset.theme = theme; store('theme', theme) }, [theme])
  useEffect(() => store('mode', mode), [mode])
  useEffect(() => store('hideDoubtful', hideDoubtful), [hideDoubtful])
  useEffect(() => store('hideDisproven', hideDisproven), [hideDisproven])
  useEffect(() => store('photos', showPhotos), [showPhotos])
  useEffect(() => store('weighted', weighted), [weighted])
  useEffect(() => { const f = () => setMobile(innerWidth < 760); addEventListener('resize', f); return () => removeEventListener('resize', f) }, [])

  const setSelected = useCallback((i: number) => setSelectedRaw(i), [])
  // hash sync
  useEffect(() => {
    const p = selected >= 0 ? `?p=${encodeURIComponent(c.ids[selected])}` : ''
    const h = `#/${route}${p}`
    if (location.hash !== h) history.replaceState(null, '', h)
  }, [route, selected, c.ids])
  useEffect(() => {
    const f = () => { const h = readHash(); setRoute(h.route) }
    addEventListener('hashchange', f); return () => removeEventListener('hashchange', f)
  }, [])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input')) setSelectedRaw(-1) }
    addEventListener('keydown', k); return () => removeEventListener('keydown', k)
  }, [])

  const goPerson = useCallback((i: number, path?: number[]) => {
    setRoute('tree')
    setRequest(r => ({ i, nonce: (r?.nonce ?? 0) + 1, path }))
  }, [])
  const showPanel = selected >= 0 && (route === 'tree' || route === 'map')
  const panelW = showPanel && !mobile ? Math.min(440, Math.max(360, innerWidth * 0.3)) : 0
  const bottomInset = showPanel && mobile ? Math.round(innerHeight * 0.5) : 0

  return (
    <div className={'app route-' + route + (showPanel ? ' with-panel' : '')}>
      <header className="topbar">
        <button className="brand" onClick={() => setRoute('overview')} title="Overview">
          <svg viewBox="0 0 64 64" width="26" height="26"><g fill="none" strokeWidth="5"><path d="M8 52 A24 24 0 0 1 56 52" /><path d="M18 52 A14 14 0 0 1 46 52" /></g><circle cx="32" cy="52" r="5" /></svg>
          <span>{FAMILY.familyName} <em>Family</em></span>
        </button>
        <nav className="nav" aria-label="Sections">
          {ROUTES.map(([r, l, ic]) => <button key={r} className={route === r ? 'on' : ''} onClick={() => setRoute(r)} aria-current={route === r ? 'page' : undefined}><Icon name={ic} size={17} /><span>{l}</span></button>)}
        </nav>
        <Search onPick={i => { setSelectedRaw(i); if (route === 'map') return; goPerson(i) }} />
        <button className="icon-btn theme-btn" onClick={() => setTheme(dark ? 'light' : 'dark')} title={dark ? 'Light theme' : 'Dark theme'}><Icon name={dark ? 'sun' : 'moon'} /></button>
      </header>

      <main className="main">
        <div className="view" hidden={route !== 'tree'}>
          <FanView
            focus={focus} setFocus={setFocus} selected={selected} setSelected={setSelected} request={request}
            mode={mode} setMode={setMode} hideDoubtful={hideDoubtful} setHideDoubtful={setHideDoubtful} hideDisproven={hideDisproven} setHideDisproven={setHideDisproven}
            showPhotos={showPhotos} setShowPhotos={setShowPhotos} weighted={weighted} setWeighted={setWeighted} dark={dark} rightInset={panelW} bottomInset={bottomInset}
          />
        </div>
        {route === 'map' && <div className="view"><MapView dark={dark} selected={selected} onSelect={setSelected} year={year} setYear={setYear} rightInset={panelW} /></div>}
        {route === 'discover' && <div className="view scroll"><Discover onGo={goPerson} /></div>}
        {route === 'overview' && <div className="view scroll"><Overview dark={dark} go={(r, i) => { if (i !== undefined) goPerson(i); else setRoute(r as Route) }} /></div>}
        {showPanel && (
          <PersonPanel
            i={selected}
            onClose={() => setSelectedRaw(-1)}
            onGo={goPerson}
            onFocus={i => { setRoute('tree'); setFocus(i); setSelectedRaw(i) }}
            onMap={i => { setRoute('map'); setSelectedRaw(i); const b = C().birth[i]; if (b) setYear(Math.min(2025, b + 20)) }}
          />)}
      </main>
    </div>
  )
}
