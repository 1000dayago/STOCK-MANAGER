const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const C = require('../tools/collect.js');
const W = require('../tools/watchlist-issue.js');
const L = require('../tools/build-stocklist.js');
let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log('✓', name); } catch (e) { bad++; console.log('✗', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); process.exitCode = 1; } };

const resp = (text, status = 200) => ({ status, text: async () => (typeof text === 'string' ? text : text.toString('utf8')), arrayBuffer: async () => (Buffer.isBuffer(text) ? text.buffer.slice(text.byteOffset, text.byteOffset + text.length) : Buffer.from(text).buffer) });
function makeZip(name, content) {
  const raw = Buffer.from(content, 'utf8'), data = zlib.deflateRawSync(raw), nm = Buffer.from(name);
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
  const local = Buffer.concat([lh, nm, data]);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(0, 42);
  const central = Buffer.concat([cd, nm]);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(central.length, 12); eo.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eo]);
}
const CORP_XML = '<?xml version="1.0" encoding="UTF-8"?><result><list><corp_code>00159193</corp_code><corp_name>한국전력공사</corp_name><stock_code>015760</stock_code><modify_date>20240101</modify_date></list><list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code><modify_date>20240101</modify_date></list><list><corp_code>99999999</corp_code><corp_name>비상장</corp_name><stock_code> </stock_code><modify_date>20240101</modify_date></list></result>';

function weekdaysBack(from, n) { // from 포함, 평일만 n개, 최신 → 과거
  const out = []; let t = Date.parse(from + 'T00:00:00Z');
  while (out.length < n) { const dow = new Date(t).getUTCDay(); if (dow !== 0 && dow !== 6) out.push(new Date(t).toISOString().slice(0, 10)); t -= 86400000; }
  return out;
}
function mockFetch(state) {
  const calls = [];
  const f = async (url, init) => {
    calls.push(url);
    if (url.includes('apis.data.go.kr')) {
      if (state.priceXmlError) return resp('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>');
      const code = (url.match(/likeSrtnCd=(\d+)/) || [])[1];
      const days = state.days || ['20260105', '20260106', '20260107'];
      const begin = (url.match(/beginBasDt=(\d+)/) || [])[1];
      const items = days.filter((d) => d >= begin).map((d, i) => ({ basDt: d, srtnCd: code, itmsNm: 'X', clpr: String(20000 + i * 100), mkp: '19900', hipr: '20500', lopr: '19800', trqu: String(1000000 + i) }));
      items.push({ basDt: '20260105', srtnCd: '999999', clpr: '1' }); // 다른 종목은 걸러져야 함
      return resp(JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items: items.length === 1 ? { item: items[0] } : { item: items }, totalCount: items.length, pageNo: 1, numOfRows: 1000 } } }));
    }
    if (url.includes('openapi.naver.com')) {
      assert.equal(init.headers['X-Naver-Client-Id'], 'nid');
      return resp(JSON.stringify({ items: [{ title: '<b>한국전력</b> 3분기 &quot;영업이익&quot; 급증', originallink: 'https://news.example.com/a1', link: 'https://n.news.naver.com/a1', description: '요약 <b>본문</b> &amp; 더', pubDate: 'Thu, 26 Nov 2026 10:00:00 +0900' }, { title: '두번째', originallink: 'https://news.example.com/a2', link: 'x', description: '', pubDate: 'Wed, 25 Nov 2026 09:00:00 +0900' }, { title: '링크 없음', originallink: '', link: '' }] }));
    }
    if (url.includes('m.stock.naver.com/api/stock/') && url.includes('/price?')) {
      if (state.pxFail) return resp('<html>점검중</html>');
      const page = +(url.match(/page=(\d+)/) || [])[1];
      state.pxPages = (state.pxPages || []).concat(page);
      const days = state.pxDays || weekdaysBack('2026-11-27', 1000); // 최신 → 과거
      const rows = days.slice((page - 1) * 60, page * 60).map((d, i) => ({ localTradedAt: d, closePrice: (30000 - i * 10).toLocaleString('en-US'), openPrice: '29,900', highPrice: '30,500', lowPrice: '29,500', accumulatedTradingVolume: 1000000 + i }));
      return resp(JSON.stringify(rows));
    }
    if (url.includes('m.stock.naver.com/api/stock/')) {
      if (state.flowFail) return resp('<html>점검중</html>');
      if (state.flowAll) { // bizdate(그 날짜 이전) 커서를 지키는 모의 서버. 최신 → 과거
        state.flowReq = (state.flowReq || []).concat(url);
        const bd = (url.match(/bizdate=(\d+)/) || [])[1];
        const all = state.flowAll.filter((d) => !bd || d < bd).slice(0, 60);
        return resp(JSON.stringify(all.map((d, i) => ({ itemCode: '003490', bizdate: d, foreignerPureBuyQuant: '+' + (1000 + i).toLocaleString('en-US'), organPureBuyQuant: '-200', individualPureBuyQuant: '+5' }))));
      }
      const fd = state.flowDays || ['20260107', '20260106', '20260105'];
      return resp(JSON.stringify(fd.map((d, i) => ({ itemCode: '015760', bizdate: d, foreignerPureBuyQuant: i === 0 ? '-970,498' : '+1,000', organPureBuyQuant: '+477,979', individualPureBuyQuant: '+496,820', closePrice: '29,750' }))));
    }
    if (url.includes('corpCode.xml')) return resp(makeZip('CORPCODE.xml', CORP_XML));
    if (url.includes('/list.json') && url.includes('pblntf_ty=A') && state.filings) {
      state.filingCalls = (state.filingCalls || 0) + 1;
      return resp(JSON.stringify({ status: '000', message: '정상', total_page: 1, list: state.filings.map((f) => ({ rcept_dt: f[0], report_nm: f[1], rcept_no: '2026' + f[0] })) }));
    }
    if (url.includes('fnlttSinglAcnt') && state.finData) {
      const code = (url.match(/reprt_code=(\d+)/) || [])[1], year = +(url.match(/bsns_year=(\d+)/) || [])[1], v = state.finData[year + ':' + code];
      if (!v) return resp(JSON.stringify({ status: '013', message: '조회된 데이터가 없습니다.' }));
      const row = (nm, amt, add) => ({ fs_div: 'CFS', account_nm: nm, thstrm_amount: String(amt), thstrm_add_amount: add == null ? '' : String(add) });
      return resp(JSON.stringify({ status: '000', list: [row('매출액', v.rev, v.revAdd), row('영업이익', v.op, v.opAdd), row('당기순이익', v.net, v.netAdd)] }));
    }
    if (url.includes('/list.json')) return resp(JSON.stringify({ status: '000', message: '정상', total_page: 1, list: [{ rcept_dt: '20261120', report_nm: ' 분기보고서 (2026.09) ', rcept_no: '20261120000123', flr_nm: '한국전력공사' }, { rcept_dt: '20261110', report_nm: '단일판매·공급계약체결', rcept_no: '20261110000045', flr_nm: '한국전력공사' }] }));
    if (url.includes('fnlttSinglAcnt')) {
      const code = (url.match(/reprt_code=(\d+)/) || [])[1], year = (url.match(/bsns_year=(\d+)/) || [])[1];
      if (!(year === '2026' && code === '11013') && !(year === '2025' && code === '11011')) return resp(JSON.stringify({ status: '013', message: '조회된 데이타가 없습니다.' }));
      const row = (fs, nm, amt) => ({ fs_div: fs, account_nm: nm, thstrm_amount: amt });
      return resp(JSON.stringify({ status: '000', list: [row('OFS', '매출액', '1,000'), row('CFS', '매출액', '30,000,000,000,000'), row('CFS', '영업이익', '2,500,000,000,000'), row('CFS', '당기순이익', '-100,000'), row('CFS', '자산총계', '9,000'), row('CFS', '부채총계', '6,000'), row('CFS', '자본총계', '3,000')] }));
    }
    throw new Error('예상 못한 URL ' + url);
  };
  f.calls = calls;
  return f;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'collect-'));
const KEYS = { DATA_GO_KR_KEY: 'pub+key/with=chars', DART_API_KEY: 'dartSecret123', NAVER_CLIENT_ID: 'nid', NAVER_CLIENT_SECRET: 'nsecret' };

(async () => {
  await t('이슈 분류: 유상증자·무상증자·감자·분할/병합·합병/분할·CB, 정정공시 중복 제거', () => {
    assert.deepEqual(C.classifyEvent('주요사항보고서(유상증자결정)').map((x) => x.kind), ['유']);
    assert.deepEqual(C.classifyEvent('[기재정정]주요사항보고서(무상증자결정)').map((x) => x.kind), ['무']);
    assert.deepEqual(C.classifyEvent('주요사항보고서(유무상증자결정)').map((x) => x.kind), ['유', '무']);
    assert.deepEqual(C.classifyEvent('주요사항보고서(감자결정)').map((x) => x.kind), ['감']); assert.deepEqual(C.classifyEvent('주요사항보고서(주식분할결정)').map((x) => x.kind), ['분']);
    assert.deepEqual(C.classifyEvent('주요사항보고서(회사합병결정)').map((x) => x.kind), ['합']); assert.deepEqual(C.classifyEvent('주요사항보고서(전환사채권발행결정)').map((x) => x.kind), ['CB']);
    assert.deepEqual(C.classifyEvent('주요사항보고서(자기주식취득결정)'), []); assert.deepEqual(C.classifyEvent(null), []);
    const ev = C.buildEvents([{ report_nm: '주요사항보고서(유상증자결정)', rcept_dt: '20240305' }, { report_nm: '[기재정정]주요사항보고서(유상증자결정)', rcept_dt: '20240312' }, { report_nm: '주요사항보고서(유상증자결정)', rcept_dt: '20250110' }, { report_nm: '주요사항보고서(감자결정)', rcept_dt: '20240601' }, { report_nm: '이상한', rcept_dt: 'x' }]);
    assert.deepEqual(ev.map((e) => [e.date, e.kind]), [['2024-03-05', '유'], ['2024-06-01', '감'], ['2025-01-10', '유']]); // 정정(7일 뒤)은 제외, 1년 뒤는 별개
    assert.equal(ev[0].label, '유상증자'); assert(ev[0].title.includes('유상증자결정'));
  });
  await t('ZIP 풀기 + 고유번호 XML 파싱(상장사만)', () => {
    const xml = C.unzipFirst(makeZip('CORPCODE.xml', CORP_XML)).toString('utf8');
    assert.equal(xml, CORP_XML);
    assert.deepEqual(C.parseCorpXml(xml, new Set(['015760', '005930', '000000'])), { '015760': '00159193', '005930': '00126380' });
    assert.throws(() => C.unzipFirst(Buffer.from('not a zip at all, definitely not zip data............')));
  });
  await t('키 인코딩/가리기', () => {
    assert.equal(C.encKey('a+b/c='), 'a%2Bb%2Fc%3D'); assert.equal(C.encKey('a%2Bb'), 'a%2Bb');
    const m = C.makeMask(['sec ret', 'abc']);
    assert.equal(m('url?k=sec%20ret&x=abc'), 'url?k=***&x=***');
  });
  await t('뉴스 정리(태그·엔티티), 시세 병합(덮어쓰기·정렬)', () => {
    assert.equal(C.cleanText('<b>한국전력</b> &quot;A&quot; &amp; B&nbsp;C'), '한국전력 "A" & B C');
    const m = C.mergePrices('date,open,high,low,close,volume\n2026-01-05,1,2,0,1,10\n2026-01-06,1,2,0,5,10\n', [{ d: '2026-01-06', o: 1, h: 2, l: 0, c: 9, v: 11 }, { d: '2026-01-07', o: 1, h: 2, l: 0, c: 8, v: 12 }]);
    assert.deepEqual(m.rows.map((r) => [r.d, r.c]), [['2026-01-05', 1], ['2026-01-06', 9], ['2026-01-07', 8]]);
    assert.equal(m.text.split('\n')[0], 'date,open,high,low,close,volume');
  });
  await t('재무: 연결 우선, 계정명 매핑', () => {
    const p = C.parseFinancials([{ fs_div: 'OFS', account_nm: '매출액', thstrm_amount: '1' }, { fs_div: 'CFS', account_nm: '매출액', thstrm_amount: '30,000' }, { fs_div: 'CFS', account_nm: '영업이익(손실)', thstrm_amount: '-5' }]);
    assert.deepEqual(p, { fs: '연결', revenue: 30000, op: -5 });
  });
  await t('시세 API 오류(XML) 메시지, 키 미등록', async () => {
    await assert.rejects(() => C.fetchPrices('015760', '20260101', 'k', mockFetch({ priceXmlError: true })), /서비스키가 등록되지 않았습니다/);
  });
  await t('전체 실행: 파일 생성·필터링·상태 기록', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ stocks: [{ code: '015760', name: '한국전력' }, { code: 'AAPL', name: 'Apple' }, { code: '015760', name: '중복' }] }));
    const f = mockFetch({});
    const r = await C.run({ env: KEYS, dataDir: dir, fetch: f, today: new Date('2026-11-27T00:00:00Z'), log: () => {} });
    assert.equal(r.failures, 0, JSON.stringify(r.status));
    const csv = fs.readFileSync(path.join(dir, 'prices', '015760.csv'), 'utf8').trim().split('\n');
    assert.equal(csv.length, 4); assert(!csv.join('').includes('999999')); assert.equal(csv[1], '2026-01-05,19900,20500,19800,20000,1000000');
    const news = JSON.parse(fs.readFileSync(path.join(dir, 'news', '015760.json'), 'utf8'));
    assert.equal(news.items.length, 2); assert.equal(news.items[0].title, '한국전력 3분기 "영업이익" 급증'); assert(news.items[0].date.startsWith('2026-11-26'));
    const dart = JSON.parse(fs.readFileSync(path.join(dir, 'dart', '015760.json'), 'utf8'));
    assert.equal(dart.items.length, 2); assert.equal(dart.items[0].title, '분기보고서 (2026.09)'); assert(dart.items[0].url.endsWith('rcpNo=20261120000123'));
    const fin = JSON.parse(fs.readFileSync(path.join(dir, 'fin', '015760.json'), 'utf8'));
    assert.equal(fin.periods.length, 2); assert.equal(fin.periods[0].label, '2026 1분기'); assert.equal(fin.periods[0].revenue, 30000000000000); assert.equal(fin.periods[0].net, -100000); assert.equal(fin.periods[0].fs, '연결');
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    assert.equal(st.stocks['015760'].prices.ok, true); assert.equal(st.stocks['015760'].prices.last, '2026-01-07'); assert.equal(st.stocks['015760'].prices.close, 20200); // 마지막 종가를 상태에 기록(앱이 현재가로 사용) assert.equal(st.skipped.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'dart-corp-map.json'), 'utf8')), { '015760': '00159193' });
    assert(f.calls.some((u) => u.includes('corpCode.xml')));
    // 두 번째 실행: 새 거래일만 이어받고, 고유번호/재무는 다시 받지 않음
    const f2 = mockFetch({ days: ['20260105', '20260106', '20260107', '20260108'] });
    const r2 = await C.run({ env: KEYS, dataDir: dir, fetch: f2, today: new Date('2026-11-28T00:00:00Z'), log: () => {} });
    assert.equal(r2.failures, 0);
    assert(!f2.calls.some((u) => u.includes('corpCode.xml')), '고유번호 재다운로드');
    assert(!f2.calls.some((u) => u.includes('fnlttSinglAcnt')), '재무 6일 이내 재수집');
    assert(f2.calls.find((u) => u.includes('apis.data.go.kr')).includes('beginBasDt=20260107'), '마지막 날짜부터 이어받기');
    assert.equal(fs.readFileSync(path.join(dir, 'prices', '015760.csv'), 'utf8').trim().split('\n').length, 5);
  });
  await t('키가 없으면 건너뜀, 일부 실패해도 계속, 오류 메시지에 키 미노출', async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify([{ code: '015760', name: '한국전력' }]));
    let r = await C.run({ env: { COLLECT_FLOW: '0', COLLECT_PRICE_NAVER: '0' }, dataDir: dir, fetch: async () => { throw new Error('호출되면 안 됨'); }, log: () => {} });
    assert.equal(r.attempts, 0); assert(r.status.stocks['015760'].prices.skipped);
    const failing = async (url) => { if (url.includes('apis.data.go.kr')) throw new Error('boom ' + url); return mockFetch({})(url, { headers: { 'X-Naver-Client-Id': 'nid' } }); };
    r = await C.run({ env: KEYS, dataDir: dir, fetch: failing, today: new Date('2026-11-27T00:00:00Z'), log: () => {} });
    assert.equal(r.status.stocks['015760'].prices.ok, false); assert.equal(r.status.stocks['015760'].news.ok, true);
    assert(!JSON.stringify(r.status).includes('pub%2Bkey') && !JSON.stringify(r.status).includes('pub+key'), '키가 상태 파일에 노출됨');
  });
  await t('수급: 부호·콤마 파싱, 누적(같은 날짜는 새 값), 실패 시 다른 항목 계속', async () => {
    const rows = await C.fetchFlow('015760', mockFetch({}));
    assert.deepEqual(rows[0], { d: '2026-01-07', f: -970498, i: 477979, p: 496820 }); assert.equal(rows.length, 3);
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify([{ code: '015760', name: '한국전력' }]));
    let r = await C.run({ env: KEYS, dataDir: dir, fetch: mockFetch({}), today: new Date('2026-11-27T00:00:00Z'), log: () => {} });
    const f = path.join(dir, 'flow', '015760.csv');
    let lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    assert.equal(lines[0], 'date,frgn,inst,indiv'); assert.equal(lines.length, 4); assert.equal(lines[3], '2026-01-07,-970498,477979,496820');
    assert.equal(r.status.stocks['015760'].flow.ok, true); assert.equal(r.status.stocks['015760'].flow.last, '2026-01-07');
    // 다음 실행: 새 날짜가 이어지고 겹치는 날짜는 중복되지 않음
    r = await C.run({ env: KEYS, dataDir: dir, fetch: mockFetch({ flowDays: ['20260108', '20260107', '20260106'] }), today: new Date('2026-11-28T00:00:00Z'), log: () => {} });
    lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    assert.equal(lines.length, 5); assert.equal(lines[4].slice(0, 10), '2026-01-08');
    // 형식이 바뀌어 읽지 못해도 시세·뉴스는 계속
    r = await C.run({ env: KEYS, dataDir: dir, fetch: mockFetch({ flowFail: true }), today: new Date('2026-11-29T00:00:00Z'), log: () => {} });
    assert.equal(r.status.stocks['015760'].flow.ok, false); assert(/읽지 못했습니다/.test(r.status.stocks['015760'].flow.error)); assert.equal(r.status.stocks['015760'].news.ok, true);
    assert.equal(fs.readFileSync(f, 'utf8').trim().split('\n').length, 5, '실패해도 기존 파일 유지');
    // 끄기
    const f2 = mockFetch({}); await C.run({ env: Object.assign({}, KEYS, { COLLECT_FLOW: '0' }), dataDir: dir, fetch: f2, today: new Date('2026-11-29T00:00:00Z'), log: () => {} });
    assert(!f2.calls.some((u) => u.includes('m.stock.naver.com')));
  });
  await t('네이버 시세: 기간만큼 과거로 페이지를 넘겨 받고, 확정 전 오늘 값은 제외', async () => {
    const st = {};
    const rows = await C.fetchNaverPrices('003490', mockFetch(st), { stopDate: '2026-06-01', delayMs: 0, skipDate: '2026-11-27' });
    assert(!rows.some((r) => r.d === '2026-11-27')); assert.equal(rows[0].d, '2026-11-26'); assert(rows[rows.length - 1].d <= '2026-06-01');
    assert.deepEqual(st.pxPages, [1, 2, 3]); // 2026-06-01까지 약 126거래일 → 60개씩 3묶음
    assert.deepEqual(Object.keys(rows[0]), ['d', 'o', 'h', 'l', 'c', 'v']); assert.equal(rows[0].c, 30000 - 10); assert.equal(rows[0].h, 30500);
    await assert.rejects(() => C.fetchNaverPrices('003490', mockFetch({ pxFail: true }), { delayMs: 0 }), /읽지 못했습니다/);
    assert.equal(C.clampYears(0), 1); assert.equal(C.clampYears(99), 15); assert.equal(C.clampYears('abc', 3), 3); assert.equal(C.clampYears(2.4), 2);
  });
  await t('네이버 시세 수집: 기간 설정·이어받기·기간 늘리기·종목별 기간·키가 있으면 공공데이터 우선', async () => {
    const dir = tmp(), env = { COLLECT_FLOW: '0' }, today = new Date('2026-11-27T19:00:00Z'); // 앱은 today 를 한국시간으로 취급: 19시 → 오늘 값 포함
    fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ years: 1, stocks: [{ code: '003490', name: '대한항공' }, { code: '005930', name: '삼성전자', years: 2 }] }));
    const st1 = {}; let r = await C.run({ env, dataDir: dir, fetch: mockFetch(st1), today, log: () => {}, pageDelayMs: 0 });
    assert.equal(r.failures, 0, JSON.stringify(r.status));
    const rd = (c) => fs.readFileSync(path.join(dir, 'prices', c + '.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
    let a = rd('003490'), b = rd('005930');
    assert.equal(a[a.length - 1][0], '2026-11-27'); assert(a[0][0] >= '2025-11-27' && a[0][0] <= '2025-12-05', a[0][0]); // 1년
    assert(b[0][0] >= '2024-11-27' && b[0][0] <= '2024-12-05', b[0][0]); assert(b.length > a.length * 1.8); // 종목별 2년
    assert.equal(r.status.stocks['003490'].prices.source, 'naver'); assert.equal(r.status.stocks['003490'].prices.years, 1); assert.equal(r.status.stocks['005930'].prices.years, 2);
    assert.deepEqual(a[a.length - 1].slice(1), ['29900', '30500', '29500', '30000', '1000000']); // 시가, 고가, 저가, 종가, 거래량
    // 이어받기: 기간이 이미 채워져 있으면 최근 1주일만(첫 묶음 1번)
    const st2 = {}; await C.run({ env, dataDir: dir, fetch: mockFetch(st2), today: new Date('2026-11-28T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert.deepEqual(st2.pxPages, [1, 1]); // 두 종목 각각 1묶음
    // 기간 늘리기: 1년 → 3년이면 더 과거를 채움
    fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ years: 3, stocks: [{ code: '003490', name: '대한항공' }] }));
    await C.run({ env, dataDir: dir, fetch: mockFetch({}), today, log: () => {}, pageDelayMs: 0 });
    a = rd('003490'); assert(a[0][0] >= '2023-11-27' && a[0][0] <= '2023-12-05', a[0][0]); assert(a.length > 700);
    // 기간 줄이기: 이미 받은 데이터는 지우지 않음
    fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ years: 1, stocks: [{ code: '003490', name: '대한항공' }] }));
    const before = a.length; await C.run({ env, dataDir: dir, fetch: mockFetch({}), today, log: () => {}, pageDelayMs: 0 });
    assert(rd('003490').length >= before);
    // 장 마감 전(한국시간 15시)이면 오늘 값 제외
    const dir2 = tmp(); fs.writeFileSync(path.join(dir2, 'watchlist.json'), JSON.stringify([{ code: '003490', name: '대한항공' }]));
    await C.run({ env, dataDir: dir2, fetch: mockFetch({}), today: new Date('2026-11-27T06:00:00Z'), log: () => {}, pageDelayMs: 0 });
    const c = fs.readFileSync(path.join(dir2, 'prices', '003490.csv'), 'utf8').trim().split('\n'); assert.equal(c[c.length - 1].slice(0, 10), '2026-11-26');
    // 공공데이터 키가 있으면 네이버 시세는 쓰지 않음
    const f3 = mockFetch({}); await C.run({ env: Object.assign({}, KEYS, { COLLECT_FLOW: '0' }), dataDir: dir2, fetch: f3, today, log: () => {}, pageDelayMs: 0 });
    assert(!f3.calls.some((u) => u.includes('/price?')), '키가 있는데 네이버 시세 사용'); assert(f3.calls.some((u) => u.includes('apis.data.go.kr')));
    // 형식이 바뀌어 읽지 못하면 시세만 실패, 기존 파일 유지
    const keep = fs.readFileSync(path.join(dir2, 'prices', '003490.csv'), 'utf8');
    const r4 = await C.run({ env, dataDir: dir2, fetch: mockFetch({ pxFail: true }), today, log: () => {}, pageDelayMs: 0 });
    assert.equal(r4.status.stocks['003490'].prices.ok, false); assert.equal(fs.readFileSync(path.join(dir2, 'prices', '003490.csv'), 'utf8'), keep);
    // 환경 변수로 기본 기간 지정, 목록에 기간이 없을 때
    const dir3 = tmp(); fs.writeFileSync(path.join(dir3, 'watchlist.json'), JSON.stringify([{ code: '003490', name: 'x' }]));
    const r5 = await C.run({ env: { COLLECT_FLOW: '0', COLLECT_YEARS: '2' }, dataDir: dir3, fetch: mockFetch({}), today, log: () => {}, pageDelayMs: 0 });
    assert.equal(r5.status.stocks['003490'].prices.years, 2);
  });
  await t('수급 10년: 날짜 커서로 과거까지 이어 받고 중복·빈 구간 없음', async () => {
    const all = weekdaysBack('2026-11-27', 3000).map((d) => d.replace(/-/g, '')); // 약 11.5년치
    const dir = tmp(); fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ years: 10, stocks: [{ code: '003490', name: '대한항공' }] }));
    const st = { flowAll: all };
    const r = await C.run({ env: { COLLECT_PRICE_NAVER: '0' }, dataDir: dir, fetch: mockFetch(st), today: new Date('2026-11-27T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert.equal(r.failures, 0, JSON.stringify(r.status));
    const rows = fs.readFileSync(path.join(dir, 'flow', '003490.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
    const ds = rows.map((x) => x[0]);
    assert.equal(new Set(ds).size, ds.length); assert.deepEqual(ds, [...ds].sort());
    assert(ds[0] >= '2016-11-27' && ds[0] <= '2016-12-05', ds[0]); assert.equal(ds[ds.length - 1], '2026-11-27');
    const want = all.filter((d) => d >= '20161127').length; assert.equal(ds.length, want, '평일 전부 있어야 함(빈 구간 없음)');
    assert(st.flowReq.length >= 40 && st.flowReq.length <= 45, '요청 수 ' + st.flowReq.length); assert(!/bizdate/.test(st.flowReq[0])); assert(/bizdate=\d{8}/.test(st.flowReq[1]));
    assert.equal(r.status.stocks['003490'].flow.range, '최근 10년'); assert.equal(rows[0].length, 4);
  });
  await t('수급 이어받기: 오래 쉬어 60일을 넘겨도 사이가 비지 않음, 이미 충분하면 최근분만', async () => {
    const all = weekdaysBack('2026-11-27', 700).map((d) => d.replace(/-/g, ''));
    const dir = tmp(); fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ years: 2, stocks: [{ code: '003490', name: '대한항공' }] }));
    const old = all.filter((d) => d <= '20260801' && d >= '20241201'); // 8/1까지만 받아 둔 상태(그 뒤 약 85거래일 공백)
    fs.mkdirSync(path.join(dir, 'flow'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'flow', '003490.csv'), 'date,frgn,inst,indiv\n' + old.slice().reverse().map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)},1,2,3`).join('\n') + '\n');
    const st = { flowAll: all };
    await C.run({ env: { COLLECT_PRICE_NAVER: '0' }, dataDir: dir, fetch: mockFetch(st), today: new Date('2026-11-27T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    const ds = fs.readFileSync(path.join(dir, 'flow', '003490.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[0]);
    const want = all.filter((d) => d >= '20241201' && d <= '20261127').map((d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`).reverse();
    assert.deepEqual(ds, want); assert(st.flowReq.length <= 3, '필요한 만큼만 요청 ' + st.flowReq.length);
    // 바로 다시 실행하면 1묶음만
    const st2 = { flowAll: all }; await C.run({ env: { COLLECT_PRICE_NAVER: '0' }, dataDir: dir, fetch: mockFetch(st2), today: new Date('2026-11-28T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert.equal(st2.flowReq.length, 1);
  });
  await t('시작일·종료일 지정: 시세·수급 모두 그 구간만, 이미 있으면 건너뜀, 종목별 지정, 잘못된 날짜', async () => {
    const all = weekdaysBack('2026-11-27', 1200).map((d) => d.replace(/-/g, ''));
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ from: '2025-03-03', to: '2025-09-30', stocks: [{ code: '003490', name: '대한항공' }, { code: '005930', name: '삼성전자', from: '2025-06-02', to: '2025-06-30' }] }));
    const st = { flowAll: all, pxDays: weekdaysBack('2026-11-27', 1200) };
    const r = await C.run({ env: {}, dataDir: dir, fetch: mockFetch(st), today: new Date('2026-11-27T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert.equal(r.failures, 0, JSON.stringify(r.status));
    const rd = (kind, c) => fs.readFileSync(path.join(dir, kind, c + '.csv'), 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')[0]);
    for (const k of ['flow', 'prices']) { const a = rd(k, '003490'); assert.equal(a[0], '2025-03-03'); assert.equal(a[a.length - 1], '2025-09-30'); const b = rd(k, '005930'); assert.equal(b[0], '2025-06-02'); assert.equal(b[b.length - 1], '2025-06-30'); }
    assert.equal(r.status.stocks['003490'].flow.range, '2025-03-03 ~ 2025-09-30');
    const wd = (a, b) => weekdaysBack('2025-09-30', 400).filter((d) => d >= a && d <= b).length; assert.equal(rd('flow', '003490').length, wd('2025-03-03', '2025-09-30')); // 구간 안 평일 전부
    // 같은 설정으로 다시 실행하면 요청 없음
    const st2 = { flowAll: all, pxDays: st.pxDays }; const f2 = mockFetch(st2);
    const r2 = await C.run({ env: {}, dataDir: dir, fetch: f2, today: new Date('2026-11-28T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert.equal(r2.failures, 0); assert(!f2.calls.some((u) => u.includes('m.stock.naver.com')), '이미 있는 구간을 다시 받음'); assert(/이미 수집됨/.test(r2.status.stocks['003490'].flow.msg));
    // 잘못된 날짜(시작 > 종료): 시세·수급 모두 건너뛰고 이유 기록, 요청 없음
    const dir2 = tmp(); fs.writeFileSync(path.join(dir2, 'watchlist.json'), JSON.stringify({ from: '2025-10-01', to: '2025-03-01', stocks: [{ code: '003490', name: 'x' }] }));
    const f3 = mockFetch({}); const r3 = await C.run({ env: {}, dataDir: dir2, fetch: f3, today: new Date('2026-11-27T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert(/시작일이 종료일보다 늦습니다/.test(r3.status.stocks['003490'].flow.skipped)); assert(!f3.calls.some((u) => u.includes('m.stock.naver.com')));
    // 날짜 형식 검증
    assert.equal(C.isYmd('2025-03-03'), true); assert.equal(C.isYmd('2025-3-3'), false); assert.equal(C.isYmd('abc'), false);
    const dir4 = tmp(); fs.writeFileSync(path.join(dir4, 'watchlist.json'), JSON.stringify({ from: '잘못', stocks: [{ code: '003490', name: 'x', to: '2025-13-45' }] }));
    const wl = C.readWatchlist(dir4); assert.equal(wl.from, null); assert.equal(wl.stocks[0].to, null);
  });
  await t('수집 대상 반영 이슈: 검증·병합·거부(비어 있음/형식 오류/표시 없음/이상한 입력)', async () => {
    const body = (obj, marker = true) => (marker ? W.MARKER + '\n' : '') + '앱에서 만든 목록입니다.\n\n```json\n' + JSON.stringify(obj, null, 2) + '\n```\n';
    const existing = { years: 3, stocks: [{ code: '003490', name: '대한항공', years: 5 }, { code: '005930', name: '삼성전자' }] };
    // 추가·제외·기존 종목의 개별 기간 유지
    let r = W.applyWatchlist(body({ years: 10, from: '2017-01-02', stocks: [{ code: '003490', name: '대한항공' }, { code: '015760', name: '한국전력' }] }), existing);
    assert.equal(r.ok, true); const o = JSON.parse(r.json);
    assert.deepEqual(o, { years: 10, from: '2017-01-02', stocks: [{ code: '003490', name: '대한항공', years: 5 }, { code: '015760', name: '한국전력' }] });
    assert.deepEqual(r.added, ['한국전력']); assert.deepEqual(r.removed, ['삼성전자']); assert.equal(r.optsChanged, true); assert(r.json.endsWith('\n'));
    assert(/한국전력/.test(W.commentFor(r)) && /2017-01-02 ~ 오늘/.test(W.commentFor(r)));
    // 6자리가 아닌 코드·중복 제거, 이름의 위험 문자 제거, 길이 제한, 이름이 없으면 코드
    r = W.applyWatchlist(body({ stocks: [{ code: 'AAPL', name: 'Apple' }, { code: '003490', name: '<b>대한`항공</b>$(rm -rf)' + 'x'.repeat(100) }, { code: '003490', name: '중복' }, { code: '000660' }] }), { stocks: [] });
    assert.equal(r.ok, true); const o2 = JSON.parse(r.json);
    assert.equal(o2.stocks.length, 2); assert.deepEqual(r.skipped, ['Apple']); assert(!/[<>`$\\]/.test(o2.stocks[0].name)); assert(o2.stocks[0].name.length <= 40); assert.equal(o2.stocks[1].name, '000660');
    // 거부: 기존 목록은 건드리지 않음(ok=false, json 없음)
    for (const [label, b, re] of [
      ['빈 목록', body({ stocks: [] }), /기존 목록을 그대로/], ['국내 종목 없음', body({ stocks: [{ code: 'AAPL', name: 'A' }] }), /기존 목록을 그대로/],
      ['표시 없음', body({ stocks: [{ code: '003490', name: 'x' }] }, false), /표시가 없습니다/], ['JSON 블록 없음', W.MARKER + '\n그냥 글', /찾지 못/],
      ['깨진 JSON', W.MARKER + '\n```json\n{ stocks: [\n```', /읽지 못/], ['형식 오류', body([1, 2]), /형식이 올바르지/],
      ['시작>종료', body({ from: '2025-10-01', to: '2025-01-01', stocks: [{ code: '003490', name: 'x' }] }), /시작일이 종료일보다/],
      ['종목 과다', body({ stocks: Array.from({ length: 201 }, (_, i) => ({ code: String(100000 + i), name: 'n' })) }), /너무 많습니다/],
    ]) { const x = W.applyWatchlist(b, existing); assert.equal(x.ok, false, label); assert(re.test(x.error), label + ': ' + x.error); assert.equal(x.json, undefined); assert(/반영하지 못했습니다/.test(W.commentFor(x))); }
    // 잘못된 날짜 값·기간 값은 무시/보정
    r = W.applyWatchlist(body({ years: 99, from: '잘못', to: '2025-13-45', stocks: [{ code: '003490', name: 'x', years: 0 }] }), { stocks: [] });
    assert.deepEqual(JSON.parse(r.json), { years: 15, stocks: [{ code: '003490', name: 'x', years: 1 }] });
    // 기존 목록이 배열 형식이어도 동작, 같은 내용이면 optsChanged=false
    r = W.applyWatchlist(body({ stocks: [{ code: '003490', name: '대한항공' }] }), [{ code: '003490', name: '대한항공' }]);
    assert.equal(r.ok, true); assert.deepEqual(r.added, []); assert.equal(r.optsChanged, false);
  });
  await t('종목 목록 만들기: 페이지 넘김·중복/이상 항목 제거·영숫자 코드·최소 개수 보호·변경 없으면 쓰지 않음', async () => {
    const mkRows = (prefix, n, extra = []) => Array.from({ length: n }, (_, i) => ({ itemCode: prefix + String(1000 + i).padStart(5, '0').slice(-5), stockName: prefix + '종목' + i, stockEndType: i % 7 === 0 ? 'etf' : i % 11 === 0 ? 'etn' : 'stock' })).concat(extra);
    const state = { calls: [] };
    const fetchFn = (data) => async (url) => {
      state.calls.push(url);
      const m = url.match(/marketValue\/(\w+)\?page=(\d+)&pageSize=(\d+)/), all = data[m[1]], pg = +m[2], size = +m[3];
      return resp(JSON.stringify({ stocks: all.slice((pg - 1) * size, pg * size), totalCount: all.length, page: pg, pageSize: size }));
    };
    const data = { KOSPI: mkRows('1', 250, [{ itemCode: '0126Z0', stockName: '삼성에피스홀딩스', stockEndType: 'stock' }, { itemCode: '12345', stockName: '다섯자리', stockEndType: 'stock' }, { itemCode: '100000', stockName: '  ', stockEndType: 'stock' }]), KOSDAQ: mkRows('2', 120, [{ itemCode: '0126Z0', stockName: '중복코드', stockEndType: 'stock' }]) };
    const dir = tmp(), file = path.join(dir, 'stocks.json');
    let r = await L.run({ fetch: fetchFn(data), file, delayMs: 0, minCount: 300, now: new Date('2026-11-27T00:00:00Z') });
    assert.equal(r.changed, true); const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(j.updatedAt, '2026-11-27T00:00:00.000Z'); assert.equal(j.count, j.stocks.length);
    assert.equal(j.stocks.length, 250 + 1 + 120, JSON.stringify(j.stocks.length)); // 다섯자리·이름 없음 제외, 다른 시장의 같은 코드는 먼저 나온 1개만
    assert(!j.stocks.some((x) => x[1] === '중복코드'));
    assert(j.stocks.some((x) => x[0] === '0126Z0' && x[1] === '삼성에피스홀딩스' && x[2] === 'P' && x[3] === 's')); assert(!j.stocks.some((x) => x[1] === '다섯자리'));
    assert.deepEqual(j.stocks[0], ['101000', '1종목0', 'P', 'e']); assert(j.stocks.every((x) => x.length === 4 && /^[0-9A-Z]{6}$/.test(x[0])));
    assert.equal(new Set(j.stocks.map((x) => x[0])).size, j.stocks.length); assert(j.stocks.some((x) => x[2] === 'Q'));
    assert(state.calls.length >= 3 + 2, '페이지를 넘겨 받음 ' + state.calls.length); assert(state.calls.every((u) => /pageSize=100/.test(u)));
    // 같은 내용이면 다시 쓰지 않음(updatedAt 유지)
    r = await L.run({ fetch: fetchFn(data), file, delayMs: 0, minCount: 300, now: new Date('2027-01-01T00:00:00Z') });
    assert.equal(r.changed, false); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).updatedAt, '2026-11-27T00:00:00.000Z');
    // 새 종목이 생기면 갱신
    data.KOSDAQ.push({ itemCode: '999990', stockName: '신규상장', stockEndType: 'stock' });
    r = await L.run({ fetch: fetchFn(data), file, delayMs: 0, minCount: 300, now: new Date('2027-01-01T00:00:00Z') });
    assert.equal(r.changed, true); assert.equal(r.added, 1); assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).count, 372);
    // 받은 종목이 너무 적으면 기존 파일을 보호하고 실패
    const keep = fs.readFileSync(file, 'utf8');
    await assert.rejects(() => L.run({ fetch: fetchFn({ KOSPI: mkRows('1', 5), KOSDAQ: mkRows('2', 5) }), file, delayMs: 0 }), /기존 파일을 그대로/);
    assert.equal(fs.readFileSync(file, 'utf8'), keep);
    // 형식이 바뀐 응답/HTTP 오류
    await assert.rejects(() => L.run({ fetch: async () => resp('<html>점검</html>'), file, delayMs: 0 }), /읽지 못했습니다/);
    await assert.rejects(() => L.run({ fetch: async () => resp(JSON.stringify({ nothing: 1 })), file, delayMs: 0 }), /형식이 예상과 다릅니다/);
    assert.equal(fs.readFileSync(file, 'utf8'), keep);
  });
  await t('분기 영업이익: 보고서→3개월분 정리(누적 차이·당기금액), 4분기 계산, 결산월, 공시일(정정 제외 최초일)', async () => {
    const P = (year, report, op, extra) => Object.assign({ year, report, fs: '연결', revenue: op * 10, op, net: op / 2 }, extra || {});
    // ① 분기·반기 보고서가 3개월분(당기금액)이고 누적금액도 있는 경우 — 누적 차이로 계산해도 같은 값이어야 함
    const a = [P(2025, '11013', 100, { opAdd: 100 }), P(2025, '11012', 50, { opAdd: 150 }), P(2025, '11014', 80, { opAdd: 230 }), P(2025, '11011', 400)];
    const f = C.filingDates([{ rcept_dt: '20250515', report_nm: '분기보고서 (2025.03)' }, { rcept_dt: '20250814', report_nm: '반기보고서 (2025.06)' }, { rcept_dt: '20250901', report_nm: '[기재정정]반기보고서 (2025.06)' }, { rcept_dt: '20251114', report_nm: '분기보고서 (2025.09)' }, { rcept_dt: '20260320', report_nm: '사업보고서 (2025.12)' }, { rcept_dt: '20260301', report_nm: '주요사항보고서' }]);
    assert.deepEqual(f['2025-06'], { date: '2025-08-14', type: '반기보고서' }); // 정정공시(9월)가 있어도 최초 공시일
    assert.equal(f['2025-12'].type, '사업보고서'); assert.equal(Object.keys(f).length, 4); // 정기공시만
    let q = C.buildQuarters(a, f, 12);
    assert.deepEqual(q.map((x) => [x.ym, x.op, x.filed]), [['2025-03', 100, '2025-05-15'], ['2025-06', 50, '2025-08-14'], ['2025-09', 80, '2025-11-14'], ['2025-12', 400 - 100 - 50 - 80, '2026-03-20']]);
    assert.equal(q[3].derived, true); assert.equal(q[0].derived, undefined); assert.equal(q[1].revenue, 500); assert.equal(q[0].label, '2025 1분기'); assert.equal(q[3].fs, '연결');
    // ①-2 재무상태표(자산·부채·자본)는 분기 말 잔액 그대로 붙음(4분기 = 사업보고서), 없는 값은 붙지 않음
    q = C.buildQuarters([P(2025, '11013', 100, { liab: 700, equity: 300, assets: 1000 }), P(2025, '11012', 50, { opAdd: 150 }), P(2025, '11014', 80, { opAdd: 230, liab: 800, equity: 350 }), P(2025, '11011', 400, { liab: 900, equity: 400, assets: 1300 })], {}, 12);
    assert.deepEqual(q.map((x) => [x.ym, x.liab, x.equity, x.assets]), [['2025-03', 700, 300, 1000], ['2025-06', undefined, undefined, undefined], ['2025-09', 800, 350, undefined], ['2025-12', 900, 400, 1300]]);
    // ② 누적금액이 없으면 당기금액을 3개월분으로, 일부 분기만 있어도 있는 만큼
    q = C.buildQuarters([P(2024, '11013', 30), P(2024, '11014', 20)], {}, 12); assert.deepEqual(q.map((x) => [x.ym, x.op, x.filed]), [['2024-03', 30, null], ['2024-09', 20, null]]); // 4분기·반기는 계산 불가 → 없음
    // ③ 반기 보고서의 당기금액이 누적(6개월)으로 오는 회사: 누적금액이 있으면 그 차이를 써서 올바른 3개월분
    q = C.buildQuarters([P(2023, '11013', 100, { opAdd: 100 }), P(2023, '11012', 150, { opAdd: 150 }), P(2023, '11014', 230, { opAdd: 230 }), P(2023, '11011', 330)], {}, 12);
    assert.deepEqual(q.map((x) => x.op), [100, 50, 80, 100]);
    // ④ 적자·부호, 매출/순이익도 같은 방식
    q = C.buildQuarters([P(2022, '11013', -10, { opAdd: -10 }), P(2022, '11012', 5, { opAdd: -5 }), P(2022, '11014', -3, { opAdd: -8 }), P(2022, '11011', -20)], {}, 12); assert.deepEqual(q.map((x) => x.op), [-10, 5, -3, -12]); assert.equal(q[3].revenue, -200 - (-100 + 50 - 30));
    // ⑤ 3월 결산(결산월 3): 사업연도 2025 → 분기 말은 2025-06, 2025-09, 2025-12, 2026-03
    q = C.buildQuarters([P(2025, '11013', 10), P(2025, '11012', 20), P(2025, '11014', 30), P(2025, '11011', 100)], {}, 3); assert.deepEqual(q.map((x) => x.ym), ['2025-06', '2025-09', '2025-12', '2026-03']);
    // ⑥ 보고서 이름 해석
    assert.deepEqual(C.parseFilingName('분기보고서 (2026.09)'), { type: '분기보고서', ym: '2026-09', correction: false }); assert.equal(C.parseFilingName('[기재정정]사업보고서 (2025.12)').correction, true); assert.equal(C.parseFilingName('임원ㆍ주요주주특정증권등소유상황보고서'), null);
    // ⑦ parseFinancials: 누적금액 기록, 비어 있으면 기록 안 함
    const pf = C.parseFinancials([{ fs_div: 'CFS', account_nm: '영업이익', thstrm_amount: '5,000', thstrm_add_amount: '12,000' }, { fs_div: 'CFS', account_nm: '매출액', thstrm_amount: '100', thstrm_add_amount: '' }]);
    assert.equal(pf.op, 5000); assert.equal(pf.opAdd, 12000); assert.equal(pf.revenue, 100); assert.equal(pf.revenueAdd, undefined);
  });
  await t('재무 수집 실행: 수집 기간만큼 연도를 받아 분기·공시일 저장, 옛 파일(quarters 없음)은 다시 받음', async () => {
    const dir = tmp(); fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ years: 5, stocks: [{ code: '015760', name: '한국전력' }] }));
    const finData = {}; for (const y of [2026, 2025, 2024]) { finData[y + ':11013'] = { rev: 100, op: 10, net: 5, revAdd: 100, opAdd: 10, netAdd: 5 }; finData[y + ':11012'] = { rev: 110, op: 20, net: 6, revAdd: 210, opAdd: 30, netAdd: 11 }; finData[y + ':11014'] = { rev: 120, op: 30, net: 7, revAdd: 330, opAdd: 60, netAdd: 18 }; if (y < 2026) finData[y + ':11011'] = { rev: 500, op: 100, net: 40 }; }
    const filings = [['20240514', '분기보고서 (2024.03)'], ['20250320', '사업보고서 (2024.12)'], ['20250515', '분기보고서 (2025.03)'], ['20260320', '사업보고서 (2025.12)'], ['20261114', '분기보고서 (2026.09)']];
    const st = { finData, filings }; const KEY2 = Object.assign({}, KEYS, { COLLECT_FLOW: '0', COLLECT_PRICE_NAVER: '0' });
    let r = await C.run({ env: KEY2, dataDir: dir, fetch: mockFetch(st), today: new Date('2026-11-27T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert.equal(r.failures, 0, JSON.stringify(r.status.stocks['015760'].fin));
    const fin = JSON.parse(fs.readFileSync(path.join(dir, 'fin', '015760.json'), 'utf8'));
    assert(fin.quarters.length >= 10, '분기 ' + fin.quarters.length); const q = Object.fromEntries(fin.quarters.map((x) => [x.ym, x]));
    assert.equal(q['2024-12'].op, 100 - 10 - 20 - 30); assert.equal(q['2024-12'].derived, true); assert.equal(q['2024-12'].filed, '2025-03-20'); assert.equal(q['2025-03'].filed, '2025-05-15'); assert.equal(q['2026-09'].filed, '2026-11-14'); assert.equal(q['2025-06'].filed, null); // 공시일을 모르는 기간은 null
    assert.equal(r.status.stocks['015760'].fin.quarters, fin.quarters.length); assert.equal(r.status.stocks['015760'].fin.last, '2026-09');
    assert.equal(st.filingCalls, 1); assert(fin.periods.length >= 10);
    // 옛 파일(quarters 없음)은 최근에 받았어도 다시 받음
    const old = JSON.parse(fs.readFileSync(path.join(dir, 'fin', '015760.json'), 'utf8')); delete old.quarters; fs.writeFileSync(path.join(dir, 'fin', '015760.json'), JSON.stringify(old));
    const st2 = { finData, filings }; await C.run({ env: KEY2, dataDir: dir, fetch: mockFetch(st2), today: new Date('2026-11-28T19:00:00Z'), log: () => {}, pageDelayMs: 0 });
    assert.equal(st2.filingCalls, 1); assert(JSON.parse(fs.readFileSync(path.join(dir, 'fin', '015760.json'), 'utf8')).quarters.length > 0);
    // quarters 가 있으면 6일 동안은 다시 받지 않음
    const st3 = { finData, filings }; await C.run({ env: KEY2, dataDir: dir, fetch: mockFetch(st3), today: new Date('2026-11-29T19:00:00Z'), log: () => {}, pageDelayMs: 0 }); assert.equal(st3.filingCalls || 0, 0);
    // 공시일 조회가 실패해도 재무·분기는 저장(공시일만 비어 있음)
    const dir2 = tmp(); fs.writeFileSync(path.join(dir2, 'watchlist.json'), JSON.stringify([{ code: '015760', name: 'x' }]));
    const f4 = mockFetch({ finData }); const f4b = async (u, i) => (u.includes('/list.json') && u.includes('pblntf_ty=A') ? resp(JSON.stringify({ status: '020', message: '요청 제한' })) : f4(u, i));
    await C.run({ env: KEY2, dataDir: dir2, fetch: f4b, today: new Date('2026-11-27T19:00:00Z'), log: () => {}, pageDelayMs: 0 }); const fin4 = JSON.parse(fs.readFileSync(path.join(dir2, 'fin', '015760.json'), 'utf8')); assert(fin4.quarters.length > 0 && fin4.quarters.every((x) => x.filed === null));
  });
  console.log(`${ok} passed${bad ? ', ' + bad + ' failed' : ''}`);
})();
