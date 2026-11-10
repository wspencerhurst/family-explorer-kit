import { useEffect, useState } from 'react'
import { C, FL, displayName, splitName, years } from '../store'
import { descendantWord, flaggedBetween, fullSiblings, kinship, loadCons, type ConsCouple, type RouteDiff, type Split } from '../routeDiff'

const poss = (x: number) => (x === C().root ? 'your' : C().sex[x] === 1 ? 'his' : C().sex[x] === 2 ? 'her' : 'their')
const nm = (x: number) => (x === C().root ? 'you' : displayName(x))
const withYears = (x: number) => { const y = years(x); return nm(x) + (y && x !== C().root ? ` (${y})` : '') }
const gens = (n: number) => `${n} generation${n === 1 ? '' : 's'}`

/** one-line header summary of how a route differs from its reference route */
export function routeSummary(d: RouteDiff): string {
  const s = d.splits
  if (!s.length) return `Same people as route ${d.refName}.`
  const part = (sp: Split) => {
    const how = sp.take ? `through ${poss(sp.d)} ${sp.take} instead of ${poss(sp.d)} ${sp.take === 'father' ? 'mother' : 'father'}` : 'by a different parent'
    return { how, back: withYears(sp.q) }
  }
  const f = part(s[0])
  let out = s[0].d === C().root
    ? `Differs from route ${d.refName} from the start: ${f.how}; rejoins route ${d.refName} at ${f.back}.`
    : `Same as route ${d.refName} until ${withYears(s[0].d)}; then ${f.how}; rejoins route ${d.refName} at ${f.back}.`
  if (s.length > 1) {
    const g = part(s[1])
    out += ` Splits again at ${withYears(s[1].d)} (${g.how}), rejoining at ${nm(s[1].q)}${s.length > 2 ? `, and ${s.length - 2} more ${s.length === 3 ? 'time' : 'times'}` : ''}.`
  }
  return out
}

function consFor(sp: Split, cons: Map<number, ConsCouple> | null): ConsCouple | null {
  const x = cons?.get(sp.d)
  return x && x.f === C().father[sp.d] && x.m === C().mother[sp.d] ? x : null
}

type Go = (i: number, path?: number[]) => void
function Name({ i, onGo, path }: { i: number; onGo: Go; path?: number[] }) {
  return <button className="link" onClick={() => onGo(i, path)}>{displayName(i)}</button>
}

/** the sentence explaining how the parents at a split were related */
export function SplitExplain({ sp, path, onGo, cons }: { sp: Split; path: number[]; onGo: Go; cons: Map<number, ConsCouple> | null }) {
  const c = C()
  const F = c.father[sp.d], M = c.mother[sp.d]
  if (sp.gF === null || sp.gM === null || F < 0 || M < 0) return null
  const cc = consFor(sp, cons)
  const kin = kinship(sp.gF, sp.gM, sp.gF === 1 && sp.gM === 1 ? fullSiblings(F, M, cc) : null)
  const suspect = cc ? cc.suspect : kin.close
  const q = sp.q
  // the other half of the ancestral couple, when the precomputed data know it
  const partner = cc && cc.n1 === sp.gF && cc.n2 === sp.gM ? cc.ca.find(x => x >= 0 && x !== q) : undefined
  // a closer link than the one these routes show?
  const closer = cc && cc.n1 + cc.n2 < sp.gF + sp.gM && !(cc.n1 === sp.gF && cc.n2 === sp.gM)
  const first = (x: number) => splitName(displayName(x))[0].split(' ')[0]
  const qPath = path.slice(0, sp.to + 1)
  return (
    <p className="split-why">
      <b>{sp.d === c.root ? 'Your' : <>{displayName(sp.d)}’s</>} parents, <Name i={F} onGo={onGo} /> and <Name i={M} onGo={onGo} />, were {kin.label}</b>
      {kin.kind === 'lineal' ? '.' : <>: both descend from <Name i={q} onGo={onGo} path={qPath} />{partner !== undefined && <> and <Name i={partner} onGo={onGo} /></>}{' '}
        ({sp.gF === sp.gM ? `each ${gens(sp.gF)} down` : `${first(F)} ${gens(sp.gF)} down, ${first(M)} ${gens(sp.gM)}`}).</>}
      {closer && <> The tree links them even more closely: {cc!.label}{cc!.ca.filter(x => x >= 0).length ? <>, through {cc!.ca.filter(x => x >= 0).slice(0, 2).map((x, k) => <span key={x}>{k ? ' and ' : ''}<Name i={x} onGo={onGo} /></span>)}</> : null}.</>}
      {(suspect || sp.flag) && (
        <span className="split-doubt"> {suspect
          ? <>This is probably a data error in the tree: parents recorded this close are almost always a duplicate or mistaken link{sp.flag ? `, and a link on the way is ${sp.flag}` : ''}.</>
          : <>This is probably a data error in the tree: a link on the way is {sp.flag}.</>}</span>)}
    </p>
  )
}

// ---------- close-kin parents on a person's panel ----------
function nth(n: number): string { return descendantWord(n, true) }

export function ParentsKin({ i, onGo }: { i: number; onGo: Go }) {
  const c = C()
  const [cons, setCons] = useState<Map<number, ConsCouple> | null>(null)
  useEffect(() => { let live = true; loadCons().then(m => { if (live) setCons(m) }); return () => { live = false } }, [])
  const cc = cons?.get(i)
  if (!cc || c.father[i] !== cc.f || c.mother[i] !== cc.m) return null
  const kin = kinship(cc.n1, cc.n2, cc.n1 === 1 && cc.n2 === 1 ? fullSiblings(cc.f, cc.m, cc) : null)
  const cas = cc.ca.filter(x => x >= 0).slice(0, 2)
  const living = !!(c.flags[i] & FL.living)
  const subj = i === c.root ? 'Your' : c.sex[i] === 1 ? 'His' : c.sex[i] === 2 ? 'Her' : 'Their'
  // doubtful if the pair is a sibling/parent-level pair, or either side passes through a flagged link
  const flagged = cas[0] !== undefined ? (flaggedBetween(cc.f, cas[0]) ?? flaggedBetween(cc.m, cas[0])) : null
  const doubtful = cc.suspect || !!flagged
  const names = <>{cas.map((x, k) => <span key={x}>{k ? ' and ' : ''}<button className="link" onClick={() => onGo(x)}>{displayName(x)}</button></span>)}</>
  const how = kin.kind === 'lineal' || !cas.length ? null
    : cc.n1 === cc.n2 ? <>both {nth(cc.n1)} of {names}</> : <>descending from {names}, {gens(cc.n1)} and {gens(cc.n2)} back</>
  const verb = living ? 'are' : 'were'
  const distant = kin.kind === 'cousin' && kin.degree > 6
  const body = <>{subj} parents {verb} {cc.suspect ? <>recorded as <b>{kin.label}</b></> : <><b>{kin.label}</b></>}{how && <> ({how})</>}.
    {doubtful && <span className="kin-doubt"> Probably a data error in the tree{flagged && !cc.suspect ? ` (a link on the way is ${flagged})` : ''}.</span>}</>
  if (distant) return <details className="kin-note quiet"><summary>Parents distantly related</summary><p>{body}</p></details>
  return <p className={'kin-note' + (doubtful ? ' doubt' : '')}>{body}</p>
}
