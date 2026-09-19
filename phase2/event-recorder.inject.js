/*
 * Phase 2B — page-side observer.
 *
 * Installed into every document (existing pages, new pages, navigations,
 * reloads, child frames). It ONLY observes: it never calls preventDefault,
 * stopPropagation, never mutates the DOM, never touches focus.
 *
 * It answers only: what happened, where, on which element.
 * Node (event-recorder.js) owns the global timeline (t, seq, pageId, frame).
 *
 * Re-injection is guarded: if the same binding is already installed we do
 * nothing; if a different binding (i.e. a restarted recorder) is present we
 * tear the old listeners down first, so listeners never stack up.
 */
(function () {
  'use strict';

  var cfg = window.__UI_RECORDER_CFG__;
  if (!cfg || !cfg.binding) return;
  // NOTE: do not gate on the binding being present yet — an init script runs at
  // document-start, possibly before the exposed binding is installed. emit()
  // re-checks at call time, so listeners installed now will still deliver.

  var NS = '__uiRecorderAgent_v1';
  var prev = window[NS];
  if (prev && prev.binding === cfg.binding) return;
  if (prev && typeof prev.teardown === 'function') {
    try { prev.teardown(); } catch (e) { /* ignore */ }
  }

  var MAX_LABEL = 120;
  var SCROLL_THROTTLE = cfg.scrollThrottleMs || 100;

  var ALLOWED_KEYS = {
    Enter: 1, Escape: 1, Tab: 1, Backspace: 1, Delete: 1,
    ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
    Home: 1, End: 1, PageUp: 1, PageDown: 1,
  };

  function emit(obj) {
    try {
      var fn = window[cfg.binding];
      if (typeof fn === 'function') fn(obj);
    } catch (e) { /* fail-safe: a broken recorder must never break the page */ }
  }

  function r2(n) { return Math.round(n * 100) / 100; }
  function collapse(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function cap(s) { s = collapse(s); return s.length > MAX_LABEL ? s.slice(0, MAX_LABEL) : s; }

  function labelOf(el) {
    try {
      var aria = el.getAttribute && el.getAttribute('aria-label');
      if (aria) return cap(aria);
      var title = el.getAttribute && el.getAttribute('title');
      if (title) return cap(title);
      if (el.id) {
        var lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lab) return cap(lab.textContent);
      }
      var wrap = el.closest && el.closest('label');
      if (wrap) return cap(wrap.textContent);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        var ph = el.getAttribute('placeholder');
        if (ph) return cap(ph);
      }
      return cap(el.innerText || el.textContent);
    } catch (e) { return ''; }
  }

  function describe(el) {
    try {
      if (!el || el.nodeType !== 1) return null;
      var rect = el.getBoundingClientRect();
      var d = { tag: (el.tagName || '').toLowerCase() };
      if (el.id) d.id = el.id;
      var role = el.getAttribute && el.getAttribute('role'); if (role) d.role = role;
      var aria = el.getAttribute && el.getAttribute('aria-label'); if (aria) d.ariaLabel = cap(aria);
      var name = el.getAttribute && el.getAttribute('name'); if (name) d.name = name;
      var type = el.getAttribute && el.getAttribute('type'); if (type) d.type = type;
      var testid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id'));
      if (testid) d.testid = testid;
      var label = labelOf(el); if (label) d.label = label;
      d.rect = { x: r2(rect.x), y: r2(rect.y), width: r2(rect.width), height: r2(rect.height) };
      return d;
    } catch (e) { return null; }
  }

  function viewport() {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    };
  }

  function pageScroll() {
    return { x: r2(window.scrollX || 0), y: r2(window.scrollY || 0) };
  }

  function isSensitive(el) {
    try {
      if (!el || !el.getAttribute) return false;
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'password') return true;
      var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
      if (ac.indexOf('password') >= 0) return true;
      var hint = ((el.id || '') + ' ' + (el.getAttribute('name') || '') + ' ' + ac).toLowerCase();
      return /(pass|token|secret|otp|credit|card|cvv|auth|apikey|api_key)/.test(hint);
    } catch (e) { return false; }
  }

  // ---- listeners -----------------------------------------------------------

  function onPointerDown(e) {
    emit({
      type: 'pointerdown', isTrusted: e.isTrusted,
      point: { x: r2(e.clientX), y: r2(e.clientY) },
      pointer: { button: e.button, pointerType: e.pointerType || 'mouse' },
      target: describe(e.target),
      pageScroll: pageScroll(), viewport: viewport(),
    });
  }

  function onClick(e) {
    emit({
      type: 'click', isTrusted: e.isTrusted,
      point: { x: r2(e.clientX), y: r2(e.clientY) },
      target: describe(e.target),
      pageScroll: pageScroll(), viewport: viewport(),
    });
  }

  function onInput(e) {
    var t = e.target;
    var len = 0;
    try { if (t && typeof t.value === 'string') len = t.value.length; } catch (_) {}
    emit({
      type: 'input', isTrusted: e.isTrusted,
      target: describe(t),
      // value is NEVER read/written to the log — only its length + sensitivity flag.
      input: { inputType: e.inputType || null, valueLength: len, masked: isSensitive(t) },
      viewport: viewport(),
    });
  }

  function onChange(e) {
    var t = e.target;
    var idx = null;
    try { if (t && t.tagName === 'SELECT') idx = t.selectedIndex; } catch (_) {}
    emit({
      type: 'change', isTrusted: e.isTrusted,
      target: describe(t),
      // option value is intentionally not recorded in Phase 2B.
      change: { selectedIndex: idx },
      viewport: viewport(),
    });
  }

  function onKeyDown(e) {
    var mods = { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey };
    var hasShortcut = mods.ctrl || mods.meta || mods.alt;
    if (!ALLOWED_KEYS[e.key] && !hasShortcut) return; // printable chars are represented by `input`
    emit({
      type: 'keydown', isTrusted: e.isTrusted,
      key: e.key, modifiers: mods,
      target: describe(e.target),
      viewport: viewport(),
    });
  }

  var scrollLast = new Map();
  function onScroll(e) {
    var t = e.target;
    var isWindow = (t === document || t === document.documentElement || t === document.body);
    var key = isWindow ? '__window' : t;
    var now = Date.now();
    if (now - (scrollLast.get(key) || 0) < SCROLL_THROTTLE) return;
    scrollLast.set(key, now);
    var ev = {
      type: 'scroll', isTrusted: e.isTrusted,
      scroll: isWindow
        ? { x: r2(window.scrollX || 0), y: r2(window.scrollY || 0) }
        : { x: r2(t.scrollLeft || 0), y: r2(t.scrollTop || 0) },
      viewport: viewport(),
    };
    if (!isWindow) ev.target = describe(t);
    emit(ev);
  }

  var capturePassive = { capture: true, passive: true };
  var captureOnly = { capture: true };

  document.addEventListener('pointerdown', onPointerDown, capturePassive);
  document.addEventListener('click', onClick, capturePassive);
  document.addEventListener('input', onInput, capturePassive);
  document.addEventListener('change', onChange, capturePassive);
  document.addEventListener('keydown', onKeyDown, captureOnly);
  window.addEventListener('scroll', onScroll, capturePassive);

  function teardown() {
    try {
      document.removeEventListener('pointerdown', onPointerDown, capturePassive);
      document.removeEventListener('click', onClick, capturePassive);
      document.removeEventListener('input', onInput, capturePassive);
      document.removeEventListener('change', onChange, capturePassive);
      document.removeEventListener('keydown', onKeyDown, captureOnly);
      window.removeEventListener('scroll', onScroll, capturePassive);
      scrollLast.clear();
    } catch (e) { /* ignore */ }
  }

  window[NS] = { binding: cfg.binding, teardown: teardown };
})();
