/* backtest.js - 데이터 불러오기(CSV), 지표, 렌코, 백테스트 엔진 (DOM 없음) */
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
    s = String(s === undefined ? '' : s).replace(/[",\s%원$]/g, '');
    if (s === '' || s === '-') return NaN;
    return parseFloat(s);
  };

  function parseOHLCV(text, opt = {}) {
    const warnings = [];
    const lines = String(text).replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
    if (lines.length < 2) return { error: '데이터가 비어 있습니다.' };
    const first = lines[0];
    const delim = first.split('\t').length > 2 ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
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
      let close = toNum(c[idx.close]);
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
    if (idx.high < 0 || idx.low < 0) warnings.push('고가/저가 열이 없어 종가로 대체했습니다. (볼린저 "저가 기준" 터치는 종가 기준으로 계산됩니다)');
    if (idx.open < 0) warnings.push('시가 열이 없어 종가로 대체했습니다. ("다음날 시가 체결"은 종가로 계산됩니다)');
    if (idx.volume < 0) warnings.push('거래량 열이 없습니다. 거래량 조건은 사용할 수 없습니다.');
    else if (uniq.every((r) => r.v === 0)) warnings.push('거래량이 모두 0입니다. 거래량 열을 확인하세요.');
    if (idx.adj >= 0 && useAdj) warnings.push('수정종가(Adj Close) 열이 있어 시/고/저/종가를 수정주가 기준으로 보정했습니다.');
    else if (idx.adj < 0) warnings.push('수정종가 열이 없습니다. 액면분할·배당이 있었다면 가격이 왜곡될 수 있습니다.');
    // 급변(액면분할 의심) 감지
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
    const size = renkoSize(data, rk);
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
          else if (c <= open - size) { bricks.push({ dir: -1, o: open, c: open - size, i }); const o2 = open; open = o2; close = o2 - size; open = o2; dir = -1; run = 1; flipDn[i] = true; }
          else break;
        } else {
          if (c <= close - size) { bricks.push({ dir: -1, o: close, c: close - size, i }); open = close; close -= size; run++; }
          else if (c >= open + size) { bricks.push({ dir: 1, o: open, c: open + size, i }); const o2 = open; close = o2 + size; open = o2; dir = 1; run = 1; flipUp[i] = true; newUp[i] = true; }
          else break;
        }
      }
      runUp[i] = dir === 1 ? run : 0;
    }
    return { size, bricks, flipUp, flipDn, newUp, runUp };
  }

  /* ---------- 조건 정의 ---------- */
  const COND_DEFS = {
    // 매수/매도 공통 목록. kind: 'entry' | 'exit'
    vol: { kind: 'entry', label: '거래량 N주 이상', params: [{ k: 'n', label: '거래량(주)', def: 1000000 }] },
    maCross: { kind: 'entry', label: '이동평균 골든크로스 (단기선이 장기선을 상향 돌파)', params: [{ k: 's', label: '단기', def: 5 }, { k: 'l', label: '장기', def: 20 }] },
    maAbove: { kind: 'entry', label: '이동평균 단기선 > 장기선 (상태)', params: [{ k: 's', label: '단기', def: 5 }, { k: 'l', label: '장기', def: 20 }] },
    bbTouch: { kind: 'entry', label: '볼린저밴드 하단 터치', params: [{ k: 'n', label: '기간', def: 20 }, { k: 'k', label: '배수', def: 2 }, { k: 'basis', label: '기준', def: 'close', opts: [['close', '종가가 하단 이하'], ['low', '저가가 하단 이하']] }] },
    renkoUp: { kind: 'entry', label: '렌코 하락→상승 반전 벽돌', params: [] },
    renkoRun: { kind: 'entry', label: '렌코 상승 벽돌 N개 연속', params: [{ k: 'n', label: '연속 개수', def: 3 }] },
    maCrossDn: { kind: 'exit', label: '이동평균 데드크로스 → 전량 매도', params: [{ k: 's', label: '단기', def: 5 }, { k: 'l', label: '장기', def: 20 }] },
    bbUpper: { kind: 'exit', label: '볼린저밴드 상단 터치 → 전량 매도', params: [{ k: 'n', label: '기간', def: 20 }, { k: 'k', label: '배수', def: 2 }, { k: 'basis', label: '기준', def: 'close', opts: [['close', '종가가 상단 이상'], ['high', '고가가 상단 이상']] }] },
    renkoDn: { kind: 'exit', label: '렌코 상승→하락 반전 벽돌 → 전량 매도', params: [] },
    tp: { kind: 'exit', label: '순번별 목표수익 % 도달 시 매도', params: [{ k: 'pct', label: '수익률 %', def: 10 }] },
    sl: { kind: 'exit', label: '순번별 손절 % 도달 시 매도', params: [{ k: 'pct', label: '손실률 %', def: 10 }] },
    holdDays: { kind: 'exit', label: '순번별 N일 보유 후 매도', params: [{ k: 'n', label: '보유일(거래일)', def: 20 }] },
  };

  function evalCond(data, cond, ctx) {
    const n = data.c.length;
    const out = new Array(n).fill(false);
    const p = cond;
    switch (cond.type) {
      case 'vol': { const t = num(p.n); for (let i = 0; i < n; i++) out[i] = data.v[i] >= t; break; }
      case 'maCross': case 'maCrossDn': {
        const s = sma(data.c, num(p.s, 5)), l = sma(data.c, num(p.l, 20));
        for (let i = 1; i < n; i++) {
          if (s[i] == null || l[i] == null || s[i - 1] == null || l[i - 1] == null) continue;
          out[i] = cond.type === 'maCross' ? s[i] > l[i] && s[i - 1] <= l[i - 1] : s[i] < l[i] && s[i - 1] >= l[i - 1];
        }
        break;
      }
      case 'maAbove': {
        const s = sma(data.c, num(p.s, 5)), l = sma(data.c, num(p.l, 20));
        for (let i = 0; i < n; i++) out[i] = s[i] != null && l[i] != null && s[i] > l[i];
        break;
      }
      case 'bbTouch': {
        const b = bollinger(data.c, num(p.n, 20), num(p.k, 2));
        const src = p.basis === 'low' ? data.l : data.c;
        for (let i = 0; i < n; i++) out[i] = b.lo[i] != null && src[i] <= b.lo[i];
        break;
      }
      case 'bbUpper': {
        const b = bollinger(data.c, num(p.n, 20), num(p.k, 2));
        const src = p.basis === 'high' ? data.h : data.c;
        for (let i = 0; i < n; i++) out[i] = b.up[i] != null && src[i] >= b.up[i];
        break;
      }
      case 'renkoUp': { const r = ctx.renko(); for (let i = 0; i < n; i++) out[i] = r.flipUp[i]; break; }
      case 'renkoDn': { const r = ctx.renko(); for (let i = 0; i < n; i++) out[i] = r.flipDn[i]; break; }
      case 'renkoRun': { const r = ctx.renko(); const t = num(p.n, 3); for (let i = 0; i < n; i++) out[i] = r.newUp[i] && r.runUp[i] >= t; break; }
      default: break;
    }
    return out;
  }
  function combine(sigs, mode, n) {
    if (!sigs.length) return new Array(n).fill(false);
    const out = new Array(n).fill(mode === 'AND');
    for (const s of sigs) for (let i = 0; i < n; i++) out[i] = mode === 'AND' ? out[i] && s[i] : out[i] || s[i];
    return out;
  }

  /* ---------- 엔진 ---------- */
  function runBacktest(data, cfg, settings) {
    const n = data.c.length;
    const rates = SM.ratesOf(settings, cfg.market || 'KR');
    let renkoCache = null;
    const ctx = { renko: () => (renkoCache = renkoCache || buildRenko(data, cfg.renko || {})) };
    const entryConds = (cfg.entries.conds || []).filter((c) => COND_DEFS[c.type] && COND_DEFS[c.type].kind === 'entry');
    const exitConds = (cfg.exits.conds || []).filter((c) => COND_DEFS[c.type] && COND_DEFS[c.type].kind === 'exit');
    const errors = [];
    if (!data.hasVol && entryConds.some((c) => c.type === 'vol')) errors.push('거래량 데이터가 없어 거래량 조건을 쓸 수 없습니다.');
    if (!entryConds.length) errors.push('매수 조건을 1개 이상 추가하세요.');
    if (errors.length) return { error: errors.join(' ') };

    const entrySig = combine(entryConds.map((c) => evalCond(data, c, ctx)), cfg.entries.mode || 'AND', n);
    const sellAllConds = exitConds.filter((c) => ['maCrossDn', 'bbUpper', 'renkoDn'].includes(c.type));
    const exitSig = combine(sellAllConds.map((c) => evalCond(data, c, ctx)), 'OR', n);
    const tp = exitConds.find((c) => c.type === 'tp');
    const sl = exitConds.find((c) => c.type === 'sl');
    const hd = exitConds.find((c) => c.type === 'holdDays');

    const from = cfg.from || data.d[0], to = cfg.to || data.d[n - 1];
    const fillClose = cfg.fill === 'close';
    const qtyCfg = num(cfg.qty, 1);
    const maxLots = Math.floor(num(cfg.maxLots, 0));

    const open = [], trades = [], buys = [], sells = [], equity = [];
    let pending = [], lotNo = 0, realized = 0, feesTotal = 0, peakInvested = 0, firstBuyIdx = -1;
    let startIdx = -1, endIdx = -1;

    function invested() { return open.reduce((a, l) => a + l.qty * l.price + l.fee, 0); }
    function execBuy(i, price) {
      const qty = cfg.qtyMode === 'amount' ? Math.floor(qtyCfg / price) : qtyCfg;
      if (!(qty > 0)) return;
      const fee = qty * price * (rates.buyFee / 100);
      open.push({ no: ++lotNo, idx: i, date: data.d[i], price, qty, fee });
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
      const sellOrders = [];
      let sellAll = false;
      if (exitSig[i] && open.length) { sellAll = true; open.forEach((l) => sellOrders.push({ t: 'sell', lot: l, why: '신호 청산' })); }
      else {
        for (const l of open) {
          const ret = c / l.price - 1;
          if (tp && ret >= num(tp.pct) / 100) sellOrders.push({ t: 'sell', lot: l, why: '목표수익' });
          else if (sl && ret <= -num(sl.pct) / 100) sellOrders.push({ t: 'sell', lot: l, why: '손절' });
          else if (hd && i - l.idx >= num(hd.n)) sellOrders.push({ t: 'sell', lot: l, why: '보유기간' });
        }
      }
      const pendBuys = pending.filter((o) => o.t === 'buy').length;
      const canBuy = entrySig[i] && !sellAll && (maxLots <= 0 || open.length - sellOrders.length + pendBuys < maxLots);
      const orders = sellOrders.slice();
      if (canBuy) orders.push({ t: 'buy' });
      if (fillClose) { for (const o of orders) { if (o.t === 'buy') execBuy(i, c); else execSell(o.lot, i, c, o.why); } }
      else if (i < n - 1 && data.d[i + 1] <= to) pending.push(...orders);
      // 평가
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
    // 단순 보유 비교: 전략의 최대 투입금과 같은 금액을 첫 매수일(없으면 첫날)에 한 번에 매수
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
      cfg, trades, buys, sells, equity, startIdx, endIdx,
      renko: renkoCache,
      summary: {
        buyCount: buys.length, closed: trades.length, open: open.length, openQty, wins,
        winRate: trades.length ? wins / trades.length : null,
        realized, unrealized: unrl, total, peakInvested, retOnPeak: peakInvested > 0 ? total / peakInvested : null,
        mdd, minEq, fees: feesTotal, bh,
        avgDays: trades.length ? trades.reduce((a, t) => a + t.days, 0) / trades.length : null,
      },
    };
  }

  /* ---------- 프리셋 ---------- */
  function presets() {
    const base = { market: 'KR', qty: 10, qtyMode: 'shares', maxLots: 0, fill: 'nextOpen', renko: { mode: 'pct', value: 2, period: 14 } };
    return {
      volume: { name: '거래량 급증 매수', cfg: Object.assign({}, base, { entries: { mode: 'AND', conds: [{ type: 'vol', n: 1000000 }] }, exits: { conds: [] } }) },
      ma: { name: '5/20 이동평균 교차', cfg: Object.assign({}, base, { entries: { mode: 'AND', conds: [{ type: 'maCross', s: 5, l: 20 }] }, exits: { conds: [{ type: 'maCrossDn', s: 5, l: 20 }] } }) },
      bb: { name: '볼린저 하단 터치', cfg: Object.assign({}, base, { entries: { mode: 'AND', conds: [{ type: 'bbTouch', n: 20, k: 2, basis: 'close' }] }, exits: { conds: [{ type: 'bbUpper', n: 20, k: 2, basis: 'close' }] } }) },
      renko: { name: '렌코 반전', cfg: Object.assign({}, base, { entries: { mode: 'AND', conds: [{ type: 'renkoUp' }] }, exits: { conds: [{ type: 'renkoDn' }] } }) },
    };
  }

  Object.assign(SM, { parseOHLCV, sma, bollinger, buildRenko, COND_DEFS, runBacktest, backtestPresets: presets, parseDate });
  if (typeof module !== 'undefined' && module.exports) module.exports = SM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
