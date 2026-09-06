/* ============================================================
   ORDER DRAFT + PRICING + BILL PLACEMENT
   Pricing rules unchanged from the original app:
   1. Each item uses its own rate when added.
   2. If total eggs >= half a box (105), total = proportional box rate.
   3. Otherwise, total = sum of individual item amounts.
   ============================================================ */
function ordSetType(el) {
  document.querySelectorAll('.ord-type-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('item-type').value = el.getAttribute('data-type');
  updatePrev();
}
function refreshOrdTypeRates() {
  const rTray = document.getElementById('ord-rate-tray');
  const rBox = document.getElementById('ord-rate-box');
  const rPiece = document.getElementById('ord-rate-piece');
  if (rTray) rTray.textContent = rates.tray ? '₹' + rates.tray + '/tray' : '30 eggs';
  if (rBox) rBox.textContent = rates.box ? '₹' + rates.box + '/box' : '210 eggs';
  if (rPiece) rPiece.textContent = rates.piece ? '₹' + rates.piece + '/egg' : '1 egg';
}

// ── CUSTOMER HISTORY IN ORDER FORM ────────────────────────
function onCnameInput() {
  _debouncedCustHistory();
}
// This is the single highest-frequency input in the whole app — a
// customer name is typed for literally every order. The lookup itself
// (a full linear scan of `orders`, one .toLowerCase() string compare
// per order) is cheap for a small history but scales with total order
// count, and re-running it on every individual keystroke while typing
// a name is real, avoidable work piling up on the busiest input in
// the app. Debounced to right after the user pauses instead of once
// per character — short enough (150ms) that it's not perceptible as
// a delay, but it collapses a whole name's worth of keystrokes into
// one lookup instead of one per letter.
const _debouncedCustHistory = debounce(() => {
  const cn = document.getElementById('cname').value.trim();
  const panel = document.getElementById('cust-history-panel');
  if (!cn) { panel.style.display = 'none'; return; }
  const custOrders = orders.filter(o => o.cname && o.cname.toLowerCase() === cn.toLowerCase());
  const u = udhar[cn];
  if (!custOrders.length && !u) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('chp-name').textContent = cn;
  const udharBadge = document.getElementById('chp-udhar-badge');
  if (u && u.total > 0) {
    udharBadge.style.display = 'block';
    udharBadge.innerHTML = (lang === 'hi' ? 'उधार बाकी: ' : 'Udhar pending: ') + formatExpandableCurrency(u.total);
  } else { udharBadge.style.display = 'none'; }
  const totalPaid = custOrders.reduce((s, o) => s + (o.paid ? o.totalAmt : 0), 0);
  document.getElementById('chp-orders').textContent = custOrders.length;
  document.getElementById('chp-paid').innerHTML = formatExpandableCurrency(totalPaid);
  const last = custOrders[0];
  if (last) {
    document.getElementById('chp-last').textContent =
      last.items.map(it => it.qty + ' ' + tName(it.type)).join(', ') + ' — ' + formatIndianCurrency(last.totalAmt);
  }
  const recent = custOrders.slice(0, 3).map(o =>
    `<span style="color:var(--t2)">#${o.id} ${o.ts.split(',')[0]} — ${o.items.map(it => it.qty + ' ' + tName(it.type)).join(', ')} — <strong style="color:var(--acc)">${formatIndianCurrency(o.totalAmt)}</strong> <span style="color:${o.paid ? 'var(--grn)' : 'var(--red)'}">${o.isUdhar && !o.paid ? (lang === 'hi' ? 'उधार' : 'Udhar') : o.paid ? (lang === 'hi' ? 'भुगतान' : 'Paid') : (lang === 'hi' ? 'नकद' : 'Cash')}</span></span>`
  ).join('<br>');
  document.getElementById('chp-recent').innerHTML = recent;
  if (last && last.cphone && !document.getElementById('cphone').value) {
    document.getElementById('cphone').value = last.cphone;
  }
}, 150);

function calcTotalWithDiscount(items) {
  const te = items.reduce((s, x) => s + x.eggs, 0);
  const HALF_BOX = BE / 2; // 105
  if (rates.box && te >= HALF_BOX) {
    const proportional = +((te / BE) * rates.box).toFixed(2);
    const normalSum = +items.reduce((s, x) => s + x.amt, 0).toFixed(2);
    return {
      total: proportional, normal: normalSum, discounted: proportional, isDiscounted: true, eggs: te,
      note: lang === 'hi'
        ? `बॉक्स दर से: ${formatIndianNumber(te)} अंडे × ₹${(rates.box / BE).toFixed(3)}/अंडा = ${formatIndianCurrency(proportional)} (सामान्य: ${formatIndianCurrency(normalSum)})`
        : `Box rate applied: ${formatIndianNumber(te)} eggs × ₹${(rates.box / BE).toFixed(3)}/egg = ${formatIndianCurrency(proportional)} (normal: ${formatIndianCurrency(normalSum)})`
    };
  }
  const sum = +items.reduce((s, x) => s + x.amt, 0).toFixed(2);
  return { total: sum, normal: sum, discounted: null, isDiscounted: false, eggs: te, note: '' };
}

function updatePrev() {
  const t = document.getElementById('item-type').value;
  const q = parseFloat(document.getElementById('item-qty').value) || 0;
  document.getElementById('nr-warn').style.display = 'none';
  document.getElementById('stock-warn').style.display = 'none';
  const pn0 = document.getElementById('price-note'); if (pn0) pn0.textContent = '';
  if (!q || !rates[t]) { document.getElementById('prev-amt').textContent = '₹ —'; return; }
  document.getElementById('prev-amt').innerHTML = formatExpandableCurrency(rates[t] * q);
  if (rates.box) {
    const newEggs = eFor(t, q) + di.reduce((s, x) => s + x.eggs, 0);
    const HALF_BOX = BE / 2;
    const pn = document.getElementById('price-note');
    if (pn && newEggs >= HALF_BOX) {
      pn.textContent = lang === 'hi'
        ? `💡 कुल ${newEggs} अंडे ≥ आधा बॉक्स → बॉक्स दर से कुल गणना होगी`
        : `💡 Total ${newEggs} eggs ≥ half box → total will use box rate pricing`;
    }
  }
}

// Stock validation (spec section 5): a product with NO stock, or not
// enough stock for what's already in the draft plus this new line,
// must never be addable to a bill. Previously this check was gated
// behind `stock.eggs > 0`, which meant it was silently skipped
// entirely whenever stock was exactly 0 — the exact "0 stock still
// lets you print a bill" bug. It also compared the new line against
// the account's total stock without subtracting eggs already sitting
// in the current draft, so several small lines could individually
// pass while their sum exceeded what's actually available. Both are
// fixed here: always validate, and validate against remaining stock
// (total stock minus what's already drafted).
function addItem() {
  const t = document.getElementById('item-type').value;
  const q = validQtyField(document.getElementById('item-qty').value);
  if (!rates[t]) { document.getElementById('nr-warn').style.display = 'block'; return; }
  if (q === null) { toast(lang === 'hi' ? `सही मात्रा डालें (अधिकतम ${formatIndianNumber(MAX_QTY_PER_FIELD)})` : `Enter a valid quantity (max ${formatIndianNumber(MAX_QTY_PER_FIELD)})`, 'te'); return; }
  if (!q || q <= 0) { toast(lang === 'hi' ? 'सही मात्रा डालें' : 'Enter valid quantity', 'te'); return; }
  const eggs = eFor(t, q);
  const alreadyDrafted = di.reduce((s, x) => s + x.eggs, 0);
  const remainingStock = Math.max(0, stock.eggs - alreadyDrafted);
  if (eggs > remainingStock) {
    document.getElementById('stock-warn').style.display = 'block';
    document.getElementById('stock-warn-msg').textContent = '⚠️ ' + (lang === 'hi'
      ? `स्टॉक में सिर्फ ${bdStr(remainingStock)} बचा है, ${bdStr(eggs)} माँगा गया।`
      : `Insufficient stock: only ${bdStr(remainingStock)} available, but ${bdStr(eggs)} requested.`);
    return;
  }
  dc++;
  di.push({ id: dc, type: t, qty: q, eggs, ur: rates[t], amt: +(rates[t] * q).toFixed(2) });
  document.getElementById('item-qty').value = '';
  document.getElementById('prev-amt').textContent = '₹ —';
  // Fast repeated entry (spec section 19): keep focus on Qty so the
  // next item can be typed immediately without reaching for the mouse.
  document.getElementById('item-qty').focus();
  const pn = document.getElementById('price-note'); if (pn) pn.textContent = '';
  renderDraft();
}

function rmDraft(id) { di = di.filter(x => x.id !== id); renderDraft(); }

function renderDraft() {
  const wrap = document.getElementById('draft-wrap'), em = document.getElementById('draft-empty');
  if (!di.length) {
    wrap.style.display = 'none'; em.style.display = 'block';
    window._draftFinalTotal = null;
    return;
  }
  wrap.style.display = 'block'; em.style.display = 'none';

  document.getElementById('draft-body').innerHTML = di.map((it, i) => `<tr>
    <td style="color:var(--t3);font-size:11px">${i + 1}</td>
    <td><span class="badge b${it.type}">${tName(it.type)}</span></td>
    <td>${it.qty}</td>
    <td style="color:var(--t2)">${it.eggs}</td>
    <td style="color:var(--t2)">${formatIndianCurrency(it.ur)}</td>
    <td style="font-weight:700;color:var(--acc)">${formatExpandableCurrency(it.amt)}</td>
    <td><button class="ib ib-red" onclick="rmDraft(${it.id})">✕</button></td>
  </tr>`).join('');

  const pricing = calcTotalWithDiscount(di);
  const bd = eggBD(pricing.eggs);

  document.getElementById('d-box').innerHTML = formatExpandableNumber(bd.boxes);
  document.getElementById('d-tray').innerHTML = formatExpandableNumber(bd.trays);
  document.getElementById('d-piece').innerHTML = formatExpandableNumber(bd.pieces);
  document.getElementById('d-total').textContent = formatIndianNumber(pricing.total, 2);

  let dn = document.getElementById('draft-discount-note');
  if (!dn) {
    dn = document.createElement('div'); dn.id = 'draft-discount-note';
    dn.style.cssText = 'font-size:12px;margin-top:7px;padding:6px 10px;border-radius:6px;background:var(--gbg);border:1px solid var(--gb);color:var(--grn);font-weight:600;display:none';
    document.getElementById('draft-wrap').appendChild(dn);
  }
  if (pricing.isDiscounted) {
    dn.style.display = 'block';
    dn.innerHTML = `✓ ${pricing.note}`;
  } else {
    dn.style.display = 'none';
    dn.textContent = '';
  }

  window._draftFinalTotal = pricing.total;
}

function clearDraft() {
  di = []; dc = 0;
  ['cname', 'cphone', 'item-qty'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('order-udhar').value = 'no'; onUdharChg();
  document.getElementById('prev-amt').textContent = '₹ —';
  document.getElementById('nr-warn').style.display = 'none';
  document.getElementById('stock-warn').style.display = 'none';
  const pn = document.getElementById('price-note'); if (pn) pn.textContent = '';
  document.querySelectorAll('.ord-type-btn').forEach(b => b.classList.remove('active'));
  const boxBtn = document.querySelector('.ord-type-btn[data-type="box"]');
  if (boxBtn) boxBtn.classList.add('active');
  document.getElementById('item-type').value = 'box';
  const chp = document.getElementById('cust-history-panel');
  if (chp) chp.style.display = 'none';
  window._draftFinalTotal = null;
  renderDraft();
}

// Duplicate-bill protection (spec section 33): guards against a double
// Enter press creating two orders. Save is synchronous/local so the
// window is tiny, but we still disable + guard explicitly.
let _placingOrder = false;

function placeOrder() {
  if (_placingOrder) return; // Enter, Enter -> second press is ignored
  const isU = document.getElementById('order-udhar').value === 'yes';
  const cn = document.getElementById('cname').value.trim();
  if (isU && !cn) { toast(lang === 'hi' ? 'उधार के लिए नाम अनिवार्य है' : 'Customer name required for Udhar', 'te'); return; }
  if (!di.length) { toast(lang === 'hi' ? 'कम से कम एक आइटम जोड़ें' : 'Add at least one item', 'te'); return; }

  // Defense-in-depth against the exact #0 / ₹0.00 "ghost order" bug:
  // every line in the draft must have a real positive quantity and a
  // real positive amount, and the order as a whole must add up to a
  // positive total. addItem() already refuses to add a line with no
  // rate or zero quantity, so this should never actually trigger in
  // normal use — but it's the real, last-word gate before anything is
  // written to history or stock, so if any bad line ever gets into
  // the draft by some path this file doesn't currently know about,
  // nothing gets committed instead of silently saving a ₹0 record.
  const invalidLine = di.find(x => !(x.qty > 0) || !(x.eggs > 0) || !(x.amt > 0));
  if (invalidLine) {
    toast(lang === 'hi' ? 'अमान्य आइटम — बिल नहीं बन सका' : 'Invalid item in bill — order not placed', 'te');
    return;
  }
  const draftTotalAmt = di.reduce((s, x) => s + x.amt, 0);
  if (!(draftTotalAmt > 0)) {
    toast(lang === 'hi' ? 'कुल राशि ₹0 है — बिल नहीं बन सका' : 'Total amount is ₹0 — order not placed', 'te');
    return;
  }

  // Final stock check at the actual commit point (spec section 5) —
  // not just when items were added to the draft. Stock can move
  // between "add to draft" and "place order" (e.g. a manual stock
  // removal in another tab), so this is the real, last-word gate
  // that decides whether an order is allowed to exist at all. If it
  // fails, nothing below this point runs: no order, no stock
  // mutation, no receipt.
  const draftTotalEggs = di.reduce((s, x) => s + x.eggs, 0);
  if (draftTotalEggs > stock.eggs) {
    toast('⚠️ ' + (lang === 'hi'
      ? `स्टॉक में सिर्फ ${bdStr(stock.eggs)} बचा है, ${bdStr(draftTotalEggs)} चाहिए। ऑर्डर नहीं दिया जा सका।`
      : `Insufficient stock: only ${bdStr(stock.eggs)} available, but ${bdStr(draftTotalEggs)} required. Order not placed.`), 'te');
    return;
  }

  _placingOrder = true;
  const placeBtn = document.getElementById('place-order-btn');
  if (placeBtn) placeBtn.disabled = true;

  (async () => {
    try {
      counter++;
      const totalEggs = di.reduce((s, x) => s + x.eggs, 0);
      const normalTotal = +di.reduce((s, x) => s + x.amt, 0).toFixed(2);
      const totalAmt = (window._draftFinalTotal !== null && window._draftFinalTotal !== undefined)
        ? window._draftFinalTotal : normalTotal;
      window._draftFinalTotal = null;
      const bd = eggBD(totalEggs);
      const o = {
        id: counter, cname: cn || (lang === 'hi' ? 'सामान्य ग्राहक' : 'Walk-in'),
        cphone: document.getElementById('cphone').value.trim(),
        items: JSON.parse(JSON.stringify(di)), totalEggs, totalAmt,
        boxes: bd.boxes, trays: bd.trays, pieces: bd.pieces,
        paid: !isU, isUdhar: isU, ts: nowStr(), isoDate: isoToday()
      };
      orders.unshift(o); // local commit — this line IS the atomic save point
      document.getElementById('order-count').textContent = orders.length;
      deductStock(totalEggs, counter, cn);
      if (isU && cn) {
        if (!udhar[cn]) udhar[cn] = { entries: [], total: 0, settlements: [] };
        const iDesc = o.items.map(it => it.qty + ' ' + tName(it.type)).join(', ');
        udhar[cn].entries.unshift({ orderId: counter, amt: totalAmt, itemDesc: iDesc, boxes: bd.boxes, trays: bd.trays, pieces: bd.pieces, totalEggs, ts: o.ts, settled: false });
        udhar[cn].total += totalAmt;
        updUdharCount(); refreshUdharDatalist();
      }
      clearDraft(); renderHist();
      svSync(); // local save always first, cloud sync happens in background
      curSlipOrder = o;
      toast((lang === 'hi' ? 'ऑर्डर दिया गया #' : 'Order placed #') + counter, 'ts');

      // Save is already durable at this point. Printing happens next,
      // and we wait for it to actually finish before resetting the
      // form for the next customer — per the requested workflow.
      await handleBillPrinting(o);
    } finally {
      _placingOrder = false;
      if (placeBtn) placeBtn.disabled = false;
      // Ready for the next order — keyboard-first flow starts fresh.
      if (typeof BillingKeyboardFlow !== 'undefined') BillingKeyboardFlow.focusCustomerName();
    }
  })();
}
