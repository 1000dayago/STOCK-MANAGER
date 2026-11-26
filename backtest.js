/* backtest.js - 데이터 불러오기(CSV/수급), 지표, 렌코, 백테스트 엔진 (DOM 없음) */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});
  const num = (v, d = 0) => SM.num(v, d);

  /* ---------- CSV 파싱 ---------- */
  const ALIAS = {
    date: ['date', '날짜', '일자', '일시', '거래일', '기준일', 'time', 'datetime'],
    open: ['open', '시가'],
    high: ['high', '고가'],
    low: ['low', '저가'],
    close: ['close', '종가', '현재가', '종가(원)', 'close/last'],
    adj: ['adj close', 'adj_close', 'adjclose', '수정종가', '수정주가'],
    volume: ['volume', '거래량', '거래량(주)', 'vol'],
  };
  const norm = (s) => String(s || '').replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

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
  function detectDelim(first) {
    if (first.split('\t').length > 2) return '\t';
    const sc = first.split(';').length, cm = first.split(',').length;
    if (cm > 2 || sc > 2) return sc > cm ? ';' : ',';
    return ' ';
  }

  function parseDate(s) {
    s = String(s || '').trim().replace(/"/g, '');
    let m = s.match(/^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
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

  function parseOHLCV(text, opt = {}) {
    const warnings = [];
    const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) return { error: '데이터가 비어 있습니다.' };
    const first = lines[0];
    const delim = detectDelim(first);
    const header = splitLine(first, delim).map(norm);
    const find = (names) => header.findIndex((h) => names.includes(h));
    const idx = {};
    for (const k of Object.keys(ALIAS)) idx[k] = find(ALIAS[k]);
    if (idx.date < 0 || idx.close < 0) {
      return { error: '날짜/종가 열을 찾지 못했습니다. 첫 줄에 "날짜,시가,고가,저가,종가,거래량" 같은 제목이 있어야 합니다. (인식한 제목: ' + header.join(' | ') + ')' };
    }
    const useAdj = opt.useAdj !== false && idx.adj >= 0;
    const rows = [];
    let bad = 0;
    for (let i = 1; i < lines.length; i++) {
      const c = splitLine(lines[i], delim);
      const d = parseDate(c[idx.date]);
      const close = toNum(c[idx.close]);
      if (!d || !isFinite(close)) { bad++; continue; }
      const o = idx.open >= 0 ? toNum(c[idx.open]) : close;
      const h = idx.high >= 0 ? toNum(c[idx.high]) : close;
      const l = idx.low >= 0 ? toNum(c[idx.low]) : close;
      const v = idx.volume >= 0 ? toNum(c[idx.volume]) : NaN;
      let r = { d, o: isFinite(o) ? o : close, h: isFinite(h) ? h : close, l: isFinite(l) ? l : close, c: close, v: isFinite(v) ? v : 0 };
      if (useAdj) {
        const a = toNum(c[idx.adj]);
        if (isFinite(a) && a > 0 && close > 0) {
          const f = a / close;
          r = { d, o: r.o * f, h: r.h * f, l: r.l * f, c: a, v: r.v };
        }
      }
      rows.push(r);
    }
    rows.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    const uniq = [];
    let dup = 0;
    for (const r of rows) {
      if (uniq.length && uniq[uniq.length - 1].d === r.d) { dup++; uniq[uniq.length - 1] = r; } else uniq.push(r);
    }
    if (uniq.length < 5) return { error: '유효한 데이터가 너무 적습니다 (' + uniq.length + '행).' };
    if (bad) warnings.push(`${bad}행은 날짜/가격을 읽지 못해 건너뛰었습니다.`);
    if (dup) warnings.push(`중복 날짜 ${dup}건은 마지막 값만 사용했습니다.`);
    if (idx.high < 0 || idx.low < 0) warnings.push('고가/저가 열이 없어 종가로 대체했습니다. (볼린저 "저가/고가 기준" 터치는 종가 기준으로 계산됩니다)');
    if (idx.open < 0) warnings.push('시가 열이 없어 종가로 대체했습니다. ("다음날 시가 체결"은 종가로 계산됩니다)');
    if (idx.volume < 0) warnings.push('거래량 열이 없습니다. 거래량 조건은 사용할 수 없습니다.');
    else if (uniq.every((r) => r.v === 0)) warnings.push('거래량이 모두 0입니다. 거래량 열을 확인하세요.');
    if (idx.adj >= 0 && useAdj) warnings.push('수정종가(Adj Close) 열이 있어 시/고/저/종가를 수정주가 기준으로 보정했습니다.');
    else if (idx.adj < 0) warnings.push('수정종가 열이 없습니다. 액면분할·배당이 있었다면 가격이 왜곡될 수 있습니다.');
    for (let i = 1; i < uniq.length; i++) {
      const ch = uniq[i].c / uniq[i - 1].c - 1;
      if (Math.abs(ch) > 0.4) { warnings.push(`${uniq[i].d} 종가가 전일 대비 ${(ch * 100).toFixed(0)}% 변동했습니다. 액면분할 등으로 수정되지 않은 가격인지 확인하세요.`); break; }
    }
    const data = {
      d: uniq.map((r) => r.d), o: uniq.map((r) => r.o), h: uniq.map((r) => r.h),
      l: uniq.map((r) => r.l), c: uniq.map((r) => r.c), v: uniq.map((r) => r.v),
      hasVol: idx.volume >= 0, hasHL: idx.high >= 0 && idx.low >= 0,
    };
    return { data, warnings, count: uniq.length };
  }

  /* ---------- 수급(외국인/기관/개인 순매수) 불러오기 ---------- */
  // 형식을 모르는 표도 받을 수 있게: 표로 읽은 뒤 사용자가 열을 지정합니다.
  function parseTable(text, headerLine) {
    const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    const hl = Math.max(1, Math.floor(num(headerLine, 1)));
    if (lines.length < hl + 1) return { error: '데이터가 비어 있거나 제목 줄 번호가 너무 큽니다.' };
    const delim = detectDelim(lines[hl - 1]);
    const header = splitLine(lines[hl - 1], delim).map((h) => String(h).trim());
    const rows = lines.slice(hl).map((l) => splitLine(l, delim));
    return { header, rows, delim };
  }
  function guessFlowCols(header) {
    const h = header.map(norm);
    const pick = (fn) => h.findIndex(fn);
    return {
      date: pick((x) => ALIAS.date.includes(x) || x.includes('날짜') || x.includes('일자')),
      frgn: pick((x) => (x.includes('외국인') || x.includes('foreign')) && !x.includes('보유') && !x.includes('지분') && !x.includes('비율') && !x.includes('한도')),
      inst: pick((x) => (x.includes('기관') || x.includes('institution')) && !x.includes('보유') && !x.includes('비율')),
      indiv: pick((x) => x.includes('개인') || x.includes('individual') || x.includes('retail')),
    };
  }
  function mergeFlow(data, table, cols) {
    const n = data.d.length;
    const idxOfDate = new Map(data.d.map((d, i) => [d, i]));
    const arrs = { frgn: cols.frgn >= 0 ? new Array(n).fill(null) : null, inst: cols.inst >= 0 ? new Array(n).fill(null) : null, indiv: cols.indiv >= 0 ? new Array(n).fill(null) : null };
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
        const v = toNum(r[cols[k]]);
        if (isFinite(v)) { arrs[k][i] = v; ok = true; }
      }
      if (ok && !seen.has(i)) { seen.add(i); matched++; }
    }
    if (!matched) return { error: '가격 데이터와 날짜가 하나도 맞지 않습니다. 날짜 열과 기간을 확인하세요.' };
    return { arrs, matched, unmatched, missing: n - matched };
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
      { k: 'n', label: '일수(연속·누적)', def: 3 }, { k: 'v', label: '기준값(주 또는 %)', def: 100000 }] },
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
            else if (p.mode === 'ratio') o[i] = data.v[i] > 0 && (sell ? (x[i] / data.v[i]) * 100 <= -v : (x[i] / data.v[i]) * 100 >= v);
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
        for (const w of who) if (!data[w]) errors.push(`${{ frgn: '외국인', inst: '기관', indiv: '개인' }[w]} 수급 데이터가 없습니다. 백테스트 화면에서 수급 데이터를 먼저 불러오세요.`);
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
      buys.push({ i, price, qty });
      if (firstBuyIdx < 0) firstBuyIdx = i;
      peakInvested = Math.max(peakInvested, invested());
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
    return {
      cfg, trades, buys, sells, equity, startIdx, endIdx, renko: renkoCache,
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

  function blankCfg() {
    return { market: 'KR', qty: 10, qtyMode: 'shares', growth: 1, maxInvest: 0, maxLots: 0, fill: 'nextOpen', from: '', to: '', renko: { mode: 'pct', value: 2, period: 14 }, entries: { mode: 'AND', conds: [] }, exits: { mode: 'OR', conds: [] } };
  }

  Object.assign(SM, { parseOHLCV, parseTable, guessFlowCols, mergeFlow, parseDate, sma, ema, rsi, macd, bollinger, buildRenko, COND_DEFS, runBacktest, runSplitValidation, overlayLines, blankCfg, needsFlow });
  if (typeof module !== 'undefined' && module.exports) module.exports = SM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
