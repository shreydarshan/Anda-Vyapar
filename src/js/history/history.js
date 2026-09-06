/* ============================================================
   ORDER HISTORY
   ============================================================ */
// One-time cleanup of pre-existing corrupt #0/₹0.00 "ghost" order
// records (spec: never silently delete legitimate history, but these
// are provably invalid — an order with no positive total was never a
// real sale, it's exactly the bug placeOrder() now refuses to create
// going forward). Runs once per account (flagged in localStorage so
// it never re-runs and never touches orders a user creates later),
// and always tells the user what it did rather than silently pruning
// history.
function cleanupInvalidOrders(){
  const flagKey='av4_ghost_cleanup_'+currentAccountKey;
  if(localStorage.getItem(flagKey))return;
  localStorage.setItem(flagKey,'1');
  const before=orders.length;
  const bad=orders.filter(o=>!(safeNum(o.totalAmt)>0));
  if(!bad.length)return;
  orders=orders.filter(o=>safeNum(o.totalAmt)>0);
  renderHist();renderReport();
  if(typeof renderCustPage==='function')renderCustPage();
  svSync();
  toast((lang==='hi'
    ?`${bad.length} अमान्य ₹0 ऑर्डर हटाए गए (पुराना डेटा)`
    :`Removed ${bad.length} invalid ₹0.00 order${bad.length>1?'s':''} from history (leftover from before order validation was added)`),'ti');
}
function setFilt(f){
  histFilt=f;
  histVisibleCount=20;
  ['all','cash','udhar','paid'].forEach(x=>document.getElementById('f-'+x).classList.toggle('active',x===f));
  renderHist();
}
function clearDateFilt(){
  document.getElementById('f-from').value='';document.getElementById('f-to').value='';
  const a=document.getElementById('f-amt-min'),b=document.getElementById('f-amt-max');if(a)a.value='';if(b)b.value='';
  histVisibleCount=20;renderHist();
}
const _debouncedRenderHist = debounce(() => renderHist(), 200);
function setHistSearch(v){histSearch=(v||'').trim();histVisibleCount=20;_debouncedRenderHist();}
function histShowMore(){histVisibleCount+=HIST_PAGE_SIZE;renderHist();}
function viewSlip(id){const o=orders.find(x=>x.id===id);if(o){curSlipOrder=o;openSlipModal(o);}}
async function deleteOrder(id){
  const o=orders.find(x=>x.id===id);
  if(!o)return;
  // Ledger-safety guard (same rule as Edit Order): refuse to delete an
  // Udhar order that has already had money settled against it — doing
  // so would silently erase real payment history. Fully untouched
  // Udhar orders (still owed in full) are safe to delete and DO clean
  // up their Udhar entry below, closing the pre-existing gap where a
  // deleted Udhar order used to leave a stale "ghost debt" entry
  // behind with no order to point to.
  if(_orderHasSettlementActivity(o)){
    toast(lang==='hi'
      ?'इस ऑर्डर पर भुगतान प्राप्त हो चुका है — हटाया नहीं जा सकता'
      :'Payment already received against this order — it cannot be deleted','te');
    return;
  }
  if(!(await showConfirm(lang==='hi'?'यह ऑर्डर हटाएं? स्टॉक वापस जुड़ जाएगा।':'Delete this order? Its stock will be restored.')))return;
  orders=orders.filter(x=>x.id!==id);
  // Deleting an order is the closest thing to "undo" this app has —
  // it must actually reverse the stock deduction that order made,
  // not just remove the history row and leave stock permanently
  // short. Logged as its own IN entry so the Stock Log shows exactly
  // why stock went back up, same as any other stock movement.
  const eggsBack=safeNum(o.totalEggs);
  if(eggsBack>0){
    stock.eggs+=eggsBack;
    const bd=eggBD(eggsBack);
    stockLog.unshift({ts:nowStr(),isoDate:isoToday(),type:'IN',boxes:bd.boxes,trays:bd.trays,pieces:bd.pieces,note:(lang==='hi'?'ऑर्डर हटाया, स्टॉक वापस — #':'Order deleted, stock restored — #')+id});
  }
  // Remove the matching Udhar entry (if any) so it doesn't linger as
  // a debt with no corresponding order — see comment above.
  if(o.isUdhar){
    const u=udhar[o.cname];
    if(u){
      const entry=u.entries.find(e=>e.orderId===o.id);
      if(entry){
        u.entries=u.entries.filter(e=>e!==entry);
        u.total=Math.max(0,+(u.total-safeNum(o.totalAmt)).toFixed(2));
        if(!u.entries.length&&!(u.settlements||[]).length) delete udhar[o.cname];
        updUdharCount();if(typeof refreshUdharDatalist==='function')refreshUdharDatalist();renderUdhar();
      }
    }
  }
  document.getElementById('order-count').textContent=orders.length;
  renderStock();renderStockLog();
  renderHist();svSync();toast(lang==='hi'?'ऑर्डर हटाया, स्टॉक वापस जोड़ा':'Order deleted, stock restored');
}
async function clearAllOrders(){
  if(!orders.length)return;
  if(!(await showConfirm(lang==='hi'?'सभी ऑर्डर हटाएं? इससे स्टॉक वापस नहीं आएगा।':'Delete all orders? This does NOT restore their stock.', {danger:true})))return;
  orders=[];counter=0;histVisibleCount=20;document.getElementById('order-count').textContent=0;
  renderHist();svSync();toast(lang==='hi'?'साफ हुआ':'Cleared');
}
function renderHist(){
  const em=document.getElementById('h-empty'),wrap=document.getElementById('h-wrap'),stats=document.getElementById('h-stats');
  if(!orders.length){em.style.display='block';wrap.style.display='none';stats.style.display='none';return;}
  em.style.display='none';wrap.style.display='block';stats.style.display='grid';
  // ── Build the FILTERED set FIRST ────────────────────────────────
  // Root-cause fix (spec section 13/16): the summary cards used to be
  // computed from the raw `orders` array while the table below was
  // built from a separately-filtered `fl` — so selecting a date range
  // (or any other filter) updated the table but the six summary cards
  // kept showing all-time totals. There must only be ONE filtered
  // collection; both the cards and the table now read from it, so
  // they can never disagree.
  const fv=document.getElementById('f-from').value;
  const tv=document.getElementById('f-to').value;
  // Date validation (V21 stability fix) — an invalid calendar date
  // (e.g. 31 Sept, which doesn't exist) must never be silently
  // accepted or rolled over into filtering. Checked independently of
  // whatever the browser's date-picker did with it (see
  // isValidCalendarDate's comment for why that can't be trusted
  // alone). If either date is invalid, the date-range filter is NOT
  // applied at all — falls back to showing all-time results, exactly
  // like Clear does — and a clear message explains why, instead of
  // ever displaying results filtered by a boundary that doesn't
  // correspond to a real day.
  const dateWarnEl=document.getElementById('h-date-warn');
  const fromInvalid=fv && !isValidCalendarDate(fv);
  const toInvalid=tv && !isValidCalendarDate(tv);
  const useDateFilter = !fromInvalid && !toInvalid;
  if(dateWarnEl){
    if(fromInvalid){dateWarnEl.style.display='block';dateWarnEl.textContent=invalidDateMessage(fv);}
    else if(toInvalid){dateWarnEl.style.display='block';dateWarnEl.textContent=invalidDateMessage(tv);}
    else dateWarnEl.style.display='none';
  }
  let fl=orders;
  if(histFilt==='cash')fl=fl.filter(o=>!o.isUdhar&&!o.paid);
  else if(histFilt==='udhar')fl=fl.filter(o=>o.isUdhar&&!o.paid);
  else if(histFilt==='paid')fl=fl.filter(o=>o.paid);
  if(useDateFilter){
    if(fv)fl=fl.filter(o=>o.isoDate&&o.isoDate>=fv);
    if(tv)fl=fl.filter(o=>o.isoDate&&o.isoDate<=tv);
  }
  if(histSearch){
    const q=histSearch.toLowerCase();
    fl=fl.filter(o=>(o.cname||'').toLowerCase().includes(q)||(o.cphone||'').includes(q)||String(o.id).includes(q));
  }
  const amtMinEl=document.getElementById('f-amt-min'), amtMaxEl=document.getElementById('f-amt-max');
  let amtMin=amtMinEl?parseFloat(amtMinEl.value):NaN;
  let amtMax=amtMaxEl?parseFloat(amtMaxEl.value):NaN;
  // Defensive bound (spec section 3/6) — a filter value is never
  // stored, so this can't corrupt data, but clamping keeps it inside
  // the same safe numeric range as everything else rather than
  // silently comparing against Infinity.
  if(!isNaN(amtMin))amtMin=Math.max(0,Math.min(amtMin,MAX_SAFE_AMOUNT));
  if(!isNaN(amtMax))amtMax=Math.max(0,Math.min(amtMax,MAX_SAFE_AMOUNT));
  if(!isNaN(amtMin))fl=fl.filter(o=>safeNum(o.totalAmt)>=amtMin);
  if(!isNaN(amtMax))fl=fl.filter(o=>safeNum(o.totalAmt)<=amtMax);
  // ── Summary cards — computed from `fl`, the SAME filtered set the
  // table renders below, whether or not any filter is active. With
  // no filters selected, fl === orders, so this is still the correct
  // all-time total in that case.
  const tAmt=fl.reduce((s,o)=>s+safeNum(o.totalAmt),0);
  const tEggs=fl.reduce((s,o)=>s+safeNum(o.totalEggs),0);
  const tUdhar=fl.filter(o=>o.isUdhar&&!o.paid).reduce((s,o)=>s+safeNum(o.totalAmt),0);
  const tBD=eggBD(tEggs);
  document.getElementById('hs-o').innerHTML=formatExpandableNumber(fl.length);
  document.getElementById('hs-bx').innerHTML=formatExpandableNumber(tBD.boxes);
  document.getElementById('hs-tr').innerHTML=formatExpandableNumber(tBD.trays);
  document.getElementById('hs-pc').innerHTML=formatExpandableNumber(tBD.pieces);
  document.getElementById('hs-p').innerHTML=formatExpandableCurrency(tUdhar);
  document.getElementById('hs-r').innerHTML=formatExpandableCurrency(tAmt);
  // Make an active date range visually obvious on the section itself,
  // not just inside the two date inputs.
  if(stats) stats.classList.toggle('h-date-filtered', useDateFilter && !!(fv||tv));
  // Progressive "Show More" reveal (spec: 20 -> 40 -> 60...), not a
  // paged Prev/Next model. Never renders the full dataset at once —
  // only ever the first `histVisibleCount` of the FILTERED set, most
  // recent first (orders are already stored newest-first). Local data
  // itself is never touched here; this only controls what's rendered.
  const pageItems=fl.slice(0,histVisibleCount);
  document.getElementById('h-body').innerHTML=!fl.length
    ?`<tr><td colspan="8" style="text-align:center;padding:1.5rem;color:var(--t3)">${lang==='hi'?'कोई ऑर्डर नहीं मिला':'No orders match filter'}</td></tr>`
    :pageItems.map(o=>{
      const bd=o.boxes!==undefined?o:eggBD(o.totalEggs);
      const sum=o.items.map(it=>it.qty+' '+tName(it.type)).join(', ');
      const sb=o.isUdhar&&!o.paid?`<span class="badge budhar">${lang==='hi'?'उधार':'Udhar'}</span>`:o.paid?`<span class="badge bpaid">${lang==='hi'?'भुगतान':'Paid'}</span>`:`<span class="badge" style="background:var(--s2);color:var(--t2)">${lang==='hi'?'नकद':'Cash'}</span>`;
      const bpArr=[];if(bd.boxes)bpArr.push('<strong>'+bd.boxes+'</strong> box');if(bd.trays)bpArr.push('<strong>'+bd.trays+'</strong> tray');if(bd.pieces)bpArr.push('<strong>'+bd.pieces+'</strong> pcs');
      const hasHist=Array.isArray(o.editHistory)&&o.editHistory.length;
      const editedBadge=hasHist?` <span class="badge" style="background:var(--s2);color:var(--t2);cursor:pointer" title="${lang==='hi'?'बदलाव देखने के लिए क्लिक करें':'Click to view changes'}" onclick="toggleOrderHistory(${o.id})">✎ ${lang==='hi'?'संपादित':'Edited'}</span>`:'';
      const expanded=_expandedHistOrders.has(o.id);
      const histRow=(hasHist&&expanded)?`<tr><td colspan="8" style="background:var(--s2);padding:.6rem .9rem;font-size:11px;color:var(--t2)">
        ${o.editHistory.map(h=>`<div style="margin-bottom:4px"><strong>${h.ts}</strong><br>${h.changes.map(c=>'• '+c).join('<br>')}</div>`).join('')}
      </td></tr>`:'';
      return`<tr>
        <td style="color:var(--t3);font-size:11px;font-weight:700">#${o.id}${editedBadge}</td>
        <td><strong>${o.cname}</strong>${o.cphone?'<br><span style="font-size:11px;color:var(--t3)">'+o.cphone+'</span>':''}</td>
        <td style="font-size:11px;color:var(--t2);white-space:nowrap">${o.ts}</td>
        <td style="font-size:12px;color:var(--t2)">${sum}</td>
        <td style="font-size:12px">${bpArr.join(' + ')||'—'}</td>
        <td style="font-weight:700;color:var(--acc)">${formatExpandableCurrency(safeNum(o.totalAmt))}</td>
        <td>${sb}</td>
        <td style="white-space:nowrap">
          <button class="ib ib-blu" onclick="openEditOrder(${o.id})" title="Edit">✎</button>
          <button class="ib ib-blu" onclick="viewSlip(${o.id})" title="Slip" style="margin-left:3px">🧾</button>
          <button class="ib ib-red" onclick="deleteOrder(${o.id})" style="margin-left:3px">✕</button>
        </td>
      </tr>${histRow}`;
    }).join('');
  renderHistPager(fl.length);
}
function renderHistPager(totalCount){
  const el=document.getElementById('h-pager');
  if(!el)return;
  const shown=Math.min(histVisibleCount,totalCount);
  const label=(lang==='hi'
    ?`${shown} / ${totalCount} दिखा रहे हैं`
    :`Showing ${shown} of ${totalCount}`);
  const hasMore=totalCount>histVisibleCount;
  el.innerHTML=`<div style="display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:.75rem">
    <span style="font-size:12px;color:var(--t3)">${label}</span>
    ${hasMore?`<button class="btn bo" onclick="histShowMore()">${lang==='hi'?'और दिखाएं ↓':'Show More ↓'}</button>`:''}
  </div>`;
}

// ── SLIP ──────────────────────────────────────────────