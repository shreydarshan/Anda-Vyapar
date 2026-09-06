/* ============================================================
   CUSTOMER LEDGER
   ============================================================ */
function calcCpAmt(){
  const t=document.getElementById('cp-type').value;
  const q=validQtyField(document.getElementById('cp-qty').value);
  const rRaw=document.getElementById('cp-rate').value;
  const r=parseFloat(rRaw);
  const el=document.getElementById('cp-preview');
  const det=document.getElementById('cp-preview-detail');
  const warn=document.getElementById('cp-warn');
  // Live feedback while typing (spec: "specify what are limits and
  // what I typed wrong") — mirrors the same limits addCustPurchase()
  // enforces on submit, so the preview never shows a number that's
  // about to be rejected without explanation.
  if(rRaw && (!Number.isFinite(r) || r<=0)){
    el.textContent='₹ —'; if(det)det.textContent='';
    if(warn){warn.style.display='block';warn.textContent=lang==='hi'?`दर ₹0.01 और ₹${formatIndianNumber(MAX_RATE_PER_EGG)} के बीच होनी चाहिए`:`Rate per egg must be between ₹0.01 and ₹${formatIndianNumber(MAX_RATE_PER_EGG)}`;}
    return;
  }
  if(r>MAX_RATE_PER_EGG){
    el.textContent='₹ —'; if(det)det.textContent='';
    if(warn){warn.style.display='block';warn.textContent=(lang==='hi'?`दर ₹0.01 और ₹${formatIndianNumber(MAX_RATE_PER_EGG)} के बीच होनी चाहिए`:`Rate per egg must be between ₹0.01 and ₹${formatIndianNumber(MAX_RATE_PER_EGG)}`);}
    return;
  }
  if(document.getElementById('cp-qty').value && q===null){
    el.textContent='₹ —'; if(det)det.textContent='';
    if(warn){warn.style.display='block';warn.textContent=(lang==='hi'?`मात्रा 1 और ${formatIndianNumber(MAX_QTY_PER_FIELD)} के बीच होनी चाहिए`:`Quantity must be between 1 and ${formatIndianNumber(MAX_QTY_PER_FIELD)}`);}
    return;
  }
  if(warn)warn.style.display='none';
  if(!q||!r){el.textContent='₹ —';if(det)det.textContent='';return;}
  const eggs=eFor(t,q); // total eggs
  const total=eggs*r;
  el.innerHTML=formatExpandableCurrency(total);
  if(det)det.textContent=formatIndianNumber(eggs)+' eggs × '+formatIndianCurrency(r)+' = '+formatIndianCurrency(total);
}
function addCustPurchase(isCredit){
  const name=document.getElementById('cp-name').value.trim();
  const phone=document.getElementById('cp-phone').value.trim();
  const type=document.getElementById('cp-type').value;
  const qtyRaw=document.getElementById('cp-qty').value;
  const qty=validQtyField(qtyRaw);
  const ratePerEgg=parseFloat(document.getElementById('cp-rate').value);
  const warnEl=document.getElementById('cp-warn');
  // Specific, distinct messages for each failure (spec: "specify what
  // are limits and info for what I typed wrong" — the old code showed
  // the same generic "fill the fields" message whether a field was
  // actually empty or simply over the limit, which is exactly what
  // was reported: a huge qty/rate silently failed to save with no
  // explanation of why).
  if(!name){
    warnEl.textContent=lang==='hi'?'सप्लायर का नाम डालें':'Enter a supplier name';
    warnEl.style.display='block';return;
  }
  if(qty===null){
    warnEl.textContent=lang==='hi'?`मात्रा 1 और ${formatIndianNumber(MAX_QTY_PER_FIELD)} के बीच होनी चाहिए`:`Quantity must be between 1 and ${formatIndianNumber(MAX_QTY_PER_FIELD)}`;
    warnEl.style.display='block';return;
  }
  if(!qty||qty<=0){
    warnEl.textContent=lang==='hi'?`मात्रा 1 और ${formatIndianNumber(MAX_QTY_PER_FIELD)} के बीच होनी चाहिए`:`Quantity must be between 1 and ${formatIndianNumber(MAX_QTY_PER_FIELD)}`;
    warnEl.style.display='block';return;
  }
  if(!Number.isFinite(ratePerEgg)||ratePerEgg<=0){
    warnEl.textContent=lang==='hi'?`दर ₹0.01 और ₹${formatIndianNumber(MAX_RATE_PER_EGG)} के बीच होनी चाहिए`:`Rate per egg must be between ₹0.01 and ₹${formatIndianNumber(MAX_RATE_PER_EGG)}`;
    warnEl.style.display='block';return;
  }
  if(ratePerEgg>MAX_RATE_PER_EGG){
    warnEl.textContent=lang==='hi'?`दर ₹0.01 और ₹${formatIndianNumber(MAX_RATE_PER_EGG)} के बीच होनी चाहिए`:`Rate per egg must be between ₹0.01 and ₹${formatIndianNumber(MAX_RATE_PER_EGG)}`;
    warnEl.style.display='block';return;
  }
  const eggs=eFor(type,qty);
  if(stock.eggs+eggs>MAX_STOCK_EGGS){
    warnEl.textContent=lang==='hi'?'कुल स्टॉक सीमा से अधिक होगा':'This would push total stock past the supported limit';
    warnEl.style.display='block';
    return;
  }
  warnEl.style.display='none';
  const amt=+(eggs*ratePerEgg).toFixed(2); // eggs × rate_per_egg
  const bd=eggBD(eggs);
  const ts=nowStr();
  if(!custLedger[name])custLedger[name]={phone:'',entries:[],payments:[],totalOwed:0,totalBoxesBought:0};
  if(phone)custLedger[name].phone=phone;
  custLedger[name].entries.unshift({type,qty,ratePerEgg,eggs,boxes:bd.boxes,trays:bd.trays,pieces:bd.pieces,amt,origAmt:amt,isCredit,paid:!isCredit,ts,isoDate:isoToday()});
  if(isCredit)custLedger[name].totalOwed=+(custLedger[name].totalOwed+amt).toFixed(2);
  custLedger[name].totalBoxesBought+=bd.boxes;
  stock.eggs+=eggs;
  stockLog.unshift({ts,isoDate:isoToday(),type:'IN',boxes:bd.boxes,trays:bd.trays,pieces:bd.pieces,note:(lang==='hi'?'खरीद — ':'Purchase — ')+name+' ('+qty+' '+type+')'});
  ['cp-qty','cp-rate'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('cp-preview').textContent='₹ —';
  const det=document.getElementById('cp-preview-detail');if(det)det.textContent='';
  refreshCpDatalist();
  renderCustPage();
  renderStock();
  svSync();
  toast((lang==='hi'?'खरीद दर्ज, स्टॉक अपडेट — ':'Purchase added, stock updated — ')+bdStr(eggs),'ts');
  // Reset the form to a genuinely clean state for the NEXT entry —
  // this was carrying the previous entry's name/phone forward
  // (visibly wrong: reopening "Add Purchase Entry" showed the last
  // supplier typed, not a blank form). Only Qty/Rate were being
  // cleared above; Name/Phone never were.
  const nameEl=document.getElementById('cp-name');
  const phoneEl=document.getElementById('cp-phone');
  if(nameEl)nameEl.value='';
  if(phoneEl)phoneEl.value='';
  if(nameEl)nameEl.focus();
}

function openCustPayModal(name){
  const c=custLedger[name];
  if(!c||c.totalOwed<=0){toast(lang==='hi'?'कोई बकाया नहीं':'No pending amount','ti');return;}
  custPayCtxName=name;
  document.getElementById('cust-pay-modal-body').innerHTML=`
    <div style="background:var(--rbg);border:1px solid var(--rb);border-radius:var(--rs);padding:.9rem;margin-bottom:.85rem">
      <div style="font-family:'Baloo 2',cursive;font-size:15px;font-weight:700;color:var(--red)">${name}</div>
      ${c.phone?`<div style="font-size:12px;color:var(--t2)">📞 ${c.phone}</div>`:''}
      <div style="font-size:13px;margin-top:6px">${lang==='hi'?'कुल बाकी:':'Total you owe:'} <strong style="color:var(--red);font-size:18px">${formatExpandableCurrency(c.totalOwed)}</strong></div>
    </div>
    <p style="font-size:12px;color:var(--t2);margin-bottom:.5rem">${lang==='hi'?'अभी जितनी राशि दे रहे हैं वो डालें (आंशिक भुगतान ठीक है):':'Enter the amount you are paying now (partial payment allowed):'}</p>
  `;
  document.getElementById('cust-pay-amt').value='';
  document.getElementById('cust-pay-remaining').textContent='';
  document.getElementById('cust-pay-modal').style.display='flex';
  // Auto-focus (spec section 8): ready to type the amount immediately.
  const amtInput=document.getElementById('cust-pay-amt');
  if(amtInput)amtInput.focus();
}
function closeCustPayModal(){document.getElementById('cust-pay-modal').style.display='none';custPayCtxName='';}
function onCustPayInput(){
  if(!custPayCtxName)return;
  const amt=parseFloat(document.getElementById('cust-pay-amt').value)||0;
  const total=custLedger[custPayCtxName]?.totalOwed||0;
  const el=document.getElementById('cust-pay-remaining');
  if(!amt){el.textContent='';return;}
  if(amt>total){el.style.color='var(--red)';el.textContent='⚠️ '+(lang==='hi'?'राशि बकाया से ज्यादा है':'Amount exceeds pending: '+formatIndianCurrency(total));}
  else if(amt===total){el.style.color='var(--grn)';el.textContent='✓ '+(lang==='hi'?'पूरा बकाया चुकता हो जाएगा':'Full amount — all clear!');}
  else{el.style.color='var(--t2)';el.textContent=(lang==='hi'?'भुगतान के बाद बाकी: ':'Remaining after: ')+formatIndianCurrency(total-amt);}
}
function confirmCustPay(){
  if(!custPayCtxName)return;
  const name=custPayCtxName;
  const c=custLedger[name];
  const amt=parseFloat(document.getElementById('cust-pay-amt').value);
  if(!amt||amt<=0){toast(lang==='hi'?'राशि डालें':'Enter amount','te');return;}
  if(amt>c.totalOwed+0.001){toast(lang==='hi'?'राशि बकाया से ज्यादा नहीं हो सकती':'Cannot exceed pending amount','te');return;}
  const pay=Math.min(amt,c.totalOwed);
  // Record payment in history
  if(!c.payments)c.payments=[];
  c.payments.unshift({amt:+pay.toFixed(2),ts:nowStr(),isoDate:isoToday()});
  // Deduct from oldest unpaid entries (entries unshifted = newest first, so reverse to get oldest first)
  let rem=pay;
  const revIdx=[...c.entries.keys()].reverse();
  for(const i of revIdx){
    const e=c.entries[i];
    if(e.paid||!e.isCredit||rem<=0)continue;
    if(e.amt<=rem+0.001){rem=+(rem-e.amt).toFixed(2);e.amt=0;e.paid=true;}
    else{e.amt=+(e.amt-rem).toFixed(2);rem=0;}
  }
  c.totalOwed=+Math.max(0,c.totalOwed-pay).toFixed(2);
  closeCustPayModal();
  renderCustPage();svSync();
  toast(formatIndianCurrency(pay)+(lang==='hi'?' भुगतान किया गया':'  paid to supplier'),'ts');
}
async function delCustEntry(name,idx){
  if(!(await showConfirm(lang==='hi'?'यह एंट्री हटाएं?':'Delete this entry?')))return;
  const e=custLedger[name].entries[idx];
  // Bug fix: addCustPurchase() adds `e.eggs` to stock.eggs when the
  // entry is created — deleting the entry must reverse that, or the
  // stock total silently drifts upward forever (stock keeps every
  // purchase's eggs even after the purchase record itself is gone).
  // This mirrors the existing deleteOrder() stock-restore pattern.
  const eggsBack=safeNum(e.eggs);
  if(eggsBack>0){
    stock.eggs=Math.max(0,stock.eggs-eggsBack);
    const bd=eggBD(eggsBack);
    stockLog.unshift({ts:nowStr(),isoDate:isoToday(),type:'OUT',boxes:bd.boxes,trays:bd.trays,pieces:bd.pieces,note:(lang==='hi'?'खरीद एंट्री हटाई — ':'Purchase entry deleted — ')+name});
  }
  if(e.isCredit&&!e.paid)custLedger[name].totalOwed=+Math.max(0,custLedger[name].totalOwed-e.amt).toFixed(2);
  custLedger[name].entries.splice(idx,1);
  if(!custLedger[name].entries.length&&!custLedger[name].payments?.length)delete custLedger[name];
  refreshCpDatalist();renderCustPage();renderStock();renderStockLog();svSync();
}

// ── EDIT SUPPLIER PURCHASE ENTRY (spec section 11) ──────────────────
// Same safety rule as Order Edit: refuse outright (rather than guess)
// if this entry has already had a partial payment applied — `amt` no
// longer equals `origAmt` in that case, which is the one signal this
// data model has, and guessing how to reconcile a partially-paid
// entry would risk corrupting real payment history.
let cpEditCtx=null;
function _custEntryHasPaymentActivity(e){ return e.paid || Math.abs(safeNum(e.amt)-safeNum(e.origAmt))>0.01; }
function openEditCustEntry(name,idx){
  const c=custLedger[name]; if(!c) return;
  const e=c.entries[idx];
  if(_custEntryHasPaymentActivity(e)){
    toast(lang==='hi'?'इस एंट्री पर भुगतान हो चुका है — संपादित नहीं किया जा सकता':'Payment already made against this entry — it cannot be edited','te');
    return;
  }
  cpEditCtx={name,idx};
  document.getElementById('edcp-name').textContent=name;
  document.getElementById('edcp-type').value=e.type;
  document.getElementById('edcp-qty').value=e.qty;
  document.getElementById('edcp-rate').value=e.ratePerEgg||e.rate||0;
  document.getElementById('edcp-credit').value=e.isCredit?'yes':'no';
  document.getElementById('edcp-modal').style.display='flex';
}
function closeEditCustEntry(){document.getElementById('edcp-modal').style.display='none';cpEditCtx=null;}
function saveEditCustEntry(){
  if(!cpEditCtx)return;
  const {name,idx}=cpEditCtx;
  const c=custLedger[name]; if(!c){closeEditCustEntry();return;}
  const e=c.entries[idx];
  const type=document.getElementById('edcp-type').value;
  const qty=validQtyField(document.getElementById('edcp-qty').value);
  const ratePerEgg=parseFloat(document.getElementById('edcp-rate').value);
  const isCredit=document.getElementById('edcp-credit').value==='yes';
  if(qty===null){toast(lang==='hi'?`मात्रा 1 और ${formatIndianNumber(MAX_QTY_PER_FIELD)} के बीच होनी चाहिए`:`Quantity must be between 1 and ${formatIndianNumber(MAX_QTY_PER_FIELD)}`,'te');return;}
  if(!qty||qty<=0){toast(lang==='hi'?`मात्रा 1 और ${formatIndianNumber(MAX_QTY_PER_FIELD)} के बीच होनी चाहिए`:`Quantity must be between 1 and ${formatIndianNumber(MAX_QTY_PER_FIELD)}`,'te');return;}
  if(!Number.isFinite(ratePerEgg)||ratePerEgg<=0){toast(lang==='hi'?`दर ₹0.01 और ₹${formatIndianNumber(MAX_RATE_PER_EGG)} के बीच होनी चाहिए`:`Rate per egg must be between ₹0.01 and ₹${formatIndianNumber(MAX_RATE_PER_EGG)}`,'te');return;}
  if(ratePerEgg>MAX_RATE_PER_EGG){toast(lang==='hi'?`दर ₹0.01 और ₹${formatIndianNumber(MAX_RATE_PER_EGG)} के बीच होनी चाहिए`:`Rate per egg must be between ₹0.01 and ₹${formatIndianNumber(MAX_RATE_PER_EGG)}`,'te');return;}
  const newEggs=eFor(type,qty);
  const newAmt=+(newEggs*ratePerEgg).toFixed(2);
  // Stock reconciliation: reverse this entry's old contribution, check
  // the new one doesn't take stock negative, then apply — atomically,
  // same pattern as Order Edit.
  const oldEggs=safeNum(e.eggs);
  const projected=stock.eggs-oldEggs+newEggs;
  if(projected<0){
    toast(lang==='hi'?'यह बदलाव स्टॉक को ऋणात्मक कर देगा':'This change would make stock negative — not applied','te');
    return;
  }
  stock.eggs=projected;
  const bd=eggBD(newEggs);
  if(oldEggs!==newEggs){
    stockLog.unshift({ts:nowStr(),isoDate:isoToday(),type:newEggs>=oldEggs?'IN':'OUT',boxes:eggBD(Math.abs(newEggs-oldEggs)).boxes,trays:eggBD(Math.abs(newEggs-oldEggs)).trays,pieces:eggBD(Math.abs(newEggs-oldEggs)).pieces,note:(lang==='hi'?'खरीद एंट्री संपादित — ':'Purchase entry edited — ')+name});
  }
  // totalOwed reconciliation: remove old unpaid-credit contribution, add new
  if(e.isCredit&&!e.paid)c.totalOwed=+Math.max(0,c.totalOwed-e.amt).toFixed(2);
  if(isCredit)c.totalOwed=+(c.totalOwed+newAmt).toFixed(2);
  c.totalBoxesBought+=(bd.boxes-eggBD(oldEggs).boxes);
  // Audit trail (spec section 8/11) — same pattern as Order Edit.
  const changes=[];
  if(e.type!==type)changes.push((lang==='hi'?'प्रकार: ':'Type: ')+e.type+' \u2192 '+type);
  if(safeNum(e.qty)!==qty)changes.push((lang==='hi'?'मात्रा: ':'Qty: ')+safeNum(e.qty)+' \u2192 '+qty);
  if(Math.abs(safeNum(e.ratePerEgg||e.rate)-ratePerEgg)>0.001)changes.push((lang==='hi'?'दर: ':'Rate: ')+'₹'+(e.ratePerEgg||e.rate||0)+' \u2192 ₹'+ratePerEgg);
  if(Math.abs(safeNum(e.amt)-newAmt)>0.01)changes.push((lang==='hi'?'राशि: ':'Amount: ')+formatIndianCurrency(e.amt)+' \u2192 '+formatIndianCurrency(newAmt));
  if(changes.length){
    if(!Array.isArray(e.editHistory))e.editHistory=[];
    e.editHistory.push({ts:nowStr(),changes});
  }
  e.type=type;e.qty=qty;e.ratePerEgg=ratePerEgg;e.eggs=newEggs;e.boxes=bd.boxes;e.trays=bd.trays;e.pieces=bd.pieces;
  e.amt=newAmt;e.origAmt=newAmt;e.isCredit=isCredit;e.paid=!isCredit;
  closeEditCustEntry();
  refreshCpDatalist();renderCustPage();renderStock();renderStockLog();svSync();
  toast(lang==='hi'?'एंट्री अपडेट की गई':'Entry updated','ts');
}
function toggleCustOweFilter(){
  custOweFilterActive=!custOweFilterActive;
  const bar=document.getElementById('cust-owe-filter-bar');
  if(bar)bar.style.display=custOweFilterActive?'flex':'none';
  renderCustPage();
}
function clearCustOweFilter(){custOweFilterActive=false;const bar=document.getElementById('cust-owe-filter-bar');if(bar)bar.style.display='none';renderCustPage();}
function refreshCpDatalist(){
  const dl=document.getElementById('cp-datalist');
  if(dl)dl.innerHTML=Object.keys(custLedger).map(k=>`<option value="${k}">`).join('');
}
// Debounced specifically for the search box's oninput — every OTHER
// call site (add/edit/pay/delete purchase, tab switch) still calls
// renderCustPage() directly and immediately.
const onCpSearchInput = debounce(() => renderCustPage(), 200);
let _expandedCustEntryHist=new Set();
function toggleCustEntryHistory(name,idx){
  const key=name+':'+idx;
  if(_expandedCustEntryHist.has(key))_expandedCustEntryHist.delete(key);else _expandedCustEntryHist.add(key);
  renderCustPage();
}
function renderCustPage(){
  let keys=Object.keys(custLedger);
  // Search
  const sq=(document.getElementById('cp-search')?.value||'').toLowerCase().trim();
  if(sq)keys=keys.filter(k=>k.toLowerCase().includes(sq));
  // Owe filter
  if(custOweFilterActive)keys=keys.filter(k=>custLedger[k].totalOwed>0);

  const em=document.getElementById('cust-pg-empty');
  const el=document.getElementById('cust-pg-list');
  const allKeys=Object.keys(custLedger);
  const totalOwed=allKeys.reduce((s,k)=>s+custLedger[k].totalOwed,0);
  const totalBoxes=allKeys.reduce((s,k)=>s+custLedger[k].totalBoxesBought,0);
  document.getElementById('cust-count').textContent=allKeys.length;
  document.getElementById('cust-owe').innerHTML=formatExpandableCurrency(totalOwed);
  document.getElementById('cust-boxes').innerHTML=formatExpandableNumber(totalBoxes);

  if(!keys.length){em.style.display='block';el.innerHTML='';return;}
  em.style.display='none';

  el.innerHTML=keys.map(name=>{
    const c=custLedger[name];
    const esc=name.replace(/\\/g,'\\\\').replace(/'/g,"\\'");

    // Purchase entries
    const entryRows=c.entries.map((e,i)=>{
      const bpArr=[];if(e.boxes)bpArr.push(e.boxes+' box');if(e.trays)bpArr.push(e.trays+' tray');if(e.pieces)bpArr.push(e.pieces+' pcs');
      const badge=e.paid
        ?`<span class="badge bpaid" style="font-size:10px">${lang==='hi'?'चुकता':'Paid'}</span>`
        :`<span class="badge budhar" style="font-size:10px">${lang==='hi'?'बाकी':'Credit'}</span>`;
      const origShow=e.origAmt&&e.origAmt!==e.amt?` <span style="color:var(--t3);text-decoration:line-through;font-size:10px">${formatIndianCurrency(e.origAmt)}</span>`:'' ;
      const histKey=name+':'+i;
      const hasHist=Array.isArray(e.editHistory)&&e.editHistory.length;
      const editedBadge=hasHist?` <span style="cursor:pointer;color:var(--t3);font-size:10px" title="${lang==='hi'?'बदलाव देखें':'View changes'}" onclick="toggleCustEntryHistory('${esc}',${i})">✎ ${lang==='hi'?'संपादित':'edited'}</span>`:'';
      const histBlock=(hasHist&&_expandedCustEntryHist.has(histKey))?`<div style="background:var(--s2);border-radius:6px;padding:.4rem .6rem;margin-top:4px;font-size:11px;color:var(--t2)">
        ${e.editHistory.map(h=>`<div style="margin-bottom:3px"><strong>${h.ts}</strong><br>${h.changes.map(c=>'• '+c).join('<br>')}</div>`).join('')}
      </div>`:'';
      return`<div style="padding:7px 0;border-bottom:1px solid var(--bdr);display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div style="font-size:13px;font-weight:600;color:var(--t1)">${e.qty} ${e.type}  ×  ₹${formatIndianNumber(e.ratePerEgg||e.rate||0,2)}/egg  =  <span style="color:var(--acc)">${formatExpandableCurrency(e.amt)}</span>${origShow}</div>
          <div style="font-size:11px;color:var(--t3);margin-top:2px">${e.eggs} eggs (${bpArr.join('+')||'—'}) &nbsp;|&nbsp; ${e.ts}${editedBadge}</div>
          ${histBlock}
        </div>
        <div style="display:flex;gap:5px;align-items:center;flex-shrink:0;flex-wrap:wrap">
          ${badge}
          ${e.isCredit&&!e.paid?`<button class="btn bp bsm" style="height:24px;padding:0 9px;font-size:11px" onclick="openCustPayModal('${esc}')">${lang==='hi'?'भुगतान':'Pay'}</button>`:''}
          ${!_custEntryHasPaymentActivity(e)?`<button class="ib ib-blu" style="height:22px;font-size:11px" onclick="openEditCustEntry('${esc}',${i})" title="Edit">✎</button>`:''}
          <button class="ib ib-red" style="height:22px;font-size:11px" onclick="delCustEntry('${esc}',${i})">✕</button>
        </div>
      </div>`;
    }).join('');

    // Payment history log
    const payRows=(c.payments||[]).map(p=>`
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px dashed var(--gb)">
        <span style="color:var(--grn)">✓ ${lang==='hi'?'भुगतान दिया':'Paid to supplier'}</span>
        <span><strong style="color:var(--grn)">${formatIndianCurrency(p.amt)}</strong> <span style="color:var(--t3)">${p.ts}</span></span>
      </div>`).join('');

    return`<div class="card" style="border-left:4px solid var(--acc);margin-bottom:.9rem;padding:1rem 1.25rem">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:.75rem">
        <div>
          <div style="font-family:'Baloo 2',cursive;font-size:17px;font-weight:800;color:var(--t1)">${name}</div>
          ${c.phone?`<div style="font-size:12px;color:var(--t2)">📞 ${c.phone}</div>`:''}
          <div style="font-size:12px;color:var(--t2);margin-top:3px"><span class="tl" data-e="Total boxes bought:" data-h="कुल बॉक्स खरीदे:">Boxes bought:</span> <strong>${c.totalBoxesBought}</strong></div>
        </div>
        <div style="text-align:right">
          ${c.totalOwed>0
            ?`<div style="font-family:'Baloo 2',cursive;font-size:17px;font-weight:800;color:var(--red)">${lang==='hi'?'आपका बकाया:':'You owe:'} ${formatExpandableCurrency(c.totalOwed)}</div>
               <button class="btn bp bsm" style="margin-top:6px" onclick="openCustPayModal('${esc}')">💳 ${lang==='hi'?'भुगतान करें':'Pay Now'}</button>`
            :`<div style="font-size:13px;color:var(--grn);font-weight:600">✓ ${lang==='hi'?'सब चुकता':'All Clear'}</div>`}
        </div>
      </div>
      <!-- Purchase entries -->
      <div style="font-size:11px;font-weight:700;color:var(--t3);letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px">${lang==='hi'?'खरीद एंट्री':'Purchase Entries'}</div>
      <div style="margin-bottom:${payRows?'.75rem':'0'}">${entryRows||`<div style="color:var(--t3);font-size:12px;padding:6px 0">${lang==='hi'?'कोई एंट्री नहीं':'No entries'}</div>`}</div>
      <!-- Payment history -->
      ${payRows?`<div style="background:var(--gbg);border-radius:var(--rs);padding:.65rem .9rem;margin-top:.5rem">
        <div style="font-size:11px;font-weight:700;color:var(--grn);letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px">${lang==='hi'?'भुगतान इतिहास':'Payment History'}</div>
        ${payRows}
      </div>`:''}
    </div>`;
  }).join('');
}

// ── THERMAL PRINTER ───────────────────────────────────────────────────────────