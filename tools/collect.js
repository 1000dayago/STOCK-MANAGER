#!/usr/bin/env node
/* 자료 수집: 공공데이터포털(일봉 시세) · DART(공시·재무) · 네이버 검색 API(뉴스)
   GitHub Actions 에서 평일 저녁에 실행되어 data/ 폴더에 결과를 저장합니다. (Node 20+, 외부 패키지 없음)
   필요한 키(저장소 Settings > Secrets and variables > Actions):
     DATA_GO_KR_KEY, DART_API_KEY, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
   키가 없는 항목은 건너뜁니다. 일부 오류가 나도 나머지는 계속 수집하고, 결과는 data/status.json 에 기록합니다. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PRICE_URL = 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const NEWS_URL = 'https://openapi.naver.com/v1/search/news.json';
const DART = 'https://opendart.fss.or.kr/api';

/* ---------- 공통 ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const ymd = (d) => d.toISOString().slice(0, 10);
const compact = (s) => s.replace(/-/g, '');
const dash = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
const encKey = (k) => (/%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k)); // 인코딩/디코딩 키 모두 허용
const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return Number.isFinite(x) ? x : null; };

function readJSON(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; } }
function writeIfChanged(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let old = null;
  try { old = fs.readFileSync(file, 'utf8'); } catch (e) { /* 새 파일 */ }
  if (old === text) return false;
  fs.writeFileSync(file, text);
  return true;
}
const writeJSON = (file, obj) => writeIfChanged(file, JSON.stringify(obj, null, 1) + '\n');

// 로그/오류 메시지에서 키가 새지 않게 가립니다
function makeMask(secrets) {
  const list = secrets.filter(Boolean).flatMap((s) => [s, encodeURIComponent(s), encKey(s)]);
  return (text) => list.reduce((t, s) => (s ? String(t).split(s).join('***') : t), String(text));
}

async function getText(fetchFn, url, init) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchFn(url, init);
      const text = await res.text();
      if (res.status >= 500) throw new Error(`서버 오류 HTTP ${res.status}`);
      return { status: res.status, text };
    } catch (e) { lastErr = e; await sleep(600 * (i + 1)); }
  }
  throw lastErr;
}

/* ---------- 시세 (공공데이터포털: 금융위원회_주식시세정보) ---------- */
const normalizeItems = (items) => {
  if (!items) return [];
  const it = items.item !== undefined ? items.item : items;
  return Array.isArray(it) ? it : it ? [it] : [];
};
function apiErrorFromText(text) {
  if (/SERVICE_KEY_IS_NOT_REGISTERED/i.test(text)) return '서비스키가 등록되지 않았습니다. 활용신청 승인과 키(일반 인증키)를 확인하세요.';
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/i.test(text)) return '일일 호출 한도를 초과했습니다.';
  if (/SERVICE_ACCESS_DENIED|UNAUTHORIZED/i.test(text)) return '접근이 거부되었습니다. 활용신청 승인 여부를 확인하세요.';
  return null;
}
async function fetchPrices(code, beginYmd, key, fetchFn) {
  const rows = [];
  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const url = `${PRICE_URL}?serviceKey=${encKey(key)}&resultType=json&numOfRows=${perPage}&pageNo=${page}&likeSrtnCd=${code}&beginBasDt=${beginYmd}`;
    const { text } = await getText(fetchFn, url);
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error(apiErrorFromText(text) || '응답이 JSON이 아닙니다: ' + text.slice(0, 100).replace(/\s+/g, ' ')); }
    const h = j.response && j.response.header;
    if (h && h.resultCode && h.resultCode !== '00') throw new Error(`공공데이터 오류 ${h.resultCode}: ${h.resultMsg || ''}`);
    const body = (j.response && j.response.body) || {};
    const items = normalizeItems(body.items);
    for (const it of items) {
      if (String(it.srtnCd || '').replace(/^A/, '') !== code) continue;
      const close = num(it.clpr);
      if (!it.basDt || !close) continue;
      rows.push({ d: dash(String(it.basDt)), o: num(it.mkp) || close, h: num(it.hipr) || close, l: num(it.lopr) || close, c: close, v: num(it.trqu) || 0 });
    }
    const total = num(body.totalCount) || 0;
    if (!items.length || page * perPage >= total) break;
    await sleep(250);
  }
  return rows;
}
const CSV_HEAD = 'date,open,high,low,close,volume';
function parseCsvRows(text) {
  const out = [];
  for (const line of String(text || '').split('\n').slice(1)) {
    const c = line.trim().split(',');
    if (c.length < 6 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0])) continue;
    out.push({ d: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] });
  }
  return out;
}
function mergePrices(existingText, newRows) {
  const map = new Map(parseCsvRows(existingText).map((r) => [r.d, r]));
  for (const r of newRows) map.set(r.d, r);
  const rows = [...map.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  return { rows, text: CSV_HEAD + '\n' + rows.map((r) => `${r.d},${r.o},${r.h},${r.l},${r.c},${r.v}`).join('\n') + '\n' };
}

/* ---------- 뉴스 (네이버 검색 API) ---------- */
const ENT = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' };
const cleanText = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&(quot|amp|lt|gt|apos|nbsp|#39);/g, (m) => ENT[m] || m).replace(/\s+/g, ' ').trim();
async function fetchNews(name, id, secret, fetchFn) {
  const url = `${NEWS_URL}?query=${encodeURIComponent(name)}&display=30&sort=date`;
  const { status, text } = await getText(fetchFn, url, { headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret } });
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('응답이 JSON이 아닙니다 (HTTP ' + status + ')'); }
  if (j.errorCode) throw new Error(`네이버 오류 ${j.errorCode}: ${j.errorMessage || ''}`);
  return (j.items || []).map((it) => {
    const t = Date.parse(it.pubDate);
    return { title: cleanText(it.title), url: it.originallink || it.link, naver: it.link, desc: cleanText(it.description), date: Number.isFinite(t) ? new Date(t).toISOString() : '' };
  }).filter((x) => x.title && /^https?:\/\//.test(x.url || ''));
}
function mergeList(oldList, newList, keyFn, sortFn, cap) {
  const map = new Map();
  for (const x of oldList || []) map.set(keyFn(x), x);
  for (const x of newList) map.set(keyFn(x), x);
  return [...map.values()].sort(sortFn).slice(0, cap);
}

/* ---------- DART (공시·재무) ---------- */
function unzipFirst(buf) {
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('ZIP 형식이 아닙니다 (DART 응답을 확인하세요)');
  const cd = buf.readUInt32LE(i + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('ZIP 디렉터리를 읽지 못했습니다');
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data);
}
function parseCorpXml(xml, wanted) {
  const out = {};
  const re = /<list>([\s\S]*?)<\/list>/g;
  let m;
  while ((m = re.exec(xml))) {
    const tag = (n) => { const x = m[1].match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)); return x ? x[1].trim() : ''; };
    const sc = tag('stock_code');
    if (sc && wanted.has(sc)) out[sc] = tag('corp_code');
  }
  return out;
}
async function loadCorpMap(dir, codes, key, fetchFn) {
  const file = path.join(dir, 'dart-corp-map.json');
  const map = readJSON(file, {});
  const missing = codes.filter((c) => !map[c]);
  if (!missing.length) return map;
  const res = await fetchFn(`${DART}/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100 || buf.readUInt32LE(0) !== 0x04034b50) {
    const t = buf.toString('utf8');
    const msg = (t.match(/<message>([\s\S]*?)<\/message>/) || [])[1] || t.slice(0, 100);
    throw new Error('DART 고유번호 파일을 받지 못했습니다: ' + msg);
  }
  const found = parseCorpXml(unzipFirst(buf).toString('utf8'), new Set(missing));
  Object.assign(map, found);
  writeJSON(file, map);
  return map;
}
async function dartJson(fetchFn, endpoint, params, key) {
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const { text } = await getText(fetchFn, `${DART}/${endpoint}.json?crtfc_key=${encodeURIComponent(key)}&${qs}`);
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('DART 응답이 JSON이 아닙니다'); }
  return j;
}
async function fetchDisclosures(corpCode, days, key, fetchFn, today) {
  const end = new Date(today.getTime()), bgn = new Date(today.getTime() - days * 86400000);
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const j = await dartJson(fetchFn, 'list', { corp_code: corpCode, bgn_de: compact(ymd(bgn)), end_de: compact(ymd(end)), page_no: page, page_count: 100 }, key);
    if (j.status === '013') break; // 조회된 데이터가 없음
    if (j.status !== '000') throw new Error(`DART 오류 ${j.status}: ${j.message || ''}`);
    for (const x of j.list || []) out.push({ date: dash(String(x.rcept_dt)), title: String(x.report_nm || '').trim(), rcpNo: x.rcept_no, by: x.flr_nm || '', url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${x.rcept_no}` });
    if (page >= (num(j.total_page) || 1)) break;
    await sleep(250);
  }
  return out;
}
const ACCOUNTS = { revenue: ['매출액', '수익(매출액)', '영업수익'], op: ['영업이익', '영업이익(손실)'], net: ['당기순이익', '당기순이익(손실)', '분기순이익', '반기순이익', '연결당기순이익'], assets: ['자산총계'], liab: ['부채총계'], equity: ['자본총계'] };
const REPORTS = [['11013', '1분기'], ['11012', '반기'], ['11014', '3분기'], ['11011', '사업보고서']];
function parseFinancials(list) {
  const fsDiv = list.some((x) => x.fs_div === 'CFS') ? 'CFS' : 'OFS';
  const out = { fs: fsDiv === 'CFS' ? '연결' : '별도' };
  for (const x of list.filter((r) => r.fs_div === fsDiv)) {
    for (const [k, names] of Object.entries(ACCOUNTS)) if (names.includes(String(x.account_nm).trim()) && out[k] == null) out[k] = num(x.thstrm_amount);
  }
  return out;
}
async function fetchFinancials(corpCode, years, key, fetchFn) {
  const periods = [];
  for (const y of years) {
    for (const [code, label] of REPORTS) {
      const j = await dartJson(fetchFn, 'fnlttSinglAcnt', { corp_code: corpCode, bsns_year: y, reprt_code: code }, key);
      if (j.status === '013') continue;
      if (j.status !== '000') throw new Error(`DART 오류 ${j.status}: ${j.message || ''}`);
      periods.push(Object.assign({ year: y, report: code, label: `${y} ${label}` }, parseFinancials(j.list || [])));
      await sleep(250);
    }
  }
  return periods.sort((a, b) => (a.year !== b.year ? b.year - a.year : b.report.localeCompare(a.report)));
}

/* ---------- 실행 ---------- */
function readWatchlist(dir) {
  const w = readJSON(path.join(dir, 'watchlist.json'), { stocks: [] });
  const list = Array.isArray(w) ? w : w.stocks || [];
  const seen = new Set(), ok = [], skipped = [];
  for (const s of list) {
    const code = String((s && s.code) || '').trim();
    const name = String((s && s.name) || '').trim();
    if (!/^\d{6}$/.test(code)) { skipped.push(`${name || code}: 국내 종목코드(6자리)가 아닙니다`); continue; }
    if (seen.has(code)) continue;
    seen.add(code); ok.push({ code, name: name || code });
  }
  return { stocks: ok, skipped };
}

async function run(opt = {}) {
  const env = opt.env || process.env;
  const dir = opt.dataDir || path.join(__dirname, '..', 'data');
  const fetchFn = opt.fetch || fetch;
  const today = opt.today || kstNow();
  const only = String(env.COLLECT_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
  const want = (k) => !only.length || only.includes(k);
  const keys = { prices: env.DATA_GO_KR_KEY, dart: env.DART_API_KEY, newsId: env.NAVER_CLIENT_ID, newsSecret: env.NAVER_CLIENT_SECRET };
  const mask = makeMask([keys.prices, keys.dart, keys.newsId, keys.newsSecret]);
  const wl = readWatchlist(dir);
  const status = { updatedAt: new Date().toISOString(), keys: { prices: !!keys.prices, dart: !!keys.dart, news: !!(keys.newsId && keys.newsSecret) }, skipped: wl.skipped, stocks: {} };
  const log = opt.log || ((m) => console.log(m));
  let changed = 0, attempts = 0, failures = 0;
  const step = async (code, kind, enabled, skipMsg, fn) => {
    const st = (status.stocks[code] = status.stocks[code] || {});
    if (!want(kind)) { st[kind] = (readJSON(path.join(dir, 'status.json'), {}).stocks || {})[code]?.[kind] || { skipped: '이번 실행에서 제외' }; return; }
    if (!enabled) { st[kind] = { skipped: skipMsg }; return; }
    attempts++;
    try { const info = await fn(); st[kind] = Object.assign({ ok: true, at: new Date().toISOString() }, info); log(`  ${kind}: 성공 ${info.msg || ''}`); }
    catch (e) { failures++; st[kind] = { ok: false, at: new Date().toISOString(), error: mask(e.message || e) }; log(`  ${kind}: 실패 ${mask(e.message || e)}`); }
  };

  let corpMap = {};
  if (keys.dart && (want('dart') || want('fin')) && wl.stocks.length) {
    try { corpMap = await loadCorpMap(dir, wl.stocks.map((s) => s.code), keys.dart, fetchFn); }
    catch (e) { for (const s of wl.stocks) status.stocks[s.code] = { dart: { ok: false, error: mask(e.message) }, fin: { ok: false, error: mask(e.message) } }; failures++; log('DART 고유번호 오류: ' + mask(e.message)); }
  }

  for (const s of wl.stocks) {
    log(`${s.name} (${s.code})`);
    status.stocks[s.code] = status.stocks[s.code] || {};
    // 시세
    await step(s.code, 'prices', !!keys.prices, '공공데이터 키(DATA_GO_KR_KEY) 없음', async () => {
      const f = path.join(dir, 'prices', `${s.code}.csv`);
      let old = ''; try { old = fs.readFileSync(f, 'utf8'); } catch (e) { /* 없음 */ }
      const oldRows = parseCsvRows(old);
      const begin = oldRows.length ? compact(oldRows[oldRows.length - 1].d) : compact(ymd(new Date(today.getTime() - 365 * 3 * 86400000)));
      const rows = await fetchPrices(s.code, begin, keys.prices, fetchFn);
      const m = mergePrices(old, rows);
      if (!m.rows.length) throw new Error('받은 시세가 없습니다 (종목코드·활용신청 승인을 확인하세요)');
      if (writeIfChanged(f, m.text)) changed++;
      return { last: m.rows[m.rows.length - 1].d, count: m.rows.length, msg: `(${m.rows.length}일, 마지막 ${m.rows[m.rows.length - 1].d})` };
    });
    // 뉴스
    await step(s.code, 'news', !!(keys.newsId && keys.newsSecret), '네이버 키(NAVER_CLIENT_ID/SECRET) 없음', async () => {
      const f = path.join(dir, 'news', `${s.code}.json`);
      const old = readJSON(f, { items: [] });
      const items = mergeList(old.items, await fetchNews(s.name, keys.newsId, keys.newsSecret, fetchFn), (x) => x.url, (a, b) => (a.date < b.date ? 1 : -1), 60);
      if (writeJSON(f, { updatedAt: new Date().toISOString(), query: s.name, items })) changed++;
      return { count: items.length, msg: `(${items.length}건)` };
    });
    // 공시
    await step(s.code, 'dart', !!keys.dart, 'DART 키(DART_API_KEY) 없음', async () => {
      if (!corpMap[s.code]) throw new Error('DART에서 이 종목의 고유번호를 찾지 못했습니다 (상장사 종목코드인지 확인)');
      const f = path.join(dir, 'dart', `${s.code}.json`);
      const old = readJSON(f, { items: [] });
      const items = mergeList(old.items, await fetchDisclosures(corpMap[s.code], 120, keys.dart, fetchFn, today), (x) => x.rcpNo, (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.rcpNo.localeCompare(a.rcpNo)), 150);
      if (writeJSON(f, { updatedAt: new Date().toISOString(), items })) changed++;
      return { count: items.length, msg: `(${items.length}건)` };
    });
    // 재무 (6일에 한 번)
    const finFile = path.join(dir, 'fin', `${s.code}.json`);
    const finOld = readJSON(finFile, null);
    const fresh = finOld && finOld.updatedAt && Date.now() - Date.parse(finOld.updatedAt) < 6 * 86400000 && !env.FORCE_FIN;
    await step(s.code, 'fin', !!keys.dart && !fresh, fresh ? '최근에 수집함(6일에 한 번)' : 'DART 키(DART_API_KEY) 없음', async () => {
      if (!corpMap[s.code]) throw new Error('DART에서 이 종목의 고유번호를 찾지 못했습니다');
      const y = today.getUTCFullYear();
      const periods = await fetchFinancials(corpMap[s.code], [y, y - 1], keys.dart, fetchFn);
      if (writeJSON(finFile, { updatedAt: new Date().toISOString(), periods })) changed++;
      return { count: periods.length, msg: `(${periods.length}개 기간)` };
    });
  }
  writeJSON(path.join(dir, 'status.json'), status);
  const summary = `수집 완료: 종목 ${wl.stocks.length}개, 변경된 파일 ${changed}개, 실패 ${failures}건`;
  log(summary);
  return { status, changed, attempts, failures, summary };
}

if (require.main === module) {
  run().then((r) => { if (r.attempts > 0 && r.failures === r.attempts) process.exitCode = 2; }).catch((e) => { console.error('수집 중 예기치 않은 오류:', e.message); process.exitCode = 1; });
}
module.exports = { run, fetchPrices, mergePrices, parseCsvRows, fetchNews, cleanText, unzipFirst, parseCorpXml, fetchDisclosures, fetchFinancials, parseFinancials, readWatchlist, encKey, makeMask, mergeList, apiErrorFromText };
