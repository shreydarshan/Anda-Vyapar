/* ============================================================
   UDHAR (CREDIT) MANAGEMENT
   ============================================================ */
function updUdharCount(){
  const cnt=Object.keys(udhar).filter(k=>udhar[k].total>0).length;
  document.getElementById('udhar-count').textContent=cnt;
  document.getElementById('u-cnt').textContent=cnt;
  const tot=Object.values(udhar).reduce((s,u)=>s+u.total,0);
  document.getElementById('u-tot').innerHTML=formatExpandableCurrency(tot);
}
function refreshUdharDatalist(){
  const keys=Object.keys(udhar);
  document.getElementById('udl').innerHTML=keys.map(k=>`<option value="${k}">`).join('');
  // Also refresh order customer datalist with all known names
  const allNames=[...new Set([
    ...keys,
    ...orders.map(o=>o.cname).filter(n=>n&&n!=='Walk-in'&&n!=='Walk-in Customer'&&n!=='सामान्य ग्राहक')
  ])];
  const cdl=document.getElementById('cdl');
  if(cdl)cdl.innerHTML=allNames.map(n=>`<option value="${n}">`).join('');
}
function addUdhar(){
  const cn=document.getElementById('u-cname').value.trim();
  const amt=parseFloat(document.getElementById('u-amt').value);
  const note=document.getElementById('u-note').value.trim();
  if(!cn){toast(lang==='hi'?'नाम डालें':'Enter customer name','te');return;}
  if(!amt||amt<=0){toast(lang==='hi'?'सही राशि डालें':'Enter valid amount','te');return;}
  if(!udhar[cn])udhar[cn]={entries:[],total:0};
  udhar[cn].entries.unshift({orderId:null,amt,itemDesc:note||(lang==='hi'?'मैन्युअल':'Manual'),boxes:0,trays:0,pieces:0,totalEggs:0,ts:nowStr(),settled:false});
  udhar[cn].total+=amt;
  ['u-cname','u-amt','u-note'].forEach(id=>document.getElementById(id).value='');
  updUdharCount();refreshUdharDatalist();renderUdhar();svSync();
  toast(lang==='hi'?'उधार जोड़ा गया':'Udhar added','ts');
}
// ── EDIT MANUAL UDHAR ENTRY (spec section 10) ───────────────────────
// Only entries with orderId === null (added via "Add Udhar" directly,
// not generated from a billed order) are edited here. An order-linked
// entry is edited through Edit Order instead (openEditOrder), which
// already owns the stock+Udhar reconciliation for that case — editing
// it here too would create two divergent code paths for the same
// entry. Same settlement-safety rule as everywhere else: refuse if
// this entry has already been (partially or fully) settled.
let udharEditCtx=null;
function openEditUdharEntry(cn,idx){
  const u=udhar[cn]; if(!u) return;
  const e=u.entries[idx];
  if(e.orderId){toast(lang==='hi'?'यह एंट्री ऑर्डर से जुड़ी है — ऑर्डर संपादित करें':'This entry is linked to an order — edit the order instead','te');return;}
  if(e.settled){toast(lang==='hi'?'इस एंट्री का भुगतान हो चुका है — संपादित नहीं किया जा सकता':'This entry has already been settled — it cannot be edited','te');return;}
  udharEditCtx={cn,idx};
  document.getElementById('eduh-cname').value=cn;
  document.getElementById('eduh-amt').value=e.amt;
  document.getElementById('eduh-note').value=e.itemDesc||'';
  document.getElementById('eduh-modal').style.display='flex';
}
function closeEditUdharEntry(){document.getElementById('eduh-modal').style.display='none';udharEditCtx=null;}
function saveEditUdharEntry(){
  if(!udharEditCtx)return;
  const {cn,idx}=udharEditCtx;
  const newCn=document.getElementById('eduh-cname').value.trim();
  const amt=parseFloat(document.getElementById('eduh-amt').value);
  const note=document.getElementById('eduh-note').value.trim();
  if(!newCn){toast(lang==='hi'?'नाम डालें':'Enter customer name','te');return;}
  if(!amt||amt<=0){toast(lang==='hi'?'सही राशि डालें':'Enter valid amount','te');return;}
  const u=udhar[cn]; if(!u){closeEditUdharEntry();return;}
  const e=u.entries[idx];
  const oldAmt=safeNum(e.amt);
  const changes=[];
  if(newCn===cn){
    if(Math.abs(oldAmt-amt)>0.01)changes.push((lang==='hi'?'राशि: ':'Amount: ')+'₹'+oldAmt.toFixed(2)+' \u2192 ₹'+amt.toFixed(2));
    if((e.itemDesc||'')!==(note||e.itemDesc))changes.push((lang==='hi'?'नोट: ':'Note: ')+(e.itemDesc||'\u2014')+' \u2192 '+(note||e.itemDesc||'\u2014'));
    // Same customer — just adjust this entry's amount in place.
    u.total=+Math.max(0,u.total-oldAmt+amt).toFixed(2);
    e.amt=amt; e.itemDesc=note||e.itemDesc;
    if(changes.length){
      if(!Array.isArray(e.editHistory))e.editHistory=[];
      e.editHistory.push({ts:nowStr(),changes});
    }
  } else {
    // Moved to a different customer — remove from old, add to new,
    // same move-between-buckets pattern as Edit Order's cname change.
    u.entries.splice(idx,1);
    u.total=Math.max(0,+(u.total-oldAmt).toFixed(2));
    if(!u.entries.length&&!(u.settlements||[]).length)delete udhar[cn];
    if(!udhar[newCn])udhar[newCn]={entries:[],total:0,settlements:[]};
    udhar[newCn].entries.unshift({orderId:null,amt,itemDesc:note||(lang==='hi'?'मैन्युअल':'Manual'),boxes:0,trays:0,pieces:0,totalEggs:0,ts:e.ts,settled:false});
    udhar[newCn].total=+(udhar[newCn].total+amt).toFixed(2);
  }
  closeEditUdharEntry();
  updUdharCount();refreshUdharDatalist();renderUdhar();svSync();
  toast(lang==='hi'?'उधार एंट्री अपडेट की गई':'Udhar entry updated','ts');
}

function openSettleModal(cn){
  const u=udhar[cn];
  if(!u||u.total<=0){toast(lang==='hi'?'कोई बकाया नहीं':'No pending amount','ti');return;}
  settleCtx={cn};
  document.getElementById('settle-modal-body').innerHTML=`
    <div style="background:var(--pbg);border:1px solid var(--pb);border-radius:var(--rs);padding:.9rem;margin-bottom:.85rem">
      <div style="font-family:'Baloo 2',cursive;font-size:15px;font-weight:700;color:var(--pur)">${cn}</div>
      <div style="font-size:13px;margin-top:4px;color:var(--t2)">${lang==='hi'?'कुल बकाया:':'Total pending:'} <strong style="color:var(--red);font-size:16px">${formatExpandableCurrency(u.total)}</strong></div>
    </div>
    <p style="font-size:12px;color:var(--t2);margin-bottom:.5rem" class="tl" data-e="Enter the amount received. Partial payment is allowed — it will deduct from the oldest entries first." data-h="मिली हुई राशि डालें। आंशिक भुगतान ठीक है — पुरानी एंट्री से पहले घटेगा।">Enter the amount received. Partial payment allowed — deducts from oldest entries first.</p>
  `;
  document.getElementById('settle-amt-input').value='';
  document.getElementById('settle-remaining').textContent='';
  document.getElementById('settle-modal').style.display='flex';
  // Auto-focus (spec section 8): ready to type the amount immediately.
  const amtInput = document.getElementById('settle-amt-input');
  if (amtInput) amtInput.focus();
}
function closeSettleModal(){document.getElementById('settle-modal').style.display='none';settleCtx=null;}
function onSettleAmtInput(){
  if(!settleCtx)return;
  const amt=parseFloat(document.getElementById('settle-amt-input').value)||0;
  const total=udhar[settleCtx.cn]?.total||0;
  const rem=Math.max(0,total-amt);
  const el=document.getElementById('settle-remaining');
  if(amt<=0){el.textContent='';return;}
  if(amt>total){
    el.style.color='var(--red)';
    el.textContent=(lang==='hi'?'⚠️ राशि बकाया से ज्यादा है! बकाया: ':'⚠️ Amount exceeds pending! Pending: ')+formatIndianCurrency(total);
  }else if(amt===total){
    el.style.color='var(--grn)';
    el.textContent=lang==='hi'?'✓ पूरा बकाया चुकता हो जाएगा':'✓ Full amount — udhar fully cleared!';
  }else{
    el.style.color='var(--t2)';
    el.textContent=(lang==='hi'?'भुगतान के बाद बकाया: ':'Remaining after payment: ')+formatIndianCurrency(rem);
  }
}
function confirmPartialSettle(){
  if(!settleCtx)return;
  const cn=settleCtx.cn;
  let amtReceived=parseFloat(document.getElementById('settle-amt-input').value);
  if(!amtReceived||amtReceived<=0){toast(lang==='hi'?'राशि डालें':'Enter amount','te');return;}
  const u=udhar[cn];
  if(amtReceived>u.total+0.001){toast(lang==='hi'?'राशि बकाया से ज्यादा नहीं हो सकती':'Amount cannot exceed pending','te');return;}
  const pay=Math.min(amtReceived,u.total);
  // Record in settlement history
  if(!u.settlements)u.settlements=[];
  u.settlements.unshift({amt:+pay.toFixed(2),ts:nowStr(),isoDate:isoToday()});
  // Deduct from oldest unsettled entries
  let remaining=pay;
  const reversed=[...u.entries].map((e,i)=>({e,i})).reverse();
  for(const {e,i} of reversed){
    if(e.settled||remaining<=0)continue;
    if(e.amt<=remaining+0.001){remaining=+(remaining-e.amt).toFixed(2);u.entries[i].settled=true;if(e.orderId){const o=orders.find(x=>x.id===e.orderId);if(o)o.paid=true;}}
    else{u.entries[i].amt=+(e.amt-remaining).toFixed(2);remaining=0;}
  }
  u.total=+Math.max(0,u.total-pay).toFixed(2);
  closeSettleModal();
  updUdharCount();renderUdhar();renderHist();svSync();
  toast(formatIndianCurrency(pay)+(lang==='hi'?' प्राप्त हुआ — उधार अपडेट':' received — udhar updated'),'ts');
}
function settleEntry(cn,idx){
  // open modal WITHOUT pre-filling — user must type amount manually
  const u=udhar[cn];
  if(!u)return;
  settleCtx={cn};
  const e=u.entries[idx];
  document.getElementById('settle-modal-body').innerHTML=`
    <div style="background:var(--pbg);border:1px solid var(--pb);border-radius:var(--rs);padding:.9rem;margin-bottom:.85rem">
      <div style="font-family:'Baloo 2',cursive;font-size:15px;font-weight:700;color:var(--pur)">${cn}</div>
      <div style="font-size:12px;color:var(--t2);margin-top:4px">${e.itemDesc||''} — ${e.ts}</div>
      <div style="font-size:13px;margin-top:4px">${lang==='hi'?'इस एंट्री का बकाया:':'This entry pending:'} <strong style="color:var(--red)">${formatIndianCurrency(e.amt)}</strong></div>
      <div style="font-size:12px;color:var(--t2);margin-top:2px">${lang==='hi'?'कुल बकाया (सभी एंट्री):':'Total all entries pending:'} <strong>${formatIndianCurrency(u.total)}</strong></div>
    </div>
    <p style="font-size:12px;color:var(--t2);margin-bottom:.5rem">${lang==='hi'?'जितनी राशि मिली हो वो डालें:':'Enter the amount received now:'}</p>
  `;
  document.getElementById('settle-amt-input').value=''; // NO auto-fill
  document.getElementById('settle-remaining').textContent='';
  document.getElementById('settle-modal').style.display='flex';
}
function settleAll(cn){
  openSettleModal(cn);
  // No pre-fill — user manually types
}
async function delUdharCust(cn){
  if(!(await showConfirm(lang==='hi'?cn+' का उधार हटाएं?':'Delete udhar for '+cn+'?')))return;
  delete udhar[cn];updUdharCount();refreshUdharDatalist();renderUdhar();svSync();
}
// Debounced specifically for the search box's oninput — every OTHER
// call site (settle, delete, tab switch) still calls renderUdhar()
// directly and immediately, since those are discrete actions that
// should reflect instantly, not per-keystroke typing.
const onUdharSearchInput = debounce(() => renderUdhar(), 200);
let _expandedUdharHist=new Set();
function toggleUdharEntryHistory(cn,idx){
  const key=cn+':'+idx;
  if(_expandedUdharHist.has(key))_expandedUdharHist.delete(key);else _expandedUdharHist.add(key);
  renderUdhar();
}
function renderUdhar(){
  const q=(document.getElementById('u-search').value||'').toLowerCase();
  const keys=Object.keys(udhar).filter(k=>!q||k.toLowerCase().includes(q));
  const el=document.getElementById('u-list'),em=document.getElementById('u-empty');
  updUdharCount();
  if(!keys.length){em.style.display='block';el.innerHTML='';return;}
  em.style.display='none';
  el.innerHTML=keys.map(cn=>{
    const u=udhar[cn];
    const esc=cn.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    // Pending entries
    const entries=u.entries.map((e,i)=>{
      const bpArr=[];if(e.boxes)bpArr.push(e.boxes+' box');if(e.trays)bpArr.push(e.trays+' tray');if(e.pieces)bpArr.push(e.pieces+' pcs');
      const histKey=cn+':'+i;
      const hasHist=Array.isArray(e.editHistory)&&e.editHistory.length;
      const editedBadge=hasHist?` <span style="cursor:pointer;color:var(--t3);font-size:10px" title="${lang==='hi'?'बदलाव देखें':'View changes'}" onclick="toggleUdharEntryHistory('${esc}',${i})">✎ ${lang==='hi'?'संपादित':'edited'}</span>`:'';
      const histBlock=(hasHist&&_expandedUdharHist.has(histKey))?`<div style="background:var(--s2);border-radius:6px;padding:.4rem .6rem;margin-top:4px;font-size:11px;color:var(--t2)">
        ${e.editHistory.map(h=>`<div style="margin-bottom:3px"><strong>${h.ts}</strong><br>${h.changes.map(c=>'• '+c).join('<br>')}</div>`).join('')}
      </div>`:'';
      return`<div class="ue">
        <div style="flex:1">
          <div style="color:var(--t2);font-size:12px">${e.ts}${e.orderId?' — Order #'+e.orderId:''}${editedBadge}</div>
          <div style="color:var(--t1);font-size:12px;font-weight:500">${e.itemDesc||''}${bpArr.length?' ('+bpArr.join('+')+')':''}</div>
          ${histBlock}
        </div>
        <span style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;flex-shrink:0">
          <span style="font-weight:700;color:${e.settled?'var(--grn)':'var(--red)'}">${formatIndianCurrency(e.amt)} ${e.settled?'✓':''}</span>
          ${!e.orderId&&!e.settled?`<button class="ib ib-blu" onclick="openEditUdharEntry('${esc}',${i})" title="Edit">✎</button>`:''}
          ${!e.settled?`<button class="btn bg bsm" style="height:22px;padding:0 8px;font-size:11px" onclick="settleEntry('${esc}',${i})">${lang==='hi'?'चुकाया':'Settle'}</button>`:''}
        </span>
      </div>`;
    }).join('');
    // Settlement history
    const settleHist=(u.settlements||[]).map(s=>`
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px dashed var(--gb)">
        <span style="color:var(--grn)">✓ ${lang==='hi'?'राशि मिली':'Amount received'}</span>
        <span><strong style="color:var(--grn)">${formatIndianCurrency(s.amt)}</strong> &nbsp;<span style="color:var(--t3)">${s.ts}</span></span>
      </div>`).join('');
    return`<div class="uc">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px">
        <div><div class="un">${cn}</div><div class="ua">${lang==='hi'?'बकाया:':'Pending:'} ${formatIndianCurrency(u.total)}</div></div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          ${u.total>0?`<button class="btn bpu bsm" onclick="settleAll('${esc}')">✓ ${lang==='hi'?'भुगतान लें':'Receive Payment'}</button>`:''}
          <button class="btn br bsm" onclick="delUdharCust('${esc}')">🗑</button>
        </div>
      </div>
      <!-- Udhar entries -->
      <div style="margin-top:7px;border-top:1px dashed var(--pb);padding-top:7px">${entries}</div>
      <!-- Settlement history -->
      ${settleHist?`<div style="background:var(--gbg);border-radius:var(--rs);padding:.6rem .9rem;margin-top:.6rem">
        <div style="font-size:11px;font-weight:700;color:var(--grn);letter-spacing:.04em;text-transform:uppercase;margin-bottom:4px">${lang==='hi'?'भुगतान इतिहास':'Settlement History'}</div>
        ${settleHist}
      </div>`:''}
    </div>`;
  }).join('');
}

// ── REPORT ────────────────────────────────────────────