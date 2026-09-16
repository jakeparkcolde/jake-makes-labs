'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ledger = require('../ledger.js');
const sample = fs.readFileSync(path.join(__dirname, '../inputs/01-basic.csv'), 'utf8');
const changedSample = fs.readFileSync(path.join(__dirname, '../inputs/02-refunds-and-duplicates.csv'), 'utf8');
const emptyState = () => ({ transactions: [], month: 'all', fileName: '', lastImport: null });
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

test('음수 환불을 다시 빼지 않으며 원결제와 다른 월에도 환불 날짜로 합산한다', () => {
  const rows = Ledger.parseCSV(csv('E1,2026-08-31,상점,쇼핑,10000,expense,', 'R1,2026-09-01,상점,쇼핑,-10000,refund,E1', 'E2,2026-09-02,카페,식비,3000,expense,'));
  assert.equal(Ledger.summarize(rows).net, 3000);
  const summary = Ledger.summarize(Ledger.selectTransactions(rows, '2026-09'));
  assert.equal(summary.net, -7000);
  assert.equal(summary.refund, -10000);
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

test('실제 복원 함수로 거래·월·가져오기 결과를 복원하고 재업로드해도 증가하지 않는다', () => {
  const state = Ledger.importCSV(emptyState(), changedSample, '02-refunds-and-duplicates.csv');
  state.month = '2026-09';
  const restored = Ledger.restoreState(JSON.parse(JSON.stringify({ version: 2, ...state })));
  assert.deepEqual(restored, state);
  assert.ok(Ledger.months(restored.transactions).includes(restored.month));
  assert.equal(Ledger.summarize(Ledger.selectTransactions(restored.transactions, restored.month)).net, 118650);
  const repeated = Ledger.importCSV(restored, changedSample, '02-refunds-and-duplicates.csv');
  assert.deepEqual(repeated.transactions, restored.transactions);
  assert.equal(repeated.month, '2026-09');
  assert.equal(repeated.lastImport.duplicates.length, 20);
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
  assert.throws(() => Ledger.parseCSV(csv('R1,2026-09-01,상점,쇼핑,1000,refund,A1')), /환불 금액/);
  assert.throws(() => Ledger.parseCSV(csv('A1,2026-09-01,,쇼핑,1000,expense,')), /필수 값/);
  assert.equal(Ledger.parseCSV(csv('A1,2024-02-29,상점,쇼핑,0,expense,'))[0].amount_krw, 0);
});

test('중복을 제외한 병합 결과에 안전 정수 범위를 적용하고 실패 시 기존 상태를 보존한다', () => {
  const text = csv('A1,2026-09-01,상점,쇼핑,9007199254740991,expense,');
  const state = Ledger.importCSV(emptyState(), text, 'large.csv');
  const repeated = Ledger.importCSV(state, text, 'large.csv');
  assert.equal(repeated.transactions.length, 1);
  assert.equal(repeated.lastImport.duplicates.length, 1);
  const before = JSON.stringify(state);
  assert.throws(() => Ledger.importCSV(state, csv('A2,2026-09-02,상점,쇼핑,1,expense,'), 'extra.csv'), /안전하게 계산/);
  assert.equal(JSON.stringify(state), before);
});

test('기본 파일 → 변경 파일 → 재업로드에서 고유 거래·합계·환불·중복 수를 확인한다', () => {
  const basic = Ledger.importCSV(emptyState(), sample, '01-basic.csv');
  assert.equal(basic.transactions.length, 16);
  assert.equal(Ledger.summarize(basic.transactions).net, 343850);
  assert.equal(basic.lastImport.addedCount, 16);
  assert.equal(basic.lastImport.duplicates.length, 0);
  assert.equal(basic.lastImport.refunds.length, 0);
  const basicRepeated = Ledger.importCSV(basic, sample, '01-basic.csv');
  assert.deepEqual(basicRepeated.transactions, basic.transactions);
  assert.equal(basicRepeated.lastImport.duplicates.length, 16);
  basic.month = '2026-08';
  const changed = Ledger.importCSV(basic, changedSample, '02-refunds-and-duplicates.csv');
  assert.equal(changed.month, '2026-08');
  assert.equal(changed.transactions.length, 18);
  assert.equal(changed.lastImport.inputCount, 20);
  assert.equal(changed.lastImport.addedCount, 2);
  assert.equal(changed.lastImport.duplicates.length, 18);
  assert.deepEqual(changed.lastImport.refunds.map(t => [t.transaction_id, t.amount_krw, t.original_transaction_id]), [['R01', -89000, 'S06'], ['R02', -12500, 'A05']]);
  const summary = Ledger.summarize(changed.transactions);
  assert.equal(summary.net, 242350);
  assert.equal(summary.expense, 343850);
  assert.equal(summary.refund, -101500);
  assert.equal(Ledger.summarize(Ledger.selectTransactions(changed.transactions, '2026-08')).net, 123700);
  assert.equal(Ledger.summarize(Ledger.selectTransactions(changed.transactions, '2026-09')).net, 118650);
  for (const id of ['S05', 'S09', 'S06', 'R01', 'A05', 'R02']) assert.equal(changed.transactions.filter(t => t.transaction_id === id).length, 1);
  assert.equal(basic.transactions.length, 16, '기존 상태를 직접 변경하지 않는다');
  const repeated = Ledger.importCSV(changed, changedSample, '02-refunds-and-duplicates.csv');
  assert.deepEqual(repeated.transactions, changed.transactions);
  assert.equal(repeated.lastImport.addedCount, 0);
  assert.equal(repeated.lastImport.refunds.length, 0);
  assert.equal(repeated.lastImport.duplicates.length, 20);
  assert.equal(Ledger.summarize(repeated.transactions).net, 242350);
});

test('변경 파일을 처음 가져와도 파일 안의 중복 2행을 제외하고 같은 결과를 만든다', () => {
  const direct = Ledger.importCSV(emptyState(), changedSample, '02-refunds-and-duplicates.csv');
  const sequential = Ledger.importCSV(Ledger.importCSV(emptyState(), sample, '01-basic.csv'), changedSample, '02-refunds-and-duplicates.csv');
  assert.deepEqual(direct.transactions, sequential.transactions);
  assert.equal(direct.lastImport.addedCount, 18);
  assert.equal(direct.lastImport.refunds.length, 2);
  assert.deepEqual(direct.lastImport.duplicates.map(d => [d.recordNumber, d.transaction.transaction_id, d.source, d.conflict]), [[20, 'S05', 'file', false], [21, 'A03', 'file', false]]);
  assert.deepEqual(Ledger.importCSV(direct, sample, '01-basic.csv').transactions, direct.transactions);
});

test('같은 ID의 값이 다르면 먼저 저장한 거래를 보존하고 내용 차이를 보고한다', () => {
  const first = Ledger.importCSV(emptyState(), csv('A1,2026-09-01,상점,쇼핑,1000,expense,', 'A1,2026-09-02,다른 상점,식비,9000,expense,'), 'conflict.csv');
  assert.equal(first.transactions[0].amount_krw, 1000);
  assert.equal(first.lastImport.duplicates[0].conflict, true);
  assert.equal(first.lastImport.duplicates[0].source, 'file');
  const next = Ledger.importCSV(first, csv('A1,2026-09-03,다른 상점,식비,3000,expense,'), 'next.csv');
  assert.deepEqual(next.transactions, first.transactions);
  assert.equal(next.lastImport.duplicates[0].source, 'existing');
  assert.equal(next.lastImport.duplicates[0].conflict, true);
});

test('환불이 있는 월별 차트 합계와 CSV 왕복이 금액 부호·참조·고유 ID를 보존한다', () => {
  const state = Ledger.importCSV(emptyState(), changedSample, '02-refunds-and-duplicates.csv');
  for (const [month, expectedCount, expectedNet] of [['all', 18, 242350], ['2026-08', 8, 123700], ['2026-09', 10, 118650]]) {
    const selected = Ledger.selectTransactions(state.transactions, month);
    const summary = Ledger.summarize(selected);
    assert.equal(selected.length, expectedCount);
    assert.equal(summary.net, expectedNet);
    assert.equal(summary.categories.reduce((sum, [, value]) => sum + value, 0), expectedNet);
    const output = Ledger.toCSV(selected);
    assert.deepEqual(Ledger.parseCSV(output), selected);
    const fresh = Ledger.importCSV(emptyState(), output, 'export.csv');
    assert.equal(Ledger.summarize(fresh.transactions).net, expectedNet);
    const merged = Ledger.importCSV(state, output, 'export.csv');
    assert.deepEqual(merged.transactions, state.transactions);
    assert.equal(merged.lastImport.addedCount, 0);
  }
  const september = Ledger.summarize(Ledger.selectTransactions(state.transactions, '2026-09'));
  assert.equal(Object.fromEntries(september.categories)['쇼핑'], 0);
  assert.equal(Object.fromEntries(september.categories)['식비'], 28000);
});

test('이전 버전 저장을 이관하되 새 버전의 음수 환불은 다시 뒤집지 않는다', () => {
  const legacy = { version: 1, transactions: Ledger.parseCSV(sample), month: '2026-08', fileName: '01-basic.csv' };
  const migrated = Ledger.restoreState(legacy);
  assert.equal(migrated.transactions.length, 16);
  assert.equal(migrated.month, '2026-08');
  const legacyRefund = { transaction_id: 'R-old', date: '2026-09-15', merchant: '예제상점', category: '쇼핑', amount_krw: 1000, type: 'refund', original_transaction_id: 'S06' };
  const withRefund = Ledger.restoreState({ ...legacy, transactions: [...legacy.transactions, legacyRefund] });
  assert.equal(withRefund.transactions.at(-1).amount_krw, -1000);
  assert.equal(Ledger.summarize(withRefund.transactions).net, 342850);
  assert.deepEqual(Ledger.restoreState(JSON.parse(JSON.stringify({ version: 2, ...withRefund }))), withRefund);
});

test('불완전한 CSV 병합은 일부 거래만 추가하지 않고 전체 가져오기를 거부한다', () => {
  const state = Ledger.importCSV(emptyState(), sample, '01-basic.csv');
  const before = JSON.stringify(state);
  assert.throws(() => Ledger.importCSV(state, csv('R1,2026-09-12,상점,쇼핑,-5000,refund,S06', 'X1,2026-02-30,상점,쇼핑,1000,expense,'), 'invalid.csv'), /날짜/);
  assert.equal(JSON.stringify(state), before);
});

test('선택 열 생략·열 순서 변경·추가 열·빈 줄을 허용한다', () => {
  const rows = Ledger.parseCSV('\nmerchant,type,amount_krw,date,category,transaction_id,memo\n카페,expense,1000,2026-09-01,식비,A1,메모\n\n');
  assert.equal(rows[0].merchant, '카페');
  assert.equal(rows[0].original_transaction_id, '');
  assert.equal(Ledger.summarize(rows).net, 1000);
});
