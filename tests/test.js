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

console.log(ok + ' passed');
t('버전 비교', () => {
  assert.equal(SM.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(SM.compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(SM.compareVersions('1.2.0', '1.2.1'), -1);
  assert.equal(SM.compareVersions('2.0', '1.9.9'), 1);
});
