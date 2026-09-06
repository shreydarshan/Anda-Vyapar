/* ============================================================
   LANGUAGE + TOAST
   ============================================================ */
function applyLang() {
  const h = lang === 'hi';
  document.querySelectorAll('.tl[data-e]').forEach(el => { el.textContent = h ? el.getAttribute('data-h') : el.getAttribute('data-e'); });
  document.getElementById('lbtn').textContent = h ? 'EN' : 'हिं';
  document.getElementById('htit').textContent = h ? 'अंडा व्यापार' : 'Anda Vyapar';
  document.getElementById('hsub').textContent = h ? 'Egg Business Manager' : 'अंडा व्यापार';
  document.getElementById('cname-hint').textContent = h ? '(वैकल्पिक)' : '(optional)';
  document.getElementById('f-all').textContent = h ? 'सभी' : 'All';
  document.getElementById('f-cash').textContent = h ? 'नकद' : 'Cash';
  document.getElementById('f-udhar').textContent = h ? 'उधार' : 'Udhar';
  document.getElementById('f-paid').textContent = h ? 'भुगतान' : 'Paid';
  document.getElementById('clr-date').textContent = h ? 'साफ' : 'Clear';
  const slAll = document.getElementById('sl-all'), slIn = document.getElementById('sl-in'), slOut = document.getElementById('sl-out');
  if (slAll) slAll.textContent = h ? 'सभी' : 'All';
  if (slIn) slIn.textContent = h ? 'जोड़ा' : 'IN';
  if (slOut) slOut.textContent = h ? 'घटाया' : 'OUT';
  const it = document.getElementById('item-type');
  it.options[0].text = h ? 'अंडा — पीस' : 'Egg — Per Piece';
  it.options[1].text = h ? 'ट्रे — 30 अंडे' : 'Tray — 30 eggs';
  it.options[2].text = h ? 'बॉक्स — 7 ट्रे / 210 अंडे' : 'Box — 7 trays / 210 eggs';
  const ou = document.getElementById('order-udhar');
  ou.options[0].text = h ? 'नकद' : 'Cash'; ou.options[1].text = h ? 'उधार' : 'Udhar';
}
function toggleLang() {
  lang = lang === 'en' ? 'hi' : 'en';
  applyLang();
  // applyLang() only re-labels static markup (buttons, filter pills,
  // dropdown option text). Everything rendered dynamically — order
  // rows, the stock log, the daily report, the supplier ledger — picks
  // its language at render time from bilingual ternaries inside each
  // render*() function, so switching language without re-running them
  // left those screens showing stale-language text until the next
  // unrelated re-render. Re-render everything language-sensitive here
  // so the switch is immediate everywhere, not just on static labels.
  if (typeof renderHist === 'function') renderHist();
  if (typeof renderStockLog === 'function') renderStockLog();
  if (typeof renderReport === 'function') renderReport();
  if (typeof renderCustPage === 'function') renderCustPage();
  if (typeof renderUdhar === 'function') renderUdhar();
  if (typeof renderStock === 'function') renderStock();
  if (typeof updateAccountUI === 'function') updateAccountUI();
  svSync();
}

function toast(m, t) {
  const el = document.getElementById('toast');
  el.textContent = m; el.className = 'toast show ' + (t || 'ti');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}
