/* ============================================================
   RECEIPT / PRINTING
   ONE receipt design only. buildReceiptBody() + wrapReceiptHtml()
   generate the exact same HTML for the on-screen preview, the real
   thermal print, and Test Print — there is no second layout anywhere
   in this file. Local commit happens BEFORE this runs (see
   billing/draft.js). doPrint() prefers Electron native printing
   (webContents.print via preload electronAPI.printReceipt) and falls
   back to a real on-screen iframe + window.print() only for web
   builds that have no native pipeline at all — never as a fallback
   from a failed Electron print.
   ============================================================ */
function openSlipModal(o){
  const layout = PrintLayout.current();
  const html = wrapReceiptHtml(buildReceiptBody(o, layout), layout, 'Bill #' + o.id);
  const frame = document.getElementById('modal-slip');
  frame.style.height = '200px'; // reset to a small baseline before measuring, so a shorter new receipt doesn't inherit a taller previous one's height
  frame.srcdoc = html; // same document the printer receives — preview can never diverge from print
  // Receipt height must be driven by actual content, not a large
  // fixed minimum — a short 2-3 item bill was leaving a big blank
  // area below "Thank you" inside a tall fixed-height iframe. Iframes
  // don't auto-size to their content by default, so measure the real
  // rendered height once the srcdoc has loaded and set the iframe to
  // match, plus a small safety margin.
  frame.onload = () => {
    try {
      const doc = frame.contentDocument;
      const h = doc && doc.body ? doc.body.scrollHeight : 0;
      frame.style.height = (h > 0 ? h + 16 : 200) + 'px';
    } catch (e) {
      frame.style.height = '340px'; // fallback if measurement fails for any reason
    }
  };
  document.getElementById('slip-modal').style.display='flex';
}

// Called right after a bill is saved locally (spec: save first, print
// only if the printer is actually ready — never auto-queue for later).
// Waits for the print job to actually finish (success or failure)
// before resolving, so the caller can wait for printing to complete
// before resetting the billing form for the next customer.
async function handleBillPrinting(o){
  openSlipModal(o); // always show the receipt for confirmation
  // The readiness pre-check only matters for SILENT printing (it's
  // trying to avoid firing a job at a printer that isn't there). When
  // "show print dialog" is on, the OS dialog itself is the readiness
  // check — it lists whatever's actually available (including virtual
  // printers like "Print to PDF"), so skip straight to it.
  const ready = shop.showPrintDialog ? true : await PrinterSettings.isReady();
  if(ready){
    await printModalSlip();
  } else {
    toast(lang==='hi'
      ? 'बिल सेव हुआ। प्रिंटर उपलब्ध नहीं — मैन्युअल प्रिंट करें।'
      : 'Bill saved. Printer unavailable — use Print when ready.', 'ti');
  }
}
function closeSlip(){document.getElementById('slip-modal').style.display='none';}

// ── THE ONLY RECEIPT LAYOUT IN THIS APP ──────────────────────────────
// Shared by the on-screen preview, real thermal printing, and the
// Test Print calibration page, so they can never look different.
function wrapReceiptHtml(bodyHtml, layout, title) {
  const pw = layout.paperWidthMm, cw = layout.printableWidthMm, lm = layout.leftMarginMm;
  const sideMargin = (pw - cw) / 2 + lm;
  return `<!DOCTYPE html><html><head><title>${title || 'Receipt'}</title><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff;color:#000;font-family:'Segoe UI',Arial,sans-serif;width:${pw}mm}
.receipt{width:${cw}mm;margin-left:${sideMargin}mm;padding:2mm 0 3mm;font-size:12px;line-height:1.4}
.center{text-align:center}
.bold{font-weight:700}
.shop{font-size:14px;font-weight:800;text-align:center;letter-spacing:.2px}
.meta{font-size:10px;text-align:center;color:#222}
.hr{border-top:1px dashed #000;margin:3px 0}
.kv{display:flex;justify-content:space-between;font-size:11px;gap:6px}
table{width:100%;border-collapse:collapse;font-size:11.5px;table-layout:fixed;margin-top:1px}
th{font-size:9.5px;text-align:left;font-weight:700;padding:1px 0;border-bottom:1px solid #000}
th.r,td.r{text-align:right}
td{padding:2px 0;vertical-align:top;word-break:break-word}
.tot{display:flex;justify-content:space-between;font-weight:800;font-size:14.5px;margin-top:2px}
.mono{font-family:'Courier New',monospace;font-size:11px;text-align:center;letter-spacing:.5px}
.foot{text-align:center;font-size:10.5px;margin-top:5px}
@page{size:${pw}mm auto;margin:0}
@media print{ html,body{width:${pw}mm;margin:0} }
</style></head><body><div class="receipt">${bodyHtml}</div></body></html>`;
}

// Only fields that actually have values, dynamically shrinks to
// content. No internal IDs, no sync/cloud/app-version info, no
// customer phone on the printed receipt (kept in the app's own
// History instead — a receipt is not the place for it), no
// redundant total-eggs line (the item rows already show quantity).
function buildReceiptBody(o, layout) {
  // No invented business name (spec: never show a fake default like
  // "Egg Seller" just because Shop Name was left blank). If the user
  // hasn't entered one, the header line is omitted entirely — the
  // receipt still works, it just starts directly at the bill info.
  const header = (shop.name ? `<div class="shop">${shop.name}</div>` : '')
    + (shop.phone ? `<div class="meta">${shop.phone}</div>` : '')
    + (shop.addr ? `<div class="meta">${shop.addr}</div>` : '');

  const billInfo = `<div class="kv"><span>Bill #${o.id}</span><span>${o.ts}</span></div>`
    + `<div class="kv"><span>${o.cname}</span></div>`;

  const itemRows = o.items.map(it => `<tr>
    <td>${tName(it.type)}</td>
    <td class="r">${formatIndianNumber(it.qty)}</td>
    <td class="r">${formatIndianNumber(it.ur, 0)}</td>
    <td class="r bold">${formatIndianNumber(it.amt, 2)}</td>
  </tr>`).join('');
  const table = `<table>
    <thead><tr><th>ITEM</th><th class="r">QTY</th><th class="r">RATE</th><th class="r">AMOUNT</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>`;

  const paymentLabel = o.isUdhar && !o.paid
    ? 'PAYMENT: UDHAR (PENDING)'
    : o.isUdhar ? 'PAYMENT: UDHAR (SETTLED)' : 'PAYMENT: CASH (PAID)';

  return header
    + `<div class="hr"></div>`
    + billInfo
    + `<div class="hr"></div>`
    + table
    + `<div class="hr"></div>`
    + `<div class="tot"><span>TOTAL</span><span>${formatIndianCurrency(o.totalAmt)}</span></div>`
    + `<div class="kv bold">${paymentLabel}</div>`
    + `<div class="hr"></div>`
    + `<div class="foot">Thank you</div>`;
}

function printModalSlip(){
  const o=curSlipOrder;if(!o)return Promise.resolve(false);
  const layout = PrintLayout.current();
  const html = wrapReceiptHtml(buildReceiptBody(o, layout), layout, 'Bill #' + o.id);
  return doPrint(html);
}

// ── PRINTING ──────────────────────────────────────────
// ROOT CAUSE (fixed below): the print iframe was created with
// `width:0;height:0;visibility:hidden`. Chromium's print pipeline rasterizes
// the iframe's own paint layer — a 0x0 + visibility:hidden box has NO paint
// layer, so print() sent a technically-valid but visually-empty job to the
// OS spooler. The printer then executed the page-end/cut command on that
// empty job — exactly the "feeds and cuts but prints nothing" symptom.
// Fix: keep the iframe at a real size, just move it off-screen instead of
// collapsing or hiding it, and wait for its real load event before printing.

// Single entry point used by printModalSlip() and PrinterSettings.testPrint()
// — the only two places in the app that ever print. Routes to Electron's
// native webContents.print() when available (preload API
// electronAPI.printReceipt) — this sidesteps the hidden-iframe paint bug
// entirely since printing then happens on a real top-level frame, not a
// nested 0-size iframe. Falls back to the fixed iframe method only for
// non-Electron web builds — never as a fallback from a failed native print.
// Returns true only if the OS actually accepted/completed the print job.
// This is the real source of truth for "was the printer ready" — a
// pre-check (PrinterSettings.isReady) can only rule out the obvious
// case of zero installed printers; only the OS print callback can
// confirm the job was genuinely accepted.
//
// IMPORTANT: in Electron, a failed native print job NEVER falls back to
// the browser/Chrome print dialog during normal billing — that silent
// fallback was a bug. A failure is reported honestly as "unavailable"
// and the caller decides what to show; no automatic retry happens here.
async function doPrint(html){
  if(IS_ELECTRON&&window.electronAPI&&window.electronAPI.printReceipt){
    try{
      const showDialog = !!shop.showPrintDialog;
      const res=await window.electronAPI.printReceipt(html, shop.selectedPrinter || undefined, showDialog);
      if(res&&res.ok){
        toast(lang==='hi'?'✓ रसीद प्रिंट हुई':'✓ Receipt printed','ts');
        return true;
      }
      // A user-cancelled dialog isn't a failure — don't scare them with
      // "unavailable" for something they chose to do.
      if(res&&res.cancelled){
        toast(lang==='hi'?'प्रिंट रद्द किया गया':'Print cancelled','ti');
      } else {
        toast(lang==='hi'?'प्रिंटर उपलब्ध नहीं':'Printer unavailable','te');
      }
      return false;
    }catch(e){
      toast(lang==='hi'?'प्रिंटर उपलब्ध नहीं':'Printer unavailable','te');
      return false;
    }
  }
  // Non-Electron (plain web) builds have no native print pipeline at
  // all, so the OS print dialog IS the normal path there — not a
  // fallback from a failure.
  printViaIframe(html);
  return true;
}

// Print using a hidden iframe instead of window.open()
// This avoids Electron's "open with app" dialog that appears for new windows/links
function printViaIframe(html){
  let frame=document.getElementById('print-iframe');
  if(!frame){
    frame=document.createElement('iframe');
    frame.id='print-iframe';
    // IMPORTANT: keep a real, non-zero box. Moving off-screen (not hiding via
    // visibility/width/height) avoids the empty-paint-layer print bug above.
    frame.style.cssText='position:fixed;top:0;left:-10000px;width:300px;height:500px;border:0';
    document.body.appendChild(frame);
  }

  const doc=frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Wait for the iframe's own load event (a real signal, not a guessed delay)
  const triggerPrint=()=>{
    requestAnimationFrame(()=>{
      setTimeout(()=>{
        const body=frame.contentDocument&&frame.contentDocument.body;
        // Debug visibility into exactly what will be sent to the printer
        console.log('[Anda Vyapar print] receipt HTML length:',body?body.innerHTML.length:0);
        console.log('[Anda Vyapar print] receipt offsetHeight:',body?body.offsetHeight:0);
        if(!body||!body.innerHTML.trim()||body.offsetHeight===0){
          console.error('[Anda Vyapar print] Receipt content is empty or has zero height — aborting to avoid a blank print job.');
          toast(lang==='hi'?'प्रिंट त्रुटि — रसीद खाली है':'Print error — receipt content is empty','te');
          return;
        }
        frame.contentWindow.focus();
        frame.contentWindow.print();
      },500);
    });
  };

  if(frame.contentDocument&&frame.contentDocument.readyState==='complete'){
    triggerPrint();
  }else{
    frame.onload=triggerPrint;
  }
}
