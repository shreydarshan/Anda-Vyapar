/* ============================================================
   PRINTER SETTINGS
   Lets the shop owner pick the installed H80i (or any) thermal
   printer once, and tune the physical print layout if their
   printer's own driver/hardware shifts content left or right —
   a pure-CSS fix cannot guarantee that on every driver, so this
   is exposed as an adjustable Left Margin rather than promised
   away. See PrintLayout below for the defaults.
   ============================================================ */

// Starting-point layout for an 80mm roll: 72mm printable area is a
// common default for this printer class, but it is NOT physically
// verified for your specific H80i — it's a reasonable starting guess,
// adjustable in Settings after a real Test Print on your hardware.
// 0mm extra left margin to start. All three are user-adjustable in
// Settings without touching code, per spec section 14.
const PrintLayout = {
  defaultsFor(paperWidthMm) {
    const pw = parseInt(paperWidthMm) || 80;
    return { paperWidthMm: pw, printableWidthMm: pw === 58 ? 46 : 72, leftMarginMm: 0 };
  },
  current() {
    const pw = parseInt(shop.paperWidth) || 80;
    const d = this.defaultsFor(pw);
    return {
      paperWidthMm: pw,
      printableWidthMm: shop.printableWidthMm != null ? shop.printableWidthMm : d.printableWidthMm,
      leftMarginMm: shop.printLeftMarginMm != null ? shop.printLeftMarginMm : d.leftMarginMm
    };
  }
};

const PrinterSettings = (function () {
  async function populateList() {
    const sel = document.getElementById('printer-select');
    if (!sel || !IS_ELECTRON || !window.electronAPI.getPrinters) return;
    try {
      const printers = await window.electronAPI.getPrinters();
      const saved = shop.selectedPrinter || '';
      sel.innerHTML = '<option value="">' + (lang === 'hi' ? '(डिफ़ॉल्ट प्रिंटर)' : '(System default printer)') + '</option>' +
        printers.map(p => {
          const notReady = typeof p.status === 'number' && p.status !== 0;
          const label = (p.displayName || p.name) + (p.isDefault ? ' ★' : '') + (notReady ? ' — offline/unavailable' : '');
          return `<option value="${p.name}" ${p.name === saved ? 'selected' : ''}>${label}</option>`;
        }).join('');
    } catch (e) {
      console.warn('Could not list printers:', e);
    }
  }

  function save() {
    const sel = document.getElementById('printer-select');
    if (!sel) return;
    shop.selectedPrinter = sel.value;
    const dlg = document.getElementById('printer-show-dialog');
    if (dlg) shop.showPrintDialog = !!dlg.checked;
    sv();
    toast(lang === 'hi' ? 'प्रिंटर सेव हुआ' : 'Printer saved', 'ts');
  }

  function saveLayout() {
    const w = document.getElementById('printer-printable-width');
    const m = document.getElementById('printer-left-margin');
    if (w && w.value !== '') shop.printableWidthMm = parseFloat(w.value);
    if (m && m.value !== '') shop.printLeftMarginMm = parseFloat(m.value);
    sv();
  }

  async function restore() {
    await populateList();
    const layout = PrintLayout.current();
    const w = document.getElementById('printer-printable-width');
    const m = document.getElementById('printer-left-margin');
    const dlg = document.getElementById('printer-show-dialog');
    if (w) w.value = layout.printableWidthMm;
    if (m) m.value = layout.leftMarginMm;
    if (dlg) dlg.checked = !!shop.showPrintDialog;
  }

  // Physical alignment test — deliberately uses the SAME container
  // math as real receipts (wrapReceiptHtml) so what you see here is
  // what billing will actually print. A 30-char ruler line makes any
  // left/right drift on the physical H80i obvious at a glance.
  function testPrint() {
    const layout = PrintLayout.current();
    const body = `
      <div class="center bold">CENTER TEST</div>
      <div class="hr"></div>
      <div class="mono">123456789012345678901234567890</div>
      <div class="hr"></div>
      <div class="center">If this block is not centered on your</div>
      <div class="center">paper, adjust Left Margin in Settings.</div>`;
    doPrint(wrapReceiptHtml(body, layout, 'Printer Test'));
  }

  // Printer READY (pre-check only — see doPrint()'s comment for why the
  // real print callback is the actual source of truth): Electron is
  // available, at least one printer is installed, and if a specific
  // printer was selected, Windows still reports it present. Where the
  // OS exposes a status code (Windows), a non-idle/error status is
  // treated as not ready rather than guessing.
  async function isReady() {
    if (!IS_ELECTRON || !window.electronAPI || !window.electronAPI.getPrinters) return false;
    try {
      const printers = await window.electronAPI.getPrinters();
      if (!printers.length) return false;
      const target = shop.selectedPrinter
        ? printers.find(p => p.name === shop.selectedPrinter)
        : printers.find(p => p.isDefault) || printers[0];
      if (!target) return false;
      // Electron/Windows PrinterInfo.status: 0 = idle/ready. Other
      // platforms often don't report this field at all — treat an
      // absent status as "unknown, assume installed = ready" rather
      // than blocking printing on platforms that don't expose it.
      if (typeof target.status === 'number' && target.status !== 0) return false;
      return true;
    } catch (e) { return false; }
  }

  return { populateList, save, saveLayout, restore, testPrint, isReady };
})();
