/* ============================================================
   FORMAT / CALC UTILS
   ============================================================ */
function eFor(type, qty) { return type === 'piece' ? qty : type === 'tray' ? qty * TE : qty * BE; }
function tName(t) { return t === 'piece' ? (lang === 'hi' ? 'अंडा' : 'Egg') : t === 'tray' ? (lang === 'hi' ? 'ट्रे' : 'Tray') : (lang === 'hi' ? 'बॉक्स' : 'Box'); }
function eggBD(eggs) { const e = Math.floor(Number(eggs) || 0); const bx = Math.floor(e / BE); const r = e % BE; const tr = Math.floor(r / TE); const pc = r % TE; return { boxes: bx, trays: tr, pieces: pc }; }
function bdStr(eggs) { const b = eggBD(eggs); const p = []; if (b.boxes) p.push(b.boxes + ' box'); if (b.trays) p.push(b.trays + ' tray'); if (b.pieces) p.push(b.pieces + ' pcs'); return p.join(' + ') || '0'; }
function nowStr() { return new Date().toLocaleString('en-IN'); }
// Root-cause fix (V21 stability pass, item 1): this used to be
// `new Date().toISOString().split('T')[0]` — .toISOString() converts
// to UTC. For any timezone ahead of UTC (e.g. India, UTC+5:30), an
// order placed between local midnight and the UTC offset catch-up
// (00:00–05:29 IST) would be tagged with the PREVIOUS day's date,
// silently misfiling it out of "today" in Order History's date-range
// filter and reports. This uses the device's LOCAL calendar date
// (getFullYear/getMonth/getDate, not the UTC variants) instead, which
// is what every isoDate in this app is actually meant to represent —
// the day the user experienced the transaction on, not a UTC day
// boundary they never see. Reusable for any Date, not just "now".
function localIsoDate(d) {
  d = d || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isoToday() { return localIsoDate(); }

// Verifies an ISO yyyy-mm-dd string is a REAL calendar date — not
// just well-formed. V21 stability fix: native <input type="date">
// was observed (screenshots) accepting/displaying "31-09-2026" and
// producing filtered results, i.e. it does NOT reliably reject an
// impossible day-of-month itself (September has 30 days). This
// checks independently, without trusting the browser: construct the
// date and see if it round-trips back to the exact same
// year/month/day. JS's Date silently ROLLS OVER an invalid day
// (new Date(2026,8,31) becomes Oct 1, 2026) rather than rejecting it
// — that rollover is exactly what would let a bad date slip through
// silently, so the fix is to detect when the round-trip changed
// anything, not to rely on the construction succeeding.
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function isValidCalendarDate(isoStr) {
  if (!isoStr) return true; // empty = "no filter set", not an error
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}
// Human-readable explanation for the invalid case, matching the
// requested message shape exactly ("31 September 2026 is not a valid
// date. September has 30 days.").
function invalidDateMessage(isoStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr || '');
  if (!m) return (lang === 'hi' ? 'अमान्य तारीख' : 'Invalid date');
  const y = +m[1], mo = +m[2], d = +m[3];
  const monthName = MONTH_NAMES[mo - 1] || ('month ' + mo);
  // Real days-in-month for the message text (leap years included) —
  // computed via "day 0 of next month", which is always safe/never
  // itself subject to the same invalid-day problem.
  const daysInMonth = new Date(y, mo, 0).getDate();
  return lang === 'hi'
    ? `${d} ${monthName} ${y} एक मान्य तारीख नहीं है। ${monthName} में ${daysInMonth} दिन होते हैं।`
    : `${d} ${monthName} ${y} is not a valid date. ${monthName} has ${daysInMonth} days.`;
}
function updateDate() {
  const d = new Date();
  const el = document.getElementById('hdate');
  if (el) el.innerHTML = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + '<br>' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

/* ============================================================
   DATA NORMALIZATION — the root-cause fix for NaN in Order
   History / Reports.
   Every numeric field on an order must be a real number before it
   ever enters a reduce()/sum. A single corrupt or legacy record
   (missing/undefined/string totalEggs or totalAmt — e.g. from an
   older app version, a hand-edited backup, or a partial cloud row)
   would otherwise poison every total derived from the whole array,
   since undefined/NaN + anything = NaN.
   Applied at every boundary where `orders` gets populated: local
   load (localStore.js), cloud restore (syncService.js pullAll),
   guest-data import (legacyMigration.js), and JSON backup import.
   This REPAIRS existing bad records in place rather than deleting
   real order history.
   ============================================================ */
function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function sanitizeOrder(o) {
  if (!o || typeof o !== 'object') return null;
  const items = Array.isArray(o.items) ? o.items.map(it => ({
    id: safeNum(it && it.id) || 1,
    type: (it && (it.type === 'tray' || it.type === 'box')) ? it.type : 'piece',
    qty: safeNum(it && it.qty),
    eggs: safeNum(it && it.eggs),
    ur: safeNum(it && it.ur),
    amt: safeNum(it && it.amt)
  })) : [];
  // If totals are missing/corrupt but the line items are intact, recompute
  // them from the items instead of just defaulting to zero — this recovers
  // real historical data rather than erasing it.
  const itemsEggSum = items.reduce((s, it) => s + it.eggs, 0);
  const itemsAmtSum = items.reduce((s, it) => s + it.amt, 0);
  const totalEggs = Number.isFinite(Number(o.totalEggs)) && o.totalEggs !== null ? safeNum(o.totalEggs) : itemsEggSum;
  const totalAmt = Number.isFinite(Number(o.totalAmt)) && o.totalAmt !== null ? safeNum(o.totalAmt) : itemsAmtSum;
  const bd = eggBD(totalEggs);
  return {
    id: safeNum(o.id),
    cname: (typeof o.cname === 'string' && o.cname.trim()) ? o.cname : 'Walk-in',
    cphone: typeof o.cphone === 'string' ? o.cphone : '',
    items,
    totalEggs, totalAmt,
    boxes: Number.isFinite(Number(o.boxes)) ? safeNum(o.boxes) : bd.boxes,
    trays: Number.isFinite(Number(o.trays)) ? safeNum(o.trays) : bd.trays,
    pieces: Number.isFinite(Number(o.pieces)) ? safeNum(o.pieces) : bd.pieces,
    paid: !!o.paid,
    isUdhar: !!o.isUdhar,
    ts: (typeof o.ts === 'string' && o.ts) ? o.ts : nowStr(),
    isoDate: (typeof o.isoDate === 'string' && o.isoDate) ? o.isoDate : isoToday()
  };
}

function sanitizeOrders(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(sanitizeOrder).filter(Boolean);
}

// Same problem class as orders: a single udhar entry/settlement missing
// `amt`, or a customer record missing `entries`/`settlements` arrays,
// would throw inside renderUdhar() (e.g. `e.amt.toFixed(2)` on
// undefined) — not just show NaN, but crash mid-render. Since boot()
// runs render calls in sequence, one bad record used to silently stop
// everything after it (including the auth check). Normalize on load.
function sanitizeUdhar(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  Object.keys(obj).forEach(name => {
    const u = obj[name] || {};
    const entries = (Array.isArray(u.entries) ? u.entries : []).map(e => ({
      orderId: e && e.orderId != null ? safeNum(e.orderId) : null,
      amt: safeNum(e && e.amt),
      itemDesc: (e && typeof e.itemDesc === 'string') ? e.itemDesc : '',
      boxes: safeNum(e && e.boxes), trays: safeNum(e && e.trays), pieces: safeNum(e && e.pieces),
      totalEggs: safeNum(e && e.totalEggs),
      ts: (e && typeof e.ts === 'string' && e.ts) ? e.ts : nowStr(),
      settled: !!(e && e.settled)
    }));
    const settlements = (Array.isArray(u.settlements) ? u.settlements : []).map(s => ({
      amt: safeNum(s && s.amt),
      ts: (s && typeof s.ts === 'string' && s.ts) ? s.ts : nowStr(),
      isoDate: (s && typeof s.isoDate === 'string' && s.isoDate) ? s.isoDate : isoToday()
    }));
    const paid = settlements.reduce((s, p) => s + p.amt, 0);
    const owed = entries.reduce((s, e) => s + e.amt, 0);
    out[name] = { entries, settlements, total: Number.isFinite(Number(u.total)) ? safeNum(u.total) : Math.max(0, +(owed - paid).toFixed(2)) };
  });
  return out;
}

// Repairs a corrupted/oversized stock total on load (e.g. accumulated
// before MAX_STOCK_EGGS validation existed on Add/Remove Stock — this
// is exactly the class of bug seen live: a stock value so large it
// broke the Stock card layout). Never deletes real inventory — only
// clamps a value that is NaN/Infinity/negative/over the safe ceiling
// down to the ceiling, since a corrupted total already can't be
// trusted as exact anyway.
function sanitizeStock(s) {
  const eggs = safeNum(s && s.eggs);
  return { eggs: Math.min(Math.max(0, eggs), MAX_STOCK_EGGS) };
}

// Same idea for the supplier ledger (custLedger).
function sanitizeCustLedger(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  Object.keys(obj).forEach(name => {
    const c = obj[name] || {};
    const entries = (Array.isArray(c.entries) ? c.entries : []).map(e => ({
      type: (e && (e.type === 'tray' || e.type === 'box')) ? e.type : 'piece',
      qty: safeNum(e && e.qty),
      ratePerEgg: safeNum(e && e.ratePerEgg),
      eggs: safeNum(e && e.eggs),
      boxes: safeNum(e && e.boxes), trays: safeNum(e && e.trays), pieces: safeNum(e && e.pieces),
      amt: safeNum(e && e.amt),
      origAmt: safeNum(e && (e.origAmt != null ? e.origAmt : e.amt)),
      isCredit: !!(e && e.isCredit),
      paid: !!(e && e.paid),
      ts: (e && typeof e.ts === 'string' && e.ts) ? e.ts : nowStr(),
      isoDate: (e && typeof e.isoDate === 'string' && e.isoDate) ? e.isoDate : isoToday()
    }));
    const payments = (Array.isArray(c.payments) ? c.payments : []).map(p => ({
      amt: safeNum(p && p.amt),
      ts: (p && typeof p.ts === 'string' && p.ts) ? p.ts : nowStr(),
      isoDate: (p && typeof p.isoDate === 'string' && p.isoDate) ? p.isoDate : isoToday()
    }));
    out[name] = {
      phone: (typeof c.phone === 'string') ? c.phone : '',
      entries, payments,
      totalOwed: Number.isFinite(Number(c.totalOwed)) ? safeNum(c.totalOwed) : entries.filter(e => e.isCredit && !e.paid).reduce((s, e) => s + e.amt, 0),
      totalBoxesBought: Number.isFinite(Number(c.totalBoxesBought)) ? safeNum(c.totalBoxesBought) : entries.reduce((s, e) => s + e.boxes, 0)
    };
  });
  return out;
}

/* ============================================================
   NUMERIC SAFETY LIMITS + CENTRALIZED INDIAN NUMBER FORMATTING
   ------------------------------------------------------------
   Root cause this section fixes: numeric inputs (Stock's Add/Remove
   fields in particular — confirmed live on Windows, see stock.js)
   used `parseInt(...) || 0` with no upper bound at all. Any garbled
   or oversized entry (or, worse, an accumulation of several) could
   push stock.eggs into the tens-of-quintillions and beyond, which
   then rendered as a raw unbroken digit string and blew out the
   Stock card layout. There was previously no single place that
   decided "how big is too big" or "how do we show a big number
   without breaking layout" — every screen would have had to solve
   both problems itself. This gives every screen ONE place to call
   into for both.
   ============================================================ */
// Per-field ceiling for a single manual quantity entry (boxes / trays /
// pieces typed into one Add/Remove field). 999,999 is far beyond any
// realistic single stock movement for this business (a box is 210
// eggs, so this already allows for over 200 million eggs in ONE
// field) while still keeping the number short enough to never break
// a card/table layout on its own, and staying nowhere near
// Number.MAX_SAFE_INTEGER once multiplied into eggs.
const MAX_QTY_PER_FIELD = 999999;
// Ceiling for the running TOTAL stock (in eggs) the app will hold.
// This is a defensive backstop, not a real-world expectation — at
// 1 billion eggs there is no plausible legitimate egg-business
// inventory this large; the limit exists purely to stop a runaway
// total (e.g. many oversized entries accumulated before this fix
// existed) from growing without bound. Still comfortably inside
// Number.MAX_SAFE_INTEGER (~9x10^15), so every downstream
// calculation (eggBD, totals, sync) stays exact.
const MAX_STOCK_EGGS = 999999999;
// Ceiling for a single order/Udhar/supplier money amount, in rupees.
// Chosen the same way: nowhere near a real transaction, purely a
// backstop against NaN/Infinity/garbled values reaching storage.
const MAX_SAFE_AMOUNT = 999999999999; // ~1 lakh crore

// Validates a single manual quantity field (boxes/trays/pieces typed
// by a person). Returns a finite non-negative integer within
// MAX_QTY_PER_FIELD, or `null` if the value is invalid/out of range —
// callers must check for null and refuse to apply the operation
// rather than silently clamping or rounding it away.
function validQtyField(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0; // blank field = "not entered", not an error
  const n = Number(raw);
  if (!Number.isFinite(n)) return null; // NaN / Infinity / -Infinity
  if (n < 0) return null;
  if (n > MAX_QTY_PER_FIELD) return null;
  return Math.floor(n);
}

// Ceiling for a per-egg rate (₹/egg), used by Suppliers and Rates.
// Real egg rates are single/low-double-digit rupees; this is a
// generous but bounded backstop (matches the same reasoning as the
// other MAX_* constants above) so a garbled/oversized rate entry
// can't produce an absurd total instead of being rejected outright.
const MAX_RATE_PER_EGG = 9999;

// Formats a number using Indian digit grouping (last 3 digits, then
// groups of 2): 1234567 -> 12,34,567. `decimals` is optional (omit
// for whole-number quantities like boxes/trays/pieces; pass 2 for
// money). Never throws on bad input — falls back to '0'.
function formatIndianNumber(value, decimals) {
  const n = Number(value);
  if (!Number.isFinite(n)) return decimals != null ? (0).toFixed(decimals) : '0';
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = decimals != null ? abs.toFixed(decimals) : String(Math.round(abs));
  const parts = fixed.split('.');
  let intPart = parts[0], decPart = parts[1];
  let lastThree = intPart.length > 3 ? intPart.slice(-3) : intPart;
  let other = intPart.length > 3 ? intPart.slice(0, -3) : '';
  if (other) lastThree = ',' + lastThree;
  const grouped = other.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  return (neg ? '-' : '') + grouped + (decPart !== undefined ? '.' + decPart : '');
}
function formatIndianCurrency(value) { return '₹' + formatIndianNumber(value, 2); }

// Compact lakh/crore notation for space-constrained displays (spec:
// summary cards / dashboards). Numbers below 1 lakh are shown with
// normal Indian grouping (they're already short); 1L and up switch
// to L/Cr with up to 2 decimals (trailing .00 trimmed).
function formatCompactIndian(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e7) return sign + trimTrailingZeros((abs / 1e7).toFixed(2)) + ' Cr';
  if (abs >= 1e5) return sign + trimTrailingZeros((abs / 1e5).toFixed(2)) + ' L';
  return formatIndianNumber(n);
}
function formatCompactCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  if (Math.abs(n) >= 1e5) return '₹' + formatCompactIndian(n);
  return formatIndianCurrency(n);
}
function trimTrailingZeros(s) { return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'); }

// Renders a number as compact text that expands to the full exact
// Indian-grouped value on click (spec: large numbers must never
// overflow their container, but the exact value must always remain
// available). Only made clickable when compacting actually changes
// the displayed text — a plain "12,500" is not wrapped in a useless
// clickable span. Safe to drop into any innerHTML template string.
let _expNumSeq = 0;
function formatExpandableNumber(value, isCurrency) {
  const full = isCurrency ? formatIndianCurrency(value) : formatIndianNumber(value);
  const compact = isCurrency ? formatCompactCurrency(value) : formatCompactIndian(value);
  if (compact === full) return `<span>${full}</span>`;
  const id = 'xn' + (++_expNumSeq) + '_' + Math.random().toString(36).slice(2, 6);
  return `<span class="exp-num" id="${id}" data-full="${esc(full)}" data-compact="${esc(compact)}" data-state="c" title="${esc(full)}" onclick="toggleExpandNum('${id}')">${esc(compact)}</span>`;
}
function formatExpandableCurrency(value) { return formatExpandableNumber(value, true); }
function toggleExpandNum(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const expanded = el.dataset.state === 'f';
  el.textContent = expanded ? el.dataset.compact : el.dataset.full;
  el.dataset.state = expanded ? 'c' : 'f';
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Generic debounce — used for search/filter inputs that re-filter and
// re-render a potentially large list on every keystroke (Order
// History, Stock Log search). Filtering + rebuilding a big table's
// rows synchronously on every single character typed is real,
// avoidable per-keystroke work; debouncing collapses a fast typing
// burst into one render after the user actually pauses, instead of
// one render per character.
function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait || 200);
  };
}
