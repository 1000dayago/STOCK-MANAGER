#!/usr/bin/env node
/* 종목 검색용 전체 목록 만들기: 네이버 모바일 증권의 시가총액 순 목록(코스피·코스닥, 주식·ETF·ETN)을 받아
   data/stocks.json 으로 저장합니다. 앱의 종목 입력창이 이 파일로 이름·코드를 검색합니다. (Node 20+, 외부 패키지 없음, 키 불필요)
   - 비공식 주소라 형식이 바뀌면 실패할 수 있습니다. 받은 종목이 너무 적으면(3,000개 미만) 기존 파일을 덮어쓰지 않고 실패로 끝냅니다.
   - 종목 구성이 그대로면 파일을 다시 쓰지 않습니다(불필요한 커밋 방지).
   형식: {"updatedAt":"ISO","count":N,"stocks":[[코드,이름,시장(P=코스피,Q=코스닥),종류(s=주식,e=ETF,n=ETN)],…]}  (시가총액 큰 순) */
'use strict';
const fs = require('fs');
const path = require('path');

const BASE = 'https://m.stock.naver.com/api/stocks/marketValue';
const MIN_COUNT = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPE = { stock: 's', etf: 'e', etn: 'n' };

async function getJson(fetchFn, url) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
      const text = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      try { return JSON.parse(text); } catch (e) { throw new Error('응답을 읽지 못했습니다(주소나 형식이 바뀌었을 수 있습니다)'); }
    } catch (e) { last = e; await sleep(500 * (i + 1)); }
  }
  throw last;
}

async function fetchMarket(market, fetchFn, delayMs) {
  const out = [];
  let total = Infinity;
  for (let page = 1; page <= 60 && out.length < total; page++) {
    const d = await getJson(fetchFn, `${BASE}/${market}?page=${page}&pageSize=100`);
    if (!d || !Array.isArray(d.stocks)) throw new Error(`${market} 응답 형식이 예상과 다릅니다`);
    total = Number(d.totalCount) || 0;
    if (!d.stocks.length) break;
    for (const s of d.stocks) out.push(s);
    if (delayMs) await sleep(delayMs);
  }
  return out;
}

// raw: [{itemCode, stockName, stockEndType}] 를 시장별로 묶어 받아 중복 제거·정리
function buildList(byMarket) {
  const seen = new Set(), rows = [];
  for (const [mk, list] of Object.entries(byMarket)) {
    for (const s of list) {
      const code = String((s && s.itemCode) || '').trim(), name = String((s && s.stockName) || '').replace(/\s+/g, ' ').trim();
      if (!/^[0-9A-Z]{6}$/.test(code) || !name || seen.has(code)) continue;
      seen.add(code);
      rows.push([code, name, mk === 'KOSPI' ? 'P' : 'Q', TYPE[s.stockEndType] || 's']);
    }
  }
  return rows;
}

async function run(opt = {}) {
  const fetchFn = opt.fetch || fetch;
  const file = opt.file || path.join(__dirname, '..', 'data', 'stocks.json');
  const byMarket = {};
  for (const mk of ['KOSPI', 'KOSDAQ']) byMarket[mk] = await fetchMarket(mk, fetchFn, opt.delayMs == null ? 150 : opt.delayMs);
  const rows = buildList(byMarket);
  const min = opt.minCount == null ? MIN_COUNT : opt.minCount;
  if (rows.length < min) throw new Error(`받은 종목이 ${rows.length}개뿐이라(최소 ${min}개) 기존 파일을 그대로 둡니다`);
  let old = null;
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 없음 */ }
  if (old && JSON.stringify(old.stocks) === JSON.stringify(rows)) return { changed: false, count: rows.length };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const now = (opt.now || new Date()).toISOString();
  fs.writeFileSync(file, JSON.stringify({ updatedAt: now, count: rows.length, stocks: rows }) + '\n');
  return { changed: true, count: rows.length, added: old ? rows.filter((r) => !old.stocks.some((o) => o[0] === r[0])).length : rows.length };
}

if (require.main === module) {
  run().then((r) => console.log(r.changed ? `종목 목록 갱신: ${r.count}개 (새로 ${r.added}개)` : `변경 없음 (${r.count}개)`))
    .catch((e) => { console.error('종목 목록을 만들지 못했습니다:', e.message); process.exitCode = 1; });
}
module.exports = { run, buildList, fetchMarket };
