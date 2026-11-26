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
    return { v: 1, updatedAt: 0, settings: DEFAULT_SETTINGS(), stocks: [] };
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
    };
    s.stocks = (obj.stocks || []).map((st) =>
      Object.assign({ id: uid(), name: '', code: '', market: 'KR', price: null, lots: [], sales: [], nextNo: 1 }, st)
    );
    s.stocks.forEach((st) => {
      const maxNo = st.lots.reduce((m, l) => Math.max(m, l.no || 0), 0);
      if (st.nextNo <= maxNo) st.nextNo = maxNo + 1;
    });
    return s;
  }
  function newStock({ name, code, market }) {
    return { id: uid(), name: name || '', code: code || '', market: market === 'US' ? 'US' : 'KR', price: null, lots: [], sales: [], nextNo: 1 };
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

  Object.assign(SM, {
    DEFAULT_SETTINGS, uid, todayStr, num, isBlank, daysBetween, fmtNum, fmtMoney, fmtPct, curOf, ratesOf,
    newState, normalizeState, newStock, lotSold, lotRem, lotFeePerShare, addLot, updateLot, deleteLot,
    mergeLots, unmergeLot, splitLot, stockSummary, lotView, computeSale, allocate, remainingAfter,
    recordSale, pnlReport, avgCalc, qtyForTarget, breakEvenPrice, autoBuyFee,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = SM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
