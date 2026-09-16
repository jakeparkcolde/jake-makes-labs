/*
 * ledger.js - 가계부 순수 로직 (DOM 의존 없음)
 * 브라우저에서는 window.Ledger 로, Node에서는 module.exports 로 노출된다.
 *
 * 흐름: parseTransactions(text) -> mergeTransactions(existing, parsed, meta) -> summarize(filterByMonth(...))
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Ledger = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 열 이름 별칭 ----------
  var COLUMN_ALIASES = {
    id: ['transaction_id', 'id', 'txid', '거래id', '거래번호'],
    date: ['date', 'transaction_date', '거래일', '거래일자', '날짜', '일자'],
    merchant: ['merchant', 'store', 'description', '가맹점', '가맹점명', '상호', '거래처', '내용'],
    category: ['category', '분류', '카테고리'],
    amount: ['amount_krw', 'amount', 'amount_won', '금액', '거래금액', '금액(원)'],
    type: ['type', 'transaction_type', '유형', '구분', '거래유형'],
    originalId: ['original_transaction_id', 'original_id', '원거래id', '원거래번호']
  };
  var REQUIRED_FIELDS = ['date', 'merchant', 'category', 'amount'];
  var FIELD_LABELS = {
    date: 'date (거래일)',
    merchant: 'merchant (가맹점)',
    category: 'category (분류)',
    amount: 'amount_krw (금액)'
  };
  var EXPORT_COLUMNS = ['transaction_id', 'date', 'merchant', 'category', 'amount_krw', 'type', 'original_transaction_id'];

  // ---------- 오류 ----------
  function LedgerError(code, message, details) {
    this.name = 'LedgerError';
    this.code = code;
    this.message = message;
    this.details = details || null;
  }
  LedgerError.prototype = Object.create(Error.prototype);
  LedgerError.prototype.constructor = LedgerError;

  // ---------- CSV 파서 (RFC 4180: 따옴표, 이스케이프 따옴표, CR/LF/CRLF) ----------
  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;
    var len = text.length;

    while (i < len) {
      var ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (ch === ',') {
        row.push(field);
        field = '';
        i += 1;
        continue;
      }
      if (ch === '\r' || ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        if (ch === '\r' && text[i + 1] === '\n') i += 1;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    // 완전히 빈 행 제거
    return rows.filter(function (r) {
      return r.some(function (c) { return c.trim() !== ''; });
    });
  }

  // ---------- 정규화 도우미 ----------
  function normalizeHeader(h) {
    return String(h || '')
      .replace(/^﻿/, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  }

  function mapColumns(headerRow) {
    var normalized = headerRow.map(normalizeHeader);
    var map = {};
    Object.keys(COLUMN_ALIASES).forEach(function (field) {
      var aliases = COLUMN_ALIASES[field];
      for (var a = 0; a < aliases.length; a++) {
        var idx = normalized.indexOf(aliases[a]);
        if (idx !== -1) { map[field] = idx; break; }
      }
    });
    return map;
  }

  function parseAmount(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return null;
    var negativeByParen = /^\(.*\)$/.test(s);
    s = s.replace(/[()]/g, '').replace(/[,\s]/g, '').replace(/원|₩|krw/gi, '');
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return null;
    var n = Number(s);
    if (!isFinite(n)) return null;
    if (negativeByParen) n = -Math.abs(n);
    return Math.round(n);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function parseDate(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (s === '') return null;
    var m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s].*)?$/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) m = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/);
    if (!m) return null;
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var check = new Date(Date.UTC(y, mo - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
    return y + '-' + pad2(mo) + '-' + pad2(d);
  }

  var TYPE_MAP = {
    expense: 'expense', spend: 'expense', spending: 'expense', debit: 'expense', purchase: 'expense',
    '지출': 'expense', '출금': 'expense', '결제': 'expense',
    refund: 'refund', cancel: 'refund', canceled: 'refund', cancelled: 'refund', reversal: 'refund', credit: 'refund',
    '환불': 'refund', '취소': 'refund', '결제취소': 'refund',
    income: 'income', salary: 'income', deposit: 'income',
    '수입': 'income', '입금': 'income', '급여': 'income',
    transfer: 'transfer', '이체': 'transfer'
  };

  function normalizeType(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, '');
    if (s === '') return 'expense';
    return TYPE_MAP[s] || 'other';
  }

  var TYPE_LABELS = { expense: '지출', refund: '환불', income: '수입', transfer: '이체', other: '기타' };

  // transaction_id 열이 없을 때 내용 기반으로 만드는 ID (같은 파일을 다시 올려도 같은 ID가 나오도록)
  function contentHash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // ---------- CSV -> 거래 목록 (중복 제거 전) ----------
  function parseTransactions(text) {
    if (typeof text !== 'string' || text.replace(/^﻿/, '').trim() === '') {
      throw new LedgerError('EMPTY_FILE', '파일이 비어 있습니다. 거래 내역이 담긴 CSV 파일을 올려 주세요.');
    }
    var rows = parseCsv(text.replace(/^﻿/, ''));
    if (rows.length === 0) {
      throw new LedgerError('EMPTY_FILE', '파일이 비어 있습니다. 거래 내역이 담긴 CSV 파일을 올려 주세요.');
    }
    var header = rows[0];
    var columns = mapColumns(header);
    var missing = REQUIRED_FIELDS.filter(function (f) { return columns[f] === undefined; });
    if (missing.length > 0) {
      var found = header.map(function (h) { return normalizeHeader(h); }).filter(Boolean);
      throw new LedgerError(
        'MISSING_COLUMNS',
        '필수 열이 없습니다: ' + missing.map(function (f) { return FIELD_LABELS[f]; }).join(', ') +
          '. 첫 줄에 열 이름이 있어야 합니다. (찾은 열: ' + (found.length ? found.join(', ') : '없음') + ')',
        { missing: missing, found: found }
      );
    }
    if (rows.length === 1) {
      throw new LedgerError('NO_ROWS', '열 이름만 있고 거래 행이 없습니다. 거래가 한 건 이상 있는 파일을 올려 주세요.');
    }

    var hasIdColumn = columns.id !== undefined;
    var transactions = [];
    var skipped = [];
    var autoSeen = {};
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var lineNo = r + 1; // 헤더가 1행
      var get = function (field) {
        var idx = columns[field];
        if (idx === undefined) return '';
        return String(row[idx] == null ? '' : row[idx]).trim();
      };
      var date = parseDate(get('date'));
      var amount = parseAmount(get('amount'));
      var merchant = get('merchant');
      var category = get('category') || '미분류';
      var problems = [];
      if (!date) problems.push('날짜 형식 오류(' + (get('date') || '빈 값') + ')');
      if (amount === null) problems.push('금액 형식 오류(' + (get('amount') || '빈 값') + ')');
      if (!merchant) problems.push('가맹점 없음');
      if (problems.length) {
        skipped.push({ line: lineNo, reasons: problems });
        continue;
      }
      var type = normalizeType(get('type'));
      var id = hasIdColumn ? get('id') : '';
      if (!id) {
        // ID 가 없으면 내용으로 만든다. 내용이 같은 행이 여러 개면 순번을 붙여 별개 거래로 본다.
        var key = [date, merchant, category, amount, type].join('|');
        autoSeen[key] = (autoSeen[key] || 0) + 1;
        id = 'auto-' + contentHash(key) + (autoSeen[key] > 1 ? '-' + autoSeen[key] : '');
      }
      transactions.push({
        id: id,
        line: lineNo,
        date: date,
        month: date.slice(0, 7),
        merchant: merchant,
        category: category,
        amount: amount,
        type: type,
        rawType: get('type'),
        originalId: get('originalId')
      });
    }
    if (transactions.length === 0) {
      throw new LedgerError(
        'NO_VALID_ROWS',
        '읽을 수 있는 거래가 없습니다. 날짜(YYYY-MM-DD)와 금액(숫자) 형식을 확인해 주세요. 예: ' +
          skipped.slice(0, 3).map(function (s) { return s.line + '행 ' + s.reasons.join(', '); }).join(' / '),
        { skipped: skipped }
      );
    }
    return {
      transactions: transactions,
      skipped: skipped,
      columns: columns,
      hasTypeColumn: columns.type !== undefined,
      hasIdColumn: hasIdColumn
    };
  }

  // ---------- 병합: transaction_id 기준 중복 제거 ----------
  // existing: 이미 저장된 거래 목록, parsed: parseTransactions 결과
  // 같은 ID는 한 번만 반영한다(먼저 있던 것이 남는다). 날짜·가맹점·금액이 같아도 ID가 다르면 별개 거래.
  function mergeTransactions(existing, parsed, meta) {
    var info = meta || {};
    var byId = {};
    existing.forEach(function (t) { byId[t.id] = t; });
    var merged = existing.slice();
    var added = [];
    var duplicates = [];
    var seenInFile = {};

    parsed.transactions.forEach(function (t) {
      var entry = {
        line: t.line, id: t.id, date: t.date, merchant: t.merchant,
        category: t.category, amount: t.amount, type: t.type
      };
      if (byId[t.id]) {
        entry.reason = seenInFile[t.id] ? 'file' : 'existing';
        duplicates.push(entry);
        seenInFile[t.id] = true;
        return;
      }
      var clean = {
        id: t.id, date: t.date, month: t.month, merchant: t.merchant, category: t.category,
        amount: t.amount, type: t.type, rawType: t.rawType, originalId: t.originalId,
        source: info.fileName || ''
      };
      byId[t.id] = clean;
      seenInFile[t.id] = true;
      merged.push(clean);
      added.push(clean);
    });

    var refunds = added.filter(function (t) { return t.type === 'refund'; }).map(function (t) {
      var original = t.originalId ? byId[t.originalId] : null;
      return {
        id: t.id, date: t.date, merchant: t.merchant, category: t.category, amount: t.amount,
        originalId: t.originalId,
        originalFound: !!original,
        originalDate: original ? original.date : '',
        originalAmount: original ? original.amount : null
      };
    });

    var report = {
      fileName: info.fileName || '',
      importedAt: info.importedAt || '',
      rowCount: parsed.transactions.length + parsed.skipped.length,
      addedCount: added.length,
      addedIds: added.map(function (t) { return t.id; }),
      duplicates: duplicates,
      refunds: refunds,
      skipped: parsed.skipped,
      hasTypeColumn: parsed.hasTypeColumn,
      hasIdColumn: parsed.hasIdColumn
    };
    return { transactions: merged, report: report };
  }

  // ---------- 집계 ----------
  // 순지출 기여액: 지출과 환불은 파일의 부호 그대로 합산(환불은 이미 음수), 수입·이체·기타는 0 (순지출에서 제외)
  function netContribution(t) {
    if (t.type === 'expense' || t.type === 'refund') return t.amount;
    return 0;
  }

  function filterByMonth(transactions, month) {
    if (!month || month === 'all') return transactions.slice();
    return transactions.filter(function (t) { return t.month === month; });
  }

  function listMonths(transactions) {
    var set = {};
    transactions.forEach(function (t) { set[t.month] = true; });
    return Object.keys(set).sort();
  }

  function emptyBucket(key, keyName) {
    var b = { net: 0, expense: 0, refund: 0, count: 0, refundCount: 0, excluded: 0 };
    b[keyName] = key;
    return b;
  }

  function accumulate(bucket, t) {
    bucket.count += 1;
    if (t.type === 'expense') bucket.expense += t.amount;
    else if (t.type === 'refund') { bucket.refund += t.amount; bucket.refundCount += 1; }
    else bucket.excluded += 1;
    bucket.net += netContribution(t);
  }

  function summarize(transactions) {
    var total = emptyBucket('all', 'key');
    var byCategory = {};
    var byMonth = {};
    transactions.forEach(function (t) {
      accumulate(total, t);
      if (!byCategory[t.category]) byCategory[t.category] = emptyBucket(t.category, 'category');
      accumulate(byCategory[t.category], t);
      if (!byMonth[t.month]) byMonth[t.month] = emptyBucket(t.month, 'month');
      accumulate(byMonth[t.month], t);
    });
    var categories = Object.keys(byCategory).map(function (k) { return byCategory[k]; })
      .sort(function (a, b) { return b.net - a.net || a.category.localeCompare(b.category, 'ko'); });
    var months = Object.keys(byMonth).sort().map(function (k) { return byMonth[k]; });
    return {
      net: total.net,
      expense: total.expense,
      refund: total.refund,
      refundCount: total.refundCount,
      count: total.count,
      excluded: total.excluded,
      byCategory: categories,
      byMonth: months
    };
  }

  // 원거래 ID -> 그 거래를 참조하는 환불 목록
  function refundsByOriginal(transactions) {
    var map = {};
    transactions.forEach(function (t) {
      if (t.type === 'refund' && t.originalId) {
        if (!map[t.originalId]) map[t.originalId] = [];
        map[t.originalId].push(t);
      }
    });
    return map;
  }

  function sortByDateDesc(transactions) {
    return transactions.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
  }

  // ---------- 내보내기 ----------
  function csvEscape(v) {
    var s = String(v == null ? '' : v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(transactions, options) {
    var opts = options || {};
    var lines = [EXPORT_COLUMNS.join(',')];
    transactions.forEach(function (t) {
      lines.push([
        t.id, t.date, t.merchant, t.category, t.amount,
        t.rawType || t.type, t.originalId || ''
      ].map(csvEscape).join(','));
    });
    var body = lines.join('\r\n') + '\r\n';
    return (opts.bom === false ? '' : '﻿') + body;
  }

  // ---------- 표시 형식 ----------
  function formatNumber(n) {
    var abs = Math.abs(Math.round(n));
    var s = String(abs).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + s;
  }

  function formatKrw(n) {
    return formatNumber(n) + '원';
  }

  function formatMonth(month) {
    if (!month || month === 'all') return '전체 기간';
    var parts = month.split('-');
    return parts[0] + '년 ' + Number(parts[1]) + '월';
  }

  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function formatDate(date) {
    var parts = date.split('-');
    var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    return Number(parts[1]) + '월 ' + Number(parts[2]) + '일 (' + WEEKDAYS[d.getUTCDay()] + ')';
  }

  return {
    LedgerError: LedgerError,
    REQUIRED_FIELDS: REQUIRED_FIELDS,
    FIELD_LABELS: FIELD_LABELS,
    TYPE_LABELS: TYPE_LABELS,
    parseCsv: parseCsv,
    parseAmount: parseAmount,
    parseDate: parseDate,
    normalizeType: normalizeType,
    parseTransactions: parseTransactions,
    mergeTransactions: mergeTransactions,
    netContribution: netContribution,
    filterByMonth: filterByMonth,
    listMonths: listMonths,
    summarize: summarize,
    refundsByOriginal: refundsByOriginal,
    sortByDateDesc: sortByDateDesc,
    toCsv: toCsv,
    formatNumber: formatNumber,
    formatKrw: formatKrw,
    formatMonth: formatMonth,
    formatDate: formatDate
  };
});
