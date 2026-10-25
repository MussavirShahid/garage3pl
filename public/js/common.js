// Shared helpers for both portals: DOM, API, feedback, icons.
window.G = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Inline SVG icons (stroke = currentColor). Decorative by default; pass a label for standalone meaning.
  const PATHS = {
    pin: '<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    upload: '<path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><path d="M6 14h12v7H6z"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
    arrow: '<path d="M5 12h14m-6-6l6 6-6 6"/>',
    box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"/><path d="M14 3v5h5"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  };
  function icon(name, label) {
    const a = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg class="icon" viewBox="0 0 24 24" ${a}>${PATHS[name] || ''}</svg>`;
  }

  let toastTimer;
  function toast(msg, ms = 3500) {
    let el = $('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
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

  // Disable a button and show a spinner while an async action runs (rule: submit feedback).
  async function busy(btn, fn, label) {
    if (!btn) return fn();
    const prev = btn.innerHTML;
    btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
    if (label) btn.textContent = label;
    try { return await fn(); }
    finally { btn.removeAttribute('aria-busy'); btn.disabled = false; btn.innerHTML = prev; }
  }

  // Inline field error next to the input (rule: error placement), cleared on next input.
  function fieldError(input, msg) {
    if (!input) return;
    let el = input.parentElement.querySelector('.field-error');
    if (!el) { el = document.createElement('div'); el.className = 'field-error'; el.setAttribute('role', 'alert'); input.parentElement.appendChild(el); }
    el.innerHTML = `${icon('alert')} ${esc(msg)}`;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.addEventListener('input', () => { el.remove(); input.removeAttribute('aria-invalid'); }, { once: true });
  }

  function skeleton(rows = 3) {
    return Array.from({ length: rows }, () => '<span class="skeleton row" aria-hidden="true"></span>').join('') +
      '<span class="muted small" role="status">Loading…</span>';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function statusLabel(s) {
    return { new: 'Awaiting label', label_ready: 'Ready to print', printed: 'Printed', shipped: 'Shipped' }[s] || s;
  }

  function thumb(src, alt = '', cls = '') {
    if (src) return `<img class="thumb ${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" width="56" height="56" onerror="this.outerHTML='<div class=&quot;thumb placeholder ${cls}&quot;>no image</div>'">`;
    return `<div class="thumb placeholder ${cls}">no image</div>`;
  }

  return { $, $$, esc, toast, api, busy, fieldError, skeleton, icon, fmtDate, statusLabel, thumb };
})();
