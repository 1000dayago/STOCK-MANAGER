#!/usr/bin/env node
/* 자료 수집: 공공데이터포털(일봉 시세) · DART(공시·재무) · 네이버 검색 API(뉴스) · 네이버 모바일 증권(일봉 시세 — 공공데이터 키가 없을 때, 외국인·기관·개인 순매수 — 키 불필요)
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
const NAVER_STOCK = 'https://m.stock.naver.com/api/stock';
const FLOW_URL = NAVER_STOCK; // 비공식(네이버 모바일 증권이 쓰는 주소). 키 불필요, 60거래일씩 날짜 커서로 과거까지

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

/* ---------- 일봉 시세 (네이버 모바일 증권, 키 불필요) — 공공데이터 키가 없을 때 사용 ---------- */
const MAX_YEARS = 15;
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(v));
const addDays = (d, n) => ymd(new Date(Date.parse(d) + n * 86400000));
const clampYears = (v, def = 3) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(MAX_YEARS, Math.max(1, x)) : def; };
// 최신 → 과거 순으로 60거래일씩 페이지를 넘기며 stopDate(포함)까지 받습니다.
async function fetchNaverPrices(code, fetchFn, opt = {}) {
  const stopDate = opt.stopDate || '0000-00-00', endDate = opt.endDate || null, maxPages = opt.maxPages || 80, delay = opt.delayMs == null ? 250 : opt.delayMs;
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const { status, text } = await getText(fetchFn, `${NAVER_STOCK}/${code}/price?pageSize=60&page=${page}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (status !== 200) throw new Error(`시세 응답 HTTP ${status}${page > 1 ? ` (${page}번째 묶음)` : ''}`);
    let list;
    try { list = JSON.parse(text); } catch (e) { throw new Error('시세 응답을 읽지 못했습니다 (주소나 형식이 바뀌었을 수 있습니다)'); }
    if (!Array.isArray(list)) throw new Error('시세 응답 형식이 예상과 다릅니다');
    let oldest = null;
    for (const x of list) {
      const d = String((x && x.localTradedAt) || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const c = num(x.closePrice), o = num(x.openPrice), h = num(x.highPrice), l = num(x.lowPrice), v = num(x.accumulatedTradingVolume);
      if (c == null) continue;
      oldest = d;
      if (opt.skipDate && d === opt.skipDate) continue; // 장이 끝나기 전의 오늘 값은 확정이 아니라서 제외
      if (endDate && d > endDate) continue;
      out.push({ d, o: o == null ? c : o, h: h == null ? c : h, l: l == null ? c : l, c, v: v == null ? 0 : v });
    }
    if (list.length < 60 || !oldest || oldest <= stopDate) break;
    if (page < maxPages && delay) await sleep(delay);
  }
  if (!out.length) throw new Error('받은 시세가 없습니다 (종목코드를 확인하세요)');
  return out;
}

/* ---------- 투자자별 순매수 (외국인·기관·개인, 단위: 주) ---------- */
const FLOW_HEAD = 'date,frgn,inst,indiv';
// 수급: bizdate(YYYYMMDD)를 주면 그 날짜 '이전' 60거래일이 옵니다. 직전 묶음의 가장 오래된 날짜를 넣어 과거로 이어 갑니다.
async function fetchFlow(code, fetchFn, opt = {}) {
  const stopDate = opt.stopDate || '0000-00-00', endDate = opt.endDate || null, maxPages = opt.maxPages || 80, delay = opt.delayMs == null ? 250 : opt.delayMs;
  let cursor = endDate ? compact(ymd(new Date(Date.parse(endDate) + 86400000))) : null; // 종료일 포함 → 다음 날짜 이전
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const { status, text } = await getText(fetchFn, `${FLOW_URL}/${code}/trend?pageSize=60${cursor ? `&bizdate=${cursor}` : ''}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    if (status !== 200) throw new Error(`수급 응답 HTTP ${status}${page > 1 ? ` (${page}번째 묶음)` : ''}`);
    let list;
    try { list = JSON.parse(text); } catch (e) { throw new Error('수급 응답을 읽지 못했습니다 (주소나 형식이 바뀌었을 수 있습니다)'); }
    if (!Array.isArray(list)) throw new Error('수급 응답 형식이 예상과 다릅니다');
    let oldest = null;
    for (const x of list) {
      const b = String((x && x.bizdate) || '');
      if (!/^\d{8}$/.test(b)) continue;
      oldest = dash(b);
      const f = num(x.foreignerPureBuyQuant), i = num(x.organPureBuyQuant), d = num(x.individualPureBuyQuant);
      if (f == null && i == null && d == null) continue;
      if (endDate && oldest > endDate) continue;
      out.push({ d: oldest, f, i, p: d });
    }
    if (list.length < 60 || !oldest || oldest <= stopDate) break;
    const next = compact(oldest);
    if (next === cursor) break; // 더 나아가지 못함
    cursor = next;
    if (page < maxPages && delay) await sleep(delay);
  }
  if (!out.length) throw new Error('받은 수급 데이터가 없습니다');
  return out;
}
function parseFlowCsv(text) {
  const out = [];
  for (const line of String(text || '').split('\n').slice(1)) {
    const c = line.trim().split(',');
    if (c.length < 4 || !/^\d{4}-\d{2}-\d{2}$/.test(c[0])) continue;
    const n = (v) => (v === '' || v == null ? null : +v);
    out.push({ d: c[0], f: n(c[1]), i: n(c[2]), p: n(c[3]) });
  }
  return out;
}
function mergeFlowRows(existingText, newRows) {
  const map = new Map(parseFlowCsv(existingText).map((r) => [r.d, r]));
  for (const r of newRows) map.set(r.d, r); // 같은 날짜는 새 값으로
  const rows = [...map.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  const cell = (v) => (v == null ? '' : v);
  return { rows, text: FLOW_HEAD + '\n' + rows.map((r) => `${r.d},${cell(r.f)},${cell(r.i)},${cell(r.p)}`).join('\n') + '\n' };
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
/* ---------- 정기공시(사업·반기·분기보고서) 공시일 ---------- */
// report_nm 예: "분기보고서 (2026.09)", "[기재정정]반기보고서 (2026.06)" → { ym:'2026-09', type }
function parseFilingName(name) {
  const m = String(name || '').match(/(사업보고서|반기보고서|분기보고서)\s*\((\d{4})\.(\d{2})\)/);
  return m ? { type: m[1], ym: `${m[2]}-${m[3]}`, correction: /정정/.test(String(name)) } : null;
}
// 같은 기간에 정정공시가 여러 번 있어도 가장 이른 날짜(최초 공시일)를 씁니다.
function filingDates(list) {
  const out = {};
  for (const x of list) {
    const f = parseFilingName(x.title || x.report_nm);
    const d = x.date || (x.rcept_dt ? dash(String(x.rcept_dt)) : null);
    if (!f || !d) continue;
    if (!out[f.ym] || d < out[f.ym].date) out[f.ym] = { date: d, type: f.type };
  }
  return out;
}
// 주요사항보고서 이름으로 이슈 종류를 나눔(유상증자·무상증자·감자·분할/병합·합병/분할·CB/BW). “유무상증자”는 둘 다.
const EVENT_KINDS = [['유', /유상증자|유무상증자/, '유상증자'], ['무', /무상증자|유무상증자/, '무상증자'], ['감', /감자/, '감자'], ['분', /주식분할|주식병합|액면/, '분할·병합'], ['합', /합병|회사분할/, '합병·분할'], ['CB', /전환사채|신주인수권부사채|교환사채/, 'CB·BW']];
function classifyEvent(name) { const t = String(name || ''); return EVENT_KINDS.filter(([, re]) => re.test(t)).map(([kind, , label]) => ({ kind, label })); }
// list: [{report_nm, rcept_dt}] → [{date, kind, label, title}] (정정공시 등으로 같은 종류가 45일 안에 또 나오면 처음 것만)
function buildEvents(list) {
  const out = [], last = {};
  for (const x of (list || []).slice().sort((a, b) => String(a.rcept_dt).localeCompare(String(b.rcept_dt)))) {
    const date = dash(String(x.rcept_dt || ''));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const title = String(x.report_nm || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    for (const { kind, label } of classifyEvent(title)) {
      if (last[kind] && Date.parse(date) - Date.parse(last[kind]) < 45 * 86400000) continue;
      last[kind] = date; out.push({ date, kind, label, title });
    }
  }
  return out;
}
async function fetchEventList(corpCode, fromYear, key, fetchFn, today) { // 주요사항보고서(유상증자결정 등)만
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await dartJson(fetchFn, 'list', { corp_code: corpCode, bgn_de: `${fromYear}0101`, end_de: compact(ymd(today)), pblntf_ty: 'B', page_no: page, page_count: 100 }, key);
    if (j.status === '013') break;
    if (j.status !== '000') throw new Error(`DART 오류 ${j.status}: ${j.message || ''}`);
    for (const x of j.list || []) out.push({ report_nm: x.report_nm, rcept_dt: x.rcept_dt });
    if (page >= (num(j.total_page) || 1)) break;
    await sleep(250);
  }
  return out;
}
async function fetchFilings(corpCode, fromYear, key, fetchFn, today) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const j = await dartJson(fetchFn, 'list', { corp_code: corpCode, bgn_de: `${fromYear}0101`, end_de: compact(ymd(today)), pblntf_ty: 'A', page_no: page, page_count: 100 }, key);
    if (j.status === '013') break;
    if (j.status !== '000') throw new Error(`DART 오류 ${j.status}: ${j.message || ''}`);
    for (const x of j.list || []) out.push({ report_nm: x.report_nm, rcept_dt: x.rcept_dt });
    if (page >= (num(j.total_page) || 1)) break;
    await sleep(250);
  }
  return out;
}
const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
// 보고서별 값 → 분기별(3개월분) 값. 분기·반기 보고서의 누적금액이 있으면 그 차이로, 없으면 당기금액을 3개월분으로 봅니다.
// 4분기 = 연간(사업보고서) − 앞 3분기. filings: filingDates() 결과. fyeMonth: 결산월(기본 12)
function buildQuarters(periods, filings, fyeMonth) {
  const M = fyeMonth || 12, out = [];
  const years = [...new Set(periods.map((p) => p.year))].sort();
  const get = (y, rep) => periods.find((p) => p.year === y && p.report === rep);
  for (const y of years) {
    const q1 = get(y, '11013'), h1 = get(y, '11012'), q3 = get(y, '11014'), an = get(y, '11011');
    const endYear = M === 12 ? y : y + 1, q4End = `${endYear}-${String(M).padStart(2, '0')}`;
    const end = { 1: addMonths(q4End, -9), 2: addMonths(q4End, -6), 3: addMonths(q4End, -3), 4: q4End };
    for (const k of ['revenue', 'op', 'net']) {
      const cum = { 1: q1 && (q1[k + 'Add'] != null ? q1[k + 'Add'] : q1[k]), 2: h1 && h1[k + 'Add'], 3: q3 && q3[k + 'Add'] };
      const three = { 1: q1 && q1[k], 2: h1 && h1[k], 3: q3 && q3[k] }; // 당기금액(분기·반기 보고서는 보통 3개월분)
      const v = {};
      v[1] = three[1] != null ? three[1] : cum[1];
      v[2] = cum[2] != null && cum[1] != null ? cum[2] - cum[1] : three[2];
      v[3] = cum[3] != null && cum[2] != null ? cum[3] - cum[2] : three[3];
      const annual = an && an[k];
      let derived = false;
      v[4] = annual != null && v[1] != null && v[2] != null && v[3] != null ? annual - v[1] - v[2] - v[3] : null; derived = v[4] != null;
      for (let q = 1; q <= 4; q++) {
        if (v[q] == null) continue;
        let o = out.find((x) => x.ym === end[q]);
        if (!o) { o = { ym: end[q], year: y, q, label: `${y} ${q}분기`, fs: ((q === 4 ? an : q === 1 ? q1 : q === 2 ? h1 : q3) || {}).fs || '', filed: (filings[end[q]] || {}).date || null }; out.push(o); }
        o[k] = Math.round(v[q]);
        if (q === 4 && derived) o.derived = true; // 연간에서 계산한 값
      }
    }
    // 재무상태표 값(자산·부채·자본)은 분기 말 잔액이라 그 시점 보고서의 값을 그대로 붙입니다(4분기 = 사업보고서)
    for (let q = 1; q <= 4; q++) {
      const per = { 1: q1, 2: h1, 3: q3, 4: an }[q], o = out.find((x) => x.ym === end[q]);
      if (!per || !o) continue;
      for (const k of ['assets', 'liab', 'equity']) if (Number.isFinite(per[k])) o[k] = Math.round(per[k]);
    }
  }
  return out.filter((o) => o.op != null).sort((a, b) => (a.ym < b.ym ? -1 : 1));
}
const ACCOUNTS = { revenue: ['매출액', '수익(매출액)', '영업수익'], op: ['영업이익', '영업이익(손실)'], net: ['당기순이익', '당기순이익(손실)', '분기순이익', '반기순이익', '연결당기순이익'], assets: ['자산총계'], liab: ['부채총계'], equity: ['자본총계'] };
const REPORTS = [['11013', '1분기'], ['11012', '반기'], ['11014', '3분기'], ['11011', '사업보고서']];
function parseFinancials(list) {
  const fsDiv = list.some((x) => x.fs_div === 'CFS') ? 'CFS' : 'OFS';
  const out = { fs: fsDiv === 'CFS' ? '연결' : '별도' };
  for (const x of list.filter((r) => r.fs_div === fsDiv)) {
    for (const [k, names] of Object.entries(ACCOUNTS)) {
      if (!names.includes(String(x.account_nm).trim()) || out[k] != null) continue;
      out[k] = num(x.thstrm_amount);
      if (['revenue', 'op', 'net'].includes(k) && x.thstrm_add_amount != null && String(x.thstrm_add_amount).trim() !== '') out[k + 'Add'] = num(x.thstrm_add_amount); // 분기·반기 보고서의 누적금액
    }
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
  const years = !Array.isArray(w) && w.years != null ? clampYears(w.years) : null;
  const gfrom = !Array.isArray(w) && isYmd(w.from) ? w.from : null, gto = !Array.isArray(w) && isYmd(w.to) ? w.to : null;
  const seen = new Set(), ok = [], skipped = [];
  for (const s of list) {
    const code = String((s && s.code) || '').trim();
    const name = String((s && s.name) || '').trim();
    if (!/^[0-9A-Z]{6}$/.test(code)) { skipped.push(`${name || code}: 국내 종목코드(6자리 숫자·영문 대문자)가 아닙니다`); continue; }
    if (seen.has(code)) continue;
    seen.add(code); ok.push({ code, name: name || code, years: s.years != null ? clampYears(s.years) : null, from: isYmd(s.from) ? s.from : null, to: isYmd(s.to) ? s.to : null });
  }
  return { stocks: ok, skipped, years, from: gfrom, to: gto };
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
  if (keys.dart && (want('dart') || want('fin') || want('events')) && wl.stocks.length) {
    try { corpMap = await loadCorpMap(dir, wl.stocks.map((s) => s.code), keys.dart, fetchFn); }
    catch (e) { for (const s of wl.stocks) status.stocks[s.code] = { dart: { ok: false, error: mask(e.message) }, fin: { ok: false, error: mask(e.message) } }; failures++; log('DART 고유번호 오류: ' + mask(e.message)); }
  }

  for (const s of wl.stocks) {
    log(`${s.name} (${s.code})`);
    status.stocks[s.code] = status.stocks[s.code] || {};
    // 시세 (공공데이터 키가 없으면 네이버에서 받음. COLLECT_PRICE_NAVER=0 이면 끔)
    const useNaverPx = !keys.prices && env.COLLECT_PRICE_NAVER !== '0';
    // 수집 범위: 시작일(from)이 있으면 그것을, 없으면 오늘부터 years년 전. 종료일(to)이 없으면 오늘까지.
    const years = s.years || wl.years || (env.COLLECT_YEARS ? clampYears(env.COLLECT_YEARS) : 3);
    const from = s.from || wl.from || null, to = s.to || wl.to || null;
    const rangeErr = from && to && from > to ? '시작일이 종료일보다 늦습니다. 설정에서 날짜를 확인하세요.' : null;
    const start = from || ymd(new Date(today.getTime() - years * 365.25 * 86400000));
    const todayYmd = ymd(today), endEff = to && to < todayYmd ? to : null; // 오늘까지면 끝을 따로 두지 않음
    const skipDate = today.getUTCHours() < 16 && !endEff ? todayYmd : null;
    // 이미 받은 범위 판단: 앞쪽이 시작일 근처까지 있으면(coveredStart) 최근분만 이어받음. 종료일이 과거로 고정이면 양쪽이 다 있을 때만 건너뜀.
    const plan = (oldRows) => {
      const coveredStart = !!oldRows.length && oldRows[0].d <= addDays(start, 10);
      if (endEff) return coveredStart && oldRows[oldRows.length - 1].d >= addDays(endEff, -7) ? { skip: true } : { stopDate: start };
      return { stopDate: coveredStart ? addDays(oldRows[oldRows.length - 1].d, -7) : start }; // 이어받기는 최근 1주일을 다시 받아 보정
    };
    const inRange = (r) => r.d >= start && (!endEff || r.d <= endEff);
    const label = from || to ? `${start} ~ ${to || '오늘'}` : `최근 ${years}년`;
    if (useNaverPx) await step(s.code, 'prices', !rangeErr, rangeErr || '', async () => {
      const f = path.join(dir, 'prices', `${s.code}.csv`);
      let old = ''; try { old = fs.readFileSync(f, 'utf8'); } catch (e) { /* 없음 */ }
      const oldRows = parseCsvRows(old), pl = plan(oldRows);
      let m;
      if (pl.skip) m = { rows: oldRows.filter(inRange) };
      else {
        const rows = (await fetchNaverPrices(s.code, fetchFn, { stopDate: pl.stopDate, endDate: endEff, skipDate, delayMs: opt.pageDelayMs })).filter(inRange);
        m = mergePrices(old, rows);
        if (writeIfChanged(f, m.text)) changed++;
      }
      if (!m.rows.length) throw new Error('받은 시세가 없습니다');
      const rr = m.rows.filter(inRange);
      return { source: 'naver', years, range: label, from: m.rows[0].d, last: m.rows[m.rows.length - 1].d, close: m.rows[m.rows.length - 1].c, count: m.rows.length, msg: `(네이버, ${label}, ${m.rows.length}일, ${m.rows[0].d} ~ ${m.rows[m.rows.length - 1].d}${pl.skip ? ', 이미 수집됨' : ''})`, inRange: rr.length };
    });
    else await step(s.code, 'prices', !!keys.prices, env.COLLECT_PRICE_NAVER === '0' ? '시세 수집을 껐습니다(COLLECT_PRICE_NAVER=0)' : '', async () => {
      const f = path.join(dir, 'prices', `${s.code}.csv`);
      let old = ''; try { old = fs.readFileSync(f, 'utf8'); } catch (e) { /* 없음 */ }
      const oldRows = parseCsvRows(old);
      const begin = oldRows.length ? compact(oldRows[oldRows.length - 1].d) : compact(ymd(new Date(today.getTime() - 365 * 3 * 86400000)));
      const rows = await fetchPrices(s.code, begin, keys.prices, fetchFn);
      const m = mergePrices(old, rows);
      if (!m.rows.length) throw new Error('받은 시세가 없습니다 (종목코드·활용신청 승인을 확인하세요)');
      if (writeIfChanged(f, m.text)) changed++;
      return { source: 'data.go.kr', from: m.rows[0].d, last: m.rows[m.rows.length - 1].d, close: m.rows[m.rows.length - 1].c, count: m.rows.length, msg: `(${m.rows.length}일, 마지막 ${m.rows[m.rows.length - 1].d})` };
    });
    // 수급 (키 없음, COLLECT_FLOW=0 이면 끔) — 시세와 같은 수집 범위, 과거는 날짜 기준으로 이어 받음
    await step(s.code, 'flow', env.COLLECT_FLOW !== '0' && !rangeErr, rangeErr || '수급 수집을 껐습니다(COLLECT_FLOW=0)', async () => {
      const f = path.join(dir, 'flow', `${s.code}.csv`);
      let old = ''; try { old = fs.readFileSync(f, 'utf8'); } catch (e) { /* 없음 */ }
      const oldRows = parseFlowCsv(old).map((r) => ({ d: r.d })), pl = plan(oldRows);
      let m;
      if (pl.skip) m = { rows: parseFlowCsv(old).filter(inRange) };
      else {
        const rows = (await fetchFlow(s.code, fetchFn, { stopDate: pl.stopDate, endDate: endEff, delayMs: opt.pageDelayMs })).filter(inRange);
        m = mergeFlowRows(old, rows);
        if (writeIfChanged(f, m.text)) changed++;
      }
      if (!m.rows.length) throw new Error('받은 수급 데이터가 없습니다');
      return { range: label, from: m.rows[0].d, last: m.rows[m.rows.length - 1].d, count: m.rows.length, msg: `(${label}, ${m.rows.length}일, ${m.rows[0].d} ~ ${m.rows[m.rows.length - 1].d}${pl.skip ? ', 이미 수집됨' : ''})` };
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
    const fresh = finOld && finOld.updatedAt && finOld.quarters && finOld.v >= 2 && Date.now() - Date.parse(finOld.updatedAt) < 6 * 86400000 && !env.FORCE_FIN; // 분기·재무상태표(v2)가 없는 옛 파일은 다시 받음
    await step(s.code, 'fin', !!keys.dart && !fresh, fresh ? '최근에 수집함(6일에 한 번)' : 'DART 키(DART_API_KEY) 없음', async () => {
      if (!corpMap[s.code]) throw new Error('DART에서 이 종목의 고유번호를 찾지 못했습니다');
      const y = today.getUTCFullYear(), finYears = Math.max(3, Math.min(10, env.COLLECT_FIN_YEARS ? clampYears(env.COLLECT_FIN_YEARS) : years)); // 수집 기간(년)을 따르되 3~10년
      const periods = await fetchFinancials(corpMap[s.code], Array.from({ length: finYears }, (_, i) => y - i), keys.dart, fetchFn);
      let filings = {};
      try { filings = filingDates(await fetchFilings(corpMap[s.code], y - finYears, keys.dart, fetchFn, today)); } catch (e) { /* 공시일을 못 받아도 재무는 저장(공시일은 추정으로 표시됨) */ }
      const ann = Object.keys(filings).filter((k) => filings[k].type === '사업보고서').sort().pop();
      const quarters = buildQuarters(periods, filings, ann ? +ann.slice(5) : 12);
      if (writeJSON(finFile, { v: 2, updatedAt: new Date().toISOString(), periods, quarters })) changed++;
      return { count: periods.length, quarters: quarters.length, last: quarters.length ? quarters[quarters.length - 1].ym : null, msg: `(${periods.length}개 기간, 분기 ${quarters.length}개${quarters.length ? ', 마지막 ' + quarters[quarters.length - 1].ym : ''})` };
    });
    // 이슈(유상증자·무상증자·감자 등, 6일에 한 번)
    const evFile = path.join(dir, 'events', `${s.code}.json`), evOld = readJSON(evFile, null);
    const evFresh = evOld && evOld.updatedAt && Date.now() - Date.parse(evOld.updatedAt) < 6 * 86400000 && !env.FORCE_FIN;
    await step(s.code, 'events', !!keys.dart && !evFresh, evFresh ? '최근에 수집함(6일에 한 번)' : 'DART 키(DART_API_KEY) 없음', async () => {
      if (!corpMap[s.code]) throw new Error('DART에서 이 종목의 고유번호를 찾지 못했습니다');
      const y = today.getUTCFullYear(), evYears = Math.max(3, Math.min(10, env.COLLECT_FIN_YEARS ? clampYears(env.COLLECT_FIN_YEARS) : years));
      const items = buildEvents(await fetchEventList(corpMap[s.code], y - evYears, keys.dart, fetchFn, today));
      if (writeJSON(evFile, { v: 1, updatedAt: new Date().toISOString(), items })) changed++;
      return { count: items.length, msg: `(${items.length}건)` };
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
module.exports = { classifyEvent, buildEvents, fetchEventList, buildQuarters, filingDates, parseFilingName, parseFinancials, run, isYmd, fetchNaverPrices, clampYears, fetchFlow, mergeFlowRows, parseFlowCsv, fetchPrices, mergePrices, parseCsvRows, fetchNews, cleanText, unzipFirst, parseCorpXml, fetchDisclosures, fetchFinancials, parseFinancials, readWatchlist, encKey, makeMask, mergeList, apiErrorFromText };
