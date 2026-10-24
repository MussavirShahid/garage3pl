(() => {
  const { $, $$, esc, toast, api, fmtDate, statusLabel, thumb } = G;
  const KEY = 'g3_wh_pass';
  let pass = localStorage.getItem(KEY) || '';
  let orders = [];
  const H = () => ({ 'x-wh-pass': pass });

  // ---------- auth ----------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = $('#pass').value;
    try {
      await api('/api/auth/warehouse', { method: 'POST', body: { passcode: p } });
      pass = p; localStorage.setItem(KEY, pass); enter();
    } catch (err) { toast(err.message); }
  });
  $('#logout').addEventListener('click', () => { localStorage.removeItem(KEY); location.reload(); });

  function enter() {
    $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
    loadTypes(); loadOrders(); loadClients();
    setInterval(loadOrders, 20000);
  }

  // ---------- tabs ----------
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    for (const id of ['orders', 'clients']) $('#tab-' + id).hidden = id !== t.dataset.tab;
  }));

  // ---------- orders ----------
  for (const id of ['statusFilter', 'typeFilter', 'fromDate', 'toDate', 'sortOrder']) $('#' + id).addEventListener('change', loadOrders);
  $('#refresh').addEventListener('click', () => { loadTypes(); loadOrders(); });
  $('#clearDates').addEventListener('click', () => { $('#fromDate').value = ''; $('#toDate').value = ''; loadOrders(); });

  function queryString() {
    const q = new URLSearchParams();
    q.set('status', $('#statusFilter').value);
    q.set('sort', $('#sortOrder').value);
    if ($('#typeFilter').value) q.set('type', $('#typeFilter').value);
    if ($('#fromDate').value) q.set('from', $('#fromDate').value);
    if ($('#toDate').value) q.set('to', $('#toDate').value);
    return q.toString();
  }

  async function loadOrders() {
    try { orders = await api(`/api/wh/orders?${queryString()}`, { headers: H() }); }
    catch (err) { toast(err.message); return; }
    renderOrders();
  }

  async function loadTypes() {
    try {
      const types = await api('/api/wh/product-types', { headers: H() });
      const sel = $('#typeFilter');
      const cur = sel.value;
      sel.innerHTML = '<option value="">All item types</option>' + types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
      if (types.includes(cur)) sel.value = cur;
    } catch { /* non-fatal: filter just stays empty */ }
  }

  function renderOrders() {
    const el = $('#orders');
    if (!orders.length) { el.innerHTML = '<div class="empty">Nothing in this queue.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Client</th><th>Order</th><th>Ship to</th><th>Items</th><th>Status</th><th></th></tr></thead><tbody>${orders.map((o) => {
      const units = o.items.reduce((s, it) => s + it.quantity, 0);
      return `<tr>
        <td>${esc(o.client_name)}</td>
        <td><strong>${esc(o.order_number)}</strong><div class="muted" style="font-size:12px">${esc(fmtDate(o.created_at))}</div></td>
        <td>${esc(o.ship_to) || '<span class="muted">—</span>'}</td>
        <td><div class="row">${o.items.slice(0, 4).map((it) => thumb(it.image, it.name)).join('')}${o.items.length > 4 ? `<span class="muted">+${o.items.length - 4}</span>` : ''}</div><div class="muted" style="font-size:12px">${o.items.length} line${o.items.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}</div></td>
        <td><span class="status ${esc(o.status)}">${esc(statusLabel(o.status))}</span>${o.printed_at ? `<div class="muted" style="font-size:12px">${esc(fmtDate(o.printed_at))}</div>` : ''}</td>
        <td style="white-space:nowrap">
          <button class="btn sm pick" data-id="${o.id}">Pick list</button>
          <button class="btn sm primary print" data-id="${o.id}" ${o.has_label ? '' : 'disabled title="Client has not uploaded a label yet"'}>${o.status === 'printed' ? 'Reprint' : 'Print label'}</button>
        </td>
      </tr>`; }).join('')}</tbody></table></div>`;
    $$('.pick', el).forEach((b) => b.addEventListener('click', () => openPick(b.dataset.id)));
    $$('.print', el).forEach((b) => b.addEventListener('click', () => printLabel(b.dataset.id)));
  }

  // Print flow: open the label in a print tab, mark the order printed, notify the client.
  async function printLabel(id) {
    const o = orders.find((x) => x.id === id);
    if (!o || !o.has_label) { toast('No label on file for this order.'); return; }
    const w = window.open(`/api/wh/orders/${id}/label?pass=${encodeURIComponent(pass)}`, '_blank');
    if (w) { try { w.addEventListener('load', () => setTimeout(() => w.print(), 400)); } catch { /* cross-origin pdf viewers ignore this; user prints from the tab */ } }
    try {
      await api(`/api/wh/orders/${id}/print`, { method: 'POST', headers: H() });
      toast(`Order ${o.order_number} marked printed — client notified.`);
      loadOrders();
    } catch (err) { toast(err.message); }
  }

  function openPick(id) {
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    const m = $('#modal');
    m.innerHTML = `
      <div class="row" style="justify-content:space-between">
        <div><h2 style="margin:0">Pick list · ${esc(o.order_number)}</h2><div class="muted">${esc(o.client_name)} → ${esc(o.ship_to || 'no address')}</div></div>
        <button class="btn sm" id="closeM">Close</button>
      </div>
      <hr class="sep">
      <div class="stack">${o.items.map((it) => `
        <div class="pick-item">
          ${thumb(it.image, it.name, 'lg')}
          <div style="flex:1;min-width:0">
            <h3 style="margin:0">${esc(it.name)}</h3>
            <div class="muted" style="font-size:13px">${esc(it.sku || 'no SKU')}${it.type ? ` · ${esc(it.type)}` : ''}</div>
            ${it.description ? `<div style="font-size:13px;margin-top:2px">${esc(it.description)}</div>` : ''}
            <div style="margin-top:6px">${it.location ? `📍 <span class="loc">${esc(it.location)}</span>` : '<span class="muted">No location set</span>'}
              ${it.product_id ? `<button class="btn sm setloc" data-pid="${it.product_id}" data-cur="${esc(it.location || '')}" style="margin-left:8px">Set location</button>` : ''}</div>
          </div>
          <div class="qty" title="Quantity to pick">×${it.quantity}</div>
        </div>`).join('')}
      </div>
      <hr class="sep">
      <div class="row" style="justify-content:flex-end">
        ${o.has_label ? `<a class="btn" target="_blank" href="/api/wh/orders/${o.id}/label?pass=${encodeURIComponent(pass)}">View label</a>` : '<span class="muted">Waiting for client to upload a label</span>'}
        <button class="btn primary" id="printM" ${o.has_label ? '' : 'disabled'}>Print label &amp; notify client</button>
      </div>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    $('#printM').onclick = () => { closeModal(); printLabel(o.id); };
    $$('.setloc', m).forEach((b) => b.addEventListener('click', async () => {
      const loc = prompt('Garage location for this product (e.g. Shelf A2):', b.dataset.cur || '');
      if (loc === null) return;
      try { await api(`/api/wh/products/${b.dataset.pid}`, { method: 'PATCH', headers: H(), body: { location: loc } }); toast('Location saved.'); await loadOrders(); openPick(id); }
      catch (err) { toast(err.message); }
    }));
  }
  function closeModal() { $('#modalBg').classList.remove('open'); }
  $('#modalBg').addEventListener('click', (e) => { if (e.target.id === 'modalBg') closeModal(); });

  // ---------- clients ----------
  async function loadClients() {
    let clients;
    try { clients = await api('/api/wh/clients', { headers: H() }); } catch (err) { toast(err.message); return; }
    const el = $('#clients');
    if (!clients.length) { el.innerHTML = '<div class="empty">No clients yet.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Access code</th><th>Orders</th></tr></thead><tbody>${clients.map((c) => `
      <tr><td><strong>${esc(c.name)}</strong>${c.email ? `<div class="muted" style="font-size:12px">${esc(c.email)}</div>` : ''}</td>
      <td><span class="kbd">${esc(c.code)}</span></td><td>${c.orders}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="font-size:13px;margin-bottom:0">Give each client their access code; they sign in at <span class="kbd">/client.html</span>.</p>`;
  }
  $('#clientForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const c = await api('/api/wh/clients', { method: 'POST', headers: H(), body: { name: $('#cName').value, email: $('#cEmail').value } });
      toast(`Client created. Access code: ${c.code}`, 6000);
      $('#cName').value = ''; $('#cEmail').value = '';
      loadClients();
    } catch (err) { toast(err.message); }
  });

  // ---------- boot ----------
  if (pass) {
    api('/api/auth/warehouse', { method: 'POST', body: { passcode: pass } }).then(enter).catch(() => { localStorage.removeItem(KEY); pass = ''; });
  }
})();
