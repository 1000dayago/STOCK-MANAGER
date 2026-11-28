const assert = require('assert');
const SM = require('../core.js'); require('../backtest.js'); require('../data.js'); require('../chart-stock.js');
const S = SM.DEFAULT_SETTINGS();
let ok = 0; const t = (name, fn) => { try { fn(); ok++; console.log('✓', name); } catch (e) { console.log('✗', name, e.message); process.exitCode = 1; } };
const approx = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, `${a} != ${b}`);

t('삼성 예시: 1번 10주@60000, 2번 20주@40000, 평단', () => {
  const st = SM.newStock({ name: '삼성', market: 'KR' });
  SM.addLot(st, { date: '2026-10-01', qty: 10, price: 60000, fee: 0 }, S);
  SM.addLot(st, { date: '2026-10-20', qty: 20, price: 40000, fee: 0 }, S);
  const sm = SM.stockSummary(st, S);
  assert.equal(sm.qty, 30); approx(sm.avg, 46666.6667, 1e-3);
  // 10주를 100000원에 팔기 - 1번 / 2번 / 평단
  const mk = (lotId, q) => SM.computeSale(st, [{ lotId, qty: q }], { price: 100000, date: '2026-11-01', sellFee: 0, tax: 0 }, S);
  approx(mk(st.lots[0].id, 10).pnlKRW, 400000); approx(mk(st.lots[0].id, 10).retKRW, 0.6667, 1e-3);
  approx(mk(st.lots[1].id, 10).pnlKRW, 600000); approx(mk(st.lots[1].id, 10).retKRW, 1.5, 1e-9);
  const pro = SM.allocate(st, 10, 'pro');
  const lines = Object.entries(pro).map(([lotId, qty]) => ({ lotId, qty }));
  assert.equal(lines.reduce((a, l) => a + l.qty, 0), 10); // 3주(1번)+7주(2번): 정수 주 단위 배분
  assert.deepEqual(lines.map((l) => l.qty).sort(), [3, 7]);
  approx(SM.computeSale(st, lines, { price: 100000, sellFee: 0, tax: 0 }, S).pnlKRW, 3 * 40000 + 7 * 60000);
});
t('수수료/세금 자동 계산 및 부분매도 후 잔여', () => {
  const st = SM.newStock({ name: 'A', market: 'KR' });
  const lot = SM.addLot(st, { qty: 100, price: 10000 }, S); // 수수료 자동 = 150
  approx(lot.fee, 150);
  const c = SM.computeSale(st, [{ lotId: lot.id, qty: 40 }], { price: 12000, date: '2026-11-01' }, S);
  approx(c.sellFee, 40 * 12000 * 0.00015); approx(c.tax, 40 * 12000 * 0.0018);
  approx(c.pnlLocal, 40 * 12000 - c.sellFee - c.tax - (40 * 10000 + 60));
  SM.recordSale(st, c);
  approx(SM.lotRem(st, lot), 60);
  assert.throws(() => SM.updateLot(st, lot.id, { qty: 30, price: 10000 }, S));
  assert.throws(() => SM.deleteLot(st, lot.id));
  assert.throws(() => SM.splitLot(st, lot.id, 10));
});
t('병합/분리/복원', () => {
  const st = SM.newStock({ name: 'B', market: 'KR' });
  const a = SM.addLot(st, { qty: 10, price: 60000, fee: 0 }, S), b = SM.addLot(st, { qty: 20, price: 40000, fee: 0 }, S);
  const m = SM.mergeLots(st, [a.id, b.id]);
  assert.equal(m.qty, 30); approx(m.price, 46666.6667, 1e-3); assert.equal(st.lots.length, 1);
  SM.unmergeLot(st, m.id); assert.equal(st.lots.length, 2);
  const m2 = SM.mergeLots(st, st.lots.map((l) => l.id));
  const nl = SM.splitLot(st, m2.id, 12);
  assert.equal(nl.qty, 12); assert.equal(st.lots.find((l) => l.id === m2.id).qty, 18);
});
t('해외주식 환율 손익', () => {
  const st = SM.newStock({ name: 'AAPL', market: 'US' });
  const lot = SM.addLot(st, { qty: 10, price: 100, fx: 1300, fee: 0 }, S);
  const c = SM.computeSale(st, [{ lotId: lot.id, qty: 10 }], { price: 110, fx: 1400, sellFee: 0, tax: 0 }, S);
  approx(c.pnlLocal, 100); approx(c.pnlKRW, 10 * 110 * 1400 - 10 * 100 * 1300);
});
t('손익 리포트 + 해외 세금 추정', () => {
  const state = SM.newState(); const st = SM.newStock({ name: 'AAPL', market: 'US' }); state.stocks.push(st);
  const lot = SM.addLot(st, { qty: 100, price: 100, fx: 1300, fee: 0 }, S);
  SM.recordSale(st, SM.computeSale(st, [{ lotId: lot.id, qty: 100 }], { price: 200, fx: 1400, date: '2026-05-10', sellFee: 0, tax: 0 }, S));
  const r = SM.pnlReport(state, { group: 'month' });
  assert.equal(r.groups.length, 1); approx(r.total.pnlKRW, 100 * 200 * 1400 - 100 * 100 * 1300);
  approx(r.usTax[0].tax, (r.usTax[0].pnlKRW - 2500000) * 0.22);
});
t('계산기', () => {
  approx(SM.avgCalc({ baseQty: 10, baseAvg: 60000, buys: [{ qty: 20, price: 40000 }] }).avg, 46666.6667, 1e-3);
  assert.equal(SM.qtyForTarget({ baseQty: 10, baseAvg: 60000, target: 50000, price: 40000 }).qty, 10 * 10000 / 10000);
  assert(!SM.qtyForTarget({ baseQty: 10, baseAvg: 60000, target: 50000, price: 55000 }).ok);
});
t('CSV 파싱 (한글/영문/내림차순/쉼표 숫자)', () => {
  const csv = '날짜,시가,고가,저가,종가,거래량\n2025.01.07,"1,100","1,200","1,000","1,150","1,200,000"\n2025.01.06,1000,1100,900,1050,800000\n2025.01.03,1000,1000,1000,1000,1\n2025.01.02,1,1,1,1,1\n2025.01.01,1,1,1,1,1';
  const r = SM.parseOHLCV(csv); assert(r.data, r.error);
  assert.equal(r.data.d[0], '2025-01-01'); assert.equal(r.data.c[4], 1150); assert.equal(r.data.v[4], 1200000);
  const y = SM.parseOHLCV('Date,Open,High,Low,Close,Adj Close,Volume\n2024-01-02,10,12,9,11,5.5,100\n2024-01-03,10,12,9,11,5.5,100\n2024-01-04,10,12,9,11,5.5,100\n2024-01-05,10,12,9,11,5.5,100\n2024-01-08,10,12,9,11,5.5,100');
  approx(y.data.c[0], 5.5); approx(y.data.o[0], 5);
  assert(SM.parseOHLCV('a,b\n1,2').error);
});
function synth(n, seed = 1) {
  let x = seed, p = 10000; const d = { d: [], o: [], h: [], l: [], c: [], v: [], hasVol: true, hasHL: true };
  const rnd = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const dt = new Date('2024-01-01');
  for (let i = 0; i < n; i++) {
    const o = p; p = Math.max(100, p * (1 + (rnd() - 0.48) * 0.04)); const c = p;
    dt.setDate(dt.getDate() + 1);
    d.d.push(dt.toISOString().slice(0, 10)); d.o.push(o); d.c.push(c); d.h.push(Math.max(o, c) * 1.01); d.l.push(Math.min(o, c) * 0.99); d.v.push(Math.floor(rnd() * 2000000));
  }
  return d;
}
const mk = (entries, exits, extra = {}) => Object.assign(SM.blankCfg(), { entries: { mode: 'AND', conds: entries }, exits: { mode: 'OR', conds: exits } }, extra);
const check = (name, r) => {
  assert(!r.error, name + ' ' + r.error);
  const s = r.summary;
  approx(s.total, s.realized + s.unrealized, 1e-6);
  approx(r.trades.reduce((a, x) => a + x.pnl, 0), s.realized, 1e-6);
  assert.equal(s.buyCount, s.closed + s.open);
  console.log('   ', name, 'buys', s.buyCount, 'closed', s.closed, 'total', Math.round(s.total), 'bh', s.bh && Math.round(s.bh.pnl));
};
t('백테스트: 여러 조건 실행 / 정합성', () => {
  const data = synth(400);
  data.frgn = data.d.map((_, i) => (i % 7 < 3 ? 200000 : -150000)); data.inst = data.d.map((_, i) => (i % 5 < 2 ? 50000 : -20000));
  const cases = {
    거래량: mk([{ type: 'vol', n: 1000000 }], []),
    이평교차: mk([{ type: 'maCross', ma: 'sma', s: 5, l: 20, dir: 'up' }], [{ type: 'maCross', ma: 'sma', s: 5, l: 20, dir: 'down' }]),
    EMA교차: mk([{ type: 'maCross', ma: 'ema', s: 12, l: 26, dir: 'up' }], [{ type: 'maCross', ma: 'ema', s: 12, l: 26, dir: 'down' }]),
    볼린저: mk([{ type: 'bb', n: 20, k: 2, band: 'lower', basis: 'close' }], [{ type: 'bb', n: 20, k: 2, band: 'upper', basis: 'close' }]),
    RSI: mk([{ type: 'rsi', n: 14, op: 'lte', v: 35 }], [{ type: 'rsi', n: 14, op: 'gte', v: 65 }]),
    MACD: mk([{ type: 'macd', s: 12, l: 26, sig: 9, dir: 'up' }], [{ type: 'macd', s: 12, l: 26, sig: 9, dir: 'down' }]),
    신고가: mk([{ type: 'breakout', n: 20, dir: 'high' }], [{ type: 'trail', pct: 8 }]),
    분할매수: mk([{ type: 'dropLast', pct: 5, basis: 'last', first: 'yes' }], [{ type: 'avgPct', dir: 'up', pct: 4 }]),
    수급: mk([{ type: 'flow', who: 'frgn', dir: 'buy', mode: 'streak', n: 3 }], [{ type: 'tp', pct: 5 }, { type: 'sl', pct: 5 }]),
    수급AND: mk([{ type: 'flow', who: 'both', dir: 'buy', mode: 'day', v: 10000 }, { type: 'maState', ma: 'sma', s: 5, l: 20, dir: 'above' }], [{ type: 'holdDays', n: 10 }]),
  };
  for (const [k, c] of Object.entries(cases)) check(k, SM.runBacktest(data, c, S));
});
t('백테스트: 수급 데이터 없으면 안내 / 거래량 없으면 안내', () => {
  const data = synth(100);
  assert(/수급 데이터/.test(SM.runBacktest(data, mk([{ type: 'flow', who: 'frgn', dir: 'buy', mode: 'day', v: 1 }], []), S).error));
  assert(/매수 조건/.test(SM.runBacktest(data, mk([], []), S).error));
});
t('매수 신호: 외국인·기관 동시 순매수 + 거래량이 전일보다 높을 때', () => {
  const d = { d: [], o: [], h: [], l: [], c: [], v: [], frgn: [], inst: [], hasVol: true, hasHL: true, flowUnit: 'shares' };
  const rows = [[100, 100, 5, 5], [100, 150, 5, 5], [100, 120, 5, -5], [100, 200, -5, 5], [100, 210, 5, 5], [100, 210, 5, 5]]; // 종가, 거래량, 외국인, 기관
  const dt = new Date('2024-02-01'); rows.forEach(([c, v, f, i]) => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); d.o.push(c); d.h.push(c); d.l.push(c); d.c.push(c); d.v.push(v); d.frgn.push(f); d.inst.push(i); });
  const cfg = mk([{ type: 'flow', who: 'both', dir: 'buy', mode: 'day', v: 1, n: 3 }, { type: 'volPrev', x: 1 }], [], { fill: 'close', qty: 10, growth: 1 });
  const r = SM.runBacktest(d, cfg, S);
  assert.deepEqual(r.buys.map((b) => d.d[b.i]), [d.d[1], d.d[4]]); // 2일째(거래량 100→150, 둘 다 순매수), 5일째(200→210). 3일째는 기관 순매도, 4일째는 외국인 순매도, 6일째는 거래량 같음(210→210)
  const r2 = SM.runBacktest(d, mk([{ type: 'volPrev', x: 1.3 }], [], { fill: 'close', qty: 1, growth: 1 }), S); assert.deepEqual(r2.buys.map((b) => d.d[b.i]), [d.d[1], d.d[3]]); // 150/100=1.5배, 200/120=1.67배(1.3배 초과)
});
t('이동평균선 방향(상승 중) 조건', () => {
  const px = [10, 10, 10, 10, 10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9, 8]; // 오르다가 내림
  const d = { d: [], o: px.slice(), h: px.slice(), l: px.slice(), c: px.slice(), v: px.map(() => 1000), hasVol: true, hasHL: true }, dt = new Date('2024-03-01'); px.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const up = SM.runBacktest(d, mk([{ type: 'maSlope', ma: 'sma', n: 3, k: 1, dir: 'up' }], [], { fill: 'close', qty: 1, growth: 1 }), S), down = SM.runBacktest(d, mk([{ type: 'maSlope', ma: 'sma', n: 3, k: 1, dir: 'down' }], [], { fill: 'close', qty: 1, growth: 1 }), S);
  const upDays = up.buys.map((b) => b.i), dnDays = down.buys.map((b) => b.i), sma3 = SM.sma(px, 3);
  assert(upDays.length > 0 && dnDays.length > 0); assert(upDays.every((i) => sma3[i] > sma3[i - 1])); assert(dnDays.every((i) => sma3[i] < sma3[i - 1])); assert(upDays.every((i) => !dnDays.includes(i)));
  assert(upDays.includes(5) && !upDays.includes(2) && !dnDays.includes(5)); assert(Math.max(...upDays) <= 10 && Math.min(...dnDays) >= 11); // 3일 평균은 10일째까지 올라가고 11일째부터 내려감
});
t('매도: 데드크로스(5·15일)이면서 30일선이 하락 중일 때만(AND)', () => {
  const px = []; for (let i = 0; i < 80; i++) px.push(100 + 12 * Math.sin(i / 5) + (i < 40 ? i * 0.5 : 20 - (i - 40) * 0.5)); // 오르다가 내림(진동 포함)
  const d = { d: [], o: px.slice(), h: px.slice(), l: px.slice(), c: px.slice(), v: px.map(() => 1000), hasVol: true, hasHL: true }, dt = new Date('2024-05-01'); px.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const cross = { type: 'maCross', ma: 'sma', s: 5, l: 15, dir: 'down' }, slope = { type: 'maSlope', ma: 'sma', n: 30, k: 5, dir: 'down' };
  const buy = [{ type: 'dropLast', pct: 2, basis: 'last', first: 'yes' }];
  const a = SM.runBacktest(d, Object.assign(mk(buy, [cross], { fill: 'close', qty: 1, growth: 1 })), S);
  const both = Object.assign(mk(buy, [cross, slope], { fill: 'close', qty: 1, growth: 1 })); both.exits.mode = 'AND';
  const b = SM.runBacktest(d, both, S);
  const m30 = SM.sma(px, 30), s5 = SM.sma(px, 5), l15 = SM.sma(px, 15);
  assert(a.cycles.length > 0 && b.cycles.length > 0); assert(a.cycles.length >= b.cycles.length, '조건이 더 붙으면 청산이 같거나 줄어듦');
  for (const cy of b.cycles) { const i = cy.endIdx; assert(s5[i - 1] >= l15[i - 1] && s5[i] < l15[i], '데드크로스 날'); assert(m30[i] < m30[i - 5], '30일선이 5일 전보다 낮음'); }
});
t('액면분할·병합 보정: 감지·가격/거래량/수급(주) 보정, 정상 등락은 건드리지 않음', () => {
  // 가격 100(1/2 분할 아님) → 3일째에 50:1 분할 → 1/50 가격, 거래량 50배
  const mkd = (rows, unit) => { const d = { d: [], o: [], h: [], l: [], c: [], v: [], frgn: [], hasVol: true, hasHL: true, flowUnit: unit || 'shares' }, dt = new Date('2024-06-01'); rows.forEach(([c, v, f]) => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); d.o.push(c); d.h.push(c); d.l.push(c); d.c.push(c); d.v.push(v); d.frgn.push(f); }); return d; };
  const d = mkd([[2500000, 100, 10], [2600000, 110, 20], [52000, 5500, 1000], [53000, 5000, 900]]);
  const ev = SM.detectSplits(d); assert.deepEqual(ev.map((e) => [e.i, e.factor]), [[2, 50]]);
  const r = SM.adjustSplits(d); assert.deepEqual(r.events, [{ date: d.d[2], factor: 50 }]);
  assert.deepEqual(r.data.c.map((x) => Math.round(x)), [50000, 52000, 52000, 53000]); assert.deepEqual(r.data.v.map((x) => Math.round(x)), [5000, 5500, 5500, 5000]); assert.deepEqual(r.data.frgn, [500, 1000, 1000, 900]); // 분할 전 수급(주)은 50배
  assert.equal(d.c[0], 2500000); assert.equal(r.data.splitAdjusted, true); assert.equal(SM.adjustSplits(r.data).data, r.data); // 원본 그대로, 이미 보정한 것은 다시 보정하지 않음
  // 수급이 금액(원) 단위면 그대로, 병합(2:1 병합 = 가격 2배)도 감지, 정상 급등락(+29%)은 무시
  const k2 = SM.adjustSplits(mkd([[10000, 100, 5], [1000, 1100, 5]], 'krw')); assert.equal(k2.events.length, 1); assert.deepEqual(k2.data.frgn, [5, 5]); assert.deepEqual(k2.data.c, [1000, 1000]); // 10배 분할: 가격은 보정, 수급이 금액(원) 단위면 그대로
  const mg = SM.detectSplits(mkd([[1000, 1000, 1], [2050, 450, 1], [2100, 500, 1]])); assert.deepEqual(mg.map((e) => [e.i, +e.factor.toFixed(2)]), [[1, 0.5]]);
  assert.equal(SM.detectSplits(mkd([[1000, 100, 1], [1290, 300, 1], [1000, 100, 1]])).length, 0); // 상한가(+29%)·하한가는 정상
  assert.equal(SM.detectSplits(mkd([[1000, 100, 1], [100, 90, 1], [101, 95, 1]])).length, 0); // 거래량이 늘지 않은 90% 폭락은 분할이 아니라 이상 데이터로 보고 건드리지 않음
});
t('안전장치: 손절(평단 −N%)은 사이클을 손실로 청산하고 최대 매수 횟수가 매수를 막음', () => {
  const px = [100, 100, 90, 80, 70, 60, 50, 50, 50]; // 계속 하락
  const d = { d: [], o: px.slice(), h: px.slice(), l: px.slice(), c: px.slice(), v: px.map(() => 1000), hasVol: true, hasHL: true }, dt = new Date('2024-07-01'); px.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const base = (x) => mk([{ type: 'dropLast', pct: 5, basis: 'last', first: 'yes' }], [{ type: 'avgPct', dir: 'up', pct: 5 }].concat(x), { fill: 'close', qty: 10, growth: 2 });
  const free = SM.runBacktest(d, base([]), S), sl = SM.runBacktest(d, base([{ type: 'avgPct', dir: 'down', pct: 20 }]), S), lim = SM.runBacktest(d, Object.assign(base([]), { maxLots: 3 }), S);
  assert(free.openCycle && free.openCycle.lots >= 5, '손절·한도 없이 하락장에서는 계속 사 들어감'); assert(sl.cycles.length >= 1 && sl.cycles[0].realized < 0, '손절로 손실 청산'); assert(sl.cycles[0].ret < 0);
  assert(sl.cycleStats.maxInvest < free.cycleStats.maxInvest + free.openCycle.peakInv, '손절하면 투입이 더 커지기 전에 끊김'); assert(lim.cycleStats.maxLots <= 3 && (lim.openCycle ? lim.openCycle.lots : 0) <= 3, '최대 3회');
});
t('조건식(트리): AND/OR 묶음·빈 묶음 무시·엔진 평가·신호 진단', () => {
  const L = (type, extra) => Object.assign({ type }, extra || {});
  const a = L('vol', { n: 1500 }), b = L('change', { op: 'gte', v: 2 }), c = L('volPrev', { x: 1 });
  const ok = new Set([a, b, c]), val = { a: true, b: false, c: true }, f = (x) => (x === a ? val.a : x === b ? val.b : val.c);
  assert.equal(SM.evalExpr({ op: 'AND', items: [a, b] }, f, ok), false); assert.equal(SM.evalExpr({ op: 'OR', items: [a, b] }, f, ok), true);
  assert.equal(SM.evalExpr({ op: 'OR', items: [{ op: 'AND', items: [a, b] }, c] }, f, ok), true); // (a and b) or c
  assert.equal(SM.evalExpr({ op: 'AND', items: [{ op: 'OR', items: [b, c] }, b] }, f, ok), false); // (b or c) and b
  assert.equal(SM.evalExpr({ op: 'AND', items: [a, { op: 'OR', items: [] }] }, f, ok), true); assert.equal(SM.evalExpr({ op: 'AND', items: [] }, f, ok), null); // 빈 묶음은 무시
  assert.equal(SM.evalExpr({ op: 'AND', items: [a, L('rsi')] }, f, ok), true); // 대상 밖 조건 무시
  assert.deepEqual(SM.exprLeaves({ op: 'AND', items: [a, { op: 'OR', items: [b, c] }] }), [a, b, c]);
  assert.deepEqual(SM.exprOf({ mode: 'OR', conds: [a, b] }), { op: 'OR', items: [a, b] }); assert.equal(SM.exprOf({ expr: { op: 'AND', items: [a] }, mode: 'OR', conds: [b] }).items[0], a); // expr가 있으면 expr 우선
  // 엔진: (거래량 큼 AND 등락 큼) OR 전일보다 거래량 큼 — 날짜별 참/거짓을 직접 설계
  const rows = [[100, 1000], [101, 1600], [105, 2000], [104, 1900], [104, 1800], [104, 1000]]; // 종가, 거래량
  const d = { d: [], o: [], h: [], l: [], c: [], v: [], hasVol: true, hasHL: true }, dt = new Date('2024-08-01'); rows.forEach(([cl, v]) => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); d.o.push(cl); d.h.push(cl); d.l.push(cl); d.c.push(cl); d.v.push(v); });
  const mkE = (expr) => Object.assign(SM.blankCfg(), { fill: 'close', qty: 1, growth: 1, entries: { mode: 'AND', conds: SM.exprLeaves(expr), expr }, exits: { mode: 'OR', conds: [] } });
  const A = L('vol', { n: 1500 }), B = L('change', { op: 'gte', v: 2 }), C = L('volPrev', { x: 1 });
  const r1 = SM.runBacktest(d, mkE({ op: 'AND', items: [A, B] }), S); assert.deepEqual(r1.buys.map((x) => x.i), [2]); // 거래량≥1500 이면서 +2% 이상: 3번째 날(105/101=+3.96%)
  const r2 = SM.runBacktest(d, mkE({ op: 'OR', items: [{ op: 'AND', items: [A, B] }, C] }), S); assert.deepEqual(r2.buys.map((x) => x.i), [1, 2]); // 또는 전일보다 거래량 큼: 2번째(1000→1600), 3번째(1600→2000)
  const r3 = SM.runBacktest(d, mkE({ op: 'AND', items: [A, { op: 'OR', items: [B, C] }] }), S); assert.deepEqual(r3.buys.map((x) => x.i), [1, 2]); // 거래량≥1500 이면서 (등락 큼 또는 거래량 증가): 2번째 날 포함
  // 예전 형식과 같은 결과
  const old = SM.runBacktest(d, Object.assign(SM.blankCfg(), { fill: 'close', qty: 1, growth: 1, entries: { mode: 'AND', conds: [A, B] }, exits: { mode: 'OR', conds: [] } }), S); assert.deepEqual(old.buys.map((x) => x.i), r1.buys.map((x) => x.i));
  // 신호 진단
  const g1 = SM.signalStats(d, { expr: { op: 'AND', items: [A, B] } }); assert.equal(g1.signalDays, 1); assert.equal(g1.first, d.d[2]); assert.equal(g1.days, 6); assert.deepEqual(g1.leaves.map((x) => x.days), [4, 1]);
  const g2 = SM.signalStats(d, { expr: { op: 'AND', items: [L('volPrev', { x: 1 }), L('change', { op: 'lte', v: -0.9 })] } }); assert.equal(g2.signalDays, 0); assert.deepEqual(g2.groups, ['']); // 전일보다 거래량이 큰 날(2·3번째)과 −0.9% 이하 하락한 날(4번째)은 각자는 있는데 함께는 0일
  const g3 = SM.signalStats(d, { expr: { op: 'AND', items: [L('vol', { n: 99999 }), B] } }); assert.deepEqual(g3.groups, []); // 한쪽이 원래 한 번도 안 참이면 ‘겹치지 않음’ 경고 대상이 아님
  assert(SM.signalStats(d, { expr: { op: 'AND', items: [L('flow', { who: 'frgn', mode: 'day', dir: 'buy', v: 1, n: 3 })] } }).error);
  const g4 = SM.signalStats(d, { expr: { op: 'AND', items: [B, L('dropLast', { pct: 5, basis: 'last', first: 'yes' })] } }); assert.equal(g4.hasDyn, true); assert.equal(g4.leaves[1].dyn, true);
});
t('N일 이내 옵션과 재매수 쿨다운·최소 간격', () => {
  assert.deepEqual(SM.applyWithin([false, true, false, false, false, true, false], 3), [false, true, true, true, false, true, true]); assert.deepEqual(SM.applyWithin([true, false], 1), [true, false]); assert.deepEqual(SM.applyWithin([true, false], undefined), [true, false]);
  // 사건형 두 개(서로 다른 날)를 AND로 묶어도 N일 이내면 겹침: 2일째 거래량 급증, 4일째 +3% 상승
  const px = [100, 100, 100, 103, 103, 103, 103, 103], vol = [1000, 1000, 3000, 1000, 1000, 1000, 1000, 1000];
  const d = { d: [], o: px.slice(), h: px.slice(), l: px.slice(), c: px.slice(), v: vol, hasVol: true, hasHL: true }, dt = new Date('2024-09-01'); px.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const A = { type: 'vol', n: 2500 }, B = { type: 'change', op: 'gte', v: 2 }, run = (a, b) => SM.runBacktest(d, Object.assign(SM.blankCfg(), { fill: 'close', qty: 1, growth: 1, entries: { mode: 'AND', conds: [a, b] }, exits: { mode: 'OR', conds: [] } }), S);
  assert.equal(run(A, B).buys.length, 0); assert.deepEqual(run(Object.assign({}, A, { within: 3 }), B).buys.map((x) => x.i), [3]); // 3일 이내 → 4번째 날에 신호
  assert.equal(SM.signalStats(d, { expr: { op: 'AND', items: [Object.assign({}, A, { within: 3 }), B] } }).signalDays, 1);
  // 쿨다운: 매일 매수 신호 + 평단 +1% 청산. 쿨다운 0이면 청산 다음 날 바로 재매수, 3이면 3거래일 쉼. 최소 간격 2이면 보유 중 매수가 하루 걸러
  const p2 = [100, 100, 102, 100, 100, 102, 100, 100, 102, 100, 100, 102], d2 = { d: [], o: p2.slice(), h: p2.slice(), l: p2.slice(), c: p2.slice(), v: p2.map(() => 1000), hasVol: true, hasHL: true }, dt2 = new Date('2024-10-01'); p2.forEach(() => { d2.d.push(dt2.toISOString().slice(0, 10)); dt2.setDate(dt2.getDate() + 1); });
  const base = (x) => Object.assign(SM.blankCfg(), { fill: 'close', qty: 1, growth: 1, entries: { mode: 'AND', conds: [{ type: 'vol', n: 1 }] }, exits: { mode: 'OR', conds: [{ type: 'avgPct', dir: 'up', pct: 1 }] } }, x);
  const r0 = SM.runBacktest(d2, base({}), S), r3 = SM.runBacktest(d2, base({ cooldown: 3 }), S), g2 = SM.runBacktest(d2, base({ minGap: 2 }), S);
  const all = (r) => r.cycles.concat(r.openCycle ? [r.openCycle] : []);
  assert(all(r0).length >= 2 && all(r0)[1].startIdx === all(r0)[0].endIdx + 1, '쿨다운 없으면 청산 다음 날 재진입');
  assert(all(r3).length >= 2 && all(r3)[1].startIdx - all(r3)[0].endIdx >= 3, '쿨다운 3일: 청산 뒤 3거래일 이후 재진입 ' + all(r3).map((c) => [c.startIdx, c.endIdx]));
  assert(g2.buys.every((b, k) => k === 0 || b.cyc !== g2.buys[k - 1].cyc || b.i - g2.buys[k - 1].i >= 2), '같은 사이클 안 매수는 2거래일 이상 간격');
  assert(r0.buys.length >= g2.buys.length);
});
t('종목 일괄 비교 요약: 이익 종목 수·수익률 중앙값·뒤 구간·단순 보유 비교', () => {
  const r = SM.summarizeMulti([{ total: 100, ret: 0.1, ret1: 0.2, ret2: 0.05, bh: 0.02 }, { total: -50, ret: -0.05, ret1: 0.1, ret2: -0.1, bh: 0.1 }, { total: 30, ret: 0.03, ret1: null, ret2: null, bh: null }, { error: 'x' }, { total: 10, ret: 0.2, ret1: 0.1, ret2: 0.3, bh: 0.3 }]);
  assert.equal(r.n, 5); assert.equal(r.ran, 4); assert.equal(r.win, 3); assert(Math.abs(r.medRet - 0.065) < 1e-9); assert.equal(r.tested, 3); assert.equal(r.lateWin, 2); assert.equal(r.withBh, 3); assert.equal(r.beatBh, 1);
  assert.deepEqual(SM.summarizeMulti([]), { n: 0, ran: 0, win: 0, medRet: null, tested: 0, lateWin: 0, beatBh: 0, withBh: 0 });
});
t('새 조건 11종: 등락률·연속·갭·낙폭·반등·봉·이격도·정배열·스토캐스틱·밴드폭·불타기', () => {
  const mkd = (c, o) => { const d = { d: [], o: o || c.slice(), h: [], l: [], c: c.slice(), v: c.map(() => 1000), hasVol: true, hasHL: true }, dt = new Date('2024-11-01'); c.forEach((x, i) => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); d.h.push(Math.max(d.o[i], x)); d.l.push(Math.min(d.o[i], x)); }); return d; };
  const A = mkd([100, 102, 104, 103, 101, 99, 100, 105, 110, 108], [100, 100, 102, 104, 103, 101, 99, 96, 105, 110]);
  const days = (d, cond) => { const st = SM.signalStats(d, { expr: { op: 'AND', items: [cond] } }); return st.leaves[0].days; }, daysAt = (d, cond) => { const idx = []; const st = SM.signalStats(d, { expr: { op: 'AND', items: [cond] } }); void st; return idx; }; void daysAt;
  assert.equal(days(A, { type: 'retN', n: 2, op: 'gte', v: 5 }), 2); // 7번째(105/99), 8번째(110/100)
  assert.equal(days(A, { type: 'streakDays', n: 2, dir: 'up' }), 3);
  assert.equal(days(A, { type: 'gapOpen', dir: 'down', pct: 2 }), 1); assert.equal(days(A, { type: 'gapOpen', dir: 'up', pct: 2 }), 0);
  assert.equal(days(A, { type: 'candle', dir: 'up', pct: 1 }), 5); assert.equal(days(A, { type: 'candle', dir: 'down', pct: 1 }), 3);
  assert.equal(days(A, { type: 'fromHigh', n: 3, pct: 3 }), 1); assert.equal(days(A, { type: 'fromLow', n: 3, pct: 5 }), 3);
  assert.equal(days(A, { type: 'stoch', n: 3, op: 'lte', v: 20 }), 2); assert.equal(days(A, { type: 'maGap', ma: 'sma', n: 3, dir: 'below', pct: 1 }), 2);
  const D = mkd([20, 19, 18, 17, 16, 15, 14, 13, 12, 11]); assert.equal(days(D, { type: 'maAlign', ma: 'sma', s: 2, m: 3, l: 4, dir: 'down' }), 7); assert.equal(days(D, { type: 'maAlign', ma: 'sma', s: 2, m: 3, l: 4, dir: 'up' }), 0);
  const F = mkd([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]); assert.equal(days(F, { type: 'bbWidth', n: 3, k: 2, op: 'lte', v: 1 }), 8); assert.equal(days(F, { type: 'bbWidth', n: 3, k: 2, op: 'gte', v: 1 }), 0);
  // 불타기: 직전 매수가보다 5% 오를 때마다 추가 매수(첫 매수는 바로)
  const U = mkd([100, 100, 106, 112, 119, 119]);
  const r = SM.runBacktest(U, mk([{ type: 'riseLast', pct: 5, basis: 'last', first: 'yes' }], [], { fill: 'close', qty: 1, growth: 1 }), S); assert.deepEqual(r.buys.map((b) => b.i), [0, 2, 3, 4]);
  for (const k of ['retN', 'streakDays', 'gapOpen', 'fromHigh', 'fromLow', 'candle', 'stoch', 'bbWidth', 'maGap', 'maAlign', 'riseLast']) assert(SM.COND_DEFS[k] && SM.COND_DEFS[k].params.length, k);
});
t('수급 누적 순매수 조건(외국인·기관·합산·누적 동시)과 매수·매도 이유 기록', () => {
  const px = [100, 101, 102, 103, 104, 105, 106, 107], d = { d: [], o: px.slice(), h: px.slice(), l: px.slice(), c: px.slice(), v: px.map(() => 1000), hasVol: true, hasHL: true, flowUnit: 'shares', frgn: [5, 5, 5, -20, 5, 5, 5, 5], inst: [-3, 2, 4, 20, 1, 1, 1, 1], indiv: px.map(() => 0) }, dt = new Date('2025-01-02'); px.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const days = (cond) => SM.signalStats(d, { expr: { op: 'AND', items: [cond] } }).leaves[0].days;
  // 외국인 3일 누적 ≥ 10: [5,5,5]=15(2번째 인덱스), [5,5,-20]=-10, [5,-20,5]=-10, [-20,5,5]=-10, [5,5,5]=15, 15, 15 → 인덱스 2,6,7 +? (4,5,6,7: [-20,5,5]=-10(4)? 인덱스4=[−20,5? ] 계산은 아래 기대값으로 검증
  const sumN = (a, i, k) => { let s = 0; for (let j = i - k + 1; j <= i; j++) s += a[j]; return s; }, cnt = (arr, k, v) => { let c = 0; for (let i = k - 1; i < arr.length; i++) if (sumN(arr, i, k) >= v) c++; return c; };
  const comb = d.frgn.map((x, i) => x + d.inst[i]);
  assert.equal(days({ type: 'flowSum', who: 'frgn', dir: 'buy', n: 3, v: 10 }), cnt(d.frgn, 3, 10));
  assert.equal(days({ type: 'flowSum', who: 'inst', dir: 'buy', n: 3, v: 5 }), cnt(d.inst, 3, 5));
  assert.equal(days({ type: 'flowSum', who: 'combo', dir: 'buy', n: 3, v: 15 }), cnt(comb, 3, 15)); // 합산
  const both = []; for (let i = 2; i < d.d.length; i++) if (sumN(d.frgn, i, 3) >= 10 && sumN(d.inst, i, 3) >= 5) both.push(i);
  assert.equal(days({ type: 'flowSum', who: 'both', dir: 'buy', n: 3, v: 5 }), d.d.map((_, i) => (i >= 2 && sumN(d.frgn, i, 3) >= 5 && sumN(d.inst, i, 3) >= 5 ? 1 : 0)).reduce((a, b) => a + b, 0)); // 각각 모두(동시)
  assert(days({ type: 'flowSum', who: 'both', dir: 'buy', n: 3, v: 5 }) <= Math.min(days({ type: 'flowSum', who: 'frgn', dir: 'buy', n: 3, v: 5 }), days({ type: 'flowSum', who: 'inst', dir: 'buy', n: 3, v: 5 })));
  assert.equal(days({ type: 'flowSum', who: 'frgn', dir: 'sell', n: 1, v: 20 }), 1); // 순매도 20 이상은 4번째 날 하루
  assert(SM.signalStats({ d: ['2025-01-01', '2025-01-02'], c: [1, 1], o: [1, 1], h: [1, 1], l: [1, 1], v: [1, 1], hasVol: true }, { expr: { op: 'AND', items: [{ type: 'flowSum', who: 'combo', n: 3, v: 1 }] } }).error); // 수급 없는 데이터
  // 매수·매도 이유: 그 신호가 나온 날 참이었던 조건이 기록됨
  const cfg = Object.assign(SM.blankCfg(), { fill: 'close', qty: 1, growth: 1, entries: { mode: 'AND', conds: [{ type: 'flowSum', who: 'frgn', dir: 'buy', n: 2, v: 10 }, { type: 'volPrev', x: 0.5 }] }, exits: { mode: 'OR', conds: [{ type: 'avgPct', dir: 'up', pct: 1 }] } });
  const r = SM.runBacktest(d, cfg, S), cy = r.cycles.concat(r.openCycle ? [r.openCycle] : [])[0];
  assert(cy.buys[0].why.length === 2 && cy.buys[0].why.map((x) => x.type).join() === 'flowSum,volPrev', JSON.stringify(cy.buys[0].why));
  assert(r.cycles.length >= 1 && r.cycles[0].sellWhy.text === '평단 목표' && r.cycles[0].sellWhy.conds[0].type === 'avgPct' && r.cycles[0].sellWhy.conds[0].dir === 'up');
});
t('삭제된 조건(렌코)이 옛 전략에 남아 있어도 무시되고 오류 없이 실행됨', () => {
  const px = [100, 102, 101, 105, 104, 108], d = { d: [], o: px.slice(), h: px.slice(), l: px.slice(), c: px.slice(), v: px.map(() => 1000), hasVol: true, hasHL: true }, dt = new Date('2025-02-03'); px.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const r = SM.runBacktest(d, mk([{ type: 'renkoFlip', dir: 'up' }, { type: 'change', op: 'gte', v: 1 }], []), Object.assign({}, S)); assert(!r.error && r.buys.length > 0); assert(!SM.COND_DEFS.renkoFlip && !SM.COND_DEFS.renkoRun && !SM.buildRenko);
  assert(/매수 조건/.test(SM.runBacktest(d, mk([{ type: 'renkoFlip', dir: 'up' }], []), S).error)); // 렌코만 남은 전략은 ‘조건 없음’
});
t('거래량 조건 3종: 증가·감소(단순·배수), 거래량 이동평균 넘음·낮음, 하락+거래량 급증(손절)', () => {
  const v = [100, 120, 100, 300, 90, 90, 500, 80, 80, 80], c = [100, 101, 99, 95, 96, 94, 90, 91, 92, 93];
  const d = { d: [], o: c.slice(), h: c.slice(), l: c.slice(), c: c.slice(), v, hasVol: true, hasHL: true }, dt = new Date('2025-03-03'); c.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const days = (cond) => SM.signalStats(d, { expr: { op: 'AND', items: [cond] } }).leaves[0].days;
  assert.equal(days({ type: 'volChange', dir: 'up', mode: 'simple' }), 3); assert.equal(days({ type: 'volChange', dir: 'up', mode: 'ratio', x: 2 }), 2);
  assert.equal(days({ type: 'volChange', dir: 'down', mode: 'simple' }), 3); assert.equal(days({ type: 'volChange', dir: 'down', mode: 'ratio', x: 0.5 }), 2);
  assert.equal(days({ type: 'volChange', dir: 'up', mode: 'simple', k: 2 }), SM.signalStats(d, { expr: { op: 'AND', items: [{ type: 'volChange', dir: 'up', mode: 'simple', k: 2 }] } }).leaves[0].days); // 2일 전과 비교도 동작
  assert.equal(days({ type: 'volMa', n: 3, dir: 'above', x: 1 }), 2); assert.equal(days({ type: 'volMa', n: 3, dir: 'above', x: 2 }), 1); assert.equal(days({ type: 'volMa', n: 3, dir: 'below', x: 1 }), 5);
  assert.equal(days({ type: 'dropVol', pct: 3, n: 3, x: 1.5 }), 2); assert.equal(days({ type: 'dropVol', pct: 5, n: 3, x: 1.5 }), 0);
  // ‘당일 하락 AND 거래량 평균 배수’를 직접 문장으로 만들어도 같은 결과
  const combo = SM.signalStats(d, { expr: { op: 'AND', items: [{ type: 'change', op: 'lte', v: -3 }, { type: 'volMa', n: 3, dir: 'above', x: 1.5 }] } }); assert.equal(combo.signalDays, 2);
  // 손절: 매수 후 하락+거래량 급증이 나오면 그 신호로 전량 매도(체결: 당일 종가 기준 설정)
  const cfg = Object.assign(SM.blankCfg(), { fill: 'close', qty: 1, growth: 1, maxLots: 1, entries: { mode: 'AND', conds: [{ type: 'vol', n: 1 }] }, exits: { mode: 'OR', conds: [{ type: 'dropVol', pct: 3, n: 3, x: 1.5 }] } });
  const r = SM.runBacktest(d, cfg, S); assert(r.cycles.length >= 1 && r.cycles[0].endIdx === 3 && r.cycles[0].sellWhy.conds[0].type === 'dropVol' && r.cycles[0].realized < 0, JSON.stringify(r.cycles.map((x) => [x.startIdx, x.endIdx])));
  assert(SM.runBacktest(Object.assign({}, d, { hasVol: false }), cfg, S).error); // 거래량 없는 데이터는 사전 오류
});
t('재생: cutRaw는 모든 배열을 같은 길이로 자름', () => {
  const raw = { d: ['2025-01-01', '2025-01-02', '2025-01-03'], o: [1, 2, 3], h: [1, 2, 3], l: [1, 2, 3], c: [1, 2, 3], v: [1, 1, 1], frgn: [5, null, 7], hasVol: true, flowUnit: 'shares' };
  const a = SM.cutRaw(raw, '2025-01-02'); assert.deepEqual(a.d, ['2025-01-01', '2025-01-02']); assert.deepEqual(a.frgn, [5, null]); assert.equal(a.hasVol, true); assert.equal(a.flowUnit, 'shares');
  assert.equal(SM.cutRaw(raw, '2025-01-10').d.length, 3); assert.equal(SM.cutRaw(raw, '2024-12-31').d.length, 0); assert.equal(raw.d.length, 3); // 원본은 그대로
  assert.equal(SM.cutRaw(raw, '2025-01-02').c.length, 2);
});
t('배수 분할매수(물타기) 사이클: 10주→20주→40주, 평단 +5% 전량 매도 후 재시작', () => {
  const cl = [100, 100, 89, 79, 85, 90, 90, 90], d = { d: [], o: cl.slice(), h: cl.slice(), l: cl.slice(), c: cl.slice(), v: cl.map(() => 1000), hasVol: true, hasHL: true };
  const dt = new Date('2024-01-01'); cl.forEach(() => { d.d.push(dt.toISOString().slice(0, 10)); dt.setDate(dt.getDate() + 1); });
  const cfg = mk([{ type: 'dropLast', pct: 10, basis: 'last', first: 'yes' }], [{ type: 'avgPct', dir: 'up', pct: 5 }], { fill: 'close', qty: 10, growth: 2 });
  const r = SM.runBacktest(d, cfg, S);
  assert.deepEqual(r.buys.slice(0, 3).map((b) => [b.price, b.qty]), [[100, 10], [89, 20], [79, 40]]); // 10 → 20 → 40
  assert.equal(r.cycles.length, 1); const c = r.cycles[0];
  assert.equal(c.lots, 3); assert.equal(c.maxLots, 3); assert.equal(c.qty, 70); assert.equal(c.startDate, d.d[0]); assert.equal(c.endDate, d.d[5]); assert.equal(c.days, 5); // 평단 84.86 → 목표 89.1 → 종가 90에서 청산
  assert(Math.abs(c.peakInv - 5940) < 60, 'peakInv ' + c.peakInv); assert(c.realized > 0 && c.ret > 0); assert(c.worst < 0, '중간에는 평가손실'); assert.equal(c.lowPrice, 79); assert.equal(c.firstPrice, 100);
  assert(r.openCycle && r.openCycle.open && r.openCycle.lots === 1 && r.openCycle.startDate === d.d[6]); // 청산 다음 날 다시 시작
  assert.equal(r.cycleStats.count, 1); assert.equal(r.cycleStats.maxLots, 3); assert.equal(r.cycleStats.avgDays, 5); assert.equal(r.cycleStats.wins, 1); assert(r.cycleStats.worst < 0);
  // 사이클 번호·순서·매수별 평단(차트 표시와 펼침 표의 재료)
  assert.deepEqual(r.buys.map((b) => [b.cyc, b.seq]), [[1, 1], [1, 2], [1, 3], [2, 1]]); assert.deepEqual(r.buys.map((b) => SM.cycleLabel(b.cyc, b.seq)), ['1', '1-2', '1-3', '2']);
  assert.deepEqual(c.buys.map((b) => [b.seq, b.price, b.qty, b.cumQty]), [[1, 100, 10, 10], [2, 89, 20, 30], [3, 79, 40, 70]]);
  assert(Math.abs(c.buys[1].avg - (1000 + 1780) / 30) < 1e-9 && Math.abs(c.buys[2].avg - 5940 / 70) < 1e-9); assert.equal(c.buys[2].close, 79); assert.equal(c.no, 1); assert.equal(r.openCycle.no, 2); assert.equal(c.sellQty, 70);
  { // 매도: 이동평균 5일선이 15일선 아래로 데드크로스 → 보유 순번 전량 매도(손실일 수도 있음)
    const px = []; for (let i = 0; i < 40; i++) px.push(100 + 10 * Math.sin(i / 4) - i * 0.3); // 오르내리는 하락 추세
    const dd = { d: [], o: px.slice(), h: px.slice(), l: px.slice(), c: px.slice(), v: px.map(() => 1000), hasVol: true, hasHL: true }, d0 = new Date('2024-01-01'); px.forEach(() => { dd.d.push(d0.toISOString().slice(0, 10)); d0.setDate(d0.getDate() + 1); });
    const cc = mk([{ type: 'dropLast', pct: 3, basis: 'last', first: 'yes' }], [{ type: 'maCross', ma: 'sma', s: 5, l: 15, dir: 'down' }], { fill: 'close', qty: 10, growth: 2 });
    const rr = SM.runBacktest(dd, cc, S); assert(rr.cycles.length >= 1, '데드크로스로 청산된 사이클 있음'); assert(rr.trades.every((t) => t.reason === '신호 청산' || t.reason == null || typeof t.reason === 'string'));
    const sma5 = SM.sma(px, 5), sma15 = SM.sma(px, 15), crossIdx = []; for (let i = 15; i < px.length; i++) if (sma5[i - 1] >= sma15[i - 1] && sma5[i] < sma15[i]) crossIdx.push(i);
    assert(rr.cycles.every((x) => crossIdx.includes(x.endIdx)), '모든 사이클 종료일은 데드크로스 날짜'); assert(rr.cycles[0].buys.length >= 1);
  }
  // 사이클 통계(평균·최대·분포)와 재생용 도우미
  assert.equal(r.cycleStats.avgLots, 3); assert.equal(r.cycleStats.maxLotsDone, 3); assert.equal(r.cycleStats.maxQty, 70); assert.equal(r.cycleStats.avgQty, 70); assert.deepEqual(r.cycleStats.dist, { 3: 1 }); assert(Math.abs(r.cycleStats.maxInvestDone - c.peakInv) < 1e-9);
  assert.deepEqual(c.buys.map((b) => b.lot), [1, 2, 3]);
  { const a = SM.cyclesAsOf(r.cycles.concat([r.openCycle]), d.d[3]); // 4번째 날(79에서 3번째 매수) 시점: 1사이클은 아직 진행 중
    assert.equal(a.length, 1); assert.equal(a[0].open, true); assert.equal(a[0].buys.length, 3); assert.equal(a[0].endDate, d.d[3]); const a2 = SM.cyclesAsOf(r.cycles, d.d[2]); assert.equal(a2[0].buys.length, 2); // 3번째 매수는 d[3] 종가에 체결되므로 d[2] 시점에는 없음
    const b = SM.cyclesAsOf(r.cycles.concat([r.openCycle]), d.d[7]); assert.equal(b.length, 2); assert.equal(b[0].open, undefined); assert.equal(b[1].open, true); }
  { const st = SM.replayState(r, d, d.d[3]); assert.equal(st.buyCount, 3); assert.equal(st.qty, 70); assert(Math.abs(st.avg - 5940 / 70) < 1e-9); assert.equal(st.cyc, 1); assert.equal(st.close, 79); assert(st.unrealized < 0); assert.equal(st.realized, 0); assert.deepEqual(st.today.map((x) => x.label), ['1-3']);
    const sd = SM.replayState(r, d, d.d[5]); assert.equal(sd.qty, 0); assert(sd.realized > 0); assert.equal(sd.buyCount, 0); assert.equal(sd.cyclesDone, 1); assert.equal(sd.today[0].t, 'sell'); assert.equal(SM.replayState(r, d, '2000-01-01'), null); }
  const lim = SM.runBacktest(d, Object.assign({}, cfg, { maxLots: 2 }), S); assert.equal(lim.cycleStats.maxLots, 2); // 최대 순번 제한
});
t('분할매수 조건/최대투입금/수량증가', () => {
  const n = 120, d = { d: [], o: [], h: [], l: [], c: [], v: [], hasVol: true, hasHL: true };
  const dt = new Date('2024-01-01'); let p = 10000;
  for (let i = 0; i < n; i++) { const o = p; p *= 0.985; dt.setDate(dt.getDate() + 1); d.d.push(dt.toISOString().slice(0, 10)); d.o.push(o); d.c.push(p); d.h.push(o); d.l.push(p); d.v.push(1000); }
  const base = mk([{ type: 'dropLast', pct: 3, basis: 'last', first: 'yes' }], []);
  const r1 = SM.runBacktest(d, base, S), r2 = SM.runBacktest(d, Object.assign({}, base, { maxInvest: 500000 }), S), r3 = SM.runBacktest(d, Object.assign({}, base, { growth: 1.5 }), S);
  assert(r1.summary.buyCount > 3);
  assert(r2.summary.peakInvested <= 500000 + 1e-6, 'peak ' + r2.summary.peakInvested);
  assert(r2.summary.skipped > 0);
  assert(r3.buys[2].qty > r3.buys[0].qty);
  // 매수 간격이 항상 직전 매수가 대비 3% 이상 하락인지
  for (let i = 1; i < r1.buys.length; i++) assert(r1.buys[i].price <= r1.buys[i - 1].price * 0.97 + 1e-9);
});
t('기간 분할 검증', () => {
  const data = synth(400);
  const v = SM.runSplitValidation(data, mk([{ type: 'maCross', ma: 'sma', s: 5, l: 20, dir: 'up' }], [{ type: 'maCross', ma: 'sma', s: 5, l: 20, dir: 'down' }]), S, data.d[250]);
  assert(!v.a.error && !v.b.error);
  assert(v.a.endIdx < v.b.startIdx);
});
t('수급 표 불러오기(열 추정/병합)', () => {
  const data = { d: ['2025-01-02', '2025-01-03', '2025-01-06'], o: [1, 1, 1], h: [1, 1, 1], l: [1, 1, 1], c: [1, 1, 1], v: [1, 1, 1] };
  const tb = SM.parseTable('날짜\t종가\t기관\t외국인\t외국인보유율\n2025.01.06\t10\t-1,200\t+3,400\t50.1%\n2025.01.03\t10\t(500)\t▼700\t50.0%\n2025.01.02\t10\t0\t10\t49.9%\n2024.12.30\t10\t1\t1\t1');
  const cols = SM.guessFlowCols(tb.header);
  assert.deepEqual([cols.date, cols.inst, cols.frgn, cols.indiv], [0, 2, 3, -1]);
  const m = SM.mergeFlow(data, tb, cols);
  assert.equal(m.matched, 3); assert.equal(m.unmatched, 1);
  assert.deepEqual(m.arrs.frgn, [10, -700, 3400]); assert.deepEqual(m.arrs.inst, [0, -500, -1200]);
});
t('백테스트: 손으로 만든 예 (체결가=다음날 시가, TP)', () => {
  const data = { d: ['2025-01-01','2025-01-02','2025-01-03','2025-01-04','2025-01-05','2025-01-06'], o: [10,10,20,20,22,22], h: [10,10,20,20,22,22], l: [10,10,20,20,22,22], c: [10,10,20,20,22,22], v: [0,5,5,0,0,0], hasVol: true, hasHL: true };
  const cfg = mk([{ type: 'vol', n: 5 }], [{ type: 'tp', pct: 5 }], { qty: 1, fill: 'nextOpen' });
  const z = SM.DEFAULT_SETTINGS(); z.kr = { buyFee: 0, sellFee: 0, sellTax: 0 };
  const r = SM.runBacktest(data, cfg, z);
  // 01-02 신호 → 01-03 시가 20에 매수(1번), 01-03 신호 → 01-04 시가 20에 매수(2번). 01-03 종가20 → 수익0 이라 TP 없음. 01-05 종가22(+10%) → 01-06 시가 22 매도
  assert.equal(r.buys.length, 2); assert.equal(r.trades.length, 2);
  approx(r.summary.realized, 4);
});

const rowsN = (n, f) => Array.from({ length: n }, (_, i) => f(i));
t('불러오기: 앞에 설명 줄이 있어도 제목 줄 자동 인식', () => {
  const txt = '한국전력 일별 시세\n조회기간: 2025-01-01 ~ 2025-01-10\n\n일자,종가,대비,등락률,시가,고가,저가,거래량,거래대금,시가총액,상장주식수\n' + rowsN(6, (i) => `2025/01/0${i + 2},"${20000 + i * 100}",100,0.5%,"${19900 + i * 100}","${20100 + i * 100}","${19800 + i * 100}","${1000000 + i}",1,2,3`).join('\n');
  const r = SM.parseOHLCV(txt); assert(r.data, r.error);
  assert.equal(r.count, 6); assert.equal(r.data.o[0], 19900); assert.equal(r.data.v[0], 1000000); assert.equal(r.data.c[5], 20500);
  assert(!r.data.frgn);
});
t('불러오기: investing.com 영문 (Jan 02, 2025 / Vol. 1.2M / Price)', () => {
  const days = ['Jan 06, 2025', 'Jan 03, 2025', 'Jan 02, 2025', 'Dec 31, 2024', 'Dec 30, 2024'];
  const txt = '"Date","Price","Open","High","Low","Vol.","Change %"\n' + days.map((d, i) => `"${d}","1,${200 - i}.50","1,190.00","1,210.00","1,180.00","${(1.2 + i / 10).toFixed(1)}M","0.5%"`).join('\n');
  const r = SM.parseOHLCV(txt); assert(r.data, r.error);
  assert.equal(r.data.d[0], '2024-12-30'); assert.equal(r.data.d[4], '2025-01-06'); approx(r.data.v[4], 1200000); approx(r.data.v[0], 1600000); approx(r.data.c[4], 1200.5);
});
t('불러오기: 한글 investing / 2025년 1월 2일 / K 단위', () => {
  const txt = '날짜,종가,오픈,고가,저가,거래량,변동 %\n' + rowsN(5, (i) => `"2025년 1월 ${2 + i}일","${3000 + i}","2,990","3,100","2,950","${350 + i}K","1%"`).join('\n');
  const r = SM.parseOHLCV(txt); assert(r.data, r.error);
  assert.equal(r.data.d[0], '2025-01-02'); assert.equal(r.data.v[0], 350000); assert.equal(r.data.o[0], 2990);
});
t('불러오기: 네이버식 공백 구분 붙여넣기("상승 100" 제거)', () => {
  const txt = '날짜 종가 전일비 등락률 시가 고가 저가 거래량\n' + rowsN(6, (i) => `2025.01.${String(10 - i).padStart(2, '0')} 10,${i}00 ${i % 2 ? '하락' : '상승'} 100 +1.00% 9,900 10,100 9,800 123,456`).join('\n');
  const r = SM.parseOHLCV(txt); assert(r.data, r.error);
  assert.equal(r.count, 6); assert.equal(r.data.d[0], '2025-01-05'); assert.equal(r.data.v[0], 123456); assert.equal(r.data.o[0], 9900); assert.equal(r.data.h[0], 10100);
});
t('불러오기: 가격+수급이 한 파일에 있으면 함께 읽음', () => {
  const txt = '날짜\t시가\t고가\t저가\t종가\t거래량\t기관 순매수\t외국인 순매수\t외국인 보유율\n' + rowsN(6, (i) => `2025-01-0${i + 1}\t100\t110\t90\t105\t1,000\t${i * 10 - 20}\t▼${i * 5}\t50.1%`).join('\n');
  const r = SM.parseOHLCV(txt); assert(r.data, r.error);
  assert.deepEqual(r.data.inst.slice(0, 3), [-20, -10, 0]); assert.equal(r.data.frgn[1], -5); assert.equal(r.data.frgn[0], 0);
  assert(r.warnings.some((w) => /수급 열/.test(w)));
});
t('열 자동 추정/종류 판별/저장된 열 설정', () => {
  const tFlow = SM.splitTable('날짜\t기관\t외국인\n2025.01.02\t1\t2\n2025.01.03\t3\t4');
  const an = SM.analyzeTable(tFlow); assert.equal(an.kind, 'flow');
  const tPrice = SM.splitTable('Date,Open,High,Low,Close,Volume\n2025-01-02,1,2,0,1,5\n2025-01-03,1,2,0,1,5');
  assert.equal(SM.analyzeTable(tPrice).kind, 'price');
  const odd = SM.splitTable('가,나,다\n2025-01-02,1,2');
  assert.equal(SM.analyzeTable(odd).kind, 'unknown');
  const sig = SM.analyzeTable(odd).signature;
  const saved = { [sig]: { date: 0, close: 1, open: -1, high: -1, low: -1, volume: 2, adj: -1, frgn: -1, inst: -1, indiv: -1 } };
  const an2 = SM.analyzeTable(odd, saved); assert(an2.fromSaved); assert.equal(an2.kind, 'price');
});
t('데이터 이어붙이기(겹침/추가/수급 보존/가격 불일치 감지)', () => {
  const mk2 = (days, base, flow) => ({ d: days, o: days.map(() => base), h: days.map(() => base), l: days.map(() => base), c: days.map(() => base), v: days.map(() => 1), hasVol: true, hasHL: true, frgn: flow ? days.map((_, i) => i) : undefined });
  const a = mk2(['2025-01-02', '2025-01-03', '2025-01-06'], 100, true);
  const b = mk2(['2025-01-06', '2025-01-07'], 100.2);
  const m = SM.mergeDatasets(a, b);
  assert.equal(m.data.d.length, 4); assert.equal(m.added, 1); assert.equal(m.overlap, 1); assert.equal(m.mismatch, 0);
  assert.deepEqual(m.data.frgn, [0, 1, 2, null]);  // 기존 수급 유지
  const c = SM.mergeDatasets(a, mk2(['2025-01-06'], 50)); assert.equal(c.mismatch, 1);
});


t('이어붙이기: 수급 표(시가·고가·저가 없음)는 기존 OHLC를 보존 + 같은 종목 판별', () => {
  const days = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08'];
  const a = { d: days, o: [10, 11, 12, 13, 14], h: [11, 12, 13, 14, 15], l: [9, 10, 11, 12, 13], c: [10.5, 11.5, 12.5, 13.5, 14.5], v: [100, 100, 100, 100, 100], hasVol: true, hasHL: true, hasOpen: true };
  const tb = SM.splitTable('날짜\t종가\t거래량\t기관\t외국인\n' + days.map((d, i) => `${d.replace(/-/g, '.')}\t${10.5 + i}\t${200 + i}\t${i}\t${-i}`).join('\n'));
  const an = SM.analyzeTable(tb); assert.equal(an.kind, 'both');
  const b = SM.buildDataset(tb, an.cols).data;
  assert.equal(b.hasOpen, false); assert.equal(b.hasHL, false);
  const m = SM.mergeDatasets(a, b);
  assert.deepEqual(m.data.o, a.o); assert.deepEqual(m.data.h, a.h); assert.deepEqual(m.data.l, a.l);   // 보존
  assert.deepEqual(m.data.v, [200, 201, 202, 203, 204]);                                                // 거래량·수급은 갱신
  assert.deepEqual(m.data.inst, [0, 1, 2, 3, 4]); assert.deepEqual(m.data.frgn, [0, -1, -2, -3, -4]);
  assert(m.keptOHLC);
  const sc = SM.sameStockScore(a, b); assert.equal(sc.overlap, 5); assert.equal(sc.ratio, 1);
  const other = Object.assign({}, b, { c: b.c.map((x) => x * 3) }); assert.equal(SM.sameStockScore(a, other).ratio, 0);
});


t('매수 미리보기: 평단 변화/총액/손익분기/시나리오', () => {
  const st = SM.newStock({ name: '삼성', market: 'KR' });
  SM.addLot(st, { qty: 10, price: 60000, fee: 0 }, S); SM.addLot(st, { qty: 20, price: 40000, fee: 0 }, S); st.price = 50000;
  const p = SM.lotPreview(st, { price: 50000, qty: 10, fee: 0 }, S, null, '2026-11-27');
  assert(p.ok); approx(p.before.avg, 46666.6667, 1e-3); approx(p.after.avg, 47500); assert.equal(p.after.qty, 40);
  approx(p.change.avg, 47500 / 46666.6667 - 1, 1e-6); approx(p.buy.total, 500000); approx(p.change.cost, 500000);
  const d = 1 - (S.kr.sellFee + S.kr.sellTax) / 100; approx(p.breakEven.after, 47500 / d, 1e-6);
  approx(p.riseNeeded, 47500 / d / 50000 - 1, 1e-6);
  // 현재가 50000 기준: 평가손익 before = 30*...  (30주 × 50000 − 1,400,000 = 100,000), after = 40주 × 50000 − 1,900,000 = 100,000
  approx(p.unrl.before, 100000); approx(p.unrl.after, 100000);
  // -10%: before = 30*45000 − 1,400,000 = −50,000 / after = 40*45000 − 1,900,000 = −100,000
  approx(p.down10.before, -50000); approx(p.down10.after, -100000); approx(p.down10.extra, -50000);
  assert.deepEqual(p.warnings, []);
});
t('매수 미리보기: 입력 부족/경고/수수료 자동·직접', () => {
  const st = SM.newStock({ name: 'A', market: 'KR' }); st.price = 10000;
  assert(!SM.lotPreview(st, { price: 100, qty: '' }, S).ok);
  const p = SM.lotPreview(st, { price: 20000, qty: 10.5, date: '2099-01-01', fee: '' }, S, null, '2026-11-27');
  assert(p.ok && p.feeAuto); assert.equal(p.before.qty, 0); assert.equal(p.change.avg, null);
  assert.equal(p.warnings.length, 3, p.warnings.join('|'));  // 현재가와 100% 차이, 미래 날짜, 소수 수량
  approx(p.buy.fee, 10.5 * 20000 * 0.00015);
  const p2 = SM.lotPreview(st, { price: 10000, qty: 10, fee: 20000 }, S); assert(!p2.feeAuto); assert(p2.warnings.some((w) => /수수료/.test(w)));
});
t('매수 미리보기: 수정 모드(수정 전→후), 매도된 수량 보호, 해외 원화', () => {
  const st = SM.newStock({ name: 'AAPL', market: 'US' });
  const l1 = SM.addLot(st, { qty: 10, price: 100, fx: 1300, fee: 0 }, S), l2 = SM.addLot(st, { qty: 10, price: 200, fx: 1400, fee: 0 }, S);
  const p = SM.lotPreview(st, { price: 150, qty: 10, fx: 1300, fee: 0 }, S, l2.id);
  assert(p.editing); approx(p.before.avg, 150); approx(p.after.avg, 125); approx(p.before.avgKRW, (10 * 100 * 1300 + 10 * 200 * 1400) / 20); approx(p.after.avgKRW, (10 * 100 * 1300 + 10 * 150 * 1300) / 20);
  SM.recordSale(st, SM.computeSale(st, [{ lotId: l1.id, qty: 6 }], { price: 120, fx: 1350, sellFee: 0, tax: 0 }, S));
  const q = SM.lotPreview(st, { price: 100, qty: 4, fx: 1300, fee: 0 }, S, l1.id);
  assert(q.errors.some((e) => /매도되어/.test(e)));
  assert(SM.lotPreview(st, { price: 100, qty: 10, fx: 0, fee: 0 }, S).errors.length === 1);
});
t('금액으로 수량 계산', () => {
  const kr = SM.newStock({ name: 'K', market: 'KR' });
  let r = SM.qtyForAmount(kr, 1000000, 70000, S, ''); assert.equal(r.qty, 14); assert(r.used <= 1000000 && r.rest >= 0);
  r = SM.qtyForAmount(kr, 70000, 70000, S, ''); assert.equal(r.qty, 0);          // 수수료 때문에 1주도 못 삼
  r = SM.qtyForAmount(kr, 1000000, 70000, S, 5000); assert.equal(r.qty, 14); approx(r.used, 14 * 70000 + 5000);
  const us = SM.newStock({ name: 'U', market: 'US' }); r = SM.qtyForAmount(us, 1000, 333, S, ''); assert(r.qty > 2.9 && r.qty < 3 && Math.abs(r.qty * 1e4 - Math.round(r.qty * 1e4)) < 1e-6);
  assert.equal(SM.qtyForAmount(kr, '', 100, S, '').qty, 0);
});


const Z = SM.paperSettings(S, false);
t('관심/가상 장부 기본값, 기존 데이터 호환', () => {
  const st = SM.normalizeState({ stocks: [{ name: 'old', market: 'KR', lots: [], sales: [] }] }).stocks[0];
  assert.equal(st.watch, false); assert.deepEqual(st.paper.lots, []); assert.equal(st.paper.nextNo, 1); assert.equal(st.paper.fee, true); assert.deepEqual(st.plan, []);
  const w = SM.newStock({ name: 'W', market: 'KR', watch: true }); assert(w.watch && w.watchAt > 0 && w.paper.lots.length === 0);
});
t('가상 장부: 실제 함수 재사용(순번/매도/삭제/병합), 실제 장부와 분리', () => {
  const st = SM.newStock({ name: 'W', market: 'KR', watch: true }); st.price = 100000;
  const pv = SM.paperStock(st);
  const a = SM.addLot(pv, { date: '2026-10-01', qty: 10, price: 60000, fee: 0 }, Z), b = SM.addLot(pv, { date: '2026-10-20', qty: 20, price: 40000, fee: 0 }, Z);
  assert.equal(a.no, 1); assert.equal(b.no, 2); assert.equal(st.paper.nextNo, 3); assert.equal(st.lots.length, 0); assert.equal(st.paper.lots.length, 2);
  SM.tagPaper(a, '2026-11-27'); SM.tagPaper(b, '2026-10-01'); assert.equal(a.pre, false); assert.equal(b.pre, true);
  const c = SM.computeSale(pv, [{ lotId: b.id, qty: 10 }], { price: 100000, date: '2026-11-01', sellFee: 0, tax: 0 }, Z);
  approx(c.pnlLocal, 600000); const sale = SM.recordSale(pv, c); SM.tagPaper(sale, '2026-11-27');
  assert.equal(st.paper.sales.length, 1); assert.equal(st.sales.length, 0); assert.equal(SM.lotRem(pv, b), 10);
  const c1 = SM.addLot(pv, { date: '2026-11-02', qty: 5, price: 50000, fee: 0 }, Z), d1 = SM.addLot(pv, { date: '2026-11-03', qty: 5, price: 70000, fee: 0 }, Z);
  const mg = SM.mergeLots(pv, [c1.id, d1.id]); assert.equal(mg.qty, 10); approx(mg.price, 60000); assert.equal(st.paper.lots.length, 3); assert.equal(st.lots.length, 0);
  SM.unmergeLot(pv, mg.id); assert.equal(st.paper.lots.length, 4);
  SM.deleteLot(pv, c1.id); assert.equal(st.paper.lots.length, 3);
  assert.throws(() => SM.deleteLot(pv, b.id));              // 매도 기록이 있는 순번은 삭제 불가
});
t('가상 손익 통계: 실현/평가/투입 최대/승률/사전·사후', () => {
  const st = SM.newStock({ name: 'W', market: 'KR', watch: true }); st.price = 100000;
  const pv = SM.paperStock(st);
  const a = SM.addLot(pv, { date: '2026-10-01', qty: 10, price: 60000, fee: 0 }, Z), b = SM.addLot(pv, { date: '2026-10-20', qty: 20, price: 40000, fee: 0 }, Z);
  SM.tagPaper(a, '2026-12-01'); SM.tagPaper(b, '2026-10-01');   // a: 사후 입력, b: 사전 기록
  const sale = SM.recordSale(pv, SM.computeSale(pv, [{ lotId: b.id, qty: 10 }], { price: 100000, date: '2026-11-01', sellFee: 0, tax: 0 }, Z)); SM.tagPaper(sale, '2026-12-01');
  st.paper.fee = false;
  const p = SM.paperStats(st, S);
  approx(p.realized, 600000);                                 // 10주 × (100000−40000)
  approx(p.unrealized, 10 * (100000 - 60000) + 10 * (100000 - 40000)); // 남은 a 10주 + b 10주
  approx(p.total, 600000 + 400000 + 600000);
  approx(p.peak, 10 * 60000 + 20 * 40000);                     // 매도 전 최대 투입 1,400,000
  approx(p.ret, 1600000 / 1400000, 1e-9); assert.equal(p.closed, 1); assert.equal(p.winRate, 1);
  assert.equal(p.pre.lots, 1); assert.equal(p.post.lots, 1); assert.equal(p.post.sales, 1); approx(p.post.realized, 600000);
  // 수수료·세금은 입력하는 시점의 금액이 저장됩니다(실제 매매와 동일). 켠 상태로 새로 입력하면 수수료가 붙음
  const withFee = SM.addLot(SM.paperStock(st), { date: '2026-11-05', qty: 10, price: 50000 }, SM.paperSettings(S, true)); assert(withFee.fee > 0);
  const noFee = SM.addLot(SM.paperStock(st), { date: '2026-11-05', qty: 10, price: 50000 }, SM.paperSettings(S, false)); assert.equal(noFee.fee, 0);
});
t('관심 종목 목표가 거리', () => {
  const st = SM.newStock({ name: 'W', market: 'KR', watch: true });
  assert.equal(SM.watchGap(st), null);
  st.target = 20000; assert.equal(SM.watchGap(st).gap, null);
  st.price = 22000; approx(SM.watchGap(st).gap, 0.1); assert(!SM.watchGap(st).reached);
  st.price = 19000; assert(SM.watchGap(st).reached);
});
t('분할 매수 계획: 누적 평단/실제 보유 합산/완료 제외', () => {
  const st = SM.newStock({ name: 'W', market: 'KR', watch: true }); st.price = 21000;
  SM.addPlan(st, { price: 18000, qty: 20 }); const first = SM.addPlan(st, { price: 20000, qty: 10 });
  assert.throws(() => SM.addPlan(st, { price: 0, qty: 1 }));
  const zero = Object.assign({}, S, { kr: { buyFee: 0, sellFee: 0, sellTax: 0 } });
  let p = SM.planPreview(st, zero);
  assert.deepEqual(p.steps.map((x) => x.price), [20000, 18000]);                // 가격 높은 순
  approx(p.steps[0].cumAvg, 20000); approx(p.steps[1].cumAvg, (200000 + 360000) / 30); approx(p.final.avg, 560000 / 30);
  approx(p.planned, 560000); assert.equal(p.final.qty, 30); approx(p.riseNeeded, 560000 / 30 / 21000 - 1, 1e-9);
  first.done = true; p = SM.planPreview(st, zero); assert.equal(p.steps.length, 1); approx(p.final.avg, 18000);
  SM.addLot(st, { date: '2026-10-01', qty: 10, price: 25000, fee: 0 }, zero);     // 실제 보유가 생기면 함께 계산
  p = SM.planPreview(st, zero); approx(p.base.avg, 25000); approx(p.final.avg, (250000 + 360000) / 30); assert(p.avgChange < 0);
  SM.removePlan(st, st.plan[0].id); assert.equal(st.plan.length, 1);
});
t('액면분할이 가상 장부·계획·목표가에도 적용', () => {
  const st = SM.newStock({ name: 'W', market: 'KR', watch: true }); st.price = 100000; st.target = 90000;
  const pv = SM.paperStock(st); SM.addLot(pv, { date: '2026-10-01', qty: 10, price: 60000, fee: 0 }, Z); SM.addPlan(st, { price: 50000, qty: 4 });
  const before = SM.paperStats(st, S);
  SM.splitAdjust(st, 5);
  assert.equal(st.paper.lots[0].qty, 50); approx(st.paper.lots[0].price, 12000); assert.equal(st.plan[0].qty, 20); approx(st.plan[0].price, 10000); approx(st.target, 18000); approx(st.price, 20000);
  approx(SM.paperStats(st, S).total, before.total);
});
t('가격 데이터: 날짜의 종가 찾기, 같은 투입금 단순 보유', () => {
  const data = { d: ['2026-01-02', '2026-01-05', '2026-01-06'], o: [10, 11, 12], h: [10, 11, 12], l: [10, 11, 12], c: [10, 11, 12], v: [1, 1, 1] };
  assert.deepEqual([SM.closeOn(data, '2026-01-05').price, SM.closeOn(data, '2026-01-05').exact], [11, true]);
  const g = SM.closeOn(data, '2026-01-04'); assert.equal(g.price, 10); assert.equal(g.exact, false);   // 휴장 → 직전 거래일
  assert.equal(SM.closeOn(data, '2025-12-31'), null); assert.equal(SM.closeOn(data, '2026-02-20'), null);
  const bh = SM.buyHoldFrom(data, '2026-01-02', 1000, Zs(), 'KR'); approx(bh.ret, 12 / 10 - 1, 1e-9); assert.equal(bh.startDate, '2026-01-02');
  function Zs() { return Object.assign({}, S, { kr: { buyFee: 0, sellFee: 0, sellTax: 0 } }); }
});
t('자동 수집 대상 목록: 관심 종목은 켠 것만', () => {
  require('../data.js');
  const list = [{ market: 'KR', code: '015760', name: 'A', watch: false }, { market: 'KR', code: '005930', name: 'B', watch: true, collect: false }, { market: 'KR', code: '000660', name: 'C', watch: true, collect: true }, { market: 'US', code: 'AAPL', name: 'D' }, { market: 'KR', code: '12', name: 'E' }];
  assert.deepEqual(JSON.parse(SM.data.watchJson(list)).stocks.map((x) => x.code), ['015760', '000660']);
});


t('링크 열기 설정 기본값/정규화', () => {
  const d = SM.normalizeState({});
  assert.equal(d.settings.linkMode, 'tab'); assert.deepEqual(d.settings.linkTabHosts, []);
  const e = SM.normalizeState({ settings: { linkMode: 'app', linkTabHosts: ['a.com', 5, 'b.com'] } });
  assert.equal(e.settings.linkMode, 'app'); assert.deepEqual(e.settings.linkTabHosts, ['a.com', 'b.com']);
  assert.equal(SM.normalizeState({ settings: { linkMode: 'weird' } }).settings.linkMode, 'tab');
  assert.equal(SM.normalizeState({ settings: { linkMode: 'browser' } }).settings.linkMode, 'browser');
});


t('수급: KRX식 표 — 기관합계가 없으면 7개 열 합산, 빈 칸은 0 취급, 모두 비면 비움, 금액 단위 판정', () => {
  const px = 'date,open,high,low,close,volume\n' + [1, 2, 3, 4, 5, 6].map((d) => `2026-01-0${d},100,110,90,100,1000000`).join('\n');
  const data = SM.parseOHLCV(px).data;
  const flow = '일자,금융투자,보험,투신,사모,은행,기타금융,연기금 등,기타법인,개인,외국인,기타외국인,전체\n'
    + '"2026/01/06","100000000","200000000",,"300000000",,"-50000000","10","-5","-9","-30000000000","7","0"\n'
    + '"2026/01/05",,,,,,,,"1","2","3","4","0"\n'
    + '"2026/01/04","1","1","1","1","1","1","1","0","-9","8","0","0"';
  const tb = SM.splitTable(flow), an = SM.analyzeTable(tb);
  assert.deepEqual(an.cols.instSum, [1, 2, 3, 4, 5, 6, 7]); assert.equal(an.cols.inst, -1); assert.equal(an.cols.frgn, 10); assert.equal(an.cols.indiv, 9);
  assert.equal(SM.kindOf(an.cols), 'flow');
  const m = SM.mergeFlow(data, tb, an.cols);
  const i6 = data.d.indexOf('2026-01-06'), i5 = data.d.indexOf('2026-01-05'), i4 = data.d.indexOf('2026-01-04');
  approx(m.arrs.inst[i6], 100000000 + 200000000 + 300000000 - 50000000 + 10); // 투신·은행 빈 칸은 0
  assert.equal(m.arrs.inst[i5], null, '합산 대상이 모두 비면 수급 없음'); assert.equal(m.arrs.inst[i4], 7);
  assert.equal(m.arrs.frgn[i6], -30000000000); assert.equal(m.unit, 'krw'); // 값이 거래량보다 훨씬 큼
  assert.equal(SM.mergeFlow(data, tb, an.cols, { unit: 'shares' }).unit, 'shares'); // 수동 지정 우선
  // 사용자가 기관 열을 직접 지정하면 그 열만 사용
  const m2 = SM.mergeFlow(data, tb, Object.assign({}, an.cols, { inst: 1, instSum: undefined }));
  assert.equal(m2.arrs.inst[i6], 100000000);
  // 저장된 열 설정(배열 포함) 복원
  assert.deepEqual(SM.analyzeTable(tb, { [an.signature]: an.cols }).cols.instSum, [1, 2, 3, 4, 5, 6, 7]);
});
t('수급: 주 단위 판정, 단위 불일치 병합 표시, 금액 단위 비율 조건, 합친 뒤 조건 동작', () => {
  const px = 'date,open,high,low,close,volume\n' + [1, 2, 3, 4, 5, 6, 7].map((d) => `2026-01-0${d},100,110,90,${100 + d},1000000`).join('\n');
  const base = SM.parseOHLCV(px).data;
  const withFlow = (txt) => { const tb = SM.splitTable(txt), an = SM.analyzeTable(tb); const m = SM.mergeFlow(base, tb, an.cols); const d = Object.assign({}, base); ['frgn', 'inst', 'indiv'].forEach((k) => { if (m.arrs[k]) d[k] = m.arrs[k]; }); d.flowUnit = m.unit; return d; };
  const shares = withFlow('날짜,외국인,기관,개인\n2026-01-05,200000,1,1\n2026-01-06,300000,1,1\n2026-01-07,-400000,1,1');
  assert.equal(shares.flowUnit, 'shares');
  const krw = withFlow('날짜,외국인,기관,개인\n2026-01-05,20000000000,1,1\n2026-01-06,30000000000,1,1\n2026-01-07,-40000000000,1,1');
  assert.equal(krw.flowUnit, 'krw');
  assert.equal(SM.mergeDatasets(shares, krw).unitMismatch, true); assert.equal(SM.mergeDatasets(shares, shares).unitMismatch, false);
  const run = (data, cond) => SM.runBacktest(data, Object.assign(SM.blankCfg(), { qty: 1, from: '2026-01-01', to: '2026-01-07', entries: { mode: 'AND', conds: [cond] } }), S);
  assert.equal(run(shares, { type: 'flow', who: 'frgn', dir: 'buy', mode: 'day', v: 250000 }).summary.buyCount, 1); // 1/06만
  // 비율: 주 단위는 순매수/거래량, 금액 단위는 순매수/(거래량×종가)
  assert.equal(run(shares, { type: 'flow', who: 'frgn', dir: 'buy', mode: 'ratio', v: 25 }).summary.buyCount, 1);
  // 금액 단위: 2e10/(1e6×105)=19,048%, 3e10/(1e6×106)=28,302% → 기준 25,000%면 1/06만. (거래량으로만 나누면 두 날 다 참이 되어 2건)
  assert.equal(run(krw, { type: 'flow', who: 'frgn', dir: 'buy', mode: 'ratio', v: 25000 }).summary.buyCount, 1);
});
console.log(ok + ' passed');
t('수급: 금액(원)→수량(주) 환산 저장', () => {
  const px = 'date,open,high,low,close,volume\n' + [1, 2, 3, 4, 5, 6].map((d) => `2026-01-0${d},100,110,90,${100 * d},1000000`).join('\n');
  const data = SM.parseOHLCV(px).data;
  const tb = SM.splitTable('날짜,외국인,기관,개인\n2026-01-03,30000000000,-6000000000,1\n2026-01-04,,40000000000,2');
  const an = SM.analyzeTable(tb);
  const m = SM.mergeFlow(data, tb, an.cols, { unit: 'krwToShares' });
  assert.equal(m.unit, 'shares'); assert.equal(m.arrs.frgn[2], 100000000); assert.equal(m.arrs.inst[2], -20000000); assert.equal(m.arrs.frgn[3], null);
  const t2 = SM.splitTable('날짜,종가,외국인\n' + [1, 2, 3, 4, 5].map((d) => `2026-02-0${d},${1000 * d},${d * 5000000}`).join('\n'));
  const r = SM.buildDataset(t2, SM.analyzeTable(t2).cols, { unit: 'krwToShares' });
  assert.equal(r.data.flowUnit, 'shares'); assert.equal(r.data.frgn[1], 5000); // 1e7 / 2000
});
t('데이터 정보: 가격만/수급 일부 구간/기간 안 수급 일수/최근 표', () => {
  const px = 'date,open,high,low,close,volume\n' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `2026-01-0${d},100,110,90,${100 + d},1000`).join('\n');
  const data = SM.parseOHLCV(px).data;
  let inf = SM.dataInfo(data);
  assert.equal(inf.days, 9); assert.equal(inf.anyFlow, false); assert.equal(inf.flow.frgn, null); assert.equal(inf.recent.length, 8); assert.equal(inf.recent[7].d, '2026-01-09');
  const tb = SM.splitTable('날짜,외국인,기관,개인\n2026-01-04,10,1,1\n2026-01-05,20,,1\n2026-01-07,30,3,1');
  const an = SM.analyzeTable(tb); const m = SM.mergeFlow(data, tb, an.cols);
  ['frgn', 'inst', 'indiv'].forEach((k) => { data[k] = m.arrs[k]; }); data.flowUnit = m.unit;
  inf = SM.dataInfo(data, { from: '2026-01-01', to: '2026-01-09' });
  assert.deepEqual(inf.flow.frgn, { count: 3, from: '2026-01-04', to: '2026-01-07' }); assert.equal(inf.flow.inst.count, 2);
  assert.equal(inf.flowFrom, '2026-01-04'); assert.equal(inf.flowTo, '2026-01-07');
  assert.equal(inf.insideDays, 4); assert.equal(inf.gapDays, 1); assert.equal(inf.outsideDays, 5); // 1/06은 구간 안이지만 빈 날
  assert.equal(inf.range.days, 9); assert.equal(inf.range.flowDays, 3);
  assert.equal(SM.dataInfo(data, { from: '2026-01-04', to: '2026-01-05' }).range.flowDays, 2);
});
t('자동 수집 기간 설정: 기본 3년, 1~15년로 보정, 날짜 지정, 목록 JSON에 포함', () => {
  assert.equal(SM.DEFAULT_SETTINGS().collectYears, 3); assert.equal(SM.DEFAULT_SETTINGS().collectFrom, '');
  const n = (v) => SM.normalizeState({ settings: { collectYears: v } }).settings.collectYears;
  assert.equal(n(undefined), 3); assert.equal(n(5), 5); assert.equal(n('7'), 7); assert.equal(n(99), 15); assert.equal(n(0), 3); assert.equal(n('x'), 3); assert.equal(n(2.6), 3);
  const dt = (o) => SM.normalizeState({ settings: o }).settings;
  assert.equal(dt({ collectFrom: '2017-01-02', collectTo: '2017-12-29' }).collectFrom, '2017-01-02'); assert.equal(dt({ collectFrom: '2017-1-2' }).collectFrom, ''); assert.equal(dt({ collectTo: 'abc' }).collectTo, ''); assert.equal(dt({ collectFrom: '2017-13-45' }).collectFrom, '');
  const stocks = [SM.newStock({ name: '대한항공', code: '003490', market: 'KR' })];
  assert.deepEqual(JSON.parse(SM.data.watchJson(stocks, 5)), { years: 5, stocks: [{ code: '003490', name: '대한항공' }] }); // 숫자만 줘도 동작(예전 호출)
  assert.deepEqual(JSON.parse(SM.data.watchJson(stocks, { years: 10, from: '2017-01-02', to: '2017-12-29' })), { years: 10, from: '2017-01-02', to: '2017-12-29', stocks: [{ code: '003490', name: '대한항공' }] });
  assert.deepEqual(JSON.parse(SM.data.watchJson(stocks, { years: 3, from: '', to: '' })), { years: 3, stocks: [{ code: '003490', name: '대한항공' }] });
  assert.deepEqual(Object.keys(JSON.parse(SM.data.watchJson(stocks))), ['stocks']);
});
t('수집 대상 반영: 이슈 주소 생성·저장소 목록과의 차이·이슈 처리기와 호환', () => {
  const W = require('../tools/watchlist-issue.js'), D = SM.data;
  const stocks = [SM.newStock({ name: '대한항공', code: '003490', market: 'KR' }), SM.newStock({ name: '한국전력', code: '015760', market: 'KR' })];
  const cur = D.watchJson(stocks, { years: 10 });
  const real = D.repo; D.repo = () => ({ base: 'https://github.com/me/stock-manager' });
  try {
    const u = D.issueUrl(cur); const q = new URL(u);
    assert.equal(q.origin + q.pathname, 'https://github.com/me/stock-manager/issues/new'); assert.equal(q.searchParams.get('title'), '수집 대상 반영');
    const body = q.searchParams.get('body'); assert(body.includes(D.MARKER)); assert.equal(D.MARKER, W.MARKER);
    const r = W.applyWatchlist(body, { stocks: [{ code: '003490', name: '대한항공' }] }); // 앱이 만든 본문을 처리기가 그대로 받아들임
    assert.equal(r.ok, true); assert.deepEqual(r.added, ['한국전력']); assert.equal(JSON.parse(r.json).years, 10);
    const many = D.watchJson(Array.from({ length: 150 }, (_, i) => SM.newStock({ name: '종목' + i, code: String(100000 + i), market: 'KR' })), { years: 3 });
    assert.equal(D.issueUrl(many).tooLong, true);
  } finally { D.repo = real; }
  D.repo = () => null; assert.equal(D.issueUrl(cur), null); D.repo = real;
  const diff = (raw) => D.watchDiff(raw, cur);
  assert.equal(diff({ years: 10, stocks: [{ code: '003490' }, { code: '015760' }] }).same, true);
  let d = diff({ years: 10, stocks: [{ code: '003490', name: '대한항공' }, { code: '005930', name: '삼성전자' }] });
  assert.equal(d.same, false); assert.deepEqual(d.added, ['한국전력']); assert.deepEqual(d.removed, ['삼성전자']);
  assert.equal(diff({ years: 3, stocks: [{ code: '003490' }, { code: '015760' }] }).optsChanged, true);
  assert.equal(diff(null).none, true); assert.equal(diff([{ code: '003490' }, { code: '015760' }]).optsChanged, true); // 예전 배열 형식 + 기간 없음
});
t('수집 대상에서 빠진 종목과 이유', () => {
  const D = SM.data, mk = (o) => SM.newStock(Object.assign({ name: 'x', code: '', market: 'KR' }, o));
  const stocks = [mk({ name: '보유A', code: '003490' }), mk({ name: '관심켬', code: '015760', watch: true }), mk({ name: '관심꺼짐', code: '005930', watch: true }), mk({ name: '코드없음', code: '', watch: true }), mk({ name: '코드이상', code: '12345' }), mk({ name: '애플', code: 'AAPL', market: 'US' })];
  stocks[1].collect = true; stocks[3].collect = true;
  const inc = JSON.parse(D.watchJson(stocks)).stocks.map((s) => s.name), ex = D.watchExcluded(stocks);
  assert.deepEqual(inc, ['보유A', '관심켬']); assert.deepEqual(ex.map((e) => e.name), ['관심꺼짐', '코드없음', '코드이상', '애플']);
  assert(/꺼져/.test(ex[0].reason) && /비어/.test(ex[1].reason) && /6자리/.test(ex[2].reason) && /해외/.test(ex[3].reason));
  assert.equal(inc.length + ex.length, stocks.length); // 포함 + 제외 = 전체(빠짐없이 설명)
  assert.deepEqual(D.watchExcluded([mk({ name: '공백코드', code: ' 003490 ' })]), []);
});
t('종목 검색: 이름 앞부분·포함·초성·코드, 순위, 개수 제한, 영숫자 코드', () => {
  const D = SM.data;
  const rows = [['005930', '삼성전자', 'P', 's'], ['000660', 'SK하이닉스', 'P', 's'], ['005935', '삼성전자우', 'P', 's'], ['062040', '산일전기', 'P', 's'], ['003490', '대한항공', 'P', 's'], ['0126Z0', '삼성에피스홀딩스', 'P', 's'],
    ['069500', 'KODEX 200', 'P', 'e'], ['0043B0', 'TIGER 머니마켓액티브', 'P', 'e'], ['196170', '알테오젠', 'Q', 's'], ['000270', '기아', 'P', 's'], ['200670', '휴메딕스', 'Q', 's']];
  const names = (q, n) => D.searchStocks(rows, q, n).map((x) => x.name);
  assert.deepEqual(names('삼성'), ['삼성전자', '삼성전자우', '삼성에피스홀딩스']); // 시가총액 순(목록 순서) 유지
  assert.deepEqual(names('전자'), ['삼성전자', '삼성전자우']); // 포함
  assert.deepEqual(names('  삼성 전자 '), ['삼성전자', '삼성전자우']); // 공백 무시
  assert.deepEqual(names('산일'), ['산일전기']); assert.deepEqual(names('ㅅㅇㅈㄱ'), ['산일전기']); assert.deepEqual(names('ㅇㅌㅇㅈ'), ['알테오젠']); // 초성
  assert.deepEqual(names('ㅅㅅ'), ['삼성전자', '삼성전자우', '삼성에피스홀딩스']);
  assert.deepEqual(names('0626'), []); assert.deepEqual(names('0620'), ['산일전기']); // 코드 앞부분
  assert.deepEqual(names('0126z'), ['삼성에피스홀딩스']); assert.deepEqual(names('0043b0'), ['TIGER 머니마켓액티브']); // 영숫자 코드, 대소문자 무시
  assert.deepEqual(names('kodex'), ['KODEX 200']); assert.deepEqual(names('kodex 200'), ['KODEX 200']); assert.deepEqual(names('sk'), ['SK하이닉스']);
  assert.equal(names('삼성', 2).length, 2); assert.deepEqual(names(''), []); assert.deepEqual(names('   '), []); assert.deepEqual(names('없는종목'), []);
  assert.deepEqual(D.searchStocks(null, '삼성'), []); assert.deepEqual(D.searchStocks(rows, '삼성')[0], { code: '005930', name: '삼성전자', market: '코스피', type: '주식' });
  assert.equal(D.searchStocks(rows, 'kodex')[0].type, 'ETF'); assert.equal(D.searchStocks(rows, '알테')[0].market, '코스닥');
  assert.equal(D.stockByCode(rows, ' 062040 ').name, '산일전기'); assert.equal(D.stockByCode(rows, '0126z0').name, '삼성에피스홀딩스'); assert.equal(D.stockByCode(rows, '999999'), null); assert.equal(D.stockByCode(null, '062040'), null);
  // 목록이 커도 같은 목록으로 반복 검색할 때 색인을 다시 만들지 않음(숨은 속성), JSON 직렬화에는 영향 없음
  D.searchStocks(rows, '삼성'); assert.equal(JSON.stringify(rows).includes('_idx'), false);
});
t('현재가 자동 반영: 직접 입력이 더 최신이면 유지, 종가가 같거나 더 최신이면 갱신, 출처 표시', () => {
  const st = SM.newStock({ name: 'x', code: '003490', market: 'KR' });
  assert.equal(SM.applyAutoPrice(st, 29750, '2026-11-26'), true); assert.deepEqual([st.price, st.priceAt, st.priceSrc], [29750, '2026-11-26', 'auto']);
  assert.equal(SM.applyAutoPrice(st, 29750, '2026-11-26'), false); // 같은 값 → 변경 없음
  assert.equal(SM.applyAutoPrice(st, 30100, '2026-11-27'), true); assert.equal(st.price, 30100); // 더 최신 종가
  assert.equal(SM.applyAutoPrice(st, 29000, '2026-11-20'), false); assert.equal(st.price, 30100); // 더 옛날 종가는 무시
  SM.setPrice(st, 31000); assert.equal(st.priceSrc, 'manual'); assert.equal(st.priceAt, SM.todayStr()); // 직접 입력은 오늘 날짜
  assert.equal(SM.applyAutoPrice(st, 30500, '2026-11-27'), SM.todayStr() <= '2026-11-27'); // 오늘 입력값이 종가 날짜보다 뒤면 유지
  const st2 = SM.newStock({ name: 'y', code: '015760', market: 'KR' }); st2.price = 100; st2.priceAt = '2026-11-20'; st2.priceSrc = 'manual';
  assert.equal(SM.applyAutoPrice(st2, 200, '2026-11-26'), true); assert.equal(st2.priceSrc, 'auto'); // 오래된 직접 입력은 자동 종가가 대체
  assert.equal(SM.applyAutoPrice(st2, 0, '2026-11-26'), false); assert.equal(SM.applyAutoPrice(st2, 'abc', '2026-11-26'), false); assert.equal(SM.applyAutoPrice(st2, 300, '잘못'), false);
  const n = SM.priceNote(st2, '2026-11-27'); assert.equal(n.auto, true); assert(/종가 11-26 \(자동 수집\)/.test(n.text)); assert.equal(n.stale, false);
  assert.equal(SM.priceNote(st2, '2026-12-05').stale, true); // 4일 넘으면 오래됨
  assert.equal(SM.priceNote(SM.newStock({ name: 'z' })).empty, true);
  assert.equal(SM.normalizeState({ stocks: [{ id: 'a', name: 'n', price: 5, priceAt: '2026-01-01' }] }).stocks[0].priceSrc, ''); // 예전 데이터는 출처 없음(직접 입력 취급)
});
t('차트 계산: 주·월봉 묶기, 이동평균·볼린저, 구간, 누적, 눈금, 표기', () => {
  // 2026-01-05(월)~01-16(금) 2주 + 02-02, 02-03
  const days = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16', '2026-02-02', '2026-02-03'];
  const data = { d: days, o: days.map((_, i) => 100 + i), h: days.map((_, i) => 110 + i), l: days.map((_, i) => 90 + i), c: days.map((_, i) => 105 + i), v: days.map(() => 1000), hasVol: true, flowUnit: 'shares',
    frgn: days.map((_, i) => (i === 0 ? null : 10 * i)), inst: days.map((_, i) => (i < 5 ? null : 1)), indiv: null };
  const w = SM.aggregateBars(data, 'W');
  assert.deepEqual(w.d, ['2026-01-09', '2026-01-16', '2026-02-03']); // 주의 마지막 거래일, 02-02·03은 같은 주
  assert.deepEqual([w.o[0], w.h[0], w.l[0], w.c[0], w.v[0]], [100, 114, 90, 109, 5000]); // 시가=첫날, 고가=최고, 저가=최저, 종가=마지막, 거래량 합
  assert.deepEqual(w.frgn, [10 + 20 + 30 + 40, 50 + 60 + 70 + 80 + 90, 100 + 110]); // 합계 (첫날 null은 건너뜀)
  assert.deepEqual(w.inst, [null, 5, 2]); // 전부 비면 null
  assert.deepEqual(w.hd, ['2026-01-09', '2026-01-16', '2026-02-03']); // 주봉 최고가가 나온 실제 날짜(고가가 날마다 +1이라 주의 마지막 날)
  const d2 = { d: ['2026-03-02', '2026-03-03', '2026-03-04'], o: [1, 1, 1], h: [5, 9, 6], l: [1, 0.5, 2], c: [2, 3, 4], v: [1, 1, 1], hasVol: true }; const w2 = SM.aggregateBars(d2, 'W');
  assert.deepEqual([w2.h[0], w2.hd[0], w2.l[0], w2.ld[0], w2.d[0]], [9, '2026-03-03', 0.5, '2026-03-03', '2026-03-04']); // 봉 날짜는 마지막 거래일, 최고·최저는 실제 날짜
  assert.equal(w.indiv, null); assert.equal(w.flowUnit, 'shares');
  const m = SM.aggregateBars(data, 'M'); assert.deepEqual(m.d, ['2026-01-16', '2026-02-03']); assert.equal(m.v[0], 10000); assert.equal(m.c[1], 116);
  assert.equal(SM.aggregateBars(data, 'D'), data); // 일봉은 그대로
  // 이동평균·볼린저
  const ma = SM.chartSma([1, 2, 3, 4, 5], 3); assert.deepEqual(ma, [null, null, 2, 3, 4]);
  const bb = SM.chartBollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2); assert.equal(bb.mid[7], 5); assert(Math.abs(bb.up[7] - 9) < 1e-9 && Math.abs(bb.lo[7] - 1) < 1e-9); // 평균 5, 모집단 표준편차 2
  assert.equal(bb.up[6], null);
  // 보이는 구간
  assert.deepEqual(SM.chartWindow(100, 30, 99), { from: 70, to: 99, count: 30 });
  assert.deepEqual(SM.chartWindow(100, 30, 10), { from: 0, to: 29, count: 30 }); // 왼쪽 끝 보정
  assert.deepEqual(SM.chartWindow(100, 500, 99), { from: 0, to: 99, count: 100 }); // 데이터보다 크게 못 늘림
  assert.equal(SM.chartWindow(100, 1, 99).count, 5); assert.deepEqual(SM.chartWindow(3, 10, 2), { from: 0, to: 2, count: 3 }); assert.equal(SM.chartWindow(100, 30, null).to, 99);
  assert.equal(SM.chartBarsForMonths('D', 6, 1000), 126); assert.equal(SM.chartBarsForMonths('W', 12, 1000), 52); assert.equal(SM.chartBarsForMonths('M', 36, 1000), 36); assert.equal(SM.chartBarsForMonths('D', 0, 777), 777); assert.equal(SM.chartBarsForMonths('M', 36, 10), 10);
  // 누적: 구간 시작부터, 빈 값은 0
  const cu = SM.chartCumulative([5, null, -2, 4, null, 1], 1, 5); assert.deepEqual(cu.cum, [0, -2, 2, 2, 3]); assert.equal(cu.any, true);
  assert.equal(SM.chartCumulative([null, null, 1], 0, 1).any, false); assert.equal(SM.chartCumulative(null, 0, 2).any, false);
  assert.deepEqual(SM.chartExtremes([5, 9, 7, 8], [1, 3, 0, 2], 0, 3), { hiIdx: 1, loIdx: 2 }); assert.deepEqual(SM.chartExtremes([5, 9, 7, 8], [1, 3, 0, 2], 2, 3), { hiIdx: 3, loIdx: 2 });
  // 눈금
  assert.deepEqual(SM.chartNiceTicks(0, 100, 4), [0, 20, 40, 60, 80, 100]); assert.deepEqual(SM.chartNiceTicks(0, 100, 2), [0, 50, 100]); assert.deepEqual(SM.chartNiceTicks(24000, 33000, 5), [24000, 26000, 28000, 30000, 32000]);
  assert(SM.chartNiceTicks(-50, 120, 2).includes(0)); assert(SM.chartNiceTicks(5, 5, 3).length >= 1);
  // 표기
  const fc = SM.chartFmtCompact; assert.equal(fc(58759000, 'shares'), '58.8M'); assert.equal(fc(-970498, 'shares'), '-970K'); assert.equal(fc(1234, 'shares'), '1K'); assert.equal(fc(999, 'shares'), '999'); assert.equal(fc(0, 'shares'), '0');
  assert.equal(fc(14215322375, 'krw'), '142억'); assert.equal(fc(-3.2e8, 'krw'), '-3.2억'); assert.equal(fc(5e7, 'krw'), '5,000만');
  // 실제 데이터 형식과 호환: 데이터셋 → 주봉·월봉에서 값이 보존됨
  const big = SM.parseOHLCV('date,open,high,low,close,volume\n' + Array.from({ length: 300 }, (_, i) => { const d = new Date(Date.UTC(2026, 0, 1 + i)); if (d.getUTCDay() % 6 === 0) return null; return `${d.toISOString().slice(0, 10)},100,${110 + (i % 7)},90,${100 + (i % 5)},1000`; }).filter(Boolean).join('\n')).data;
  const wk = SM.aggregateBars(big, 'W'), mo = SM.aggregateBars(big, 'M');
  assert.equal(wk.v.reduce((a, b) => a + b, 0), big.v.reduce((a, b) => a + b, 0)); assert.equal(mo.v.reduce((a, b) => a + b, 0), big.v.reduce((a, b) => a + b, 0)); // 거래량 합 보존
  assert.equal(Math.max(...wk.h), Math.max(...big.h)); assert.equal(Math.min(...mo.l), Math.min(...big.l)); assert(wk.d.length < big.d.length / 4 && mo.d.length <= 11);
});
t('배당 기록: 세금 자동 제안, 검증, 환율 환산, 기간·종목 합계, 정규화, 손익 보고서 연동', () => {
  const kr = SM.newStock({ name: '대한항공', code: '003490', market: 'KR' }), us = SM.newStock({ name: '애플', code: 'AAPL', market: 'US' });
  const st = SM.DEFAULT_SETTINGS(); st.fxNow = 1400;
  const d1 = SM.addDividend(kr, { date: '2026-04-20', gross: 10000 }, st); // 세금 비우면 국내 15.4% 자동
  assert.equal(d1.tax, 1540); assert.equal(d1.fx, 1);
  const d2 = SM.addDividend(kr, { date: '2025-12-20', gross: '20,000', tax: 0, note: '  결산배당  ' }, st); // 세금 직접 0
  assert.equal(d2.tax, 0); assert.equal(d2.note, '결산배당'); assert.deepEqual(kr.dividends.map((x) => x.date), ['2025-12-20', '2026-04-20']); // 날짜순
  const d3 = SM.addDividend(us, { date: '2026-05-15', gross: 10, fx: 1300 }, st); // 해외 15%, 입력 환율
  assert.equal(d3.tax, 1.5); assert.equal(d3.fx, 1300);
  assert.equal(SM.addDividend(us, { date: '2026-06-01', gross: 4 }, st).fx, 1400); // 환율 비우면 현재 환율
  // 검증
  assert.throws(() => SM.addDividend(kr, { date: '', gross: 1 }, st), /날짜/); assert.throws(() => SM.addDividend(kr, { date: '2026-01-01', gross: 0 }, st), /배당금/);
  assert.throws(() => SM.addDividend(kr, { date: '2026-01-01', gross: 100, tax: 101 }, st), /세금/); assert.throws(() => SM.addDividend(kr, { date: '2026-01-01', gross: 100, tax: -1 }, st), /세금/);
  assert.equal(kr.dividends.length, 2); // 잘못된 입력은 저장되지 않음
  // 합계(원화)
  const all = SM.dividendTotals([kr, us]);
  assert.equal(all.count, 4); assert.equal(Math.round(all.grossKRW), 10000 + 20000 + 10 * 1300 + 4 * 1400); assert.equal(Math.round(all.taxKRW), 1540 + 0 + 1.5 * 1300 + 0.6 * 1400);
  assert.equal(Math.round(all.netKRW), Math.round(all.grossKRW - all.taxKRW)); assert.equal(Math.round(all.byYear['2025']), 20000); assert.equal(Math.round(all.byYear['2026'] + all.byYear['2025']), Math.round(all.netKRW));
  assert.equal(SM.dividendTotals([kr, us], { from: '2026-01-01', to: '2026-04-30' }).count, 1); assert.equal(SM.dividendTotals([kr], { from: '2027-01-01' }).count, 0); assert.equal(SM.dividendTotals([]).netKRW, 0);
  // 삭제
  SM.removeDividend(kr, d1.id); assert.deepEqual(kr.dividends.map((x) => x.id), [d2.id]);
  // 정규화: 잘못된 항목 제거, 값 보정, 예전 데이터(배당 없음)는 빈 배열
  const ns = SM.normalizeState({ stocks: [{ id: 'a', name: 'n', dividends: [{ date: '2026-01-01', gross: 100, tax: 500 }, { date: 'x', gross: 5 }, { date: '2026-01-02', gross: -1 }, null, { date: '2025-01-01', gross: 50, tax: 5, fx: 0 }] }, { id: 'b', name: 'm' }] });
  assert.deepEqual(ns.stocks[0].dividends.map((d) => [d.date, d.gross, d.tax, d.fx]), [['2025-01-01', 50, 5, 1], ['2026-01-01', 100, 100, 1]]); assert.deepEqual(ns.stocks[1].dividends, []);
  // 손익 보고서: 종목·기간 필터를 따라감
  const state = SM.newState(); state.stocks.push(kr, us); SM.addDividend(kr, { date: '2026-04-20', gross: 10000 }, st);
  assert.equal(Math.round(SM.pnlReport(state, { group: 'all', stockId: 'all' }).div.netKRW), Math.round(SM.dividendTotals([kr, us]).netKRW));
  assert.equal(SM.pnlReport(state, { group: 'all', stockId: kr.id, from: '2026-01-01', to: '2026-12-31' }).div.count, 1);
  assert.equal(SM.pnlReport(state, { group: 'all', stockId: us.id, from: '2027-01-01' }).div.count, 0);
});
t('차트 실적: 전년 동기 대비·흑전/적전·공시일 추정·기준일까지 공시된 실적', () => {
  const Q = (ym, op, filed, extra) => Object.assign({ ym, op: op * 1e8, revenue: Math.abs(op) * 10e8, net: 0, filed }, extra || {});
  const q = [Q('2025-03', 43, '2025-05-15'), Q('2025-06', 37, '2025-08-14'), Q('2025-09', 15.75, '2025-11-14'), Q('2025-12', 15.5, '2026-03-20', { derived: true }), Q('2026-03', 51.74, '2026-05-15'), Q('2026-06', -20.71, null), Q('2026-09', 34.92, '2026-11-13'), Q('2027-03', -5, '2027-05-14'), Q('2026-12', -8, '2027-03-30')];
  const s = SM.earningsSeries(q), by = Object.fromEntries(s.map((e) => [e.ym, e]));
  assert.deepEqual(s.map((e) => e.ym), ['2025-03', '2025-06', '2025-09', '2025-12', '2026-03', '2026-06', '2026-09', '2026-12', '2027-03']); // 공시(또는 추정) 날짜순
  assert.equal(by['2025-03'].yoy.kind, 'na'); // 전년 동기 없음
  assert(Math.abs(by['2026-03'].yoy.pct - (51.74 / 43 - 1) * 100) < 1e-9);
  assert.equal(by['2026-06'].yoy.kind, 'turn_loss'); // 37 → -20.71: 흑자에서 적자로 assert(Math.abs(by['2026-09'].yoy.pct - (34.92 / 15.75 - 1) * 100) < 1e-9 && by['2026-09'].yoy.pct > 120 && by['2026-09'].yoy.pct < 123); // +122%(기저효과)
  assert.equal(by['2026-12'].yoy.kind, 'turn_loss'); assert.equal(by['2027-03'].yoy.kind, 'turn_loss'); // 15.5 → -8, 51.74 → -5
  assert.deepEqual(SM.yoyOf(10, -5), { kind: 'turn_profit' }); assert.deepEqual(SM.yoyOf(-3, -5), { kind: 'loss', better: true }); assert.deepEqual(SM.yoyOf(-8, -5), { kind: 'loss', better: false }); assert.equal(SM.yoyOf(5, 0).kind, 'na'); assert.equal(SM.yoyOf(null, 5).kind, 'na'); assert.equal(SM.yoyOf(0, 5).kind, 'pct');
  assert.equal(SM.yoyOf(0, 5).pct, -100);
  // 억원·이익률·공시일 추정
  assert.equal(Math.round(by['2026-03'].opEok * 100) / 100, 51.74); assert(Math.abs(by['2026-03'].margin - 10) < 1e-9);
  assert.equal(by['2026-06'].filedEst, true); assert.equal(by['2026-06'].at, '2026-08-14'); // 6월 말 + 45일
  assert.equal(SM.estimateFiled('2025-12'), '2026-03-31'); assert.equal(SM.estimateFiled('2026-03'), '2026-05-15'); assert.equal(SM.estimateFiled('2024-12'), '2025-03-31'); // 연간은 +90일, 윤년 2월 처리
  assert.equal(by['2025-12'].derived, true); assert.equal(by['2026-09'].filedEst, false);
  // 기준일까지 공시된 최근 실적(미래 정보 금지)
  assert.equal(SM.earningsAsOf(s, '2025-05-14'), null); assert.equal(SM.earningsAsOf(s, '2025-05-15').ym, '2025-03'); assert.equal(SM.earningsAsOf(s, '2026-11-12').ym, '2026-06'); assert.equal(SM.earningsAsOf(s, '2026-11-13').ym, '2026-09'); assert.equal(SM.earningsAsOf(s, '2030-01-01').ym, '2027-03'); assert.equal(SM.earningsAsOf([], '2026-01-01'), null); assert.equal(SM.earningsAsOf(null, '2026-01-01'), null);
  // 표기
  assert.equal(SM.chartFmtEok(3492), '3,492억'); assert.equal(SM.chartFmtEok(12345), '1.2조'); assert.equal(SM.chartFmtEok(-2071), '-2,071억'); assert.equal(SM.chartFmtEok(123456), '12조'); assert.equal(SM.chartYoyText({ kind: 'pct', pct: 121.7 }), '+122%'); assert.equal(SM.chartYoyText({ kind: 'pct', pct: -6.04 }), '-6.0%'); assert.equal(SM.chartYoyText({ kind: 'turn_profit' }), '흑자전환'); assert.equal(SM.chartYoyText({ kind: 'loss', better: false }), '적자 확대');
  // 증감(억원)·부채: 전년이 적자·0이어도 증감액은 항상 계산, 부채비율 = 부채 ÷ 자본
  { const B = (ym, op, liab, equity) => ({ ym, op: op * 1e8, revenue: 1e10, net: 0, filed: ym + '-28', liab: liab == null ? undefined : liab * 1e8, equity: equity == null ? undefined : equity * 1e8 });
    const e = SM.earningsSeries([B('2025-03', -10, 1000, 500), B('2026-03', 30, 1500, 500), B('2025-06', 0, 800, 400), B('2026-06', 20, null, null)]), m = Object.fromEntries(e.map((x) => [x.ym, x]));
    assert.equal(m['2025-03'].dOpEok, null); assert.equal(m['2026-03'].dOpEok, 40); assert.equal(m['2026-03'].yoy.kind, 'turn_profit'); // 증가율은 못 쓰는 경우에도 증감액은 있음
    assert.equal(m['2026-06'].dOpEok, 20); assert.equal(m['2026-06'].yoy.kind, 'na');
    assert.equal(m['2026-03'].dLiabEok, 500); assert.equal(Math.round(m['2026-03'].liabPct), 50); assert.equal(m['2026-03'].debtRatio, 300); assert.equal(m['2026-06'].liabEok, null); assert.equal(m['2026-06'].dLiabEok, null); assert.equal(m['2026-06'].debtRatio, null);
    // 0 맞춘 분리: 두 계열이 같은 0 높이를 공유하고 값이 패널 안(0~1)에 들어감 / 같은 눈금: 눈금 하나
    const A = [1916, -5772, 863], L = [163427, -46483, 5200], pos = (v, z, sc) => z - v / sc;
    const zr = SM.chgScale([A, L], 'zero'); assert.equal(zr.scale.length, 2); assert(zr.z >= 0.15 && zr.z <= 0.85);
    for (const [arr, k] of [[A, 0], [L, 1]]) for (const v of arr) { const y = pos(v, zr.z, zr.scale[k]); assert(y > 0 && y < 1, `${v} → ${y}`); }
    assert.notEqual(zr.scale[0], zr.scale[1]); // 각자의 눈금
    const sm = SM.chgScale([A, L], 'same'); assert.equal(sm.scale[0], sm.scale[1]); for (const v of A.concat(L)) { const y = pos(v, sm.z, sm.scale[0]); assert(y > 0 && y < 1); }
    assert.deepEqual(SM.chgScale([], 'zero').scale, []); assert.deepEqual(SM.chgScale([[], [NaN]], 'zero').scale, []); const one = SM.chgScale([[5, 3]], 'zero'); assert(one.z === 0.85 && one.scale.length === 1); // 전부 양수여도 0이 아래 끝에 붙지 않음
  }
  // 잘못된 입력은 무시
  assert.deepEqual(SM.earningsSeries([null, { ym: 'x', op: 1 }, { ym: '2026-03' }, { ym: '2026-03', op: NaN }]), []); assert.deepEqual(SM.earningsSeries(null), []);
  // 날짜 위치 찾기
  const ds = ['2026-01-02', '2026-01-05', '2026-01-06']; assert.equal(SM.chartFirstIdx(ds, '2026-01-03'), 1); assert.equal(SM.chartFirstIdx(ds, '2026-01-02'), 0); assert.equal(SM.chartFirstIdx(ds, '2026-02-01'), -1); assert.equal(SM.chartFirstIdx(ds, '2025-12-01'), 0);
});
t('버전 비교', () => {
  assert.equal(SM.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(SM.compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(SM.compareVersions('1.2.0', '1.2.1'), -1);
  assert.equal(SM.compareVersions('2.0', '1.9.9'), 1);
});
