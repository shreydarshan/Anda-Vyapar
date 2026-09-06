/* ============================================================
   SHOP SETTINGS
   Supabase URL/key are no longer read from or written to here —
   see config.js. This file only handles real business settings.
   ============================================================ */
function saveShop() {
  shop.name = document.getElementById('sh-name').value.trim();
  shop.phone = document.getElementById('sh-phone').value.trim();
  shop.addr = document.getElementById('sh-addr').value.trim();
  const pw = document.getElementById('sh-paper-width');
  if (pw) shop.paperWidth = pw.value;
  // sv(), not svSync() — this fires on every keystroke (oninput), and
  // svSync() additionally kicks off a real Supabase round-trip
  // (SyncService.syncInBackground(), up to 8s timeout with retries
  // per attempt). That meant typing a shop name could trigger a full
  // cloud sync attempt on every character — a real, confirmed
  // contributor to the reported freezing, worse still if Supabase is
  // slow/unreachable and each attempt has to time out before the next
  // keystroke's attempt can even start. sv() still saves locally in
  // real time (correct, no data loss) and marks the sync queue dirty;
  // the existing 45s background timer and the online-reconnect
  // handler both already pick up dirty state on their own, so the
  // cloud still gets it — just not on every single keystroke.
  sv();
}
function restoreShop() {
  // Unconditional — this used to be `if (shop.name) ... .value = shop.name`,
  // which meant an EMPTY shop.name (e.g. right after Reset Local
  // Workspace) never touched the input at all, silently leaving
  // whatever text was already sitting in the DOM from before the
  // reset. The underlying data was correctly cleared; only the
  // on-screen field wasn't being told to clear itself to match. This
  // is the actual root cause of "Rates and Shop Details can still
  // appear after Reset Local Workspace" — always sync the field to
  // the real value, blank included.
  document.getElementById('sh-name').value = shop.name || '';
  document.getElementById('sh-phone').value = shop.phone || '';
  document.getElementById('sh-addr').value = shop.addr || '';
  const pw = document.getElementById('sh-paper-width');
  if (pw) pw.value = shop.paperWidth || '80'; // Old backups without this field default to 80mm
}
function restoreSettings() {
  restoreShop();
  renderQueueDisplay();
  if (typeof PrinterSettings !== 'undefined') PrinterSettings.restore();
}

// ── UDHAR TOGGLE (billing form) ──────────────────────────
function onUdharChg() {
  const isU = document.getElementById('order-udhar').value === 'yes';
  document.getElementById('cname-hint').textContent = isU ? (lang === 'hi' ? ' *अनिवार्य' : ' *required') : (lang === 'hi' ? ' (वैकल्पिक)' : ' (optional)');
}
