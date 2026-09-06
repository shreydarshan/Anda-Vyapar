/* ============================================================
   BACKUP / EXPORT / IMPORT
   Preserves the existing safety net: daily local backups plus
   manual JSON export/import. See electron/main.js for the
   Documents\Anda Vyapar Data\backups\ retention logic.
   ============================================================ */
let lastBackupTime = null;

function doInAppBackup() {
  try {
    const today = isoToday();
    // Scoped by account, not just by date — a global `av4_backup_<date>`
    // key meant that whichever account (or Local Mode) happened to
    // trigger the once-a-day backup FIRST on a given day silently
    // "used up" that day's slot for every other account on the same
    // device, since the check below thought a backup had already run
    // today regardless of which account actually did it.
    const backupKey = 'av4_backup_' + currentAccountKey + '_' + today;
    if (localStorage.getItem(backupKey)) return; // Already backed up today for THIS account
    const payload = JSON.stringify(buildPayload());
    localStorage.setItem(backupKey, payload);
    lastBackupTime = Date.now();
    // Clean old backups (keep last 30 per account)
    const prefix = 'av4_backup_' + currentAccountKey + '_';
    const keys = Object.keys(localStorage).filter(k => k.startsWith(prefix)).sort();
    while (keys.length > 30) { localStorage.removeItem(keys.shift()); }
    console.log('[Anda Vyapar] Daily backup created for', today);
  } catch (e) {}
}

function scheduleBackup() {
  doInAppBackup(); // Check on startup
  setInterval(doInAppBackup, 60 * 60 * 1000); // Check every hour
}

function exportJSON() {
  if (IS_ELECTRON) { doElectronExport(); return; }
  const d = buildPayload();
  const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'anda-vyapar-backup-' + isoToday() + '.json'; a.click();
  toast('JSON exported', 'ts');
}

async function doElectronExport() {
  if (IS_PYTHON_APP) { exportJSON(); return; }
  const res = await window.electronAPI.exportJSON(buildPayload());
  if (res.cancelled) return;
  if (res.ok) toast('Backup saved: ' + res.filePath, 'ts');
  else toast('Export failed', 'te');
}

function openDataFolder() {
  if (IS_ELECTRON) { window.electronAPI.openFolder(currentAccountKey); return; }
  if (IS_PYTHON_APP) { fetch('/api/open-folder').catch(() => {}); return; }
  toast(lang === 'hi' ? 'यह सुविधा सिर्फ डेस्कटॉप ऐप में है' : 'This feature is only in the desktop app', 'ti');
}

// Validates a parsed backup JSON's shape before it's allowed anywhere
// near applyPayload(). Returns { valid, error, preview } — never
// throws, so a malformed file always produces a clear message instead
// of a stack trace or silent corruption.
function validateBackupPayload(data) {
  if (!data || typeof data !== 'object') return { valid: false, error: 'Invalid backup file — not a recognizable JSON object.' };
  const hasAny = ['orders', 'rates', 'udhar', 'shop', 'stock', 'stockLog', 'custLedger'].some(k => k in data);
  if (!hasAny) return { valid: false, error: 'Invalid backup file — missing required Anda Vyapar data fields.' };
  // Backups made before this field existed have no `formatVersion` at
  // all — that's a known, valid legacy shape, not an error. Only a
  // version NEWER than this build understands is rejected outright,
  // since silently "importing" it would just quietly drop whatever
  // that future version added.
  if (typeof data.formatVersion === 'number' && data.formatVersion > AV_BACKUP_FORMAT_VERSION) {
    return { valid: false, error: `This backup was made with a newer version of Anda Vyapar (format v${data.formatVersion}) than this app supports (v${AV_BACKUP_FORMAT_VERSION}). Update the app before importing it.` };
  }
  if (data.orders !== undefined && !Array.isArray(data.orders)) return { valid: false, error: 'Invalid backup file — "orders" is not a list.' };
  if (data.udhar !== undefined && typeof data.udhar !== 'object') return { valid: false, error: 'Invalid backup file — "udhar" is not a valid record.' };
  if (data.custLedger !== undefined && typeof data.custLedger !== 'object') return { valid: false, error: 'Invalid backup file — "custLedger" is not a valid record.' };
  const orderCount = Array.isArray(data.orders) ? data.orders.length : 0;
  const supplierCount = data.custLedger ? Object.keys(data.custLedger).length : 0;
  const udharCount = data.udhar ? Object.keys(data.udhar).length : 0;
  return {
    valid: true,
    preview: `${orderCount} order${orderCount === 1 ? '' : 's'}, ${supplierCount} supplier${supplierCount === 1 ? '' : 's'}, ${udharCount} udhar customer${udharCount === 1 ? '' : 's'}` + (data.shop && data.shop.name ? `, shop "${data.shop.name}"` : '')
  };
}

async function doElectronImport() {
  const res = await window.electronAPI.importJSON();
  if (res.cancelled) return;
  if (!res.ok) { toast(lang === 'hi' ? 'फ़ाइल पढ़ने में विफल' : 'Could not read that file', 'te'); return; }

  const check = validateBackupPayload(res.data);
  if (!check.valid) { toast(check.error, 'te'); return; }

  // Non-blocking cross-account warning (spec: "optional if safe and
  // appropriate"). Old backups made before accountKey existed simply
  // have nothing to compare — no warning, not treated as a mismatch.
  // This never blocks the import; it only adds a line to the same
  // confirmation the user already has to click through, so they can
  // back out if this genuinely isn't the file they meant to use.
  let crossAccountNote = '';
  if (res.data.accountKey && res.data.accountKey !== currentAccountKey) {
    const fromLabel = res.data.accountLabel || res.data.accountKey;
    const toLabel = AccountStore.currentLabel();
    crossAccountNote = lang === 'hi'
      ? `\n\n⚠️ यह बैकअप "${fromLabel}" खाते का लगता है, लेकिन आप अभी "${toLabel}" में हैं। यह फिर भी आपके वर्तमान खाते में आयात होगा।`
      : `\n\n⚠️ This backup appears to be from a different account ("${fromLabel}") than the one you're currently on ("${toLabel}"). It will still be imported into your CURRENT account if you continue.`;
  }

  const msg = (lang === 'hi'
    ? `यह बैकअप आयात करें? इसमें है: ${check.preview}\n\nयह आपके वर्तमान लोकल डेटा को बदल देगा। यह पूर्ववत नहीं किया जा सकता।${crossAccountNote}`
    : `Import this backup? It contains: ${check.preview}\n\nThis will replace your current local data. This cannot be undone.${crossAccountNote}`);
  if (!(await showConfirm(msg))) return;

  // Safety snapshot before any destructive replacement — never skip this.
  try { localStorage.setItem('av4_backup_pre_jsonimport_' + Date.now(), JSON.stringify(buildPayload())); } catch (e) {}

  applyPayload(res.data); // already runs orders/udhar/custLedger through the sanitizers via applyPayload
  sv();
  applyLang(); restoreRates(); restoreShop(); refreshUdharDatalist(); refreshCpDatalist();
  updUdharCount(); renderStock(); renderStockLog(); renderHist(); renderUdhar(); renderReport(); renderCustPage();
  document.getElementById('order-count').textContent = orders.length;
  toast(lang === 'hi' ? 'डेटा सफलतापूर्वक आयात हुआ!' : 'Backup imported successfully!', 'ts');
  if (typeof SyncService !== 'undefined') SyncService.manualSync();
}

// Called after every local save; syncs in the background if a
// cloud session exists. Never blocks the UI or the caller.
async function svSync() {
  sv();
  if (typeof SyncService !== 'undefined') SyncService.syncInBackground();
}

// Explicit, confirmation-gated reset for the CURRENT account's local
// data only (Guest, or the signed-in user — whichever is active right
// now). This never touches cloud data and never runs automatically —
// it exists so a device that's accumulated old test/demo data across
// many sessions can be given a clean slate on purpose, without ever
// silently wiping a real business's history on every launch.
async function resetLocalWorkspace() {
  const accountLabel = AccountStore.currentLabel();
  const msg = lang === 'hi'
    ? `"${accountLabel}" का सारा लोकल डेटा (ऑर्डर, स्टॉक, उधार, सप्लायर, दरें) हटा दिया जाएगा। यह पूर्ववत नहीं किया जा सकता। क्लाउड डेटा प्रभावित नहीं होगा। जारी रखें?`
    : `This will permanently erase ALL local data for "${accountLabel}" — orders, stock, udhar, suppliers, and rates. This cannot be undone. Cloud data (if any) is not affected. Continue?`;
  if (!(await showConfirm(msg, {danger:true}))) return;
  // One more explicit confirmation for a genuinely destructive action.
  if (!(await showConfirm(lang === 'hi' ? 'पक्का? यह स्थायी है।' : 'Are you absolutely sure? This is permanent.', {danger:true}))) return;

  try { localStorage.setItem('av4_backup_pre_reset_' + Date.now(), JSON.stringify(buildPayload())); } catch (e) {}

  resetBusinessState();
  sv();
  // sv() marks the sync queue dirty (correct for a normal business
  // change), but a local-only reset must NEVER reach the cloud — the
  // confirmation dialog above explicitly promises "Cloud data is not
  // affected." Without this, the existing automatic background sync
  // (the 45s periodic timer, or the next online-reconnect) would see
  // the dirty flag within under a minute and push this account's
  // now-blank rates/shop/etc straight over its real cloud data. Local
  // persistence still happens via sv() above — this only cancels the
  // "please also sync this to the cloud" side effect of that save.
  if (typeof SyncQueue !== 'undefined') SyncQueue.clear();
  applyLang(); restoreRates(); restoreShop(); refreshUdharDatalist(); refreshCpDatalist();
  updUdharCount(); renderStock(); renderStockLog(); renderHist(); renderUdhar(); renderReport(); renderCustPage();
  document.getElementById('order-count').textContent = orders.length;
  toast(lang === 'hi' ? 'लोकल डेटा रीसेट हो गया' : 'Local workspace reset', 'ts');
}

// ── DELETE CLOUD DATA — a genuinely separate, stronger action than
// resetLocalWorkspace() above. Only reachable when signed in (the UI
// hides delete-cloud-section otherwise via updateAccountUI()). Deletes
// the account's rows from Supabase, THEN also clears the local copy
// so the two don't disagree with each other afterward — leaving the
// local cache full while the cloud is empty would just mean the next
// sync silently re-uploads everything that was just deleted.
function deleteCloudAccountData() {
  if (typeof AuthService === 'undefined' || !AuthService.getUser()) {
    toast(lang === 'hi' ? 'यह सिर्फ साइन-इन खातों के लिए है' : 'This is only for signed-in accounts', 'te');
    return;
  }
  document.getElementById('delete-cloud-confirm-input').value = '';
  document.getElementById('delete-cloud-confirm-btn').disabled = true;
  document.getElementById('delete-cloud-modal').style.display = 'flex';
  document.getElementById('delete-cloud-confirm-input').focus();
}
function closeDeleteCloudModal() {
  document.getElementById('delete-cloud-modal').style.display = 'none';
}
async function confirmDeleteCloudAccountData() {
  const input = document.getElementById('delete-cloud-confirm-input');
  if (input.value.trim() !== 'RESET') return; // belt-and-suspenders; button is already disabled until this matches
  const btn = document.getElementById('delete-cloud-confirm-btn');
  btn.disabled = true;
  btn.textContent = lang === 'hi' ? 'हटाया जा रहा है...' : 'Deleting...';

  try { localStorage.setItem('av4_backup_pre_clouddelete_' + Date.now(), JSON.stringify(buildPayload())); } catch (e) {}

  // Bug fix (error-handling audit, spec section 21): this used to have
  // no try/catch around the actual delete call. If deleteAllCloudData()
  // THREW instead of returning {ok:false} (a real possibility — network
  // errors, an unexpected Supabase response shape), execution jumped
  // straight out of this function: the button stayed disabled and
  // stuck on "Deleting...", the modal stayed open, and the user saw no
  // error at all — a genuine stuck-state bug, not a hypothetical one.
  try {
    const result = await SyncService.deleteAllCloudData();
    closeDeleteCloudModal();
    if (!result.ok) {
      toast((lang === 'hi' ? 'कुछ टेबल हटाने में विफल: ' : 'Some tables failed to delete: ') + (result.failures || []).join('; '), 'te');
      return; // local data is deliberately NOT cleared if the cloud delete was incomplete —
              // better to have a stale local copy you can retry from than to lose it too.
    }
    resetBusinessState();
    sv();
    applyLang(); restoreRates(); restoreShop(); refreshUdharDatalist(); refreshCpDatalist();
    updUdharCount(); renderStock(); renderStockLog(); renderHist(); renderUdhar(); renderReport(); renderCustPage();
    document.getElementById('order-count').textContent = orders.length;
    toast(lang === 'hi' ? 'क्लाउड डेटा स्थायी रूप से हटाया गया' : 'Cloud data permanently deleted', 'ts');
  } catch (e) {
    closeDeleteCloudModal();
    // Never hide the actual error — this used to show a fixed generic
    // message for any exception, which is exactly what made the
    // syncService.js bug (see its doc comment) impossible to diagnose
    // from the outside. Any future unexpected failure now surfaces its
    // real message too.
    toast((lang === 'hi' ? 'हटाने में त्रुटि: ' : 'Delete failed: ') + (e && e.message ? e.message : String(e)), 'te');
  } finally {
    // Guaranteed cleanup regardless of success, {ok:false}, or a thrown
    // exception — the button must never stay stuck disabled.
    btn.disabled = false;
    btn.textContent = lang === 'hi' ? 'स्थायी रूप से हटाएं' : 'Delete Permanently';
  }
}
