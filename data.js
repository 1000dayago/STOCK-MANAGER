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
    return list.filter((s) => s && /^\d{6}$/.test(String(s.code))).map((s) => ({ code: String(s.code), name: s.name || String(s.code) }));
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
  // 앱의 종목 목록 → 자동 수집 대상 JSON (국내 6자리 코드만)
  D.watchJson = (stocks, years) => JSON.stringify(Object.assign(years ? { years } : {}, { stocks: stocks.filter((s) => s.market === 'KR' && /^\d{6}$/.test(String(s.code || '').trim()) && (!s.watch || s.collect)).map((s) => ({ code: String(s.code).trim(), name: s.name })) }), null, 2);
})(typeof globalThis !== 'undefined' ? globalThis : this);
