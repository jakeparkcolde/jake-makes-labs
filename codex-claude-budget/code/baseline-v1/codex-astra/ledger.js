(function (root) {
  'use strict';
  const COLUMNS = ['transaction_id', 'date', 'merchant', 'category', 'amount_krw', 'type', 'original_transaction_id'];
  const REQUIRED = COLUMNS.slice(0, 6);

  function readRows(input) {
    const text = input.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closed = false;
    const pushField = () => { row.push(field); field = ''; closed = false; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else { field += c; }
      } else if (c === ',') { pushField(); }
      else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        pushRow();
      } else if (closed) {
        throw new Error('CSV 따옴표 뒤에 잘못된 문자가 있습니다. 쉼표와 줄바꿈 형식을 확인해 주세요.');
      } else if (c === '"') {
        if (field.length) throw new Error('CSV 따옴표 형식이 올바르지 않습니다. 값을 큰따옴표로 감싸 주세요.');
        quoted = true;
      } else { field += c; }
    }
    if (quoted) throw new Error('CSV의 닫는 따옴표가 빠져 있습니다. 파일 형식을 확인해 주세요.');
    if (field.length || row.length || closed) pushRow();
    return rows.filter(r => r.some(value => value.trim() !== ''));
  }

  function isDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validateTransactions(transactions) {
    if (!Array.isArray(transactions) || !transactions.length) throw new Error('거래 내역이 없습니다. 제목 행 아래에 거래를 추가해 주세요.');
    const ids = new Set();
    let total = 0;
    return transactions.map((t, i) => {
      const prefix = `${i + 2}번째 CSV 레코드: `;
      if (!t || REQUIRED.some(key => t[key] === undefined || t[key] === null || String(t[key]).trim() === '')) throw new Error(prefix + '필수 값이 비어 있습니다. 거래 ID·날짜·가맹점·분류·금액·유형을 확인해 주세요.');
      for (const key of ['transaction_id', 'date', 'merchant', 'category', 'type']) {
        if (typeof t[key] !== 'string') throw new Error(prefix + '텍스트 형식을 확인해 주세요.');
      }
      if (!isDate(t.date)) throw new Error(prefix + '날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.');
      if (!['expense', 'refund'].includes(t.type)) throw new Error(prefix + 'type은 지출 expense 또는 환급 refund여야 합니다.');
      if (!/^\d+$/.test(String(t.amount_krw)) || !Number.isSafeInteger(Number(t.amount_krw))) throw new Error(prefix + '금액은 원 단위의 0 이상 정수여야 합니다. 쉼표나 원 기호는 빼 주세요.');
      if (ids.has(t.transaction_id)) throw new Error(prefix + `거래 ID “${t.transaction_id}”가 중복되었습니다. 각 거래에 고유한 ID를 사용해 주세요.`);
      ids.add(t.transaction_id);
      const amount = Number(t.amount_krw);
      total += amount;
      if (!Number.isSafeInteger(total)) throw new Error('거래 금액의 합계가 안전하게 계산할 수 있는 범위를 초과했습니다.');
      return Object.fromEntries(COLUMNS.map(key => [key, key === 'amount_krw' ? amount : String(t[key] ?? '')]));
    });
  }

  function parseCSV(text) {
    if (!text.replace(/^\uFEFF/, '').trim()) throw new Error('빈 파일입니다. 거래 내역이 들어 있는 CSV 파일을 선택해 주세요.');
    const rows = readRows(text);
    if (!rows.length) throw new Error('빈 파일입니다. 거래 내역이 들어 있는 CSV 파일을 선택해 주세요.');
    const headers = rows[0].map(h => h.trim());
    const missing = REQUIRED.filter(key => !headers.includes(key));
    if (missing.length) throw new Error(`필수 열이 없습니다: ${missing.join(', ')}. CSV의 첫 행을 확인해 주세요.`);
    if (new Set(headers).size !== headers.length) throw new Error('중복된 열 이름이 있습니다. CSV의 첫 행을 확인해 주세요.');
    const transactions = rows.slice(1).map((row, i) => {
      if (row.length !== headers.length) throw new Error(`${i + 2}번째 CSV 레코드: 열 개수가 제목 행과 다릅니다. 쉼표가 들어간 값은 큰따옴표로 감싸 주세요.`);
      return Object.fromEntries(headers.map((key, index) => [key, row[index].trim()]));
    });
    return validateTransactions(transactions);
  }

  function months(transactions) { return [...new Set(transactions.map(t => t.date.slice(0, 7)))].sort().reverse(); }
  function selectTransactions(transactions, month) {
    return transactions.filter(t => month === 'all' || t.date.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date));
  }
  function summarize(transactions) {
    let expense = 0, refund = 0, expenseCount = 0, refundCount = 0;
    const categories = new Map();
    for (const t of transactions) {
      const amount = t.amount_krw;
      if (t.type === 'expense') { expense += amount; expenseCount++; }
      else { refund += amount; refundCount++; }
      categories.set(t.category, (categories.get(t.category) || 0) + (t.type === 'expense' ? amount : -amount));
    }
    return { net: expense - refund, expense, refund, expenseCount, refundCount, categories: [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')) };
  }
  function toCSV(transactions) {
    const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return '\uFEFF' + [COLUMNS, ...transactions.map(t => COLUMNS.map(key => t[key]))].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
  }
  const api = { COLUMNS, parseCSV, validateTransactions, months, selectTransactions, summarize, toCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ledger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
