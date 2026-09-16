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
    return transactions.map((t, i) => {
      const prefix = `${i + 2}번째 CSV 레코드: `;
      if (!t || REQUIRED.some(key => t[key] === undefined || t[key] === null || String(t[key]).trim() === '')) throw new Error(prefix + '필수 값이 비어 있습니다. 거래 ID·날짜·가맹점·분류·금액·유형을 확인해 주세요.');
      for (const key of ['transaction_id', 'date', 'merchant', 'category', 'type']) {
        if (typeof t[key] !== 'string') throw new Error(prefix + '텍스트 형식을 확인해 주세요.');
      }
      if (!isDate(t.date)) throw new Error(prefix + '날짜는 실제 존재하는 YYYY-MM-DD 형식이어야 합니다.');
      if (!['expense', 'refund'].includes(t.type)) throw new Error(prefix + 'type은 지출 expense 또는 환불 refund여야 합니다.');
      if (!/^-?\d+$/.test(String(t.amount_krw)) || !Number.isSafeInteger(Number(t.amount_krw))) throw new Error(prefix + '금액은 원 단위의 정수여야 합니다. 쉼표나 원 기호는 빼 주세요.');
      const amount = Number(t.amount_krw);
      if (t.type === 'expense' && amount < 0) throw new Error(prefix + '지출 금액은 0 이상이어야 합니다.');
      if (t.type === 'refund' && amount > 0) throw new Error(prefix + '환불 금액은 음수로 입력해 주세요. 부호를 그대로 합산합니다.');
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

  // Keep existing records first, then the first occurrence of each new ID.
  // Parsing validates individual rows; aggregate limits apply after deduplication.
  function mergeTransactions(existing, incoming) {
    const byId = new Map(existing.map(t => [t.transaction_id, t]));
    const previousIds = new Set(byId.keys());
    const added = [], duplicates = [];
    for (const [index, transaction] of incoming.entries()) {
      const kept = byId.get(transaction.transaction_id);
      if (kept) {
        duplicates.push({ recordNumber: index + 2, transaction, source: previousIds.has(transaction.transaction_id) ? 'existing' : 'file', conflict: COLUMNS.some(key => kept[key] !== transaction[key]) });
      } else {
        byId.set(transaction.transaction_id, transaction);
        added.push(transaction);
      }
    }
    const transactions = [...byId.values()];
    const absoluteTotal = transactions.reduce((sum, t) => sum + BigInt(Math.abs(t.amount_krw)), 0n);
    if (absoluteTotal > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('병합 후 거래 금액의 절댓값 합계가 안전하게 계산할 수 있는 범위를 초과했습니다.');
    return { transactions, added, duplicates };
  }

  function importCSV(state, text, fileName) {
    const incoming = parseCSV(text);
    const result = mergeTransactions(state.transactions, incoming);
    return {
      transactions: result.transactions,
      month: months(result.transactions).includes(state.month) ? state.month : 'all',
      fileName,
      lastImport: { fileName, inputCount: incoming.length, addedCount: result.added.length, duplicates: result.duplicates, refunds: result.added.filter(t => t.type === 'refund') }
    };
  }

  function restoreState(stored) {
    if (!stored || ![1, 2].includes(stored.version) || typeof stored.fileName !== 'string' || !Array.isArray(stored.transactions)) throw new Error('저장 데이터 형식이 올바르지 않습니다.');
    // Version 1 stored refunds as positive values; only that legacy format is migrated.
    const oldRows = stored.version === 1 ? stored.transactions.map(t => ({ ...t, amount_krw: t.type === 'refund' ? -Math.abs(Number(t.amount_krw)) : t.amount_krw })) : stored.transactions;
    const transactions = mergeTransactions([], validateTransactions(oldRows)).transactions;
    let lastImport = null;
    const report = stored.version === 2 ? stored.lastImport : null;
    if (report) {
      if (typeof report.fileName !== 'string' || !Number.isSafeInteger(report.inputCount) || !Number.isSafeInteger(report.addedCount) || report.addedCount < 0 || !Array.isArray(report.duplicates) || !Array.isArray(report.refunds) || report.inputCount !== report.addedCount + report.duplicates.length) throw new Error('저장된 가져오기 결과가 올바르지 않습니다.');
      const duplicates = report.duplicates.map(d => {
        if (!Number.isSafeInteger(d.recordNumber) || d.recordNumber < 2 || !['existing', 'file'].includes(d.source) || typeof d.conflict !== 'boolean') throw new Error('저장된 중복 내역이 올바르지 않습니다.');
        return { ...d, transaction: validateTransactions([d.transaction])[0] };
      });
      const refunds = report.refunds.length ? validateTransactions(report.refunds) : [];
      if (refunds.some(t => t.type !== 'refund')) throw new Error('저장된 환불 내역이 올바르지 않습니다.');
      lastImport = { fileName: report.fileName, inputCount: report.inputCount, addedCount: report.addedCount, duplicates, refunds };
    }
    return { transactions, fileName: stored.fileName, month: months(transactions).includes(stored.month) ? stored.month : 'all', lastImport };
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
      categories.set(t.category, (categories.get(t.category) || 0) + amount);
    }
    return { net: expense + refund, expense, refund, expenseCount, refundCount, categories: [...categories].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')) };
  }
  function toCSV(transactions) {
    const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    return '\uFEFF' + [COLUMNS, ...transactions.map(t => COLUMNS.map(key => t[key]))].map(row => row.map(escape).join(',')).join('\r\n') + '\r\n';
  }
  const api = { COLUMNS, parseCSV, validateTransactions, mergeTransactions, importCSV, restoreState, months, selectTransactions, summarize, toCSV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ledger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
