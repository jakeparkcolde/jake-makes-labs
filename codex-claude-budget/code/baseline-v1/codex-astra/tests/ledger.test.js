'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ledger = require('../ledger.js');
const sample = fs.readFileSync(path.join(__dirname, '../inputs/01-basic.csv'), 'utf8');
const header = Ledger.COLUMNS.join(',');
const csv = (...rows) => [header, ...rows].join('\r\n');

test('샘플 전체·월별 합계와 유사한 별도 거래를 정확하게 집계한다', () => {
  const rows = Ledger.parseCSV(sample);
  assert.equal(rows.length, 16);
  assert.deepEqual(Ledger.months(rows), ['2026-09', '2026-08']);
  assert.equal(Ledger.summarize(rows).net, 343850);
  const august = Ledger.selectTransactions(rows, '2026-08');
  const september = Ledger.selectTransactions(rows, '2026-09');
  assert.equal(august.length, 7);
  assert.equal(Ledger.summarize(august).net, 136200);
  assert.equal(september.length, 9);
  const summary = Ledger.summarize(september);
  assert.equal(summary.net, 207650);
  assert.deepEqual(Object.fromEntries(summary.categories), { 쇼핑: 89000, 식료품: 64300, 식비: 28000, 구독: 14900, 카페: 9900, 교통: 1550 });
  assert.equal(summary.categories.reduce((sum, [, value]) => sum + value, 0), summary.net);
  assert.equal(september[0].date, '2026-09-08');
  assert.equal(rows[0].transaction_id, 'A01', '필터·정렬은 원본 순서를 변경하지 않는다');
});

test('환급은 환급 거래의 날짜와 카테고리에서 차감한다', () => {
  const rows = Ledger.parseCSV(csv('E1,2026-08-31,상점,쇼핑,10000,expense,', 'R1,2026-09-01,상점,쇼핑,10000,refund,E1', 'E2,2026-09-02,카페,식비,3000,expense,'));
  assert.equal(Ledger.summarize(rows).net, 3000);
  const summary = Ledger.summarize(Ledger.selectTransactions(rows, '2026-09'));
  assert.equal(summary.net, -7000);
  assert.equal(summary.refund, 10000);
  assert.equal(summary.expenseCount, 1);
  assert.equal(summary.refundCount, 1);
  assert.deepEqual(Object.fromEntries(summary.categories), { 식비: 3000, 쇼핑: -10000 });
});

test('BOM·쉼표·따옴표·줄바꿈이 있는 필드를 읽고 다시 출력한다', () => {
  const rows = Ledger.parseCSV('\uFEFF' + csv('Q1,2026-09-01,"상점, ""특별""\n지점",쇼핑,1000,expense,'));
  assert.equal(rows[0].merchant, '상점, "특별"\n지점');
  const output = Ledger.toCSV(rows);
  assert.equal(output.charCodeAt(0), 0xfeff);
  assert.deepEqual(Ledger.parseCSV(output), rows);
});

test('현재 필터만 CSV로 내보내며 UTF-8 한글과 거래 유형을 보존한다', () => {
  const rows = Ledger.parseCSV(sample);
  const selected = Ledger.selectTransactions(rows, '2026-08');
  const bytes = Buffer.from(Ledger.toCSV(selected), 'utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const restored = Ledger.parseCSV(bytes.toString('utf8'));
  assert.deepEqual(restored, selected);
  assert.ok(restored.every(t => t.date.startsWith('2026-08')));
  assert.equal(Ledger.summarize(restored).net, 136200);
});

test('저장용 JSON을 복원해도 거래 데이터와 월 선택이 유지된다', () => {
  const transactions = Ledger.parseCSV(sample);
  const saved = JSON.stringify({ version: 1, transactions, month: '2026-09', fileName: '01-basic.csv' });
  const restored = JSON.parse(saved);
  assert.deepEqual(Ledger.validateTransactions(restored.transactions), transactions);
  assert.ok(Ledger.months(restored.transactions).includes(restored.month));
  assert.equal(Ledger.summarize(Ledger.selectTransactions(restored.transactions, restored.month)).net, 207650);
});

test('빈 파일·빈 행·제목만 있는 파일을 구분해 거부한다', () => {
  for (const input of ['', '\uFEFF\n  ', ',,,,,,\r\n']) assert.throws(() => Ledger.parseCSV(input), /빈 파일/);
  assert.throws(() => Ledger.parseCSV(header), /거래 내역이 없습니다/);
});

test('필수 열 누락·중복 열·불일치 열 개수를 설명한다', () => {
  assert.throws(() => Ledger.parseCSV('date,merchant\n2026-09-01,카페'), /필수 열이 없습니다: transaction_id/);
  assert.throws(() => Ledger.parseCSV(header + ',date'), /중복된 열/);
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,카페,식비,1000,expense')), /열 개수/);
});

test('잘못된 따옴표로 CSV가 조용히 손상되지 않는다', () => {
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,"닫히지 않는 값')), /닫는 따옴표/);
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,"상점"x,식비,1000,expense,')), /따옴표 뒤/);
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,상"점,식비,1000,expense,')), /따옴표 형식/);
});

test('날짜·금액·거래 유형·빈 값을 검증한다', () => {
  for (const date of ['2026-02-30', '2026-13-01', '2026-2-01']) assert.throws(() => Ledger.parseCSV(csv(`A1,${date},상점,쇼핑,1000,expense,`)), /날짜/);
  for (const amount of ['-10', 'NaN', '1.5', '1e3', '9007199254740992']) assert.throws(() => Ledger.parseCSV(csv(`A1,2026-09-01,상점,쇼핑,${amount},expense,`)), /금액/);
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,상점,쇼핑,1000,income,')), /type/);
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,,쇼핑,1000,expense,')), /필수 값/);
  assert.equal(Ledger.parseCSV(csv('A1,2024-02-29,상점,쇼핑,0,expense,'))[0].amount_krw, 0);
});

test('중복 ID와 안전 정수 범위를 넘는 합계를 거부한다', () => {
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,상점,쇼핑,1000,expense,', 'A1,2026-09-02,상점,쇼핑,1000,expense,')), /중복/);
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,상점,쇼핑,9007199254740991,expense,', 'A2,2026-09-02,상점,쇼핑,1,expense,')), /안전하게 계산/);
});

test('선택 열 생략·열 순서 변경·추가 열·빈 줄을 허용한다', () => {
  const rows = Ledger.parseCSV('\nmerchant,type,amount_krw,date,category,transaction_id,memo\n카페,expense,1000,2026-09-01,식비,A1,메모\n\n');
  assert.equal(rows[0].merchant, '카페');
  assert.equal(rows[0].original_transaction_id, '');
  assert.equal(Ledger.summarize(rows).net, 1000);
});
