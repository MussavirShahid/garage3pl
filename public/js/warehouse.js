(() => {
  const { $, $$, esc, toast, api, busy, fieldError, skeleton, icon, mosaic, fmtDate, statusLabel, thumb, localDay, lightbox } = G;
  const KEY = 'g3_wh_pass';
  let pass = localStorage.getItem(KEY) || '';
  let orders = [];
  const H = () => ({ 'x-wh-pass': pass });

  // ---------- auth ----------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = $('#pass').value;
    await busy(e.submitter, async () => {
      try {
        await api('/api/auth/warehouse', { method: 'POST', body: { passcode: p } });
        pass = p; localStorage.setItem(KEY, pass); enter();
      } catch (err) { fieldError($('#pass'), err.message); }
    });
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

  // ---------- orders: filters (same segmented controls as the client portal) ----------
  let status = 'label_ready'; // label_ready | new | printed | all
  let dateRange = 'all';      // all | today | yesterday | range
  $$('.segbtn[data-status]').forEach((b) => b.addEventListener('click', () => {
    status = b.dataset.status;
    $$('.segbtn[data-status]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
    loadOrders();
  }));
  $$('.segbtn[data-range]').forEach((b) => b.addEventListener('click', () => {
    dateRange = b.dataset.range;
    $$('.segbtn[data-range]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
    $('#rangeInputs').hidden = dateRange !== 'range';
    loadOrders();
  }));
  for (const id of ['clientFilter', 'typeFilter', 'fromDate', 'toDate', 'sortOrder']) $('#' + id).addEventListener('change', loadOrders);
  $('#refresh').addEventListener('click', () => { loadTypes(); loadOrders(); });

  // The server filters on the local calendar day, so Today/Yesterday become a one-day from/to.
  function dateBounds() {
    if (dateRange === 'today') { const d = localDay(new Date()); return { from: d, to: d }; }
    if (dateRange === 'yesterday') { const y = new Date(); y.setDate(y.getDate() - 1); const d = localDay(y); return { from: d, to: d }; }
    if (dateRange === 'range') return { from: $('#fromDate').value, to: $('#toDate').value };
    return {};
  }

  function queryString() {
    const q = new URLSearchParams();
    q.set('status', status);
    q.set('sort', $('#sortOrder').value);
    if ($('#typeFilter').value) q.set('type', $('#typeFilter').value);
    if ($('#clientFilter').value) q.set('client', $('#clientFilter').value);
    const { from, to } = dateBounds();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    return q.toString();
  }

  async function loadOrders() {
    if (!orders.length) $('#orders').innerHTML = skeleton(3);
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
    if (!orders.length) { el.innerHTML = `<div class="empty">${icon('box')}<strong>Nothing in this queue</strong><span>Try another status or clear the filters. New orders appear here as clients add them.</span></div>`; return; }
    el.innerHTML = `<div class="grid cols-4 order-grid">${orders.map((o) => {
      const units = o.items.reduce((s, it) => s + it.quantity, 0);
      return `
      <article class="order-card" aria-label="Order ${esc(o.order_number)} for ${esc(o.client_name)}">
        <button type="button" class="order-visual card zoomOrder" data-id="${o.id}" aria-label="Enlarge photos for order ${esc(o.order_number)}">${mosaic(o.items)}<span class="zoom-hint" aria-hidden="true">${icon('search')}</span></button>
        <div class="order-status"><span class="status ${esc(o.status)}">${esc(statusLabel(o.status))}</span></div>
        <h3 class="order-title" title="${esc(o.order_number)}">${esc(o.order_number)}</h3>
        <p class="order-sub">${esc(o.client_name)}</p>
        <p class="order-fine">${o.items.length} line${o.items.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}<br>${o.ship_to ? esc(o.ship_to) : 'No ship-to address'}<br>${esc(fmtDate(o.created_at))}${o.printed_at ? `<br>Printed ${esc(fmtDate(o.printed_at))}` : ''}</p>
        <div class="order-actions">
          <button class="btn gold print" type="button" data-id="${o.id}" ${o.has_label ? '' : 'disabled title="Client has not uploaded a label yet"'}>${icon('print')} ${o.status === 'printed' ? 'Reprint' : 'Print label'}</button>
          <button class="link pick" type="button" data-id="${o.id}">Pick list</button>
        </div>
      </article>`; }).join('')}</div>`;
    $$('.pick', el).forEach((b) => b.addEventListener('click', () => openPick(b.dataset.id)));
    $$('.print', el).forEach((b) => b.addEventListener('click', () => busy(b, () => printLabel(b.dataset.id))));
    wireZoom(el);
  }

  // Clicking an order's photo panel opens the lightbox on the photo that was clicked.
  function wireZoom(root) {
    $$('.zoomOrder', root).forEach((b) => b.addEventListener('click', (e) => {
      const o = orders.find((x) => x.id === b.dataset.id);
      if (!o) return;
      const cell = e.target.closest('.mimg');
      const idx = cell ? Array.prototype.indexOf.call(cell.parentElement.children, cell) : 0;
      lightbox(o.items, Math.max(0, idx), b);
    }));
  }

  // Print flow: open the label in a print tab, mark the order printed, notify the client.
  async function printLabel(id) {
    const o = orders.find((x) => x.id === id);
    if (!o || !o.has_label) { toast('No label on file for this order.'); return; }
    const w = window.open(`/api/wh/orders/${id}/print-label?pass=${encodeURIComponent(pass)}`, '_blank');
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
        <div><h2 style="margin:0">Pick list · ${esc(o.order_number)}</h2><div class="muted">${esc(o.client_name)} ${icon('arrow')} ${esc(o.ship_to || 'no address')}</div></div>
        <button class="btn sm icon-btn" id="closeM" type="button" aria-label="Close">${icon('x')}</button>
      </div>
      <hr class="sep">
      <p class="muted small" style="margin:0 0 4px">Tick each line as you pick it.</p>
      <div class="stack">${o.items.map((it, i) => `
        <div class="pick-item">
          <label class="pick-check"><input type="checkbox" class="picked" aria-label="Picked: ${esc(it.name)}"></label>
          <button type="button" class="zoom" data-i="${i}" aria-label="Enlarge photo of ${esc(it.name)}">${thumb(it.image, it.name, 'lg')}</button>
          <div style="flex:1;min-width:0">
            <h3 style="margin:0">${esc(it.name)}</h3>
            <div class="muted" style="font-size:13px">${esc(it.sku || 'no SKU')}${it.type ? ` · ${esc(it.type)}` : ''}</div>
            ${it.description ? `<div style="font-size:13px;margin-top:2px">${esc(it.description)}</div>` : ''}
            <div style="margin-top:6px">${it.location ? `<span class="loc">${icon('pin')} ${esc(it.location)}</span>` : '<span class="muted">No location set</span>'}
              ${it.product_id ? `<button class="btn sm setloc" data-pid="${it.product_id}" data-cur="${esc(it.location || '')}" style="margin-left:8px">Set location</button>` : ''}</div>
          </div>
          <div class="qty" title="Quantity to pick">×${it.quantity}</div>
        </div>`).join('')}
      </div>
      <hr class="sep">
      <div class="row" style="justify-content:flex-end">
        ${o.has_label ? `<a class="btn" target="_blank" href="/api/wh/orders/${o.id}/print-label?pass=${encodeURIComponent(pass)}">${icon('file')} View label</a>` : '<span class="muted">Waiting for client to upload a label</span>'}
        <button class="btn gold" id="printM" type="button" ${o.has_label ? '' : 'disabled'}>${icon('print')} Print label &amp; notify client</button>
      </div>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    $('#printM').onclick = () => { closeModal(); printLabel(o.id); };
    $$('.zoom', m).forEach((b) => b.addEventListener('click', () => lightbox(o.items, Number(b.dataset.i) || 0, b)));
    $$('.picked', m).forEach((cb) => cb.addEventListener('change', () => cb.closest('.pick-item').classList.toggle('done', cb.checked)));
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
    // keep the queue's client filter in sync
    const sel = $('#clientFilter'); const cur = sel.value;
    sel.innerHTML = '<option value="">All clients</option>' + clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    if (clients.some((c) => c.id === cur)) sel.value = cur;
    const el = $('#clients');
    if (!clients.length) { el.innerHTML = `<div class="empty">${icon('user')}<strong>No clients yet</strong><span>Create one on the left and share the access code.</span></div>`; return; }
    el.innerHTML = `<div class="client-list">${clients.map((c) => `
      <div class="client-row">
        <div class="grow"><strong>${esc(c.name)}</strong>${c.email ? `<div class="cell-sub">${esc(c.email)}</div>` : ''}</div>
        <div class="meta"><span class="muted small">Code</span> <span class="kbd">${esc(c.code)}</span></div>
        <div class="meta"><span class="muted small">Orders</span> <strong>${c.orders}</strong></div>
        <button class="btn sm danger delClient" type="button" data-id="${esc(c.id)}" data-name="${esc(c.name)}" data-orders="${c.orders}">${icon('trash')} Delete</button>
      </div>`).join('')}</div>
      <p class="muted small" style="margin:12px 0 0">Give each client their access code; they sign in at <span class="kbd">/client.html</span>. Deleting a client removes all of their orders, products, labels and photos.</p>`;
    $$('.delClient', el).forEach((b) => b.addEventListener('click', async () => {
      const typed = prompt(`Delete client "${b.dataset.name}" and all ${b.dataset.orders} of their orders, products and labels? This cannot be undone.\n\nType the client name to confirm:`);
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== b.dataset.name.trim().toLowerCase()) { toast('Name did not match. Nothing was deleted.', 5000); return; }
      try {
        const r = await busy(b, () => api(`/api/wh/clients/${b.dataset.id}`, { method: 'DELETE', headers: H() }));
        toast(`Deleted ${b.dataset.name} (${r.removed.orders} orders, ${r.removed.products} products).`, 6000);
        loadClients(); loadTypes(); loadOrders();
      } catch (err) { toast(err.message, 6000); }
    }));
  }
  $('#clientForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      try {
        const c = await api('/api/wh/clients', { method: 'POST', headers: H(), body: { name: $('#cName').value, email: $('#cEmail').value } });
        toast(`Client created. Access code: ${c.code}`, 6000);
        $('#cName').value = ''; $('#cEmail').value = '';
        loadClients();
      } catch (err) { fieldError($('#cName'), err.message); }
    });
  });

  // ---------- boot ----------
  if (pass) {
    api('/api/auth/warehouse', { method: 'POST', body: { passcode: pass } }).then(enter).catch(() => { localStorage.removeItem(KEY); pass = ''; });
  }
})();
