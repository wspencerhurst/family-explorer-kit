// Cloudflare Pages middleware: one shared family password protects every request (pages, data, portraits).
// The password lives only in the Pages project's environment as the secret SITE_PASSWORD.
// A correct entry sets a 30-day cookie whose value is an HMAC of the password, so changing the
// password (and redeploying) logs everyone out automatically.

const COOKIE = 'hfx_auth'
const MAX_AGE = 60 * 60 * 24 * 30
const NOINDEX = 'noindex, nofollow, noarchive'

async function token(password) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('family-explorer/v1'))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

function cookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
  return m ? m[1] : null
}

function loginPage(status, wrong, title) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title>
<style>
:root{--bg:#f6f3ee;--card:#fff;--ink:#22201c;--muted:#6b665d;--line:#ddd6ca;--accent:#8a5a2b;--bad:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#16140f;--card:#211e18;--ink:#eee8dc;--muted:#a59e90;--line:#3a352c;--accent:#d9a066;--bad:#f2867e}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);
font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
form{width:100%;max-width:360px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font:600 1.5rem Georgia,serif;margin:0 0 4px}p{margin:0 0 20px;color:var(--muted);font-size:.95rem}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:12px;width:100%;padding:11px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:600 1rem system-ui,sans-serif;cursor:pointer}
.err{color:var(--bad);font-size:.9rem;margin:10px 0 0;min-height:1.3em}
</style></head><body>
<form method="post" action="/__login" id="f">
<h1>${title}</h1><p>Private family history. Enter the family password.</p>
<input type="password" name="password" autocomplete="current-password" aria-label="Password" autofocus required>
<button type="submit">Enter</button>
<div class="err" id="e">${wrong ? 'That password is not right.' : ''}</div>
</form>
<script>
document.getElementById('f').addEventListener('submit', async ev => {
  ev.preventDefault()
  const r = await fetch('/__login', { method: 'POST', body: new FormData(ev.target), headers: { 'X-Requested-With': 'fetch' } })
  if (r.ok) location.reload()  // keeps the #/route the visitor was opening
  else document.getElementById('e').textContent = 'That password is not right.'
})
</script></body></html>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': NOINDEX } })
}

export async function onRequest(context) {
  const { request, env, next } = context
  const url = new URL(request.url)
  const password = env.SITE_PASSWORD
  const title = (env.SITE_TITLE || 'Family Explorer').replace(/[<>&"]/g, '')
  if (!password) return new Response('Site password is not configured.', { status: 503, headers: { 'X-Robots-Tag': NOINDEX } })
  const good = await token(password)

  if (url.pathname === '/__logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } })
  }

  if (url.pathname === '/__login' && request.method === 'POST') {
    let given = ''
    try { given = String((await request.formData()).get('password') || '') } catch {}
    if (!same(await token(given), good)) {
      await new Promise(r => setTimeout(r, 800))  // slow down guessing
      return request.headers.get('X-Requested-With') ? new Response('no', { status: 401 }) : loginPage(401, true, title)
    }
    const set = `${COOKIE}=${good}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`
    return request.headers.get('X-Requested-With')
      ? new Response('ok', { headers: { 'Set-Cookie': set, 'Cache-Control': 'no-store' } })
      : new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': set } })
  }

  if (!same(cookie(request, COOKIE), good)) {
    const wantsPage = (request.headers.get('Accept') || '').includes('text/html')
    return wantsPage ? loginPage(401, false, title) : new Response('Unauthorized', { status: 401, headers: { 'X-Robots-Tag': NOINDEX, 'Cache-Control': 'no-store' } })
  }

  const res = await next()
  const out = new Response(res.body, res)
  out.headers.set('X-Robots-Tag', NOINDEX)
  // Authenticated content must never sit in a shared cache.
  const cc = out.headers.get('Cache-Control') || ''
  if (!cc.includes('private')) out.headers.set('Cache-Control', cc ? cc.replace(/\bpublic\b/, 'private') : 'private, max-age=0, must-revalidate')
  return out
}
