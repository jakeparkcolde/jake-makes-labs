/* 실행: node tests/scenarios.js
 * 세 가지 가져오기 시나리오를 실제 입력 파일로 돌려 결과를 표로 출력한다. (검증은 ledger.test.js 가 담당) */
'use strict';
var fs = require('fs');
var path = require('path');
var L = require('../js/ledger.js');

function read(name) { return fs.readFileSync(path.join(__dirname, '..', 'inputs', name), 'utf8'); }
function imp(existing, name) {
  return L.mergeTransactions(existing, L.parseTransactions(read(name)), { fileName: name, importedAt: new Date().toISOString() });
}
function line(txs, label) {
  var s = L.summarize(txs);
  var months = s.byMonth.map(function (b) { return b.month + ' ' + L.formatKrw(b.net); }).join(', ');
  console.log('  ' + label);
  console.log('    거래 ' + s.count + '건 · 순지출 ' + L.formatKrw(s.net) + ' (지출 ' + L.formatKrw(s.expense) + ', 환불 ' + L.formatKrw(s.refund) + ' ' + s.refundCount + '건)');
  console.log('    월별: ' + months);
}
function report(r) {
  var ex = r.duplicates.filter(function (d) { return d.reason === 'existing'; }).length;
  console.log('    가져오기 결과: 읽은 행 ' + r.rowCount + ' · 추가 ' + r.addedCount + ' · 중복 제외 ' + r.duplicates.length +
    ' (기존 ID ' + ex + ', 파일 안 반복 ' + (r.duplicates.length - ex) + ') · 환불 반영 ' + r.refunds.length);
  if (r.duplicates.length) {
    console.log('    제외한 행: ' + r.duplicates.map(function (d) { return d.line + '행 ' + d.id; }).join(', '));
  }
  r.refunds.forEach(function (f) {
    console.log('    환불: ' + f.id + ' ' + f.date + ' ' + f.merchant + ' ' + L.formatKrw(f.amount) +
      ' -> 원거래 ' + (f.originalId || '없음') + (f.originalFound ? ' (' + f.originalDate + ' ' + L.formatKrw(f.originalAmount) + ')' : ' (찾지 못함)'));
  });
}

console.log('시나리오 1) 기본 파일만 가져온 경우');
var s1 = imp([], '01-basic.csv');
report(s1.report);
line(s1.transactions, '결과');

console.log('\n시나리오 2) 기본 파일 위에 변경 파일을 가져온 경우');
var s2 = imp(s1.transactions, '02-refunds-and-duplicates.csv');
report(s2.report);
line(s2.transactions, '결과');

console.log('\n시나리오 2b) 변경 파일만 처음 가져온 경우');
var s2b = imp([], '02-refunds-and-duplicates.csv');
report(s2b.report);
line(s2b.transactions, '결과');

console.log('\n시나리오 3) 같은 파일을 다시 가져온 경우 (2 의 상태에서 변경 파일을 한 번 더)');
var s3 = imp(s2.transactions, '02-refunds-and-duplicates.csv');
report(s3.report);
line(s3.transactions, '결과');

console.log('\n시나리오 3b) 기본 파일을 한 번 더');
var s3b = imp(s3.transactions, '01-basic.csv');
report(s3b.report);
line(s3b.transactions, '결과');

console.log('\n9월 필터 카테고리 (시나리오 2 상태):');
L.summarize(L.filterByMonth(s2.transactions, '2026-09')).byCategory.forEach(function (b) {
  console.log('    ' + b.category + ' ' + L.formatKrw(b.net) + (b.refundCount ? ' (환불 ' + L.formatKrw(b.refund) + ')' : ''));
});
console.log('\n9월 내보내기 첫 3줄:');
console.log(L.toCsv(L.sortByDateDesc(L.filterByMonth(s2.transactions, '2026-09'))).replace(/^﻿/, '').split('\r\n').slice(0, 3).map(function (l) { return '    ' + l; }).join('\n'));
