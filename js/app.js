'use strict';
/* Monty Morris Productions: inventory tracker.
   Data lives in two spreadsheets in the repo: data/inventory.csv and data/jobs.csv. */
const PICKER = 'Monty Morris';
const FILES = {
  inv: { path: 'data/inventory.csv', cols: ['asset_no', 'product', 'hire_price', 'replacement_cost', 'status', 'job_id'] },
  jobs: { path: 'data/jobs.csv', cols: ['id', 'name', 'client', 'venue', 'start', 'start_time', 'end', 'end_time'] }
};
const $ = (s, e = document) => e.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = n => '£' + (+n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const byAsset = (a, b) => a.asset_no.localeCompare(b.asset_no, 'en', { numeric: true });
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };

/* ---------- csv ---------- */
function parseCSV(t) {
  const rows = []; let r = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; rows.push(r); r = []; }
    else c += ch;
  }
  if (c !== '' || r.length) { r.push(c); rows.push(r); }
  const h = (rows.shift() || []).map(x => x.trim());
  return rows.filter(x => x.some(v => v !== '')).map(x => Object.fromEntries(h.map((k, i) => [k, x[i] ?? ''])));
}
const toCSV = (cols, rows) => [cols.join(',')].concat(rows.map(r => cols.map(k => { const v = String(r[k] ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','))).join('\n') + '\n';
const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ''))));

/* ---------- state and sync ---------- */
const draft = lsGet('mms-draft', null);
let S = draft?.S || { inv: [], jobs: [] };
let dirty = draft?.dirty || { inv: false, jobs: false };
/* Repo and branch are built in. The token is entered once in Settings and saved in this browser only. */
const cfg = {
  repo: 'montymorris/montymorrisproductions-inventory',
  branch: 'main',
  token: lsGet('mms-token', '')
};
let freeScan = lsGet('mms-free', true);
const shas = {}; let timer = null, syncMsg = '', syncBad = false;
const connected = () => !!(cfg.token && cfg.repo);
const H = () => ({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json' });
const url = k => `https://api.github.com/repos/${cfg.repo}/contents/${FILES[k].path}`;
function showSync() {
  const el = $('#sync'); if (!el) return;
  const pending = dirty.inv || dirty.jobs;
  el.className = 'sync' + (syncBad ? ' bad' : '');
  el.textContent = syncMsg || (connected() ? (pending ? 'Saving…' : 'Synced with GitHub') : pending ? 'Saved in this browser only' : '');
}
const setSync = (m, bad) => { syncMsg = m; syncBad = !!bad; showSync(); };
function touch(k) { dirty[k] = true; lsSet('mms-draft', { S, dirty }); syncMsg = ''; showSync(); if (connected()) { clearTimeout(timer); timer = setTimeout(flush, 1200); } }
async function put(k, body) { return fetch(url(k), { method: 'PUT', headers: H(), body: JSON.stringify(body) }); }
async function push(k) {
  const body = { message: 'Update ' + FILES[k].path + ' (inventory tracker)', content: b64e(toCSV(FILES[k].cols, S[k])), branch: cfg.branch || 'main' };
  if (shas[k]) body.sha = shas[k];
  let r = await put(k, body);
  if (r.status === 409 || r.status === 422) {
    const g = await fetch(url(k) + '?ref=' + (cfg.branch || 'main'), { headers: H() });
    if (g.ok) { body.sha = (await g.json()).sha; r = await put(k, body); }
  }
  if (!r.ok) throw new Error('GitHub replied ' + r.status + (r.status === 401 || r.status === 403 ? ' (check the token)' : ''));
  shas[k] = (await r.json()).content.sha; dirty[k] = false; lsSet('mms-draft', { S, dirty });
}
async function flush() {
  if (!connected()) return;
  try { for (const k of Object.keys(FILES)) if (dirty[k]) await push(k); setSync('Saved to GitHub at ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); }
  catch (e) { setSync('Not saved: ' + e.message + '. Changes are kept in this browser.', true); }
}
async function pull() {
  for (const k of Object.keys(FILES)) {
    let text = null;
    try {
      if (connected()) {
        const r = await fetch(url(k) + '?ref=' + (cfg.branch || 'main'), { headers: H() });
        if (r.ok) { const j = await r.json(); shas[k] = j.sha; text = b64d(j.content); } else if (r.status === 404) { shas[k] = null; text = ''; } else throw new Error('GitHub replied ' + r.status);
      } else { const r = await fetch(FILES[k].path, { cache: 'no-store' }); if (r.ok) text = await r.text(); }
    } catch (e) { setSync('Could not load ' + FILES[k].path + ': ' + e.message, true); }
    if (text !== null && !dirty[k]) S[k] = parseCSV(text);
  }
  lsSet('mms-draft', { S, dirty }); render();
  if (connected() && (dirty.inv || dirty.jobs)) flush(); else showSync();
}

/* ---------- helpers ---------- */
const groups = () => { const m = new Map(); S.inv.forEach(a => { if (!m.has(a.product)) m.set(a.product, { name: a.product, assets: [] }); m.get(a.product).assets.push(a); }); return [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); };
const avail = g => g.assets.filter(a => a.status === 'available').length;
const jobOf = id => S.jobs.find(j => j.id === id);
const when = (d, t) => d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'short' }) + ', ' + new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) + ' - ' + (t || '09:00') : 'Not set';
const dayCount = j => Math.max(1, Math.round((new Date(j.end) - new Date(j.start)) / 864e5) + 1 || 1);
const pill = s => `<span class="st ${s}">${s[0].toUpperCase() + s.slice(1)}</span>`;
const view = h => { $('#v').innerHTML = h; };
function modal(title, body, onSubmit, o = {}) {
  const d = $('#dlg');
  d.innerHTML = `<form><div class="bar">${esc(title)}</div><div class="body">${body}<p class="err" id="er" role="alert"></p><div class="acts">${o.del ? '<button type="button" class="b2 red" id="dx">Delete</button>' : ''}<span></span><button type="button" class="b2" id="cx">Cancel</button><button class="b1">${o.ok || 'Save'}</button></div></div></form>`;
  d.showModal(); const f = $('form', d);
  $('#cx').onclick = () => d.close();
  if (o.del) $('#dx').onclick = () => { if (confirm('Delete this? This cannot be undone.')) { o.del(); d.close(); } };
  f.onsubmit = e => { e.preventDefault(); const err = onSubmit(Object.fromEntries(new FormData(f)), f); if (err) $('#er').textContent = err; else d.close(); };
  o.open?.(f);
}
const fld = (l, n, v = '', a = '') => `<label>${l}<input name="${n}" value="${esc(v)}" ${a}></label>`;
const dl = (name, text) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

/* ---------- inventory ---------- */
let search = '';
function inventory() {
  const gs = groups().filter(g => (g.name + g.assets.map(a => a.asset_no).join(' ')).toLowerCase().includes(search.toLowerCase()));
  view(`${connected() ? '' : '<p class="warn"><b>Not connected to GitHub.</b> Changes are saved in this browser only. Connect the repo in <a href="#/settings">Settings</a> so the spreadsheet updates.</p>'}
  <div class="row"><h1>Inventory</h1><span class="sp"></span><input id="q" type="search" placeholder="Search item or asset number" aria-label="Search inventory" value="${esc(search)}"><button class="b1" data-act="add">Add item</button></div>
  ${gs.length ? gs.map(g => { const a0 = g.assets[0]; return `<details class="g"><summary><span class="nm">${esc(g.name)}</span><span><b>Available ${avail(g)}</b> of ${g.assets.length}</span><span>${gbp(a0.hire_price)} hire</span><span>${a0.replacement_cost !== '' ? gbp(a0.replacement_cost) + ' repl.' : 'No replacement cost'}</span><span><button class="b2" data-act="edit" data-p="${esc(g.name)}">Edit</button></span></summary>
  <div class="in"><div class="tw"><table><tr><th>Asset number</th><th>Status</th><th>Opportunity</th><th></th></tr>${g.assets.slice().sort(byAsset).map(a => `<tr><td>${esc(a.asset_no)}</td><td>${pill(a.status)}</td><td>${a.job_id ? `<a href="#/jobs/${esc(a.job_id)}">${esc(jobOf(a.job_id)?.name || a.job_id)}</a>` : ''}</td><td>${a.status === 'available' ? `<button class="b2" data-act="delasset" data-a="${esc(a.asset_no)}">Delete</button>` : ''}</td></tr>`).join('')}</table></div>
  <p class="row"><button class="b2" data-act="add" data-p="${esc(g.name)}">Add more ${esc(g.name)}</button></p></div></details>`; }).join('') : '<p class="empty">No inventory yet. Add your first item.</p>'}`);
  const q = $('#q'); q.oninput = () => { search = q.value; const p = q.selectionStart; inventory(); const n = $('#q'); n.focus(); n.setSelectionRange(p, p); };
}
function addForm(product = '') {
  const first = S.inv.find(a => a.product === product);
  modal('Add item', `<label>Item name<input name="product" list="pn" required autocomplete="off" value="${esc(product)}"></label><datalist id="pn">${groups().map(g => `<option value="${esc(g.name)}">`).join('')}</datalist>
  <div class="two"><label>Hire price (£)<input name="hire" type="number" min="0" step="0.01" required value="${esc(first?.hire_price ?? '')}"></label><label>Replacement cost (£, optional)<input name="repl" type="number" min="0" step="0.01" value="${esc(first?.replacement_cost ?? '')}"></label></div>
  <label>Quantity<input name="qty" type="number" min="1" max="50" value="1"></label><div id="al" class="body" style="padding:0"></div>`,
    (v, f) => {
      const n = Math.max(1, Math.min(50, +v.qty || 1)), nos = Array.from({ length: n }, (_, i) => (v['a' + i] || '').trim()), name = v.product.trim();
      if (nos.some(x => !x)) return 'Enter an asset number for every item.';
      const all = new Set(S.inv.map(a => a.asset_no.toLowerCase())), seen = new Set();
      for (const x of nos) { if (all.has(x.toLowerCase())) return 'Asset number ' + x + ' is already in use.'; if (seen.has(x.toLowerCase())) return 'Asset number ' + x + ' is entered twice.'; seen.add(x.toLowerCase()); }
      S.inv.forEach(a => { if (a.product === name) { a.hire_price = v.hire; a.replacement_cost = v.repl; } });
      nos.forEach(x => S.inv.push({ asset_no: x, product: name, hire_price: v.hire, replacement_cost: v.repl, status: 'available', job_id: '' }));
      touch('inv'); render();
    }, {
    ok: 'Add', open: f => {
      const al = $('#al'), draw = () => { const n = Math.max(1, Math.min(50, +f.elements.qty.value || 1)), old = [...al.querySelectorAll('input')].map(i => i.value); al.innerHTML = Array.from({ length: n }, (_, i) => `<label>Asset number${n > 1 ? ' ' + (i + 1) : ''}<input name="a${i}" required autocomplete="off" value="${esc(old[i] || '')}"></label>`).join(''); };
      f.elements.qty.oninput = draw; draw();
      f.elements.product.onchange = () => { const a = S.inv.find(x => x.product === f.elements.product.value.trim()); if (a) { f.elements.hire.value = a.hire_price; f.elements.repl.value = a.replacement_cost; } };
    }
  });
}
function editForm(name) {
  const g = groups().find(x => x.name === name), a0 = g.assets[0];
  modal('Edit ' + name, `${fld('Item name', 'product', name, 'required')}<div class="two"><label>Hire price (£)<input name="hire" type="number" min="0" step="0.01" required value="${esc(a0.hire_price)}"></label><label>Replacement cost (£, optional)<input name="repl" type="number" min="0" step="0.01" value="${esc(a0.replacement_cost)}"></label></div><p class="note">Changes apply to all ${g.assets.length} asset${g.assets.length > 1 ? 's' : ''} of this item.</p>`,
    v => { g.assets.forEach(a => { a.product = v.product.trim(); a.hire_price = v.hire; a.replacement_cost = v.repl; }); touch('inv'); render(); });
}

/* ---------- opportunities ---------- */
function jobsList() {
  const rows = S.jobs.slice().sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  view(`<div class="row"><h1>Opportunities</h1><span class="sp"></span><button class="b1" data-act="newjob">New opportunity</button></div>
  <div class="tw">${rows.length ? `<table><tr><th>No.</th><th>Name</th><th>Client</th><th>Venue</th><th>In use</th><th class="n">Items</th><th class="n">Out</th></tr>${rows.map(j => { const it = S.inv.filter(a => a.job_id === j.id); return `<tr class="go" data-go="jobs/${esc(j.id)}"><td>${esc(j.id)}</td><td><b>${esc(j.name)}</b></td><td>${esc(j.client)}</td><td>${esc(j.venue)}</td><td>${when(j.start, j.start_time)}</td><td class="n">${it.length}</td><td class="n">${it.filter(a => a.status === 'out').length}</td></tr>`; }).join('')}</table>` : '<p class="empty">No opportunities yet.</p>'}</div>`);
}
function jobForm(j) {
  const isNew = !j; j = j || { start: new Date().toISOString().slice(0, 10), start_time: '09:00', end: new Date().toISOString().slice(0, 10), end_time: '22:00' };
  modal(isNew ? 'New opportunity' : 'Edit opportunity', `${fld('Name', 'name', j.name, 'required')}${fld('Client / organisation', 'client', j.client)}${fld('Venue', 'venue', j.venue)}
  <div class="two">${fld('In use: date', 'start', j.start, 'type="date" required')}${fld('Time', 'start_time', j.start_time, 'type="time"')}${fld('Return by: date', 'end', j.end, 'type="date" required')}${fld('Time', 'end_time', j.end_time, 'type="time"')}</div>`,
    v => {
      if (v.end < v.start) return 'The return date cannot be before the in-use date.';
      if (isNew) { const id = 'J' + String(Math.max(0, ...S.jobs.map(x => parseInt(x.id.slice(1)) || 0)) + 1).padStart(4, '0'); S.jobs.push({ id, ...v }); touch('jobs'); location.hash = '#/jobs/' + id; }
      else { Object.assign(j, v); touch('jobs'); render(); }
    }, isNew ? {} : { del: () => { S.inv.forEach(a => { if (a.job_id === j.id && a.status !== 'out') { a.job_id = ''; a.status = 'available'; } }); S.jobs = S.jobs.filter(x => x !== j); touch('jobs'); touch('inv'); location.hash = '#/jobs'; } });
}

let sel = new Set(), selJob = '', log = [];
function jobPage(id, tab) {
  const j = jobOf(id); if (!j) return view('<p class="empty">Opportunity not found. <a href="#/jobs">Back to opportunities</a></p>');
  if (selJob !== id) { sel = new Set(); selJob = id; log = []; }
  const items = S.inv.filter(a => a.job_id === id).sort((a, b) => a.product.localeCompare(b.product) || byAsset(a, b));
  const n = (s) => items.filter(a => a.status === s).length;
  const head = `<p class="sub"><a href="#/jobs">Opportunities</a> / ${esc(j.id)}</p><div class="row" style="margin-top:0"><h1>${esc(j.name)}</h1><span class="sp"></span><button class="b2" data-act="sheet" data-id="${id}">Kit list</button><button class="b2" data-act="label" data-id="${id}">Job label</button><button class="b2" data-act="editjob" data-id="${id}">Edit</button></div>
  <div class="grey"><b>${esc(j.client || 'No client')}</b>, ${esc(j.venue || 'no venue')}<br>In use ${when(j.start, j.start_time)} &nbsp; Return by ${when(j.end, j.end_time)}</div>
  <div class="tabs"><a class="${!tab ? 'on' : ''}" href="#/jobs/${esc(id)}">Items (${items.length})</a><a class="${tab === 'prepare' ? 'on' : ''}" href="#/jobs/${esc(id)}/prepare">Prepare</a><a class="${tab === 'checkin' ? 'on' : ''}" href="#/jobs/${esc(id)}/checkin">Check in</a></div>`;
  const msgs = log.map(m => `<div class="msg ${m.bad ? 'bad' : ''}">${esc(m.t)}</div>`).join('');
  if (tab === 'prepare') {
    const todo = items.filter(a => a.status === 'allocated');
    view(head + `<div class="row"><h2 style="margin:0">Prepared ${n('prepared') + n('out')} of ${items.length}</h2></div><input class="scan" id="sc" placeholder="Scan an asset number, then press Enter" aria-label="Asset number" autocomplete="off">
    <div class="row" style="margin:8px 0"><label style="display:flex;gap:8px;align-items:center;grid-auto-flow:column"><input type="checkbox" id="fs"${freeScan ? ' checked' : ''}> Free scan ${freeScan ? 'on' : 'off'}</label></div><p class="note">${freeScan ? 'Any available asset you scan is added to this opportunity and marked prepared.' : 'Only assets already allocated to this opportunity can be prepared. Anything else is refused.'}</p><div aria-live="polite">${msgs}</div>
    ${todo.length ? `<div class="bar">Still to prepare</div><div class="tw"><table>${todo.map(a => `<tr><td>${esc(a.asset_no)}</td><td>${esc(a.product)}</td></tr>`).join('')}</table></div>` : ''}`);
    $('#fs').onchange = e => { freeScan = e.target.checked; lsSet('mms-free', freeScan); jobPage(id, 'prepare'); };
    const sc = $('#sc'); sc.focus();
    sc.onkeydown = e => {
      if (e.key !== 'Enter') return; const v = sc.value.trim(); if (!v) return;
      const a = S.inv.find(x => x.asset_no.toLowerCase() === v.toLowerCase()), say = (t, bad) => { log.unshift({ t, bad }); log = log.slice(0, 4); jobPage(id, 'prepare'); };
      if (!a) return say('No asset with number ' + v, 1);
      if (a.job_id && a.job_id !== id) return say(a.asset_no + ' is on ' + (jobOf(a.job_id)?.name || a.job_id), 1);
      if (a.status === 'prepared') return say(a.asset_no + ' is already prepared', 1);
      if (a.status === 'out') return say(a.asset_no + ' is already booked out', 1);
      if (a.status === 'available' && !freeScan) return say(a.asset_no + ' is not allocated to this opportunity. Turn on free scan to add it.', 1);
      const was = a.status; a.job_id = id; a.status = 'prepared'; touch('inv');
      say((was === 'available' ? 'Allocated and prepared ' : 'Prepared ') + a.asset_no + ' (' + a.product + ')');
    };
    return;
  }
  if (tab === 'checkin') {
    const outs = items.filter(a => a.status === 'out');
    view(head + `<div class="row"><h2 style="margin:0">Still out ${outs.length} of ${items.length}</h2></div><input class="scan" id="sc" placeholder="Scan an asset number to check in, then press Enter" aria-label="Asset number" autocomplete="off">
    <p class="note">Scanned assets that are booked out on this opportunity are checked in and returned to inventory.</p><div aria-live="polite">${msgs}</div>
    ${outs.length ? `<div class="bar">Still to check in</div><div class="tw"><table>${outs.map(a => `<tr><td>${esc(a.asset_no)}</td><td>${esc(a.product)}</td></tr>`).join('')}</table></div>` : items.length ? '<p class="empty">Everything has been checked in.</p>' : ''}`);
    const sc = $('#sc'); sc.focus();
    sc.onkeydown = e => {
      if (e.key !== 'Enter') return; const v = sc.value.trim(); if (!v) return;
      const a = S.inv.find(x => x.asset_no.toLowerCase() === v.toLowerCase()), say = (t, bad) => { log.unshift({ t, bad }); log = log.slice(0, 4); jobPage(id, 'checkin'); };
      if (!a) return say('No asset with number ' + v, 1);
      if (a.job_id && a.job_id !== id) return say(a.asset_no + ' is on ' + (jobOf(a.job_id)?.name || a.job_id), 1);
      if (!a.job_id) return say(a.asset_no + ' is already checked in', 1);
      if (a.status !== 'out') return say(a.asset_no + ' has not been booked out', 1);
      a.status = 'available'; a.job_id = ''; touch('inv');
      say('Checked in ' + a.asset_no + ' (' + a.product + ')');
    };
    return;
  }
  const opts = groups().filter(g => avail(g) > 0);
  const tot = items.reduce((s, a) => s + (+a.hire_price || 0), 0), rep = items.reduce((s, a) => s + (+a.replacement_cost || 0), 0);
  view(head + `<div class="row"><select id="ap" aria-label="Item to allocate">${opts.length ? opts.map(g => `<option value="${esc(g.name)}">${esc(g.name)} (${avail(g)} available)</option>`).join('') : '<option value="">Nothing available</option>'}</select><input id="aq" type="number" min="1" value="1" style="width:80px" aria-label="Quantity"><button class="b1" data-act="alloc" data-id="${id}"${opts.length ? '' : ' disabled'}>Allocate</button></div>
  <div aria-live="polite">${msgs}</div>
  <div class="row"><button class="b1" data-act="bookout" data-id="${id}">Book out selected</button><button class="b2" data-act="checkin" data-id="${id}">Check in selected</button><button class="b2" data-act="remove" data-id="${id}">Remove selected</button><span class="sp"></span><span class="note">${sel.size} selected</span></div>
  <div class="tw">${items.length ? `<table><tr><th><input type="checkbox" data-all aria-label="Select all"${sel.size && sel.size === items.length ? ' checked' : ''}></th><th>Asset number</th><th>Item</th><th>Status</th><th class="n">Hire</th><th class="n">Replacement</th></tr>${items.map(a => `<tr><td><input type="checkbox" data-sel="${esc(a.asset_no)}"${sel.has(a.asset_no) ? ' checked' : ''} aria-label="Select ${esc(a.asset_no)}"></td><td>${esc(a.asset_no)}</td><td>${esc(a.product)}</td><td>${pill(a.status)}</td><td class="n">${gbp(a.hire_price)}</td><td class="n">${a.replacement_cost !== '' ? gbp(a.replacement_cost) : ''}</td></tr>`).join('')}</table>` : '<p class="empty">Nothing allocated yet.</p>'}</div>
  <p class="note">${items.length} items. Hire ${gbp(tot)} a day, ${gbp(tot * dayCount(j))} for ${dayCount(j)} day${dayCount(j) > 1 ? 's' : ''}. Replacement value ${gbp(rep)}.</p>`);
  $('#v').onchange = e => { const t = e.target; if (t.dataset.sel != null) { t.checked ? sel.add(t.dataset.sel) : sel.delete(t.dataset.sel); } else if ('all' in t.dataset) sel = t.checked ? new Set(items.map(a => a.asset_no)) : new Set(); else return; jobPage(id, tab); };
}
function jobAction(id, a) {
  const say = (t, bad) => { log.unshift({ t, bad }); log = log.slice(0, 4); render(); };
  if (a === 'alloc') {
    const name = $('#ap').value, qty = Math.max(1, +$('#aq').value || 1); if (!name) return;
    const free = S.inv.filter(x => x.product === name && x.status === 'available').sort(byAsset);
    if (qty > free.length) return say('Only ' + free.length + ' × ' + name + ' available.', 1);
    free.slice(0, qty).forEach(x => { x.status = 'allocated'; x.job_id = id; }); touch('inv'); return say('Allocated ' + qty + ' × ' + name + ': ' + free.slice(0, qty).map(x => x.asset_no).join(', '));
  }
  const pick = S.inv.filter(x => x.job_id === id && sel.has(x.asset_no));
  if (!pick.length) return say('Tick the items first, or use the tick box at the top to select all.', 1);
  if (a === 'bookout') { const ok = pick.filter(x => x.status !== 'out'); ok.forEach(x => x.status = 'out'); touch('inv'); sel = new Set(); return say('Booked out ' + ok.length + ' item' + (ok.length === 1 ? '' : 's') + '.'); }
  if (a === 'checkin') { const ok = pick.filter(x => x.status === 'out'); ok.forEach(x => { x.status = 'available'; x.job_id = ''; }); touch('inv'); sel = new Set(); return say(ok.length ? 'Checked in ' + ok.length + ' item' + (ok.length === 1 ? '' : 's') + '.' : 'Only items that are out can be checked in.', !ok.length); }
  if (a === 'remove') { const ok = pick.filter(x => x.status !== 'out'); ok.forEach(x => { x.status = 'available'; x.job_id = ''; }); touch('inv'); sel = new Set(); return say(ok.length ? 'Removed ' + ok.length + ' item' + (ok.length === 1 ? '' : 's') + ' from this opportunity.' : 'Items that are out must be checked in first.', !ok.length); }
}

/* ---------- printing ---------- */
function printOut(html) { $('#pr').innerHTML = `<div class="pbar"><button class="b1" onclick="print()">Print</button><button class="b2" id="px">Close</button></div>` + html; $('#pr').hidden = false; $('#px').onclick = () => { $('#pr').hidden = true; }; }
function label(j) {
  const qr = qrcode(0, 'M'); qr.addData(new URL('#/jobs/' + j.id, location.href).href); qr.make();
  printOut(`<div class="lab"><h2>${esc(j.name)}</h2><div class="l1">${esc(j.venue || 'No venue')}</div><div class="l2"><div><p class="lo">${esc(j.client || '')}</p><p><i>In use:</i> <b>${when(j.start, j.start_time)}</b></p><p><i>Return By:</i> <b>${when(j.end, j.end_time)}</b></p></div><div class="qr">${qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })}</div></div><div class="l3">Picked By: ${PICKER}</div></div>`);
}
function sheet(j) {
  const items = S.inv.filter(a => a.job_id === j.id).sort((a, b) => a.product.localeCompare(b.product) || byAsset(a, b)), g = new Map();
  items.forEach(a => { if (!g.has(a.product)) g.set(a.product, []); g.get(a.product).push(a); });
  const tot = items.reduce((s, a) => s + (+a.hire_price || 0), 0), rep = items.reduce((s, a) => s + (+a.replacement_cost || 0), 0);
  printOut(`<div class="sheet"><h1>Kit list</h1><div class="bar">${esc(j.name)} (${esc(j.id)})</div><div class="grey"><b>${esc(j.client || '')}</b>, ${esc(j.venue || '')}<br>In use ${when(j.start, j.start_time)}<br>Return by ${when(j.end, j.end_time)}<br><i>Picked by ${PICKER}</i></div>
  <table><tr><th>Asset number</th><th>Item</th><th class="n">Hire</th><th>Out</th><th>Back</th></tr>${[...g].map(([n, as]) => `<tr class="gp"><td colspan="5">${esc(n)} × ${as.length}</td></tr>${as.map(a => `<tr><td>${esc(a.asset_no)}</td><td>${esc(a.product)}</td><td class="n">${gbp(a.hire_price)}</td><td><span class="box"></span></td><td><span class="box"></span></td></tr>`).join('')}`).join('') || '<tr><td colspan="5">Nothing allocated.</td></tr>'}</table>
  <p><b>${items.length} items.</b> Hire ${gbp(tot)} a day, ${gbp(tot * dayCount(j))} for ${dayCount(j)} day${dayCount(j) > 1 ? 's' : ''}. Replacement value ${gbp(rep)}.</p></div>`);
}

/* ---------- settings ---------- */
function settings() {
  view(`<h1>Settings</h1><p class="sub">Connected to <code>${esc(cfg.repo)}</code> on branch <code>${esc(cfg.branch)}</code>. Once a token is saved, every change updates the spreadsheets in <code>data/</code> automatically.</p>
  <div class="bar">GitHub access token</div><div class="grey" style="display:grid;gap:12px;max-width:520px"><label>Access token<input id="c_tok" type="password" value="${esc(cfg.token)}" autocomplete="off" placeholder="Paste token"></label>
  <p class="note" style="margin:0">Paste it once. It stays saved in this browser only and is never written to the repo. Use a fine-grained token limited to this repo with Contents set to read and write.</p>
  <div class="row" style="margin:0"><button class="b1" id="cs">Save and load from GitHub</button><button class="b2" id="cd">Remove token</button></div><div id="cm"></div></div>
  <div class="row"><h2 style="margin:0">Spreadsheets</h2></div><div class="row" style="margin-top:0"><button class="b2" data-act="dl" data-k="inv">Download inventory.csv</button><button class="b2" data-act="dl" data-k="jobs">Download jobs.csv</button></div>`);
  $('#cs').onclick = async () => { cfg.token = $('#c_tok').value.trim(); lsSet('mms-token', cfg.token); $('#cm').innerHTML = '<div class="msg">Loading…</div>'; await pull(); $('#cm').innerHTML = `<div class="msg ${syncBad ? 'bad' : ''}">${esc(syncMsg || (connected() ? 'Token saved. The spreadsheets are loaded.' : 'Enter a token first.'))}</div>`; };
  $('#cd').onclick = () => { cfg.token = ''; lsSet('mms-token', ''); settings(); showSync(); };
}

/* ---------- events and routing ---------- */
document.addEventListener('click', e => {
  const g = e.target.closest('[data-go]'); if (g) return (location.hash = '#/' + g.dataset.go);
  const a = e.target.closest('[data-act]'); if (!a) return; if (a.closest('summary')) e.preventDefault();
  const d = a.dataset, A = {
    add: () => addForm(d.p || ''), edit: () => editForm(d.p), newjob: () => jobForm(), editjob: () => jobForm(jobOf(d.id)), label: () => label(jobOf(d.id)), sheet: () => sheet(jobOf(d.id)),
    delasset: () => { if (confirm('Delete asset ' + d.a + '?')) { S.inv = S.inv.filter(x => x.asset_no !== d.a); touch('inv'); render(); } },
    dl: () => dl(FILES[d.k].path.split('/')[1], toCSV(FILES[d.k].cols, S[d.k]))
  };
  (A[d.act] || (() => jobAction(d.id, d.act)))();
});
function render() {
  const [p, id, tab] = (location.hash.slice(2) || 'inventory').split('/');
  document.querySelectorAll('.head nav a').forEach(a => a.classList.toggle('on', a.dataset.p === p));
  $('#v').onchange = null;
  if (p === 'jobs') id ? jobPage(id, tab) : jobsList(); else if (p === 'settings') settings(); else inventory();
  showSync();
}
addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
render(); pull();
