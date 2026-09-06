/* ============================================================
   APP BOOTSTRAP
   Offline-first startup: determine which workspace should be active
   (a restored authenticated session, or guest) BEFORE loading or
   rendering any business data, then load exactly that workspace and
   render it once. There is no "load guest, then silently replace it"
   step — a previously-authenticated user's own local data is what
   renders from the very first paint, whether or not the network is
   available. See restoreSessionForBoot()/finishAuthWiring() in
   authUI.js for the auth side of this sequence.

   IMPORTANT: every section below is independently fault-isolated.
   A previous version of this function ran render calls, the
   Import/Export button setup, tab navigation, and the auth check
   all in one straight-line sequence with no error handling — a
   single throw in ANY render call (e.g. from an old/legacy record
   with an unexpected shape) silently aborted everything after it,
   including the auth check and the desktop Import/Export panel.
   That was the actual root cause behind "stuck on Local billing"
   and "no Import Backup button" appearing together. Each step here
   now runs in its own try/catch so one failure can't cascade.
   ============================================================ */
function safeStep(label, fn) {
  try { fn(); }
  catch (e) { console.error('[Boot] step failed: ' + label, e); }
}

async function boot() {
  // 1) Determine workspace identity BEFORE loading or rendering any
  //    business data. This is the actual fix for "startup shows the
  //    wrong workspace": the old sequence always loaded 'guest' first
  //    (the default value of currentAccountKey) and only decided
  //    whether to switch to a real account afterward — so there was
  //    a real, if brief, window where guest data was the loaded
  //    workspace under an authenticated-looking header. Restoring the
  //    session FIRST and loading the correct workspace as the very
  //    first load means there is no "guest, then replaced" step.
  const restoredUser = await restoreSessionForBoot();
  const targetKey = restoredUser ? restoredUser.id : 'guest';

  // 2) Load ONLY that workspace's local data — via AccountStore.switchTo
  //    so this goes through the exact same flush/load/cloud-restore-on-
  //    first-login path as every other workspace transition (login,
  //    logout, account switch), not a second, diverging implementation.
  //    Offline-first: if restoredUser is set but there's no network,
  //    this still loads that account's LOCAL file — switchTo() only
  //    attempts a cloud pull when the account has no local data yet
  //    AND is actually reachable; it never blocks on network.
  try {
    await AccountStore.switchTo(targetKey);
  } catch (e) {
    console.error('[Boot] workspace load failed, starting empty:', e);
    resetBusinessState();
  }

  safeStep('applyLang', applyLang);
  safeStep('restoreRates', restoreRates);
  safeStep('restoreShop', restoreShop);
  safeStep('restoreSettings', restoreSettings);
  safeStep('refreshUdharDatalist', refreshUdharDatalist);
  safeStep('refreshCpDatalist', refreshCpDatalist);
  safeStep('updUdharCount', updUdharCount);
  safeStep('renderStock', renderStock);
  safeStep('renderStockLog', renderStockLog);
  safeStep('renderHist', renderHist);
  safeStep('renderUdhar', renderUdhar);
  safeStep('renderReport', renderReport);
  safeStep('renderCustPage', renderCustPage);
  safeStep('cleanupInvalidOrders', () => { if (typeof cleanupInvalidOrders === 'function') cleanupInvalidOrders(); });
  safeStep('orderCountBadge', () => { document.getElementById('order-count').textContent = orders.length; });
  safeStep('dateClock', () => { updateDate(); setInterval(updateDate, 30000); });
  safeStep('scheduleBackup', scheduleBackup);
  safeStep('updateAccountUI', updateAccountUI);

  safeStep('customerDatalist', () => {
    const cdl = document.getElementById('cdl');
    if (!cdl) return;
    const names = [...new Set(orders.map(o => o.cname).filter(n => n && n !== 'Walk-in' && n !== 'Walk-in Customer' && n !== 'सामान्य ग्राहक'))];
    cdl.innerHTML = names.map(n => `<option value="${n}">`).join('');
  });

  // These MUST run regardless of whether any render call above failed —
  // this is exactly the block that previously went silent.
  safeStep('showDataFolder', showDataFolder);
  safeStep('desktopPanelButtons', () => {
    if (!(IS_ELECTRON || IS_PYTHON_APP)) return;
    const expBtn = document.getElementById('electron-export-btn'); if (expBtn) expBtn.style.display = 'inline-flex';
    const impBtn = document.getElementById('electron-import-btn'); if (impBtn) impBtn.style.display = 'inline-flex';
    const folderBtn = document.getElementById('electron-folder-btn'); if (folderBtn) folderBtn.style.display = 'inline-flex';
    const note = document.getElementById('electron-data-note'); if (note) note.style.display = 'block';
  });

  // 2) Billing is ALWAYS the first screen — this must never be skipped.
  safeStep('goTab', () => {
    const hashTab = location.hash ? location.hash.slice(1) : '';
    goTab(hashTab && document.getElementById('page-' + hashTab) ? hashTab : 'orders');
    refreshOrdTypeRates();
  });
  safeStep('keyboardShortcuts', () => { if (typeof KeyboardShortcuts !== 'undefined') KeyboardShortcuts.init(); });
  safeStep('billingKeyboardFlow', () => { if (typeof BillingKeyboardFlow !== 'undefined') BillingKeyboardFlow.init(); });

  // 3) Auth wiring (form listeners, live auth-change listener, start
  //    background sync if appropriate) — this must ALWAYS run, same
  //    fault-isolation reasoning as every other step here.
  try {
    await finishAuthWiring(restoredUser);
  } catch (e) {
    console.error('[Auth] wiring failed — running local-only:', e);
    safeStep('fallbackSyncStatus', () => setSyncStatus('unconfigured'));
  }
}

document.addEventListener('DOMContentLoaded', boot);

// Respond to main.js's flush-before-close request (electron/main.js +
// preload.js). Guarantees the last debounced save actually reaches
// disk before the window is allowed to close, instead of racing a
// setTimeout against app quit. See localStore.js `flushPendingSave()`.
if (typeof IS_ELECTRON !== 'undefined' && IS_ELECTRON && window.electronAPI && window.electronAPI.onFlushRequest) {
  window.electronAPI.onFlushRequest(async () => {
    try {
      if (typeof flushPendingSave === 'function') await flushPendingSave();
    } catch (e) {
      console.error('[flush-before-close] failed:', e);
    } finally {
      window.electronAPI.ackFlushDone();
    }
  });
}
