const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');
const C = require('../tools/collect.js');
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
    if (url.includes('m.stock.naver.com/api/stock/')) {
      if (state.flowFail) return resp('<html>점검중</html>');
      const fd = state.flowDays || ['20260107', '20260106', '20260105'];
      return resp(JSON.stringify(fd.map((d, i) => ({ itemCode: '015760', bizdate: d, foreignerPureBuyQuant: i === 0 ? '-970,498' : '+1,000', organPureBuyQuant: '+477,979', individualPureBuyQuant: '+496,820', closePrice: '29,750' }))));
    }
    if (url.includes('corpCode.xml')) return resp(makeZip('CORPCODE.xml', CORP_XML));
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
    assert.equal(st.stocks['015760'].prices.ok, true); assert.equal(st.stocks['015760'].prices.last, '2026-01-07'); assert.equal(st.skipped.length, 1);
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
    let r = await C.run({ env: { COLLECT_FLOW: '0' }, dataDir: dir, fetch: async () => { throw new Error('호출되면 안 됨'); }, log: () => {} });
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
  console.log(`${ok} passed${bad ? ', ' + bad + ' failed' : ''}`);
})();
