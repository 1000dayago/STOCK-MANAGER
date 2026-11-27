/* backtest.js - 데이터 불러오기(CSV/수급), 지표, 렌코, 백테스트 엔진 (DOM 없음) */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});
  const num = (v, d = 0) => SM.num(v, d);

  /* ---------- 표 / CSV 읽기 ---------- */
  // 증권사·거래소·포털마다 제각각인 표를 최대한 자동 인식하고, 틀리면 열을 직접 지정할 수 있게 합니다.
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const normH = (s) => String(s == null ? '' : s).replace(/^﻿/, '').trim().toLowerCase().replace(/[\s.]+/g, '');

  function splitLine(line, delim) {
    if (delim === ' ') return line.trim().split(/\s+/);
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === delim && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function detectDelim(line) {
    if (line.includes('\t')) return '\t';
    const sc = line.split(';').length, cm = line.split(',').length;
    if (cm > 2 || sc > 2) return sc > cm ? ';' : ',';
    if (cm === 2 && !/\s{1,}/.test(line.trim())) return ',';
    return ' ';
  }

  function parseDate(s) {
    s = String(s || '').trim().replace(/"/g, '');
    let m = s.match(/^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/); // Jan 02, 2025
    if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})/); // 02-Jan-2025
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // 미국식 MM/DD/YYYY
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = s.match(/^(\d{2})[.](\d{1,2})[.](\d{1,2})$/); // YY.MM.DD
    if (m) return `20${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    return null;
  }
  const toNum = (s) => {
    s = String(s === undefined ? '' : s).trim();
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[",\s%원$▲△+]/g, '');
    if (/[▼▽]/.test(s)) { neg = true; s = s.replace(/[▼▽]/g, ''); }
    if (s === '' || s === '-') return NaN;
    const v = parseFloat(s);
    return neg ? -Math.abs(v) : v;
  };
  const toVol = (s) => { // 1.2M, 350K, 1,234 모두 지원
    const m = String(s == null ? '' : s).trim().match(/^([\d.,]+)\s*([KkMmBb])$/);
    if (!m) return toNum(s);
    return parseFloat(m[1].replace(/,/g, '')) * { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()];
  };

  const DATE_ALIAS = ['date', '날짜', '일자', '일시', '거래일', '기준일', 'time', 'datetime', 'tradedate', 'tradingdate', '년월일'];
  function guessCols(header) {
    const h = header.map(normH), used = new Set(), cols = {};
    const pick = (key, exact, fuzzy) => {
      let i = h.findIndex((x, j) => !used.has(j) && exact.includes(x));
      if (i < 0 && fuzzy) i = h.findIndex((x, j) => !used.has(j) && fuzzy(x));
      cols[key] = i; if (i >= 0) used.add(i);
    };
    pick('date', DATE_ALIAS, (x) => x.includes('날짜') || x.includes('일자'));
    pick('adj', ['adjclose', 'adj_close', 'adjustedclose', '수정종가', '수정주가'], (x) => x.includes('adj') || x.includes('수정'));
    pick('close', ['close', '종가', 'close/last', '현재가', 'price', 'last', '종가(원)', 'closeprice'], (x) => x.includes('종가') && !x.includes('전일') && !x.includes('대비'));
    pick('open', ['open', '시가', '오픈', 'opening', 'openprice'], (x) => x.includes('시가') && !x.includes('총액'));
    pick('high', ['high', '고가'], (x) => x.includes('고가') || x.includes('high'));
    pick('low', ['low', '저가'], (x) => x.includes('저가') || x === 'low');
    pick('volume', ['volume', '거래량', 'vol', '거래량(주)'], (x) => x.includes('거래량') || x.startsWith('vol'));
    pick('frgn', [], (x) => (x.includes('외국인') || x.includes('foreign')) && !/보유|지분|비율|한도|소진/.test(x));
    pick('inst', [], (x) => (x.includes('기관') || x.includes('institution')) && !/보유|비율/.test(x));
    pick('indiv', [], (x) => x.includes('개인') || x.includes('individual') || x.includes('retail'));
    // KRX 투자자별 표처럼 '기관합계'가 없고 금융투자·보험·투신·사모·은행·기타금융·연기금으로 쪼개져 있으면 합산 대상으로 잡습니다.
    if (cols.inst < 0) {
      const parts = [];
      h.forEach((x, j) => { if (!used.has(j) && INST_PARTS.some((q) => x.includes(q))) parts.push(j); });
      if (parts.length >= 2) cols.instSum = parts;
    }
    return cols;
  }
  const INST_PARTS = ['금융투자', '보험', '투신', '사모', '은행', '기타금융', '연기금'];
  const hasInstSum = (c) => Array.isArray(c.instSum) && c.instSum.length > 0;
  const hasFlowCol = (c) => c.frgn >= 0 || c.inst >= 0 || c.indiv >= 0 || hasInstSum(c);
  const flowColOn = (c, k) => c[k] >= 0 || (k === 'inst' && hasInstSum(c));
  function flowCell(c, row, k) { // 한 행에서 수급 값을 읽습니다(기관은 합산 열이면 합계, 모두 비면 null)
    if (c[k] >= 0) { const x = toNum(row[c[k]]); return isFinite(x) ? x : null; }
    if (k === 'inst' && hasInstSum(c)) {
      let sum = 0, any = false;
      for (const j of c.instSum) { const x = toNum(row[j]); if (isFinite(x)) { sum += x; any = true; } }
      return any ? sum : null;
    }
    return null;
  }
  // 수급 단위 추정: 순매수 수량(주)은 그날 거래량을 넘을 수 없으므로, 값이 거래량보다 훨씬 크면 금액(원)으로 봅니다.
  function detectFlowUnit(seriesList, vols) {
    const med = (arr) => { const b = arr.filter((x) => isFinite(x) && x > 0).sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : 0; };
    const mv = med(vols);
    if (!mv) return 'shares';
    return seriesList.some((ser) => med(ser.map((x) => (x == null ? NaN : Math.abs(x)))) > mv * 5) ? 'krw' : 'shares';
  }
  function kindOf(c) {
    const p = c.date >= 0 && c.close >= 0, f = hasFlowCol(c);
    return p && f ? 'both' : p ? 'price' : c.date >= 0 && f ? 'flow' : 'unknown';
  }

  // 제목 줄이 몇 번째 줄이든 자동으로 찾습니다(앞에 설명 줄이 있어도 됨). headerLine(1부터)을 주면 그 줄을 제목으로 씁니다.
  function splitTable(text, headerLine) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) return { error: '데이터가 비어 있습니다.' };
    let hi = -1;
    const hl = Math.floor(num(headerLine, 0));
    if (hl > 0) hi = hl - 1;
    else {
      for (let i = 0; i < Math.min(lines.length, 40); i++) {
        const c = guessCols(splitLine(lines[i], detectDelim(lines[i])));
        if (c.date >= 0 && (c.close >= 0 || hasFlowCol(c))) { hi = i; break; }
      }
      if (hi < 0) hi = 0;
    }
    if (hi >= lines.length - 1) return { error: '제목 줄 번호가 너무 큽니다.' };
    const delim = detectDelim(lines[hi]);
    const strip = (l) => (delim === ' ' ? l.replace(/(상승|하락|보합|상한가|하한가)/g, ' ') : l); // 네이버 등에서 복사한 "상승 100" 같은 방향 단어 제거
    const header = splitLine(lines[hi], delim).map((x) => String(x).trim());
    const rows = lines.slice(hi + 1).map((l) => splitLine(strip(l), delim));
    return { header, rows, delim, headerLine: hi + 1 };
  }
  const tableSig = (t) => t.header.map(normH).join('|');
  // saved: { 서명: cols } (이전에 사용자가 지정한 열 설정)
  function analyzeTable(t, saved) {
    let cols = guessCols(t.header), fromSaved = false;
    const sv = saved && saved[tableSig(t)];
    if (sv && Object.values(sv).every((i) => (Array.isArray(i) ? i.every((j) => j < t.header.length) : i < t.header.length))) { cols = Object.assign({}, sv); fromSaved = true; }
    return { table: t, cols, kind: kindOf(cols), signature: tableSig(t), fromSaved };
  }

  function buildDataset(t, cols, opt = {}) {
    const warnings = [];
    if (cols.date < 0 || cols.close < 0) return { error: '날짜와 종가 열을 지정하세요.' };
    const useAdj = opt.useAdj !== false && cols.adj >= 0;
    const rows = [];
    let bad = 0;
    for (const c of t.rows) {
      const d = parseDate(c[cols.date]);
      const close = toNum(c[cols.close]);
      if (!d || !isFinite(close)) { bad++; continue; }
      const o = cols.open >= 0 ? toNum(c[cols.open]) : close;
      const h = cols.high >= 0 ? toNum(c[cols.high]) : close;
      const l = cols.low >= 0 ? toNum(c[cols.low]) : close;
      const v = cols.volume >= 0 ? toVol(c[cols.volume]) : NaN;
      let r = { d, o: isFinite(o) ? o : close, h: isFinite(h) ? h : close, l: isFinite(l) ? l : close, c: close, v: isFinite(v) ? v : 0 };
      if (useAdj) {
        const a = toNum(c[cols.adj]);
        if (isFinite(a) && a > 0 && close > 0) { const f = a / close; r = { d, o: r.o * f, h: r.h * f, l: r.l * f, c: a, v: r.v }; }
      }
      for (const k of ['frgn', 'inst', 'indiv']) { if (flowColOn(cols, k)) r[k] = flowCell(cols, c, k); }
      rows.push(r);
    }
    rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const uniq = [];
    let dup = 0;
    for (const r of rows) { if (uniq.length && uniq[uniq.length - 1].d === r.d) { dup++; uniq[uniq.length - 1] = r; } else uniq.push(r); }
    if (uniq.length < 5) return { error: '유효한 데이터가 너무 적습니다 (' + uniq.length + '행). 날짜·종가 열 지정을 확인하세요.' };
    if (bad) warnings.push(`${bad}행은 날짜/가격을 읽지 못해 건너뛰었습니다. (제목 줄이나 합계 줄이면 정상입니다)`);
    if (dup) warnings.push(`중복 날짜 ${dup}건은 마지막 값만 사용했습니다.`);
    if (cols.high < 0 || cols.low < 0) warnings.push('고가/저가 열이 없어 종가로 대체했습니다. (볼린저 "장중 저가/고가" 기준은 종가 기준으로 계산됩니다)');
    if (cols.open < 0) warnings.push('시가 열이 없어 종가로 대체했습니다. ("다음날 시가 체결"은 종가로 계산됩니다)');
    if (cols.volume < 0) warnings.push('거래량 열이 없습니다. 거래량 조건은 사용할 수 없습니다.');
    else if (uniq.every((r) => r.v === 0)) warnings.push('거래량이 모두 0입니다. 거래량 열을 확인하세요.');
    if (useAdj) warnings.push('수정종가(Adj Close) 열이 있어 시/고/저/종가를 수정주가 기준으로 보정했습니다.');
    else if (cols.adj < 0) warnings.push('수정종가 열이 없습니다. 액면분할·배당이 있었다면 가격이 왜곡될 수 있습니다.');
    for (let i = 1; i < uniq.length; i++) {
      const ch = uniq[i].c / uniq[i - 1].c - 1;
      if (Math.abs(ch) > 0.4) { warnings.push(`${uniq[i].d} 종가가 전일 대비 ${(ch * 100).toFixed(0)}% 변동했습니다. 액면분할 등으로 수정되지 않은 가격인지 확인하세요.`); break; }
    }
    const data = {
      d: uniq.map((r) => r.d), o: uniq.map((r) => r.o), h: uniq.map((r) => r.h),
      l: uniq.map((r) => r.l), c: uniq.map((r) => r.c), v: uniq.map((r) => r.v),
      hasVol: cols.volume >= 0, hasHL: cols.high >= 0 && cols.low >= 0, hasOpen: cols.open >= 0,
    };
    const fl = [];
    for (const k of ['frgn', 'inst', 'indiv']) {
      if (!flowColOn(cols, k)) continue;
      const arr = uniq.map((r) => (r[k] == null ? null : r[k]));
      if (arr.some((x) => x != null)) { data[k] = arr; fl.push({ frgn: '외국인', inst: '기관', indiv: '개인' }[k]); }
    }
    if (fl.length) {
      data.flowUnit = opt.unit === 'shares' || opt.unit === 'krw' ? opt.unit : detectFlowUnit(['frgn', 'inst', 'indiv'].filter((k) => data[k]).map((k) => data[k]), cols.volume >= 0 ? data.v : []);
      if (opt.unit === 'krwToShares') { // 금액(원) → 수량(주) 근사 환산: 그날 종가로 나눔
        for (const k of ['frgn', 'inst', 'indiv']) if (data[k]) data[k] = data[k].map((v, i) => (v == null ? null : Math.round(v / data.c[i])));
        data.flowUnit = 'shares';
        warnings.push('수급 금액(원)을 그날 종가로 나눠 수량(주)으로 환산했습니다. 실제 체결가가 종가와 달라 약간의 오차(대략 1% 이내)가 있습니다.');
      }
      warnings.push(`수급 열(${fl.join('·')})도 함께 불러왔습니다. 단위는 ${data.flowUnit === 'krw' ? '금액(원)' : '수량(주)'}으로 판단했습니다. 틀리면 단위를 바꾸세요.`);
      if (hasInstSum(cols) && cols.inst < 0) warnings.push(`기관 = ${cols.instSum.map((j) => t.header[j]).join('+')} 열의 합계입니다.`);
    }
    return { data, warnings, count: uniq.length };
  }

  // 예전 호환: 텍스트를 바로 가격 데이터로
  function parseOHLCV(text, opt = {}) {
    const t = splitTable(text);
    if (t.error) return t;
    const cols = guessCols(t.header);
    if (cols.date < 0 || cols.close < 0) return { error: '날짜/종가 열을 찾지 못했습니다. 첫 줄에 "날짜,시가,고가,저가,종가,거래량" 같은 제목이 있어야 합니다. (인식한 제목: ' + t.header.join(' | ') + ')' };
    return buildDataset(t, cols, opt);
  }

  // 기존 데이터(a)에 새 데이터(b)를 날짜 기준으로 합칩니다. 같은 날짜는 b가 우선이지만,
  // b에 시가·고가·저가·거래량 열이 없으면(예: 수급 표) 기존 값은 그대로 두고 있는 값만 갱신합니다.
  function mergeDatasets(a, b) {
    const map = new Map();
    const FK = ['frgn', 'inst', 'indiv'];
    let overlap = 0, mismatch = 0;
    const put = (src, isNew) => {
      for (let i = 0; i < src.d.length; i++) {
        const d = src.d[i];
        let r = map.get(d);
        const existed = !!r;
        if (!r) { r = { frgn: null, inst: null, indiv: null }; map.set(d, r); }
        else if (isNew) { overlap++; if (Math.abs(r.c / src.c[i] - 1) > 0.01) mismatch++; }
        if (!existed || !isNew) Object.assign(r, { d, o: src.o[i], h: src.h[i], l: src.l[i], c: src.c[i], v: src.v[i] });
        else {
          r.c = src.c[i];
          if (src.hasOpen !== false) r.o = src.o[i];
          if (src.hasHL !== false) { r.h = src.h[i]; r.l = src.l[i]; }
          if (src.hasVol !== false) r.v = src.v[i];
        }
        for (const k of FK) if (src[k] && src[k][i] != null) r[k] = src[k][i];
      }
    };
    put(a, false); put(b, true);
    const rows = [...map.values()].sort((x, y) => (x.d < y.d ? -1 : 1));
    const data = { d: rows.map((r) => r.d), o: rows.map((r) => r.o), h: rows.map((r) => r.h), l: rows.map((r) => r.l), c: rows.map((r) => r.c), v: rows.map((r) => r.v), hasVol: !!(a.hasVol || b.hasVol), hasHL: !!(a.hasHL && b.hasHL), hasOpen: a.hasOpen !== false && b.hasOpen !== false };
    for (const k of FK) { const arr = rows.map((r) => r[k]); if (arr.some((x) => x != null)) data[k] = arr; }
    const bHas = FK.some((k) => b[k]), aHas = FK.some((k) => a[k]);
    const unitMismatch = !!(bHas && aHas && a.flowUnit && b.flowUnit && a.flowUnit !== b.flowUnit);
    if (bHas || aHas) data.flowUnit = (bHas && b.flowUnit) || a.flowUnit || 'shares';
    return { unitMismatch, data, added: rows.length - a.d.length, overlap, mismatch, keptOHLC: b.hasHL === false || b.hasOpen === false };
  }
  // 두 데이터가 같은 종목일 가능성: 겹치는 날짜에서 종가가 1% 이내로 같은 비율
  function sameStockScore(a, b) {
    const idx = new Map(a.d.map((d, i) => [d, i]));
    let overlap = 0, match = 0;
    for (let j = 0; j < b.d.length; j++) {
      const i = idx.get(b.d[j]);
      if (i === undefined) continue;
      overlap++;
      if (Math.abs(a.c[i] / b.c[j] - 1) <= 0.01) match++;
    }
    return { overlap, match, ratio: overlap ? match / overlap : 0 };
  }

  /* ---------- 수급만 있는 표를 기존 가격 데이터에 합치기 ---------- */
  function mergeFlow(data, table, cols, opt = {}) {
    const n = data.d.length;
    const idxOfDate = new Map(data.d.map((d, i) => [d, i]));
    const arrs = { frgn: flowColOn(cols, 'frgn') ? new Array(n).fill(null) : null, inst: flowColOn(cols, 'inst') ? new Array(n).fill(null) : null, indiv: flowColOn(cols, 'indiv') ? new Array(n).fill(null) : null };
    let matched = 0, unmatched = 0;
    const seen = new Set();
    for (const r of table.rows) {
      const d = parseDate(r[cols.date]);
      if (!d) continue;
      const i = idxOfDate.get(d);
      if (i === undefined) { unmatched++; continue; }
      let ok = false;
      for (const k of ['frgn', 'inst', 'indiv']) {
        if (!arrs[k]) continue;
        const v = flowCell(cols, r, k);
        if (v != null) { arrs[k][i] = v; ok = true; }
      }
      if (ok && !seen.has(i)) { seen.add(i); matched++; }
    }
    if (!matched) return { error: '가격 데이터와 날짜가 하나도 맞지 않습니다. 날짜 열과 기간을 확인하세요.' };
    if (opt.unit === 'krwToShares') {
      for (const k of ['frgn', 'inst', 'indiv']) if (arrs[k]) arrs[k] = arrs[k].map((v, i) => (v == null ? null : Math.round(v / data.c[i])));
      return { arrs, matched, unmatched, missing: n - matched, unit: 'shares', converted: true };
    }
    const unit = opt.unit === 'shares' || opt.unit === 'krw' ? opt.unit : detectFlowUnit(['frgn', 'inst', 'indiv'].filter((k) => arrs[k]).map((k) => arrs[k]), data.v);
    return { arrs, matched, unmatched, missing: n - matched, unit };
  }
  // 예전 호환
  const parseTable = (text, headerLine) => splitTable(text, headerLine);
  const guessFlowCols = (header) => { const c = guessCols(header); return { date: c.date, frgn: c.frgn, inst: c.inst, indiv: c.indiv }; };

  /* ---------- 저장된 데이터 요약(화면의 데이터 정보 카드용) ---------- */
  function dataInfo(data, range) {
    const n = data.d.length;
    const info = { days: n, from: data.d[0], to: data.d[n - 1], hasVol: !!data.hasVol, hasHL: !!data.hasHL, hasOpen: !!data.hasOpen, unit: data.flowUnit || 'shares', flow: {}, anyFlow: false };
    let ff = null, fl = null;
    for (const k of ['frgn', 'inst', 'indiv']) {
      const arr = data[k];
      if (!arr) { info.flow[k] = null; continue; }
      let cnt = 0, from = null, to = null;
      for (let i = 0; i < n; i++) if (arr[i] != null) { cnt++; if (!from) from = data.d[i]; to = data.d[i]; }
      info.flow[k] = cnt ? { count: cnt, from, to } : null;
      if (cnt) { info.anyFlow = true; if (!ff || from < ff) ff = from; if (!fl || to > fl) fl = to; }
    }
    info.flowFrom = ff; info.flowTo = fl;
    if (ff) { // 수급 구간 안인데 값이 빈 거래일, 수급 구간 밖의 거래일
      let inside = 0, empty = 0;
      for (let i = 0; i < n; i++) if (data.d[i] >= ff && data.d[i] <= fl) { inside++; if (!['frgn', 'inst', 'indiv'].some((k) => data[k] && data[k][i] != null)) empty++; }
      info.gapDays = empty; info.insideDays = inside; info.outsideDays = n - inside;
    }
    // 시뮬레이션 기간 안에서 수급이 있는 거래일
    const rf = (range && range.from) || data.d[0], rt = (range && range.to) || data.d[n - 1];
    let inR = 0, inRFlow = 0;
    for (let i = 0; i < n; i++) if (data.d[i] >= rf && data.d[i] <= rt) { inR++; if (['frgn', 'inst', 'indiv'].some((k) => data[k] && data[k][i] != null)) inRFlow++; }
    info.range = { from: rf, to: rt, days: inR, flowDays: inRFlow };
    info.recent = [];
    for (let i = Math.max(0, n - 8); i < n; i++) info.recent.push({ d: data.d[i], c: data.c[i], v: data.hasVol ? data.v[i] : null, frgn: data.frgn ? data.frgn[i] : null, inst: data.inst ? data.inst[i] : null, indiv: data.indiv ? data.indiv[i] : null });
    return info;
  }

  /* ---------- 지표 ---------- */
  function sma(arr, n) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= n) sum -= arr[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }
  function ema(arr, n) {
    const out = new Array(arr.length).fill(null);
    if (arr.length < n) return out;
    const k = 2 / (n + 1);
    let prev = 0;
    for (let i = 0; i < n; i++) prev += arr[i];
    prev /= n; out[n - 1] = prev;
    for (let i = n; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out[i] = prev; }
    return out;
  }
  const maOf = (type, arr, n) => (type === 'ema' ? ema(arr, n) : sma(arr, n));
  function rsi(arr, n) {
    const out = new Array(arr.length).fill(null);
    if (arr.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = arr[i] - arr[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= n; l /= n;
    out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < arr.length; i++) {
      const d = arr[i] - arr[i - 1];
      g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
      l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
    return out;
  }
  function macd(arr, s, l, sig) {
    const es = ema(arr, s), el = ema(arr, l);
    const line = arr.map((_, i) => (es[i] != null && el[i] != null ? es[i] - el[i] : null));
    const start = line.findIndex((v) => v != null);
    const signal = new Array(arr.length).fill(null);
    if (start >= 0) {
      const sub = ema(line.slice(start), sig);
      sub.forEach((v, i) => { signal[start + i] = v; });
    }
    return { line, signal };
  }
  function bollinger(arr, n, k) {
    const mid = sma(arr, n);
    const up = new Array(arr.length).fill(null), lo = new Array(arr.length).fill(null);
    for (let i = n - 1; i < arr.length; i++) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (arr[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n); // 모집단 표준편차
      up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd;
    }
    return { mid, up, lo };
  }
  function atrValue(data, period) {
    let s = 0, cnt = 0;
    for (let i = 1; i < data.c.length && cnt < period; i++, cnt++) {
      s += Math.max(data.h[i] - data.l[i], Math.abs(data.h[i] - data.c[i - 1]), Math.abs(data.l[i] - data.c[i - 1]));
    }
    return cnt ? s / cnt : 0;
  }

  /* ---------- 렌코 (종가 기준) ---------- */
  function renkoSize(data, rk) {
    const mode = rk.mode || 'pct';
    let size;
    if (mode === 'fixed') size = num(rk.value, 0);
    else if (mode === 'atr') size = atrValue(data, Math.max(2, num(rk.period, 14))) * num(rk.value, 1);
    else size = data.c[0] * (num(rk.value, 2) / 100);
    return size > 0 ? size : data.c[0] * 0.02;
  }
  function buildRenko(data, rk) {
    const n = data.c.length;
    const size = renkoSize(data, rk || {});
    const bricks = [];
    const flipUp = new Array(n).fill(false), flipDn = new Array(n).fill(false), newUp = new Array(n).fill(false), runUp = new Array(n).fill(0);
    let dir = 0, open = data.c[0], close = data.c[0], run = 0;
    for (let i = 1; i < n; i++) {
      const c = data.c[i];
      let guard = 0;
      while (guard++ < 1000) {
        if (dir === 0) {
          if (c >= close + size) { bricks.push({ dir: 1, o: close, c: close + size, i }); open = close; close = close + size; dir = 1; run = 1; newUp[i] = true; }
          else if (c <= close - size) { bricks.push({ dir: -1, o: close, c: close - size, i }); open = close; close = close - size; dir = -1; run = 1; }
          else break;
        } else if (dir === 1) {
          if (c >= close + size) { bricks.push({ dir: 1, o: close, c: close + size, i }); open = close; close += size; run++; newUp[i] = true; }
          else if (c <= open - size) { bricks.push({ dir: -1, o: open, c: open - size, i }); close = open - size; dir = -1; run = 1; flipDn[i] = true; }
          else break;
        } else {
          if (c <= close - size) { bricks.push({ dir: -1, o: close, c: close - size, i }); open = close; close -= size; run++; }
          else if (c >= open + size) { bricks.push({ dir: 1, o: open, c: open + size, i }); close = open + size; dir = 1; run = 1; flipUp[i] = true; newUp[i] = true; }
          else break;
        }
      }
      runUp[i] = dir === 1 ? run : 0;
    }
    return { size, bricks, flipUp, flipDn, newUp, runUp };
  }

  /* ---------- 조건 정의 ---------- */
  // use: 'both' = 매수/매도 모두, 'entry' = 매수 전용, 'exit' = 매도 전용
  // 매도 목록에 넣은 일반 조건은 "보유 순번 전량 매도" 신호가 됩니다.
  const MA_OPTS = [['sma', '단순(SMA)'], ['ema', '지수(EMA)']];
  const FLOW_WHO = [['frgn', '외국인'], ['inst', '기관'], ['indiv', '개인'], ['both', '외국인+기관 모두']];
  const COND_DEFS = {
    vol: { use: 'both', group: '거래량', label: '거래량 N주 이상', params: [{ k: 'n', label: '거래량(주)', def: 1000000 }] },
    volPrev: { use: 'both', group: '거래량', label: '거래량이 전일보다 높음(x배 초과)', params: [{ k: 'x', label: '배수 (1 = 어제보다 높음)', def: 1 }] },
    volRatio: { use: 'both', group: '거래량', label: '거래량이 최근 평균의 x배 이상', params: [{ k: 'n', label: '평균 기간(일)', def: 20 }, { k: 'x', label: '배수', def: 2 }] },
    maCross: { use: 'both', group: '이동평균', label: '이동평균 교차', params: [{ k: 'ma', label: '종류', def: 'sma', opts: MA_OPTS }, { k: 's', label: '단기', def: 5 }, { k: 'l', label: '장기', def: 20 }, { k: 'dir', label: '방향', def: 'up', opts: [['up', '골든크로스(상향 돌파)'], ['down', '데드크로스(하향 이탈)']] }] },
    maState: { use: 'both', group: '이동평균', label: '이동평균 단기선·장기선 위치(상태)', params: [{ k: 'ma', label: '종류', def: 'sma', opts: MA_OPTS }, { k: 's', label: '단기', def: 5 }, { k: 'l', label: '장기', def: 20 }, { k: 'dir', label: '조건', def: 'above', opts: [['above', '단기선이 위'], ['below', '단기선이 아래']] }] },
    priceMa: { use: 'both', group: '이동평균', label: '종가와 이동평균 위치', params: [{ k: 'ma', label: '종류', def: 'sma', opts: MA_OPTS }, { k: 'n', label: '기간', def: 20 }, { k: 'dir', label: '조건', def: 'above', opts: [['above', '종가가 위'], ['below', '종가가 아래']] }] },
    bb: { use: 'both', group: '지표', label: '볼린저밴드 터치', params: [{ k: 'n', label: '기간', def: 20 }, { k: 'k', label: '배수', def: 2 }, { k: 'band', label: '밴드', def: 'lower', opts: [['lower', '하단'], ['upper', '상단']] }, { k: 'basis', label: '기준', def: 'close', opts: [['close', '종가'], ['extreme', '장중 저가/고가']] }] },
    rsi: { use: 'both', group: '지표', label: 'RSI', params: [{ k: 'n', label: '기간', def: 14 }, { k: 'op', label: '조건', def: 'lte', opts: [['lte', '이하'], ['gte', '이상']] }, { k: 'v', label: '값', def: 30 }] },
    macd: { use: 'both', group: '지표', label: 'MACD 시그널 교차', params: [{ k: 's', label: '단기', def: 12 }, { k: 'l', label: '장기', def: 26 }, { k: 'sig', label: '시그널', def: 9 }, { k: 'dir', label: '방향', def: 'up', opts: [['up', '상향 돌파'], ['down', '하향 이탈']] }] },
    breakout: { use: 'both', group: '지표', label: 'N일 신고가/신저가', params: [{ k: 'n', label: '기간(일)', def: 20 }, { k: 'dir', label: '방향', def: 'high', opts: [['high', '신고가 돌파'], ['low', '신저가 이탈']] }] },
    change: { use: 'both', group: '지표', label: '전일 대비 등락률', params: [{ k: 'op', label: '조건', def: 'lte', opts: [['lte', '이하'], ['gte', '이상']] }, { k: 'v', label: '등락률 %', def: -3 }] },
    renkoFlip: { use: 'both', group: '렌코', label: '렌코 반전 벽돌', params: [{ k: 'dir', label: '방향', def: 'up', opts: [['up', '하락→상승'], ['down', '상승→하락']] }] },
    renkoRun: { use: 'both', group: '렌코', label: '렌코 상승 벽돌 N개 연속', params: [{ k: 'n', label: '연속 개수', def: 3 }] },
    flow: { use: 'both', group: '수급', label: '투자자 수급(순매수/순매도)', params: [
      { k: 'who', label: '투자자', def: 'frgn', opts: FLOW_WHO },
      { k: 'dir', label: '방향', def: 'buy', opts: [['buy', '순매수'], ['sell', '순매도']] },
      { k: 'mode', label: '방식', def: 'day', opts: [['day', '당일 N주 이상'], ['streak', 'N일 연속'], ['sum', '최근 N일 누적 합이 값 이상'], ['ratio', '당일 순매수/거래량 %']] },
      { k: 'n', label: '일수(연속·누적)', def: 3 }, { k: 'v', label: '기준값(수급 데이터 단위: 주 또는 원, 비율은 %)', def: 100000 }] },
    dropLast: { use: 'entry', group: '분할매수', dyn: true, label: '보유 매수가 대비 N% 하락 시 추가 매수', params: [{ k: 'pct', label: '하락률 %', def: 10 }, { k: 'basis', label: '기준', def: 'last', opts: [['last', '직전 매수가'], ['avg', '전체 평단'], ['low', '가장 낮은 매수가']] }, { k: 'first', label: '보유 순번이 없으면', def: 'yes', opts: [['yes', '첫 매수로 진입'], ['no', '진입 안 함']] }] },
    tp: { use: 'exit', group: '청산', dyn: true, label: '순번별 목표수익 % 도달 시 그 순번 매도', params: [{ k: 'pct', label: '수익률 %', def: 10 }] },
    sl: { use: 'exit', group: '청산', dyn: true, label: '순번별 손절 % 도달 시 그 순번 매도', params: [{ k: 'pct', label: '손실률 %', def: 10 }] },
    trail: { use: 'exit', group: '청산', dyn: true, label: '순번별 고점 대비 N% 하락(트레일링 스탑)', params: [{ k: 'pct', label: '하락률 %', def: 8 }] },
    holdDays: { use: 'exit', group: '청산', dyn: true, label: '순번별 N일 보유 후 매도', params: [{ k: 'n', label: '보유일(거래일)', def: 20 }] },
    avgPct: { use: 'exit', group: '청산', dyn: true, label: '전체 평단 대비 ±N% 도달 시 전량 매도', params: [{ k: 'dir', label: '방향', def: 'up', opts: [['up', '수익(+)'], ['down', '손절(-)']] }, { k: 'pct', label: '%', def: 10 }] },
  };
  const isDyn = (c) => !!(COND_DEFS[c.type] && COND_DEFS[c.type].dyn);

  function lookback(arr, i, n, fn) { // arr[i-n..i-1] 에 대해 fn 적용
    if (i < n) return null;
    let r = arr[i - n];
    for (let j = i - n + 1; j < i; j++) r = fn(r, arr[j]);
    return r;
  }

  function evalCond(data, cond, ctx) {
    const n = data.c.length;
    const out = new Array(n).fill(false);
    const p = cond;
    switch (cond.type) {
      case 'vol': { const t = num(p.n); for (let i = 0; i < n; i++) out[i] = data.v[i] >= t; break; }
      case 'volPrev': { const x = num(p.x, 1); for (let i = 1; i < n; i++) out[i] = data.v[i - 1] > 0 && data.v[i] > x * data.v[i - 1]; break; } // 어제 거래량보다 x배를 넘음
      case 'volRatio': {
        const k = Math.max(1, Math.floor(num(p.n, 20))), x = num(p.x, 2);
        const avg = sma(data.v, k);
        for (let i = k; i < n; i++) out[i] = avg[i - 1] > 0 && data.v[i] >= x * avg[i - 1];
        break;
      }
      case 'maCross': {
        const s = maOf(p.ma, data.c, num(p.s, 5)), l = maOf(p.ma, data.c, num(p.l, 20));
        for (let i = 1; i < n; i++) {
          if (s[i] == null || l[i] == null || s[i - 1] == null || l[i - 1] == null) continue;
          out[i] = p.dir === 'down' ? s[i] < l[i] && s[i - 1] >= l[i - 1] : s[i] > l[i] && s[i - 1] <= l[i - 1];
        }
        break;
      }
      case 'maState': {
        const s = maOf(p.ma, data.c, num(p.s, 5)), l = maOf(p.ma, data.c, num(p.l, 20));
        for (let i = 0; i < n; i++) out[i] = s[i] != null && l[i] != null && (p.dir === 'below' ? s[i] < l[i] : s[i] > l[i]);
        break;
      }
      case 'priceMa': {
        const m = maOf(p.ma, data.c, num(p.n, 20));
        for (let i = 0; i < n; i++) out[i] = m[i] != null && (p.dir === 'below' ? data.c[i] < m[i] : data.c[i] > m[i]);
        break;
      }
      case 'bb': {
        const b = bollinger(data.c, num(p.n, 20), num(p.k, 2));
        if (p.band === 'upper') { const src = p.basis === 'extreme' ? data.h : data.c; for (let i = 0; i < n; i++) out[i] = b.up[i] != null && src[i] >= b.up[i]; }
        else { const src = p.basis === 'extreme' ? data.l : data.c; for (let i = 0; i < n; i++) out[i] = b.lo[i] != null && src[i] <= b.lo[i]; }
        break;
      }
      case 'rsi': {
        const r = rsi(data.c, Math.max(2, Math.floor(num(p.n, 14)))), v = num(p.v, 30);
        for (let i = 0; i < n; i++) out[i] = r[i] != null && (p.op === 'gte' ? r[i] >= v : r[i] <= v);
        break;
      }
      case 'macd': {
        const m = macd(data.c, num(p.s, 12), num(p.l, 26), num(p.sig, 9));
        for (let i = 1; i < n; i++) {
          if (m.line[i] == null || m.signal[i] == null || m.line[i - 1] == null || m.signal[i - 1] == null) continue;
          out[i] = p.dir === 'down' ? m.line[i] < m.signal[i] && m.line[i - 1] >= m.signal[i - 1] : m.line[i] > m.signal[i] && m.line[i - 1] <= m.signal[i - 1];
        }
        break;
      }
      case 'breakout': {
        const k = Math.max(2, Math.floor(num(p.n, 20)));
        for (let i = k; i < n; i++) {
          if (p.dir === 'low') out[i] = data.c[i] < lookback(data.l, i, k, Math.min);
          else out[i] = data.c[i] > lookback(data.h, i, k, Math.max);
        }
        break;
      }
      case 'change': {
        const v = num(p.v, -3);
        for (let i = 1; i < n; i++) { const ch = (data.c[i] / data.c[i - 1] - 1) * 100; out[i] = p.op === 'gte' ? ch >= v : ch <= v; }
        break;
      }
      case 'renkoFlip': { const r = ctx.renko(); for (let i = 0; i < n; i++) out[i] = p.dir === 'down' ? r.flipDn[i] : r.flipUp[i]; break; }
      case 'renkoRun': { const r = ctx.renko(); const t = num(p.n, 3); for (let i = 0; i < n; i++) out[i] = r.newUp[i] && r.runUp[i] >= t; break; }
      case 'flow': {
        const who = p.who === 'both' ? ['frgn', 'inst'] : [p.who];
        const sell = p.dir === 'sell';
        const k = Math.max(1, Math.floor(num(p.n, 3))), v = num(p.v, 0);
        const per = who.map((w) => {
          const x = data[w];
          const o = new Array(n).fill(false);
          if (!x) return o;
          for (let i = 0; i < n; i++) {
            if (x[i] == null) continue;
            if (p.mode === 'day') o[i] = sell ? x[i] <= -v : x[i] >= v;
            else if (p.mode === 'ratio') { const base = data.flowUnit === 'krw' ? data.v[i] * data.c[i] : data.v[i]; o[i] = base > 0 && (sell ? (x[i] / base) * 100 <= -v : (x[i] / base) * 100 >= v); }
            else if (p.mode === 'streak') {
              if (i < k - 1) continue;
              let ok = true;
              for (let j = i - k + 1; j <= i; j++) if (x[j] == null || (sell ? x[j] >= 0 : x[j] <= 0)) { ok = false; break; }
              o[i] = ok;
            } else if (p.mode === 'sum') {
              if (i < k - 1) continue;
              let s = 0, ok = true;
              for (let j = i - k + 1; j <= i; j++) { if (x[j] == null) { ok = false; break; } s += x[j]; }
              o[i] = ok && (sell ? s <= -v : s >= v);
            }
          }
          return o;
        });
        for (let i = 0; i < n; i++) out[i] = per.every((a) => a[i]);
        break;
      }
      default: break;
    }
    return out;
  }
  function combine(sigs, mode, n) {
    const out = new Array(n).fill(false);
    if (!sigs.length) return out;
    for (let i = 0; i < n; i++) out[i] = mode === 'OR' ? sigs.some((s) => s[i]) : sigs.every((s) => s[i]);
    return out;
  }

  function needsFlow(cfg) { return [].concat(cfg.entries.conds, cfg.exits.conds).some((c) => c.type === 'flow'); }

  /* ---------- 엔진 ---------- */
  function runBacktest(data, cfg, settings) {
    const n = data.c.length;
    const rates = SM.ratesOf(settings, cfg.market || 'KR');
    let renkoCache = null;
    const ctx = { renko: () => (renkoCache = renkoCache || buildRenko(data, cfg.renko || {})) };
    const entryConds = (cfg.entries.conds || []).filter((c) => COND_DEFS[c.type] && COND_DEFS[c.type].use !== 'exit');
    const exitConds = (cfg.exits.conds || []).filter((c) => COND_DEFS[c.type] && COND_DEFS[c.type].use !== 'entry');
    const errors = [];
    const allConds = entryConds.concat(exitConds);
    if (!data.hasVol && allConds.some((c) => ['vol', 'volRatio'].includes(c.type) || (c.type === 'flow' && ['ratio'].includes(c.mode)))) errors.push('거래량 데이터가 없어 거래량 조건을 쓸 수 없습니다.');
    for (const c of allConds) {
      if (c.type === 'flow') {
        const who = c.who === 'both' ? ['frgn', 'inst'] : [c.who];
        for (const w of who) if (!data[w]) errors.push(`${{ frgn: '외국인', inst: '기관', indiv: '개인' }[w]} 수급 데이터가 없습니다. 선택한 데이터에 수급이 합쳐져 있지 않습니다. 시뮬레이션 › 1. 데이터 불러오기에서 “자동 수집 시세·수급 불러오기” 또는 수급 파일로 먼저 합치세요.`);
      }
    }
    if (!entryConds.length) errors.push('매수 조건을 1개 이상 추가하세요.');
    if (errors.length) return { error: [...new Set(errors)].join(' ') };

    const entryArr = entryConds.map((c) => (isDyn(c) ? null : evalCond(data, c, ctx)));
    const exitStaticConds = exitConds.filter((c) => !isDyn(c));
    const exitSig = combine(exitStaticConds.map((c) => evalCond(data, c, ctx)), cfg.exits.mode === 'AND' ? 'AND' : 'OR', n);
    const dyn = (t) => exitConds.filter((c) => c.type === t);
    const tpC = dyn('tp'), slC = dyn('sl'), trC = dyn('trail'), hdC = dyn('holdDays'), apC = dyn('avgPct');

    const from = cfg.from || data.d[0], to = cfg.to || data.d[n - 1];
    const fillClose = cfg.fill === 'close';
    const qtyCfg = num(cfg.qty, 1);
    const growth = num(cfg.growth, 1) > 0 ? num(cfg.growth, 1) : 1;
    const maxInvest = num(cfg.maxInvest, 0);
    const maxLots = Math.floor(num(cfg.maxLots, 0));

    const open = [], trades = [], buys = [], sells = [], equity = [];
    let pending = [], lotNo = 0, realized = 0, feesTotal = 0, peakInvested = 0, firstBuyIdx = -1, skipped = 0;
    let startIdx = -1, endIdx = -1;
    const cycles = []; let cyc = null; // 사이클 = 첫 매수 ~ 보유 순번이 모두 팔릴 때까지(물타기 전략이 ‘언제 본전·이익이 되는지’ 보기 위함)

    const invested = () => open.reduce((a, l) => a + l.qty * l.price + l.fee, 0);
    function buyQty(price) {
      const g = Math.pow(growth, open.length);
      if (cfg.qtyMode === 'amount') return Math.floor((qtyCfg * g) / price);
      return Math.max(1, Math.round(qtyCfg * g));
    }
    function execBuy(i, price) {
      const qty = buyQty(price);
      if (!(qty > 0)) return;
      const fee = qty * price * (rates.buyFee / 100);
      if (maxInvest > 0 && invested() + qty * price + fee > maxInvest) { skipped++; return; }
      open.push({ no: ++lotNo, idx: i, date: data.d[i], price, qty, fee, peak: price });
      feesTotal += fee;
      const seq = (cyc ? cyc.lots : 0) + 1;
      buys.push({ i, price, qty, cyc: cycles.length + 1, seq }); // cyc: 사이클 번호, seq: 그 사이클의 몇 번째 매수
      if (firstBuyIdx < 0) firstBuyIdx = i;
      peakInvested = Math.max(peakInvested, invested());
      if (!cyc) cyc = { no: cycles.length + 1, buys: [], startIdx: i, startDate: data.d[i], lots: 0, maxLots: 0, peakInv: 0, qty: 0, realized: 0, worst: 0, firstPrice: price, lowPrice: price };
      cyc.lots++; cyc.qty += qty; cyc.maxLots = Math.max(cyc.maxLots, open.length); cyc.peakInv = Math.max(cyc.peakInv, invested()); cyc.lowPrice = Math.min(cyc.lowPrice, price);
      { const q = open.reduce((a, l) => a + l.qty, 0), cost = open.reduce((a, l) => a + l.qty * l.price, 0); // 이 매수 직후의 보유 수량·평단(수수료 제외)
        cyc.buys.push({ lot: lotNo, i, date: data.d[i], seq, price, qty, cumQty: q, cost: invested(), avg: cost / q, close: data.c[i] }); }
    }
    function execSell(lot, i, price, reason) {
      const k = open.indexOf(lot);
      if (k < 0) return;
      open.splice(k, 1);
      const proceeds = lot.qty * price;
      const sf = proceeds * (rates.sellFee / 100), tx = proceeds * (rates.sellTax / 100);
      const pnl = proceeds - sf - tx - lot.qty * lot.price - lot.fee;
      feesTotal += sf + tx;
      realized += pnl;
      trades.push({ no: lot.no, buyDate: lot.date, buyPrice: lot.price, sellDate: data.d[i], sellPrice: price, qty: lot.qty, fee: lot.fee + sf + tx, pnl, ret: pnl / (lot.qty * lot.price + lot.fee), days: SM.daysBetween(lot.date, data.d[i]), reason });
      sells.push({ i, price, qty: lot.qty });
      if (cyc) {
        cyc.realized += pnl;
        if (!open.length) { cyc.endIdx = i; cyc.endDate = data.d[i]; cyc.days = SM.daysBetween(cyc.startDate, data.d[i]); cyc.sellPrice = price; cyc.sellQty = cyc.qty; cyc.ret = cyc.peakInv > 0 ? cyc.realized / cyc.peakInv : null; cycles.push(cyc); cyc = null; }
      }
    }
    function entryDyn(c, i) {
      const cl = data.c[i];
      if (!open.length) return c.first !== 'no';
      let ref;
      if (c.basis === 'avg') { const q = open.reduce((a, l) => a + l.qty, 0); ref = open.reduce((a, l) => a + l.qty * l.price, 0) / q; }
      else if (c.basis === 'low') ref = Math.min(...open.map((l) => l.price));
      else ref = open[open.length - 1].price;
      return cl <= ref * (1 - num(c.pct, 10) / 100);
    }

    for (let i = 0; i < n; i++) {
      const d = data.d[i];
      const inP = d >= from && d <= to;
      if (d > to) break;
      if (!fillClose && pending.length) {
        const orders = pending; pending = [];
        for (const o of orders) { if (o.t === 'buy') execBuy(i, data.o[i]); else execSell(o.lot, i, data.o[i], o.why); }
      }
      if (!inP) continue;
      if (startIdx < 0) startIdx = i;
      endIdx = i;
      const c = data.c[i];
      for (const l of open) if (c > l.peak) l.peak = c;
      const sellOrders = [];
      let sellAll = false, allWhy = '신호 청산';
      if (open.length) {
        if (exitSig[i] && exitStaticConds.length) sellAll = true;
        if (!sellAll && apC.length) {
          const q = open.reduce((a, l) => a + l.qty, 0), avg = open.reduce((a, l) => a + l.qty * l.price, 0) / q;
          for (const a of apC) {
            const pc = num(a.pct, 10) / 100;
            if (a.dir === 'down' ? c <= avg * (1 - pc) : c >= avg * (1 + pc)) { sellAll = true; allWhy = a.dir === 'down' ? '평단 손절' : '평단 목표'; break; }
          }
        }
        if (sellAll) open.forEach((l) => sellOrders.push({ t: 'sell', lot: l, why: allWhy }));
        else {
          for (const l of open) {
            const ret = c / l.price - 1;
            let why = null;
            if (tpC.some((x) => ret >= num(x.pct) / 100)) why = '목표수익';
            else if (slC.some((x) => ret <= -num(x.pct) / 100)) why = '손절';
            else if (trC.some((x) => l.idx < i && c <= l.peak * (1 - num(x.pct) / 100))) why = '트레일링';
            else if (hdC.some((x) => i - l.idx >= num(x.n))) why = '보유기간';
            if (why) sellOrders.push({ t: 'sell', lot: l, why });
          }
        }
      }
      const pendBuys = pending.filter((o) => o.t === 'buy').length;
      const flags = entryConds.map((cd, k) => (entryArr[k] ? entryArr[k][i] : entryDyn(cd, i)));
      const sig = (cfg.entries.mode === 'OR' ? flags.some(Boolean) : flags.every(Boolean));
      const canBuy = sig && !sellAll && (maxLots <= 0 || open.length - sellOrders.length + pendBuys < maxLots);
      const orders = sellOrders.slice();
      if (canBuy) orders.push({ t: 'buy' });
      if (fillClose) { for (const o of orders) { if (o.t === 'buy') execBuy(i, c); else execSell(o.lot, i, c, o.why); } }
      else if (i < n - 1 && data.d[i + 1] <= to) pending.push(...orders);
      let unrl = 0;
      for (const l of open) unrl += (c - l.price) * l.qty - l.fee;
      equity.push({ i, d, v: realized + unrl });
      if (cyc) cyc.worst = Math.min(cyc.worst, cyc.realized + unrl);
    }
    if (startIdx < 0) return { error: '선택한 기간에 데이터가 없습니다.' };
    const lastC = data.c[endIdx];
    let unrl = 0, openQty = 0;
    for (const l of open) { unrl += (lastC - l.price) * l.qty - l.fee; openQty += l.qty; }
    const total = realized + unrl;
    let peak = -Infinity, mdd = 0, minEq = 0;
    for (const e of equity) { peak = Math.max(peak, e.v); mdd = Math.min(mdd, e.v - peak); minEq = Math.min(minEq, e.v); }
    let bh = null;
    if (peakInvested > 0) {
      const bi = firstBuyIdx >= 0 ? firstBuyIdx : startIdx;
      const p0 = fillClose ? data.c[bi] : data.o[bi];
      const sh = peakInvested / (p0 * (1 + rates.buyFee / 100));
      const pnl = sh * (lastC * (1 - (rates.sellFee + rates.sellTax) / 100) - p0 * (1 + rates.buyFee / 100));
      bh = { pnl, ret: pnl / peakInvested, startDate: data.d[bi] };
    }
    const wins = trades.filter((t) => t.pnl > 0).length;
    let openCycle = null;
    if (cyc) openCycle = Object.assign({}, cyc, { open: true, endDate: data.d[endIdx], days: SM.daysBetween(cyc.startDate, data.d[endIdx]), unrealized: unrl, lastPrice: lastC, ret: cyc.peakInv > 0 ? (cyc.realized + unrl) / cyc.peakInv : null });
    const cd = cycles.map((x) => x.days), avg = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : null), mx = (a) => (a.length ? Math.max(...a) : null);
    const dist = {}; for (const x of cycles) dist[x.lots] = (dist[x.lots] || 0) + 1; // 몇 번 매수하고 청산됐는지의 분포
    const cycleStats = { count: cycles.length, avgDays: cd.length ? cd.reduce((a, b) => a + b, 0) / cd.length : null, maxDays: cd.length ? Math.max(...cd) : null, minDays: cd.length ? Math.min(...cd) : null, maxLots: Math.max(0, ...cycles.map((x) => x.maxLots), openCycle ? openCycle.maxLots : 0), maxInvest: Math.max(0, ...cycles.map((x) => x.peakInv), openCycle ? openCycle.peakInv : 0), worst: Math.min(0, ...cycles.map((x) => x.worst), openCycle ? openCycle.worst : 0), wins: cycles.filter((x) => x.realized > 0).length, avgLots: avg(cycles.map((x) => x.lots)), avgInvest: avg(cycles.map((x) => x.peakInv)), avgQty: avg(cycles.map((x) => x.qty)), maxQty: mx(cycles.map((x) => x.qty)), maxLotsDone: mx(cycles.map((x) => x.lots)), maxInvestDone: mx(cycles.map((x) => x.peakInv)), dist };
    return {
      cycles, openCycle, cycleStats, cfg, trades, buys, sells, equity, startIdx, endIdx, renko: renkoCache,
      summary: {
        buyCount: buys.length, closed: trades.length, open: open.length, openQty, wins,
        winRate: trades.length ? wins / trades.length : null,
        realized, unrealized: unrl, total, peakInvested, retOnPeak: peakInvested > 0 ? total / peakInvested : null,
        mdd, minEq, fees: feesTotal, bh, skipped,
        avgDays: trades.length ? trades.reduce((a, t) => a + t.days, 0) / trades.length : null,
      },
    };
  }

  // 기간 분할 검증: 앞 기간(설정용)과 뒤 기간(검증용)을 각각 돌립니다.
  function runSplitValidation(data, cfg, settings, splitDate) {
    const from = cfg.from || data.d[0], to = cfg.to || data.d[data.d.length - 1];
    const a = runBacktest(data, Object.assign({}, cfg, { from, to: splitDate }), settings);
    const next = data.d.find((d) => d > splitDate);
    const b = next ? runBacktest(data, Object.assign({}, cfg, { from: next, to }), settings) : { error: '분할일 이후 데이터가 없습니다.' };
    return { a, b, splitDate };
  }

  // 차트에 겹쳐 그릴 선 목록
  function overlayLines(data, cfg) {
    const palette = ['#2563eb', '#d97706', '#9333ea', '#0891b2', '#be185d', '#65a30d'];
    const lines = [], seen = new Set();
    let pi = 0;
    for (const c of [].concat(cfg.entries.conds, cfg.exits.conds)) {
      if (c.type === 'maCross' || c.type === 'maState') {
        for (const k of [num(c.s, 5), num(c.l, 20)]) { const key = (c.ma || 'sma') + k; if (seen.has(key)) continue; seen.add(key); lines.push({ name: (c.ma === 'ema' ? 'EMA' : 'MA') + k, arr: maOf(c.ma, data.c, k), color: palette[pi++ % palette.length] }); }
      } else if (c.type === 'priceMa') {
        const k = num(c.n, 20), key = (c.ma || 'sma') + k;
        if (!seen.has(key)) { seen.add(key); lines.push({ name: (c.ma === 'ema' ? 'EMA' : 'MA') + k, arr: maOf(c.ma, data.c, k), color: palette[pi++ % palette.length] }); }
      } else if (c.type === 'bb') {
        const key = `bb${c.n}_${c.k}`; if (seen.has(key)) continue; seen.add(key);
        const b = bollinger(data.c, num(c.n, 20), num(c.k, 2));
        lines.push({ name: 'BB상단', arr: b.up, color: '#64748b', dash: [4, 3] }, { name: '', arr: b.mid, color: '#94a3b8', dash: [2, 3] }, { name: 'BB하단', arr: b.lo, color: '#64748b', dash: [4, 3] });
      }
    }
    return lines;
  }

  // 날짜의 종가(그 날이 휴장이면 직전 거래일, 7일 넘게 비면 null)
  function closeOn(data, date, maxGapDays) {
    let lo = 0, hi = data.d.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (data.d[mid] <= date) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    if (idx < 0) return null;
    if (SM.daysBetween(data.d[idx], date) > (maxGapDays == null ? 7 : maxGapDays)) return null;
    return { price: data.c[idx], date: data.d[idx], exact: data.d[idx] === date, idx };
  }
  // 같은 투입금을 fromDate 다음 거래일 시가(없으면 종가)에 한 번에 사서 끝까지 보유했을 때
  function buyHoldFrom(data, fromDate, invest, settings, market, toDate) {
    const rates = SM.ratesOf(settings, market || 'KR');
    const i0 = data.d.findIndex((d) => d >= fromDate);
    if (i0 < 0 || !(invest > 0)) return null;
    let i1 = data.d.length - 1;
    if (toDate) { const k = data.d.findIndex((d) => d > toDate); if (k >= 0) i1 = k - 1; }
    if (i1 < i0) return null;
    const p0 = data.o[i0] || data.c[i0], last = data.c[i1];
    const sh = invest / (p0 * (1 + rates.buyFee / 100));
    const pnl = sh * (last * (1 - (rates.sellFee + rates.sellTax) / 100) - p0 * (1 + rates.buyFee / 100));
    return { pnl, ret: pnl / invest, startDate: data.d[i0], endDate: data.d[i1], p0, last };
  }

  function blankCfg() {
    return { market: 'KR', qty: 10, qtyMode: 'shares', growth: 1, maxInvest: 0, maxLots: 0, fill: 'nextOpen', from: '', to: '', renko: { mode: 'pct', value: 2, period: 14 }, entries: { mode: 'AND', conds: [] }, exits: { mode: 'OR', conds: [] } };
  }

  // 재생용: 기준 날짜(date)까지 일어난 일만 보이도록 사이클을 잘라 줍니다(그 뒤의 매수·매도는 숨김, 아직 안 끝난 사이클은 진행 중으로)
  function cyclesAsOf(cycles, date) {
    return (cycles || []).filter((c) => c.startDate <= date).map((c) => (c.endDate && !c.open && c.endDate <= date ? c : Object.assign({}, c, { buys: (c.buys || []).filter((b) => b.date <= date), open: true, endDate: date, ret: null, sellPrice: null })));
  }
  // 재생용: 기준 날짜 시점의 보유 상태(보유 수량·평단·투입금·평가손익·실현손익·오늘 일어난 매수/매도)
  function replayState(r, data, date) {
    let t = -1; for (let i = 0; i < data.d.length && data.d[i] <= date; i++) t = i;
    if (t < 0) return null;
    const lots = r.buys.map((b, k) => ({ no: k + 1, date: data.d[b.i], price: b.price, qty: b.qty, cyc: b.cyc, seq: b.seq })).filter((l) => l.date <= date);
    const done = new Set(r.trades.filter((x) => x.sellDate <= date).map((x) => x.no)), open = lots.filter((l) => !done.has(l.no));
    const qty = open.reduce((a, l) => a + l.qty, 0), cost = open.reduce((a, l) => a + l.qty * l.price, 0), close = data.c[t], avg = qty ? cost / qty : null;
    const realized = r.trades.filter((x) => x.sellDate <= date).reduce((a, x) => a + x.pnl, 0), unrealized = qty ? (close - avg) * qty : 0;
    const today = [].concat(lots.filter((l) => l.date === data.d[t]).map((l) => ({ t: 'buy', label: SM.cycleLabel ? SM.cycleLabel(l.cyc, l.seq) : `${l.cyc}-${l.seq}`, price: l.price, qty: l.qty })), r.trades.filter((x) => x.sellDate === data.d[t]).map((x) => ({ t: 'sell', no: x.no, price: x.sellPrice, qty: x.qty, pnl: x.pnl })));
    return { date: data.d[t], idx: t, close, qty, cost, avg, buyCount: open.length, cyc: open.length ? open[open.length - 1].cyc : null, unrealized, realized, total: realized + unrealized, today, cyclesDone: (r.cycles || []).filter((c) => c.endDate <= date).length };
  }
  Object.assign(SM, { cyclesAsOf, replayState });
  Object.assign(SM, { dataInfo, detectFlowUnit, parseOHLCV, parseTable, guessFlowCols, mergeFlow, parseDate, splitTable, guessCols, kindOf, analyzeTable, buildDataset, mergeDatasets, sameStockScore, sma, ema, rsi, macd, bollinger, buildRenko, COND_DEFS, runBacktest, runSplitValidation, overlayLines, blankCfg, closeOn, buyHoldFrom, needsFlow });
  if (typeof module !== 'undefined' && module.exports) module.exports = SM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
