/* core.js - 계산 로직 (DOM 없음). 브라우저/Node 양쪽에서 동작 */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});

  const DEFAULT_SETTINGS = () => ({
    // 요율은 % 단위. 기본값은 예시일 뿐이며 증권사/시기에 따라 다릅니다. 설정에서 직접 확인·수정하세요.
    kr: { buyFee: 0.015, sellFee: 0.015, sellTax: 0.18 },
    us: { buyFee: 0.25, sellFee: 0.25, sellTax: 0, taxRate: 22, deduction: 2500000 },
    fxNow: 1400,
    upColor: 'red',
    linkMode: 'tab', // 링크 열기: 'tab'(새 창) | 'browser'(기본 브라우저, 안드로이드) | 'app'(앱 안에서 보기)
    linkTabHosts: [], // 앱 안에서 열리지 않아 새 창으로 고정한 사이트
    // {code}, {name} 자리표시자는 종목 정보로 바뀝니다. 설정에서 수정/추가할 수 있습니다.
    links: [
      { id: 'naver', label: '네이버 금융', url: 'https://finance.naver.com/item/main.naver?code={code}', market: 'KR' },
      { id: 'news', label: '뉴스 검색', url: 'https://search.naver.com/search.naver?where=news&query={name}', market: 'ALL' },
      { id: 'dart', label: '전자공시(DART)', url: 'https://dart.fss.or.kr/dsab007/main.do?textCrpNm={name}', market: 'KR' },
      { id: 'yahoo', label: '야후 파이낸스', url: 'https://finance.yahoo.com/quote/{code}', market: 'US' },
      { id: 'google', label: '구글 검색(실적)', url: 'https://www.google.com/search?q={name}+실적+발표', market: 'ALL' },
    ],
  });

  const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const num = (v, d = 0) => {
    if (v === null || v === undefined || v === '') return d;
    const x = parseFloat(String(v).replace(/,/g, ''));
    return isFinite(x) ? x : d;
  };
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;

  function fmtNum(v, dp = 0) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    return Number(v).toLocaleString('ko-KR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function fmtMoney(v, cur) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    if (cur === 'USD') return (v < 0 ? '-' : '') + '$' + fmtNum(Math.abs(v), 2);
    return fmtNum(Math.round(v)) + '원';
  }
  function fmtPct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '-';
    return (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%';
  }
  const curOf = (stock) => (stock.market === 'US' ? 'USD' : 'KRW');
  const ratesOf = (settings, market) => settings[market === 'US' ? 'us' : 'kr'];

  /* ---------- 상태 ---------- */
  function newState() {
    return { v: 2, updatedAt: 0, settings: DEFAULT_SETTINGS(), stocks: [], strategies: [], noteIdx: {}, lastBackupAt: 0 };
  }
  function normalizeState(obj) {
    const s = newState();
    if (!obj || typeof obj !== 'object') return s;
    s.updatedAt = obj.updatedAt || 0;
    const d = DEFAULT_SETTINGS();
    const o = obj.settings || {};
    s.settings = {
      kr: Object.assign(d.kr, o.kr || {}),
      us: Object.assign(d.us, o.us || {}),
      fxNow: o.fxNow || d.fxNow,
      upColor: o.upColor || d.upColor,
      linkMode: ['app', 'browser'].includes(o.linkMode) ? o.linkMode : 'tab',
      linkTabHosts: Array.isArray(o.linkTabHosts) ? o.linkTabHosts.filter((h) => typeof h === 'string') : [],
      links: Array.isArray(o.links) ? o.links : d.links,
    };
    s.strategies = Array.isArray(obj.strategies) ? obj.strategies : [];
    s.noteIdx = obj.noteIdx && typeof obj.noteIdx === 'object' ? obj.noteIdx : {};
    s.lastBackupAt = obj.lastBackupAt || 0;
    s.stocks = (obj.stocks || []).map((st) =>
      Object.assign({ id: uid(), name: '', code: '', market: 'KR', price: null, priceAt: null, lots: [], sales: [], nextNo: 1, events: [], splits: [], watch: false, target: null, watchAt: 0, collect: false, paper: null, plan: [] }, st)
    );
    s.stocks.forEach((st) => {
      const maxNo = st.lots.reduce((m, l) => Math.max(m, l.no || 0), 0);
      if (st.nextNo <= maxNo) st.nextNo = maxNo + 1;
      st.paper = Object.assign({ lots: [], sales: [], nextNo: 1, fee: true }, st.paper && typeof st.paper === 'object' ? st.paper : {});
      const pmax = st.paper.lots.reduce((m, l) => Math.max(m, l.no || 0), 0);
      if (st.paper.nextNo <= pmax) st.paper.nextNo = pmax + 1;
      if (!Array.isArray(st.plan)) st.plan = [];
    });
    return s;
  }
  function newStock({ name, code, market, watch }) {
    return { id: uid(), name: name || '', code: code || '', market: market === 'US' ? 'US' : 'KR', price: null, priceAt: null, lots: [], sales: [], nextNo: 1, events: [], splits: [], watch: !!watch, target: null, watchAt: watch ? Date.now() : 0, collect: false, paper: { lots: [], sales: [], nextNo: 1, fee: true }, plan: [] };
  }

  /* ---------- 순번(lot) ---------- */
  function lotSold(stock, lotId) {
    let q = 0;
    for (const s of stock.sales) for (const ln of s.lines) if (ln.lotId === lotId) q += ln.qty;
    return r6(q);
  }
  const lotRem = (stock, lot) => r6(lot.qty - lotSold(stock, lot.id));
  const lotFeePerShare = (lot) => (lot.qty > 0 ? lot.fee / lot.qty : 0);

  function autoBuyFee(settings, market, qty, price) {
    return qty * price * (ratesOf(settings, market).buyFee / 100);
  }

  function addLot(stock, f, settings) {
    const qty = num(f.qty), price = num(f.price);
    if (!(qty > 0) || !(price > 0)) throw new Error('수량과 매수가는 0보다 커야 합니다.');
    const fee = isBlank(f.fee) ? autoBuyFee(settings, stock.market, qty, price) : num(f.fee);
    const lot = {
      id: uid(), no: stock.nextNo++, date: f.date || todayStr(), qty, price,
      fx: stock.market === 'US' ? num(f.fx, settings.fxNow) : 1, fee, note: f.note || '',
    };
    stock.lots.push(lot);
    return lot;
  }

  function updateLot(stock, lotId, f, settings) {
    const lot = stock.lots.find((l) => l.id === lotId);
    if (!lot) throw new Error('순번을 찾을 수 없습니다.');
    const qty = num(f.qty), price = num(f.price);
    if (!(qty > 0) || !(price > 0)) throw new Error('수량과 매수가는 0보다 커야 합니다.');
    const sold = lotSold(stock, lotId);
    if (qty < sold) throw new Error(`이미 ${sold}주가 매도되어 수량을 그보다 적게 할 수 없습니다.`);
    lot.date = f.date || lot.date;
    lot.qty = qty;
    lot.price = price;
    lot.fx = stock.market === 'US' ? num(f.fx, lot.fx) : 1;
    lot.fee = isBlank(f.fee) ? autoBuyFee(settings, stock.market, qty, price) : num(f.fee);
    lot.note = f.note || '';
    if (lot.parts) delete lot.parts; // 수정하면 병합 해제(복원) 불가
    return lot;
  }

  function deleteLot(stock, lotId) {
    if (lotSold(stock, lotId) > 0) throw new Error('매도 기록이 있는 순번입니다. 먼저 해당 매도 기록을 삭제하세요.');
    stock.lots = stock.lots.filter((l) => l.id !== lotId);
  }

  function mergeLots(stock, ids) {
    const lots = ids.map((id) => stock.lots.find((l) => l.id === id)).filter(Boolean);
    if (lots.length < 2) throw new Error('병합하려면 순번을 2개 이상 선택하세요.');
    for (const l of lots) if (lotSold(stock, l.id) > 0) throw new Error(`${l.no}번은 일부 매도된 순번이라 병합할 수 없습니다.`);
    const qty = lots.reduce((a, l) => a + l.qty, 0);
    const amt = lots.reduce((a, l) => a + l.qty * l.price, 0);
    const price = amt / qty;
    const amtFx = lots.reduce((a, l) => a + l.qty * l.price * (l.fx || 1), 0);
    const fx = stock.market === 'US' ? amtFx / amt : 1;
    const merged = {
      id: uid(), no: stock.nextNo++, date: lots.map((l) => l.date).sort()[0], qty, price, fx,
      fee: lots.reduce((a, l) => a + l.fee, 0), note: '병합: ' + lots.map((l) => l.no + '번').join('+'),
      parts: lots.map((l) => JSON.parse(JSON.stringify(l))),
    };
    stock.lots = stock.lots.filter((l) => !ids.includes(l.id));
    stock.lots.push(merged);
    return merged;
  }

  function unmergeLot(stock, lotId) {
    const lot = stock.lots.find((l) => l.id === lotId);
    if (!lot || !lot.parts) throw new Error('병합을 되돌릴 수 없는 순번입니다.');
    if (lotSold(stock, lotId) > 0) throw new Error('매도 기록이 있어 되돌릴 수 없습니다.');
    stock.lots = stock.lots.filter((l) => l.id !== lotId);
    for (const p of lot.parts) stock.lots.push(p);
    stock.lots.sort((a, b) => a.no - b.no);
  }

  function splitLot(stock, lotId, splitQty) {
    const lot = stock.lots.find((l) => l.id === lotId);
    if (!lot) throw new Error('순번을 찾을 수 없습니다.');
    if (lotSold(stock, lotId) > 0) throw new Error('일부 매도된 순번은 분할할 수 없습니다.');
    const q = num(splitQty);
    if (!(q > 0) || q >= lot.qty) throw new Error('분할 수량은 0보다 크고 전체 수량보다 작아야 합니다.');
    const feePart = lot.fee * (q / lot.qty);
    lot.fee -= feePart;
    lot.qty = r6(lot.qty - q);
    delete lot.parts;
    const nl = { id: uid(), no: stock.nextNo++, date: lot.date, qty: q, price: lot.price, fx: lot.fx, fee: feePart, note: `분할: ${lot.no}번에서` };
    stock.lots.push(nl);
    return nl;
  }

  /* ---------- 요약/평단 ---------- */
  function stockSummary(stock, settings) {
    let qty = 0, cost = 0, costNoFee = 0, costKRW = 0;
    for (const lot of stock.lots) {
      const rem = lotRem(stock, lot);
      if (rem <= 0) continue;
      const perShare = lot.price + lotFeePerShare(lot);
      qty += rem;
      costNoFee += rem * lot.price;
      cost += rem * perShare;
      costKRW += rem * perShare * (lot.fx || 1);
    }
    const out = { qty, cost, costKRW, costNoFee };
    out.avg = qty > 0 ? costNoFee / qty : null; // 수수료 제외 평단
    out.avgInclFee = qty > 0 ? cost / qty : null;
    out.avgKRW = qty > 0 ? costKRW / qty : null;
    const price = stock.price;
    if (price && qty > 0) {
      out.value = price * qty;
      out.unrl = out.value - cost;
      out.unrlRet = cost > 0 ? out.unrl / cost : null;
      const fx = stock.market === 'US' ? settings.fxNow : 1;
      out.valueKRW = out.value * fx;
      out.unrlKRW = out.valueKRW - costKRW;
      out.unrlRetKRW = costKRW > 0 ? out.unrlKRW / costKRW : null;
    }
    return out;
  }

  function lotView(stock, lot, settings) {
    const rem = lotRem(stock, lot);
    const perShare = lot.price + lotFeePerShare(lot);
    const v = { rem, sold: r6(lot.qty - rem), perShare };
    const price = stock.price;
    if (price && rem > 0) {
      v.ret = (price - perShare) / perShare;
      v.unrl = (price - perShare) * rem;
      if (stock.market === 'US') {
        const costK = perShare * (lot.fx || 1);
        v.retKRW = (price * settings.fxNow - costK) / costK;
        v.unrlKRW = (price * settings.fxNow - costK) * rem;
      } else {
        v.retKRW = v.ret;
        v.unrlKRW = v.unrl;
      }
    }
    return v;
  }

  /* ---------- 매도 계산 ---------- */
  function computeSale(stock, lines, p, settings) {
    const m = stock.market;
    const rates = ratesOf(settings, m);
    const fx = m === 'US' ? num(p.fx, settings.fxNow) : 1;
    const price = num(p.price);
    const items = [];
    let totalQty = 0;
    for (const ln of lines) {
      const lot = stock.lots.find((l) => l.id === ln.lotId);
      const q = num(ln.qty);
      if (!lot || !(q > 0)) continue;
      items.push({ lot, q });
      totalQty += q;
    }
    const proceeds = totalQty * price;
    const sellFee = isBlank(p.sellFee) ? proceeds * (rates.sellFee / 100) : num(p.sellFee);
    const tax = isBlank(p.tax) ? proceeds * (rates.sellTax / 100) : num(p.tax);
    const out = { lines: [], fx, price, date: p.date || todayStr(), totalQty, proceeds, sellFee, tax };
    let costLocal = 0, pnlLocal = 0, costKRW = 0, pnlKRW = 0, feesKRW = 0, buyFeeKRW = 0;
    for (const { lot, q } of items) {
      const share = totalQty > 0 ? q / totalQty : 0;
      const sf = sellFee * share, tx = tax * share;
      const buyFee = q * lotFeePerShare(lot);
      const cL = q * lot.price + buyFee;
      const netL = q * price - sf - tx;
      const pL = netL - cL;
      const cK = cL * (lot.fx || 1);
      const pK = netL * fx - cK;
      costLocal += cL; pnlLocal += pL; costKRW += cK; pnlKRW += pK;
      feesKRW += (sf + tx) * fx + buyFee * (lot.fx || 1);
      buyFeeKRW += buyFee * (lot.fx || 1);
      out.lines.push({
        lotId: lot.id, lotNo: lot.no, qty: q, lotPrice: lot.price, lotFx: lot.fx || 1, buyFee,
        sellFee: sf, tax: tx, costLocal: cL, pnlLocal: pL, costKRW: cK, pnlKRW: pK,
        retLocal: cL > 0 ? pL / cL : null, retKRW: cK > 0 ? pK / cK : null,
        days: daysBetween(lot.date, out.date),
      });
    }
    out.costLocal = costLocal; out.pnlLocal = pnlLocal; out.costKRW = costKRW; out.pnlKRW = pnlKRW;
    out.feesKRW = feesKRW; out.buyFeeKRW = buyFeeKRW;
    out.proceedsKRW = (proceeds - sellFee - tax) * fx;
    out.retLocal = costLocal > 0 ? pnlLocal / costLocal : null;
    out.retKRW = costKRW > 0 ? pnlKRW / costKRW : null;
    return out;
  }

  // N주를 어떤 방식으로 나눠 팔지 (lotId -> qty)
  function allocate(stock, total, strat) {
    const lots = stock.lots.map((l) => ({ l, rem: lotRem(stock, l) })).filter((x) => x.rem > 0);
    const sumRem = lots.reduce((a, x) => a + x.rem, 0);
    let left = Math.min(num(total), sumRem);
    const res = {};
    if (strat === 'pro') {
      const raw = lots.map((x) => ({ x, v: (left * x.rem) / sumRem }));
      raw.forEach((r) => { r.f = Math.floor(r.v); r.frac = r.v - r.f; });
      let rest = left - raw.reduce((a, r) => a + r.f, 0);
      [...raw].sort((a, b) => b.frac - a.frac).forEach((r) => {
        if (rest >= 1 && r.f < r.x.rem) { r.f += 1; rest -= 1; }
      });
      raw.forEach((r) => { if (r.f > 0) res[r.x.l.id] = r.f; });
      return res;
    }
    const sorters = {
      fifo: (a, b) => (a.l.date < b.l.date ? -1 : a.l.date > b.l.date ? 1 : a.l.no - b.l.no),
      high: (a, b) => b.l.price * (b.l.fx || 1) - a.l.price * (a.l.fx || 1),
      low: (a, b) => a.l.price * (a.l.fx || 1) - b.l.price * (b.l.fx || 1),
    };
    lots.sort(sorters[strat] || sorters.fifo);
    for (const x of lots) {
      if (left <= 0) break;
      const q = Math.min(x.rem, left);
      res[x.l.id] = q;
      left -= q;
    }
    return res;
  }

  function remainingAfter(stock, lines) {
    const sel = {};
    lines.forEach((l) => (sel[l.lotId] = (sel[l.lotId] || 0) + num(l.qty)));
    let qty = 0, amt = 0, amtFee = 0;
    for (const lot of stock.lots) {
      const rem = lotRem(stock, lot) - (sel[lot.id] || 0);
      if (rem <= 0) continue;
      qty += rem; amt += rem * lot.price; amtFee += rem * (lot.price + lotFeePerShare(lot));
    }
    return { qty, avg: qty > 0 ? amt / qty : null, avgInclFee: qty > 0 ? amtFee / qty : null };
  }

  function recordSale(stock, calc) {
    const sale = {
      id: uid(), date: calc.date, price: calc.price, fx: calc.fx, qty: calc.totalQty,
      sellFee: calc.sellFee, tax: calc.tax, lines: calc.lines,
      proceedsLocal: calc.proceeds, proceedsKRW: calc.proceedsKRW, costKRW: calc.costKRW,
      feesKRW: calc.feesKRW, pnlLocal: calc.pnlLocal, pnlKRW: calc.pnlKRW,
    };
    stock.sales.push(sale);
    stock.sales.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return sale;
  }

  /* ---------- 손익 리포트 ---------- */
  function pnlReport(state, opt) {
    const { from, to, stockId, group } = opt;
    const map = new Map();
    const rows = [];
    for (const st of state.stocks) {
      if (stockId && stockId !== 'all' && st.id !== stockId) continue;
      for (const sale of st.sales) {
        if (from && sale.date < from) continue;
        if (to && sale.date > to) continue;
        rows.push({ st, sale });
        let key;
        if (group === 'month') key = sale.date.slice(0, 7);
        else if (group === 'year') key = sale.date.slice(0, 4);
        else if (group === 'stock') key = st.name;
        else key = '전체 기간';
        if (!map.has(key)) map.set(key, { key, count: 0, proceedsKRW: 0, costKRW: 0, feesKRW: 0, pnlKRW: 0, wins: 0 });
        const g = map.get(key);
        g.count += 1; g.proceedsKRW += sale.proceedsKRW; g.costKRW += sale.costKRW;
        g.feesKRW += sale.feesKRW; g.pnlKRW += sale.pnlKRW; if (sale.pnlKRW > 0) g.wins += 1;
      }
    }
    const groups = [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
    groups.forEach((g) => (g.ret = g.costKRW > 0 ? g.pnlKRW / g.costKRW : null));
    const total = groups.reduce((t, g) => {
      t.count += g.count; t.proceedsKRW += g.proceedsKRW; t.costKRW += g.costKRW; t.feesKRW += g.feesKRW; t.pnlKRW += g.pnlKRW; t.wins += g.wins;
      return t;
    }, { count: 0, proceedsKRW: 0, costKRW: 0, feesKRW: 0, pnlKRW: 0, wins: 0 });
    total.ret = total.costKRW > 0 ? total.pnlKRW / total.costKRW : null;
    // 해외주식 연도별 양도세 추정 (단순 추정: 연간 해외 실현손익 - 공제)
    const usYear = {};
    for (const st of state.stocks) {
      if (st.market !== 'US') continue;
      if (stockId && stockId !== 'all' && st.id !== stockId) continue;
      for (const sale of st.sales) {
        if (from && sale.date < from) continue;
        if (to && sale.date > to) continue;
        const y = sale.date.slice(0, 4);
        usYear[y] = (usYear[y] || 0) + sale.pnlKRW;
      }
    }
    const us = state.settings.us;
    const usTax = Object.keys(usYear).sort().map((y) => {
      const taxable = Math.max(0, usYear[y] - us.deduction);
      return { year: y, pnlKRW: usYear[y], taxable, tax: taxable * (us.taxRate / 100), remainDeduction: Math.max(0, us.deduction - Math.max(0, usYear[y])) };
    });
    return { groups, total, rows, usTax };
  }


  /* ---------- 매수 입력 미리보기 (저장 전) ---------- */
  // 금액으로 입력했을 때 살 수 있는 수량 (국내: 정수 주 내림, 해외: 소수 4자리 내림)
  function qtyForAmount(stock, amount, price, settings, feeInput) {
    const a = num(amount), p = num(price);
    if (!(a > 0) || !(p > 0)) return { qty: 0, used: 0, rest: a > 0 ? a : 0 };
    const rate = ratesOf(settings, stock.market).buyFee / 100;
    let q = isBlank(feeInput) ? a / (p * (1 + rate)) : (a - num(feeInput)) / p;
    q = stock.market === 'US' ? Math.floor(q * 1e4 + 1e-9) / 1e4 : Math.floor(q + 1e-9);
    q = Math.max(0, q);
    const fee = isBlank(feeInput) ? q * p * rate : num(feeInput);
    const used = q * p + (q > 0 ? fee : 0);
    return { qty: q, used, rest: a - used };
  }
  // f: {price, qty, fee, fx, date}. editLotId 가 있으면 그 순번을 f 값으로 바꾼 경우와 비교합니다.
  function lotPreview(stock, f, settings, editLotId, today) {
    const out = { ok: false, warnings: [], errors: [] };
    const us = stock.market === 'US';
    const price = num(f.price), qty = num(f.qty);
    if (!(price > 0) || !(qty > 0)) { out.msg = '매수가와 수량을 입력하면 평단가 미리보기가 나타납니다.'; return out; }
    const rates = ratesOf(settings, stock.market);
    const fx = us ? num(f.fx, settings.fxNow) : 1;
    const fee = isBlank(f.fee) ? autoBuyFee(settings, stock.market, qty, price) : num(f.fee);
    out.feeAuto = isBlank(f.fee);
    const before = [], after = [];
    for (const lot of stock.lots) {
      const rem = lotRem(stock, lot);
      const old = { rem, price: lot.price, feePS: lotFeePerShare(lot), fx: lot.fx || 1 };
      if (editLotId && lot.id === editLotId) {
        const sold = lotSold(stock, lot.id);
        before.push(old);
        if (qty < sold - 1e-9) out.errors.push(`이미 ${sold}주가 매도되어 수량을 그보다 적게 할 수 없습니다.`);
        after.push({ rem: Math.max(0, r6(qty - sold)), price, feePS: fee / qty, fx });
      } else { before.push(old); after.push(old); }
    }
    if (!editLotId) after.push({ rem: qty, price, feePS: fee / qty, fx });
    const agg = (arr) => {
      let q = 0, noFee = 0, cost = 0, costKRW = 0;
      for (const l of arr) { if (l.rem <= 0) continue; q += l.rem; noFee += l.rem * l.price; cost += l.rem * (l.price + l.feePS); costKRW += l.rem * (l.price + l.feePS) * l.fx; }
      return { qty: q, cost, costKRW, avg: q > 0 ? noFee / q : null, avgInclFee: q > 0 ? cost / q : null, avgKRW: q > 0 ? costKRW / q : null };
    };
    const b = agg(before), a = agg(after);
    out.before = b; out.after = a; out.editing = !!editLotId;
    out.buy = { gross: qty * price, fee, total: qty * price + fee, fx, totalKRW: (qty * price + fee) * fx };
    out.change = {
      qty: a.qty - b.qty,
      avg: b.avg && a.avg ? a.avg / b.avg - 1 : null,
      avgInclFee: b.avgInclFee && a.avgInclFee ? a.avgInclFee / b.avgInclFee - 1 : null,
      cost: a.cost - b.cost,
    };
    // 손익분기 매도가 (매도 수수료·세금 반영, 현지통화 기준)
    const d = 1 - (rates.sellFee + rates.sellTax) / 100;
    const be = (x) => (x.avgInclFee && d > 0 ? x.avgInclFee / d : null);
    out.breakEven = { before: be(b), after: be(a) };
    // 현재가 기준 평가손익과 -10% 시나리오 (원화)
    const cur = stock.price > 0 ? stock.price : null;
    const ref = cur || price;
    const fxNow = us ? settings.fxNow : 1;
    const unrl = (x, p) => (x.qty > 0 ? x.qty * p * fxNow - x.costKRW : 0);
    out.refIsBuy = !cur;
    out.refPrice = ref;
    out.riseNeeded = cur && out.breakEven.after ? out.breakEven.after / cur - 1 : null;
    out.unrl = { before: unrl(b, ref), after: unrl(a, ref) };
    out.down10 = { price: ref * 0.9, before: unrl(b, ref * 0.9), after: unrl(a, ref * 0.9) };
    out.down10.extra = out.down10.after - out.down10.before - (out.unrl.after - out.unrl.before); // 가격이 10% 더 빠질 때 늘어나는 손실
    // 경고
    if (cur && Math.abs(price / cur - 1) > 0.3) out.warnings.push(`매수가가 현재가(${num(cur)})와 ${(Math.abs(price / cur - 1) * 100).toFixed(0)}% 차이 납니다. 가격을 다시 확인하세요.`);
    if (f.date && f.date > (today || todayStr())) out.warnings.push('매수일이 오늘보다 미래입니다.');
    if (!us && Math.abs(qty - Math.round(qty)) > 1e-9) out.warnings.push('국내 주식은 보통 정수 주 단위입니다. 수량을 확인하세요.');
    if (fee > out.buy.gross * 0.05) out.warnings.push('수수료가 매수금액의 5%를 넘습니다. 직접 입력한 값이 맞는지 확인하세요.');
    if (us && !(fx > 0)) out.errors.push('매수 환율을 입력하세요.');
    out.ok = true;
    return out;
  }


  /* ---------- 관심 종목 / 가상 매매 / 분할 매수 계획 ---------- */
  // 가상 매매 장부를 실제 장부처럼 다루기 위한 뷰 (addLot/computeSale/stockSummary 등을 그대로 재사용)
  function paperStock(stock) {
    const p = stock.paper;
    const v = {};
    const def = (k, get, set) => Object.defineProperty(v, k, { get, set: set || (() => {}), enumerable: true });
    def('lots', () => p.lots, (x) => { p.lots = x; });
    def('sales', () => p.sales, (x) => { p.sales = x; });
    def('nextNo', () => p.nextNo, (x) => { p.nextNo = x; });
    def('price', () => stock.price); def('market', () => stock.market);
    def('id', () => stock.id); def('name', () => stock.name); def('code', () => stock.code);
    Object.defineProperty(v, '_real', { value: stock, enumerable: false });
    return v;
  }
  function paperSettings(settings, feeOn) {
    if (feeOn !== false) return settings;
    const z = { buyFee: 0, sellFee: 0, sellTax: 0 };
    return Object.assign({}, settings, { kr: Object.assign({}, settings.kr, z), us: Object.assign({}, settings.us, z) });
  }
  // 사전 기록: 거래일이 입력한 날(오늘)과 같거나 이후. 사후 입력: 과거 날짜로 입력(결과를 알고 하는 매매)
  const isPre = (date, today) => String(date) >= (today || todayStr());
  function tagPaper(rec, today) { rec.at = Date.now(); rec.pre = isPre(rec.date, today); return rec; }
  function paperStats(stock, settings) {
    const pv = paperStock(stock), ps = paperSettings(settings, stock.paper.fee);
    const sm = stockSummary(pv, ps);
    const sales = pv.sales, lots = pv.lots;
    const realized = sales.reduce((a, x) => a + x.pnlLocal, 0), realizedKRW = sales.reduce((a, x) => a + x.pnlKRW, 0);
    const priced = sm.value != null;
    const unrealized = priced ? sm.unrl : 0, unrealizedKRW = priced ? sm.unrlKRW : 0;
    const ev = [];
    lots.forEach((l) => ev.push({ d: l.date, k: 0, amt: l.qty * l.price + l.fee }));
    sales.forEach((x) => x.lines.forEach((ln) => ev.push({ d: x.date, k: 1, amt: ln.costLocal })));
    ev.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.k - b.k));
    let run = 0, peak = 0;
    for (const e of ev) { run += e.k === 0 ? e.amt : -e.amt; peak = Math.max(peak, run); }
    const lines = sales.flatMap((x) => x.lines);
    const wins = lines.filter((l) => l.pnlLocal > 0).length;
    const grp = (flag) => ({ lots: lots.filter((l) => !!l.pre === flag).length, sales: sales.filter((x) => !!x.pre === flag).length, realized: sales.filter((x) => !!x.pre === flag).reduce((a, x) => a + x.pnlLocal, 0) });
    const total = realized + unrealized;
    return {
      qty: sm.qty, realized, realizedKRW, unrealized, unrealizedKRW, total, totalKRW: realizedKRW + unrealizedKRW,
      peak, ret: peak > 0 ? total / peak : null, buys: lots.length, sells: sales.length, closed: lines.length, wins,
      winRate: lines.length ? wins / lines.length : null, priced, empty: !lots.length && !sales.length,
      pre: grp(true), post: grp(false), firstDate: ev.length ? ev[0].d : null, avg: sm.avg, avgInclFee: sm.avgInclFee,
    };
  }
  function watchGap(stock) {
    const t = num(stock.target), p = num(stock.price);
    if (!(t > 0)) return null;
    if (!(p > 0)) return { target: t, price: null, gap: null, reached: false };
    return { target: t, price: p, gap: p / t - 1, reached: p <= t };
  }
  function addPlan(stock, { price, qty, note }) {
    const p = num(price), q = num(qty);
    if (!(p > 0) || !(q > 0)) throw new Error('계획 가격과 수량은 0보다 커야 합니다.');
    const step = { id: uid(), price: p, qty: q, note: String(note || '').trim(), done: false, paperLot: null };
    stock.plan = (stock.plan || []).concat([step]);
    return step;
  }
  function removePlan(stock, id) { stock.plan = (stock.plan || []).filter((p) => p.id !== id); }
  // 아직 실행하지 않은 계획을 가격이 높은 순으로 샀을 때의 누적 평단 (실제 보유 순번이 있으면 함께 계산)
  function planPreview(stock, settings) {
    const us = stock.market === 'US', rates = ratesOf(settings, stock.market), fxNow = us ? settings.fxNow : 1;
    const pend = (stock.plan || []).filter((p) => !p.done).slice().sort((a, b) => b.price - a.price);
    let qty = 0, noFee = 0, cost = 0;
    for (const lot of stock.lots) {
      const rem = lotRem(stock, lot);
      if (rem <= 0) continue;
      qty += rem; noFee += rem * lot.price; cost += rem * (lot.price + lotFeePerShare(lot));
    }
    const base = { qty, avg: qty > 0 ? noFee / qty : null, avgInclFee: qty > 0 ? cost / qty : null, cost };
    let planned = 0, plannedQty = 0;
    const steps = pend.map((p) => {
      const fee = autoBuyFee(settings, stock.market, p.qty, p.price);
      qty += p.qty; noFee += p.qty * p.price; cost += p.qty * p.price + fee; planned += p.qty * p.price + fee; plannedQty += p.qty;
      return { id: p.id, price: p.price, qty: p.qty, note: p.note, paperLot: p.paperLot, fee, total: p.qty * p.price + fee, cumQty: qty, cumAvg: noFee / qty, cumAvgIncl: cost / qty, cumCost: cost };
    });
    const final = { qty, avg: qty > 0 ? noFee / qty : null, avgInclFee: qty > 0 ? cost / qty : null, cost };
    const d = 1 - (rates.sellFee + rates.sellTax) / 100;
    const breakEven = final.avgInclFee && d > 0 ? final.avgInclFee / d : null;
    const cur = num(stock.price) > 0 ? num(stock.price) : null;
    return { base, steps, final, planned, plannedQty, breakEven, riseNeeded: cur && breakEven ? breakEven / cur - 1 : null, avgChange: base.avg && final.avg ? final.avg / base.avg - 1 : null, fxNow };
  }

  /* ---------- 평단가 계산기 ---------- */
  function avgCalc({ baseQty, baseAvg, buys, feeRate }) {
    let qty = num(baseQty), cost = num(baseQty) * num(baseAvg);
    for (const b of buys || []) {
      const q = num(b.qty), p = num(b.price);
      if (q > 0 && p > 0) { qty += q; cost += q * p * (1 + (feeRate || 0) / 100); }
    }
    return { qty, cost, avg: qty > 0 ? cost / qty : null };
  }
  // 목표 평단가에 도달하려면 가격 P에 몇 주를 더 사야 하는가
  function qtyForTarget({ baseQty, baseAvg, target, price }) {
    const q0 = num(baseQty), a0 = num(baseAvg), T = num(target), P = num(price);
    const cost = q0 * a0;
    if (!(T > 0) || !(P > 0)) return { ok: false, msg: '목표 평단가와 매수 가격을 입력하세요.' };
    if (a0 === T) return { ok: true, qty: 0 };
    if ((a0 > T && P >= T) || (a0 < T && P <= T)) return { ok: false, msg: '이 가격으로는 목표 평단가에 도달할 수 없습니다. (매수 가격이 목표보다 낮아야 평단이 내려갑니다)' };
    const q = (T * q0 - cost) / (P - T);
    return { ok: true, qty: Math.ceil(q - 1e-9) };
  }
  function breakEvenPrice({ avg, sellFeePct, taxPct }) {
    const d = 1 - (num(sellFeePct) + num(taxPct)) / 100;
    return d > 0 ? num(avg) / d : null;
  }


  // 'a.b.c' 형식 버전 비교: a>b 이면 1, 같으면 0, 작으면 -1
  function compareVersions(a, b) {
    const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
    return 0;
  }

  /* ---------- 현재가 / 액면분할 / 일정 / 홈 요약 ---------- */
  function setPrice(stock, price) {
    stock.price = price === null || price === '' || price === undefined ? null : num(price);
    stock.priceAt = stock.price ? todayStr() : null;
  }
  function priceAge(stock, today) {
    if (!stock.price) return null;
    if (!stock.priceAt) return 999;
    return daysBetween(stock.priceAt, today || todayStr());
  }
  // ratio: 기존 1주 → 새 주식 수 (1:5 분할 = 5, 10:1 병합 = 0.1). 금액(손익)은 그대로 유지됩니다.
  function splitAdjust(stock, ratio, date) {
    const r = num(ratio);
    if (!(r > 0) || r === 1) throw new Error('비율은 0보다 크고 1이 아니어야 합니다. (예: 1주가 5주로 분할되면 5)');
    const fix = (l) => { l.qty = r6(l.qty * r); l.price = l.price / r; };
    stock.lots.forEach((l) => { fix(l); (l.parts || []).forEach(fix); });
    stock.sales.forEach((s) => {
      s.qty = r6(s.qty * r); s.price = s.price / r;
      s.lines.forEach((ln) => { ln.qty = r6(ln.qty * r); ln.lotPrice = ln.lotPrice / r; });
    });
    const pp = stock.paper;
    if (pp) {
      pp.lots.forEach(fix);
      pp.sales.forEach((x) => { x.qty = r6(x.qty * r); x.price = x.price / r; x.lines.forEach((ln) => { ln.qty = r6(ln.qty * r); ln.lotPrice = ln.lotPrice / r; }); });
    }
    (stock.plan || []).forEach((p) => { p.qty = r6(p.qty * r); p.price = p.price / r; });
    if (stock.target) stock.target = stock.target / r;
    if (stock.price) stock.price = stock.price / r;
    stock.splits = (stock.splits || []).concat([{ date: date || todayStr(), ratio: r }]);
  }
  function addEvent(stock, { date, title, kind }) {
    if (!date || !String(title || '').trim()) throw new Error('날짜와 제목을 입력하세요.');
    const ev = { id: uid(), date, title: String(title).trim(), kind: kind || '기타' };
    stock.events = (stock.events || []).concat([ev]).sort((a, b) => (a.date < b.date ? -1 : 1));
    return ev;
  }
  function removeEvent(stock, id) { stock.events = (stock.events || []).filter((e) => e.id !== id); }
  function upcomingEvents(state, today, daysAhead, daysBack) {
    const t = today || todayStr();
    const out = [];
    for (const st of state.stocks) {
      for (const ev of st.events || []) {
        const d = daysBetween(t, ev.date);
        if (d >= -(daysBack == null ? 3 : daysBack) && d <= (daysAhead == null ? 45 : daysAhead)) out.push({ stock: st, ev, days: d });
      }
    }
    return out.sort((a, b) => (a.ev.date < b.ev.date ? -1 : a.ev.date > b.ev.date ? 1 : 0));
  }
  function fillLink(tpl, stock) {
    return String(tpl).replace(/\{code\}/g, encodeURIComponent(stock.code || stock.name)).replace(/\{name\}/g, encodeURIComponent(stock.name));
  }
  function linksFor(state, stock) {
    return (state.settings.links || []).filter((l) => !l.market || l.market === 'ALL' || l.market === stock.market);
  }
  function portfolio(state, today) {
    const t = today || todayStr();
    const o = { costKRW: 0, pricedCostKRW: 0, valueKRW: 0, realizedAll: 0, realizedYear: 0, realizedMonth: 0, missing: [], stale: [], weights: [], holdings: 0 };
    for (const st of state.stocks) {
      const sm = stockSummary(st, state.settings);
      for (const s of st.sales) {
        o.realizedAll += s.pnlKRW;
        if (s.date.slice(0, 4) === t.slice(0, 4)) o.realizedYear += s.pnlKRW;
        if (s.date.slice(0, 7) === t.slice(0, 7)) o.realizedMonth += s.pnlKRW;
      }
      if (sm.qty > 0) {
        o.holdings++;
        o.costKRW += sm.costKRW;
        if (sm.valueKRW != null) {
          o.pricedCostKRW += sm.costKRW; o.valueKRW += sm.valueKRW;
          o.weights.push({ id: st.id, name: st.name, valueKRW: sm.valueKRW });
          if (priceAge(st, t) > 3) o.stale.push(st);
        } else o.missing.push(st);
      }
    }
    o.unrlKRW = o.valueKRW - o.pricedCostKRW;
    o.unrlRet = o.pricedCostKRW > 0 ? o.unrlKRW / o.pricedCostKRW : null;
    return o;
  }
  const noteKey = (type, id) => type + '_' + id;
  function noteKeysOfStock(stock) {
    const keys = ['stock_' + stock.id];
    stock.lots.forEach((l) => { keys.push('lot_' + l.id); (l.parts || []).forEach((p) => keys.push('lot_' + p.id)); });
    stock.sales.forEach((s) => keys.push('sale_' + s.id));
    return keys;
  }

  Object.assign(SM, {
    paperStock, paperSettings, paperStats, tagPaper, isPre, watchGap, addPlan, removePlan, planPreview,
    qtyForAmount, lotPreview, compareVersions, setPrice, priceAge, splitAdjust, addEvent, removeEvent, upcomingEvents, fillLink, linksFor, portfolio, noteKey, noteKeysOfStock,
    DEFAULT_SETTINGS, uid, todayStr, num, isBlank, daysBetween, fmtNum, fmtMoney, fmtPct, curOf, ratesOf,
    newState, normalizeState, newStock, lotSold, lotRem, lotFeePerShare, addLot, updateLot, deleteLot,
    mergeLots, unmergeLot, splitLot, stockSummary, lotView, computeSale, allocate, remainingAfter,
    recordSale, pnlReport, avgCalc, qtyForTarget, breakEvenPrice, autoBuyFee,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = SM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
