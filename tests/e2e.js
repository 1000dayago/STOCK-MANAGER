/* 브라우저 통합 테스트: 실제 화면을 열어 핵심 동작을 확인합니다.
   실행:  node tests/e2e.js        (Playwright 필요: npm i -D playwright && npx playwright install chromium)
   - 자체 정적 서버를 띄우고, data/ 요청은 이 파일이 만든 가짜 자료로 대신 응답합니다(네트워크·키 불필요, 저장소 파일은 건드리지 않음).
   - Playwright 가 없으면 건너뛰고 0 으로 끝납니다. 실패가 있으면 1 로 끝납니다. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright 가 없어 브라우저 테스트를 건너뜁니다. (npm i -D playwright && npx playwright install chromium)'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const setSel = (page, sel, v) => page.evaluate(([q, val]) => { const e = document.querySelector(q); e.value = val; e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]); // 버튼형으로 바뀐 선택 상자는 값을 직접 지정
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]), f = path.join(ROOT, u === '/' ? 'index.html' : u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

/* ---- 가짜 자료: 평일 360일 시세·수급(고정 난수) ---- */
function fixtures() {
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const days = []; let t = Date.parse('2026-11-26T00:00:00Z');
  while (days.length < 360) { const dow = new Date(t).getUTCDay(); if (dow !== 0 && dow !== 6) days.push(new Date(t).toISOString().slice(0, 10)); t -= 86400000; }
  days.reverse();
  let c = 24000; const px = ['date,open,high,low,close,volume'], fl = ['date,frgn,inst,indiv'];
  days.forEach((d) => { const o = c, ch = (rnd() - 0.48) * 600; c = Math.max(15000, Math.round(o + ch)); const h = Math.max(o, c) + Math.round(rnd() * 250), l = Math.min(o, c) - Math.round(rnd() * 250);
    px.push(`${d},${o},${h},${l},${c},${Math.round(800000 + rnd() * 900000)}`); fl.push(`${d},${Math.round((rnd() - 0.45) * 400000)},${Math.round((rnd() - 0.5) * 200000)},${Math.round((rnd() - 0.5) * 300000)}`); });
  const stocks = { updatedAt: '2026-11-27T00:00:00.000Z', count: 5, stocks: [['005930', '삼성전자', 'P', 's'], ['062040', '산일전기', 'P', 's'], ['003490', '대한항공', 'P', 's'], ['069500', 'KODEX 200', 'P', 'e'], ['0126Z0', '삼성에피스홀딩스', 'P', 's']] };
  // 분기 영업이익(원 단위): 2025-03 이후 6분기, 마지막 분기는 공시일 없음(추정 표시 확인용)
  const Q = (ym, op, filed, extra) => Object.assign({ ym, year: +ym.slice(0, 4), q: Math.ceil(+ym.slice(5) / 3), label: `${ym.slice(0, 4)} ${Math.ceil(+ym.slice(5) / 3)}분기`, fs: '연결', revenue: Math.abs(op) * 12, op, net: 0, filed }, extra || {});
  const B = (l, e) => ({ liab: l * 1e8, equity: e * 1e8 });
  const fin = { v: 2, updatedAt: '2026-11-27T00:00:00.000Z', periods: [], quarters: [Q('2025-03', 4310e8, '2025-05-15', B(361979, 110000)), Q('2025-06', 3701e8, '2025-08-14', B(358066, 115000)), Q('2025-09', 1575e8, '2025-11-14', B(374824, 112000)), Q('2025-12', 1549e8, '2026-03-18', Object.assign({ derived: true }, B(389470, 114500))), Q('2026-03', 5174e8, '2026-05-15', B(420351, 112700)), Q('2026-06', -2071e8, '2026-08-14', B(420591, 107500)), Q('2026-09', 3492e8, '2026-11-13', B(426325, 118800)), Q('2026-12', 1456e8, null)] };
  return { px: px.join('\n') + '\n', fl: fl.join('\n') + '\n', last: days[days.length - 1], close: c, stocks, fin };
}

(async () => {
  const srv = await serve(), base = `http://127.0.0.1:${srv.address().port}/index.html`, F = fixtures();
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  const ok = (name, v, extra) => { if (v) { pass++; console.log('✓', name); } else { fail++; console.log('✗', name, extra === undefined ? '' : '→ ' + JSON.stringify(extra)); process.exitCode = 1; } };

  async function open(w = 420, h = 900, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' }), page = await ctx.newPage(), errs = [];
    page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/firebase|gstatic|net::ERR|404|Failed to load resource/i.test(m.text())) errs.push('CONSOLE ' + m.text()); });
    const dlg = { mode: 'accept', msgs: [] }; // 확인창: 문구를 기록하고 mode 에 따라 수락/취소
    page.on('dialog', (d) => { dlg.msgs.push(d.message()); return dlg.mode === 'dismiss' ? d.dismiss() : d.accept(); });
    const status = { updatedAt: new Date().toISOString(), keys: {}, stocks: { '003490': { prices: { ok: true, source: 'naver', last: F.last, close: F.close, from: '2025-06-01', count: 360 }, flow: { ok: true, last: F.last, from: '2025-06-01', count: 360 }, fin: { ok: true, quarters: 8, last: '2026-12' } } } };
    if (opt.noData) { await page.route('**/data/**', (r) => r.fulfill({ status: 404, body: '' })); }
    else {
      await page.route('**/data/watchlist.json*', (r) => r.fulfill({ json: { years: 3, stocks: [{ code: '003490', name: '대한항공' }] } }));
      await page.route('**/data/status.json*', (r) => r.fulfill({ json: status }));
      await page.route('**/data/prices/003490.csv*', (r) => r.fulfill({ body: F.px, contentType: 'text/csv' }));
      await page.route('**/data/flow/003490.csv*', (r) => r.fulfill({ body: F.fl, contentType: 'text/csv' }));
      await page.route('**/data/stocks.json*', (r) => r.fulfill({ json: F.stocks }));
      await page.route('**/data/fin/003490.json*', (r) => r.fulfill({ json: F.fin }));
      await page.route('**/data/events/003490.json*', (r) => r.fulfill({ json: { v: 1, updatedAt: '2026-11-27T00:00:00Z', items: [{ date: '2026-03-10', kind: '유', label: '유상증자', title: '주요사항보고서(유상증자결정)' }, { date: '2026-06-15', kind: '감', label: '감자', title: '주요사항보고서(감자결정) <b>x</b>' }, { date: '2026-06-15', kind: 'CB', label: 'CB·BW', title: '주요사항보고서(전환사채권발행결정)' }] } }));
    }
    await page.goto(base); await page.waitForSelector('.empty');
    return { ctx, page, errs, dlg };
  }
  const go = (page, view, extra) => page.evaluate(([v, e]) => { const A = SM.app; A.ui.view = v; if (e) Object.assign(A.ui, e); A.render(); }, [view, extra || null]);
  const addStocks = (page) => page.evaluate(() => { const A = SM.app, S = A.getState(), set = S.settings; const k = SM.newStock({ name: '대한항공', code: '003490', market: 'KR' }); SM.addLot(k, { date: '2026-06-08', qty: 10, price: 23650, fee: 0 }, set); SM.addLot(k, { date: '2026-09-14', qty: 20, price: 28000, fee: 0 }, set); S.stocks.push(k); A.save(); return k.id; });

  /* 1) 설정 탭 + 버튼형 선택 */
  { const { ctx, page, errs } = await open(); await go(page, 'settings');
    const tabs = () => page.$$eval('.grpseg button', (e) => e.map((x) => x.textContent.trim() + (x.classList.contains('on') ? '*' : '')));
    ok('설정: 4개 탭, 기본 설정이 먼저', (await tabs()).join() === '기본 설정*,자동 수집,동기화 · 백업,앱 정보');
    await page.click('[data-act=setTab][data-v=auto]'); ok('자동 수집 탭에 수집 카드만', (await page.$('#autoCard')) !== null && (await page.$('#syncCard')) === null);
    await page.click('[data-act=setTab][data-v=sync]'); ok('동기화·백업 탭', (await page.$('#syncCard')) !== null);
    await page.click('[data-act=setTab][data-v=basic]'); await page.waitForSelector('[data-setting=upColor] + .segsel');
    await page.click('[data-setting=upColor] + .segsel button:nth-child(2)'); ok('버튼형 선택(수익 색상)이 값을 바꿈', (await page.evaluate(() => SM.app.getState().settings.upColor)) === 'green');
    ok('1) 오류 없음', errs.length === 0, errs); await ctx.close(); }

  /* 2) 종목 추가: 이름 검색 → 코드 자동 입력, 가격 실수 방지, 시장 버튼 */
  { const { ctx, page, errs, dlg } = await open(); await go(page, 'stocks', { stockTab: 'watch' });
    await page.click('[data-act=addStock]'); await page.type('.modal input[name=name]', '산일', { delay: 20 }); await page.waitForSelector('#stSuggest .sug');
    await page.click('#stSuggest .sug:has-text("산일전기")');
    const v = await page.evaluate(() => ({ n: document.querySelector('.modal [name=name]').value, c: document.querySelector('.modal [name=code]').value, m: document.querySelector('.modal select[name=market]').value }));
    ok('이름 검색 후보를 누르면 이름·코드·시장이 채워짐', v.n === '산일전기' && v.c === '062040' && v.m === 'KR', v);
    await page.fill('.modal [name=name]', ''); await page.type('.modal [name=name]', 'ㅅㅅㅇㅍ', { delay: 20 }); await page.waitForSelector('#stSuggest .sug'); ok('초성 검색(영숫자 코드 종목 포함)', (await page.textContent('#stSuggest')).includes('0126Z0'));
    await page.fill('.modal [name=code]', '98,900'); await page.dispatchEvent('.modal [name=code]', 'input'); await page.waitForTimeout(100); ok('가격을 코드 칸에 넣으면 경고', /6자리/.test(await page.textContent('#stCodeHint')));
    await page.fill('.modal [name=name]', '실수종목'); dlg.mode = 'dismiss'; dlg.msgs.length = 0; await page.click('.modal button[type=submit]'); await page.waitForTimeout(150);
    ok('잘못된 국내 코드로 저장하면 확인창(6자리 안내)이 뜨고, 취소하면 저장 안 됨', dlg.msgs.length === 1 && /6자리/.test(dlg.msgs[0]) && (await page.evaluate(() => SM.app.getState().stocks.length)) === 0 && (await page.$('.modal')) !== null, dlg.msgs);
    dlg.mode = 'accept';
    await page.fill('.modal [name=code]', '062040'); await page.click('.modal label:has-text("시장") .segsel button:nth-child(2)'); await page.fill('.modal [name=name]', '해외로 바꿔 저장'); await page.click('.modal button[type=submit]'); await page.waitForTimeout(200);
    ok('시장 버튼 값이 저장됨(FormData)', (await page.evaluate(() => SM.app.getState().stocks.map((s) => s.market).join())) === 'US');
    ok('2) 오류 없음', errs.length === 0, errs); await ctx.close(); }

  /* 3) 자동 수집 데이터가 시뮬레이션 목록에 바로 나타남, 데이터 정보, 수급 조건 실행 */
  { const { ctx, page, errs } = await open(); await addStocks(page); await go(page, 'backtest');
    await page.waitForSelector('details.datainfo', { timeout: 10000 });
    const opt = await page.$$eval('[data-change=btDS] option', (e) => e.map((x) => x.textContent.trim()));
    ok('시뮬레이션 데이터 목록에 “대한항공 · 자동 수집”', opt.some((x) => /대한항공 · 자동 수집/.test(x)), opt);
    ok('복사 저장 없이 사용(내 기기 저장소 비어 있음)', (await page.evaluate(() => localStorage.getItem('stockmgr.datasets'))) === null);
    ok('데이터 정보: 가격·수급 일수 표시', /가격 360일/.test(await page.textContent('details.datainfo summary')));
    const r = await page.evaluate(() => { const A = SM.app, d = A.ui.bt.repo.cache['003490'].data, cfg = Object.assign(SM.blankCfg(), { qty: 10, entries: { mode: 'AND', conds: [{ type: 'flow', who: 'frgn', dir: 'buy', mode: 'streak', n: 2, v: 0 }] } }); const o = SM.runBacktest(d, cfg, SM.DEFAULT_SETTINGS()); return o.error || o.summary.buyCount; });
    ok('수급(외국인 연속 순매수) 조건 시뮬레이션 실행', typeof r === 'number' && r > 0, r);
    { // 물타기 전략(간단 입력) → 실행 → 사이클 분석 → 재생
      ok('물타기 전략 기본 문장: 30일선 상승 AND 하락 시 추가 매수 / 매도: 평단 +5%·−20%(별개로) · 최대 5회', await page.evaluate(() => { const c = SM.app.ui.bt.cfg, e = SM.exprLeaves(SM.exprOf(c.entries)).map((x) => x.type), x = SM.exprLeaves(SM.exprOf(c.exits)).map((y) => y.type + ':' + y.dir + ':' + y.pct); return e.join() === 'maSlope,dropLast' && x.join() === 'avgPct:up:5,avgPct:down:20' && String(c.maxLots) === '5' && Number(c.growth) === 2 && Number(c.qty) === 10; }));
      ok('수량·한도 입력칸이 촘촘한 격자(한 줄에 여러 칸)', await page.evaluate(() => { const ins = [...document.querySelectorAll('.sgrid input')], tops = ins.map((i) => Math.round(i.getBoundingClientRect().top)); void tops; const cells = [...document.querySelectorAll('.sgrid .sg')].map((e) => Math.round(e.getBoundingClientRect().top)); return ins.length >= 6 && cells.length >= 6 && new Set(cells).size <= 2; }));
      if (process.env.SIM_SHOT1) await page.screenshot({ path: process.env.SIM_SHOT1, fullPage: true });
      { // 예시 탭: 시험해 본 전략을 조건 문장 그대로 보여 주고, 불러와서 수정
        await page.click('[data-act=btMode2][data-v=example]'); await page.waitForSelector('.excard');
        const cards = await page.$$eval('.excard', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ')));
        ok('예시 탭: 시험해 본 전략 7가지가 카드로 나오고 조건 문장·시험값이 보임', cards.length === 7 && /저점 매수 · 목표 매도/.test(cards[0]) && /종가가 60일선보다 20% 이상 아래/.test(cards[0]) && /거래량이 전일보다 증가|거래량이 전일보다 높음/.test(cards[0]) && /평단 대비 \+8% 도달/.test(cards[0]) && /한국전력 \+19\.9%/.test(cards[0]) && /하락 \+ 거래량 급증|당일 3% 이상 하락/.test(cards[1]) && /물타기 기본값/.test(cards[3]), cards.map((c) => c.slice(0, 40)));
        if (process.env.EXT_SHOT) await page.screenshot({ path: process.env.EXT_SHOT, fullPage: false });
        ok('예시 탭에서는 전략 입력·실행 줄이 숨겨짐', (await page.$('.cndbox')) === null && (await page.$('[data-act=btRun]')) === null);
        await page.click('[data-act=btExLoad][data-id=lowhigh]'); await page.waitForSelector('.cndbox.buy');
        const ex = await page.evaluate(() => { const c = SM.app.ui.bt.cfg; return { mode: SM.app.ui.bt.mode, e: SM.exprLeaves(SM.exprOf(c.entries)).map((x) => [x.type, x.n, x.dir, x.pct].join(':')), x: SM.exprLeaves(SM.exprOf(c.exits)).map((x) => [x.type, x.dir, x.pct].join(':')), q: Number(c.qty), g: Number(c.growth), ml: Number(c.maxLots), mg: Number(c.minGap) }; });
        ok('불러와서 수정하기: 직접 조건 만들기로 이동해 문장 그대로 채워짐(60일선 −20% AND 거래량 / 평단 +8% / 10주·최대 3회·간격 3일)', ex.mode === 'custom' && ex.e.join('|') === 'maGap:60:below:20|volPrev:::' && ex.x.join() === 'avgPct:up:8' && ex.q === 10 && ex.g === 1 && ex.ml === 3 && ex.mg === 3 && /60일선보다 20% 이상 아래/.test(await page.textContent('#sent-entries')), ex);
        await page.click('.cndbox.buy .tok-b'); ok('불러온 조건을 눌러 바로 값을 수정할 수 있음', (await page.$('.cndbox.buy .tok-ed.show')) !== null);
        await page.click('[data-act=btMode2][data-v=mg]'); await page.waitForSelector('.sgrid');
        await page.evaluate(() => { SM.app.ui.bt.modeCfg.custom = SM.blankCfg(); }); } // 뒤의 검사는 비어 있는 직접 조건에서 시작
      { // 전략 저장·불러오기: 고급 설정을 열지 않아도 항상 보임
        ok('전략 저장·불러오기 줄이 전략 카드 맨 위에 항상 보임(고급 설정을 열지 않아도)', (await page.isVisible('#stratName')) && (await page.isVisible('[data-act=btStratSave]')) && (await page.isVisible('[data-change=btStratPick]')) && (await page.evaluate(() => !document.querySelector('details.box:has(summary)') || ![...document.querySelectorAll('details.box')].some((d) => /고급 설정/.test(d.textContent.slice(0, 12)) && d.open))));
        await page.fill('#stratName', '저장 시험 전략'); await page.click('[data-act=btStratSave]'); await page.waitForTimeout(150);
        const sv = await page.evaluate(() => { const l = SM.app.getState().strategies; return { n: l.length, name: l[0] && l[0].name, e: l[0] && SM.exprLeaves(SM.exprOf(l[0].cfg.entries)).map((x) => x.type).join(), from: l[0] && l[0].cfg.from }; });
        ok('저장: 이름·조건 문장이 전략 목록에 들어가고 기간은 저장하지 않음', sv.n === 1 && sv.name === '저장 시험 전략' && sv.e === 'maSlope,dropLast' && sv.from === '', sv);
        ok('저장한 전략이 불러오기 목록에 나타남', (await page.$$eval('[data-change=btStratPick] option', (e) => e.map((x) => x.textContent))).includes('저장 시험 전략'));
        await page.evaluate(() => { const id = SM.app.getState().strategies[0].id; const sel = document.querySelector('[data-change=btStratPick]'); sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForSelector('[data-act=btStratDel]');
        ok('불러오기: 직접 조건 만들기로 열리고 삭제 버튼이 나타남', (await page.evaluate(() => SM.app.ui.bt.mode)) === 'custom' && /하락 시 추가 매수/.test(await page.textContent('#sent-entries')));
        await page.evaluate(() => { SM.app.getState().strategies.length = 0; SM.app.ui.bt.strategyId = ''; SM.app.save(); }); // 뒤의 검사에 영향이 없게 정리
        await page.click('[data-act=btMode2][data-v=mg]'); await page.waitForSelector('.sgrid'); await page.evaluate(() => { SM.app.ui.bt.modeCfg.custom = SM.blankCfg(); }); }

      await page.fill('[data-btc=qty]', '10'); await page.fill('[data-btc=growth]', '2'); await page.fill('[data-btc=maxInvest]', '50,000,000');
      await page.evaluate(() => { const b = SM.app.ui.bt.cfg, mk = (t, o) => Object.assign(SM.app.ui.bt.cfg && { type: t }, o); b.entries.expr = { op: 'AND', items: [mk('dropLast', { pct: 3, basis: 'last', first: 'yes' })] }; b.entries.conds = SM.exprLeaves(b.entries.expr); b.exits.expr = { op: 'OR', items: [mk('avgPct', { dir: 'up', pct: 2 }), mk('avgPct', { dir: 'down', pct: 20 })] }; b.exits.conds = SM.exprLeaves(b.exits.expr); SM.app.render(); });
      await page.click('[data-act=btRun]'); await page.waitForSelector('table.cyc', { timeout: 10000 });
      const cf = await page.evaluate(() => { const c = SM.app.ui.bt.result.cfg; return { ml: c.maxLots, q: c.qty, g: c.growth, mi: c.maxInvest, e: SM.exprLeaves(SM.exprOf(c.entries)).map((x) => [x.type, x.pct, x.basis]), x: SM.exprLeaves(SM.exprOf(c.exits)).map((x) => [x.type, x.dir, x.pct]) }; });
      ok('실행: 10주·2배·3% 하락마다 추가·평단 +2% 전량 매도·손절 −20%·최대 5회·투입금 한도', Number(cf.q) === 10 && Number(cf.g) === 2 && cf.mi === '50,000,000' || Number(cf.mi) === 50000000 || cf.mi === '50000000', cf);
      ok('실행 조건 문장이 그대로 엔진에 전달됨', JSON.stringify(cf.e) === '[["dropLast",3,"last"]]' && JSON.stringify(cf.x) === '[["avgPct","up",2],["avgPct","down",20]]' && String(cf.ml) === '5', cf);
      await page.evaluate(() => { const b = SM.app.ui.bt.cfg; b.exits.expr = { op: 'OR', items: [{ op: 'AND', items: [{ type: 'maCross', ma: 'sma', s: 5, l: 15, dir: 'down' }, { type: 'maSlope', ma: 'sma', n: 30, k: 5, dir: 'down' }] }, { type: 'avgPct', dir: 'down', pct: 20 }] }; b.exits.conds = SM.exprLeaves(b.exits.expr); SM.app.render(); });
      await page.click('[data-act=btRun]'); await page.waitForSelector('table.cyc', { timeout: 10000 });
      const ct = await page.textContent('#view, main, body'); ok('결과에 사이클 분석(소요일·최대 투입금)이 표시됨', /사이클 분석/.test(ct) && /최대 투입금/.test(ct) && (await page.$$eval('table.cyc tr.cycrow', (e) => e.length)) >= 1, ct.slice(ct.indexOf('사이클 분석'), ct.indexOf('사이클 분석') + 200));
      await page.waitForSelector('#chartHost canvas.stockchart', { timeout: 10000 }); await page.waitForTimeout(500);
      ok('시뮬레이션 결과에도 종목 차트(이동평균·수급·거래량 설정, 일/주/월 전환)가 있음', (await page.$('#chartCard [data-act=chartTf]')) !== null && (await page.$('#chartCard .chartopts')) !== null && (await page.$$eval('#chartHost canvas', (e) => e.length)) === 1 && (await page.$('#btCandle')) === null);
      ok('사이클 목록은 간략(사이클·매수·투입금·손익·누적 손익 5열)하고 세부는 모두 기본 숨김', (await page.$$eval('table.cyc > thead th', (e) => e.map((x) => x.textContent).join())) === '사이클,매수,투입금,손익,누적 손익' && (await page.$$eval('tr.cycdet', (e) => e.length > 0 && e.every((x) => x.hidden))));
      { const col = await page.evaluate(() => { const rgb = (el) => getComputedStyle(el).color.match(/\d+/g).map(Number), pick = (sel) => { const e = document.querySelector(sel); return e ? rgb(e) : null; }; return { posProfit: pick('tr.cycrow td:nth-child(4) .v.pos'), negProfit: pick('tr.cycrow td:nth-child(4) .v.neg'), posCum: pick('tr.cycrow .cumc.pos'), negCum: pick('tr.cycrow .cumc.neg') }; });
        const red = (c) => c && c[0] > c[2] + 40, blue = (c) => c && c[2] > c[0] + 40;
        ok('사이클 손익·누적 손익: 플러스는 빨강, 마이너스는 파랑', (col.posProfit ? red(col.posProfit) : true) && (col.negProfit ? blue(col.negProfit) : true) && (col.posCum ? red(col.posCum) : true) && (col.negCum ? blue(col.negCum) : true) && !!(col.posProfit || col.negProfit) && !!(col.posCum || col.negCum), col); }
      { const cum = await page.evaluate(() => { const r = SM.app.ui.bt.result, cur = r.cfg.market === 'US' ? 'USD' : 'KRW'; let acc = 0; const want = r.cycles.map((c) => { acc += c.realized; return SM.fmtMoney(acc, cur); }); const got = [...document.querySelectorAll('tr.cycrow .cumc')].map((e) => e.textContent.trim()); return { want: want.slice(0, 3), got: got.slice(0, 3), n: want.length, m: got.length }; });
        ok('사이클 목록의 누적 손익 열: 청산된 사이클의 손익을 차례로 더한 값', cum.m >= cum.n && cum.want.length > 0 && cum.want.every((w, i) => w === cum.got[i]), cum); }
      const dn = await page.$eval('tr.cycdet', (e) => e.hidden); await page.click('tr.cycrow'); await page.waitForTimeout(100);
      if (process.env.CYC_SHOT) await (await page.$('table.cyc')).screenshot({ path: process.env.CYC_SHOT });
      const det = await page.$eval('tr.cycdet', (e) => ({ hidden: e.hidden, t: e.textContent.replace(/\s+/g, ' ') })), row = await page.$eval('tr.cycrow', (e) => e.getAttribute('aria-expanded'));
      ok('사이클 줄을 누르면 매수마다의 평단·목표가·수익이 펼쳐짐(1, 1-2…, 매도 ✓)', dn === true && det.hidden === false && row === 'true' && /평단/.test(det.t) && /가격 × 수량/.test(det.t) && /최대 투입금/.test(det.t) && /✓ 매도|진행 중/.test(det.t), det.t.slice(0, 300));
      { const w = await page.evaluate(() => { const det = document.querySelector('tr.cycdet:not([hidden])'); return { h: det ? [...det.querySelectorAll('thead th')].map((x) => x.textContent) : [], b: det ? det.querySelector('tbody tr td.c-why') && det.querySelector('tbody tr td.c-why').textContent : '', s: det && det.querySelector('tr.cycsell td.c-why') ? det.querySelector('tr.cycsell td.c-why').textContent : (det && det.querySelector('tr.muted') ? 'open' : '') }; });
        ok('세부 사이클: 평단 옆에 매수·매도 조건 열(매수=하락 시 추가 매수, 매도=신호 청산·평단 손절 등)', w.h.includes('매수·매도 조건') && /하락 시 추가 매수/.test(w.b) && (w.s === 'open' || /신호 청산|평단|목표|손절|데드크로스/.test(w.s)), w); }
      await page.click('tr.cycrow'); ok('다시 누르면 접힘', (await page.$eval('tr.cycdet', (e) => e.hidden)) === true);
      { const cfgx = await page.evaluate(() => SM.app.ui.bt.result.cfg.exits.conds.map((x) => [x.type, x.ma, x.s, x.l, x.dir]));
        ok('매도 방식 데드크로스: 5일선이 15일선 아래로(단순 이동평균) + 30일선 하락 중(기본 켜짐)으로 실행', JSON.stringify(cfgx) === '[["maCross","sma",5,15,"down"],["maSlope","sma",null,null,"down"],["avgPct",null,null,null,"down"]]', cfgx);
        ok('결과 순서: 차트가 맨 위, 사이클 분석이 그 아래', await page.evaluate(() => { const c = document.getElementById('chartCard'), y = document.querySelector('table.cyc'); return !!(c.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING); }));
        const top = await page.evaluate(() => [...document.querySelectorAll('.cards4 .stat span')].map((e) => e.textContent).join('|'));
        ok('사이클 요약: 매수 횟수·쓴 돈·산 수량·청산까지(평균, 최대)와 횟수 분포', /매수 횟수\(평균\)/.test(top) && /쓴 돈\(평균\)/.test(top) && /산 수량\(평균\)/.test(top) && /청산까지\(평균\)/.test(top) && (await page.$$('.dist-r')).length >= 1, top);
        ok('청산된 순번 표는 사이클이 있으면 기본으로 접혀 있음', await page.evaluate(() => { const d = [...document.querySelectorAll('details.box')].find((x) => /청산된 순번/.test(x.textContent.slice(0, 40))); return !!d && !d.open; })); }
      { // 누적 손익 곡선을 누르면 그 날짜로 차트 이동, 사이클을 누르면 그 구간으로 이동
        await page.evaluate(() => { document.getElementById('btEquity').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(150);
        const eqb = await (await page.$('#btEquity')).boundingBox(), n = await page.evaluate(() => SM.app.ui.bt.result.equity.length);
        await page.evaluate(() => { SM.app._chart().state.cross = null; SM.app._chart().focusRange(SM.app.ui.bt.result.equity[0].d, null); });
        await page.mouse.click(eqb.x + 56 + (eqb.width - 64) * 0.8, eqb.y + 60); await page.waitForTimeout(150);
        const f = await page.evaluate(() => { const s = SM.app._chart().state, r = SM.app.ui.bt.result; return { cross: s.cross, date: s.cross != null ? s.bars.d[s.cross] : null, eq: r.equity.map((e) => e.d) }; });
        const want = f.eq[Math.round((n - 1) * 0.8)];
        ok('누적 손익 곡선(80% 지점)을 누르면 차트에 그 날짜 십자선이 표시되고 그 날짜가 보임', f.cross != null && Math.abs(f.eq.indexOf(f.date) - f.eq.indexOf(want)) <= 3, [f.date, want]);
        const cy = await page.evaluate(() => { const c = SM.app.ui.bt.result.cycles[8]; return { from: c.startDate, to: c.endDate }; });
        await page.evaluate(() => SM.app._chart().focusRange(SM.app.ui.bt.result.equity[0].d, null));
        await page.click('tr.cycrow[data-from="' + cy.from + '"]'); await page.waitForTimeout(150);
        const vis = await page.evaluate(() => { const s = SM.app._chart().state, d = s.bars.d, w = s.geom; return [d[w.from], d[w.to]]; });
        ok('사이클 줄을 누르면 차트가 그 사이클 구간(시작~종료)을 보여줌', vis[0] <= cy.from && vis[1] >= cy.to, [vis, cy]);
        await page.click('tr.cycrow[data-from="' + cy.from + '"]'); }
      { // 차트의 B·S 원을 누르면 그 사이클이 펼쳐지고 그 줄이 강조됨
        await page.evaluate(() => { document.querySelector('#chartHost canvas').scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }); await page.waitForTimeout(200);
        const target = await page.evaluate(() => { const s = SM.app._chart().state; const h = s.hits.filter((x) => x.kind === 'B' && x.seq >= 2)[0] || s.hits.filter((x) => x.kind === 'B')[0]; return h ? { x: h.x, y: h.y, no: h.no, seq: h.seq } : null; });
        ok('차트에 눌러볼 수 있는 B·S 원 위치가 기록됨', !!target && (await page.evaluate(() => SM.app._chart().state.hits.some((x) => x.kind === 'S'))), target);
        const cb = await (await page.$('#chartHost canvas')).boundingBox(); await page.mouse.click(cb.x + target.x, cb.y + target.y); await page.waitForTimeout(500);
        const st = await page.evaluate((t) => { const row = document.querySelector(`tr.cycrow[data-cd="${t.no}"]`) || document.querySelector(`tr.cycrow[data-cd="${t.no}o"]`), det = row && row.parentNode.querySelector(`tr.cycdet[data-cd="${row.dataset.cd}"]`); return { open: !!det && !det.hidden, exp: row && row.getAttribute('aria-expanded'), hl: !!(det && det.querySelector(`tr[data-seq="${t.seq}"].hl`)), others: [...document.querySelectorAll('tr.cycdet')].filter((d) => !d.hidden).length }; }, target);
        ok('B 원을 누르면 그 사이클만 펼쳐지고 그 매수 줄이 강조됨', st.open && st.exp === 'true' && st.hl && st.others === 1, st);
        const sh = await page.evaluate(() => { const h = SM.app._chart().state.hits.find((x) => x.kind === 'S'); return h && { x: h.x, y: h.y, no: h.no }; });
        await page.evaluate(() => { document.querySelector('#chartHost canvas').scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }); await page.waitForTimeout(200);
        const cb2 = await (await page.$('#chartHost canvas')).boundingBox(); await page.mouse.click(cb2.x + sh.x, cb2.y + sh.y); await page.waitForTimeout(500);
        ok('S 원을 누르면 그 사이클의 전량 매도 줄이 강조됨', await page.evaluate((no) => { const row = document.querySelector(`tr.cycrow[data-cd="${no}"]`), det = row.parentNode.querySelector(`tr.cycdet[data-cd="${no}"]`); return !det.hidden && !!det.querySelector('tr.cycsell.hl'); }, sh.no));
        await page.evaluate(() => document.querySelectorAll('tr.cycdet').forEach((d) => { d.hidden = true; })); }
      { // 캔들 아래 날짜 줄 + 재생 구간 선택(타임라인 손잡이·S/E 지정·차트 음영)
        ok('캔들 바로 아래에 날짜 줄이 있고 그 아래로 수급·거래량 패널이 이어짐', await page.evaluate(() => { const P = SM.app._chart().state.geom.P; return P[0].k === 'main' && P[1].k === 'dates' && P.length > 2; }));
        ok('구간 재생 메뉴는 기본으로 접혀 있고, 구간 지정 전에는 내비 막대·차트 음영이 없음', (await page.evaluate(() => !document.getElementById('rpWrap').open)) && (await page.$('#rpTimeline')) === null && (await page.evaluate(() => SM.app._chart().state.range)) === null);
        await page.evaluate(() => { document.getElementById('rpWrap').open = true; }); await page.waitForTimeout(100);
        await page.click('[data-act=rpSel]'); await page.waitForSelector('#rpTimeline');
        ok('“재생 구간 지정”을 누르면 내비게이션 막대(S·E)가 나타나고 차트에 선택 구간이 표시됨', (await page.$('#rpTimeline')) !== null && !!(await page.evaluate(() => SM.app._chart().state.range)) && /구간 지정 취소/.test(await page.textContent('[data-act=rpSel]')));
        if (process.env.MENU_SHOT) { await page.evaluate(() => { document.querySelector('.chartfirst').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await page.waitForTimeout(250); await page.screenshot({ path: process.env.MENU_SHOT }); }
        await page.evaluate(() => { document.getElementById('rpTimeline').scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(200);
        const idxOf = (d) => page.evaluate((x) => SM.app._chart().state.rawFull.d.indexOf(x), d);
        const tl0 = await page.evaluate(() => { const cv = document.getElementById('rpTimeline'), t = cv._tl, rp = SM.app._rp, d = SM.app._chart().state.rawFull.d; return { sx: t.X(d.indexOf(rp.start)), ex: t.X(d.indexOf(rp.end)), start: rp.start, end: rp.end }; });
        ok('구간 선택 막대(S·E 손잡이)가 있음', tl0.ex > tl0.sx && (await page.$('#rpTimeline')) !== null, tl0);
        const tb = await (await page.$('#rpTimeline')).boundingBox();
        await page.mouse.move(tb.x + tl0.sx, tb.y + 30); await page.mouse.down(); await page.mouse.move(tb.x + tl0.sx - 60, tb.y + 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
        const after = await page.evaluate(() => ({ start: SM.app._rp.start, end: SM.app._rp.end, input: document.querySelector('[data-rp=start]').value, range: SM.app._chart().state.range }));
        ok('S 손잡이를 왼쪽으로 끌면 시작일이 앞당겨지고 입력칸·차트 음영 구간도 같이 바뀜', after.start < tl0.start && after.end === tl0.end && after.input === after.start && after.range && after.range.from === after.start && after.range.to === after.end, after);
        await page.mouse.move(tb.x + tl0.ex, tb.y + 30); await page.mouse.down(); await page.mouse.move(tb.x + tl0.ex - 50, tb.y + 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
        ok('E 손잡이를 왼쪽으로 끌면 끝일이 앞당겨짐', (await page.evaluate(() => SM.app._rp.end)) < tl0.end);
        // 차트에서 날짜를 고른 뒤 S·E 지정
        await page.evaluate(() => { document.querySelector('#chartHost canvas').scrollIntoView({ block: 'start' }); window.scrollBy(0, -80); }); await page.waitForTimeout(200);
        const cvb = await (await page.$('#chartHost canvas')).boundingBox(), geo = await page.evaluate(() => { const g = SM.app._chart().state.geom; return { PL: g.PL, bw: g.bw, from: g.from, to: g.to }; });
        await page.mouse.move(cvb.x + geo.PL + (geo.from + 20 - geo.from + 0.5) * geo.bw, cvb.y + 120); await page.waitForTimeout(120);
        const cd = await page.evaluate(() => SM.app._chart().state.bars.d[SM.app._chart().state.cross]);
        await page.evaluate(() => document.querySelector('[data-act=rpSetS]').scrollIntoView({ block: 'center' })); await page.click('[data-act=rpSetS]'); await page.waitForTimeout(120);
        if (process.env.RNG_SHOT) { await page.evaluate(() => { document.querySelector('.chartfirst').scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await page.waitForTimeout(200); await (await page.$('.chartfirst')).screenshot({ path: process.env.RNG_SHOT }); }
        const sset = await page.evaluate(() => SM.app._rp.start); ok('차트에서 고른 날짜(십자선)로 S 지정', sset === cd || sset <= cd && cd <= sset.replace(/\d$/, '9'), [sset, cd]);
        await page.evaluate(() => { const r = SM.app.ui.bt.result, d = SM.app._chart().state.rawFull.d, set = (k, v) => { const el = document.querySelector('[data-rp=' + k + ']'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; set('end', d[r.endIdx]); set('start', d[Math.max(r.startIdx, r.endIdx - 15)]); }); // 뒤의 재생 검사를 위해 구간을 기본값으로 되돌림
        await page.waitForTimeout(100);
        await page.click('[data-act=rpSel]'); await page.waitForTimeout(100);
        ok('“구간 지정 취소”를 누르면 내비게이션 막대와 차트의 선택 구간이 사라짐', (await page.$('#rpTimeline')) === null && (await page.evaluate(() => SM.app._chart().state.range)) === null && /재생 구간 지정/.test(await page.textContent('[data-act=rpSel]'))); }
      { // 차트 구간 확대: 시작점에서 오른쪽으로 끌면 확대, 왼쪽으로 끌면 원래 화면(버튼·Shift·우클릭)
        const toTop = async () => { await page.evaluate(() => { document.querySelector('#chartHost canvas').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); }); await page.waitForTimeout(150); return (await page.$('#chartHost canvas')).boundingBox(); };
        const v0 = await page.evaluate(() => { const s = SM.app._chart().state; return { count: s.count, end: s.end }; });
        await page.click('#zoomBtn'); ok('구간 확대 버튼을 켜면 표시가 바뀜', /확대/.test(await page.textContent('#zoomBtn')) && (await page.evaluate(() => SM.app._chart().state.zoomSel)) === true);
        let cvz = await toTop(); await page.mouse.move(cvz.x + 120, cvz.y + 100); await page.mouse.down(); await page.mouse.move(cvz.x + 260, cvz.y + 100, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
        const v1 = await page.evaluate(() => { const s = SM.app._chart().state; return { count: s.count, end: s.end, zs: s.zoomSel, home: !!s.homeView }; });
        ok('시작점에서 오른쪽으로 끌면 그 구간이 화면 가득(보이는 봉 수가 줄고) 확대되며 선택 모드는 꺼짐', v1.count < v0.count && v1.home && v1.zs === false, [v0, v1]);
        await page.click('#zoomBtn'); cvz = await toTop(); await page.mouse.move(cvz.x + 240, cvz.y + 100); await page.mouse.down(); await page.mouse.move(cvz.x + 80, cvz.y + 100, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
        const v2 = await page.evaluate(() => { const s = SM.app._chart().state; return { count: s.count, end: s.end, home: !!s.homeView }; });
        ok('왼쪽으로 끌면 확대 전 원래 화면으로 돌아옴', v2.count === v0.count && v2.end === v0.end && !v2.home, [v0, v2]);
        cvz = await toTop(); await page.keyboard.down('Shift'); await page.mouse.move(cvz.x + 150, cvz.y + 100); await page.mouse.down(); await page.mouse.move(cvz.x + 260, cvz.y + 100, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift'); await page.waitForTimeout(150);
        ok('마우스는 Shift+드래그로도 확대', (await page.evaluate(() => SM.app._chart().state.count)) < v0.count);
        await page.evaluate(() => SM.app._chart().resetZoom()); await page.waitForTimeout(100); }
      { // 휠 확대·축소: 커서가 놓인 봉이 같은 자리에 그대로 있음(보고 싶은 위치가 밀려나지 않음)
        await page.evaluate(() => { document.querySelector('#chartHost canvas').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); }); await page.waitForTimeout(150);
        const cb = await (await page.$('#chartHost canvas')).boundingBox();
        const dateAt = (x) => page.evaluate((cx) => { const c = document.querySelector('#chartHost canvas'), r = c.getBoundingClientRect(), st = SM.app._chart().state, g = st.geom, i = Math.floor(g.from + (cx - r.left - g.PL) / g.bw); return { d: st.bars.d[Math.max(0, Math.min(st.bars.d.length - 1, i))], count: st.count }; }, x);
        for (const frac of [0.25, 0.6]) {
          const x = cb.x + cb.width * frac; await page.mouse.move(x, cb.y + 120); await page.waitForTimeout(80);
          const b0 = await dateAt(x); await page.mouse.wheel(0, 300); await page.waitForTimeout(150); const b1 = await dateAt(x); await page.mouse.wheel(0, -300); await page.mouse.wheel(0, -300); await page.waitForTimeout(150); const b2 = await dateAt(x);
          const di = (a, b) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86400000;
          ok(`휠을 아래로 굴리면 확대(커서 ${Math.round(frac * 100)}% 지점): 봉 수가 줄었는데도 커서 아래 날짜가 그대로(±3일)`, b1.count < b0.count && di(b0.d, b1.d) <= 3, [b0, b1]);
          ok(`휠을 위로 굴리면 축소(커서 ${Math.round(frac * 100)}% 지점): 봉 수가 늘었는데도 커서 아래 날짜가 그대로(±5일)`, b2.count > b1.count && di(b0.d, b2.d) <= 5, [b0, b2]);
        }
        // 마우스 우클릭 구간 확대: 시작점에서 오른쪽으로 끌면 그 구간 확대, 왼쪽으로 끌면 원래 화면
        await page.evaluate(() => SM.app._chart().resetZoom()); await page.waitForTimeout(80);
        const st = () => page.evaluate(() => { const s = SM.app._chart().state; return { count: s.count, end: s.end, cross: s.cross }; }), x0 = cb.x + cb.width * 0.4, y0 = cb.y + 120, s0 = await st();
        await page.mouse.move(x0, y0); await page.mouse.down({ button: 'right' }); await page.mouse.move(x0 + 180, y0, { steps: 8 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(120);
        const s1 = await st(); ok('우클릭 드래그 시작점→오른쪽: 그 구간으로 확대(보이는 봉 수 감소)', s1.count < s0.count, [s0, s1]);
        await page.mouse.move(x0 + 180, y0); await page.mouse.down({ button: 'right' }); await page.mouse.move(x0 + 20, y0, { steps: 8 }); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(120);
        const s2 = await st(); ok('우클릭 드래그 왼쪽으로: 원래 화면으로 복귀', s2.count === s0.count && s2.end === s0.end, [s0, s2]);
        ok('우클릭 드래그 후 십자선이 남지 않음', s2.cross === null);
        await page.evaluate(() => SM.app._chart().resetZoom()); }
      { // 재생(리플레이): 시작일 이전은 모두 보이고 이후는 한 봉씩, 배속·주봉
        const nBars = () => page.evaluate(() => SM.app._chart().state.bars.d.length), full = await nBars();
        if (process.env.SIM_SHOT2) { await page.click('[data-act=rpStart]'); await page.waitForSelector('#rpSlider'); for (let i = 0; i < 4; i++) await page.click('[data-act=rpStep][data-v="1"]'); await page.waitForTimeout(200); await page.screenshot({ path: process.env.SIM_SHOT2, fullPage: false }); if (process.env.SIM_SHOT3) { await page.click('[data-act=chartMonths][data-v="3"]'); await page.waitForTimeout(200); await (await page.$('.chartfirst')).screenshot({ path: process.env.SIM_SHOT3 }); } await page.click('[data-act=rpEnd]'); }
        await page.click('[data-act=rpStart]'); await page.waitForSelector('#rpSlider'); await page.waitForTimeout(150);
        const n0 = await nBars(), rp0 = await page.evaluate(() => SM.app._rp.cur);
        ok('재생 시작: 시작일까지의 봉만 보이고 그 뒤는 숨겨짐(미래 봉 없음)', n0 < full && (await page.evaluate(() => { const b = SM.app._chart().state.bars; return b.d[b.d.length - 1] <= SM.app._rp.cur; })), [n0, full]);
        ok('재생 상태 표시(날짜·종가·보유·평단·평가손익)', /종가/.test(await page.textContent('#rpState')) && /실현손익/.test(await page.textContent('#rpState')));
        await page.click('[data-act=rpStep][data-v="1"]'); await page.waitForTimeout(100); ok('한 봉 앞으로: 봉이 1개 늘고 날짜가 바뀜', (await nBars()) === n0 + 1 && (await page.evaluate(() => SM.app._rp.cur)) > rp0);
        await page.click('[data-act=rpStep][data-v="-1"]'); await page.waitForTimeout(100); ok('한 봉 뒤로', (await nBars()) === n0);
        await page.click('[data-act=rpSpeed][data-v="30"]'); await page.click('[data-act=rpPlay]'); await page.waitForFunction(() => !SM.app._rp.playing, null, { timeout: 15000 });
        ok('30배속 재생: 끝날짜까지 가서 자동 정지, 슬라이더도 끝', (await page.evaluate(() => SM.app._rp.cur === SM.app._rp.end)) && (await nBars()) === full && (await page.$eval('#rpSlider', (e) => e.value === e.max)));
        await page.click('[data-act=rpRestart]'); await page.click('[data-act=chartTf][data-v=W]'); await page.waitForTimeout(150);
        const w0 = await nBars(); await page.click('[data-act=rpUnit][data-v=week]'); await page.click('[data-act=rpStep][data-v="1"]'); await page.waitForTimeout(100);
        const d1 = await page.evaluate(() => SM.app._rp.cur); ok('주봉으로 재생: 한 주씩 앞으로', (await page.evaluate(() => SM.app._chart().state.bars.d.length)) >= w0 && d1 > rp0);
        await page.click('[data-act=chartTf][data-v=D]'); await page.click('[data-act=rpEnd]'); await page.waitForTimeout(150); ok('종료: 전체 봉이 다시 보임', (await nBars()) === full && (await page.$('[data-act=rpStart]')) !== null); }
      { // 재생 중에도 S·E 구간 수정: E를 현재 위치보다 앞으로 끌면 현재 위치가 E로 당겨지고 재생이 멈춤, 슬라이더 범위도 갱신
        await page.evaluate(() => { document.querySelector('[data-act=rpStart]').scrollIntoView({ block: 'center' }); });
        await page.click('[data-act=rpStart]'); await page.waitForSelector('#rpSlider');
        for (let k = 0; k < 6; k++) await page.click('[data-act=rpStep][data-v="1"]');
        await page.evaluate(() => document.getElementById('rpTimeline').scrollIntoView({ block: 'center' })); await page.waitForTimeout(150);
        const g0 = await page.evaluate(() => { const cv = document.getElementById('rpTimeline'), t = cv._tl, d = SM.app._chart().state.rawFull.d, rp = SM.app._rp; return { ex: t.X(d.indexOf(rp.end)), sx: t.X(d.indexOf(rp.start)), s2: t.X(d.indexOf(rp.start) + 3), end: rp.end, start: rp.start, cur: rp.cur }; });
        const tl = await (await page.$('#rpTimeline')).boundingBox();
        await page.mouse.move(tl.x + g0.ex, tl.y + 30); await page.mouse.down(); await page.mouse.move(tl.x + g0.s2, tl.y + 30, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(200);
        const g1 = await page.evaluate(() => { const rp = SM.app._rp, sl = document.getElementById('rpSlider'), d = SM.app._chart().state.rawFull.d; return { end: rp.end, cur: rp.cur, playing: rp.playing, smax: +sl.max, eidx: d.indexOf(rp.end), on: rp.on, bars: SM.app._chart().state.bars.d.length }; });
        ok('재생 중 E 손잡이를 현재 위치보다 앞으로 끌면 끝이 당겨지고 현재 위치도 E로 맞춰짐', g1.on && g1.end < g0.end && g1.cur === g1.end && !g1.playing, [g0, g1]);
        ok('재생 중 구간을 바꾸면 슬라이더 범위도 새 구간으로 바뀜', g1.smax === g1.eidx, g1);
        const g2s = await page.evaluate(() => { const cv = document.getElementById('rpTimeline'), t = cv._tl, d = SM.app._chart().state.rawFull.d, rp = SM.app._rp; return { sx: t.X(d.indexOf(rp.start)), to: t.X(d.indexOf(rp.start) - 4) }; });
        await page.mouse.move(tl.x + g2s.sx, tl.y + 30); await page.mouse.down(); await page.mouse.move(tl.x + g2s.to, tl.y + 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
        ok('재생 중 S 손잡이를 앞으로 끌어 시작을 넓힐 수 있음', (await page.evaluate(() => SM.app._rp.start)) < g0.start);
        await page.click('[data-act=rpEnd]'); await page.waitForTimeout(100);
        await page.evaluate(() => { const r = SM.app.ui.bt.result, d = SM.app._chart().state.rawFull.d, set = (k, v) => { const el = document.querySelector('[data-rp=' + k + ']'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }; set('end', d[r.endIdx]); set('start', d[Math.max(r.startIdx, r.endIdx - 15)]); }); }
      { // 수급 신호 + 추세 + 가격 조건을 한 문장으로 만들어 실행
        await page.evaluate(() => { const b = SM.app.ui.bt.cfg; b.entries.expr = { op: 'AND', items: [{ type: 'flow', who: 'both', dir: 'buy', mode: 'day', v: 1, n: 3 }, { type: 'volPrev', x: 1 }, { type: 'maSlope', ma: 'sma', n: 30, k: 5, dir: 'up' }, { type: 'priceMa', ma: 'sma', n: 30, dir: 'below' }] }; b.entries.conds = SM.exprLeaves(b.entries.expr); SM.app.render(); });
        await page.click('[data-act=btRun]'); await page.waitForSelector('#chartHost canvas.stockchart', { timeout: 10000 }); await page.waitForTimeout(300);
        const ec = await page.evaluate(() => { const c = SM.app.ui.bt.result.cfg; return { e: SM.exprLeaves(SM.exprOf(c.entries)).map((x) => [x.type, x.who, x.n, x.dir, x.x].join(':')), x: SM.exprLeaves(SM.exprOf(c.exits)).map((y) => y.type), xm: SM.exprOf(c.exits).op }; });
        ok('외국인·기관 동시 순매수 + 거래량 전일 대비 + 30일선 상승 + 종가 30일선 아래를 문장으로 실행', ec.e.join('|') === 'flow:both:3:buy:|volPrev::::1|maSlope::30:up:|priceMa::30:below:' && ec.x.join() === 'maCross,maSlope,avgPct', ec); }
      await page.click('[data-act=chartMonths][data-v="0"]'); await page.waitForTimeout(300); await (await page.$('#chartCard')).screenshot({ path: process.env.BT_SHOT || '/tmp/bt_chart.png' });
    }
    { // 직접 조건(문장 빌더): 매수(분홍)·매도(하늘), 선택창에서 분류→조건, 문장으로 이어 붙이고 AND/OR·괄호·신호 진단
      await page.click('[data-act=btMode2][data-v=custom]'); await page.waitForSelector('.cndbox.buy');
      ok('직접 조건: 매수 조건·매도 조건 상자가 따로 있음', (await page.$('.cndbox.buy')) !== null && (await page.$('.cndbox.sell')) !== null && /매수 조건/.test(await page.textContent('.cndbox.buy .cndbox-h')) && /매도 조건/.test(await page.textContent('.cndbox.sell .cndbox-h')));
      const bg = await page.evaluate(() => [getComputedStyle(document.querySelector('.cndbox.buy')).backgroundColor, getComputedStyle(document.querySelector('.cndbox.sell')).backgroundColor]);
      ok('매수는 연한 분홍·매도는 연한 하늘 배경(서로 다른 색)', bg[0] !== bg[1] && /rgba\(255, 45, 85/.test(bg[0]) && /rgba\(50, 173, 230/.test(bg[1]), bg);
      const sentTxt = (g) => page.textContent(`#sent-${g}`);
      ok('직접 조건 만들기는 매수·매도 조건이 비어 있음', /조건을 추가하세요/.test(await page.textContent('#sent-entries')) && /조건을 추가하세요/.test(await page.textContent('#sent-exits')) && (await page.evaluate(() => SM.app.ui.bt.cfg.entries.conds.length)) === 0);
      await page.waitForSelector('.cndbox.buy .cnd-add');
      await page.click('.cndbox.buy [data-act=btPickOpen]'); await page.waitForSelector('.sheet.buy');
      const tabs = await page.$$eval('.sheet .pick-tabs .chip', (e) => e.map((x) => x.textContent));
      ok('조건 선택창: 분류 탭(거래량·이동평균·수급 …)으로 모아 보여 줌', ['거래량', '이동평균', '수급'].every((t) => tabs.includes(t)) && !tabs.includes('청산'), tabs);
      await page.click('.sheet .pick-tabs .chip:has-text("수급")'); const flowRows = await page.$$eval('.sheet .pickrow', (e) => e.map((x) => x.textContent));
      ok('수급 분류에 “수급 누적 순매수(N일 합)” 조건이 있음', flowRows.some((x) => /수급 누적 순매수/.test(x)) && flowRows.some((x) => /수급 \(외국인·기관·개인\)/.test(x)), flowRows);
      await page.click('.sheet .pick-tabs .chip:has-text("분할매수")'); await page.click('.sheet .pickrow[data-t=dropLast]'); await page.waitForSelector('.cndbox.buy .tok');
      ok('조건을 고르면 선택창이 닫히고 문장에 조건이 들어가고 값 편집칸이 열림', (await page.$('.sheet')) === null && /하락 시 추가 매수/.test(await sentTxt('entries')) && /일 때 매수/.test(await sentTxt('entries')) && (await page.$('.cndbox.buy .tok-ed.show')) !== null);
      await page.click('.cndbox.buy [data-act=btPickOpen]'); await page.click('.sheet .pick-tabs .chip:has-text("거래량")'); await page.click('.sheet .pickrow[data-t=volPrev]'); await page.waitForSelector('.cndbox.buy .cn');
      ok('두 번째 조건은 AND로 이어짐(문장: … AND 거래량이 전일보다 높음 일 때 매수)', /AND/.test(await sentTxt('entries')) && /거래량이 전일보다 높음/.test(await sentTxt('entries')), await sentTxt('entries'));
      await page.fill('.cndbox.buy .tok-ed.show [data-btp$="|x"]', '1.5'); await page.waitForTimeout(100);
      ok('값을 고치면 문장 속 조건 글자가 바로 바뀜(전일의 1.5배 초과)', /전일의 1.5배 초과/.test(await sentTxt('entries')), await sentTxt('entries'));
      await page.click('.cndbox.buy .cn'); ok('AND를 누르면 OR로 바뀜', /OR/.test(await sentTxt('entries')) && (await page.evaluate(() => SM.app.ui.bt.cfg.entries.expr.op)) === 'OR');
      await page.click('.cndbox.buy .cn');
      // 세 번째 조건(이동평균선 상승) 추가 → 문장: 하락 AND 거래량 AND 이평선 상승. 1번째와 3번째를 골라 묶으면 (하락 AND 이평선 상승) OR 거래량
      await page.click('.cndbox.buy [data-act=btPickOpen]'); await page.click('.sheet .pick-tabs .chip:has-text("이동평균")'); await page.click('.sheet .pickrow[data-t=maSlope]'); await page.waitForTimeout(150);
      await page.click('.cndbox.buy [data-act=btWrapToggle]'); await page.waitForSelector('[data-act=btWrapDo]');
      const toks = await page.$$('.cndbox.buy #sent-entries > .tok .tok-b'); await toks[0].click(); await toks[2].click();
      ok('묶기 모드: 고른 조건 개수가 버튼에 표시', /\(2\)/.test(await page.textContent('[data-act=btWrapDo]')));
      await page.click('[data-act=btWrapDo]'); await page.waitForSelector('.cndbox.buy .grp');
      const ex = await page.evaluate(() => { const e = SM.app.ui.bt.cfg.entries.expr; return { op: e.op, n: e.items.length, g: e.items[0] && e.items[0].items ? { op: e.items[0].op, t: e.items[0].items.map((x) => x.type) } : null, last: e.items[1] && e.items[1].type, conds: SM.app.ui.bt.cfg.entries.conds.length }; });
      if (process.env.WRAP_SHOT) await (await page.$('.cndbox.buy')).screenshot({ path: process.env.WRAP_SHOT });
      ok('떨어진 두 조건을 묶으면 (A and C) or B: 묶음은 지금 연결(AND) 그대로, 바깥은 OR로 바뀜', ex.op === 'OR' && ex.n === 2 && ex.g && ex.g.op === 'AND' && ex.g.t.join() === 'dropLast,maSlope' && ex.last === 'volPrev' && ex.conds === 3, ex);
      ok('문장에 괄호가 표시되고 풀이 문장이 나옴', /\(/.test(await sentTxt('entries')) && /그리고/.test(await page.textContent('.cndbox.buy .sent-plain')) && /또는/.test(await page.textContent('.cndbox.buy .sent-plain')), await page.textContent('.cndbox.buy .sent-plain'));
      if (process.env.EXPR_SHOT) { await page.evaluate(() => { const g = SM.app.ui.bt.cfg.exits; g.expr = { op: 'OR', items: [{ type: 'maCross', ma: 'sma', s: 5, l: 15, dir: 'down' }] }; g.conds = SM.exprLeaves(g.expr); SM.app.render(); }); await page.waitForTimeout(200); await (await page.$('.cndbox.buy')).screenshot({ path: process.env.EXPR_SHOT + '_buy.png' }); await (await page.$('.cndbox.sell')).screenshot({ path: process.env.EXPR_SHOT + '_sell.png' }); }
      ok('신호 진단: 신호일 수와 전체 일수 대비 %가 표시됨', /매수 신호일/.test(await page.textContent('.cndbox.buy .diag-h')) && /전체 \d+일 중/.test(await page.textContent('.cndbox.buy .diag-h')), await page.textContent('.cndbox.buy .diag-h'));
      await page.click('.cndbox.sell [data-act=btPickOpen]'); await page.waitForSelector('.sheet.sell'); const tabs2 = await page.$$eval('.sheet .pick-tabs .chip', (e) => e.map((x) => x.textContent)); ok('매도 선택창에는 청산 분류가 있고 하락 시 추가 매수 같은 매수 전용은 없음', tabs2.includes('청산') && !tabs2.includes('분할매수'), tabs2);
      await page.click('.sheet .pick-tabs .chip:has-text("거래량")'); const vrows = await page.$$eval('.sheet .pickrow', (e) => e.map((x) => x.textContent));
      ok('거래량 분류에 증가·감소 / 거래량 이동평균 비교 / 하락+거래량 급증(손절 신호) 조건이 있음', vrows.some((x) => /거래량 증가·감소/.test(x)) && vrows.some((x) => /거래량 이동평균 비교/.test(x)) && vrows.some((x) => /하락 \+ 거래량 급증/.test(x)), vrows);
      await page.click('.sheet .pickrow[data-t=dropVol]'); await page.waitForSelector('.cndbox.sell .tok');
      ok('매도 문장에 “당일 2% 이상 하락 + 거래량이 20일 평균의 2배 이상” 조건이 들어감(문장 안에서 AND/OR로 다른 조건과 연결 가능)', /당일 2% 이상 하락 \+ 거래량이 20일 평균의 2배 이상/.test(await page.textContent('#sent-exits')), await page.textContent('#sent-exits'));
      await page.click('.cndbox.sell [data-act=btPickOpen]'); await page.waitForSelector('.sheet.sell'); await page.click('.sheet .pick-tabs .chip:has-text("거래량")'); await page.click('.sheet .pickrow[data-t=volMa]'); await page.waitForSelector('.cndbox.sell .cn');
      ok('거래량 이동평균 조건 추가: 문장에 “거래량이 20일 거래량 평균 초과”가 AND로 이어짐', /거래량이 20일 거래량 평균 초과/.test(await page.textContent('#sent-exits')) && /AND|OR/.test(await page.textContent('#sent-exits')), await page.textContent('#sent-exits'));
      await page.click('.cndbox.sell [data-act=btPickOpen]'); await page.waitForSelector('.sheet.sell');
      await page.click('.sheet .pick-tabs .chip:has-text("청산")'); await page.click('.sheet .pickrow[data-t=avgPct]'); await page.waitForSelector('.cndbox.sell .indep .tok');
      ok('청산 조건(평단 대비 ±N%)은 문장 밖 “별개로, 도달하면 바로 매도”에 표시', /별개로/.test(await page.textContent('.cndbox.sell .indep')) && /평단 대비/.test(await page.textContent('.cndbox.sell .indep')));
      await page.click('.cndbox.buy .grp .par.o'); await page.waitForTimeout(150);
      ok('괄호 “(”를 누르면 풀림: 조건이 같은 층에 모두 연결', (await page.$('.cndbox.buy .grp')) === null && (await page.evaluate(() => SM.app.ui.bt.cfg.entries.expr.items.length)) === 3);
      await page.click('.cndbox.buy #sent-entries > .tok .tok-b'); await page.click('.cndbox.buy .tok-ed.show [data-act=btDel]'); await page.waitForTimeout(100);
      ok('삭제하면 문장에서 사라지고 남은 조건으로 이어짐', (await page.evaluate(() => SM.app.ui.bt.cfg.entries.conds.length)) === 2);
      await page.evaluate(() => { const b = SM.app.ui.bt.cfg; b.entries.expr = { op: 'AND', items: [{ type: 'volPrev', x: 1 }, { op: 'OR', items: [{ type: 'maSlope', ma: 'sma', n: 30, k: 5, dir: 'up' }, { type: 'dropLast', pct: 3, basis: 'last', first: 'yes' }] }] }; b.entries.conds = SM.exprLeaves(b.entries.expr); SM.app.render(); });
      await page.click('[data-act=btRun]'); await page.waitForSelector('#chartHost canvas.stockchart', { timeout: 10000 }); await page.waitForTimeout(300);
      ok('조건식(괄호 포함)으로 시뮬레이션 실행', await page.evaluate(() => { const r = SM.app.ui.bt.result; return !!r && !r.error && r.cfg.entries.expr && r.cfg.entries.expr.items[1].op === 'OR'; }));
      { // 매수 규칙 추가(규칙별 수량)
        await page.click('[data-act=btRuleAdd]'); await page.waitForSelector('#cnd-r1');
        ok('매수 규칙 추가: 규칙 2 상자와 수량 칸이 생기고 기본 상자는 “매수 규칙 1”로 바뀜', /매수 규칙 2/.test(await page.textContent('#cnd-r1 .cndbox-h')) && (await page.$('#cnd-r1 [data-btrq="0"]')) !== null && /매수 규칙 1/.test(await page.textContent('#cnd-entries .cndbox-h')));
        await page.click('#cnd-r1 [data-act=btPickOpen]'); await page.waitForSelector('.sheet.buy'); await page.click('.sheet .pick-tabs .chip:has-text("거래량")'); await page.click('.sheet .pickrow[data-t=volPrev]'); await page.waitForSelector('#cnd-r1 .tok');
        await page.fill('#cnd-r1 [data-btrq="0"]', '30'); await page.waitForTimeout(80);
        ok('규칙 2에 조건을 넣고 수량 30을 입력하면 전략 설정에 저장됨', await page.evaluate(() => { const r = SM.app.ui.bt.cfg.rules[0]; return r && String(r.qty) === '30' && r.conds.length === 1 && r.conds[0].type === 'volPrev'; }));
        await page.click('[data-act=btRun]'); await page.waitForSelector('#chartHost canvas.stockchart', { timeout: 10000 }); await page.waitForTimeout(300);
        ok('규칙이 있는 전략으로 시뮬레이션 실행(오류 없음, 규칙이 결과 설정에 포함)', await page.evaluate(() => { const r = SM.app.ui.bt.result; return !!r && !r.error && r.cfg.rules.length === 1; }));
        await page.click('#cnd-r1 [data-act=btRuleDel]'); await page.waitForTimeout(100);
        ok('규칙 삭제: 상자가 사라지고 기본 상자가 다시 “매수 조건”', (await page.$('#cnd-r1')) === null && /매수 조건/.test(await page.textContent('#cnd-entries .cndbox-h')) && (await page.evaluate(() => SM.app.ui.bt.cfg.rules.length)) === 0); }
      await page.click('[data-act=btMode2][data-v=mg]'); }
      { // 종목 일괄 비교: 데이터가 둘 이상이면 표 한 장(이익 종목 수·중앙값·뒤 구간·단순 보유)
        await page.click('[data-act=btMode2][data-v=mg]'); await page.waitForSelector('.cndbox.buy');
        await page.evaluate(() => { const o = SM.app.ui.bt.cfg, r = SM.app.ui.bt.repo && SM.app.ui.bt.repo.cache['003490']; const d = JSON.parse(JSON.stringify(r.data)); const ds = JSON.parse(localStorage.getItem('stockmgr.datasets') || '{}'); ds.extra1 = { name: '추가 종목(테스트)', market: 'KR', added: Date.now(), data: d }; localStorage.setItem('stockmgr.datasets', JSON.stringify(ds)); SM.app.render(); void o; });
        await page.waitForSelector('[data-act=btAll]'); await page.evaluate(() => { const b = SM.app.ui.bt.cfg; b.entries.expr = { op: 'AND', items: [{ type: 'dropLast', pct: 5, basis: 'last', first: 'yes' }] }; b.entries.conds = SM.exprLeaves(b.entries.expr); });
        await page.click('[data-act=btAll]'); await page.waitForSelector('.cmp tbody tr', { timeout: 20000 });
        const rows = await page.$$eval('h3.sim-h', (e) => e.map((x) => x.textContent)), t = await page.textContent('.stat:has-text("이익 난 종목")');
        ok('종목 일괄 비교: 제목과 요약 카드가 나옴', rows.some((x) => /종목 일괄 비교/.test(x)) && /\d+ \/ \d+/.test(t) && /뒤 구간에서도 이익/.test(await page.textContent('.cards4')), t);
        const body = await page.$$eval('table.cmp:has(th:has-text("뒤 구간")) tbody tr', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
        ok('표에 데이터별 한 줄(종목·매수·총손익·수익률·단순 보유·앞/뒤 구간)', body.length >= 2 && body.some((x) => /추가 종목\(테스트\)/.test(x)) && body.every((x) => /회|오류|읽지/.test(x)), body.slice(0, 2));
        await page.evaluate(() => { const ds = JSON.parse(localStorage.getItem('stockmgr.datasets') || '{}'); delete ds.extra1; localStorage.setItem('stockmgr.datasets', JSON.stringify(ds)); }); }
    ok('3) 오류 없음', errs.length === 0, errs); await ctx.close(); }

  /* 4) 현재가 자동 반영 + 홈 수집 경고 */
  { const { ctx, page, errs } = await open(); await addStocks(page);
    await page.evaluate(([c]) => { const s = SM.app.getState().stocks[0]; s.price = 1; s.priceAt = '2026-01-01'; s.priceSrc = 'manual'; SM.app.ui.view = 'home'; SM.app.render(); }, [F.close]);
    await page.waitForFunction(() => SM.app.getState().stocks[0].priceSrc === 'auto', null, { timeout: 8000 });
    ok('오래된 직접 입력이 수집 종가로 자동 교체', (await page.evaluate(() => SM.app.getState().stocks[0].price)) === F.close);
    await go(page, 'stocks', { stockTab: 'held' }); ok('종목 화면에 “종가 … (자동 수집)” 표시', /자동 수집/.test(await page.textContent('.sh-sub small')));
    ok('4) 오류 없음', errs.length === 0, errs); await ctx.close(); }
  { const { ctx, page, errs } = await open(); await addStocks(page);
    await page.route('**/data/status.json*', (r) => r.fulfill({ json: { updatedAt: new Date(Date.now() - 9 * 86400000).toISOString(), keys: {}, stocks: { '003490': { prices: { ok: false, error: 'x' }, flow: { ok: true, last: F.last } } } } }));
    await page.evaluate(() => SM.app.collectInit(true)); await go(page, 'home'); await page.waitForTimeout(300);
    const w = (await page.$$eval('.warnbox > div', (e) => e.map((x) => x.textContent))).join(' ');
    ok('홈 경고: 수집 실패 + 오래된 수집', /자동 수집 실패.*대한항공 시세/.test(w) && /9일 전/.test(w), w); await ctx.close(); }

  /* 5) 차트 */
  { const { ctx, page, errs } = await open(); await addStocks(page);
    await page.evaluate(() => { const A = SM.app; A.ui.view = 'stocks'; A.ui.stockTab = 'held'; A.ui.stockId = A.getState().stocks[0].id; A.render(); });
    await page.waitForSelector('canvas.stockchart', { timeout: 10000 }); await page.waitForFunction((d) => document.querySelector('#chartRead').textContent.includes(d), F.last);
    const painted = await page.evaluate(() => { const c = document.querySelector('canvas.stockchart'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n / (d.length / 4); });
    ok('차트가 그려지고 수급·거래량 패널 포함(높이)', painted > 0.05 && (await page.$eval('canvas.stockchart', (c) => c.clientHeight)) > 500, painted);
    const read0 = await page.textContent('#chartRead'); ok('수급(외국인·기관·개인) 값과 누적 표시', /외국인/.test(read0) && /기관/.test(read0) && /개인/.test(read0) && /누적/.test(read0));
    await page.click('[data-act=chartTf][data-v=W]'); await page.click('[data-act=chartMonths][data-v="0"]'); await page.waitForTimeout(150); ok('주봉·전체 기간 전환', (await page.$eval('[data-act=chartTf][data-v=W]', (b) => b.classList.contains('on'))) === true);
    await page.click('[data-act=chartTf][data-v=D]'); await page.click('[data-act=chartMonths][data-v="6"]');
    await (await page.$('canvas.stockchart')).scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -250)); const bx = await (await page.$('canvas.stockchart')).boundingBox();
    await page.mouse.move(bx.x + 150, bx.y + 100); await page.waitForTimeout(120); ok('마우스를 올리면 그 날짜의 시세·수급이 표시(십자선)', !/\(최근\)/.test(await page.textContent('#chartRead')));
    await page.mouse.move(bx.x + 200, bx.y + 60); await page.mouse.down(); await page.mouse.move(bx.x + 330, bx.y + 60, { steps: 6 }); await page.mouse.up(); await page.mouse.move(bx.x + 5, bx.y + 5); await page.waitForTimeout(120);
    ok('드래그로 과거 구간 이동', !new RegExp(F.last).test(await page.textContent('#chartRead')) || !/\(최근\)/.test(await page.textContent('#chartRead')));
    await page.evaluate(() => { document.querySelector('.chartopts').open = true; }); const h3 = await page.$eval('canvas.stockchart', (c) => c.clientHeight);
    await page.click('[data-act=chartPanel][data-v=flow]'); await page.waitForTimeout(120); ok('수급 패널 끄면 차트가 낮아짐', (await page.$eval('canvas.stockchart', (c) => c.clientHeight)) < h3); await page.click('[data-act=chartPanel][data-v=flow]');
    await page.click('[data-act=chartFull]'); ok('전체 화면 모드', await page.$eval('#chartCard', (e) => e.classList.contains('chart-full'))); await page.keyboard.press('Escape'); await page.waitForTimeout(100); ok('Esc로 전체 화면 닫힘', !(await page.$eval('#chartCard', (e) => e.classList.contains('chart-full'))));
    ok('5) 오류 없음', errs.length === 0, errs); await ctx.close(); }
  { const { ctx, page, errs } = await open(); await addStocks(page); // 종목 화면: 매수 B · 매도 S 표시
    await page.evaluate(() => { const A = SM.app, S = A.getState(), k = S.stocks[0], set = S.settings, lot = k.lots[0], c = SM.computeSale(k, [{ lotId: lot.id, qty: 4 }], { price: 26000, date: '2026-10-20' }, set); SM.recordSale(k, c); A.save(); A.ui.view = 'stocks'; A.ui.stockTab = 'held'; A.ui.stockId = k.id; A.render(); });
    await page.waitForSelector('canvas.stockchart', { timeout: 10000 }); await page.waitForTimeout(600);
    const sl = await page.evaluate(() => SM.app._chart().state.cfg.sells);
    ok('종목 차트에 매도 기록이 전달됨(매도일·가격·손익)', sl.length === 1 && sl[0].date === '2026-10-20' && sl[0].price === 26000 && sl[0].qty === 4 && sl[0].pnl > 0 && sl[0].cost > 0, sl);
    if (process.env.STK_SHOT) { await page.click('[data-act=chartMonths][data-v="6"]'); await page.waitForTimeout(300); await (await page.$('#chartHost')).screenshot({ path: process.env.STK_SHOT }); }
    const px = await page.evaluate(() => { const c = document.querySelector('canvas.stockchart'); const g = c.getContext('2d'), d = SM.app._chart().state.geom; return !!d; }); ok('매도 S 원이 그려져도 차트가 정상(오류 없음)', px && errs.length === 0, errs);
    { // 이슈(증자·감자 등) 표시 + 십자선 끌기
      await page.click('[data-act=chartMonths][data-v="12"]'); await page.waitForTimeout(300);
      const evs = await page.evaluate(() => SM.app._chart().state.events.map((x) => x.kind + ':' + x.date));
      ok('이슈 표시: DART 주요사항보고(유·감·CB)가 차트에 전달됨', evs.includes('유:2026-03-10') && evs.includes('감:2026-06-15') && evs.includes('CB:2026-06-15'), evs);
      await page.evaluate(() => { document.querySelector('canvas.stockchart').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); }); await page.waitForTimeout(150);
      const box = await (await page.$('canvas.stockchart')).boundingBox(), g = await page.evaluate(() => { const s = SM.app._chart().state, gm = s.geom, i = s.bars.d.findIndex((d) => d >= '2026-06-15'); return { PL: gm.PL, bw: gm.bw, from: gm.from, i }; });
      await page.mouse.move(box.x + g.PL + (g.i - g.from + 0.5) * g.bw, box.y + 120); await page.waitForTimeout(150);
      const rd = await page.textContent('#chartRead'); ok('십자선을 이슈 날짜에 두면 읽기 상자에 이슈 이름이 표시(HTML은 글자로)', /감자/.test(rd) && /CB·BW/.test(rd) && /<b>x<\/b>/.test(rd), rd.slice(-200));
      // 십자선 끌기: 탭으로 십자선을 두고, 그 선을 잡고 오른쪽으로 끌면 선이 따라가고 차트(창)는 그대로
      const st0 = await page.evaluate(() => { const s = SM.app._chart().state; return { cross: s.cross, end: s.end, count: s.count }; }); const x0 = box.x + g.PL + (st0.cross - g.from + 0.5) * g.bw;
      await page.mouse.move(x0, box.y + 150); await page.waitForTimeout(120); const bx2 = await (await page.$('canvas.stockchart')).boundingBox(); await page.mouse.move(x0, bx2.y + 9); await page.mouse.down(); await page.mouse.move(x0 + 40, bx2.y + 9, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(100);
      const st1 = await page.evaluate(() => { const s = SM.app._chart().state; return { cross: s.cross, end: s.end, count: s.count }; });
      ok('십자선 손잡이(위쪽 원)를 잡고 끌면 선만 움직이고 차트는 이동하지 않음', st1.cross > st0.cross && st1.end === st0.end && st1.count === st0.count, [st0, st1]);
      await page.mouse.move(x0 + 60, box.y + 150); await page.mouse.move(box.x + 12, box.y + 150); await page.waitForTimeout(100);
      const bx3 = await (await page.$('canvas.stockchart')).boundingBox(); await page.mouse.move(box.x + 20, bx3.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 120, bx3.y + 60, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(100);
      ok('선에서 떨어진 곳을 끌면 기존처럼 차트가 이동함', (await page.evaluate(() => SM.app._chart().state.end)) !== st0.end);
      if (process.env.EV_SHOT) { await page.mouse.move(x0, bx2.y + 120); await page.waitForTimeout(150); await (await page.$('#chartHost')).screenshot({ path: process.env.EV_SHOT }); }
      await page.click('[data-chartopt=events]').catch(() => {}); }
    ok('7-1) 오류 없음', errs.length === 0, errs); await ctx.close(); }
  { const { ctx, page, errs } = await open(); await addStocks(page); // 영업이익 패널(DART 분기 실적)
    await page.evaluate(() => { const A = SM.app; A.ui.view = 'stocks'; A.ui.stockTab = 'held'; A.ui.stockId = A.getState().stocks[0].id; A.render(); });
    await page.waitForSelector('canvas.stockchart', { timeout: 10000 }); await page.waitForFunction(() => /실적\(DART\)/.test(document.querySelector('#chartMsg').textContent), null, { timeout: 10000 }); await page.waitForTimeout(800);
    const hWith = await page.$eval('canvas.stockchart', (c) => c.clientHeight);
    ok('영업이익 패널: 데이터 줄에 실적(DART) 분기 수 표시', /실적\(DART\) 2025-03 ~ 2026-12 8분기/.test(await page.textContent('#chartMsg')), await page.textContent('#chartMsg'));
    const rd = await page.textContent('#chartRead'); ok('읽기 상자: 그 시점까지 공시된 실적·전년 동기 대비(+122%)·이익률', /실적/.test(rd) && /2026 3분기/.test(rd) && /3,492억/.test(rd) && /\+122%/.test(rd) && /공시 2026-11-13/.test(rd), rd.slice(-160));
    await page.click('[data-act=chartMonths][data-v="12"]'); await (await page.$('canvas.stockchart')).scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, -250)); let bx = await (await page.$('canvas.stockchart')).boundingBox();
    // 미래 정보 금지: 2025-09 분기는 2025-11-14에 공시 → 그 전 날짜의 십자선에는 2분기(2025-08-14 공시)까지만, 이후 날짜에는 3분기가 보여야 함
    await page.click('[data-act=chartMonths][data-v="0"]'); await page.waitForTimeout(150); bx = await (await page.$('canvas.stockchart')).boundingBox();
    const dates = F.px.trim().split('\n').slice(1).map((l) => l.split(',')[0]), n = dates.length, step = (bx.width - 6 - 72) / n;
    const at = async (d) => { const i = dates.indexOf(dates.find((x) => x >= d)); await page.evaluate(() => { document.querySelector('canvas.stockchart').scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); }); await page.waitForTimeout(80); const b2 = await (await page.$('canvas.stockchart')).boundingBox(); await page.mouse.move(b2.x + 6 + (i + 0.5) * step, b2.y + 100); await page.waitForTimeout(150); return page.textContent('#chartRead'); };
    const before = await at('2025-10-01'), after = await at('2025-12-01');
    ok('공시 전 날짜(2025-10-01)의 십자선에는 2025 2분기까지만(3분기는 11-14 공시)', /2025 2분기/.test(before) && !/2025 3분기/.test(before) && /공시 2025-08-14/.test(before), before.slice(-150));
    ok('공시 후 날짜(2025-12-01)에는 2025 3분기(전년 동기 대비 표시)', /2025 3분기/.test(after) && /공시 2025-11-14/.test(after), after.slice(-150));
    // 영업이익(증감 포함)·수급·거래량 패널 켜기/끄기 버튼(차트 위 툴바), 설정 저장
    const pOn = (v) => page.$eval(`[data-act=chartPanel][data-v=${v}]`, (b) => b.classList.contains('on')), hgt = () => page.$eval('canvas.stockchart', (c) => c.clientHeight);
    ok('안내 문단·영업이익 선택줄·증감 선택줄은 없어지고 툴바에 수급·거래량·영업이익 버튼이 있음', (await page.$('#earnBar')) === null && (await page.$('#chgBar')) === null && (await page.$('.chartguide')) === null && (await pOn('flow')) && (await pOn('vol')) && (await pOn('earn')));
    ok('영업이익 기본 켜짐: 읽기 상자에 실적, 읽기 상자에 증감 줄', (await page.textContent('#chartRead')).includes('영업이익'));
    await page.mouse.move(bx.x + 40, bx.y + 100); await page.waitForTimeout(150); const rc = await page.textContent('#chartRead');
    ok('증감 읽기 줄: 영업이익 증감·부채 증감(%)·부채비율', /증감/.test(rc) && /부채/.test(rc) && /부채비율 \d+%/.test(rc), rc.slice(-200));
    await page.click('[data-act=chartPanel][data-v=earn]'); await page.waitForTimeout(150); const hOff = await hgt();
    ok('영업이익 끄기: 영업이익·증감 패널이 빠져 차트가 낮아지고 버튼이 꺼진 표시', hOff < hWith && !(await pOn('earn')) && !(await page.textContent('#chartRead')).includes('공시 20'), [hWith, hOff]);
    await page.click('[data-act=chartPanel][data-v=vol]'); await page.waitForTimeout(150); const hNoVol = await hgt(); ok('거래량 끄기: 차트가 낮아짐', hNoVol < hOff && !(await pOn('vol')), [hOff, hNoVol]);
    await page.click('[data-act=chartPanel][data-v=flow]'); await page.waitForTimeout(150); const hNoFlow = await hgt(); ok('수급 끄기: 차트가 더 낮아짐', hNoFlow < hNoVol && !(await pOn('flow')), [hNoVol, hNoFlow]);
    await page.reload(); await page.waitForSelector('#app'); await page.evaluate(() => { const A = SM.app; A.ui.view = 'stocks'; A.ui.stockTab = 'held'; A.ui.stockId = A.getState().stocks[0].id; A.render(); });
    await page.waitForSelector('canvas.stockchart', { timeout: 10000 }); await page.waitForTimeout(400);
    ok('꺼 둔 설정이 새로고침 뒤에도 유지(세 패널 모두 꺼짐)', !(await pOn('flow')) && !(await pOn('vol')) && !(await pOn('earn')) && (await hgt()) === hNoFlow, await hgt());
    for (const v of ['flow', 'vol', 'earn']) await page.click(`[data-act=chartPanel][data-v=${v}]`); await page.waitForTimeout(200);
    ok('다시 켜면 원래 높이로 복귀', (await hgt()) === hWith && (await pOn('flow')) && (await pOn('vol')) && (await pOn('earn')), await hgt());
    await page.evaluate(() => { document.querySelector('.chartopts').open = true; }); await page.check('[data-chartopt=earnStep]'); await page.waitForTimeout(150); ok('계단형 선택(설정에 저장)', (await page.evaluate(() => SM.app._chartPrefs().earnStep)) === true); await page.uncheck('[data-chartopt=earnStep]');
    ok('5c) 오류 없음', errs.length === 0, errs); await ctx.close(); }
  { const { ctx, page } = await open(); await page.route('**/data/status.json*', (r) => r.fulfill({ json: { updatedAt: new Date().toISOString(), keys: {}, stocks: { '003490': { prices: { ok: true, last: F.last, close: F.close }, flow: { ok: true, last: F.last } } } } })); // 재무(DART) 미수집
    await addStocks(page); await page.evaluate(() => { SM.app.collectInit(true); const A = SM.app; A.ui.view = 'stocks'; A.ui.stockTab = 'held'; A.ui.stockId = A.getState().stocks[0].id; A.render(); });
    await page.waitForSelector('canvas.stockchart', { timeout: 10000 }); await page.waitForFunction(() => /영업이익 패널 없음/.test(document.querySelector('#chartMsg').textContent), null, { timeout: 10000 }); ok('DART 재무가 없는 종목은 영업이익 패널 없이 안내 문구', true); await ctx.close(); }
  { const { ctx, page, errs } = await open(); // 관심 종목에도 차트가 나와야 함(보유 종목 전용으로 잘못 들어간 적이 있어 확인)
    await page.evaluate(() => { const A = SM.app, S = A.getState(); const w = SM.newStock({ name: '대한항공', code: '003490', market: 'KR', watch: true }); S.stocks.push(w); A.ui.view = 'stocks'; A.ui.stockTab = 'watch'; A.ui.stockId = w.id; A.save(); A.render(); });
    await page.waitForSelector('canvas.stockchart', { timeout: 10000 }); await page.waitForFunction((d) => document.querySelector('#chartRead').textContent.includes(d), F.last);
    ok('관심 종목 화면에도 차트(수급 패널 포함)', (await page.$eval('canvas.stockchart', (c) => c.clientHeight)) > 500 && /외국인/.test(await page.textContent('#chartRead')));
    ok('관심 종목 차트는 평단선·매수 순번 없이 표시', (await page.evaluate(() => document.querySelector('#chartHost').parentElement.querySelectorAll('.chartread').length)) === 1);
    ok('5b) 오류 없음', errs.length === 0, errs); await ctx.close(); }
  { const { ctx, page } = await open(420, 900, { noData: true }); await addStocks(page); await go(page, 'stocks', { stockTab: 'held' }); await page.waitForSelector('#chartMsg');
    await page.waitForFunction(() => /가격 데이터가 없습니다/.test(document.getElementById('chartMsg').textContent), null, { timeout: 8000 }).catch(() => {}); ok('가격 데이터가 없으면 안내 문구', /가격 데이터가 없습니다/.test(await page.textContent('#chartMsg'))); await ctx.close(); }

  /* 6) 배당 기록 + 손익 화면 */
  { const { ctx, page, errs } = await open(420, 900, { noData: true }); await addStocks(page); await go(page, 'stocks', { stockTab: 'held' });
    await page.evaluate(() => { SM.app.getState().stocks[0].id && (document.querySelector('details[data-sec=div]').open = true); });
    await page.click('[data-act=divAdd]'); await page.fill('.modal [name=gross]', '10000'); await page.dispatchEvent('.modal [name=gross]', 'input'); ok('세후 8,460원 미리보기(세금 15.4% 자동)', /8,460/.test(await page.textContent('#divPrev')));
    await page.fill('.modal [name=date]', '2026-04-20'); await page.click('.modal button[type=submit]'); await page.waitForTimeout(250);
    ok('배당 목록·누적 표시', /누적 수령\(세후\) 8,460원/.test(await page.$eval('details[data-sec=div]', (e) => e.textContent)));
    await go(page, 'pnl'); await page.waitForTimeout(150); ok('손익 화면에 배당 수령·실현손익+배당', (await page.$$eval('.cards.small .stat', (e) => e.map((x) => x.textContent))).some((x) => /배당 수령.*8,460원/.test(x)));
    ok('6) 오류 없음', errs.length === 0, errs); await ctx.close(); }

  /* 7) 수집 대상 반영(이슈 방식) */
  { const { ctx, page, errs } = await open(); await addStocks(page);
    await page.evaluate(() => { SM.data.repo = () => ({ base: 'https://github.com/me/stock-manager', owner: 'me', repo: 'stock-manager', actions: '#', secrets: '#', editWatch: '#', newSecret: '#' }); });
    await go(page, 'settings', { setTab: 'auto' }); await page.waitForSelector('#issueBtn');
    const u = new URL(await page.getAttribute('#issueBtn', 'href')); ok('수집 대상 반영 버튼: GitHub 새 이슈 주소와 미리 채운 목록', u.pathname.endsWith('/issues/new') && u.searchParams.get('title') === '수집 대상 반영' && u.searchParams.get('body').includes('"003490"'));
    ok('7) 오류 없음', errs.length === 0, errs); await ctx.close(); }

  await browser.close(); srv.close();
  console.log(`\n${pass} passed${fail ? ', ' + fail + ' failed' : ''}`);
})().catch((e) => { console.error('브라우저 테스트 중 오류:', e.message); process.exit(1); });
