'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'chagog.ledger.v1';
  const number = new Intl.NumberFormat('ko-KR');
  const won = value => `${number.format(value)}원`;
  const monthLabel = month => month === 'all' ? '전체 기간' : `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
  let state = { transactions: [], month: 'all', fileName: '' };
  let uploading = false;

  function showMessage(id, message) { $(id).textContent = message; $(id).hidden = !message; }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...state }));
      showMessage('storage-message', '');
    } catch {
      showMessage('storage-message', '브라우저 저장 공간이 부족하거나 저장이 차단되어 새로고침 후 이번 변경을 유지할 수 없습니다. 필요한 거래를 CSV로 내려받아 주세요.');
    }
  }
  function restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw);
      if (stored.version !== 1 || typeof stored.fileName !== 'string') throw new Error('Invalid saved data');
      const transactions = Ledger.validateTransactions(stored.transactions);
      const month = Ledger.months(transactions).includes(stored.month) ? stored.month : 'all';
      state = { transactions, month, fileName: stored.fileName };
    } catch {
      showMessage('storage-message', '이전에 저장한 기록을 불러올 수 없습니다. 브라우저의 저장 허용 설정을 확인하거나 CSV를 다시 올려 주세요.');
    }
  }
  function metric(id, amount) {
    $(id).replaceChildren(document.createTextNode(number.format(amount)));
    const unit = document.createElement('span'); unit.textContent = '원'; $(id).append(unit);
  }
  function element(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function render() {
    const loaded = state.transactions.length > 0;
    $('welcome').hidden = loaded; $('dashboard').hidden = !loaded; $('replace-button').hidden = !loaded;
    if (!loaded) return;
    $('page-title').textContent = '내 지출 한눈에';
    $('page-subtitle').textContent = '차곡차곡 쌓인 기록에서 나의 소비 흐름을 발견해 보세요.';
    $('source-name').textContent = state.fileName;
    $('source-name').title = state.fileName;
    $('source-count').textContent = `· 총 ${number.format(state.transactions.length)}건`;
    $('month-select').replaceChildren(...['all', ...Ledger.months(state.transactions)].map(month => {
      const option = document.createElement('option'); option.value = month; option.textContent = monthLabel(month); return option;
    }));
    $('month-select').value = state.month;
    const selected = Ledger.selectTransactions(state.transactions, state.month);
    const summary = Ledger.summarize(selected);
    $('period-label').textContent = monthLabel(state.month);
    metric('net-total', summary.net); metric('expense-total', summary.expense); metric('refund-total', summary.refund);
    $('all-total').textContent = `전체 누적 순지출 ${won(Ledger.summarize(state.transactions).net)}`;
    $('expense-count').textContent = `${number.format(summary.expenseCount)}건의 지출`;
    $('refund-count').textContent = `${number.format(summary.refundCount)}건의 환급`;
    $('filtered-count').textContent = `${number.format(selected.length)}건`;
    const max = summary.categories.reduce((largest, [, amount]) => Math.max(largest, Math.abs(amount)), 1);
    const chart = document.createDocumentFragment();
    for (const [category, amount] of summary.categories) {
      const li = element('li', 'category-row' + (amount < 0 ? ' negative' : ''));
      const head = element('div', 'category-head');
      head.append(element('span', 'category-name', category), element('span', 'category-value', won(amount) + (amount < 0 ? ' · 환급 초과' : '')));
      const track = element('div', 'bar-track'); track.setAttribute('aria-hidden', 'true');
      const bar = element('div', 'bar'); bar.style.width = `${Math.abs(amount) / max * 100}%`; track.append(bar);
      li.append(head, track); chart.append(li);
    }
    $('category-chart').replaceChildren(chart);
    const list = document.createDocumentFragment();
    for (const t of selected) {
      const li = element('li', 'transaction-item');
      const date = element('time', 'transaction-date', t.date.replaceAll('-', '.')); date.dateTime = t.date;
      const amount = element('div', 'transaction-amount' + (t.type === 'refund' ? ' is-refund' : ''), (t.type === 'refund' ? '−' : '') + won(t.amount_krw));
      amount.append(element('small', '', t.type === 'refund' ? '환급' : '지출'));
      li.append(date, element('span', 'merchant', t.merchant), element('span', 'transaction-category', t.category), amount);
      list.append(li);
    }
    $('transaction-list').replaceChildren(list);
  }
  async function upload(file) {
    if (!file || uploading) return;
    uploading = true;
    $('upload-button').disabled = true; $('replace-button').disabled = true;
    showMessage('error-message', '');
    $('upload-status').textContent = 'CSV 파일을 읽고 있습니다.';
    try {
      const bytes = await file.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error('UTF-8로 읽을 수 없는 파일입니다. CSV를 UTF-8 인코딩으로 저장한 뒤 다시 올려 주세요.'); }
      const transactions = Ledger.parseCSV(text);
      state = { transactions, fileName: file.name, month: 'all' };
      save(); render();
      $('upload-status').textContent = `${transactions.length}건을 불러왔습니다. 전체 기간의 순지출은 ${won(Ledger.summarize(transactions).net)}입니다.`;
      $('month-select').focus();
    } catch (error) {
      showMessage('error-message', `파일을 불러오지 못했습니다. ${error.message || '파일을 다시 선택해 주세요.'}${state.transactions.length ? ' 기존 기록은 그대로 유지됩니다.' : ''}`);
      $('upload-status').textContent = '';
    } finally {
      uploading = false; $('file-input').value = '';
      $('upload-button').disabled = false; $('replace-button').disabled = false;
    }
  }
  $('upload-button').addEventListener('click', () => $('file-input').click());
  $('replace-button').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', event => upload(event.target.files[0]));
  const dropZone = $('drop-zone');
  dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('dragging'); });
  dropZone.addEventListener('dragleave', event => { if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('dragging'); });
  dropZone.addEventListener('drop', event => {
    event.preventDefault(); dropZone.classList.remove('dragging');
    if (event.dataTransfer.files.length !== 1) { showMessage('error-message', 'CSV 파일을 한 번에 하나씩 올려 주세요.'); return; }
    upload(event.dataTransfer.files[0]);
  });
  $('month-select').addEventListener('change', event => {
    state.month = event.target.value; save(); render();
    $('upload-status').textContent = `${monthLabel(state.month)}의 합계, 차트, 거래 내역을 표시합니다.`;
  });
  $('export-button').addEventListener('click', () => {
    try {
      const csv = Ledger.toCSV(Ledger.selectTransactions(state.transactions, state.month));
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `차곡_거래내역_${state.month === 'all' ? '전체' : state.month}.csv`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('upload-status').textContent = '현재 조회 기간의 CSV 내려받기를 요청했습니다.';
    } catch { showMessage('error-message', 'CSV 내려받기를 시작하지 못했습니다. 브라우저의 다운로드 설정을 확인해 주세요.'); }
  });
  restore(); render();
})();
