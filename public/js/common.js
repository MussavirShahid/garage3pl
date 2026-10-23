// Shared helpers for both portals.
window.G = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    let el = $('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  async function api(path, { method = 'GET', body, headers = {}, form } = {}) {
    const opts = { method, headers: { ...headers } };
    if (form) opts.body = form;
    else if (body !== undefined) { opts.headers['content-type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function statusLabel(s) {
    return { new: 'Awaiting label', label_ready: 'Label ready', printed: 'Printed', shipped: 'Shipped' }[s] || s;
  }

  function thumb(src, alt = '', cls = '') {
    if (src) return `<img class="thumb ${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" onerror="this.outerHTML='<div class=&quot;thumb placeholder ${cls}&quot;>no image</div>'">`;
    return `<div class="thumb placeholder ${cls}">no image</div>`;
  }

  return { $, $$, esc, toast, api, fmtDate, statusLabel, thumb };
})();
