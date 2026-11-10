import { FAMILY } from '../family'
import { useEffect, useMemo, useRef, useState } from 'react'
import { C, FL, search, displayName, years, relationLabel, portraitUrl, placeName } from '../store'
import { Icon } from './Icon'

export function Search({ onPick }: { onPick: (i: number) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const [deb, setDeb] = useState('')
  useEffect(() => { const t = setTimeout(() => setDeb(q), 60); return () => clearTimeout(t) }, [q])
  const hits = useMemo(() => (deb.trim().length >= 2 ? search(deb, 40) : []), [deb])
  useEffect(() => setAt(0), [deb])

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !t.closest('input,textarea'))) { e.preventDefault(); input.current?.focus(); input.current?.select(); setOpen(true) }
    }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  const pick = (i: number) => { onPick(i); setOpen(false); setQ(''); input.current?.blur() }
  const c = C()
  return (
    <div className={'search' + (open && hits.length ? ' open' : '')}>
      <Icon name="search" size={16} />
      <input
        ref={input} value={q} placeholder={`Search people…  (try “${FAMILY.searchHint}”)`} aria-label="Search people"
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(hits.length - 1, at + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(0, at - 1)) }
          else if (e.key === 'Enter' && hits[at]) pick(hits[at].i)
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
        }}
      />
      <kbd className="kbd">/</kbd>
      {open && hits.length > 0 && (
        <ul className="results" role="listbox">
          {hits.map((h, k) => {
            const i = h.i, pu = portraitUrl(i), bp = placeName(c.bplace[i])
            return (
              <li key={i} role="option" aria-selected={k === at} className={k === at ? 'on' : ''} onMouseDown={e => { e.preventDefault(); pick(i) }} onMouseEnter={() => setAt(k)}>
                <span className="r-img">{pu ? <img src={pu} alt="" /> : null}</span>
                <span className="r-main">
                  <b>{displayName(i)}</b>
                  <span>{[years(i), relationLabel(i)].filter(Boolean).join(' · ')}{bp ? ` · ${bp}` : ''}</span>
                </span>
                {c.flags[i] & FL.notable ? <span className="r-star" title="Notable"><Icon name="star" size={13} fill /></span> : null}
                {c.flags[i] & FL.doubtful ? <span className="r-tag">doubtful</span> : c.tier[i] === 3 ? <span className="r-tag">legendary</span> : c.conf[i] <= 1 ? <span className="r-tag ok">documented</span> : null}
              </li>)
          })}
        </ul>)}
    </div>
  )
}
