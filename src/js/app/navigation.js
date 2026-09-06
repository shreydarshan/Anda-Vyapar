/* ============================================================
   TAB NAVIGATION
   Billing ("orders" page/tab) is the primary authenticated screen.
   Each tab's render call is fault-isolated: a bad record causing one
   tab's render to throw must never leave the tab bar and the page
   body out of sync (tab highlighted "active" while content silently
   never rendered) — the same principle as app/init.js's boot().
   ============================================================ */

// Auto-focus (spec section 8): the first logical input on the tab
// being switched to. Keeps the "no manual click to start typing"
// promise consistent everywhere, not just on the Orders screen.
// select() (where the element supports it) also puts existing text
// ready to be overwritten by typing, same as the billing flow does.
function focusTabPrimaryInput(t) {
  // Settings deliberately excluded: it's a review/configuration screen,
  // not a fast repeated-entry workflow like the others below, and
  // auto-focusing (and .select()-highlighting) Shop Name every time
  // someone just wants to glance at Settings was reported as actively
  // annoying — the user didn't click it, so nothing here should be
  // pre-selected as if they were about to type over it.
  const idByTab = {
    rates: 'r-piece',
    stock: 'add-box',
    udhar: 'u-cname',
    customers: 'cp-name'
  };
  const id = idByTab[t];
  if (!id) return; // 'orders' handled by BillingKeyboardFlow.focusCustomerName(); 'report' has no input
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  if (typeof el.select === 'function') el.select();
}

function goTab(t) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(tb => tb.classList.remove('active'));
  document.getElementById('page-' + t).classList.add('active');
  document.getElementById('tab-' + t).classList.add('active');
  try {
    if (t === 'orders') { renderHist(); refreshOrdTypeRates(); }
    if (t === 'stock') { renderStock(); renderStockLog(); }
    if (t === 'udhar') renderUdhar();
    if (t === 'report') renderReport();
    if (t === 'customers') renderCustPage();
    if (t === 'settings') { restoreSettings(); renderQueueDisplay(); }
  } catch (e) {
    console.error('[goTab] render failed for tab: ' + t, e);
  }
  try {
    if (t === 'orders') { if (typeof BillingKeyboardFlow !== 'undefined') BillingKeyboardFlow.focusCustomerName(); }
    else focusTabPrimaryInput(t);
  } catch (e) {
    console.error('[goTab] autofocus failed for tab: ' + t, e);
  }
}
