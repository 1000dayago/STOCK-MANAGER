/* data.js - 저장소에 자동 수집된 자료(data/ 폴더)를 읽어옵니다. 없으면 null/빈 값을 돌려줍니다. */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});
  const D = (SM.data = { memo: new Map() });
  const bust = () => Math.floor(Date.now() / 60000); // 1분 단위로만 새로 받기
  async function get(p, asText) {
    try {
      const res = await fetch(`${p}?t=${bust()}`, { cache: 'no-cache' });
      if (!res.ok) return null;
      return asText ? await res.text() : await res.json();
    } catch (e) { return null; }
  }
  function memo(key, fn, force) {
    if (!force && D.memo.has(key)) return D.memo.get(key);
    const pr = fn();
    D.memo.set(key, pr);
    return pr;
  }
  D.clear = () => D.memo.clear();
  D.watchlist = async (force) => {
    const w = await memo('watch', () => get('data/watchlist.json'), force);
    const list = Array.isArray(w) ? w : (w && w.stocks) || [];
    return list.filter((s) => s && /^[0-9A-Z]{6}$/.test(String(s.code))).map((s) => ({ code: String(s.code), name: s.name || String(s.code) }));
  };
  D.status = (force) => memo('status', () => get('data/status.json'), force);
  D.news = (c, force) => memo('news' + c, () => get(`data/news/${c}.json`), force);
  D.dart = (c, force) => memo('dart' + c, () => get(`data/dart/${c}.json`), force);
  D.fin = (c, force) => memo('fin' + c, () => get(`data/fin/${c}.json`), force);
  D.pricesCsv = (c, force) => memo('px' + c, () => get(`data/prices/${c}.csv`, true), force);
  D.flowCsv = (c, force) => memo('fl' + c, () => get(`data/flow/${c}.csv`, true), force);
  // 수집 대상이 아니면 다른 파일은 요청하지 않습니다(404 방지). 상태 파일에 성공으로 기록된 항목만 읽습니다.
  D.all = async (c, force) => {
    const watch = await D.watchlist(force);
    const out = { watch, status: null, news: null, dart: null, fin: null };
    if (!watch.some((w) => w.code === c)) return out;
    out.status = await D.status(force);
    const sst = out.status && out.status.stocks && out.status.stocks[c];
    if (!sst) return out;
    // 이번 실행이 실패했어도 이전에 받은 파일이 있을 수 있으므로 읽는다. 키가 없어 건너뛴 항목만 제외.
    const has = (k) => sst[k] && !(sst[k].skipped && /키/.test(sst[k].skipped));
    const [news, dart, fin] = await Promise.all([has('news') ? D.news(c, force) : null, has('dart') ? D.dart(c, force) : null, has('fin') ? D.fin(c, force) : null]);
    return Object.assign(out, { news, dart, fin });
  };
  // GitHub Pages 주소(아이디.github.io/저장소/)에서 저장소 링크를 만듭니다. 다른 곳에서 열면 null.
  D.repo = () => {
    const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
    const repo = location.pathname.split('/').filter(Boolean)[0];
    if (!m || !repo) return null;
    const base = `https://github.com/${m[1]}/${repo}`;
    return { owner: m[1], repo, base, actions: `${base}/actions/workflows/collect.yml`, secrets: `${base}/settings/secrets/actions`, editWatch: `${base}/edit/main/data/watchlist.json`, newSecret: `${base}/settings/secrets/actions/new` };
  };
  // 수집 대상에서 빠진 종목과 그 이유(설정 화면 안내용)
  D.watchExcluded = (stocks) => stocks.map((s) => {
    const code = String(s.code || '').trim();
    if (s.market !== 'KR') return { name: s.name, reason: '해외 종목은 자동 수집을 지원하지 않습니다' };
    if (!/^[0-9A-Z]{6}$/.test(code)) return { name: s.name, reason: code ? `종목코드 “${code}”가 6자리(숫자·영문 대문자) 코드가 아닙니다` : '종목코드가 비어 있습니다' };
    if (s.watch && !s.collect) return { name: s.name, reason: '관심 종목의 자동 수집이 꺼져 있습니다(종목 화면의 ⋯ 메뉴에서 켜기)' };
    return null;
  }).filter(Boolean);
  /* ---------- 종목 검색(이름·초성·코드): data/stocks.json 목록으로 앱 안에서 검색 ---------- */
  D.stockList = (force) => memo('stocklist', () => get('data/stocks.json'), force);
  const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const normQ = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, '');
  const choOf = (v) => Array.from(v).map((ch) => { const c = ch.charCodeAt(0) - 0xAC00; return c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : ch; }).join('');
  const MK = { P: '코스피', Q: '코스닥' }, TY = { s: '주식', e: 'ETF', n: 'ETN' };
  function indexOf(rows) { // 처음 한 번만 검색용 값을 만들어 둡니다
    if (rows._idx) return rows._idx;
    return (Object.defineProperty(rows, '_idx', { value: rows.map((r) => { const n = normQ(r[1]); return { r, n, c: choOf(n), code: String(r[0]).toLowerCase() }; }), enumerable: false }), rows._idx);
  }
  const shape = (r) => ({ code: r[0], name: r[1], market: MK[r[2]] || '', type: TY[r[3]] || '주식' });
  // 우선순위: 이름이 입력으로 시작 → 이름에 포함 → 초성 포함. 같은 순위 안에서는 목록 순서(시가총액 큰 순).
  D.searchStocks = (rows, q, limit) => {
    const nq = normQ(q), max = limit || 8;
    if (!nq || !Array.isArray(rows)) return [];
    const idx = indexOf(rows), out = [], seen = new Set();
    const take = (pred) => { for (const e of idx) { if (out.length >= max) return; if (!seen.has(e.r[0]) && pred(e)) { seen.add(e.r[0]); out.push(shape(e.r)); } } };
    if (/^[ㄱ-ㅎ]+$/.test(nq)) { take((e) => e.c.startsWith(nq)); take((e) => e.c.includes(nq)); return out; } // 초성만 입력
    if (/\d/.test(nq) && /^[0-9a-z]+$/.test(nq)) take((e) => e.code.startsWith(nq)); // 숫자가 든 영숫자는 코드 앞부분을 먼저
    take((e) => e.n.startsWith(nq)); take((e) => e.n.includes(nq)); take((e) => e.code.startsWith(nq));
    return out;
  };
  D.stockByCode = (rows, code) => { const c = String(code || '').trim().toUpperCase(); const r = Array.isArray(rows) ? rows.find((x) => x[0] === c) : null; return r ? shape(r) : null; };
  D.MARKER = '<!-- stock-manager:watchlist -->'; // tools/watchlist-issue.js 와 같아야 함
  D.watchRaw = async (force) => memo('watchraw', () => get('data/watchlist.json'), force);
  // 저장소 목록(raw)과 앱의 목록(JSON 문자열)을 비교
  D.watchDiff = (raw, curJson) => {
    const cur = JSON.parse(curJson), list = (r) => (Array.isArray(r) ? r : (r && r.stocks) || []).filter((s) => s && /^[0-9A-Z]{6}$/.test(String(s.code)));
    const rs = list(raw), cs = list(cur), rc = new Set(rs.map((s) => String(s.code))), cc = new Set(cs.map((s) => String(s.code)));
    const rr = raw && !Array.isArray(raw) ? raw : {};
    const added = cs.filter((s) => !rc.has(String(s.code))).map((s) => s.name || s.code), removed = rs.filter((s) => !cc.has(String(s.code))).map((s) => s.name || s.code);
    const optsChanged = (rr.years || null) !== (cur.years || null) || (rr.from || null) !== (cur.from || null) || (rr.to || null) !== (cur.to || null);
    return { same: !added.length && !removed.length && !optsChanged, added, removed, optsChanged, none: !raw };
  };
  // “수집 대상 반영” 이슈 주소: GitHub 새 이슈 화면(제목·본문 미리 채움). 저장소 주소를 알 수 없으면 null, 너무 길면 { tooLong: true }
  D.issueUrl = (curJson) => {
    const r = D.repo();
    if (!r) return null;
    const body = `${D.MARKER}\n앱의 “수집 대상 반영” 버튼으로 만든 목록입니다. 아래 초록색 **Create**(구버전 화면은 Submit new issue) 버튼만 누르면 반영됩니다. (내용은 고치지 마세요)\n\n\`\`\`json\n${curJson}\n\`\`\`\n`;
    const url = `${r.base}/issues/new?title=${encodeURIComponent('수집 대상 반영')}&body=${encodeURIComponent(body)}`;
    return url.length > 7500 ? { tooLong: true } : url;
  };
  // 앱의 종목 목록 → 자동 수집 대상 JSON (국내 6자리 코드만)
  D.watchJson = (stocks, opt) => JSON.stringify(Object.assign(typeof opt === 'number' ? { years: opt } : Object.assign(opt && opt.years ? { years: opt.years } : {}, opt && opt.from ? { from: opt.from } : {}, opt && opt.to ? { to: opt.to } : {}), { stocks: stocks.filter((s) => s.market === 'KR' && /^[0-9A-Z]{6}$/.test(String(s.code || '').trim()) && (!s.watch || s.collect)).map((s) => ({ code: String(s.code).trim(), name: s.name })) }), null, 2);
})(typeof globalThis !== 'undefined' ? globalThis : this);
