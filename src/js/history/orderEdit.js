/* ============================================================
   EDIT ORDER (spec: Order History item 7/1, item 8 audit trail)
   ------------------------------------------------------------
   Scope, deliberately kept minimal per "do not speculate / smallest
   appropriate fix": this edits customer name/phone, Udhar on/off, and
   line items (add/remove/change qty) of an EXISTING order, in place —
   same id, same original timestamp. It does NOT touch pricing rules
   (reuses calcTotalWithDiscount(), the exact function normal billing
   uses) and does NOT touch the sync layer — pushAll() already re-
   pushes every order in `orders` keyed by its own id on each sync, so
   an in-place edit here reaches the cloud on the next normal sync
   with no separate code path required.

   SAFETY RULES (spec section 1/7/10 — never partially apply, never
   corrupt a settled ledger):
   - Stock is reconciled atomically: old order's eggs are notionally
     added back, the edit is validated against that, and only if it
     fits does the new total get deducted — all in one place, so
     there is no state where only half the change has happened.
   - If ANY money has already been received against this order's
     Udhar entry (settled, or partially settled — amt no longer
     equals what was originally recorded), the edit is refused
     outright and the order is left completely untouched. The
     current data model has no "original amount before settlement"
     field to reconcile against safely, so guessing would risk
     silently corrupting payment history — refusing is the honest
     choice here, not a missing feature.
   ============================================================ */
let edCtx = null; // { order, items:[...], dc, blocked:bool, blockedReason:'' }
let _expandedHistOrders = new Set();

function _findUdharEntry(o) {
  const u = udhar[o.cname];
  if (!u) return null;
  return u.entries.find(e => e.orderId === o.id) || null;
}

// True if money has already been received against this order specifically
// (fully settled, or partially settled — its amt no longer matches the
// order's own totalAmt, which is the only signal this data model has).
function _orderHasSettlementActivity(o) {
  if (!o.isUdhar) return false;
  const e = _findUdharEntry(o);
  if (!e) return false; // no linked entry to reconcile — nothing to block on
  if (e.settled) return true;
  if (Math.abs(safeNum(e.amt) - safeNum(o.totalAmt)) > 0.01) return true; // partially reduced by a settlement
  return false;
}

function openEditOrder(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;
  const blocked = _orderHasSettlementActivity(o);
  edCtx = {
    order: o,
    items: JSON.parse(JSON.stringify(o.items || [])),
    dc: (o.items || []).reduce((m, it) => Math.max(m, it.id || 0), 0),
    isUdhar: !!o.isUdhar,
    blocked,
    blockedReason: blocked ? (lang === 'hi'
      ? 'इस ऑर्डर पर पहले ही भुगतान प्राप्त हो चुका है — सुरक्षित रूप से संपादित नहीं किया जा सकता।'
      : 'Payment has already been received against this order — it cannot be safely edited without risking the payment ledger.')
      : ''
  };
  document.getElementById('edord-cname').value = o.cname === 'Walk-in' || o.cname === 'सामान्य ग्राहक' ? '' : o.cname;
  document.getElementById('edord-cphone').value = o.cphone || '';
  document.getElementById('edord-udhar').value = o.isUdhar ? 'yes' : 'no';
  document.getElementById('edord-udhar').disabled = edCtx.blocked;
  document.getElementById('edord-cname').disabled = edCtx.blocked;
  document.getElementById('edord-cphone').disabled = edCtx.blocked;
  const warn = document.getElementById('edord-blocked-warn');
  if (warn) warn.style.display = edCtx.blocked ? 'block' : 'none';
  if (warn) warn.textContent = edCtx.blockedReason;
  document.getElementById('edord-save-btn').style.display = edCtx.blocked ? 'none' : '';
  document.getElementById('edord-type').value = 'box';
  document.getElementById('edord-qty').value = '';
  edRenderItems();
  document.getElementById('edord-modal').style.display = 'flex';
}

function closeEditOrder() { document.getElementById('edord-modal').style.display = 'none'; edCtx = null; }

function edRemainingStock() {
  if (!edCtx) return 0;
  const draftedEggs = edCtx.items.reduce((s, x) => s + safeNum(x.eggs), 0);
  // Old order's own eggs are available to reuse (temporarily "given back")
  // on top of whatever is currently free in stock.
  const pool = stock.eggs + safeNum(edCtx.order.totalEggs);
  return Math.max(0, pool - draftedEggs);
}

function edAddItem() {
  if (!edCtx || edCtx.blocked) return;
  const t = document.getElementById('edord-type').value;
  const q = parseInt(document.getElementById('edord-qty').value);
  if (!rates[t]) { toast(lang === 'hi' ? 'दर सेट नहीं है' : 'Rate not set for this item type', 'te'); return; }
  if (!q || q <= 0) { toast(lang === 'hi' ? 'सही मात्रा डालें' : 'Enter valid quantity', 'te'); return; }
  const eggs = eFor(t, q);
  if (eggs > edRemainingStock()) {
    toast('⚠️ ' + (lang === 'hi' ? 'स्टॉक में इतना नहीं है' : 'Not enough stock available for this edit'), 'te');
    return;
  }
  edCtx.dc++;
  edCtx.items.push({ id: edCtx.dc, type: t, qty: q, eggs, ur: rates[t], amt: +(rates[t] * q).toFixed(2) });
  document.getElementById('edord-qty').value = '';
  edRenderItems();
}
function edRmItem(id) { if (!edCtx) return; edCtx.items = edCtx.items.filter(x => x.id !== id); edRenderItems(); }
function edQtyChange(id, val) {
  if (!edCtx) return;
  const it = edCtx.items.find(x => x.id === id);
  if (!it) return;
  const q = parseInt(val);
  if (!q || q <= 0) return; // ignore invalid interim typing; user must leave a valid qty to keep the line
  const newEggs = eFor(it.type, q);
  const otherEggs = edCtx.items.filter(x => x.id !== id).reduce((s, x) => s + x.eggs, 0);
  const pool = stock.eggs + safeNum(edCtx.order.totalEggs);
  if (otherEggs + newEggs > pool) {
    toast('⚠️ ' + (lang === 'hi' ? 'स्टॉक में इतना नहीं है' : 'Not enough stock for that quantity'), 'te');
    edRenderItems(); // re-render to reset the input back to the last valid value
    return;
  }
  it.qty = q; it.eggs = newEggs; it.amt = +(it.ur * q).toFixed(2);
  edRenderItems();
}

function edRenderItems() {
  if (!edCtx) return;
  const body = document.getElementById('edord-items-body');
  body.innerHTML = !edCtx.items.length
    ? `<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:.75rem">${lang === 'hi' ? 'कोई आइटम नहीं' : 'No items'}</td></tr>`
    : edCtx.items.map(it => `<tr>
      <td><span class="badge b${it.type}">${tName(it.type)}</span></td>
      <td style="width:80px"><input type="number" min="1" step="1" value="${it.qty}" ${edCtx.blocked ? 'disabled' : ''} style="height:28px;font-size:12px" onchange="edQtyChange(${it.id},this.value)"/></td>
      <td style="color:var(--t2)">${formatIndianCurrency(it.ur)}</td>
      <td style="font-weight:700;color:var(--acc)">${formatIndianCurrency(it.amt)}</td>
      <td>${edCtx.blocked ? '' : `<button class="ib ib-red" onclick="edRmItem(${it.id})">✕</button>`}</td>
    </tr>`).join('');
  const pricing = calcTotalWithDiscount(edCtx.items);
  document.getElementById('edord-total').textContent = formatIndianCurrency(pricing.total);
  edCtx.pricing = pricing;
}

function edSave() {
  if (!edCtx || edCtx.blocked) return;
  const o = edCtx.order;
  const newCname = document.getElementById('edord-cname').value.trim() || (lang === 'hi' ? 'सामान्य ग्राहक' : 'Walk-in');
  const newCphone = document.getElementById('edord-cphone').value.trim();
  const newIsUdhar = document.getElementById('edord-udhar').value === 'yes';
  if (newIsUdhar && !newCname) { toast(lang === 'hi' ? 'उधार के लिए नाम अनिवार्य है' : 'Customer name required for Udhar', 'te'); return; }
  if (!edCtx.items.length) { toast(lang === 'hi' ? 'कम से कम एक आइटम रखें' : 'Order must have at least one item', 'te'); return; }

  const pricing = calcTotalWithDiscount(edCtx.items);
  const newTotalEggs = pricing.eggs;
  const newTotalAmt = pricing.total;
  if (!(newTotalAmt > 0)) { toast(lang === 'hi' ? 'कुल राशि ₹0 है' : 'Total amount is ₹0', 'te'); return; }

  // ── STOCK: reconcile atomically (spec section 1/7) ──────────────
  const oldEggs = safeNum(o.totalEggs);
  const pool = stock.eggs + oldEggs;
  if (newTotalEggs > pool) {
    toast('⚠️ ' + (lang === 'hi'
      ? `स्टॉक में सिर्फ ${bdStr(pool)} उपलब्ध है — बदलाव नहीं किया जा सका। ऑर्डर पहले जैसा रहा।`
      : `Only ${bdStr(pool)} available — edit not applied. Order left unchanged.`), 'te');
    return;
  }
  // Nothing below this line can fail — every remaining step commits together.
  stock.eggs = pool - newTotalEggs;
  if (oldEggs !== newTotalEggs) {
    if (oldEggs > 0) stockLog.unshift({ ts: nowStr(), isoDate: isoToday(), type: 'IN', boxes: eggBD(oldEggs).boxes, trays: eggBD(oldEggs).trays, pieces: eggBD(oldEggs).pieces, note: (lang === 'hi' ? 'ऑर्डर संपादित, स्टॉक वापस — #' : 'Order edited, stock reversed — #') + o.id });
    if (newTotalEggs > 0) stockLog.unshift({ ts: nowStr(), isoDate: isoToday(), type: 'OUT', boxes: eggBD(newTotalEggs).boxes, trays: eggBD(newTotalEggs).trays, pieces: eggBD(newTotalEggs).pieces, note: (lang === 'hi' ? 'ऑर्डर संपादित — #' : 'Order edited — #') + o.id + (newCname ? ' — ' + newCname : '') });
  }

  // ── UDHAR: reconcile without duplicating or losing entries (spec section 1/10) ──
  const oldCname = o.cname, oldIsUdhar = o.isUdhar, oldAmt = safeNum(o.totalAmt);
  const bd = eggBD(newTotalEggs);
  const iDesc = edCtx.items.map(it => it.qty + ' ' + tName(it.type)).join(', ');
  if (oldIsUdhar) {
    const u = udhar[oldCname];
    const entry = u ? u.entries.find(e => e.orderId === o.id) : null;
    if (entry && u) {
      u.entries = u.entries.filter(e => e !== entry);
      u.total = Math.max(0, +(u.total - oldAmt).toFixed(2));
      if (!u.entries.length && !(u.settlements || []).length) delete udhar[oldCname];
    }
  }
  if (newIsUdhar) {
    if (!udhar[newCname]) udhar[newCname] = { entries: [], total: 0, settlements: [] };
    udhar[newCname].entries.unshift({ orderId: o.id, amt: newTotalAmt, itemDesc: iDesc, boxes: bd.boxes, trays: bd.trays, pieces: bd.pieces, totalEggs: newTotalEggs, ts: o.ts, settled: false });
    udhar[newCname].total = +(udhar[newCname].total + newTotalAmt).toFixed(2);
  }

  // ── AUDIT TRAIL (spec section 8) — minimal but real: what changed, when ──
  const changes = [];
  if (oldCname !== newCname) changes.push((lang === 'hi' ? 'ग्राहक: ' : 'Customer: ') + oldCname + ' \u2192 ' + newCname);
  if (o.cphone !== newCphone) changes.push((lang === 'hi' ? 'फ़ोन: ' : 'Phone: ') + (o.cphone || '\u2014') + ' \u2192 ' + (newCphone || '\u2014'));
  if (oldAmt.toFixed(2) !== newTotalAmt.toFixed(2)) changes.push((lang === 'hi' ? 'राशि: ' : 'Amount: ') + formatIndianCurrency(oldAmt) + ' \u2192 ' + formatIndianCurrency(newTotalAmt));
  if (oldEggs !== newTotalEggs) changes.push((lang === 'hi' ? 'मात्रा: ' : 'Qty: ') + bdStr(oldEggs) + ' \u2192 ' + bdStr(newTotalEggs));
  if (oldIsUdhar !== newIsUdhar) changes.push((lang === 'hi' ? 'भुगतान प्रकार: ' : 'Payment: ') + (oldIsUdhar ? 'Udhar' : 'Cash') + ' \u2192 ' + (newIsUdhar ? 'Udhar' : 'Cash'));
  if (changes.length) {
    if (!Array.isArray(o.editHistory)) o.editHistory = [];
    o.editHistory.push({ ts: nowStr(), changes });
  }

  // ── COMMIT — same id, original creation ts preserved ────────────
  o.cname = newCname; o.cphone = newCphone;
  o.items = JSON.parse(JSON.stringify(edCtx.items));
  o.totalEggs = newTotalEggs; o.totalAmt = newTotalAmt;
  o.boxes = bd.boxes; o.trays = bd.trays; o.pieces = bd.pieces;
  o.isUdhar = newIsUdhar; o.paid = !newIsUdhar;

  closeEditOrder();
  renderStock(); renderStockLog();
  updUdharCount(); if (typeof refreshUdharDatalist === 'function') refreshUdharDatalist(); renderUdhar();
  renderHist(); if (typeof renderReport === 'function') renderReport();
  svSync();
  toast(lang === 'hi' ? 'ऑर्डर अपडेट किया गया #' + o.id : 'Order updated #' + o.id, 'ts');
}

function toggleOrderHistory(id) {
  if (_expandedHistOrders.has(id)) _expandedHistOrders.delete(id); else _expandedHistOrders.add(id);
  renderHist();
}
