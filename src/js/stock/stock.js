/* ============================================================
   STOCK MANAGEMENT
   Updates locally first, always. Never depends on Supabase.
   ============================================================ */
// Reads and validates the 3 (boxes/trays/pieces) fields of an
// Add/Remove group. Returns null (and shows a toast) if ANY field is
// invalid — NaN, negative, or over MAX_QTY_PER_FIELD — so an out-of-
// range entry is rejected outright rather than silently clamped or
// treated as 0. This is the actual fix for the "112223577430084326
// boxes" layout-breaking bug: that value could never pass validQtyField.
function readQtyGroup(boxId, trayId, pieceId) {
  const bRaw = document.getElementById(boxId).value;
  const tRaw = document.getElementById(trayId).value;
  const pRaw = document.getElementById(pieceId).value;
  const b = validQtyField(bRaw), t = validQtyField(tRaw), p = validQtyField(pRaw);
  if (b === null || t === null || p === null) {
    toast(lang === 'hi'
      ? `अमान्य मात्रा — हर फ़ील्ड 0 से ${formatIndianNumber(MAX_QTY_PER_FIELD)} के बीच होनी चाहिए`
      : `Invalid quantity — each field must be a whole number between 0 and ${formatIndianNumber(MAX_QTY_PER_FIELD)}`, 'te');
    return null;
  }
  return { b, t, p };
}
function addStock() {
  const g = readQtyGroup('add-box', 'add-tray', 'add-piece');
  if (!g) return;
  const { b, t, p } = g;
  const total = b * BE + t * TE + p;
  if (!total) { toast(lang === 'hi' ? 'कोई मात्रा डालें' : 'Enter at least one quantity', 'te'); return; }
  if (stock.eggs + total > MAX_STOCK_EGGS) {
    toast(lang === 'hi' ? 'कुल स्टॉक सीमा से अधिक होगा' : 'This would push total stock past the supported limit', 'te');
    return;
  }
  stock.eggs += total;
  stockLog.unshift({ ts: nowStr(), isoDate: isoToday(), type: 'IN', boxes: b, trays: t, pieces: p, note: lang === 'hi' ? 'स्टॉक जोड़ा' : 'Stock received', source: 'manual' });
  ['add-box', 'add-tray', 'add-piece'].forEach(id => document.getElementById(id).value = '');
  renderStock(); renderStockLog(); svSync();
  toast((lang === 'hi' ? 'स्टॉक जोड़ा — ' : 'Stock added — ') + bdStr(total), 'ts');
}
function removeStock() {
  const g = readQtyGroup('rem-box', 'rem-tray', 'rem-piece');
  if (!g) return;
  const { b, t, p } = g;
  const total = b * BE + t * TE + p;
  if (!total) { toast(lang === 'hi' ? 'कोई मात्रा डालें' : 'Enter at least one quantity', 'te'); return; }
  if (total > stock.eggs) { toast(lang === 'hi' ? 'स्टॉक में इतने नहीं हैं' : 'Not enough stock', 'te'); return; }
  stock.eggs -= total;
  stockLog.unshift({ ts: nowStr(), isoDate: isoToday(), type: 'OUT', boxes: b, trays: t, pieces: p, note: lang === 'hi' ? 'मैन्युअल हटाया' : 'Manual removal', source: 'manual' });
  ['rem-box', 'rem-tray', 'rem-piece'].forEach(id => document.getElementById(id).value = '');
  renderStock(); renderStockLog(); svSync();
  toast((lang === 'hi' ? 'स्टॉक घटाया — ' : 'Stock removed — ') + bdStr(total), 'ts');
}
function deductStock(totalEggs, orderId, cname) {
  if (stock.eggs <= 0) return;
  stock.eggs = Math.max(0, stock.eggs - totalEggs);
  const bd = eggBD(totalEggs);
  stockLog.unshift({ ts: nowStr(), isoDate: isoToday(), type: 'OUT', boxes: bd.boxes, trays: bd.trays, pieces: bd.pieces, note: (lang === 'hi' ? 'ऑर्डर #' : 'Order #') + orderId + (cname ? ' — ' + cname : '') });
}
// ── EDIT A MANUAL STOCK LOG ENTRY (spec section 9) ──────────────────
// Reverses this entry's original contribution to stock.eggs, validates
// the new values against the resulting pool (never allowing stock to
// go negative), then applies the new contribution — same atomic
// reverse-validate-reapply pattern used for Order Edit and Supplier
// Entry Edit. Only reachable for source==='manual' entries (see
// renderStockLog) so a derived entry can never be edited out of sync
// with the record that actually produced it.
let stkLogEditCtx = null;
function openEditStockLogEntry(idx) {
  const l = stockLog[idx];
  if (!l || l.source !== 'manual') return;
  stkLogEditCtx = idx;
  document.getElementById('edsl-type').value = l.type;
  document.getElementById('edsl-box').value = l.boxes || '';
  document.getElementById('edsl-tray').value = l.trays || '';
  document.getElementById('edsl-piece').value = l.pieces || '';
  document.getElementById('edsl-modal').style.display = 'flex';
}
function closeEditStockLogEntry() { document.getElementById('edsl-modal').style.display = 'none'; stkLogEditCtx = null; }
function saveEditStockLogEntry() {
  if (stkLogEditCtx === null) return;
  const l = stockLog[stkLogEditCtx];
  if (!l) { closeEditStockLogEntry(); return; }
  const newType = document.getElementById('edsl-type').value;
  const g = readQtyGroup('edsl-box', 'edsl-tray', 'edsl-piece');
  if (!g) return; // readQtyGroup already showed a validation toast
  const { b, t, p } = g;
  const newTotal = b * BE + t * TE + p;
  if (!newTotal) { toast(lang === 'hi' ? 'कोई मात्रा डालें' : 'Enter at least one quantity', 'te'); return; }
  // Reverse this entry's old effect, then check the new one is safe to apply.
  const oldEffect = (l.type === 'IN' ? 1 : -1) * (safeNum(l.boxes) * BE + safeNum(l.trays) * TE + safeNum(l.pieces));
  const newEffect = (newType === 'IN' ? 1 : -1) * newTotal;
  const projected = stock.eggs - oldEffect + newEffect;
  if (projected < 0) {
    toast(lang === 'hi' ? 'यह बदलाव स्टॉक को ऋणात्मक कर देगा — लागू नहीं किया गया' : 'This change would make stock negative — not applied', 'te');
    return;
  }
  if (projected > MAX_STOCK_EGGS) {
    toast(lang === 'hi' ? 'कुल स्टॉक सीमा से अधिक होगा' : 'This would push total stock past the supported limit', 'te');
    return;
  }
  stock.eggs = projected;
  // Audit trail (spec section 8, extended here to match what Orders
  // already do) — records what changed and when, without altering the
  // entry's own displayed values.
  const changes = [];
  if (l.type !== newType) changes.push((lang === 'hi' ? 'प्रकार: ' : 'Type: ') + l.type + ' \u2192 ' + newType);
  if (safeNum(l.boxes) !== b) changes.push('Boxes: ' + safeNum(l.boxes) + ' \u2192 ' + b);
  if (safeNum(l.trays) !== t) changes.push('Trays: ' + safeNum(l.trays) + ' \u2192 ' + t);
  if (safeNum(l.pieces) !== p) changes.push('Pieces: ' + safeNum(l.pieces) + ' \u2192 ' + p);
  if (changes.length) {
    if (!Array.isArray(l.editHistory)) l.editHistory = [];
    l.editHistory.push({ ts: nowStr(), changes });
  }
  l.type = newType; l.boxes = b; l.trays = t; l.pieces = p;
  closeEditStockLogEntry();
  renderStock(); renderStockLog(); svSync();
  toast(lang === 'hi' ? 'एंट्री अपडेट की गई' : 'Entry updated', 'ts');
}

function renderStock() {
  const bd = eggBD(stock.eggs);
  // Compact + expandable (spec: no number may overflow its card, but
  // the exact value must always stay one click away). Boxes is the
  // field that actually broke layout live, but all three go through
  // the same reusable formatter so any of them is safe regardless of
  // how large legacy/corrupt data made them.
  document.getElementById('stk-box-val').innerHTML = formatExpandableNumber(bd.boxes);
  document.getElementById('stk-tray-val').innerHTML = formatExpandableNumber(bd.trays);
  document.getElementById('stk-piece-val').innerHTML = formatExpandableNumber(bd.pieces);
  ['stk-box-card', 'stk-tray-card', 'stk-piece-card'].forEach(id => document.getElementById(id).classList.remove('stk-warn'));
  if (stock.eggs < TE) { document.getElementById('stk-piece-card').classList.add('stk-warn'); }
}
let _expandedStockLogHist = new Set();
function toggleStockLogHistory(idx) {
  if (_expandedStockLogHist.has(idx)) _expandedStockLogHist.delete(idx); else _expandedStockLogHist.add(idx);
  renderStockLog();
}

function renderStockLog() {
  const em = document.getElementById('stk-log-empty'), wrap = document.getElementById('stk-log-wrap');
  if (!stockLog.length) { em.style.display = 'block'; wrap.style.display = 'none'; return; }
  em.style.display = 'none'; wrap.style.display = 'block';
  let fl = stockLog;
  if (stockLogType !== 'all') fl = fl.filter(l => l.type === stockLogType);
  if (stockLogFrom) fl = fl.filter(l => l.isoDate && l.isoDate >= stockLogFrom);
  if (stockLogTo) fl = fl.filter(l => l.isoDate && l.isoDate <= stockLogTo);
  if (stockLogSearch) { const q = stockLogSearch.toLowerCase(); fl = fl.filter(l => (l.note || '').toLowerCase().includes(q)); }
  // Progressive "Show More" reveal (spec: 20 -> 40 -> 60...), matching
  // Order History's model exactly. Local data is never touched here.
  const pageItems = fl.slice(0, stockLogVisibleCount);
  document.getElementById('stk-log-body').innerHTML = !pageItems.length
    ? `<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--t3)">${lang==='hi'?'कोई मूवमेंट नहीं मिला':'No movements match filter'}</td></tr>`
    : pageItems.map(l => {
      // Real index into the un-filtered stockLog array — filter()/slice()
      // never clone the entries, so object-identity lookup is stable and
      // needs no separate id field on every historical log line.
      const realIdx = stockLog.indexOf(l);
      // Edit is only offered for entries created directly by Add/Remove
      // Stock (spec section 9). Entries generated FROM another record
      // (an order, an edited order, a supplier purchase...) are edited
      // by editing that source record instead — editing the derived log
      // line directly here would silently desync it from the record
      // that actually produced it.
      const canEdit = l.source === 'manual';
      const realIdxAttr = realIdx;
      const hasHist = Array.isArray(l.editHistory) && l.editHistory.length;
      const editedBadge = hasHist ? ` <span class="badge" style="background:var(--s2);color:var(--t2);cursor:pointer;font-size:9px" title="${lang==='hi'?'बदलाव देखें':'View changes'}" onclick="toggleStockLogHistory(${realIdxAttr})">✎</span>` : '';
      const histExpanded = _expandedStockLogHist.has(realIdxAttr);
      const histRow = (hasHist && histExpanded) ? `<tr><td colspan="7" style="background:var(--s2);padding:.5rem .9rem;font-size:11px;color:var(--t2)">
        ${l.editHistory.map(h => `<div style="margin-bottom:3px"><strong>${h.ts}</strong><br>${h.changes.map(c => '• ' + c).join('<br>')}</div>`).join('')}
      </td></tr>` : '';
      return `<tr>
    <td style="font-size:11px;color:var(--t2);white-space:nowrap">${l.ts}${editedBadge}</td>
    <td><span class="badge" style="${l.type === 'IN' ? 'background:var(--gbg);color:var(--grn)' : 'background:var(--rbg);color:var(--red)'}">${l.type === 'IN' ? (lang === 'hi' ? 'जोड़ा' : 'IN') : (lang === 'hi' ? 'घटाया' : 'OUT')}</span></td>
    <td style="font-size:12px;color:var(--t2)">${l.note || ''}</td>
    <td><strong>${l.boxes || 0}</strong></td>
    <td><strong>${l.trays || 0}</strong></td>
    <td><strong>${l.pieces || 0}</strong></td>
    <td>${canEdit ? `<button class="ib ib-blu" onclick="openEditStockLogEntry(${realIdx})" title="Edit">✎</button>` : ''}</td>
  </tr>${histRow}`;
    }).join('');
  renderStockLogPager(fl.length);
}
function renderStockLogPager(totalCount) {
  const el = document.getElementById('stk-log-pager');
  if (!el) return;
  const shown = Math.min(stockLogVisibleCount, totalCount);
  const label = (lang === 'hi'
    ? `${shown} / ${totalCount} दिखा रहे हैं`
    : `Showing ${shown} of ${totalCount}`);
  const hasMore = totalCount > stockLogVisibleCount;
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:.75rem">
    <span style="font-size:12px;color:var(--t3)">${label}</span>
    ${hasMore ? `<button class="btn bo" onclick="stockLogShowMore()">${lang==='hi'?'और दिखाएं ↓':'Show More ↓'}</button>` : ''}
  </div>`;
}
function stockLogShowMore() { stockLogVisibleCount += STOCK_LOG_PAGE_SIZE; renderStockLog(); }
function setStockLogType(t) {
  stockLogType = t; stockLogVisibleCount = 20;
  ['all','in','out'].forEach(x => document.getElementById('sl-'+x).classList.toggle('active', x === t.toLowerCase()));
  renderStockLog();
}
const _debouncedRenderStockLog = debounce(() => renderStockLog(), 200);
function setStockLogSearch(v) { stockLogSearch = (v||'').trim(); stockLogVisibleCount = 20; _debouncedRenderStockLog(); }
function setStockLogDates() {
  stockLogFrom = document.getElementById('sl-from').value;
  stockLogTo = document.getElementById('sl-to').value;
  stockLogVisibleCount = 20;
  renderStockLog();
}
function clearStockLogDates() {
  document.getElementById('sl-from').value = '';
  document.getElementById('sl-to').value = '';
  stockLogFrom = ''; stockLogTo = ''; stockLogVisibleCount = 20;
  renderStockLog();
}
async function clearStockLog() {
  if (!stockLog.length) return;
  if (!(await showConfirm(lang === 'hi' ? 'लॉग साफ करें?' : 'Clear stock log?'))) return;
  stockLog = []; stockLogVisibleCount = 20; renderStockLog(); svSync();
}
