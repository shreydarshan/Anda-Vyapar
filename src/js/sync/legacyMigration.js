/* ============================================================
   GUEST DATA MIGRATION
   If Guest Mode already has local data and the user then logs in
   (or signs up), we NEVER silently merge it into their account.
   We show an explicit choice: Keep Local Only, or Import Into My
   Account. A local snapshot backup is taken before any merge.
   ============================================================ */
const LegacyMigration = (function () {
  function decisionFlagKey(uid) { return 'av4_guest_import_decision_' + uid; }

  // Reads the guest account's payload WITHOUT switching context or
  // touching in-memory state — this is a read-only peek.
  async function peekGuestPayload() {
    if (IS_ELECTRON) {
      try {
        const res = await window.electronAPI.loadData('guest');
        return (res.ok && res.data) ? res.data : null;
      } catch (e) { return null; }
    }
    if (IS_PYTHON_APP) return null; // guest/account separation not modeled server-side in that mode
    try {
      const p = K + 'guest_';
      const o = localStorage.getItem(p + 'o');
      if (!o) return null;
      return {
        rates: JSON.parse(localStorage.getItem(p + 'r') || 'null'),
        orders: JSON.parse(o),
        counter: parseInt(localStorage.getItem(p + 'c') || '0'),
        udhar: JSON.parse(localStorage.getItem(p + 'u') || '{}'),
        shop: JSON.parse(localStorage.getItem(p + 's') || 'null'),
        stock: JSON.parse(localStorage.getItem(p + 'stk') || '{"eggs":0}'),
        stockLog: JSON.parse(localStorage.getItem(p + 'sl') || '[]'),
        custLedger: JSON.parse(localStorage.getItem(p + 'cl') || '{}')
      };
    } catch (e) { return null; }
  }

  function hasRealData(payload) {
    if (!payload) return false;
    return (payload.orders && payload.orders.length > 0) ||
           (payload.custLedger && Object.keys(payload.custLedger).length > 0) ||
           (payload.stock && payload.stock.eggs > 0);
  }

  // Called right after a successful login/signup. Returns true if it
  // showed the choice UI (caller should keep the auth modal open).
  async function checkForGuestData() {
    const user = AuthService.getUser();
    if (!user) return false;
    if (currentAccountKey === 'guest') return false; // shouldn't happen, but be safe
    if (localStorage.getItem(decisionFlagKey(user.id))) return false; // already decided once

    const guestPayload = await peekGuestPayload();
    if (!hasRealData(guestPayload)) { localStorage.setItem(decisionFlagKey(user.id), '1'); return false; }

    window._pendingGuestPayload = guestPayload;
    const notice = document.getElementById('guest-data-notice');
    if (notice) {
      notice.style.display = 'block';
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('signup-form').style.display = 'none';
      const textEl = document.getElementById('guest-data-notice-text');
      if (textEl) textEl.textContent = `You have existing local data on this device (${guestPayload.orders.length} orders). Attach it to your account?`;
    }
    document.getElementById('auth-modal-bg').style.display = 'flex';
    return true;
  }

  function keepLocalOnly() {
    const user = AuthService.getUser();
    if (user) localStorage.setItem(decisionFlagKey(user.id), '1');
    document.getElementById('guest-data-notice').style.display = 'none';
    closeAuthModal();
    toast(lang === 'hi' ? 'लोकल डेटा वैसा ही रहेगा' : 'Local guest data left as-is', 'ti');
  }

  async function importIntoAccount() {
    const user = AuthService.getUser();
    const guestPayload = window._pendingGuestPayload;
    if (!user || !guestPayload) { keepLocalOnly(); return; }

    // Safety snapshot of both sides before merging anything.
    try {
      localStorage.setItem('av4_backup_pre_import_' + Date.now(), JSON.stringify({ guest: guestPayload, account: buildPayload() }));
    } catch (e) {}

    const idOffset = counter; // avoid colliding with the account's own order ids
    const remappedOrders = sanitizeOrders((guestPayload.orders || []).map(o => ({ ...o, id: safeNum(o.id) + idOffset })));
    orders = sanitizeOrders([...remappedOrders, ...orders]).sort((a, b) => b.id - a.id);
    counter = Math.max(counter, ...remappedOrders.map(o => o.id), 0);

    Object.keys(guestPayload.udhar || {}).forEach(name => {
      const g = guestPayload.udhar[name];
      if (!udhar[name]) udhar[name] = { entries: [], total: 0, settlements: [] };
      const remappedEntries = (g.entries || []).map(e => ({ ...e, orderId: e.orderId != null ? e.orderId + idOffset : null }));
      udhar[name].entries = [...remappedEntries, ...udhar[name].entries];
      udhar[name].settlements = [...(g.settlements || []), ...(udhar[name].settlements || [])];
      udhar[name].total = +((udhar[name].total || 0) + (g.total || 0)).toFixed(2);
    });

    stockLog = [...(guestPayload.stockLog || []), ...stockLog];
    stock.eggs = (stock.eggs || 0) + ((guestPayload.stock && guestPayload.stock.eggs) || 0);

    Object.keys(guestPayload.custLedger || {}).forEach(name => {
      const g = guestPayload.custLedger[name];
      if (!custLedger[name]) custLedger[name] = { phone: g.phone || '', entries: [], payments: [], totalOwed: 0, totalBoxesBought: 0 };
      custLedger[name].entries = [...(g.entries || []), ...custLedger[name].entries];
      custLedger[name].payments = [...(g.payments || []), ...(custLedger[name].payments || [])];
      custLedger[name].totalOwed = +((custLedger[name].totalOwed || 0) + (g.totalOwed || 0)).toFixed(2);
      custLedger[name].totalBoxesBought = (custLedger[name].totalBoxesBought || 0) + (g.totalBoxesBought || 0);
    });

    // Final normalization pass on the merged result.
    udhar = sanitizeUdhar(udhar);
    custLedger = sanitizeCustLedger(custLedger);

    sv();
    localStorage.setItem(decisionFlagKey(user.id), '1');
    document.getElementById('guest-data-notice').style.display = 'none';
    closeAuthModal();

    applyLang(); restoreRates(); restoreShop(); refreshUdharDatalist(); refreshCpDatalist();
    updUdharCount(); renderStock(); renderStockLog(); renderHist(); renderUdhar(); renderReport(); renderCustPage();
    document.getElementById('order-count').textContent = orders.length;

    toast(lang === 'hi' ? 'लोकल डेटा अकाउंट में जोड़ा गया' : 'Local data imported into your account', 'ts');
    if (typeof SyncService !== 'undefined') SyncService.manualSync();
  }

  return { checkForGuestData, keepLocalOnly, importIntoAccount };
})();
