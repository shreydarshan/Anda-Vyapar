/* ============================================================
   LOCAL STORAGE SERVICE
   This is the PRIMARY database. The app must be fully usable from
   this layer alone — Supabase is background sync/recovery only.
   Every read/write is scoped to `currentAccountKey` ('guest' or a
   user id) so User A's data never mixes with User B's or Guest's.
   NOTE: Supabase URL/key are NEVER part of this payload (see
   config.js) — never write them here.
   ============================================================ */
// Bumped only when a change to buildPayload()'s shape would make an
// older Anda Vyapar build misread a newer backup (or vice versa).
// Included in every save, not just exported backups — harmless there
// (applyPayload() ignores unknown fields), and it means the on-disk
// account file itself is self-describing too.
const AV_BACKUP_FORMAT_VERSION = 1;

function buildPayload() {
  return {
    formatVersion: AV_BACKUP_FORMAT_VERSION,
    // Which account this data belongs to, so a restore later can warn
    // if it's being imported somewhere else. accountKey is the exact
    // internal id (safe to compare, not shown to the user). accountLabel
    // is just for display (email or "Guest (local)") — never treated as
    // an authoritative match, only a human-readable hint in the warning.
    accountKey: currentAccountKey,
    accountLabel: (typeof AccountStore !== 'undefined') ? AccountStore.currentLabel() : currentAccountKey,
    rates, orders, counter, udhar, shop, stock, stockLog, custLedger, lang, ts: Date.now()
  };
}

function applyPayload(d) {
  resetBusinessState();
  if (!d) return;
  if (d.rates) rates = d.rates;
  if (d.orders) { orders = sanitizeOrders(d.orders); counter = safeNum(d.counter) || orders.length; }
  if (d.udhar) udhar = sanitizeUdhar(d.udhar);
  if (d.shop) shop = d.shop;
  if (d.stock) stock = sanitizeStock(d.stock);
  if (d.stockLog) stockLog = d.stockLog;
  if (d.custLedger) custLedger = sanitizeCustLedger(d.custLedger);
  if (d.lang) lang = d.lang;
}

function showDataFolder() {
  const banner = document.getElementById('electron-data-note');
  const pathEl = document.getElementById('data-folder-path');
  if (IS_ELECTRON) {
    if (banner) banner.style.display = 'block';
    window.electronAPI.getFolder(currentAccountKey).then(f => { if (pathEl) pathEl.textContent = f; });
  } else if (IS_PYTHON_APP) {
    if (banner) banner.style.display = 'block';
    fetch('/api/load').then(r => r.json()).then(d => { if (d.folder && pathEl) pathEl.textContent = d.folder; }).catch(() => {});
  }
}

function localKeyPrefix() { return K + currentAccountKey + '_'; }

// Debounced save state. Only the account KEY is captured at sv()'s
// call time now — a single cheap string copy, not the previous
// design of eagerly calling buildPayload() (which references the
// whole orders/stock/udhar/rates/shop state) on every single call.
// That mattered because sv() fires on every keystroke of any
// autosaved field (e.g. Shop Name) — buildPayload() itself is cheap
// (it only copies references, not the arrays' contents), but there's
// no reason to do even that work more than once per actual write.
// The full payload is now built exactly once, right when the write
// actually happens (inside the timer below, or in flushPendingSave()),
// which also means it reads the freshest possible state at that
// moment rather than a snapshot from whenever typing started.
//
// This is still safe against the cross-account race the old eager
// capture guarded against: AccountStore.switchTo() calls
// flushPendingSave() BEFORE it changes currentAccountKey, so any
// save still pending for the OLD account is always fully flushed
// (using the old account's own, still-current-at-that-moment data)
// before a switch can take effect — the captured key can never end
// up pointing at the wrong account's data by the time it's used.
let _savePending = false;
let _pendingKey = null; // account key captured at schedule time
let _saveTimer = null;

// Root-cause fix (V21 stability pass, item 5 — overlapping writes):
// each _writeNow() call kicks off an async IPC round-trip
// (window.electronAPI.saveData) without waiting for any earlier one
// to finish. Under rapid repeated changes, two such writes could be
// in flight at once, and there's no guarantee the OS/IPC delivers
// their completions in the order they were issued — a slightly
// slower OLDER write finishing after a newer one would silently
// overwrite the newer data on disk with stale data. Chaining every
// write onto a single promise guarantees writes are applied strictly
// in the order they were requested and never run concurrently, with
// no change to WHEN they happen (still driven by the same 400ms
// debounce below) — only that they can no longer race each other.
let _writeInFlight = Promise.resolve();
// FINAL AUDIT FIX (data integrity, spec section 9 / 20): the result of
// window.electronAPI.saveData() was never inspected here. av-save (see
// electron/main.js) can genuinely resolve with { ok:false, error } —
// disk full, a permissions error, an antivirus lock on the file, a
// removed/unmounted data drive — and none of that ever reached the
// user or the console. The renderer had already moved on believing
// the bill/edit/delete was safely on disk when it silently was not,
// which is exactly the "failed save reported as success" failure mode
// this audit explicitly calls out. This tracks consecutive failures
// per write chain, retries a couple of times with backoff (transient
// locks/AV scans usually clear within a few seconds), and — if it
// still can't write — tells the user plainly instead of staying
// silent, so they know to check disk space or use Export Backup as a
// stopgap. It never throws back into sv()'s caller: local save
// failure must never block the business action that triggered it.
let _consecutiveSaveFailures = 0;
function _reportSaveOutcome(res) {
  if (res && res.ok === false) {
    _consecutiveSaveFailures++;
    console.error('[Anda Vyapar] Local save failed:', res.error, '(consecutive failures:', _consecutiveSaveFailures + ')');
    if (typeof toast === 'function') {
      const msg = _consecutiveSaveFailures >= 3
        ? (lang === 'hi'
            ? 'चेतावनी: डेटा डिस्क पर सेव नहीं हो पा रहा (' + res.error + ')। जगह/अनुमति जाँचें और अभी बैकअप एक्सपोर्ट करें।'
            : 'Warning: local save is failing (' + res.error + '). Check disk space/permissions and export a backup now.')
        : (lang === 'hi'
            ? 'डेटा सेव करने में समस्या — फिर से कोशिश की जा रही है...'
            : 'Trouble saving locally — retrying...');
      toast(msg, 'te');
    }
  } else {
    _consecutiveSaveFailures = 0;
  }
  return res;
}
function _delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function _saveWithRetry(payload, key, attempt) {
  attempt = attempt || 0;
  const res = await Promise.resolve(window.electronAPI.saveData(payload, key));
  if (res && res.ok === false && attempt < 2) {
    await _delay(1500 * (attempt + 1)); // 1.5s, then 3s — enough for a transient AV scan/file lock to clear
    return _saveWithRetry(payload, key, attempt + 1);
  }
  return res;
}
function _writeNow(key, payload) {
  const doWrite = () => {
    if (IS_ELECTRON) {
      return _saveWithRetry(payload, key).then(_reportSaveOutcome);
    } else if (IS_PYTHON_APP) {
      return fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => r.ok ? { ok: true } : { ok: false, error: 'HTTP ' + r.status })
        .catch(e => ({ ok: false, error: (e && e.message) || String(e) }))
        .then(_reportSaveOutcome);
    }
    return Promise.resolve();
  };
  // .then(doWrite, doWrite) so a prior write's rejection still lets
  // this one run — one failed save must never permanently jam the
  // queue for every save after it.
  _writeInFlight = _writeInFlight.then(doWrite, doWrite);
  return _writeInFlight;
}

// Immediately performs whatever save is currently pending (if any),
// bypassing the debounce timer, and returns a Promise that resolves once
// it's actually written. Used before an account switch and before the
// app window closes — the two moments where "the write just hasn't
// happened yet" would otherwise lose or misdirect data.
function flushPendingSave() {
  if (!_savePending) return Promise.resolve();
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const key = _pendingKey;
  _savePending = false;
  _pendingKey = null;
  return Promise.resolve(_writeNow(key, buildPayload()));
}

function sv() {
  if (IS_ELECTRON || IS_PYTHON_APP) {
    _pendingKey = currentAccountKey; // cheap — just the string, not the payload
    if (_savePending) return; // a timer is already scheduled; it'll build the payload fresh when it fires
    _savePending = true;
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      const key = _pendingKey;
      _savePending = false;
      _pendingKey = null;
      if (key) _writeNow(key, buildPayload());
    }, 400);
  } else {
    try {
      const p = localKeyPrefix();
      localStorage.setItem(p + 'r', JSON.stringify(rates));
      localStorage.setItem(p + 'o', JSON.stringify(orders));
      localStorage.setItem(p + 'c', '' + counter);
      localStorage.setItem(p + 'u', JSON.stringify(udhar));
      localStorage.setItem(p + 's', JSON.stringify(shop));
      localStorage.setItem(p + 'stk', JSON.stringify(stock));
      localStorage.setItem(p + 'sl', JSON.stringify(stockLog));
      localStorage.setItem(p + 'l', lang);
      localStorage.setItem(p + 'cl', JSON.stringify(custLedger));
    } catch (e) {}
  }
  // Every local save is also a candidate for background cloud sync.
  if (typeof SyncQueue !== 'undefined') SyncQueue.markDirty();
}

// Loads whatever is currently in `currentAccountKey`'s local storage.
// Returns true if data was found, false if this account has nothing
// locally yet (used by AccountStore to decide whether to try a cloud
// restore on first login on a new device).
async function ld() {
  if (IS_ELECTRON) {
    try {
      const res = await window.electronAPI.loadData(currentAccountKey);
      if (res.ok && res.data) { applyPayload(res.data); return true; }
      resetBusinessState(); return false;
    } catch (e) { console.error('Electron load:', e); resetBusinessState(); return false; }
  } else if (IS_PYTHON_APP) {
    try {
      const res = await fetch('/api/load'); const d = await res.json();
      if (d.ok && d.data) { applyPayload(d.data); return true; }
      resetBusinessState(); return false;
    } catch (e) { console.error('Python load:', e); resetBusinessState(); return false; }
  } else {
    const p = localKeyPrefix();
    const o = localStorage.getItem(p + 'o');
    if (!o && !localStorage.getItem(p + 'r')) { resetBusinessState(); return false; }
    try {
      resetBusinessState();
      const r = localStorage.getItem(p + 'r'); if (r) rates = JSON.parse(r);
      if (o) orders = sanitizeOrders(JSON.parse(o));
      const c = localStorage.getItem(p + 'c'); if (c) counter = parseInt(c) || 0;
      const u = localStorage.getItem(p + 'u'); if (u) udhar = sanitizeUdhar(JSON.parse(u));
      const s = localStorage.getItem(p + 's'); if (s) shop = JSON.parse(s);
      const stk = localStorage.getItem(p + 'stk'); if (stk) stock = sanitizeStock(JSON.parse(stk));
      const sl = localStorage.getItem(p + 'sl'); if (sl) stockLog = JSON.parse(sl);
      const l = localStorage.getItem(p + 'l'); if (l) lang = l;
      const cl = localStorage.getItem(p + 'cl'); if (cl) custLedger = sanitizeCustLedger(JSON.parse(cl));
      return true;
    } catch (e) { return false; }
  }
}
