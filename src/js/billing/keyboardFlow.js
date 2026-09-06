/* ============================================================
   KEYBOARD-FIRST BILLING FLOW
   Customer Name -> Enter -> Phone -> Enter -> Item Type
   (Arrow keys to pick, Enter to confirm) -> Quantity -> Enter
   (valid qty: Add Item, loop back to Item Type for the next item;
   empty/invalid qty = "no more items" -> Payment) -> Enter on
   Payment focuses the actual Place Order button (a deliberate extra
   keystroke, not an instant submit) -> Enter again places the order
   -> save -> print -> focus returns to Customer Name automatically.

   The one rule that must never regress: adding a valid item must
   NEVER jump straight to Payment — it always loops back to Item
   Type. Only an EMPTY/invalid quantity on Enter moves to Payment,
   as the user's deliberate "no more items" signal.

   No function keys. Enter is the primary action key throughout.
   Arrow keys move between the three Item Type cards. Tab still
   works normally for anyone who prefers it — this only adds Enter
   as a fast path, it never removes normal focus behavior.
   ============================================================ */
const OrderTypeNav = (function () {
  function cards() { return Array.from(document.querySelectorAll('.ord-type-btn')); }
  function activeIndex() { return cards().findIndex(c => c.classList.contains('active')); }

  function selectByIndex(i) {
    const list = cards();
    if (!list.length) return;
    const idx = ((i % list.length) + list.length) % list.length;
    ordSetType(list[idx]);
    list[idx].focus();
  }

  function handleKeydown(e) {
    const list = cards();
    if (!list.includes(document.activeElement)) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); selectByIndex(activeIndex() + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); selectByIndex(activeIndex() - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); focusQty(); }
  }

  function focusQty() {
    const qty = document.getElementById('item-qty');
    if (qty) { qty.focus(); qty.select(); }
  }

  function init() {
    cards().forEach(c => c.setAttribute('tabindex', '0'));
    document.addEventListener('keydown', handleKeydown);
  }

  return { init, focusQty };
})();

const BillingKeyboardFlow = (function () {
  function onEnter(el, handler) {
    if (!el) return;
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      // setTimeout(0) lets native Enter behavior (e.g. committing a
      // <datalist> suggestion into the input's value) finish first,
      // so the handler always sees the final, real value.
      setTimeout(handler, 0);
    });
  }

  function focusCustomerName() {
    const el = document.getElementById('cname');
    if (el) { el.focus(); el.select(); }
  }

  function init() {
    const cname = document.getElementById('cname');
    const cphone = document.getElementById('cphone');
    const qty = document.getElementById('item-qty');
    const payment = document.getElementById('order-udhar');

    onEnter(cname, () => { if (cphone) cphone.focus(); });

    // Phone -> Item Type (not straight to Quantity). This was the actual
    // reason the mouse was still needed for the FIRST item of every
    // order: skipping this step meant the only way to pick anything
    // other than whatever type card was already "active" was a mouse
    // click. Landing on the active card lets OrderTypeNav's own
    // Arrow-key/Enter handling take over from here, matching the
    // documented flow at the top of this file and matching what
    // already happens correctly for the 2nd+ item in the same order.
    onEnter(cphone, () => {
      const active = document.querySelector('.ord-type-btn.active');
      if (active) active.focus(); else OrderTypeNav.focusQty();
    });

    onEnter(qty, () => {
      const val = parseFloat(qty.value);
      if (val > 0) {
        addItem();
        // Loop back to Item Type, ready for the next item — this is
        // the fast repeat-add cycle for a multi-item bill. This is
        // the part that must NEVER jump straight to Payment after
        // adding an item.
        const active = document.querySelector('.ord-type-btn.active');
        if (active) active.focus();
      } else {
        // Empty/invalid qty + Enter = "no more items, I'm done" ->
        // Payment. This is the user's deliberate signal to move on,
        // distinct from the valid-qty case above.
        if (payment) payment.focus();
      }
    });

    onEnter(payment, () => {
      // This used to call placeOrder() directly the instant Enter was
      // pressed here — which meant an accidental extra Enter (very
      // easy to trigger: press Enter on an empty Qty field to signal
      // "done adding items", then an old habitual second Enter lands
      // here and used to fire immediately) could finalize a real bill
      // — deduct stock, print — with no way to undo it. Landing on
      // the actual Place Order button instead of calling placeOrder()
      // directly adds exactly one deliberate keystroke at the one
      // point where a mistake can't be taken back, without losing
      // keyboard-only operation: Enter on a focused <button> still
      // submits it natively, so the flow is still "type, Enter, Enter,
      // Enter, Enter" — just with the last one landing on something
      // you can see is about to commit, and where a stray keypress
      // that lands anywhere else (Tab, Escape, a click elsewhere)
      // safely does nothing instead of billing.
      if (di.length) {
        const btn = document.getElementById('place-order-btn');
        if (btn) btn.focus(); else placeOrder();
      } else if (qty) { qty.focus(); }
    });

    OrderTypeNav.init();
  }

  return { init, focusCustomerName };
})();
