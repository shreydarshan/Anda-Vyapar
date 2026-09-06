/* ============================================================
   CUSTOM CONFIRM DIALOG — replaces window.confirm() everywhere
   ------------------------------------------------------------
   ROOT CAUSE (P0 stability investigation): window.confirm() in
   Electron is a SYNCHRONOUS, NATIVE dialog — it blocks the renderer's
   JS execution entirely until dismissed. This is a well-documented
   Electron/Chromium issue on Windows: after a native confirm()/alert()
   dialog closes, the renderer's focus/input state can be left stuck,
   so keyboard input silently stops reaching the page — no element is
   visibly disabled, no overlay is visible, which is exactly why it
   looked like an unexplained "freeze." Minimizing/restoring the
   window forces Windows to recompute focus, which is why that
   "fixed" it — a strong, specific match for the reported symptom.

   Every confirm() call in this codebase was audited (see history.js,
   udhar.js, ledger.js, stock.js, backup.js, authUI.js) and lines up
   exactly with the user's reported triggers: logout, Settings
   resets/imports, and delete/clear actions — "mainly when I log out
   or do critical changes in Settings." That match, not a guess, is
   why this was the fix applied rather than a speculative one.

   This modal is a normal async HTML modal like every other one in
   the app — it never blocks JS execution, so this class of freeze
   cannot happen through it.
   ============================================================ */
let _confirmResolve = null;

function showConfirm(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    document.getElementById('confirm-modal-msg').textContent = message;
    const okBtn = document.getElementById('confirm-modal-ok');
    okBtn.textContent = opts.okLabel || (lang === 'hi' ? 'ठीक है' : 'OK');
    okBtn.className = 'btn ' + (opts.danger ? 'br' : 'bp');
    document.getElementById('confirm-modal').style.display = 'flex';
    // Cancel is the safer default for a destructive confirmation —
    // matches what native confirm()'s Escape/close behavior did.
    document.getElementById('confirm-modal-cancel').focus();
  });
}
function _resolveConfirm(result) {
  document.getElementById('confirm-modal').style.display = 'none';
  const r = _confirmResolve;
  _confirmResolve = null;
  if (r) r(result);
}
function closeConfirmModal() { _resolveConfirm(false); }
