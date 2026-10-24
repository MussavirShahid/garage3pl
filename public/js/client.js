(() => {
  const { $, $$, esc, toast, api, fmtDate, statusLabel, thumb } = G;
  const KEY = 'g3_client_code';
  let code = localStorage.getItem(KEY) || '';
  let orders = [], products = [], notifs = [];
  const H = () => ({ 'x-client-code': code });

  // ---------- auth ----------
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const c = $('#code').value.trim().toUpperCase();
    try {
      const r = await api('/api/auth/client', { method: 'POST', body: { code: c } });
      code = c; localStorage.setItem(KEY, code);
      $('#who').textContent = r.client.name;
      enter();
    } catch (err) { toast(err.message); }
  });
  $('#logout').addEventListener('click', () => { localStorage.removeItem(KEY); location.reload(); });

  async function enter() {
    $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
    await refreshAll();
    setInterval(loadNotifs, 15000); // poll for "printed" notifications
  }

  // ---------- tabs ----------
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    for (const id of ['orders', 'products', 'notifs']) $('#tab-' + id).hidden = id !== t.dataset.tab;
    if (t.dataset.tab === 'notifs') markRead();
  }));

  async function refreshAll() {
    await Promise.all([loadOrders(), loadProducts(), loadNotifs()]);
  }

  // ---------- orders ----------
  async function loadOrders() {
    orders = await api('/api/client/orders', { headers: H() });
    renderOrders();
  }
  function renderOrders() {
    const el = $('#orders');
    if (!orders.length) { el.innerHTML = '<div class="empty">No orders yet. Import an Excel sheet above to get started.</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Ship to</th><th>Items</th><th>Status</th><th>Shipping label</th><th>Created</th></tr></thead><tbody>${orders.map((o) => `
      <tr>
        <td><strong>${esc(o.order_number)}</strong></td>
        <td>${esc(o.ship_to) || '<span class="muted">—</span>'}</td>
        <td><div class="row">${o.items.map((it) => `<span class="row" title="${esc(it.name)}">${thumb(it.image, it.name)}<span>×${it.quantity}</span></span>`).join('')}</div></td>
        <td><span class="status ${esc(o.status)}">${esc(statusLabel(o.status))}</span>${o.printed_at ? `<div class="muted" style="font-size:12px">${esc(fmtDate(o.printed_at))}</div>` : ''}</td>
        <td>
          ${o.has_label ? `<a class="btn sm" target="_blank" href="/api/client/orders/${o.id}/label?code=${encodeURIComponent(code)}">View label</a> ` : ''}
          <label class="btn sm" style="margin:0;display:inline-flex">${o.has_label ? 'Replace' : 'Upload label'}<input type="file" accept=".pdf,image/*" hidden data-order="${o.id}" class="labelInput"></label>
        </td>
        <td class="muted">${esc(fmtDate(o.created_at))}</td>
      </tr>`).join('')}</tbody></table></div>`;
    $$('.labelInput', el).forEach((inp) => inp.addEventListener('change', async () => {
      if (!inp.files[0]) return;
      const form = new FormData(); form.append('label', inp.files[0]);
      try {
        await api(`/api/client/orders/${inp.dataset.order}/label`, { method: 'POST', form, headers: H() });
        toast('Shipping label uploaded.'); loadOrders();
      } catch (err) { toast(err.message); }
    }));
  }

  // ---------- import ----------
  $('#importForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('#importFile').files[0];
    if (!f) return;
    const form = new FormData(); form.append('file', f);
    const out = $('#importResult');
    out.textContent = 'Importing…';
    try {
      const r = await api('/api/client/import', { method: 'POST', form, headers: H() });
      const mapped = Object.entries(r.mapping).map(([k, v]) => `${k} ← "${esc(v)}"`).join(', ');
      out.innerHTML = `Imported <strong>${r.rows}</strong> rows: <strong>${r.orders_added}</strong> orders, <strong>${r.products_added}</strong> new products.${r.catalog_only ? ' (No order column found, so products were added to your catalog only.)' : ''}<br><span style="font-size:12px">Columns detected: ${mapped}</span><br><span style="font-size:12px">Product pictures are being looked up in the background. Refresh Products in a moment.</span>`;
      $('#importFile').value = '';
      await refreshAll();
      setTimeout(loadProducts, 6000);
      setTimeout(loadProducts, 15000);
    } catch (err) { out.textContent = ''; toast(err.message); }
  });

  // ---------- products ----------
  async function loadProducts() {
    products = await api('/api/client/products', { headers: H() });
    renderProducts();
    renderOrders();
  }
  $('#prodSearch').addEventListener('input', renderProducts);
  function renderProducts() {
    const q = $('#prodSearch').value.trim().toLowerCase();
    const list = products.filter((p) => !q || (p.name + ' ' + (p.sku || '')).toLowerCase().includes(q));
    const el = $('#products');
    if (!list.length) { el.innerHTML = '<div class="empty" style="grid-column:1/-1">No products yet.</div>'; return; }
    el.innerHTML = list.map((p) => `
      <div class="card tile" style="cursor:pointer" data-id="${p.id}">
        ${thumb(p.image, p.name, 'lg')}
        <div style="min-width:0">
          <h3 style="margin:0">${esc(p.name)}</h3>
          <div class="muted" style="font-size:13px">${esc(p.sku || 'no SKU')}${p.type ? ` · ${esc(p.type)}` : ''}</div>
          <div style="font-size:13px;margin-top:4px">${p.location ? `📍 <strong>${esc(p.location)}</strong>` : '<span class="muted">No location set</span>'}</div>
        </div>
      </div>`).join('');
    $$('.tile', el).forEach((t) => t.addEventListener('click', () => openProduct(t.dataset.id)));
  }

  function openProduct(id) {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const m = $('#modal');
    m.innerHTML = `
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(p.name)}</h2><button class="btn sm" id="closeM">Close</button></div>
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
            <button class="btn primary" id="saveP">Save</button>
            <label class="btn" style="margin:0">Upload image<input type="file" accept="image/*" hidden id="upImg"></label>
            <button class="btn" id="findImg">Find image online</button>
          </div>
        </div>
      </div>
      <div id="imgResults" style="margin-top:14px"></div>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    $('#saveP').onclick = async () => {
      try {
        await api(`/api/client/products/${p.id}`, { method: 'PATCH', headers: H(), body: { location: $('#pLoc').value, description: $('#pDesc').value, image: $('#pImg').value, type: $('#pType').value } });
        toast('Saved.'); closeModal(); loadProducts();
      } catch (err) { toast(err.message); }
    };
    $('#upImg').onchange = async (e) => {
      if (!e.target.files[0]) return;
      const form = new FormData(); form.append('image', e.target.files[0]);
      try { await api(`/api/client/products/${p.id}/image`, { method: 'POST', form, headers: H() }); toast('Image uploaded.'); closeModal(); loadProducts(); }
      catch (err) { toast(err.message); }
    };
    $('#findImg').onclick = async () => {
      const box = $('#imgResults');
      box.innerHTML = '<span class="muted">Searching the web…</span>';
      try {
        const r = await api(`/api/client/products/${p.id}/find-image`, { headers: H() });
        if (!r.results.length) { box.innerHTML = '<span class="muted">No images found. Try uploading one.</span>'; return; }
        box.innerHTML = `<p class="muted" style="margin:0 0 8px">Click a picture to use it for "${esc(r.query)}":</p><div class="imgpick">${r.results.map((x) => `<img src="${esc(x.thumbnail)}" data-url="${esc(x.url)}" title="${esc(x.title)}" onerror="this.remove()">`).join('')}</div>`;
        $$('.imgpick img', box).forEach((img) => img.addEventListener('click', async () => {
          try { await api(`/api/client/products/${p.id}`, { method: 'PATCH', headers: H(), body: { image: img.dataset.url } }); toast('Image set.'); closeModal(); loadProducts(); }
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
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Add product</h2><button class="btn sm" id="closeM" type="button">Close</button></div>
      <p class="muted">Upload a photo or paste an image link. Leave both empty and a picture will be looked up for you.</p>
      <form id="npForm" class="stack">
        <div class="grid cols-2">
          <div><label>Product name *</label><input type="text" id="npName" required></div>
          <div><label>SKU</label><input type="text" id="npSku" placeholder="optional, must be unique"></div>
          <div><label>Item type / category</label><input type="text" id="npType" placeholder="e.g. Mug, Apparel, Candle"></div>
          <div><label>Garage location</label><input type="text" id="npLoc" placeholder="e.g. Shelf A2"></div>
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
    $('#npForm').onsubmit = async (e) => {
      e.preventDefault();
      const file = $('#npFile').files[0];
      const imgUrl = $('#npImg').value.trim();
      try {
        const p = await api('/api/client/products', { method: 'POST', headers: H(), body: {
          name: $('#npName').value, sku: $('#npSku').value, type: $('#npType').value,
          location: $('#npLoc').value, description: $('#npDesc').value, image: file ? '' : imgUrl,
        } });
        if (file) {
          const form = new FormData(); form.append('image', file);
          await api(`/api/client/products/${p.id}/image`, { method: 'POST', form, headers: H() });
        }
        toast('Product added.'); closeModal(); await loadProducts();
        if (!file && !imgUrl) setTimeout(loadProducts, 12000); // picture lookup runs in the background
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- create order by hand ----------
  $('#newOrder').addEventListener('click', openNewOrder);
  function openNewOrder() {
    if (!products.length) { toast('Add a product first, on the Products tab.'); return; }
    const m = $('#modal');
    const opts = products.map((p) => `<option value="${p.id}">${esc(p.name)}${p.sku ? ` (${esc(p.sku)})` : ''}</option>`).join('');
    const lineRow = () => `<div class="row lineRow"><select class="lineProd" style="flex:1;min-width:200px">${opts}</select><input type="number" class="lineQty" min="1" value="1" style="width:84px" title="Quantity"><button type="button" class="btn sm rmLine" title="Remove">✕</button></div>`;
    m.innerHTML = `
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Create order</h2><button class="btn sm" id="closeM" type="button">Close</button></div>
      <form id="noForm" class="stack">
        <div class="grid cols-2">
          <div><label>Order number</label><input type="text" id="noNum" placeholder="leave blank to auto-generate"></div>
          <div><label>Ship to</label><input type="text" id="noShip" placeholder="Name, city, state"></div>
        </div>
        <div><label>Items and quantities</label><div id="noLines" class="stack">${lineRow()}</div><button type="button" class="btn sm" id="addLine" style="margin-top:8px">+ Add another item</button></div>
        <div><label>Shipping label (PDF or image; you can also add it later)</label><input type="file" id="noLabel" accept=".pdf,image/*"></div>
        <div class="row" style="justify-content:flex-end"><button class="btn primary" type="submit">Create order</button></div>
      </form>`;
    $('#modalBg').classList.add('open');
    $('#closeM').onclick = closeModal;
    const lines = $('#noLines');
    const wire = () => $$('.rmLine', lines).forEach((b) => { b.onclick = () => { if ($$('.lineRow', lines).length > 1) b.closest('.lineRow').remove(); }; });
    wire();
    $('#addLine').onclick = () => { lines.insertAdjacentHTML('beforeend', lineRow()); wire(); };
    $('#noForm').onsubmit = async (e) => {
      e.preventDefault();
      const items = $$('.lineRow', lines).map((r) => ({ product_id: $('.lineProd', r).value, quantity: $('.lineQty', r).value }));
      const label = $('#noLabel').files[0];
      try {
        const o = await api('/api/client/orders', { method: 'POST', headers: H(), body: { order_number: $('#noNum').value, ship_to: $('#noShip').value, items } });
        if (label) {
          const form = new FormData(); form.append('label', label);
          await api(`/api/client/orders/${o.id}/label`, { method: 'POST', form, headers: H() });
        }
        toast(`Order ${o.order_number} created${label ? ' with its label' : ''}.`); closeModal(); loadOrders();
      } catch (err) { toast(err.message); }
    };
  }

  // ---------- notifications ----------
  async function loadNotifs() {
    const prevUnread = notifs.filter((n) => !n.read).length;
    notifs = await api('/api/client/notifications', { headers: H() });
    const unread = notifs.filter((n) => !n.read).length;
    const b = $('#unread'); b.textContent = unread; b.hidden = unread === 0;
    if (unread > prevUnread && prevUnread !== undefined && notifs.length) toast(notifs[0].message, 5000);
    renderNotifs();
    if (unread > prevUnread) loadOrders();
  }
  function renderNotifs() {
    const el = $('#notifs');
    if (!notifs.length) { el.innerHTML = '<div class="empty">No notifications yet. You will be told here when an order is printed.</div>'; return; }
    el.innerHTML = notifs.map((n) => `<div class="notif ${n.read ? '' : 'unread'}"><div>${esc(n.message)}</div><time>${esc(fmtDate(n.created_at))}</time></div>`).join('');
  }
  async function markRead() {
    if (!notifs.some((n) => !n.read)) return;
    await api('/api/client/notifications/read', { method: 'POST', headers: H() });
    loadNotifs();
  }
  $('#markRead').addEventListener('click', markRead);

  // ---------- boot ----------
  if (code) {
    api('/api/client/me', { headers: H() })
      .then((me) => { $('#who').textContent = me.name; enter(); })
      .catch(() => { localStorage.removeItem(KEY); code = ''; });
  }
})();
