/* 실행: node tests/static-check.js
 * app.js 가 참조하는 요소 id 와 클래스가 index.html / style.css 에 실제로 있는지 확인한다.
 * (브라우저 없이 잡을 수 있는 오타·불일치 검사) */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
var app = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

var problems = [];

// 1) $('id') 로 참조하는 id 가 HTML에 있는지
var idRe = /\$\('([a-z0-9-]+)'\)/g;
var m;
var ids = {};
while ((m = idRe.exec(app))) ids[m[1]] = true;
Object.keys(ids).forEach(function (id) {
  if (html.indexOf('id="' + id + '"') === -1) problems.push('HTML에 없는 id: ' + id);
});

// 2) HTML의 id 가 중복되지 않는지
var htmlIds = {};
var hre = /\sid="([^"]+)"/g;
while ((m = hre.exec(html))) {
  if (htmlIds[m[1]]) problems.push('HTML id 중복: ' + m[1]);
  htmlIds[m[1]] = true;
}

// 3) JS 에서 만드는 클래스가 CSS 에 정의돼 있는지
var classRe = /className\s*(?:\+)?=\s*'([^']+)'/g;
var classes = {};
while ((m = classRe.exec(app))) {
  m[1].split(/\s+/).forEach(function (c) { if (c) classes[c] = true; });
}
var extra = /'\s(bar--[a-z]+|tx__amount--[a-z]+|bar__fill--zero)'/g;
while ((m = extra.exec(app))) classes[m[1]] = true;
['bar--selected', 'bar--dim', 'tx__amount--refund', 'tx__amount--excluded', 'bar__fill--zero', 'is-over'].forEach(function (c) { classes[c] = true; });
Object.keys(classes).forEach(function (c) {
  if (css.indexOf('.' + c) === -1) problems.push('CSS에 없는 클래스: ' + c);
});

// 4) HTML 이 참조하는 정적 파일 존재
['css/style.css', 'js/ledger.js', 'js/app.js'].forEach(function (p) {
  if (html.indexOf(p) === -1) problems.push('HTML에서 참조하지 않는 파일: ' + p);
  if (!fs.existsSync(path.join(root, p))) problems.push('파일 없음: ' + p);
});

// 5) 스크립트 순서: ledger.js 가 app.js 보다 먼저
if (html.indexOf('js/ledger.js') > html.indexOf('js/app.js')) problems.push('ledger.js 가 app.js 보다 뒤에 로드됨');

if (problems.length) {
  problems.forEach(function (p) { console.log('  FAIL ' + p); });
  process.exit(1);
}
console.log('static-check: 문제 없음 (id ' + Object.keys(ids).length + '개, 클래스 ' + Object.keys(classes).length + '개 확인)');
