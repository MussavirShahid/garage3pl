(() => {
  const { $, $$, esc, toast, api, busy, fieldError, skeleton, icon, mosaic, fmtDate, statusLabel, thumb, localDay, lightbox } = G;
  let orders = [], products = [], notifs = [];
  let dateRange = 'all'; // all | today | yesterday | range

  // ---------- auth (session cookie set by the server; nothing stored in the browser) ----------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = $('#code').value.trim().toUpperCase();
    await busy(e.submitter, async () => {
      try {
        const r = await api('/api/auth/client', { method: 'POST', body: { code: c } });
        $('#who').textContent = r.client.name;
        enter();
      } catch (err) { fieldError($('#code'), err.message); }
    });
  });
  $('#logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* cookie is cleared either way */ }
    location.reload();
  });

  async function enter() {
    $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
    await refreshAll();
    setInterval(loadNotifs, 15000); // poll for "printed" and "received" notifications
  }

  // ---------- tabs ----------
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    for (const id of ['orders', 'products', 'inventory', 'notifs']) $('#tab-' + id).hidden = id !== t.dataset.tab;
    if (t.dataset.tab === 'notifs') markRead();
    if (t.dataset.tab === 'inventory') loadInventory();
  }));

  async function refreshAll() {
    await Promise.all([loadOrders(), loadProducts(), loadInventory(), loadNotifs()]);
  }

  // ---------- orders: date filter ----------
  function filterByDate(list) {
    const today = localDay(new Date());
    const y = new Date(); y.setDate(y.getDate() - 1); const yesterday = localDay(y);
    if (dateRange === 'today') return list.filter((o) => localDay(o.created_at) === today);
    if (dateRange === 'yesterday') return list.filter((o) => localDay(o.created_at) === yesterday);
    if (dateRange === 'range') {
      const from = $('#oFrom').value, to = $('#oTo').value;
      return list.filter((o) => { const d = localDay(o.created_at); return (!from || d >= from) && (!to || d <= to); });
    }
    return list;
  }
  $$('.segbtn[data-range]').forEach((b) => b.addEventListener('click', () => {
    dateRange = b.dataset.range;
    $$('.segbtn[data-range]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', x === b); });
    $('#rangeInputs').hidden = dateRange !== 'range';
    renderOrders();
  }));
  $('#oFrom').addEventListener('change', renderOrders);
  $('#oTo').addEventListener('change', renderOrders);
  const canDelete = (o) => o.status === 'new' || o.status === 'label_ready';

  // ---------- orders ----------
  async function loadOrders() {
    if (!orders.length) $('#orders').innerHTML = skeleton(3);
    try { orders = await api('/api/client/orders'); } catch (err) { toast(err.message); return; }
    renderOrders();
  }
  function renderOrders() {
    const el = $('#orders');
    if (!orders.length) { el.innerHTML = `<div class="empty">${icon('box')}<strong>No orders yet</strong><span>Create one with the button above.</span><button class="btn primary sm" type="button" id="emptyNewOrder">${icon('plus')} Create order</button></div>`; const b = $('#emptyNewOrder'); if (b) b.onclick = openNewOrder; return; }
    const list = filterByDate(orders);
    if (!list.length) { el.innerHTML = `<div class="empty">${icon('calendar')}<strong>No orders in this period</strong><span>Try another date, or choose All.</span></div>`; return; }
    el.innerHTML = `<div class="grid cols-4 order-grid">${list.map((o) => {
      const units = o.items.reduce((s, it) => s + it.quantity, 0);
      return `
      <article class="order-card" aria-label="Order ${esc(o.order_number)}">
        <button type="button" class="order-visual card zoomOrder" data-id="${o.id}" aria-label="Enlarge photos for order ${esc(o.order_number)}">${mosaic(o.items)}<span class="zoom-hint" aria-hidden="true">${icon('search')}</span></button>
        <div class="order-status"><span class="status ${esc(o.status)}">${esc(statusLabel(o.status))}</span></div>
        <h3 class="order-title" title="${esc(o.order_number)}">${esc(o.order_number)}</h3>
        <p class="order-sub">${o.items.length} item${o.items.length === 1 ? '' : 's'} · ${units} unit${units === 1 ? '' : 's'}</p>
        <p class="order-fine">${o.ship_to ? esc(o.ship_to) : 'No ship-to address yet'}<br>${esc(fmtDate(o.created_at))}${o.printed_at ? `<br>Printed ${esc(fmtDate(o.printed_at))}` : ''}</p>
        <div class="order-actions">
          <label class="btn ${o.has_label ? '' : 'primary'}" style="margin:0;display:inline-flex">${icon('upload')} ${o.has_label ? 'Replace label' : 'Upload label'}<input type="file" accept=".pdf,image/*" hidden data-order="${o.id}" class="labelInput"></label>
          ${o.has_label ? `<a class="link" target="_blank" rel="noopener" href="/api/client/orders/${o.id}/label">View label</a>` : ''}
          ${canDelete(o) ? `<button class="link danger delOrder" type="button" data-id="${o.id}" data-num="${esc(o.order_number)}" aria-label="Delete order ${esc(o.order_number)}">Delete</button>` : ''}
        </div>
      </article>`; }).join('')}</div>`;
    // Clicking an order's photo panel opens the lightbox on the photo that was clicked.
    $$('.zoomOrder', el).forEach((b) => b.addEventListener('click', (e) => {
      const o = orders.find((x) => x.id === b.dataset.id);
      if (!o) return;
      const cell = e.target.closest('.mimg');
      const idx = cell ? Array.prototype.indexOf.call(cell.parentElement.children, cell) : 0;
      lightbox(o.items, Math.max(0, idx), b);
    }));
    $$('.delOrder', el).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(`Delete order ${b.dataset.num}? This removes its items and label and cannot be undone.`)) return;
      try { await busy(b, () => api(`/api/client/orders/${b.dataset.id}`, { method: 'DELETE' })); toast(`Order ${b.dataset.num} deleted.`); orders = orders.filter((o) => o.id !== b.dataset.id); renderOrders(); loadProducts(); loadInventory(); }
      catch (err) { toast(err.message, 6000); loadOrders(); }
    }));
    $$('.labelInput', el).forEach((inp) => inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      const form = new FormData(); form.append('label', inp.files[0]);
      try {
        await api(`/api/client/orders/${inp.dataset.order}/label`, { method: 'POST', form });
        toast('Shipping label uploaded.'); loadOrders();
      } catch (err) { toast(err.message, 6000); }
    }));
  }

  // ---------- products ----------
  async function loadProducts() {
    if (!products.length) $('#products').innerHTML = '<div style="grid-column:1/-1">' + skeleton(2) + '</div>';
    try { products = await api('/api/client/products'); } catch (err) { toast(err.message); return; }
    renderProducts();
    renderOrders();
  }
  $('#prodSearch').addEventListener('input', renderProducts);
  function renderProducts() {
    const q = $('#prodSearch').value.trim().toLowerCase();
    const list = products.filter((p) => !q || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(q));
    const el = $('#products');
    if (!list.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1">${icon('image')}<strong>${q ? 'No products match your search' : 'No products yet'}</strong><span>${q ? 'Try a different name or SKU.' : 'Add one with the button above.'}</span></div>`; return; }
    el.innerHTML = list.map((p) => `
      <div class="card tile" style="cursor:pointer" data-id="${p.id}">
        ${thumb(p.image, p.name, 'lg')}
        <div style="min-width:0">
          <h3 style="margin:0">${esc(p.name)}</h3>
          <div class="muted" style="font-size:13px">${esc(p.sku || 'no SKU')}${p.type ? ` · ${esc(p.type)}` : ''}</div>
          <div class="small" style="margin-top:4px"><strong class="${p.available > 0 ? 'ok-text' : 'danger-text'}">${p.available ?? 0} available</strong> <span class="muted">· ${p.stock ?? 0} on hand</span></div>
          <div class="small" style="margin-top:4px">${p.location ? `<span class="loc">${icon('pin')} ${esc(p.location)}</span>` : '<span class="muted">No location set</span>'}</div>
        </div>
      </div>`).join('');
    $$('.tile', el).forEach((t) => t.addEventListener('click', () => openProduct(t.dataset.id)));
  }

  // ---------- inventory ----------
  let inv = { products: [], inbound: [] };
  async function loadInventory() {
    try { inv = await api('/api/client/inventory'); } catch (err) { toast(err.message); return; }
    renderInventory();
  }
  function renderInventory() {
    const sel = $('#inProd'); const cur = sel.value;
    sel.innerHTML = inv.products.length
      ? inv.products.map((p) => `<option value="${p.id}">${esc(p.name)}${p.sku ? ` (${esc(p.sku)})` : ''}</option>`).join('')
      : '<option value="">Add a product first (Products tab)</option>';
    if (inv.products.some((p) => p.id === cur)) sel.value = cur;

    const st = $('#stock');
    if (!inv.products.length) st.innerHTML = `<div class="empty">${icon('box')}<strong>No products yet</strong><span>Add products on the Products tab, then log incoming inventory here.</span></div>`;
    else st.innerHTML = `<div class="table-wrap stock-table"><table><thead><tr><th>Product</th><th class="num">On hand</th><th class="num">Reserved</th><th class="num">Available</th></tr></thead><tbody>${inv.products.map((p) => `
      <tr><td><div class="row" style="gap:10px;flex-wrap:nowrap">${thumb(p.image, p.name)}<div style="min-width:0"><strong>${esc(p.name)}</strong><div class="cell-sub">${esc(p.sku || 'no SKU')}</div></div></div></td><td class="num">${p.stock}</td><td class="num">${p.committed}</td><td class="num"><strong class="${p.available > 0 ? 'ok-text' : 'danger-text'}">${p.available}</strong></td></tr>`).join('')}</tbody></table></div>`;

    const el = $('#inbound');
    if (!inv.inbound.length) { el.innerHTML = `<div class="empty">${icon('calendar')}<strong>No incoming inventory</strong><span>Log a delivery above with its expected date and tracking ID. The warehouse marks it received and your stock goes up.</span></div>`; return; }
    el.innerHTML = `<div class="stack">${inv.inbound.map((r) => `
      <div class="client-row">
        <div class="grow"><strong>${esc(r.product_name)}</strong> <span class="muted">×${r.quantity}</span><div class="cell-sub">${esc(r.sku || '')}${r.tracking_id ? ` · Tracking ${esc(r.tracking_id)}` : ''}${r.created_by === 'warehouse' ? ' · added by warehouse' : ''}</div></div>
        <div class="meta"><span class="muted small">Expected</span> <strong>${r.expected_at ? esc(r.expected_at) : '—'}</strong></div>
        <span class="status ${esc(r.status)}">${r.status === 'received' ? `Received ${esc(fmtDate(r.received_at))}${r.received_quantity !== r.quantity ? ` (×${r.received_quantity})` : ''}` : 'Expected'}</span>
        ${r.status === 'expected' ? `<button class="btn sm danger cancelIn" type="button" data-id="${r.id}">Cancel</button>` : ''}
      </div>`).join('')}</div>`;
    $$('.cancelIn', el).forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Cancel this incoming delivery?')) return;
      try { await busy(b, () => api(`/api/client/inbound/${b.dataset.id}`, { method: 'DELETE' })); toast('Delivery cancelled.'); loadInventory(); }
      catch (err) { toast(err.message, 6000); }
    }));
  }
  $('#inForm').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter, async () => { try {
      await api('/api/client/inbound', { method: 'POST', body: { product_id: $('#inProd').value, quantity: $('#inQty').value, expected_at: $('#inDate').value, tracking_id: $('#inTrack').value } });
      toast('Incoming inventory logged. The warehouse will mark it received.');
      $('#inQty').value = ''; $('#inDate').value = ''; $('#inTrack').value = '';
      loadInventory();
    } catch (err) { fieldError($('#inQty'), err.message); } });
  });

  function openProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const m = $('#modal');
    m.innerHTML = `
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(p.name)}</h2><button class="btn sm icon-btn" id="closeM" type="button" aria-label="Close">${icon('x')}</button></div>
      <div class="muted">${esc(p.sku || '')}</div>
      <hr class="sep">
      <div class="tile">
        ${thumb(p.image, p.name, 'lg')}
        <div class="stack" style="flex:1">
          <div class="grid cols-2">
            <div><label>Item type / category</label><input type="text" id="pType" value="${esc(p.type || '')}" placeholder="e.g. Mug, Apparel, Candle"></div>
            <div><label>Garage location</label><input type="text" id="pLoc" value="${esc(p.location || '')}" placeholder="e.g. Shelf A2"></div>
          </div>
          <div><label>Description</label><textarea id="pDesc" rows="2">${esc(p.description || '')}</textarea></div>
          <div><label>Image URL</label><input type="text" id="pImg" value="${esc(p.image || '')}" placeholder="https://…"></div>
          <div class="row">
            <button class="btn primary" id="saveP" type="button">${icon('check')} Save</button>
            <label class="btn" style="margin:0">${icon('upload')} Upload image<input type="file" accept="image/*" hidden id="upImg"></label>
            <button class="btn" id="findImg" type="button">${icon('search')} Find image online</button>
          </div>
        </div>
      </div>
      <div id="imgResults" style="margin-top:14px"></div>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    $('#saveP').onclick = () => busy($('#saveP'), async () => {
      try {
        await api(`/api/client/products/${p.id}`, { method: 'PATCH', body: { location: $('#pLoc').value, description: $('#pDesc').value, image: $('#pImg').value, type: $('#pType').value } });
        toast('Saved.'); closeModal(); loadProducts();
      } catch (err) { toast(err.message); }
    });
    $('#upImg').onchange = async (e) => {
      if (!e.target.files[0]) return;
      const form = new FormData(); form.append('image', e.target.files[0]);
      try { await api(`/api/client/products/${p.id}/image`, { method: 'POST', form }); toast('Image uploaded.'); closeModal(); loadProducts(); }
      catch (err) { toast(err.message, 6000); }
    };
    $('#findImg').onclick = async () => {
      const box = $('#imgResults');
      box.innerHTML = '<span class="muted">Searching the web…</span>';
      try {
        const r = await api(`/api/client/products/${p.id}/find-image`);
        if (!r.results.length) { box.innerHTML = '<span class="muted">No images found. Try uploading one.</span>'; return; }
        box.innerHTML = `<p class="muted" style="margin:0 0 8px">Click a picture to use it for "${esc(r.query)}":</p><div class="imgpick">${r.results.map((x) => `<img src="${esc(x.thumbnail)}" data-url="${esc(x.url)}" title="${esc(x.title)}" alt="" data-fallback="remove">`).join('')}</div>`;
        $$('.imgpick img', box).forEach((img) => img.addEventListener('click', async () => {
          try { await api(`/api/client/products/${p.id}`, { method: 'PATCH', body: { image: img.dataset.url } }); toast('Image set.'); closeModal(); loadProducts(); }
          catch (err) { toast(err.message); }
        }));
      } catch (err) { box.innerHTML = `<span class="muted">${esc(err.message)}</span>`; }
    };
  }
  function closeModal() { $('#modalBg').classList.remove('open'); }
  $('#modalBg').addEventListener('click', (e) => { if (e.target.id === 'modalBg') closeModal(); });

  // ---------- add product by hand ----------
  $('#newProduct').addEventListener('click', openNewProduct);
  function openNewProduct() {
    const m = $('#modal');
    m.innerHTML = `
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Add product</h2><button class="btn sm icon-btn" id="closeM" type="button" aria-label="Close">${icon('x')}</button></div>
      <p class="muted">Upload a photo or paste an image link. Leave both empty and a picture will be looked up for you.</p>
      <form id="npForm" class="stack">
        <div class="grid cols-2">
          <div><label>Product name <span class="req" aria-hidden="true">*</span></label><input type="text" id="npName" required aria-required="true"></div>
          <div><label>SKU</label><input type="text" id="npSku" placeholder="optional, must be unique"></div>
          <div><label>Item type / category</label><input type="text" id="npType" placeholder="e.g. Mug, Apparel, Candle"></div>
        </div>
        <div><label>Description</label><textarea id="npDesc" rows="3"></textarea></div>
        <div class="grid cols-2">
          <div><label>Upload image</label><input type="file" id="npFile" accept="image/*"></div>
          <div><label>…or image URL</label><input type="text" id="npImg" placeholder="https://…"></div>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Add product</button></div>
      </form>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    $('#npForm').onsubmit = (e) => {
      e.preventDefault();
      const file = $('#npFile').files[0];
      const imgUrl = $('#npImg').value.trim();
      busy(e.submitter, async () => { try {
        const p = await api('/api/client/products', { method: 'POST', body: {
          name: $('#npName').value, sku: $('#npSku').value, type: $('#npType').value,
          description: $('#npDesc').value, image: file ? '' : imgUrl,
        } });
        if (file) {
          const form = new FormData(); form.append('image', file);
          await api(`/api/client/products/${p.id}/image`, { method: 'POST', form });
        }
        toast('Product added.'); closeModal(); await loadProducts();
        if (!file && !imgUrl) setTimeout(loadProducts, 12000); // picture lookup runs in the background
      } catch (err) { fieldError($('#npName'), err.message); } });
    };
  }

  // ---------- create order by hand ----------
  $('#newOrder').addEventListener('click', openNewOrder);
  function openNewOrder() {
    if (!products.length) { toast('Add a product first, on the Products tab.'); return; }
    if (!products.some((p) => p.available > 0)) { toast('No inventory available to order yet. Log incoming inventory on the Inventory tab; once the warehouse receives it you can create orders.', 7000); return; }
    const m = $('#modal');
    // Products with nothing available cannot be chosen; the server enforces the same rule.
    const opts = products.map((p) => `<option value="${p.id}" ${p.available > 0 ? '' : 'disabled'}>${esc(p.name)}${p.sku ? ` (${esc(p.sku)})` : ''} — ${p.available} available</option>`).join('');
    const lineRow = () => `<div class="row lineRow"><select class="lineProd" style="flex:1;min-width:200px">${opts}</select><input type="number" class="lineQty" min="1" value="1" style="width:84px" title="Quantity"><button type="button" class="btn sm icon-btn rmLine" aria-label="Remove item">${icon('x')}</button></div>`;
    m.innerHTML = `
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Create order</h2><button class="btn sm icon-btn" id="closeM" type="button" aria-label="Close">${icon('x')}</button></div>
      <form id="noForm" class="stack">
        <div class="grid cols-2">
          <div><label>Order number</label><input type="text" id="noNum" placeholder="leave blank to auto-generate"></div>
          <div><label>Ship to</label><input type="text" id="noShip" placeholder="Name, city, state"></div>
        </div>
        <div><label>Items and quantities</label><div id="noLines" class="stack">${lineRow()}</div><button type="button" class="btn sm" id="addLine" style="margin-top:8px">${icon('plus')} Add another item</button></div>
        <div><label>Shipping label (PDF or image; you can also add it later)</label><input type="file" id="noLabel" accept=".pdf,image/*"></div>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Create order</button></div>
      </form>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    const lines = $('#noLines');
    const wire = () => $$('.rmLine', lines).forEach((b) => { b.onclick = () => { if ($$('.lineRow', lines).length > 1) b.closest('.lineRow').remove(); }; });
    wire();
    $('#addLine').onclick = () => { lines.insertAdjacentHTML('beforeend', lineRow()); wire(); };
    $('#noForm').onsubmit = (e) => {
      e.preventDefault();
      const items = $$('.lineRow', lines).map((r) => ({ product_id: $('.lineProd', r).value, quantity: $('.lineQty', r).value }));
      const label = $('#noLabel').files[0];
      busy(e.submitter, async () => { try {
        const o = await api('/api/client/orders', { method: 'POST', body: { order_number: $('#noNum').value, ship_to: $('#noShip').value, items } });
        if (label) {
          const form = new FormData(); form.append('label', label);
          await api(`/api/client/orders/${o.id}/label`, { method: 'POST', form });
        }
        toast(`Order ${o.order_number} created${label ? ' with its label' : ''}.`); closeModal(); loadOrders(); loadProducts(); loadInventory();
      } catch (err) { fieldError($('#noNum'), err.message); } });
    };
  }

  // ---------- notifications ----------
  async function loadNotifs() {
    const prevUnread = notifs.filter((n) => !n.read).length;
    try { notifs = await api('/api/client/notifications'); } catch { return; }
    const unread = notifs.filter((n) => !n.read).length;
    const b = $('#unread'); b.textContent = unread; b.hidden = unread === 0;
    if (unread > prevUnread && prevUnread !== undefined && notifs.length) toast(notifs[0].message, 5000);
    renderNotifs();
    if (unread > prevUnread) { loadOrders(); loadProducts(); loadInventory(); } // a print or a receipt changed stock
  }
  function renderNotifs() {
    const el = $('#notifs');
    if (!notifs.length) { el.innerHTML = `<div class="empty">${icon('bell')}<strong>No notifications yet</strong><span>You will be told here the moment the warehouse prints one of your orders or receives your inventory.</span></div>`; return; }
    el.innerHTML = notifs.map((n) => `<div class="notif ${n.read ? '' : 'unread'}"><div>${esc(n.message)}</div><time>${esc(fmtDate(n.created_at))}</time></div>`).join('');
  }
  async function markRead() {
    if (!notifs.some((n) => !n.read)) return;
    await api('/api/client/notifications/read', { method: 'POST' });
    loadNotifs();
  }
  $('#markRead').addEventListener('click', markRead);

  // ---------- boot: a valid session cookie signs in straight away ----------
  api('/api/client/me')
    .then((me) => { $('#who').textContent = me.name; enter(); })
    .catch(() => { /* not signed in: the login card is already showing */ });
})();
