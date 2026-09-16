/* app.js - 화면·저장소·파일 처리 (DOM 담당) */
(function () {
  'use strict';

  var L = window.Ledger;
  var STORAGE_DATA = 'gagyebu.v1.data';
  var STORAGE_MONTH = 'gagyebu.v1.month';
  var MAX_FILE_BYTES = 20 * 1024 * 1024;

  var state = {
    transactions: [],
    fileName: '',
    importedAt: '',
    skipped: [],
    hasTypeColumn: true,
    month: 'all'
  };

  function $(id) { return document.getElementById(id); }
  var els = {
    uploadView: $('upload-view'),
    dashboardView: $('dashboard-view'),
    topbarActions: $('topbar-actions'),
    fileChip: $('file-chip'),
    dropzone: $('dropzone'),
    fileInput: $('file-input'),
    fileInputReplace: $('file-input-replace'),
    uploadError: $('upload-error'),
    importWarning: $('import-warning'),
    btnClear: $('btn-clear'),
    btnExport: $('btn-export'),
    brandLink: $('brand-link'),
    monthSelect: $('month-select'),
    monthPrev: $('month-prev'),
    monthNext: $('month-next'),
    statScope: $('stat-scope'),
    statNet: $('stat-net'),
    statNetSub: $('stat-net-sub'),
    statExpense: $('stat-expense'),
    statRefund: $('stat-refund'),
    statCount: $('stat-count'),
    monthBars: $('month-bars'),
    monthHint: $('month-hint'),
    categoryBars: $('category-bars'),
    categoryScope: $('category-scope'),
    categoryEmpty: $('category-empty'),
    txBody: $('tx-body'),
    txTable: $('tx-table'),
    txCount: $('tx-count'),
    txHint: $('tx-hint'),
    txEmpty: $('tx-empty'),
    toast: $('toast')
  };

  // ---------- 저장소 ----------
  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }
  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* 무시 */ }
  }

  function loadState() {
    var raw = storageGet(STORAGE_DATA);
    if (raw) {
      try {
        var saved = JSON.parse(raw);
        if (saved && Array.isArray(saved.transactions) && saved.transactions.length > 0) {
          state.transactions = L.markDuplicates(saved.transactions);
          state.fileName = saved.fileName || '';
          state.importedAt = saved.importedAt || '';
          state.skipped = Array.isArray(saved.skipped) ? saved.skipped : [];
          state.hasTypeColumn = saved.hasTypeColumn !== false;
        }
      } catch (e) {
        storageRemove(STORAGE_DATA);
      }
    }
    var month = storageGet(STORAGE_MONTH);
    state.month = month || 'all';
    if (state.month !== 'all' && L.listMonths(state.transactions).indexOf(state.month) === -1) {
      state.month = 'all';
    }
  }

  function saveData() {
    var ok = storageSet(STORAGE_DATA, JSON.stringify({
      fileName: state.fileName,
      importedAt: state.importedAt,
      skipped: state.skipped,
      hasTypeColumn: state.hasTypeColumn,
      transactions: state.transactions
    }));
    if (!ok) showToast('브라우저 저장 공간에 저장하지 못했습니다. 새로고침하면 데이터가 사라질 수 있습니다.', 5000);
  }

  function saveMonth() {
    storageSet(STORAGE_MONTH, state.month);
  }

  // ---------- 파일 읽기 ----------
  function decodeBuffer(buffer) {
    if (typeof TextDecoder === 'undefined') {
      return String.fromCharCode.apply(null, new Uint8Array(buffer));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) {
      // UTF-8이 아니면 한국어 환경에서 흔한 EUC-KR(CP949)로 다시 시도
      try {
        return new TextDecoder('euc-kr').decode(buffer);
      } catch (e2) {
        return new TextDecoder('utf-8').decode(buffer);
      }
    }
  }

  function readFile(file, onDone, onError) {
    if (file.size > MAX_FILE_BYTES) {
      onError(new L.LedgerError('TOO_LARGE', '파일이 너무 큽니다 (20MB 이하만 지원합니다).'));
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { onDone(decodeBuffer(reader.result)); };
    reader.onerror = function () {
      onError(new L.LedgerError('READ_ERROR', '파일을 읽지 못했습니다. 다시 시도해 주세요.'));
    };
    reader.readAsArrayBuffer(file);
  }

  function handleFile(file) {
    if (!file) return;
    readFile(file, function (text) {
      var result;
      try {
        result = L.importCsv(text);
      } catch (err) {
        showUploadError(err, file.name);
        return;
      }
      state.transactions = result.transactions;
      state.fileName = file.name;
      state.importedAt = new Date().toISOString();
      state.skipped = result.skipped;
      state.hasTypeColumn = result.hasTypeColumn;
      var months = L.listMonths(state.transactions);
      if (months.indexOf(state.month) === -1) state.month = 'all';
      saveData();
      saveMonth();
      hideUploadError();
      render();
      showToast(file.name + ' · ' + result.transactions.length + '건을 불러왔습니다.');
      window.scrollTo(0, 0);
    }, function (err) {
      showUploadError(err, file.name);
    });
  }

  function showUploadError(err, fileName) {
    var msg = err && err.message ? err.message : '파일을 처리하지 못했습니다.';
    els.uploadError.innerHTML = '';
    var strong = document.createElement('strong');
    strong.textContent = (fileName ? fileName + ' 파일을 ' : '파일을 ') + '불러오지 못했습니다';
    var span = document.createElement('span');
    span.textContent = msg;
    var wrap = document.createElement('div');
    wrap.appendChild(strong);
    wrap.appendChild(span);
    els.uploadError.appendChild(wrap);
    els.uploadError.hidden = false;
    // 대시보드가 떠 있는 상태에서 실패하면 대시보드 상단에 오류를 보여주고 기존 데이터는 유지한다
    if (state.transactions.length > 0) {
      var box = els.importWarning;
      box.className = 'alert alert--error';
      box.innerHTML = '';
      var s = document.createElement('strong');
      s.textContent = strong.textContent + ': ';
      box.appendChild(s);
      box.appendChild(document.createTextNode(msg + ' 기존 데이터는 그대로 유지됩니다.'));
      box.hidden = false;
      window.scrollTo(0, 0);
    }
  }
  function hideUploadError() {
    els.uploadError.hidden = true;
    els.uploadError.innerHTML = '';
  }

  // ---------- 렌더링 ----------
  function render() {
    var hasData = state.transactions.length > 0;
    els.uploadView.hidden = hasData;
    els.dashboardView.hidden = !hasData;
    els.topbarActions.hidden = !hasData;
    if (!hasData) return;

    els.fileChip.textContent = state.fileName || '불러온 데이터';
    els.fileChip.title = state.fileName + (state.importedAt ? ' · ' + new Date(state.importedAt).toLocaleString('ko-KR') : '');

    renderWarnings();
    renderMonthSelect();

    var filtered = L.filterByMonth(state.transactions, state.month);
    var summary = L.summarize(filtered);
    var allSummary = L.summarize(state.transactions);

    renderStats(summary);
    renderMonthBars(allSummary.byMonth);
    renderCategoryBars(summary);
    renderTable(filtered);
  }

  function renderWarnings() {
    var box = els.importWarning;
    box.className = 'alert alert--warn';
    box.innerHTML = '';
    var parts = [];
    if (state.skipped.length > 0) {
      var examples = state.skipped.slice(0, 4).map(function (s) {
        return s.line + '행 (' + s.reasons.join(', ') + ')';
      }).join(', ');
      parts.push('형식이 맞지 않아 건너뛴 행 ' + state.skipped.length + '개: ' + examples + (state.skipped.length > 4 ? ' 외' : ''));
    }
    if (!state.hasTypeColumn) {
      parts.push('type 열이 없어 모든 거래를 지출로 계산했습니다.');
    }
    if (parts.length === 0) { box.hidden = true; return; }
    var ul = document.createElement('ul');
    parts.forEach(function (p) {
      var li = document.createElement('li');
      li.textContent = p;
      ul.appendChild(li);
    });
    box.appendChild(ul);
    box.hidden = false;
  }

  function monthOptions() {
    return ['all'].concat(L.listMonths(state.transactions).reverse());
  }

  function renderMonthSelect() {
    var options = monthOptions();
    var sel = els.monthSelect;
    sel.innerHTML = '';
    options.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m;
      opt.textContent = L.formatMonth(m);
      sel.appendChild(opt);
    });
    sel.value = state.month;
    var idx = options.indexOf(state.month);
    // 목록은 최신 달이 위. "이전 달"은 아래쪽(더 오래된 달)으로 이동
    els.monthPrev.disabled = idx >= options.length - 1;
    els.monthNext.disabled = idx <= 0;
  }

  function setMonth(month) {
    var options = monthOptions();
    if (options.indexOf(month) === -1) month = 'all';
    state.month = month;
    saveMonth();
    render();
  }

  function renderStats(summary) {
    var scope = L.formatMonth(state.month);
    els.statScope.textContent = scope;
    els.statNet.textContent = L.formatKrw(summary.net);
    els.statExpense.textContent = L.formatKrw(summary.expense);
    els.statRefund.textContent = (summary.refund > 0 ? '-' : '') + L.formatKrw(summary.refund);
    els.statCount.textContent = L.formatNumber(summary.count) + '건';

    var sub = [];
    if (summary.count > 0 && state.month !== 'all') {
      var days = daysInMonth(state.month);
      sub.push('하루 평균 ' + L.formatKrw(Math.round(summary.net / days)));
    }
    if (summary.refund > 0) sub.push('지출 ' + L.formatKrw(summary.expense) + ' - 환불 ' + L.formatKrw(summary.refund));
    if (summary.excluded > 0) sub.push('수입·이체 ' + summary.excluded + '건은 순지출에서 제외');
    els.statNetSub.textContent = sub.join(' · ');
  }

  function daysInMonth(month) {
    var parts = month.split('-');
    return new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 0)).getUTCDate();
  }

  // 막대 목록: items = [{ key, label, value, title, selected, dim }]
  function renderBars(container, items, opts) {
    container.innerHTML = '';
    var max = 0;
    items.forEach(function (it) { if (it.value > max) max = it.value; });
    var total = items.reduce(function (s, it) { return s + Math.max(it.value, 0); }, 0);
    items.forEach(function (it) {
      // <button> 에 display:grid 를 직접 주면 일부 브라우저에서 깨지므로 div + role=button 사용
      var row = document.createElement('div');
      row.className = 'bar' + (it.selected ? ' bar--selected' : '') + (it.dim ? ' bar--dim' : '');
      row.title = it.title || (it.label + ' ' + L.formatKrw(it.value));
      if (opts.clickable) {
        row.dataset.clickable = 'true';
        row.setAttribute('role', 'button');
        row.setAttribute('tabindex', '0');
        row.setAttribute('aria-pressed', it.selected ? 'true' : 'false');
        row.addEventListener('click', function () { opts.onClick(it.key); });
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onClick(it.key); }
        });
      }

      var label = document.createElement('span');
      label.className = 'bar__label';
      label.textContent = it.label;

      var track = document.createElement('span');
      track.className = 'bar__track';
      var fill = document.createElement('span');
      var pct = max > 0 && it.value > 0 ? (it.value / max) * 100 : 0;
      fill.className = 'bar__fill' + (pct === 0 ? ' bar__fill--zero' : '');
      fill.style.width = pct + '%';
      track.appendChild(fill);

      var value = document.createElement('span');
      value.className = 'bar__value';
      value.textContent = L.formatKrw(it.value);
      if (opts.share && total > 0 && it.value > 0) {
        var share = document.createElement('span');
        share.className = 'bar__share';
        share.textContent = Math.round((it.value / total) * 100) + '%';
        value.appendChild(share);
      }

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      container.appendChild(row);
    });
  }

  function renderMonthBars(byMonth) {
    var items = byMonth.slice().reverse().map(function (b) {
      var selected = state.month === b.month;
      return {
        key: b.month,
        label: b.month.replace('-', '.'),
        value: b.net,
        selected: selected,
        dim: state.month !== 'all' && !selected,
        title: L.formatMonth(b.month) + ' 순지출 ' + L.formatKrw(b.net) + ' · ' + b.count + '건'
      };
    });
    renderBars(els.monthBars, items, {
      clickable: true,
      onClick: function (key) { setMonth(state.month === key ? 'all' : key); }
    });
    els.monthHint.textContent = state.month === 'all'
      ? '막대를 누르면 그 달만 봅니다'
      : '선택한 달을 다시 누르면 전체 기간으로 돌아갑니다';
  }

  function renderCategoryBars(summary) {
    els.categoryScope.textContent = L.formatMonth(state.month);
    var items = summary.byCategory.map(function (b) {
      return {
        key: b.category,
        label: b.category,
        value: b.net,
        title: b.category + ' 순지출 ' + L.formatKrw(b.net) + ' · ' + b.count + '건' +
          (b.refund > 0 ? ' (환불 ' + L.formatKrw(b.refund) + ' 차감)' : '')
      };
    });
    renderBars(els.categoryBars, items, { clickable: false, share: true });
    els.categoryEmpty.hidden = items.length > 0;
  }

  function renderTable(filtered) {
    var rows = L.sortByDateDesc(filtered);
    els.txCount.textContent = rows.length + '건';
    els.txHint.textContent = (state.fileName ? state.fileName + ' · ' : '') + '최근 거래부터';
    els.txBody.innerHTML = '';
    els.txEmpty.hidden = rows.length > 0;
    els.txTable.hidden = rows.length === 0;

    var frag = document.createDocumentFragment();
    rows.forEach(function (t) {
      var tr = document.createElement('tr');

      var tdDate = document.createElement('td');
      tdDate.className = 'tx__date';
      tdDate.textContent = state.month === 'all' ? t.date : L.formatDate(t.date);
      tdDate.title = t.date;

      var tdMerchant = document.createElement('td');
      tdMerchant.className = 'tx__merchant';
      tdMerchant.appendChild(document.createTextNode(t.merchant));
      if (t.duplicate) {
        var dup = document.createElement('span');
        dup.className = 'badge badge--warn';
        dup.textContent = '중복 의심';
        dup.title = '같은 날짜·가맹점·금액의 거래가 또 있습니다. 합계에는 모두 포함됩니다.';
        tdMerchant.appendChild(dup);
      }
      var meta = document.createElement('div');
      meta.className = 'tx__meta';
      meta.textContent = t.category + (t.id && !/^row\d+$/.test(t.id) ? ' · ' + t.id : '');
      tdMerchant.appendChild(meta);

      var tdCat = document.createElement('td');
      tdCat.className = 'tx__category';
      tdCat.textContent = t.category;
      if (t.id && !/^row\d+$/.test(t.id)) {
        var idEl = document.createElement('span');
        idEl.className = 'tx__id';
        idEl.textContent = t.id;
        tdCat.appendChild(idEl);
      }

      var tdAmt = document.createElement('td');
      tdAmt.className = 'tx__amount';
      var contribution = L.netContribution(t);
      if (t.type === 'expense') {
        tdAmt.textContent = L.formatKrw(contribution);
      } else if (t.type === 'refund') {
        tdAmt.className += ' tx__amount--refund';
        tdAmt.textContent = L.formatKrw(contribution);
        var rb = document.createElement('span');
        rb.className = 'badge badge--refund';
        rb.textContent = '환불';
        tdAmt.appendChild(rb);
      } else {
        tdAmt.className += ' tx__amount--excluded';
        tdAmt.textContent = L.formatKrw(t.amount);
        var eb = document.createElement('span');
        eb.className = 'badge';
        eb.textContent = (L.TYPE_LABELS[t.type] || t.rawType || '기타') + ' · 제외';
        eb.title = '순지출 계산에서 제외된 거래입니다.';
        tdAmt.appendChild(eb);
      }

      tr.appendChild(tdDate);
      tr.appendChild(tdMerchant);
      tr.appendChild(tdCat);
      tr.appendChild(tdAmt);
      frag.appendChild(tr);
    });
    els.txBody.appendChild(frag);
  }

  // ---------- 내보내기 ----------
  function exportCsv() {
    var filtered = L.sortByDateDesc(L.filterByMonth(state.transactions, state.month));
    var csv = L.toCsv(filtered);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var scope = state.month === 'all' ? '전체' : state.month;
    var name = '가계부_' + scope + '.csv';
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast(name + ' · ' + filtered.length + '건을 내려받습니다.');
  }

  // ---------- 토스트 ----------
  var toastTimer = null;
  function showToast(message, ms) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, ms || 3000);
  }

  // ---------- 이벤트 ----------
  function bindEvents() {
    els.dropzone.addEventListener('click', function () { els.fileInput.click(); });
    els.dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); }
    });
    els.fileInput.addEventListener('change', function () {
      handleFile(els.fileInput.files[0]);
      els.fileInput.value = '';
    });
    els.fileInputReplace.addEventListener('change', function () {
      handleFile(els.fileInputReplace.files[0]);
      els.fileInputReplace.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (evt) {
      els.dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        els.dropzone.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      els.dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        els.dropzone.classList.remove('is-over');
      });
    });
    els.dropzone.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) handleFile(files[0]);
    });
    // 페이지 다른 곳에 떨어뜨렸을 때 브라우저가 파일을 열어버리지 않도록
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (els.dashboardView.hidden) return;
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) handleFile(files[0]);
    });

    els.monthSelect.addEventListener('change', function () { setMonth(els.monthSelect.value); });
    els.monthPrev.addEventListener('click', function () {
      var options = monthOptions();
      var idx = options.indexOf(state.month);
      if (idx < options.length - 1) setMonth(options[idx + 1]);
    });
    els.monthNext.addEventListener('click', function () {
      var options = monthOptions();
      var idx = options.indexOf(state.month);
      if (idx > 0) setMonth(options[idx - 1]);
    });

    els.btnExport.addEventListener('click', exportCsv);
    els.btnClear.addEventListener('click', function () {
      if (!window.confirm('불러온 데이터를 이 브라우저에서 지울까요? 원본 CSV 파일은 그대로 남습니다.')) return;
      storageRemove(STORAGE_DATA);
      storageRemove(STORAGE_MONTH);
      state.transactions = [];
      state.fileName = '';
      state.skipped = [];
      state.month = 'all';
      hideUploadError();
      render();
      showToast('데이터를 지웠습니다.');
    });
    els.brandLink.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ---------- 시작 ----------
  loadState();
  bindEvents();
  render();
})();
