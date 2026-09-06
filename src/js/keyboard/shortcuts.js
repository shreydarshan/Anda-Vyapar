/* ============================================================
   GLOBAL KEYBOARD — Escape only.
   No F-key shortcuts anywhere in this app (explicitly requested).
   The actual fast-billing keyboard flow lives in
   billing/keyboardFlow.js and uses Enter/Tab/Arrow keys on the
   New Order form itself, which is a better fit for a real billing
   counter than memorized function keys.
   ============================================================ */
const KeyboardShortcuts = (function () {
  let bound = false;

  function closeOpenModal() {
    if (document.getElementById('slip-modal').style.display === 'flex') { closeSlip(); return true; }
    if (document.getElementById('settle-modal').style.display === 'flex') { closeSettleModal(); return true; }
    if (document.getElementById('cust-pay-modal').style.display === 'flex') { closeCustPayModal(); return true; }
    // Login/Signup modal — a pre-existing gap, never wired up to Escape at all.
    if (document.getElementById('auth-modal-bg').style.display === 'flex') { closeAuthModal(); return true; }
    // Edit modals added later in the app's life — each must be
    // registered here explicitly, since this list is the only thing
    // Escape actually checks.
    if (document.getElementById('edord-modal').style.display === 'flex') { closeEditOrder(); return true; }
    if (document.getElementById('eduh-modal').style.display === 'flex') { closeEditUdharEntry(); return true; }
    if (document.getElementById('edcp-modal').style.display === 'flex') { closeEditCustEntry(); return true; }
    if (document.getElementById('edsl-modal').style.display === 'flex') { closeEditStockLogEntry(); return true; }
    const deleteCloudModal = document.getElementById('delete-cloud-modal');
    if (deleteCloudModal && deleteCloudModal.style.display === 'flex') { closeDeleteCloudModal(); return true; }
    const confirmModal = document.getElementById('confirm-modal');
    if (confirmModal && confirmModal.style.display === 'flex') { closeConfirmModal(); return true; }
    return false;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      if (closeOpenModal()) { e.preventDefault(); return; }
      if (document.activeElement) document.activeElement.blur();
    }
  }

  function init() {
    if (bound) return;
    document.addEventListener('keydown', handleKeydown);
    bound = true;
  }

  return { init };
})();
