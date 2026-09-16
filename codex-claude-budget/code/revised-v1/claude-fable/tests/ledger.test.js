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
function readInput(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'inputs', name), 'utf8');
}
// 파일 텍스트를 빈 저장소 또는 기존 목록에 병합하는 도우미
function importInto(existing, text, fileName) {
  return L.mergeTransactions(existing, L.parseTransactions(text), { fileName: fileName || 'test.csv', importedAt: '2026-09-16T00:00:00Z' });
}
function netOf(txs, month) { return L.summarize(L.filterByMonth(txs, month || 'all')).net; }

var basicText = readInput('01-basic.csv');
var refundText = readInput('02-refunds-and-duplicates.csv');

console.log('ledger.js 테스트');

// ---------- 파싱 ----------
test('기본 파일: BOM·CRLF 포함 16건을 읽는다', function () {
  var r = L.parseTransactions(basicText);
  assert.strictEqual(r.transactions.length, 16);
  assert.strictEqual(r.skipped.length, 0);
  assert.strictEqual(r.hasTypeColumn, true);
  assert.strictEqual(r.hasIdColumn, true);
  assert.strictEqual(r.transactions[0].id, 'A01');
  assert.strictEqual(r.transactions[0].line, 2);
  assert.strictEqual(r.transactions[0].merchant, '예제마트');
  assert.strictEqual(r.transactions[0].amount, 42000);
  assert.strictEqual(r.transactions[0].type, 'expense');
  assert.strictEqual(r.transactions[0].month, '2026-08');
});

test('빈 파일 / 공백만 있는 파일은 EMPTY_FILE', function () {
  expectError(function () { L.parseTransactions(''); }, 'EMPTY_FILE');
  expectError(function () { L.parseTransactions('﻿'); }, 'EMPTY_FILE');
  expectError(function () { L.parseTransactions('  \r\n\n  '); }, 'EMPTY_FILE');
  expectError(function () { L.parseTransactions(null); }, 'EMPTY_FILE');
});

test('헤더만 있는 파일은 NO_ROWS', function () {
  var e = expectError(function () { L.parseTransactions('date,merchant,category,amount_krw\n'); }, 'NO_ROWS');
  assert.ok(/거래 행이 없습니다/.test(e.message));
});

test('필수 열이 없으면 MISSING_COLUMNS 와 빠진 열 이름', function () {
  var e = expectError(function () {
    L.parseTransactions('transaction_id,date,merchant,type\nA1,2026-01-01,가게,expense\n');
  }, 'MISSING_COLUMNS');
  assert.deepStrictEqual(e.details.missing, ['category', 'amount']);
  assert.ok(/category \(분류\)/.test(e.message));
  assert.ok(/amount_krw \(금액\)/.test(e.message));
  expectError(function () { L.parseTransactions('2026-01-01,가게,식비,1000\n'); }, 'MISSING_COLUMNS');
});

test('모든 행이 잘못되면 NO_VALID_ROWS, 일부만 잘못되면 건너뛰고 행 번호 보고', function () {
  var e = expectError(function () {
    L.parseTransactions('date,merchant,category,amount_krw\n잘못,가게,식비,abc\n');
  }, 'NO_VALID_ROWS');
  assert.ok(/2행/.test(e.message));

  var r = L.parseTransactions([
    'date,merchant,category,amount_krw',
    '2026-02-30,가게,식비,1000',
    '2026-02-01,가게,식비,1,000',
    '2026-02-02,,식비,500',
    '2026-02-03,가게,식비,"2,500"'
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
  var r = L.parseTransactions(text);
  assert.strictEqual(r.transactions.length, 3);
  assert.strictEqual(r.transactions[0].date, '2026-03-01');
  assert.strictEqual(r.transactions[0].merchant, '예제, 마트');
  assert.strictEqual(r.transactions[0].amount, 12000);
  assert.strictEqual(r.transactions[1].merchant, '이름에 "따옴표"');
  assert.strictEqual(r.transactions[1].type, 'expense', '유형이 비면 지출');
  assert.strictEqual(r.transactions[2].date, '2026-03-03');
  assert.strictEqual(r.transactions[2].type, 'refund');
});

// ---------- 병합·중복 ----------
test('기본 파일만 가져온 경우: 16건, 전체 343,850원, 8월 136,200원, 9월 207,650원', function () {
  var m = importInto([], basicText, '01-basic.csv');
  assert.strictEqual(m.transactions.length, 16);
  assert.strictEqual(m.report.addedCount, 16);
  assert.strictEqual(m.report.duplicates.length, 0);
  assert.strictEqual(m.report.refunds.length, 0);
  assert.strictEqual(netOf(m.transactions), 343850);
  assert.strictEqual(netOf(m.transactions, '2026-08'), 136200);
  assert.strictEqual(netOf(m.transactions, '2026-09'), 207650);
  // S05 와 S09 는 날짜·가맹점·금액이 같지만 ID 가 다르므로 둘 다 별개 거래
  assert.strictEqual(m.transactions.filter(function (t) { return t.id === 'S05' || t.id === 'S09'; }).length, 2);
});

test('기본 파일 위에 변경 파일을 가져온 경우: 18건, 환불 2건 반영, 중복 18행 제외', function () {
  var base = importInto([], basicText, '01-basic.csv').transactions;
  var m = importInto(base, refundText, '02-refunds-and-duplicates.csv');
  var r = m.report;
  assert.strictEqual(r.rowCount, 20);
  assert.strictEqual(m.transactions.length, 18);
  assert.strictEqual(r.addedCount, 2);
  assert.deepStrictEqual(r.addedIds, ['R01', 'R02']);
  assert.strictEqual(r.duplicates.length, 18);
  // 기본 16행은 기존 ID 와 겹치고, 20·21행(S05, A03 반복)은 파일 안 반복으로 분류
  assert.strictEqual(r.duplicates.filter(function (d) { return d.reason === 'existing'; }).length, 16);
  assert.deepStrictEqual(r.duplicates.filter(function (d) { return d.reason === 'file'; }).map(function (d) { return [d.line, d.id]; }),
    [[20, 'S05'], [21, 'A03']]);
  assert.strictEqual(r.duplicates.filter(function (d) { return d.id === 'S05'; }).length, 2);

  // 환불: 부호 그대로, 각 거래의 date 기준 월에 반영
  assert.strictEqual(r.refunds.length, 2);
  assert.strictEqual(r.refunds[0].id, 'R01');
  assert.strictEqual(r.refunds[0].amount, -89000);
  assert.strictEqual(r.refunds[0].originalId, 'S06');
  assert.strictEqual(r.refunds[0].originalFound, true);
  assert.strictEqual(r.refunds[0].originalAmount, 89000);
  assert.strictEqual(r.refunds[1].originalId, 'A05');

  assert.strictEqual(netOf(m.transactions), 242350);
  assert.strictEqual(netOf(m.transactions, '2026-08'), 123700);
  assert.strictEqual(netOf(m.transactions, '2026-09'), 118650);
  var s = L.summarize(m.transactions);
  assert.strictEqual(s.expense, 343850);
  assert.strictEqual(s.refund, -101500);
  assert.strictEqual(s.refundCount, 2);
  assert.strictEqual(s.net, s.expense + s.refund);
  // 원거래와 환불이 각각 한 번씩 보존
  var ids = m.transactions.map(function (t) { return t.id; });
  ['S06', 'R01', 'A05', 'R02'].forEach(function (id) {
    assert.strictEqual(ids.filter(function (x) { return x === id; }).length, 1, id);
  });
});

test('변경 파일만 처음 가져온 경우: 18건, 파일 안 반복 2행 제외', function () {
  var m = importInto([], refundText, '02-refunds-and-duplicates.csv');
  assert.strictEqual(m.transactions.length, 18);
  assert.strictEqual(m.report.addedCount, 18);
  assert.strictEqual(m.report.duplicates.length, 2);
  assert.deepStrictEqual(m.report.duplicates.map(function (d) { return [d.line, d.id, d.reason]; }),
    [[20, 'S05', 'file'], [21, 'A03', 'file']]);
  assert.strictEqual(m.report.refunds.length, 2);
  assert.strictEqual(netOf(m.transactions), 242350);
});

test('같은 파일을 다시 가져와도 거래 수와 합계가 늘지 않는다', function () {
  var m1 = importInto([], basicText, '01-basic.csv');
  var m2 = importInto(m1.transactions, basicText, '01-basic.csv');
  assert.strictEqual(m2.transactions.length, 16);
  assert.strictEqual(m2.report.addedCount, 0);
  assert.strictEqual(m2.report.duplicates.length, 16);
  assert.strictEqual(netOf(m2.transactions), 343850);

  var m3 = importInto(m2.transactions, refundText, '02-refunds-and-duplicates.csv');
  var m4 = importInto(m3.transactions, refundText, '02-refunds-and-duplicates.csv');
  assert.strictEqual(m4.transactions.length, 18);
  assert.strictEqual(m4.report.addedCount, 0);
  assert.strictEqual(m4.report.duplicates.length, 20);
  assert.strictEqual(m4.report.refunds.length, 0, '이미 반영한 환불은 다시 세지 않음');
  assert.strictEqual(netOf(m4.transactions), 242350);
  assert.strictEqual(netOf(m4.transactions, '2026-08'), 123700);
  assert.strictEqual(netOf(m4.transactions, '2026-09'), 118650);
  // 순서를 바꿔 02 -> 01 로 올려도 같은 결과
  var m5 = importInto(importInto([], refundText).transactions, basicText);
  assert.strictEqual(m5.transactions.length, 18);
  assert.strictEqual(m5.report.addedCount, 0);
  assert.strictEqual(netOf(m5.transactions), 242350);
});

test('같은 ID 인데 내용이 다르면 먼저 있던 거래를 유지하고 중복으로 보고', function () {
  var a = importInto([], 'transaction_id,date,merchant,category,amount_krw\nX,2026-01-01,가게,식비,1000\n');
  var b = importInto(a.transactions, 'transaction_id,date,merchant,category,amount_krw\nX,2026-01-05,다른가게,식비,9999\n');
  assert.strictEqual(b.transactions.length, 1);
  assert.strictEqual(b.transactions[0].amount, 1000);
  assert.strictEqual(b.report.duplicates[0].amount, 9999);
});

test('환불의 원거래를 찾지 못하면 originalFound=false, 원거래 정보가 없어도 반영', function () {
  var m = importInto([], 'transaction_id,date,merchant,category,amount_krw,type,original_transaction_id\n' +
    'R9,2026-01-01,가게,식비,-1000,refund,NOPE\nR8,2026-01-02,가게,식비,-500,refund,\n');
  assert.strictEqual(m.report.refunds.length, 2);
  assert.strictEqual(m.report.refunds[0].originalFound, false);
  assert.strictEqual(m.report.refunds[1].originalId, '');
  assert.strictEqual(netOf(m.transactions), -1500);
  assert.strictEqual(L.summarize(m.transactions).byCategory[0].net, -1500);
});

test('transaction_id 열이 없으면 내용 기반 ID: 재가져오기는 중복, 같은 내용 두 행은 별개', function () {
  var text = 'date,merchant,category,amount_krw\n2026-01-01,가게,식비,1000\n2026-01-01,가게,식비,1000\n2026-01-02,가게,식비,2000\n';
  var m1 = importInto([], text);
  assert.strictEqual(m1.report.hasIdColumn, false);
  assert.strictEqual(m1.transactions.length, 3);
  assert.ok(/^auto-/.test(m1.transactions[0].id));
  assert.notStrictEqual(m1.transactions[0].id, m1.transactions[1].id);
  var m2 = importInto(m1.transactions, text);
  assert.strictEqual(m2.transactions.length, 3);
  assert.strictEqual(m2.report.addedCount, 0);
  assert.strictEqual(m2.report.duplicates.length, 3);
});

test('수입·이체는 목록에는 있고 순지출에서 제외', function () {
  var m = importInto([], [
    'transaction_id,date,merchant,category,amount_krw,type',
    'T1,2026-05-01,상점,쇼핑,50000,expense',
    'T4,2026-05-04,회사,급여,3000000,income',
    'T5,2026-05-05,은행,이체,100000,transfer'
  ].join('\n'));
  var s = L.summarize(m.transactions);
  assert.strictEqual(s.net, 50000);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.excluded, 2);
  assert.strictEqual(L.netContribution(m.transactions[1]), 0);
});

// ---------- 집계 ----------
test('카테고리 합계: 환불 포함 순지출 내림차순, 원거래 참조 맵', function () {
  var txs = importInto(importInto([], basicText).transactions, refundText).transactions;
  var sep = L.summarize(L.filterByMonth(txs, '2026-09'));
  assert.deepStrictEqual(sep.byCategory.map(function (b) { return [b.category, b.net]; }), [
    ['식료품', 64300], ['식비', 28000], ['구독', 14900], ['카페', 9900], ['교통', 1550], ['쇼핑', 0]
  ]);
  var shopping = sep.byCategory[5];
  assert.strictEqual(shopping.expense, 89000);
  assert.strictEqual(shopping.refund, -89000);
  assert.strictEqual(shopping.refundCount, 1);
  var all = L.summarize(txs);
  assert.strictEqual(all.byCategory.reduce(function (s, b) { return s + b.net; }, 0), all.net);
  assert.deepStrictEqual(all.byMonth.map(function (b) { return [b.month, b.net, b.refundCount]; }),
    [['2026-08', 123700, 1], ['2026-09', 118650, 1]]);
  var map = L.refundsByOriginal(txs);
  assert.deepStrictEqual(Object.keys(map).sort(), ['A05', 'S06']);
  assert.strictEqual(map.S06[0].id, 'R01');
});

test('월 필터', function () {
  var txs = importInto([], basicText).transactions;
  assert.deepStrictEqual(L.listMonths(txs), ['2026-08', '2026-09']);
  assert.strictEqual(L.filterByMonth(txs, 'all').length, 16);
  assert.strictEqual(L.filterByMonth(txs, '').length, 16);
  assert.strictEqual(L.filterByMonth(txs, '2026-08').length, 7);
  assert.strictEqual(L.filterByMonth(txs, '2027-01').length, 0);
});

// ---------- 내보내기·형식 ----------
test('CSV 내보내기: BOM, 헤더, 환불 음수·원거래 ID 유지, 재가져오기 시 합계 일치', function () {
  var txs = importInto(importInto([], basicText).transactions, refundText).transactions;
  var sep = L.sortByDateDesc(L.filterByMonth(txs, '2026-09'));
  var csv = L.toCsv(sep);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF);
  var lines = csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
  assert.strictEqual(lines[0], 'transaction_id,date,merchant,category,amount_krw,type,original_transaction_id');
  assert.strictEqual(lines.length, 1 + 10);
  assert.strictEqual(lines[1], 'R01,2026-09-12,예제상점,쇼핑,-89000,refund,S06');
  var again = importInto([], csv);
  assert.strictEqual(again.transactions.length, 10);
  assert.strictEqual(again.report.duplicates.length, 0);
  assert.strictEqual(netOf(again.transactions), 118650);

  var tricky = L.toCsv([{ id: 'q', date: '2026-01-01', merchant: '쉼표, 그리고 "따옴표"', category: '분류', amount: 100, type: 'expense', rawType: 'expense', originalId: '' }]);
  assert.ok(tricky.indexOf('"쉼표, 그리고 ""따옴표"""') !== -1);
  assert.strictEqual(L.parseTransactions(tricky).transactions[0].merchant, '쉼표, 그리고 "따옴표"');
});

test('표시 형식: 쉼표·원·월·날짜', function () {
  assert.strictEqual(L.formatKrw(343850), '343,850원');
  assert.strictEqual(L.formatKrw(0), '0원');
  assert.strictEqual(L.formatKrw(-101500), '-101,500원');
  assert.strictEqual(L.formatKrw(1234567890), '1,234,567,890원');
  assert.strictEqual(L.formatMonth('2026-09'), '2026년 9월');
  assert.strictEqual(L.formatMonth('all'), '전체 기간');
  assert.strictEqual(L.formatDate('2026-09-05'), '9월 5일 (토)');
});

test('날짜 정렬: 최신순, 같은 날짜는 id 역순', function () {
  var txs = importInto(importInto([], basicText).transactions, refundText).transactions;
  var sorted = L.sortByDateDesc(txs);
  assert.strictEqual(sorted[0].id, 'R01');
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
  assert.strictEqual(L.parseAmount('-89000'), -89000);
  assert.strictEqual(L.parseAmount('12.7'), 13);
  assert.strictEqual(L.parseAmount(''), null);
  assert.strictEqual(L.parseAmount('만원'), null);
});

console.log('\n' + passed + ' 통과, ' + failed + ' 실패');
process.exit(failed ? 1 : 0);
