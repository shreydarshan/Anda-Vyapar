/* ============================================================
   RATE MANAGEMENT
   ============================================================ */
function setRate(u) {
  const v = parseFloat(document.getElementById('r-' + u).value);
  if (!v || v <= 0) { toast(lang === 'hi' ? 'सही दर डालें' : 'Enter a valid rate', 'te'); return; }
  rates[u] = v;
  document.getElementById('r-' + u).disabled = true;
  document.getElementById('rbtn-' + u).style.display = 'none';
  document.getElementById('rch-' + u).style.display = 'inline-flex';
  document.getElementById('rv-' + u).textContent = formatIndianCurrency(v);
  document.getElementById('rv-' + u).style.display = 'block';
  document.getElementById('rl-' + u).style.display = 'block';
  document.getElementById('rc-' + u).classList.add('set');
  updRateSum(); updatePrev();
  toast((lang === 'hi' ? 'दर सेट: ' : 'Rate set: ') + formatIndianCurrency(v), 'ts'); svSync();
}
function changeRate(u) {
  rates[u] = null;
  document.getElementById('r-' + u).disabled = false; document.getElementById('r-' + u).value = '';
  document.getElementById('rbtn-' + u).style.display = 'inline-flex';
  document.getElementById('rch-' + u).style.display = 'none';
  document.getElementById('rv-' + u).style.display = 'none'; document.getElementById('rl-' + u).style.display = 'none';
  document.getElementById('rc-' + u).classList.remove('set');
  updRateSum(); sv();
}
function updRateSum() {
  const any = rates.piece || rates.tray || rates.box;
  document.getElementById('rate-sum').style.display = any ? 'block' : 'none';
  ['piece', 'tray', 'box'].forEach(u => document.getElementById('rs-' + u).textContent = rates[u] ? formatIndianCurrency(rates[u]) : '—');
}
function restoreRates() {
  // Same class of bug as restoreShop() — this only ever handled the
  // "rate IS set" case. After a reset (rates[u] becomes null), none
  // of these elements were ever told to go back to their "not set"
  // state: the input stayed disabled with the old value still
  // showing, the Change button stayed hidden, "Rate saved ✓" stayed
  // visible. Now both directions are handled explicitly.
  ['piece', 'tray', 'box'].forEach(u => {
    if (rates[u]) {
      document.getElementById('r-' + u).value = rates[u];
      document.getElementById('r-' + u).disabled = true;
      document.getElementById('rbtn-' + u).style.display = 'none';
      document.getElementById('rch-' + u).style.display = 'inline-flex';
      document.getElementById('rv-' + u).textContent = formatIndianCurrency(rates[u]);
      document.getElementById('rv-' + u).style.display = 'block';
      document.getElementById('rl-' + u).style.display = 'block';
      document.getElementById('rc-' + u).classList.add('set');
    } else {
      document.getElementById('r-' + u).value = '';
      document.getElementById('r-' + u).disabled = false;
      document.getElementById('rbtn-' + u).style.display = 'inline-flex';
      document.getElementById('rch-' + u).style.display = 'none';
      document.getElementById('rv-' + u).textContent = '';
      document.getElementById('rv-' + u).style.display = 'none';
      document.getElementById('rl-' + u).style.display = 'none';
      document.getElementById('rc-' + u).classList.remove('set');
    }
  });
  updRateSum();
  refreshOrdTypeRates();
}
