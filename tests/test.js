const assert = require('assert');
const SM = require('../core.js'); require('../backtest.js');
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
    렌코: mk([{ type: 'renkoFlip', dir: 'up' }], [{ type: 'renkoFlip', dir: 'down' }]),
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
t('렌코 생성', () => {
  const data = { d: [], o: [], h: [], l: [], c: [100,102,104,106,104,102,100,98,100,104], v: [], hasVol: false };
  const r = SM.buildRenko(data, { mode: 'fixed', value: 2 });
  assert(r.bricks.length > 0); console.log('   bricks', r.bricks.map((b) => (b.dir > 0 ? '+' : '-') + b.c).join(' '));
});
console.log(ok + ' passed');
t('버전 비교', () => {
  assert.equal(SM.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(SM.compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(SM.compareVersions('1.2.0', '1.2.1'), -1);
  assert.equal(SM.compareVersions('2.0', '1.9.9'), 1);
});
