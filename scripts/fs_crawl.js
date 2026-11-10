// FamilySearch ancestry crawl v4 (generation-by-generation batch walk) + record-search helpers.
// Run with the built-in browser's javascript tool on a FRESHLY LOADED, signed-in familysearch.org tab ("seed").
// - Walks the tree breadth-first with /platform/tree/persons?pids=<up to 200 ids>: each call returns 200 people with
//   their parents' ids (display.familiesAsChild), so every call yields ~200 NEW people (vs ~7 for 8-gen ancestry calls).
//   A full re-walk of ~50k people takes a few minutes, so restarts are cheap. 
// - Paces itself: honours Retry-After; pauses 0.7 s after a 5xx; splits a failing batch in half recursively.
// - State: IndexedDB 'familycrawl' (resumes if present; wiped when the app restarts). C.export() downloads
//   fs-tree-dump.json (browsers allow only a few downloads per page load; reload + re-run for more). sync_dump.sh moves it.
// - window.__C.status() for progress. On 401 (signed out) it stops: sign in, reload, re-run.
const tok = () => (document.cookie.match(/fssessionid=([^;]+)/)||[])[1];
const sleep=ms=>new Promise(s=>setTimeout(s,ms));
window.__RS = async function(q, count=20){ for(let t=0;t<6;t++){ const r=await fetch('https://www.familysearch.org/service/search/hr/v2/personas?count='+count+'&'+q,{headers:{Accept:'application/json',Authorization:'Bearer '+tok()}}); if(r.status===429||r.status>=500){ await sleep(3000*(t+1)); continue; } if(!r.ok) return 'HTTP '+r.status; const j=await r.json(); return (j.entries||[]).map(e=>{const g=e.content.gedcomx; const p=g.persons.find(x=>x.principal)||g.persons[0]; const facts=(p.facts||[]).map(f=>`${f.type?.split('/').pop()}:${f.date?.original||''} ${f.place?.original||''}`.trim()).join('; '); const rel=g.persons.filter(x=>x!==p).map(x=>x.names?.[0]?.nameForms?.[0]?.fullText+((x.facts||[]).find(f=>f.type?.endsWith('Birth'))?.date?.original?(' b.'+(x.facts||[]).find(f=>f.type?.endsWith('Birth')).date.original):'')).join(', '); return `ark:1:1:${e.id} | ${g.sourceDescriptions?.[0]?.titles?.[0]?.value||''} | ${p.names?.[0]?.nameForms?.[0]?.fullText} | ${facts} | with: ${rel}`;}).join('\n'); } return 'throttled'; };
window.__REC = async function(ark){ const r=await fetch('https://www.familysearch.org/platform/records/personas/'+ark,{headers:{Accept:'application/x-gedcomx-v1+json',Authorization:'Bearer '+tok()}}); if(!r.ok) return 'HTTP '+r.status; const g=await r.json(); return (g.persons||[]).map(p=>`${p.names?.[0]?.nameForms?.[0]?.fullText} [${p.gender?.type?.split('/').pop()||''}] ${(p.facts||[]).map(f=>`${f.type?.split('/').pop()}:${f.date?.original||''} ${f.place?.original||''} ${f.value||''}`.trim()).join('; ')} ${(p.fields||[]).map(f=>(f.values||[]).map(v=>v.labelId+'='+v.text).join(',')).join(' ')}`).join('\n')+'\nREL: '+(g.relationships||[]).map(r=>r.type.split('/').pop()+':'+r.person1.resource.split('/').pop()+'-'+r.person2.resource.split('/').pop()).join(' '); };
const idb=()=>new Promise((res,rej)=>{const o=indexedDB.open('familycrawl',1); o.onupgradeneeded=()=>o.result.createObjectStore('s'); o.onsuccess=()=>res(o.result); o.onerror=()=>rej(o.error);});
window.__IDBSAVE=async(obj)=>{const db=await idb(); await new Promise((res,rej)=>{const tx=db.transaction('s','readwrite'); tx.objectStore('s').put(JSON.stringify(obj),'state'); tx.oncomplete=res; tx.onerror=()=>rej(tx.error);});};
window.__IDBLOAD=async()=>{const db=await idb(); return await new Promise((res)=>{const g=db.transaction('s').objectStore('s').get('state'); g.onsuccess=()=>res(g.result?JSON.parse(g.result):null); g.onerror=()=>res(null);});};
const saved=await window.__IDBLOAD();
window.__C={persons:saved?.persons||{}, done:new Set(saved?.done||[]), need:new Set(saved?.queue||[]), errors:[], calls:0, ok:0, s503:0, throttled:0, bcalls:0, bnew:0,
  running:true, active:0, pauseUntil:0, pause503:700, started:Date.now(), lastOk:Date.now()};
const C=window.__C;
// Starting people: set window.__ANCHORS = ['XXXX-XXX', ...] (the FS ids from family.config.json fsAnchors) before running this file.
if(!C.need.size && !C.done.size){ if(!(window.__ANCHORS||[]).length) throw new Error('Set window.__ANCHORS = [fsId, ...] first'); window.__ANCHORS.forEach(x=>C.need.add(x)); }
C.state=()=>({done:[...C.done], queue:[...C.need], persons:C.persons});
C.export=function(){ const blob=new Blob([JSON.stringify({crawled:new Date().toISOString(), ...C.state()})],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='fs-tree-dump.json'; document.body.appendChild(a); a.click(); a.remove(); return blob.size; };
C.status=()=>({persons:Object.keys(C.persons).length, need:C.need.size, batchCalls:C.bcalls, newPeople:C.bnew, ok:C.ok, s503:C.s503, throttled:C.throttled, running:C.running, active:C.active,
  minutes:+((Date.now()-C.started)/60000).toFixed(1), secondsSinceLastSuccess:Math.round((Date.now()-C.lastOk)/1000), finished:!!C.finished, lastErrors:C.errors.slice(-3)});
C.fsFetch=async function(url){ for(let t=0;t<12;t++){ const w=C.pauseUntil-Date.now(); if(w>0) await sleep(w);
    let r; try{ r=await fetch(url,{headers:{Accept:'application/x-fs-v1+json',Authorization:'Bearer '+tok()}}); }catch(e){ await sleep(5000); continue; }
    C.calls++; const ra=+r.headers.get('retry-after')||0; if(ra) C.pauseUntil=Math.max(C.pauseUntil, Date.now()+ra*1000);
    if(r.status===429){ C.throttled++; C.pauseUntil=Math.max(C.pauseUntil, Date.now()+Math.max(ra,5)*1000); continue; }
    if(r.status>=500){ C.s503++; C.pauseUntil=Math.max(C.pauseUntil, Date.now()+C.pause503); return r; }
    if(r.ok){ C.ok++; C.lastOk=Date.now(); }
    if(Date.now()>=(C.nextIdb||0)){ C.nextIdb=Date.now()+3*60*1000; window.__IDBSAVE(C.state()).catch(e=>C.errors.push(['idb',String(e)])); }
    return r; } return null; };
C.batch=async function(ids){ const r=await C.fsFetch(`https://www.familysearch.org/platform/tree/persons?pids=${ids.join(',')}`); C.bcalls++;
  if(!r){ ids.forEach(i=>C.need.add(i)); return; }
  if(r.status===401){ C.running=false; ids.forEach(i=>C.need.add(i)); C.errors.push(['batch',401,'SIGNED OUT']); return; }
  if(!r.ok){ if(ids.length>1){ const h=ids.length>>1; await C.batch(ids.slice(0,h)); await C.batch(ids.slice(h)); } else { C.errors.push([ids[0],r.status]); C.done.add(ids[0]); } return; }
  const j=await r.json(); const got=new Set();
  for(const p of j.persons||[]){ const d=p.display||{}; got.add(p.id);
    if(!C.persons[p.id]){ C.persons[p.id]={id:p.id,name:d.name,sex:d.gender,life:d.lifespan,b:(d.birthDate||d.birthPlace)?{date:d.birthDate||null,place:d.birthPlace||null}:null,d:(d.deathDate||d.deathPlace)?{date:d.deathDate||null,place:d.deathPlace||null}:null,living:p.living}; C.bnew++; }
    const P=C.persons[p.id]; const fams=(d.familiesAsChild||[]).filter(f=>f.parent1||f.parent2);
    if(fams.length){ const a=fams[0].parent1?.resourceId, b=fams[0].parent2?.resourceId; if(!P.f && !P.m){ if(a) P.f=a; if(b) P.m=b; } if(fams.length>1) P.multiParents=true;
      for(const x of [a,b]) if(x && !C.persons[x] && !C.done.has(x)) C.need.add(x); }
    C.done.add(p.id); }
  for(const i of ids) if(!got.has(i)) C.done.add(i); };
C.start=(workers=2)=>{ C.running=true; for(let w=0;w<workers;w++){ (async()=>{ while(C.running){ const ids=[]; for(const x of C.need){ C.need.delete(x); if(!C.done.has(x)) ids.push(x); if(ids.length>=200) break; }
    if(!ids.length){ if(C.active===0) break; await sleep(1000); continue; } C.active++; try{ await C.batch(ids); } finally { C.active--; } }
    if(!C.need.size && C.active===0 && !C.finished){ C.finished=true; await window.__IDBSAVE(C.state()); C.export(); } })(); } };
C.start(2);
({resumed:!!saved, ...C.status()})
