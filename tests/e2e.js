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
    { // 배수 분할매수(물타기) 프리셋 → 채우기 → 실행 → 사이클 분석
      await page.evaluate(() => { document.querySelector('.mgbox').open = true; });
      await page.fill('[data-btmg=qty]', '10'); await page.fill('[data-btmg=growth]', '2'); await page.fill('[data-btmg=drop]', '3'); await page.fill('[data-btmg=target]', '2'); await page.fill('[data-btmg=maxInvest]', '50,000,000');
      await page.click('[data-act=btMgApply]'); await page.waitForTimeout(200);
      const cf = await page.evaluate(() => { const c = SM.app.ui.bt.cfg; return { q: c.qty, g: c.growth, mi: c.maxInvest, e: c.entries.conds.map((x) => [x.type, x.pct, x.basis]), x: c.exits.conds.map((x) => [x.type, x.dir, x.pct]) }; });
      ok('프리셋 채우기: 10주·2배·3% 하락마다 추가·평단 +2% 전량 매도·투입금 한도', cf.q === 10 && cf.g === 2 && cf.mi === 50000000 && JSON.stringify(cf.e) === '[["dropLast",3,"last"]]' && JSON.stringify(cf.x) === '[["avgPct","up",2]]', cf);
      await page.selectOption('[data-change=btMgExit]', 'cross').catch(async () => { await page.click('.mgbox .segsel button:has-text("데드크로스")'); }); await page.waitForTimeout(150);
      await page.fill('[data-btmg=s]', '5'); await page.fill('[data-btmg=l]', '15'); await page.click('[data-act=btMgApply]'); await page.waitForTimeout(200);
      { const xc = await page.evaluate(() => SM.app.ui.bt.cfg.exits.conds.map((x) => [x.type, x.ma, x.s, x.l, x.dir])); ok('프리셋 매도 방식: 5일선이 15일선 데드크로스(단순 이동평균, 아래로 이탈)', JSON.stringify(xc) === '[["maCross","sma",5,15,"down"]]', xc); }
      await page.click('[data-act=btRun]'); await page.waitForSelector('table.cyc', { timeout: 10000 });
      const ct = await page.textContent('#view, main, body'); ok('결과에 사이클 분석(소요일·최대 투입금)이 표시됨', /사이클 분석/.test(ct) && /최대 투입금/.test(ct) && (await page.$$eval('table.cyc tr.cycrow', (e) => e.length)) >= 1, ct.slice(ct.indexOf('사이클 분석'), ct.indexOf('사이클 분석') + 200));
      await page.waitForSelector('#chartHost canvas.stockchart', { timeout: 10000 }); await page.waitForTimeout(500);
      ok('시뮬레이션 결과에도 종목 차트(이동평균·수급·거래량 설정, 일/주/월 전환)가 있음', (await page.$('#chartCard [data-act=chartTf]')) !== null && (await page.$('#chartCard .chartopts')) !== null && (await page.$$eval('#chartHost canvas', (e) => e.length)) === 1 && (await page.$('#btCandle')) === null);
      const dn = await page.$eval('tr.cycdet', (e) => e.hidden); await page.click('tr.cycrow'); await page.waitForTimeout(100);
      const det = await page.$eval('tr.cycdet', (e) => ({ hidden: e.hidden, t: e.textContent.replace(/\s+/g, ' ') })), row = await page.$eval('tr.cycrow', (e) => e.getAttribute('aria-expanded'));
      ok('사이클 줄을 누르면 매수마다의 평단·목표가·수익이 펼쳐짐(1, 1-2…, 매도 ✓)', dn === true && det.hidden === false && row === 'true' && /평단/.test(det.t) && /목표가/.test(det.t) && /✓ 매도|목표에 닿지 못했습니다/.test(det.t), det.t.slice(0, 300));
      await page.click('tr.cycrow'); ok('다시 누르면 접힘', (await page.$eval('tr.cycdet', (e) => e.hidden)) === true);
      await page.click('[data-act=chartMonths][data-v="0"]'); await page.waitForTimeout(300); await (await page.$('#chartCard')).screenshot({ path: process.env.BT_SHOT || '/tmp/bt_chart.png' });
    }
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
    await page.uncheck('[data-chartopt=flow]'); await page.waitForTimeout(120); ok('수급 패널 끄면 차트가 낮아짐', (await page.$eval('canvas.stockchart', (c) => c.clientHeight)) < h3); await page.check('[data-chartopt=flow]');
    await page.click('[data-act=chartFull]'); ok('전체 화면 모드', await page.$eval('#chartCard', (e) => e.classList.contains('chart-full'))); await page.keyboard.press('Escape'); await page.waitForTimeout(100); ok('Esc로 전체 화면 닫힘', !(await page.$eval('#chartCard', (e) => e.classList.contains('chart-full'))));
    ok('5) 오류 없음', errs.length === 0, errs); await ctx.close(); }
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
    const at = async (d) => { const i = dates.indexOf(dates.find((x) => x >= d)); await page.mouse.move(bx.x + 6 + (i + 0.5) * step, bx.y + 100); await page.waitForTimeout(150); return page.textContent('#chartRead'); };
    const before = await at('2025-10-01'), after = await at('2025-12-01');
    ok('공시 전 날짜(2025-10-01)의 십자선에는 2025 2분기까지만(3분기는 11-14 공시)', /2025 2분기/.test(before) && !/2025 3분기/.test(before) && /공시 2025-08-14/.test(before), before.slice(-150));
    ok('공시 후 날짜(2025-12-01)에는 2025 3분기(전년 동기 대비 표시)', /2025 3분기/.test(after) && /공시 2025-11-14/.test(after), after.slice(-150));
    // 선그래프(기본) / 표 / 끄기 전환
    ok('영업이익 기본 표시는 선그래프(전환 버튼에서 선그래프가 선택됨, 표는 숨김)', (await page.$eval('[data-act=chartEarn][data-v=line]', (b) => b.classList.contains('on'))) && (await page.$('#earnTable table')) === null);
    await page.click('[data-act=chartEarn][data-v=table]'); await page.waitForSelector('#earnTable table'); await page.waitForTimeout(150);
    const rows = await page.$$eval('#earnTable tbody tr', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim())), hTable = await page.$eval('canvas.stockchart', (c) => c.clientHeight);
    ok('표: 분기 8행, 최근 분기부터, 영업이익·전년 동기 대비·공시일', rows.length === 8 && /^26\.4Q/.test(rows[0]) && /추정/.test(rows[0]) && /^26\.3Q/.test(rows[1]) && /3,492/.test(rows[1]) && /\+122%/.test(rows[1]) && /26-11-13/.test(rows[1]) && /적자전환/.test(rows.find((r) => /^26\.2Q/.test(r))), rows.slice(0, 3));
    { const hd = await page.$$eval('#earnTable thead th', (e) => e.map((x) => x.textContent)), r3 = rows.find((r) => /^26\.3Q/.test(r)) || '';
      ok('표: 증감·부채·부채 증감·부채비율 열(26.3Q 영업이익 증감 +1,917 · 부채 426,325 · +51,501 · 부채비율 359%)', ['증감', '부채', '부채 증감', '부채비율'].every((h) => hd.includes(h)) && /\+1,917/.test(r3) && /426,325/.test(r3) && /\+51,501/.test(r3) && /359%/.test(r3), [hd, r3]); }
    ok('표: 4분기 계산값에 * 표시', rows.some((r) => /^25\.4Q\*/.test(r)));
    ok('표로 바꾸면 차트의 영업이익 패널이 빠져 차트가 낮아지고 읽기 상자의 실적 줄도 사라짐', hTable < hWith && !/공시 20/.test(await page.textContent('#chartRead')), [hWith, hTable]); // 증감 줄은 영업이익이라는 말을 쓰므로 ‘공시 날짜’가 있는 실적 줄로 확인
    await page.click('[data-act=chartEarn][data-v=off]'); await page.waitForTimeout(150); ok('끄기: 표와 패널이 모두 사라짐', (await page.$('#earnTable table')) === null && (await page.$eval('canvas.stockchart', (c) => c.clientHeight)) === hTable);
    await page.click('[data-act=chartEarn][data-v=line]'); await page.waitForTimeout(150); ok('선그래프로 돌아오면 패널 복귀', (await page.$eval('canvas.stockchart', (c) => c.clientHeight)) === hWith && (await page.textContent('#chartRead')).includes('영업이익'));
    { // 증감 패널(전년 동기 대비 영업이익·부채 증감, 0 맞춘 분리가 기본)
      const hOn = await page.$eval('canvas.stockchart', (c) => c.clientHeight), cls = (sel) => page.$eval(sel, (b) => b.classList.contains('on'));
      ok('증감 패널: 기본은 켜짐 · 0 맞춘 분리', (await cls('[data-act=chartChg][data-v=on]')) && (await cls('[data-act=chartChgScale][data-v=zero]')) && (await page.evaluate(() => SM.app._chartPrefs().chgScale)) === 'zero');
      await page.mouse.move(bx.x + 40, bx.y + 100); await page.waitForTimeout(150); const rc = await page.textContent('#chartRead');
      ok('증감 읽기 줄: 영업이익 증감·부채 증감(%)·부채비율', /증감/.test(rc) && /부채/.test(rc) && /부채비율 \d+%/.test(rc), rc.slice(-200));
      await page.click('[data-act=chartChg][data-v=off]'); await page.waitForTimeout(150); const hOff = await page.$eval('canvas.stockchart', (c) => c.clientHeight);
      ok('증감 끄기: 패널이 빠져 차트가 낮아짐', hOff < hOn, [hOn, hOff]);
      await page.click('[data-act=chartChg][data-v=on]'); await page.click('[data-act=chartChgScale][data-v=same]'); await page.waitForTimeout(150);
      ok('같은 눈금 선택(설정에 저장, 높이 유지)', (await page.evaluate(() => SM.app._chartPrefs().chgScale)) === 'same' && (await page.$eval('canvas.stockchart', (c) => c.clientHeight)) === hOn);
      await page.click('[data-act=chartChgScale][data-v=zero]'); await page.waitForTimeout(100);
    }
    await page.evaluate(() => { document.querySelector('.chartopts').open = true; }); await page.check('[data-chartopt=earnStep]'); await page.waitForTimeout(150); ok('계단형 선택(설정에 저장)', (await page.evaluate(() => SM.app._chartPrefs().earnStep)) === true); await page.uncheck('[data-chartopt=earnStep]');
    await page.click('[data-act=chartEarn][data-v=table]'); await page.waitForSelector('#earnTable table'); // 표를 고른 상태로 새로고침
    await page.reload(); await page.waitForSelector('#app'); await page.evaluate(() => { const A = SM.app; A.ui.view = 'stocks'; A.ui.stockTab = 'held'; A.ui.stockId = A.getState().stocks[0].id; A.render(); });
    await page.waitForSelector('#earnTable table', { timeout: 10000 }); ok('선택한 표시 방식(표)은 새로고침 뒤에도 유지', (await page.$eval('[data-act=chartEarn][data-v=table]', (b) => b.classList.contains('on'))) && (await page.$$eval('#earnTable tbody tr', (e) => e.length)) === 8);
    await page.click('[data-act=chartEarn][data-v=line]');
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
