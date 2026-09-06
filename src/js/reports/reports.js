/* ============================================================
   REPORTS
   ============================================================ */
function renderReport(){
  const em=document.getElementById('rp-empty'),el=document.getElementById('rp-list');
  if(!orders.length){em.style.display='block';el.innerHTML='';
    ['rp-days','rp-box','rp-tray','rp-piece'].forEach(id=>document.getElementById(id).textContent=0);
    document.getElementById('rp-rev').textContent='₹0';return;}
  em.style.display='none';
  const dm={};
  orders.forEach(o=>{
    const dk=o.isoDate||'Unknown';
    if(!dm[dk])dm[dk]={orders:[],eggs:0,amt:0,paid:0,pend:0};
    dm[dk].orders.push(o);dm[dk].eggs+=safeNum(o.totalEggs);dm[dk].amt+=safeNum(o.totalAmt);
    if(o.paid)dm[dk].paid+=safeNum(o.totalAmt);else dm[dk].pend+=safeNum(o.totalAmt);
  });
  const days=Object.keys(dm).sort((a,b)=>b.localeCompare(a));
  const te=orders.reduce((s,o)=>s+safeNum(o.totalEggs),0);
  const ta=orders.reduce((s,o)=>s+safeNum(o.totalAmt),0);
  const tBD=eggBD(te);
  document.getElementById('rp-days').textContent=days.length;
  document.getElementById('rp-box').innerHTML=formatExpandableNumber(tBD.boxes);
  document.getElementById('rp-tray').innerHTML=formatExpandableNumber(tBD.trays);
  document.getElementById('rp-piece').innerHTML=formatExpandableNumber(tBD.pieces);
  document.getElementById('rp-rev').innerHTML=formatExpandableCurrency(ta);
  // Don't dump every day a business has ever traded into the DOM at
  // once — each day's detail body is collapsed by default already,
  // but the header row itself still renders per day, and that adds
  // up over months/years of history. Show the most recent
  // `reportDaysShown` days; a "Show all" link reveals the rest on
  // demand instead of loading it unconditionally.
  const visibleDays=days.slice(0,reportDaysShown);
  el.innerHTML=visibleDays.map(dk=>{
    const d=dm[dk];const dBD=eggBD(d.eggs);
    const bpArr=[];if(dBD.boxes)bpArr.push('<strong>'+dBD.boxes+'</strong> box sold');if(dBD.trays)bpArr.push('<strong>'+dBD.trays+'</strong> tray sold');if(dBD.pieces)bpArr.push('<strong>'+dBD.pieces+'</strong> pcs sold');
    const orows=d.orders.map(o=>{
      const ob=o.boxes!==undefined?o:eggBD(o.totalEggs);
      const obP=[];if(ob.boxes)obP.push(ob.boxes+'bx');if(ob.trays)obP.push(ob.trays+'tr');if(ob.pieces)obP.push(ob.pieces+'pc');
      const typeBadge=o.isUdhar&&!o.paid?`<span style="background:var(--pbg);color:var(--pur);padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700">${lang==='hi'?'उधार':'Udhar'}</span>`:o.paid?`<span style="background:var(--gbg);color:var(--grn);padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700">${lang==='hi'?'भुगतान':'Paid'}</span>`:`<span style="background:var(--s2);color:var(--t2);padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700">${lang==='hi'?'नकद':'Cash'}</span>`;
      return`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--bdr);font-size:12px;flex-wrap:wrap;gap:4px">
        <span style="color:var(--t2)">#${o.id} <strong>${o.cname}</strong> — ${o.items.map(it=>it.qty+' '+tName(it.type)).join(', ')} (${obP.join('+')||'0'}) ${typeBadge}</span>
        <span style="font-weight:700;color:var(--acc)">${formatIndianCurrency(o.totalAmt)}</span>
      </div>`;
    }).join('');
    return`<div class="rd">
      <div class="rdh" onclick="this.nextElementSibling.classList.toggle('open')">
        <span>${dk} — ${d.orders.length} ${lang==='hi'?'ऑर्डर':'orders'} — ${bpArr.join(' + ')||'0'}</span>
        <span style="color:var(--acc)">${formatExpandableCurrency(d.amt)} ▾</span>
      </div>
      <div class="rdb">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:.75rem">
          <div style="background:var(--gbg);border-radius:7px;padding:.5rem .75rem"><div style="font-size:11px;color:var(--grn);font-weight:600">${lang==='hi'?'नकद':'Cash/Paid'}</div><div style="font-family:'Baloo 2',cursive;font-weight:800;color:var(--grn)">${formatIndianCurrency(d.paid)}</div></div>
          <div style="background:var(--pbg);border-radius:7px;padding:.5rem .75rem"><div style="font-size:11px;color:var(--pur);font-weight:600">${lang==='hi'?'उधार':'Udhar'}</div><div style="font-family:'Baloo 2',cursive;font-weight:800;color:var(--pur)">${formatIndianCurrency(d.pend)}</div></div>
          <div style="background:var(--tbg);border-radius:7px;padding:.5rem .75rem"><div style="font-size:11px;color:var(--tel);font-weight:600">${lang==='hi'?'बिका':'Sold'}</div><div style="font-family:'Baloo 2',cursive;font-weight:800;color:var(--tel);font-size:12px">${bpArr.join('+').replace(/<[^>]+>/g,'')||'0'}</div></div>
        </div>
        ${orows}
      </div>
    </div>`;
  }).join('');
  if(days.length>reportDaysShown){
    el.innerHTML+=`<div style="text-align:center;padding:.75rem">
      <button class="btn bo bsm" onclick="reportDaysShown+=30;renderReport()">${lang==='hi'?`और दिखाएं (${days.length-reportDaysShown} बाकी)`:`Show more (${days.length-reportDaysShown} more days)`}</button>
    </div>`;
  }
}

// ── CUSTOMER LEDGER ───────────────────────────────────
// Rate is ALWAYS per egg. Total = eggs × rate_per_egg