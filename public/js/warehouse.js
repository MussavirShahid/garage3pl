(() => {
  const { $, $$, esc, toast, api, busy, fieldError, skeleton, icon, mosaic, fmtDate, statusLabel, thumb, localDay, lightbox } = G;
  let orders = [];

  // ---------- auth (session cookie set by the server; nothing stored in the browser) ----------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = $('#pass').value;
    await busy(e.submitter, async () => {
      try {
        await api('/api/auth/warehouse', { method: 'POST', body: { passcode: p } });
        $('#pass').value = '';
        enter();
      } catch (err) { fieldError($('#pass'), err.message); }
    });
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* cookie is cleared either way */ }
    location.reload();
  });

  function enter() {
    $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
    loadTypes(); loadOrders(); loadClients(); loadInventory();
    setInterval(loadOrders, 20000);
  }

  // ---------- tabs ----------
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    for (const id of ['orders', 'inventory', 'clients']) $('#tab-' + id).hidden = id !== t.dataset.tab;
    if (t.dataset.tab === 'inventory') loadInventory();
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
    try { orders = await api(`/api/wh/orders?${queryString()}`); }
    catch (err) { toast(err.message); return; }
    renderOrders();
  }

  async function loadTypes() {
    try {
      const types = await api('/api/wh/product-types');
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
          <button class="btn gold print" type="button" data-id="${o.id}" ${o.awaiting_delivery ? 'disabled title="Waiting for the inventory to be received"' : o.has_label ? '' : 'disabled title="Client has not uploaded a label yet"'}>${icon('print')} ${o.status === 'printed' ? 'Reprint' : 'Print label'}</button>
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
    if (o.awaiting_delivery) { toast('This order is waiting for its inventory to be received. Mark the delivery received on the Inventory tab first.', 6000); return; }
    const w = window.open(`/api/wh/orders/${id}/print-label`, '_blank');
    if (w) { try { w.addEventListener('load', () => setTimeout(() => w.print(), 400)); } catch { /* pdf viewers ignore this; user prints from the tab */ } }
    try {
      await api(`/api/wh/orders/${id}/print`, { method: 'POST' });
      toast(`Order ${o.order_number} marked printed — client notified.`);
      loadOrders(); loadInventory(); // printing deducts stock
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
      ${o.awaiting_delivery ? `<p class="small" style="margin:0 0 8px"><span class="status awaiting_delivery">Awaiting delivery</span> <span class="muted">This order needs inventory that has not been received yet. Mark the delivery received on the Inventory tab and it will become printable.</span></p>` : ''}
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
        ${o.has_label ? `<a class="btn" target="_blank" rel="noopener" href="/api/wh/orders/${o.id}/print-label">${icon('file')} View label</a>` : '<span class="muted">Waiting for client to upload a label</span>'}
        <button class="btn gold" id="printM" type="button" ${o.has_label && !o.awaiting_delivery ? '' : 'disabled'}>${icon('print')} Print label &amp; notify client</button>
      </div>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    $('#printM').onclick = () => { closeModal(); printLabel(o.id); };
    $$('.zoom', m).forEach((b) => b.addEventListener('click', () => lightbox(o.items, Number(b.dataset.i) || 0, b)));
    $$('.picked', m).forEach((cb) => cb.addEventListener('change', () => cb.closest('.pick-item').classList.toggle('done', cb.checked)));
    $$('.setloc', m).forEach((b) => b.addEventListener('click', async () => {
      const loc = prompt('Garage location for this product (e.g. Shelf A2):', b.dataset.cur || '');
      if (loc === null) return;
      try { await api(`/api/wh/products/${b.dataset.pid}`, { method: 'PATCH', body: { location: loc } }); toast('Location saved.'); await loadOrders(); openPick(id); }
      catch (err) { toast(err.message); }
    }));
  }
  function closeModal() { $('#modalBg').classList.remove('open'); }
  $('#modalBg').addEventListener('click', (e) => { if (e.target.id === 'modalBg') closeModal(); });

  // ---------- clients ----------
  async function loadClients() {
    let clients;
    try { clients = await api('/api/wh/clients'); } catch (err) { toast(err.message); return; }
    // keep the queue's client filter, and the inventory tab's client selects, in sync
    const opts = clients.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    for (const [id, first] of [['clientFilter', '<option value="">All clients</option>'], ['ivFilterClient', '<option value="">All clients</option>'], ['ivClient', '']]) {
      const sel = $('#' + id); const cur = sel.value;
      sel.innerHTML = first + opts;
      if (clients.some((c) => c.id === cur)) sel.value = cur;
    }
    fillIvProducts();
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
        const r = await busy(b, () => api(`/api/wh/clients/${b.dataset.id}`, { method: 'DELETE' }));
        toast(`Deleted ${b.dataset.name} (${r.removed.orders} orders, ${r.removed.products} products).`, 6000);
        loadClients(); loadTypes(); loadOrders(); loadInventory();
      } catch (err) { toast(err.message, 6000); }
    }));
  }
  $('#clientForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      try {
        const c = await api('/api/wh/clients', { method: 'POST', body: { name: $('#cName').value, email: $('#cEmail').value } });
        toast(`Client created. Access code: ${c.code}`, 8000);
        $('#cName').value = ''; $('#cEmail').value = '';
        loadClients();
      } catch (err) { fieldError($('#cName'), err.message); }
    });
  });

  // ---------- warehouse passcode ----------
  $('#passForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const current = $('#pCurrent').value, next = $('#pNew').value, again = $('#pAgain').value;
    if (next !== again) { fieldError($('#pAgain'), 'The two new passcodes do not match.'); return; }
    busy(e.submitter, async () => {
      try {
        await api('/api/wh/passcode', { method: 'POST', body: { current, next } });
        toast('Passcode changed. Other signed-in warehouse devices have been signed out.', 7000);
        $('#pCurrent').value = ''; $('#pNew').value = ''; $('#pAgain').value = '';
      } catch (err) { fieldError(err.status === 401 ? $('#pCurrent') : $('#pNew'), err.message); }
    });
  });

  // ---------- inventory ----------
  let inv = { stock: [], inbound: [] };
  async function loadInventory() {
    try { inv = await api('/api/wh/inventory'); } catch (err) { toast(err.message); return; }
    renderInventory();
  }
  // The add form's product list follows the chosen client.
  function fillIvProducts() {
    const cid = $('#ivClient').value; const sel = $('#ivProd'); const cur = sel.value;
    const prods = inv.stock.filter((s) => s.client_id === cid);
    sel.innerHTML = prods.length
      ? prods.map((s) => `<option value="${s.product_id}">${esc(s.name)}${s.sku ? ` (${esc(s.sku)})` : ''} — ${s.available} available</option>`).join('')
      : '<option value="">This client has no products yet</option>';
    if (prods.some((s) => s.product_id === cur)) sel.value = cur;
  }
  function renderInventory() {
    fillIvProducts();
    const fc = $('#ivFilterClient').value;
    const stock = inv.stock.filter((s) => !fc || s.client_id === fc);
    const inbound = inv.inbound.filter((r) => !fc || r.client_id === fc);

    const st = $('#whStock');
    st.innerHTML = stock.length
      ? `<div class="table-wrap stock-table"><table><thead><tr><th>Client</th><th>Product</th><th class="num">On hand</th><th class="num">Ordered</th><th class="num">Reserved</th><th class="num">Available</th></tr></thead><tbody>${stock.map((s) => `
        <tr><td>${esc(s.client_name)}</td><td><strong>${esc(s.name)}</strong><div class="cell-sub">${esc(s.sku || 'no SKU')}</div></td><td class="num">${s.stock}</td><td class="num">${s.incoming}</td><td class="num">${s.committed}</td><td class="num"><strong class="${s.available > 0 ? 'ok-text' : 'danger-text'}">${s.available}</strong></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${icon('box')}<strong>No products</strong><span>Stock appears here once clients add products.</span></div>`;

    const el = $('#whInbound');
    if (!inbound.length) { el.innerHTML = `<div class="empty">${icon('calendar')}<strong>No incoming inventory</strong><span>Clients log deliveries from their portal, or add one on the left.</span></div>`; return; }
    el.innerHTML = `<div class="stack">${inbound.map((r) => `
      <div class="client-row">
        <div class="grow"><strong>${esc(r.product_name)}</strong> <span class="muted">×${r.quantity}</span><div class="cell-sub">${esc(r.client_name)}${r.sku ? ` · ${esc(r.sku)}` : ''}${r.tracking_id ? ` · Tracking ${esc(r.tracking_id)}` : ''}</div></div>
        <div class="meta"><span class="muted small">Expected</span> <strong>${r.expected_at ? esc(r.expected_at) : '—'}</strong></div>
        <span class="status ${esc(r.status)}">${r.status === 'received' ? `Received ${esc(fmtDate(r.received_at))}${r.received_quantity !== r.quantity ? ` (×${r.received_quantity})` : ''}` : 'Expected'}</span>
        ${r.status === 'expected' ? `<button class="btn gold sm recvIn" type="button" data-id="${r.id}" data-qty="${r.quantity}" data-name="${esc(r.product_name)}">${icon('check')} Mark received</button>` : ''}
      </div>`).join('')}</div>`;
    $$('.recvIn', el).forEach((b) => b.addEventListener('click', async () => {
      const q = prompt(`Quantity received for ${b.dataset.name} (expected ${b.dataset.qty}):`, b.dataset.qty);
      if (q === null) return;
      try {
        await busy(b, () => api(`/api/wh/inbound/${b.dataset.id}/receive`, { method: 'POST', body: { quantity: q } }));
        toast('Received — stock updated and the client has been notified.');
        loadInventory();
      } catch (err) { toast(err.message, 6000); }
    }));
  }
  $('#ivClient').addEventListener('change', fillIvProducts);
  $('#ivFilterClient').addEventListener('change', renderInventory);
  $('#ivForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const received = $('#ivRecv').checked;
    busy(e.submitter, async () => { try {
      await api('/api/wh/inbound', { method: 'POST', body: { client_id: $('#ivClient').value, product_id: $('#ivProd').value, quantity: $('#ivQty').value, expected_at: $('#ivDate').value, tracking_id: $('#ivTrack').value, received } });
      toast(received ? 'Inventory added to stock and the client has been notified.' : 'Incoming inventory logged.');
      $('#ivQty').value = ''; $('#ivDate').value = ''; $('#ivTrack').value = ''; $('#ivRecv').checked = false;
      loadInventory();
    } catch (err) { fieldError($('#ivQty'), err.message); } });
  });

  // ---------- boot: a valid session cookie signs in straight away ----------
  api('/api/wh/me').then(enter).catch(() => { /* not signed in: the login card is already showing */ });
})();
