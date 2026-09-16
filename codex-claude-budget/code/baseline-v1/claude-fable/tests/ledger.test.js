/* 실행: node tests/ledger.test.js  (외부 패키지 없음) */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var L = require('../js/ledger.js');

var passed = 0;
var failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  ok  ' + name);
  } catch (e) {
    failed += 1;
    console.log('  FAIL ' + name);
    console.log('       ' + (e && e.message ? e.message : e));
  }
}
function expectError(fn, code) {
  var thrown = null;
  try { fn(); } catch (e) { thrown = e; }
  assert.ok(thrown, '오류가 발생해야 함');
  assert.strictEqual(thrown.name, 'LedgerError');
  assert.strictEqual(thrown.code, code, '기대 코드 ' + code + ', 실제 ' + thrown.code + ' (' + thrown.message + ')');
  return thrown;
}

var samplePath = path.join(__dirname, '..', 'inputs', '01-basic.csv');
var sampleText = fs.readFileSync(samplePath, 'utf8');

console.log('ledger.js 테스트');

test('샘플 파일: BOM·CRLF 포함 16건을 읽는다', function () {
  var r = L.importCsv(sampleText);
  assert.strictEqual(r.transactions.length, 16);
  assert.strictEqual(r.skipped.length, 0);
  assert.strictEqual(r.hasTypeColumn, true);
  assert.strictEqual(r.transactions[0].id, 'A01');
  assert.strictEqual(r.transactions[0].merchant, '예제마트');
  assert.strictEqual(r.transactions[0].amount, 42000);
  assert.strictEqual(r.transactions[0].type, 'expense');
  assert.strictEqual(r.transactions[0].month, '2026-08');
});

test('샘플 파일: 전체·월별 순지출 합계', function () {
  var txs = L.importCsv(sampleText).transactions;
  var all = L.summarize(txs);
  assert.strictEqual(all.net, 343850);
  assert.strictEqual(all.expense, 343850);
  assert.strictEqual(all.refund, 0);
  assert.strictEqual(all.count, 16);
  assert.deepStrictEqual(L.listMonths(txs), ['2026-08', '2026-09']);
  assert.strictEqual(L.summarize(L.filterByMonth(txs, '2026-08')).net, 136200);
  assert.strictEqual(L.summarize(L.filterByMonth(txs, '2026-09')).net, 207650);
  assert.strictEqual(L.filterByMonth(txs, 'all').length, 16);
  assert.strictEqual(L.filterByMonth(txs, '').length, 16);
  assert.strictEqual(L.filterByMonth(txs, '2027-01').length, 0);
  var byMonth = all.byMonth.map(function (b) { return [b.month, b.net]; });
  assert.deepStrictEqual(byMonth, [['2026-08', 136200], ['2026-09', 207650]]);
});

test('샘플 파일: 카테고리 합계는 순지출 내림차순', function () {
  var txs = L.importCsv(sampleText).transactions;
  var sep = L.summarize(L.filterByMonth(txs, '2026-09'));
  assert.deepStrictEqual(sep.byCategory.map(function (b) { return [b.category, b.net]; }), [
    ['쇼핑', 89000], ['식료품', 64300], ['식비', 28000], ['구독', 14900], ['카페', 9900], ['교통', 1550]
  ]);
  var all = L.summarize(txs);
  var sum = all.byCategory.reduce(function (s, b) { return s + b.net; }, 0);
  assert.strictEqual(sum, all.net);
});

test('샘플 파일: 같은 날·가맹점·금액 거래는 중복 의심 표시하되 합계에 포함', function () {
  var txs = L.importCsv(sampleText).transactions;
  var byId = {};
  txs.forEach(function (t) { byId[t.id] = t; });
  assert.strictEqual(byId.S05.duplicate, true);
  assert.strictEqual(byId.S09.duplicate, true);
  assert.strictEqual(byId.A05.duplicate, false);
  assert.strictEqual(byId.S02.duplicate, false);
});

test('빈 파일 / 공백만 있는 파일은 EMPTY_FILE', function () {
  expectError(function () { L.importCsv(''); }, 'EMPTY_FILE');
  expectError(function () { L.importCsv('﻿'); }, 'EMPTY_FILE');
  expectError(function () { L.importCsv('  \r\n\n  '); }, 'EMPTY_FILE');
  expectError(function () { L.importCsv(null); }, 'EMPTY_FILE');
});

test('헤더만 있는 파일은 NO_ROWS', function () {
  var e = expectError(function () { L.importCsv('date,merchant,category,amount_krw\n'); }, 'NO_ROWS');
  assert.ok(/거래 행이 없습니다/.test(e.message));
});

test('필수 열이 없으면 MISSING_COLUMNS 와 빠진 열 이름', function () {
  var e = expectError(function () {
    L.importCsv('transaction_id,date,merchant,type\nA1,2026-01-01,가게,expense\n');
  }, 'MISSING_COLUMNS');
  assert.deepStrictEqual(e.details.missing, ['category', 'amount']);
  assert.ok(/category \(분류\)/.test(e.message));
  assert.ok(/amount_krw \(금액\)/.test(e.message));
  // 헤더가 아닌 데이터만 있는 파일도 열 없음으로 처리
  expectError(function () { L.importCsv('2026-01-01,가게,식비,1000\n'); }, 'MISSING_COLUMNS');
});

test('모든 행이 잘못되면 NO_VALID_ROWS, 일부만 잘못되면 건너뛰고 행 번호 보고', function () {
  var e = expectError(function () {
    L.importCsv('date,merchant,category,amount_krw\n잘못,가게,식비,abc\n');
  }, 'NO_VALID_ROWS');
  assert.ok(/2행/.test(e.message));

  var r = L.importCsv([
    'date,merchant,category,amount_krw',
    '2026-02-30,가게,식비,1000',      // 없는 날짜
    '2026-02-01,가게,식비,1,000',     // 따옴표 없는 쉼표 금액 -> 열 밀림 -> 금액 "1"이 됨, 통과
    '2026-02-02,,식비,500',           // 가맹점 없음
    '2026-02-03,가게,식비,"2,500"'    // 따옴표 금액
  ].join('\n'));
  assert.strictEqual(r.transactions.length, 2);
  assert.strictEqual(r.skipped.length, 2);
  assert.strictEqual(r.skipped[0].line, 2);
  assert.ok(/날짜 형식 오류/.test(r.skipped[0].reasons[0]));
  assert.strictEqual(r.skipped[1].line, 4);
  assert.ok(/가맹점 없음/.test(r.skipped[1].reasons[0]));
  assert.strictEqual(r.transactions[1].amount, 2500);
});

test('따옴표·이스케이프·LF 줄바꿈·한글 헤더 처리', function () {
  var text = '날짜,가맹점,분류,금액,유형\n' +
    '2026/03/01,"예제, 마트","식료품",\"12,000원\",지출\n' +
    '2026.03.02,"이름에 ""따옴표""",카페,4800,\n' +
    '20260303,예제식당,식비,-3000,환불\n';
  var r = L.importCsv(text);
  assert.strictEqual(r.transactions.length, 3);
  assert.strictEqual(r.transactions[0].date, '2026-03-01');
  assert.strictEqual(r.transactions[0].merchant, '예제, 마트');
  assert.strictEqual(r.transactions[0].amount, 12000);
  assert.strictEqual(r.transactions[1].merchant, '이름에 "따옴표"');
  assert.strictEqual(r.transactions[1].type, 'expense', '유형이 비면 지출');
  assert.strictEqual(r.transactions[2].date, '2026-03-03');
  assert.strictEqual(r.transactions[2].type, 'refund');
});

test('type 열이 없으면 hasTypeColumn=false, 모두 지출', function () {
  var r = L.importCsv('date,merchant,category,amount_krw\n2026-01-01,가게,식비,1000\n');
  assert.strictEqual(r.hasTypeColumn, false);
  assert.strictEqual(r.transactions[0].type, 'expense');
});

test('환불은 순지출에서 빼고, 수입·이체는 제외', function () {
  var r = L.importCsv([
    'transaction_id,date,merchant,category,amount_krw,type,original_transaction_id',
    'T1,2026-05-01,상점,쇼핑,50000,expense,',
    'T2,2026-05-02,상점,쇼핑,20000,refund,T1',
    'T3,2026-05-03,상점,쇼핑,-5000,refund,T1',
    'T4,2026-05-04,회사,급여,3000000,income,',
    'T5,2026-05-05,은행,이체,100000,transfer,',
    'T6,2026-05-06,식당,식비,8000,'
  ].join('\n'));
  var s = L.summarize(r.transactions);
  assert.strictEqual(s.expense, 58000);
  assert.strictEqual(s.refund, 25000);
  assert.strictEqual(s.net, 33000);
  assert.strictEqual(s.count, 6);
  assert.strictEqual(s.excluded, 2);
  var shopping = s.byCategory.filter(function (b) { return b.category === '쇼핑'; })[0];
  assert.strictEqual(shopping.net, 25000);
  assert.strictEqual(shopping.refund, 25000);
  assert.strictEqual(L.netContribution(r.transactions[3]), 0);
  assert.strictEqual(r.transactions[1].originalId, 'T1');
});

test('id 가 없거나 겹치면 행 번호로 고유하게 만든다', function () {
  var r = L.importCsv('transaction_id,date,merchant,category,amount_krw\nX,2026-01-01,a,b,1\nX,2026-01-02,a,b,2\n,2026-01-03,a,b,3\n');
  var ids = r.transactions.map(function (t) { return t.id; });
  assert.deepStrictEqual(ids, ['X', 'X#3', 'row4']);
});

test('CSV 내보내기: BOM, 헤더, 이스케이프, 재파싱 일치', function () {
  var txs = L.importCsv(sampleText).transactions;
  var sep = L.sortByDateDesc(L.filterByMonth(txs, '2026-09'));
  var csv = L.toCsv(sep);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  var lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  assert.strictEqual(lines[0], 'transaction_id,date,merchant,category,amount_krw,type,original_transaction_id');
  assert.strictEqual(lines.length, 1 + 9);
  assert.strictEqual(lines[1].slice(0, 15), 'S08,2026-09-08,');
  var again = L.importCsv(csv);
  assert.strictEqual(again.transactions.length, 9);
  assert.strictEqual(L.summarize(again.transactions).net, 207650);

  var tricky = L.toCsv([{ id: 'q', date: '2026-01-01', merchant: '쉼표, 그리고 "따옴표"', category: '분류', amount: 100, type: 'expense', rawType: 'expense', originalId: '' }]);
  assert.ok(tricky.indexOf('"쉼표, 그리고 ""따옴표"""') !== -1);
  assert.strictEqual(L.importCsv(tricky).transactions[0].merchant, '쉼표, 그리고 "따옴표"');
});

test('표시 형식: 쉼표·원·월·날짜', function () {
  assert.strictEqual(L.formatKrw(343850), '343,850원');
  assert.strictEqual(L.formatKrw(0), '0원');
  assert.strictEqual(L.formatKrw(-1500), '-1,500원');
  assert.strictEqual(L.formatKrw(1234567890), '1,234,567,890원');
  assert.strictEqual(L.formatMonth('2026-09'), '2026년 9월');
  assert.strictEqual(L.formatMonth('all'), '전체 기간');
  assert.strictEqual(L.formatDate('2026-09-05'), '9월 5일 (토)');
});

test('날짜 정렬: 최신순, 같은 날짜는 id 역순', function () {
  var txs = L.importCsv(sampleText).transactions;
  var sorted = L.sortByDateDesc(txs);
  assert.strictEqual(sorted[0].id, 'S08');
  assert.strictEqual(sorted[sorted.length - 1].id, 'A01');
  var sameDay = sorted.filter(function (t) { return t.date === '2026-09-05'; }).map(function (t) { return t.id; });
  assert.deepStrictEqual(sameDay, ['S09', 'S05']);
});

test('parseDate / parseAmount 경계값', function () {
  assert.strictEqual(L.parseDate('2026-02-29'), null);
  assert.strictEqual(L.parseDate('2024-02-29'), '2024-02-29');
  assert.strictEqual(L.parseDate('2026-9-5'), '2026-09-05');
  assert.strictEqual(L.parseDate('2026-09-05 13:45:00'), '2026-09-05');
  assert.strictEqual(L.parseDate('2026년 9월 5일'), '2026-09-05');
  assert.strictEqual(L.parseDate('09/05/2026'), null);
  assert.strictEqual(L.parseAmount('₩ 12,000'), 12000);
  assert.strictEqual(L.parseAmount('(3,000)'), -3000);
  assert.strictEqual(L.parseAmount('12.7'), 13);
  assert.strictEqual(L.parseAmount(''), null);
  assert.strictEqual(L.parseAmount('만원'), null);
});

console.log('\n' + passed + ' 통과, ' + failed + ' 실패');
process.exit(failed ? 1 : 0);
