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
    el.innerHTML = `<table><thead><tr><th>Order</th><th>Ship to</th><th>Items</th><th>Status</th><th>Shipping label</th><th>Created</th></tr></thead><tbody>${orders.map((o) => `
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
      </tr>`).join('')}</tbody></table>`;
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
          <div class="muted" style="font-size:13px">${esc(p.sku || 'no SKU')}</div>
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
          <div><label>Garage location</label><input type="text" id="pLoc" value="${esc(p.location || '')}" placeholder="e.g. Shelf A2"></div>
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
        await api(`/api/client/products/${p.id}`, { method: 'PATCH', headers: H(), body: { location: $('#pLoc').value, description: $('#pDesc').value, image: $('#pImg').value } });
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
