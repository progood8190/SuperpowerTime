(function () {
  'use strict';

  if (window.DeflySuperTimer && window.DeflySuperTimer.destroy) {
    try { window.DeflySuperTimer.destroy(); } catch (e) {}
  }

  var OP_WELCOME = 2, OP_FUEL = 24;
  var WE_LEN = 7;
  var P_BASE = 83 + WE_LEN;

  var NAMES = ['Dual Fire', 'Speed Boost', 'Clone', 'Shield',
               'Flashbang', 'Teleport', 'Grenade'];
  var USE = [10, 10, 10, 10, 10, 1, 10];
  var CD  = [30, 30, 30, 30, 30, 30, 30];
  var haveTables = false;

  var el = { fuel: null, bar: null, label: null, out: null };
  var sel = -1;
  var fuel = -1;
  var active = false;
  var fuelAt = 0;
  var activatedAt = 0;
  var decimals = 2, visible = true;
  var rafId = 0, lastText = '';
  var ro = null, sized = false, sizeTick = 0, syncing = false;
  var msgPatched = false, origDesc = null, seen = null;
  var wrappedSelect = null, origSelect = null;

  function now() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  function ingest(buf, evt) {
    if (!buf || !(buf instanceof ArrayBuffer) || buf.byteLength < 1) return;
    if (evt && seen) { if (seen.has(evt)) return; seen.add(evt); }
    try { handle(buf); } catch (e) {}
  }

  function handle(buf) {
    var dv = new DataView(buf), len = buf.byteLength;
    var op = dv.getUint8(0);

    if (op === OP_FUEL) {
      if (len < 6) return;
      var re = dv.getFloat32(1);
      if (!isFinite(re) || re < -1 || re > 1000) return;
      var act = dv.getUint8(5) === 1;
      if (act && !active) activatedAt = now();
      active = act;
      fuel = re;
      fuelAt = now();
      return;
    }

    if (op === OP_WELCOME) {
      if (len < 65) return;
      active = false; fuel = -1; sel = -1;
      readTables(dv, len);
      return;
    }
  }

  function readTables(dv, len) {
    if (len < P_BASE + 1) return;
    var b = dv.getUint8(P_BASE);
    var p = P_BASE + 1 + b;
    if (len < p + 1) return;
    var v = dv.getUint8(p);
    if (v < 1 || v > 32 || len < p + 1 + 8 * v) return;
    var use = [], cd = [];
    for (var i = 0; i < v; i++) {
      var a = dv.getFloat32(p + 1 + 8 * i);
      var c = dv.getFloat32(p + 1 + 8 * i + 4);
      if (!isFinite(a) || !isFinite(c) || a <= 0 || c <= 0 || a > 600 || c > 600) return;
      use.push(a); cd.push(c);
    }
    for (i = 0; i < v; i++) { USE[i] = use[i]; CD[i] = cd[i]; }
    haveTables = true;
  }

  function patchMessageEvent() {
    if (msgPatched) return;
    try {
      var proto = window.MessageEvent && window.MessageEvent.prototype;
      if (!proto) return;
      var d = Object.getOwnPropertyDescriptor(proto, 'data');
      if (!d || !d.get || d.configurable === false) return;
      origDesc = d;
      seen = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
      Object.defineProperty(proto, 'data', {
        configurable: true, enumerable: d.enumerable,
        get: function () {
          var v = d.get.call(this);
          try { if (v instanceof ArrayBuffer) ingest(v, this); } catch (e) {}
          return v;
        }
      });
      msgPatched = true;
    } catch (e) {
      console.warn('[super-timer] could not hook packets', e);
    }
  }

  function unpatchMessageEvent() {
    if (!msgPatched || !origDesc) return;
    try { Object.defineProperty(window.MessageEvent.prototype, 'data', origDesc); } catch (e) {}
    msgPatched = false;
  }

  function patchSelect() {
    try {
      var d = window.defly;
      if (!d || typeof d.selectSuperpower !== 'function') return false;
      if (d.selectSuperpower === wrappedSelect) return true;
      origSelect = d.selectSuperpower;
      wrappedSelect = function (i) {
        sel = i | 0; fuel = 0; active = false; fuelAt = now();
        return origSelect.apply(this, arguments);
      };
      d.selectSuperpower = wrappedSelect;
      return true;
    } catch (e) { return false; }
  }

  function unpatchSelect() {
    try {
      if (window.defly && origSelect && window.defly.selectSuperpower === wrappedSelect) {
        window.defly.selectSuperpower = origSelect;
      }
    } catch (e) {}
    wrappedSelect = null; origSelect = null;
  }

  function selFromLabel() {
    var t = (el.label && el.label.textContent || '').trim();
    if (!t) return -1;
    var name = null;
    if (/^Recharging\s+/.test(t)) name = t.replace(/^Recharging\s+/, '').replace(/\.+$/, '').trim();
    else if (/\sactive$/.test(t)) name = t.replace(/\sactive$/, '').trim();
    else { var m = t.match(/^(.*?)\s+ready,/); if (m) name = m[1].trim(); }
    return name ? NAMES.indexOf(name) : -1;
  }

  function power() {
    if (sel >= 0) return sel;
    var i = selFromLabel();
    if (i >= 0) sel = i;
    return sel;
  }

  function grab() {
    if (!el.fuel || !document.body.contains(el.fuel)) {
      el.fuel  = document.getElementById('superpower-fuel');
      el.bar   = document.getElementById('superpower-fuel-value');
      el.label = document.getElementById('superpower-label');
      el.out   = null;
      stopObserving();
    }
    if (!el.fuel) return false;
    if (!el.out || !el.fuel.contains(el.out)) {
      el.out = document.createElement('div');
      el.out.id = 'defly-super-countdown';
      el.out.style.cssText = [
        'position:fixed',
        'transform:translate(-100%,-50%)',
        'pointer-events:none',
        'max-width:92%',
        'overflow:hidden',
        'white-space:nowrap',
        'font-weight:700',
        'font-family:"Segoe UI",system-ui,sans-serif',
        'line-height:1',
        'color:#fff',
        'text-shadow:0 1px 2px rgba(0,0,0,.75)',
        'letter-spacing:.02em',
        'font-variant-numeric:tabular-nums'
      ].join(';');
      matchLayer();
      el.fuel.appendChild(el.out);
      lastText = '';
      sized = false;
      startObserving();
    }
    if (!sized || (!ro && ++sizeTick % 30 === 0)) syncSize();
    return true;
  }

  function matchLayer() {
    if (!el.bar || !el.out) return;
    var z = window.getComputedStyle(el.bar).zIndex;
    if (z && z !== 'auto' && isFinite(+z)) el.out.style.zIndex = String(+z);
  }

  function startObserving() {
    if (ro || typeof ResizeObserver === 'undefined' || !el.fuel) return;
    try {
      ro = new ResizeObserver(function () { sized = false; });
      ro.observe(el.fuel);
    } catch (e) { ro = null; }
  }

  function stopObserving() {
    if (!ro) return;
    try { ro.disconnect(); } catch (e) {}
    ro = null;
  }

  function syncSize() {
    if (syncing || !el.fuel || !el.out) return;
    syncing = true;
    try {
      var r = el.fuel.getBoundingClientRect();
      var h = r.height || el.fuel.clientHeight || 0;
      if (!h) return;
      sized = true;
      var fs = Math.max(8, Math.min(Math.round(h * 0.62), h - 2));
      var pad = Math.max(3, Math.round(h * 0.3));
      var L = Math.round(r.right - pad) + 'px';
      var Tp = Math.round(r.top + r.height / 2) + 'px';
      if (el.out.style.fontSize !== fs + 'px') el.out.style.fontSize = fs + 'px';
      if (el.out.style.left !== L) el.out.style.left = L;
      if (el.out.style.top !== Tp) el.out.style.top = Tp;
    } finally { syncing = false; }
  }

  function applyOpacity() {
    var xp = document.getElementById('xp-block');
    if (!xp || !el.out) return;
    if (xp.contains && xp.contains(el.out)) {
      if (el.out.style.opacity !== '') el.out.style.opacity = '';
      return;
    }
    var o = (xp.style.opacity === '' || xp.style.opacity == null) ? '1' : xp.style.opacity;
    if (el.out.style.opacity !== o) el.out.style.opacity = o;
  }

  function remaining(t) {
    var i = power();
    if (i < 0) return null;

    if (active) {
      var dur = USE[i];
      if (!(dur > 0)) return null;
      return dur - (t - activatedAt) / 1000;
    }

    if (fuel < 0) return null;
    if (fuel >= 100) return null;
    var cd = CD[i];
    if (!(cd > 0)) return null;

    var endAt = fuelAt + (100 - fuel) * cd * 10;
    return (endAt - t) / 1000;
  }

  function frame() {
    rafId = requestAnimationFrame(frame);
    patchSelect();
    if (!grab()) return;

    if (!visible || el.fuel.style.display === 'none') { write(''); return; }

    var t = now();
    var r = remaining(t);
    write((r !== null && isFinite(r) && r > 0) ? r.toFixed(decimals) + 's' : '');
    applyOpacity();
  }

  function write(s) {
    if (lastText === s) return;
    lastText = s;
    el.out.textContent = s;
  }

  var API = {
    show: function () { visible = true; return API; },
    hide: function () { visible = false; if (el.out) write(''); return API; },
    setDecimals: function (n) { decimals = Math.max(0, Math.min(3, n | 0)); return API; },
    tables: function () {
      var rows = NAMES.map(function (n, i) {
        return { power: n, 'active (s)': USE[i], 'recharge (s)': CD[i] };
      });
      console.log(haveTables ? 'from the server (opcode 2)' : 'client defaults - no join packet seen yet');
      if (console.table) console.table(rows); else console.log(rows);
      return { active: USE.slice(), recharge: CD.slice(), fromServer: haveTables };
    },
    contained: function () {
      var ok = { childOfBar: false, noPointerEvents: false, insideBarBox: false, affectsLayout: true };
      if (!el.fuel || !el.out) { console.log('[super-timer] readout not built yet'); return ok; }
      ok.childOfBar = (el.out.parentNode === el.fuel);
      ok.noPointerEvents = /pointer-events:\s*none/.test(el.out.style.cssText);
      ok.affectsLayout = !/position:\s*fixed/.test(el.out.style.cssText);
      try {
        var b = el.fuel.getBoundingClientRect(), o = el.out.getBoundingClientRect();
        ok.insideBarBox = (o.left >= b.left - 1 && o.right <= b.right + 1 &&
                           o.top >= b.top - 1 && o.bottom <= b.bottom + 1);
      } catch (e) {}
      if (console.table) console.table([ok]); else console.log(ok);
      return ok;
    },

    status: function () {
      var i = power();
      console.log('[super-timer] packets:', msgPatched ? 'hooked' : 'NOT hooked',
                  '| tables:', haveTables ? 'server' : 'defaults',
                  '| power:', i >= 0 ? NAMES[i] + ' (' + i + ')' : 'unknown',
                  '| Re:', fuel < 0 ? '-' : fuel.toFixed(2),
                  '| active:', active,
                  '| showing:', lastText || '(blank)');
      return { hooked: msgPatched, fromServer: haveTables, power: i, Re: fuel, active: active };
    },
    destroy: function () {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      stopObserving();
      unpatchMessageEvent();
      unpatchSelect();
      if (el.out) {
        if (typeof el.out.remove === 'function') el.out.remove();
        else if (el.out.parentNode) el.out.parentNode.removeChild(el.out);
      }
      el = { fuel: null, bar: null, label: null, out: null };
      delete window.DeflySuperTimer;
      console.log('[super-timer] uninstalled');
    },
    __test: {
      handle: handle, remaining: remaining,
      setSel: function (i) { sel = i; },
      state: function () { return { sel: sel, fuel: fuel, active: active, USE: USE, CD: CD, haveTables: haveTables }; },
      text: function () { return lastText; }
    }
  };

  window.DeflySuperTimer = API;
  patchMessageEvent();
  patchSelect();
  rafId = requestAnimationFrame(frame);

  console.log(
    '%c[super-timer] ready%c\n' +
    'Now reads the server fuel packet (opcode 24) and the real duration\n' +
    'tables from the join packet - no longer measures the bar.\n' +
    'DeflySuperTimer.tables()   DeflySuperTimer.status()',
    'background:#321;color:#fb8;padding:2px 6px;border-radius:3px;font-weight:700',
    'color:inherit'
  );
})();
