/* ui-bt.js - 백테스트 화면 (전략 자유 설정 · 수급 데이터 · 기간 분할 검증) */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app;
  const { fmtNum, fmtMoney, fmtPct, num } = SM;
  const { esc, opts, money, pct, toast } = A;
  const ic = SM.ic;
  const DS_KEY = 'stockmgr.datasets';
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function loadDS() { try { return JSON.parse(localStorage.getItem(DS_KEY) || '{}'); } catch (e) { return {}; } }
  function saveDS(ds) {
    try { localStorage.setItem(DS_KEY, JSON.stringify(ds)); return true; }
    catch (e) { toast('가격 데이터를 저장할 공간이 부족합니다. 안 쓰는 데이터를 삭제하세요.', true); return false; }
  }
  const newImp = () => ({ stockId: '', autoNote: '', text: '', headerLine: '', an: null, fileNames: [], dest: 'new', destId: '', name: '', market: 'KR', useAdj: true, unit: '' });
  const bt = (A.ui.bt = { datasetId: null, cfg: SM.blankCfg(), result: null, val: null, cmp: null, warn: [], validate: false, splitPct: 70, strategyId: '', simTab: 'bt', mode: 'mg', exFrom: 'mg', picker: null, pickGroup: '', all: null, allBusy: false, wrap: null, condOpen: '', modeCfg: { mg: null, custom: null }, stockId: '', imp: newImp() });
  bt.modeCfg.mg = bt.cfg = presetCfg(); bt.modeCfg.custom = SM.blankCfg(); // 물타기 전략은 기본 문장이 채워진 상태, 직접 조건 만들기는 비어 있는 상태로 시작
  const MAP_KEY = 'stockmgr.colmaps';
  const loadMaps = () => { try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch (e) { return {}; } };
  function rememberCols(an) { try { const m = loadMaps(); m[an.signature] = an.cols; localStorage.setItem(MAP_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ } }
  function startImport(table, names) {
    const imp = bt.imp;
    imp.an = SM.analyzeTable(table, loadMaps());
    imp.fileNames = names;
    const kind = SM.kindOf(imp.an.cols);
    const ds = loadDS();
    if (!imp.destId || !ds[imp.destId]) imp.destId = bt.datasetId && ds[bt.datasetId] ? bt.datasetId : Object.keys(ds)[0] || '';
    imp.dest = kind === 'flow' ? 'merge' : 'new';
    imp.autoNote = '';
    if (kind === 'price' || kind === 'both') {
      const r = SM.buildDataset(imp.an.table, imp.an.cols, { useAdj: imp.useAdj });
      if (r.data) {
        for (const id of Object.keys(ds)) {
          const sc = SM.sameStockScore(ds[id].data, r.data);
          if (sc.overlap >= 5 && sc.ratio >= 0.8) {
            imp.dest = 'merge'; imp.destId = id;
            imp.autoNote = `“${ds[id].name}”와 같은 종목으로 보여(겹치는 ${sc.overlap}일 중 ${sc.match}일의 종가가 일치) 기본값을 “기존 데이터에 이어붙이기”로 정했습니다. 다른 종목이면 “새 데이터로 저장”을 선택하세요.`;
            break;
          }
        }
      }
    }
    if (!imp.stockId) imp.stockId = bt.stockId || '';
    bt.warn = [];
    A.render();
    toast(kind === 'unknown' ? '열을 자동으로 찾지 못했습니다. 열을 직접 지정하세요.' : '읽었습니다. 아래 내용을 확인하고 저장하세요.', kind === 'unknown');
  }
  const strategies = () => A.getState().strategies;

  /* ---------- 저장소 자동 수집 데이터: 내 기기에 복사하지 않고 목록에서 바로 선택(항상 최신) ---------- */
  const repo = (bt.repo = { loaded: false, loading: false, initP: null, list: [], cache: {}, inflight: {}, updatedAt: '', err: '' });
  const repoId = (code) => 'repo:' + code;
  const isRepoId = (id) => typeof id === 'string' && id.indexOf('repo:') === 0;
  const ownStockByCode = (code) => A.getState().stocks.find((x) => x.market === 'KR' && String(x.code || '').trim() === code);
  function repoEntries() { // 불러오기 전에도 목록에는 보입니다(pending). 고르면 읽어 옵니다.
    const out = {};
    for (const w of repo.list) {
      const c = repo.cache[w.code], own = ownStockByCode(w.code);
      out[repoId(w.code)] = Object.assign({ name: w.name + ' · 자동 수집', market: 'KR', added: Date.now(), repo: true, code: w.code, info: w, stockId: own ? own.id : null, pending: !c }, c ? { data: c.data, loadedAt: c.loadedAt } : {});
    }
    return out;
  }
  // 데이터 목록(내 기기 저장 + 자동 수집). 액면분할·병합이 감지되면 그 이전 가격·거래량·수급을 현재 기준으로 보정해서 돌려줌
  const allDS = () => {
    const o = Object.assign({}, loadDS(), repoEntries());
    for (const k of Object.keys(o)) { const e = o[k]; if (e && e.data && !e.data.splitAdjusted) { const r = SM.adjustSplits(e.data); if (r.events.length) o[k] = Object.assign({}, e, { data: r.data }); } }
    return o;
  };
  A.btRepoInit = (force) => {
    if (repo.initP && !force) return repo.initP;
    repo.loading = true;
    repo.initP = (async () => {
      try {
        const wl = await SM.data.watchlist(force);
        const st = wl.length ? await SM.data.status(force) : null;
        repo.list = wl.filter((w) => st && st.stocks && st.stocks[w.code] && st.stocks[w.code].prices && st.stocks[w.code].prices.ok)
          .map((w) => ({ code: w.code, name: w.name, prices: st.stocks[w.code].prices, flow: st.stocks[w.code].flow && st.stocks[w.code].flow.ok ? st.stocks[w.code].flow : null }));
        repo.updatedAt = st ? st.updatedAt : ''; repo.err = '';
      } catch (e) { repo.err = '저장소의 수집 목록을 읽지 못했습니다.'; }
      repo.loading = false; repo.loaded = true;
      if (A.ui.view === 'backtest') A.render();
    })();
    return repo.initP;
  };
  A.btRepoLoad = (code, force) => {
    if (!force && repo.cache[code]) return Promise.resolve(repo.cache[code]);
    if (repo.inflight[code]) return repo.inflight[code];
    const p = (async () => {
      try {
        const rt = await repoText(code, force);
        if (rt.error) throw new Error(rt.error);
        if (rt.flowOnly) throw new Error('이 종목은 시세 없이 수급만 수집되어 시뮬레이션 데이터로 쓸 수 없습니다.');
        const t = SM.splitTable(rt.text);
        if (t.error) throw new Error(t.error);
        const an = SM.analyzeTable(t);
        const r = SM.buildDataset(t, an.cols, { unit: 'shares', useAdj: false });
        if (r.error) throw new Error(r.error);
        repo.cache[code] = { data: r.data, loadedAt: Date.now(), names: rt.names };
      } catch (e) { toast(`자동 수집 데이터(${code})를 읽지 못했습니다: ${e.message}`, true); }
      delete repo.inflight[code];
      if (A.ui.view === 'backtest') A.render();
      return repo.cache[code] || null;
    })();
    repo.inflight[code] = p;
    return p;
  };
  // 종목에 연결된 가격 데이터(자동 수집 → 내 CSV 순). 차트 등에서 사용
  A.stockDataset = async (st) => {
    try { await A.btRepoEnsureFor(st); } catch (e) { /* 저장소를 못 읽어도 내 데이터는 사용 */ }
    const l = linkedDatasets(st.id).filter(([, d]) => d.data);
    return l.length ? { id: l[0][0], name: l[0][1].name, data: l[0][1].data } : null;
  };
  A.btRepoEnsureFor = async (st) => { // 이 종목이 자동 수집 대상이면 데이터를 읽어 둡니다(종가 채우기·비교용)
    const code = String(st.code || '').trim();
    if (st.market !== 'KR' || !/^[0-9A-Z]{6}$/.test(code)) return;
    await A.btRepoInit();
    if (repo.list.some((w) => w.code === code)) await A.btRepoLoad(code);
  };
  function curDS() {
    const ds = allDS();
    if (!bt.datasetId || !ds[bt.datasetId]) bt.datasetId = Object.keys(ds)[0] || null;
    const d = bt.datasetId ? ds[bt.datasetId] : null;
    if (d && d.repo && d.pending) { A.btRepoLoad(d.code); return null; } // 불러오는 중
    return d;
  }
  function newCond(type) { const c = { type }; SM.COND_DEFS[type].params.forEach((p) => (c[p.k] = p.def)); return c; }

  /* ---------- 화면 조각 ---------- */
  /* ---------- 조건 UI: 선택한 조건은 한 줄 요약으로 모아 보이고, 눌러서 펼쳐 값을 고침 · 추가는 아래에서 올라오는 선택창 ---------- */
  const COND_SHORT = { vol: '거래량 N주 이상', volChange: '거래량 증가·감소 (전일 대비)', volMa: '거래량 이동평균 비교 (넘음·낮음)', dropVol: '하락 + 거래량 급증 (손절 신호)', volPrev: '거래량이 전일보다 높음', volRatio: '거래량이 평균 대비 급증', maCross: '이동평균 교차 (골든·데드)', maState: '단기·장기선 위치', maSlope: '이동평균선 방향 (상승·하락 중)', priceMa: '종가와 이동평균선 위치', bb: '볼린저밴드 터치', rsi: 'RSI', macd: 'MACD 시그널 교차', breakout: '신고가·신저가', change: '전일 대비 등락률', flow: '수급 (외국인·기관·개인)', flowSum: '수급 누적 순매수 (N일 합)', riseLast: '상승 시 추가 매수 (불타기)', maGap: '이동평균 이격도', maAlign: '이동평균 정배열·역배열', retN: 'N일 전 대비 등락률', streakDays: 'N일 연속 상승·하락', gapOpen: '갭 상승·하락', fromHigh: '고점 대비 낙폭', fromLow: '저점 대비 반등', candle: '양봉·음봉', stoch: '스토캐스틱', bbWidth: '볼린저 밴드폭', dropLast: '하락 시 추가 매수', tp: '목표수익 도달 (순번별)', sl: '손절 (순번별)', trail: '고점 대비 하락 (순번별)', holdDays: 'N일 보유 후 (순번별)', avgPct: '평단 대비 ±N% (전량)' };
  const WHO_TXT = { frgn: '외국인', inst: '기관', indiv: '개인', both: '외국인·기관 동시', combo: '외국인+기관 합산' };
  function condSummary(c) {
    const base = condSummaryCore(c), w = Math.floor(Number(c.within)); return w > 1 && !(SM.COND_DEFS[c.type] || {}).dyn ? `${base} · 최근 ${w}일 이내` : base;
  }
  function condSummaryCore(c) {
    const n = (v) => esc(String(v == null ? '' : v)), ma = c.ma === 'ema' ? 'EMA' : '', up = c.dir !== 'down';
    switch (c.type) {
      case 'vol': return `거래량 ${n(c.n)}주 이상`;
      case 'volPrev': return Number(c.x) > 1 ? `거래량이 전일의 ${n(c.x)}배 초과` : '거래량이 전일보다 높음';
      case 'volChange': { const k = Math.max(1, Math.floor(Number(c.k) || 1)), base = k === 1 ? '전일' : `${k}일 전`, down = c.dir === 'down'; return c.mode === 'ratio' ? `거래량이 ${base}의 ${n(c.x)}배 ${down ? '이하로 감소' : '이상으로 증가'}` : `거래량이 ${base}보다 ${down ? '감소' : '증가'}`; }
      case 'volMa': return `거래량이 ${n(c.n)}일 거래량 평균${Number(c.x) === 1 ? '' : '의 ' + n(c.x) + '배'}${c.dir === 'below' ? ' 미만' : ' 초과'}`;
      case 'dropVol': return `당일 ${n(c.pct)}% 이상 하락 + 거래량이 ${n(c.n)}일 평균의 ${n(c.x)}배 이상`;
      case 'volRatio': return `거래량이 ${n(c.n)}일 평균의 ${n(c.x)}배 이상`;
      case 'maCross': return `${ma}${n(c.s)}일선이 ${n(c.l)}일선을 ${up ? '위로 (골든크로스)' : '아래로 (데드크로스)'}`;
      case 'maState': return `${ma}${n(c.s)}일선이 ${n(c.l)}일선 ${c.dir === 'below' ? '아래' : '위'}`;
      case 'maSlope': return `${ma}${n(c.n)}일선이 ${n(c.k)}일 전보다 ${up ? '높음 (상승 중)' : '낮음 (하락 중)'}`;
      case 'priceMa': return `종가가 ${ma}${n(c.n)}일선 ${c.dir === 'below' ? '아래' : '위'}`;
      case 'bb': return `볼린저 ${c.band === 'upper' ? '상단' : '하단'} 터치 (${n(c.n)}일·${n(c.k)}배, ${c.basis === 'extreme' ? '장중' : '종가'})`;
      case 'rsi': return `RSI(${n(c.n)}) ${n(c.v)} ${c.op === 'gte' ? '이상' : '이하'}`;
      case 'macd': return `MACD(${n(c.s)},${n(c.l)},${n(c.sig)}) ${up ? '상향 돌파' : '하향 이탈'}`;
      case 'breakout': return `${n(c.n)}일 ${c.dir === 'low' ? '신저가 이탈' : '신고가 돌파'}`;
      case 'change': return `전일 대비 ${n(c.v)}% ${c.op === 'gte' ? '이상' : '이하'}`;
      case 'flow': { const who = WHO_TXT[c.who] || '외국인', dir = c.dir === 'sell' ? '순매도' : '순매수', md = c.mode === 'streak' ? `${n(c.n)}일 연속` : c.mode === 'sum' ? `최근 ${n(c.n)}일 합 ${n(c.v)} 이상` : c.mode === 'ratio' ? `당일 거래량의 ${n(c.v)}% 이상` : `당일 ${n(c.v)} 이상`; return `${who} ${dir} · ${md}`; }
      case 'flowSum': { const who = c.who === 'both' ? '외국인·기관 각각' : (WHO_TXT[c.who] || '외국인'), dir = c.dir === 'sell' ? '순매도' : '순매수'; return `${who} 최근 ${n(c.n)}일 누적 ${dir} ${n(c.v)} 이상${c.who === 'both' ? ' (누적 동시)' : ''}`; }
      case 'dropLast': return `${c.basis === 'avg' ? '전체 평단' : c.basis === 'low' ? '가장 낮은 매수가' : '직전 매수가'} 대비 ${n(c.pct)}% 하락 시 추가 매수`;
      case 'tp': return `순번 수익률 +${n(c.pct)}% 도달 시 그 순번 매도`;
      case 'sl': return `순번 손실 -${n(c.pct)}% 도달 시 그 순번 매도`;
      case 'trail': return `고점 대비 ${n(c.pct)}% 하락 시 그 순번 매도`;
      case 'holdDays': return `${n(c.n)}일 보유 후 그 순번 매도`;
      case 'riseLast': return `${c.basis === 'avg' ? '전체 평단' : c.basis === 'low' ? '가장 낮은 매수가' : '직전 매수가'} 대비 ${n(c.pct)}% 상승 시 추가 매수`;
      case 'maGap': return `종가가 ${ma}${n(c.n)}일선보다 ${n(c.pct)}% 이상 ${c.dir === 'above' ? '위' : '아래'}`;
      case 'maAlign': return `${ma}${n(c.s)}·${n(c.m)}·${n(c.l)}일선 ${c.dir === 'down' ? '역배열' : '정배열'}`;
      case 'retN': return `${n(c.n)}일 전 대비 종가 ${n(c.v)}% ${c.op === 'gte' ? '이상' : '이하'}`;
      case 'streakDays': return `${n(c.n)}일 연속 ${c.dir === 'up' ? '상승' : '하락'}`;
      case 'gapOpen': return `시가가 전일 종가보다 ${n(c.pct)}% 이상 ${c.dir === 'up' ? '갭 상승' : '갭 하락'}`;
      case 'fromHigh': return `${n(c.n)}일 고점 대비 ${n(c.pct)}% 이상 하락`;
      case 'fromLow': return `${n(c.n)}일 저점 대비 ${n(c.pct)}% 이상 반등`;
      case 'candle': return `${c.dir === 'down' ? '음봉' : '양봉'} (몸통 ${n(c.pct)}% 이상)`;
      case 'stoch': return `스토캐스틱 %K(${n(c.n)}) ${n(c.v)} ${c.op === 'gte' ? '이상' : '이하'}`;
      case 'bbWidth': return `볼린저 밴드폭(${n(c.n)}일·${n(c.k)}배) ${n(c.v)}% ${c.op === 'gte' ? '이상 (확대)' : '이하 (수축)'}`;
      case 'avgPct': return `평단 대비 ${c.dir === 'down' ? '-' : '+'}${n(c.pct)}% 도달 시 전량 매도`;
      default: return esc((SM.COND_DEFS[c.type] || {}).label || c.type);
    }
  }
  /* ---------- 조건식 빌더: 문장처럼 이어 붙임. 한 층에서는 AND/OR 하나, 섞으려면 괄호(묶기) ---------- */
  const isLeaf = (n) => !!(n && n.type);
  const isDynC = (c) => !!(SM.COND_DEFS[c.type] && SM.COND_DEFS[c.type].dyn);
  const hiddenInTree = (g, it) => g === 'exits' && isLeaf(it) && isDynC(it); // 매도의 순번별·평단 조건(손절·목표 등)은 식 밖에서 도달하면 바로 매도 → 따로 표시
  function dropUnknown(node) { // 지워진 조건(예: 렌코)이 저장된 전략에 남아 있으면 문장에서 뺌
    node.items = node.items.filter((it) => (isLeaf(it) ? !!SM.COND_DEFS[it.type] : true)); node.items.forEach((it) => { if (!isLeaf(it)) dropUnknown(it); }); return node;
  }
  function getSide(g) { const s0 = bt.cfg[g]; if (!s0.expr || !Array.isArray(s0.expr.items)) s0.expr = { op: s0.mode === 'OR' ? 'OR' : 'AND', items: (s0.conds || []).slice() }; dropUnknown(s0.expr); s0.conds = SM.exprLeaves(s0.expr); return s0; }
  function syncSide(g) { const s0 = bt.cfg[g]; s0.conds = SM.exprLeaves(s0.expr); s0.mode = s0.expr.op; }
  const keysOf = (path) => (path === '' || path == null ? [] : String(path).split('.').map(Number));
  function nodeAt(g, path) { let n = getSide(g).expr; for (const k of keysOf(path)) n = n && n.items ? n.items[k] : null; return n; }
  function parentAt(g, path) { const ks = keysOf(path), idx = ks.pop(); return { parent: nodeAt(g, ks.join('.')), idx, ppath: ks.join('.') }; }
  function tidy(node) { // 빈 묶음 제거, 조건이 하나뿐인 묶음은 괄호를 없앰
    node.items = node.items.map((it) => (isLeaf(it) ? it : tidy(it))).filter((it) => isLeaf(it) || it.items.length);
    node.items = node.items.map((it) => (!isLeaf(it) && it.items.length === 1 ? it.items[0] : it));
    return node;
  }
  function leafAtPath(g, path) { const n = nodeAt(g, path); return isLeaf(n) ? n : null; }
  const OPS = { AND: 'AND', OR: 'OR' };
  const pthOf = (path, k) => (path === '' ? String(k) : `${path}.${k}`);
  function leafChip(g, leaf, path) {
    const w = bt.wrap && bt.wrap.g === g, picked = w && bt.wrap.sel.includes(path), open = bt.condOpen === `${g}:${path}`;
    return `<span class="tok ${open ? 'open' : ''} ${picked ? 'picked' : ''}" data-g="${g}" data-path="${path}"><button type="button" class="tok-b" data-act="${w ? 'btSel' : 'btCondOpen'}" data-g="${g}" data-path="${path}" aria-pressed="${open || picked}">${condSummary(leaf)}</button></span>`;
  }
  function renderNode(g, node, path, depth) {
    const kids = node.items.map((it, k) => ({ it, k })).filter(({ it }) => !hiddenInTree(g, it));
    const w = bt.wrap && bt.wrap.g === g;
    const parts = kids.map(({ it, k }, j) => {
      const p = pthOf(path, k), body = isLeaf(it) ? leafChip(g, it, p) : renderNode(g, it, p, depth + 1);
      return (j ? `<button type="button" class="cn ${node.op}" data-act="btOp" data-g="${g}" data-path="${path}" title="눌러서 AND ↔ OR 바꾸기 (이 층의 모든 연결이 같이 바뀝니다)">${OPS[node.op]}</button>` : '') + body;
    }).join('');
    const add = `<button type="button" class="gadd" data-act="btPickOpen" data-g="${g}" data-path="${path}" aria-label="조건 추가">＋</button>`;
    if (path === '') return parts + add;
    const w2 = w && bt.wrap.sel.includes(path);
    return `<span class="grp d${depth % 3} ${w2 ? 'picked' : ''}"><button type="button" class="par o" data-act="${w ? 'btSel' : 'btUngroup'}" data-g="${g}" data-path="${path}" title="${w ? '이 묶음 선택' : '괄호 풀기'}">(</button>${parts}${add}<span class="par c">)</span></span>`;
  }
  function exprPlain(g, node) { // 문장으로 읽는 한 줄: (A and B) or C
    const kids = node.items.filter((it) => !hiddenInTree(g, it)).map((it) => (isLeaf(it) ? condSummary(it) : `( ${exprPlain(g, it)} )`)).filter(Boolean);
    return kids.join(` <b>${node.op === 'OR' ? '또는' : '그리고'}</b> `);
  }
  function editorsHtml(g) { // 값 편집칸: 눌러 둔 조건 하나만 보임(나머지는 숨김)
    const out = [];
    (function walk(node, path) { node.items.forEach((it, k) => { const p = pthOf(path, k); if (isLeaf(it)) { const def = SM.COND_DEFS[it.type]; if (!def) return;
      const fields = def.params.map((q) => q.opts ? `<label class="mini">${q.label}<select class="inp" data-change="btParam" data-g="${g}" data-path="${p}" data-k="${q.k}" data-seg>${opts(q.opts, it[q.k] != null ? it[q.k] : q.def)}</select></label>` : `<label class="mini">${q.label}<input class="inp" data-btp="${g}|${p}|${q.k}" value="${esc(it[q.k] != null ? it[q.k] : q.def)}" inputmode="decimal"></label>`).join('');
      const within = def.dyn ? '' : `<label class="mini">N일 이내<input class="inp" data-btp="${g}|${p}|within" value="${esc(it.within != null ? it.within : 1)}" inputmode="numeric" placeholder="1"><small>1 = 당일만 · 3 = 최근 3일 중 하루라도</small></label>`;
      out.push(`<div class="tok-ed ${bt.condOpen === `${g}:${p}` ? 'show' : ''}" data-g="${g}" data-path="${p}"><div class="tok-edh"><b>${esc(COND_SHORT[it.type] || def.label)}</b><button type="button" class="btn sm danger" data-act="btDel" data-g="${g}" data-path="${p}">삭제</button></div><div class="tok-edb">${fields}${within}</div></div>`); } else walk(it, p); }); })(getSide(g).expr, '');
    return out.join('');
  }
  function indepHtml(g) { // 매도의 독립 조건 목록
    if (g !== 'exits') return '';
    const root = getSide(g).expr, list = root.items.map((it, k) => ({ it, k })).filter(({ it }) => hiddenInTree(g, it));
    if (!list.length) return '';
    return `<div class="indep"><span class="indep-t">그리고 별개로, 도달하면 바로 매도</span>${list.map(({ it, k }) => leafChip(g, it, String(k))).join('')}</div>`;
  }
  function diagHtml(g) { // 신호 진단: 이 조건식이 참인 날 수
    const ds = curDS(); if (!ds) return '';
    const exprSide = getSide(g), st = SM.signalStats(ds.data, exprSide, { use: g === 'exits' ? 'exit' : 'entry', from: bt.cfg.from, to: bt.cfg.to });
    const lab = g === 'entries' ? '매수' : '매도';
    if (st.error) return `<p class="diag warn">${ic('alert')} ${esc(st.error)}</p>`;
    if (st.empty) return '';
    if (!st.leaves.some((x) => !x.dyn)) return g === 'entries' ? `<p class="diag">${ic('info')} 보유 상태에 따라 달라지는 조건만 있어 신호일을 미리 셀 수 없습니다.</p>` : ''; // 하락 시 추가 매수·손절 같은 조건만 있을 때
    const pc = st.days ? ((st.signalDays / st.days) * 100).toFixed(1) : '0';
    const warn = [];
    if (st.signalDays === 0) warn.push(`${lab} 조건식이 이 기간에 한 번도 참이 아닙니다.`);
    else if (st.signalDays < 8) warn.push(`${lab} 신호가 ${st.signalDays}일뿐이라 결과가 우연일 수 있습니다.`);
    for (const gp of st.groups) warn.push(`${gp === '' ? '맨 바깥' : '괄호 안'} AND 조건들이 같은 날 한 번도 겹치지 않습니다. OR로 바꾸거나 값을 느슨하게 하세요.`);
    const lines = st.leaves.map((x) => `<span class="dg">${condSummary(x.leaf)} <b>${x.dyn ? '상태 의존' : x.days + '일'}</b></span>`).join('');
    return `<div class="diag ${warn.length ? 'bad' : ''}"><div class="diag-h">${lab} 신호일 <b>${st.signalDays}일</b> <small>(전체 ${st.days}일 중 ${pc}%${st.first ? ' · 첫 신호 ' + st.first : ''})</small></div>${warn.map((w) => `<p class="diag-w">${ic('alert')} ${esc(w)}</p>`).join('')}<details class="diag-d"><summary>조건별 참인 날</summary><div class="dgs">${lines}${st.hasDyn ? '<small class="muted">상태 의존 조건(하락 시 추가 매수 등)은 보유 상태에 따라 달라져 일수에서 제외했습니다.</small>' : ''}</div></details></div>`;
  }
  function condBox(g) {
    const buy = g === 'entries', side = getSide(g), w = bt.wrap && bt.wrap.g === g;
    const root = side.expr, empty = !root.items.filter((it) => !hiddenInTree(g, it)).length;
    return `<div class="cndbox ${buy ? 'buy' : 'sell'}"><div class="cndbox-h"><b>${buy ? '매수 조건' : '매도 조건'}</b>
        <span class="cndbox-tools">${w ? `<button type="button" class="btn sm primary" data-act="btWrapDo" data-g="${g}">선택 묶기 (${bt.wrap.sel.length})</button><button type="button" class="btn sm" data-act="btWrapToggle" data-g="${g}">취소</button>` : `<button type="button" class="btn sm" data-act="btWrapToggle" data-g="${g}" title="조건 둘 이상을 골라 괄호로 묶음">( ) 묶기</button>`}</span></div>
      <div class="sent" id="sent-${g}">${empty ? `<span class="cnd-empty">${buy ? '조건을 추가하세요 (없으면 매수하지 않음)' : '조건을 추가하세요 (없으면 기간 끝까지 보유)'}</span>` : renderNode(g, root, '', 0)}<span class="sent-sfx">일 때 ${buy ? '매수' : '매도'}</span></div>
      ${w ? '<p class="cnd-help">묶을 조건(또는 괄호)을 같은 층에서 둘 이상 고른 뒤 “선택 묶기”를 누르세요.</p>' : ''}
      ${empty ? `<button type="button" class="cnd-add" data-act="btPickOpen" data-g="${g}" data-path="">＋ ${buy ? '매수' : '매도'} 조건 추가</button>` : ''}
      ${indepHtml(g)}
      ${root.items.filter((it) => !hiddenInTree(g, it)).length > 1 ? `<p class="sent-plain">${exprPlain(g, root)} 일 때 ${buy ? '매수' : '매도'}</p>` : ''}
      <div class="eds">${editorsHtml(g)}</div>${diagHtml(g)}</div>`;
  }
  function pickerHtml() {
    const pk = bt.picker; if (!pk) return '';
    const g = pk.g, want = g === 'entries' ? (d) => d.use !== 'exit' : (d) => d.use !== 'entry', groups = {};
    Object.entries(SM.COND_DEFS).filter(([, d]) => want(d)).forEach(([k, d]) => { (groups[d.group] = groups[d.group] || []).push(k); });
    const names = Object.keys(groups), cur = names.includes(bt.pickGroup) ? bt.pickGroup : names[0];
    return `<div class="sheet-bg" data-act="btPickClose"></div><div class="sheet ${g === 'entries' ? 'buy' : 'sell'}" role="dialog" aria-label="조건 고르기"><div class="sheet-h"><b>${g === 'entries' ? '매수' : '매도'} 조건 고르기</b><button type="button" class="btn sm" data-act="btPickClose">닫기</button></div>
      <div class="chips pick-tabs" role="tablist">${names.map((n) => `<button type="button" class="chip ${n === cur ? 'on' : ''}" data-act="btPickTab" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      <div class="pick-list">${groups[cur].map((k) => `<button type="button" class="pickrow" data-act="btPick" data-t="${k}"><b>${esc(COND_SHORT[k] || SM.COND_DEFS[k].label)}</b><small>${esc(SM.COND_DEFS[k].label)}</small></button>`).join('')}</div></div>`;
  }
  function condRefreshPath(g, path) { // 값을 고치면 문장 속 그 조건의 글자를 바로 갱신
    const c = leafAtPath(g, path); if (!c) return;
    document.querySelectorAll(`.tok[data-g="${g}"][data-path="${path}"] .tok-b`).forEach((el) => { el.innerHTML = condSummary(c); });
    const pl = document.querySelector(`#sent-${g}`); void pl;
    const pe = document.querySelector(`.cndbox.${g === 'entries' ? 'buy' : 'sell'} .sent-plain`); if (pe) pe.innerHTML = `${exprPlain(g, getSide(g).expr)} 일 때 ${g === 'entries' ? '매수' : '매도'}`;
  }

  function dsSelectOptions(ds, keys) {
    const o = (k) => `<option value="${esc(k)}" ${k === bt.datasetId ? 'selected' : ''}>${esc(dsLabel(k, ds[k]))}${ds[k].pending ? ' (선택하면 불러옴)' : ''}</option>`;
    const loc = keys.filter((k) => !isRepoId(k)), rp = keys.filter(isRepoId);
    return (loc.length ? `<optgroup label="내 기기에 저장">${loc.map(o).join('')}</optgroup>` : '') + (rp.length ? `<optgroup label="자동 수집(저장소) · 항상 최신">${rp.map(o).join('')}</optgroup>` : '');
  }
  function repoNote(d) {
    const i = d.info || {}, when = (iso) => { const x = new Date(iso); return Number.isFinite(+x) ? x.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
    const last = d.data ? d.data.d[d.data.d.length - 1] : (i.prices && i.prices.last) || '';
    return `저장소 자동 수집 데이터입니다. 마지막 거래일 <b>${esc(last)}</b>${repo.updatedAt ? ` · 마지막 수집 ${esc(when(repo.updatedAt))}` : ''} · 새 날짜는 수집이 돌 때마다(평일 저녁) 자동으로 늘어납니다.`;
  }
  const WHO3 = [['frgn', '외국인'], ['inst', '기관'], ['indiv', '개인']];
  function flowStatus(ds) {
    if (!ds) return '';
    const inf = SM.dataInfo(ds.data, { from: bt.cfg.from, to: bt.cfg.to });
    const chips = WHO3.map(([k, l]) => { const f = inf.flow[k]; return f ? `<span class="okm">${ic('check')}</span> ${l} <b>${f.count}일</b>` : `<span class="nom">${ic('xmark')}</span> ${l} 없음`; }).join(' · ');
    return `수급: ${chips}${inf.anyFlow ? ` · ${inf.flowFrom} ~ ${inf.flowTo} · ${inf.unit === 'krw' ? '금액(원)' : '수량(주)'}` : ''}`;
  }
  const fmtFlow = (v, unit) => (v == null ? '<span class="muted">-</span>' : (v > 0 ? '+' : '') + fmtNum(unit === 'krw' ? Math.round(v / 1e6) : v, 0) + (unit === 'krw' ? '<small class="muted">백만</small>' : ''));
  function dataInfoCard(ds) {
    if (!ds) return '';
    const inf = SM.dataInfo(ds.data, { from: bt.cfg.from, to: bt.cfg.to });
    const eff = bt.cfg, usesFlow = [].concat(SM.exprLeaves(SM.exprOf(eff.entries)), SM.exprLeaves(SM.exprOf(eff.exits))).some((c) => c.type === 'flow' || c.type === 'flowSum');
    const warn = [];
    if (!inf.anyFlow) warn.push(usesFlow ? '이 데이터에는 수급이 없는데 전략에 수급 조건이 있습니다. 시뮬레이션을 실행하면 오류가 납니다. 위 “자동 수집 시세·수급 불러오기”나 수급 파일로 먼저 합치세요.' : '수급이 없습니다. 외국인·기관 조건을 쓰려면 수급을 합쳐야 합니다.');
    else {
      const head = ds.data.d.filter((d) => d < inf.flowFrom).length, tail = ds.data.d.filter((d) => d > inf.flowTo).length;
      if (head) warn.push(`수급은 ${inf.flowFrom}부터 있습니다. 그 전 ${head}거래일에는 수급이 없어 수급 조건이 거짓으로 처리됩니다.`);
      if (tail) warn.push(`수급은 ${inf.flowTo}까지만 있습니다. 그 뒤 ${tail}거래일은 수급 조건이 거짓으로 처리됩니다.${tail <= 2 ? ' (당일 수급은 장 마감 후 반영되므로 마지막 날이 비는 것은 흔합니다)' : ''}`);
      if (inf.gapDays) warn.push(`수급 구간 안에서도 ${inf.gapDays}거래일은 수급 값이 비어 있습니다(수집을 쉬었거나 파일에 없는 날).`);
      if (usesFlow && inf.range.flowDays < inf.range.days && (head || tail)) warn.push(`시뮬레이션 기간 ${inf.range.days}거래일 중 수급이 있는 날은 ${inf.range.flowDays}일입니다. 기간을 ${inf.range.from > inf.flowFrom ? inf.range.from : inf.flowFrom} ~ ${inf.range.to < inf.flowTo ? inf.range.to : inf.flowTo}로 맞추면 모든 날에 수급 조건이 적용됩니다.`);
      if (inf.unit === 'krw') warn.push('수급 단위가 금액(원)입니다. 수급 조건의 기준값도 원으로 입력하세요. (주 단위로 바꾸려면 파일을 다시 불러올 때 “수량(주)으로 환산”을 고르세요)');
    }
    const flowRows = WHO3.map(([k, l]) => { const f = inf.flow[k]; return `<tr><td>${l}</td><td>${f ? f.count + '일' : '<span class="muted">없음</span>'}</td><td>${f ? f.from + ' ~ ' + f.to : '-'}</td></tr>`; }).join('');
    const rec = inf.recent.slice().reverse();
    const sh = (inf.anyFlow ? `<th>외국인</th><th>기관</th><th>개인</th>` : '');
    return `<details class="box datainfo" ${warn.length ? 'open' : ''}><summary><b>데이터 정보</b> <small class="muted">· 가격 ${inf.days}일${ds.data.splits && ds.data.splits.length ? ` · 분할 보정 ${ds.data.splits.length}건` : ''}${inf.anyFlow ? ` · 수급 ${inf.flowFrom} ~ ${inf.flowTo}` : ' · 수급 없음'}${warn.length ? ` · 확인할 점 ${warn.length}건` : ''}</small></summary>
      ${warn.map((w) => `<p class="hint warn">${ic('alert')} ${esc(w)}</p>`).join('')}
      ${ds.data.splits && ds.data.splits.length ? `<p class="hint">${ic('info')} 액면분할·병합 보정: ${ds.data.splits.map((e) => `${e.date} (${e.factor >= 1 ? e.factor + '분할' : Math.round(1 / e.factor) + '병합'})`).join(', ')} — 그 이전 가격·거래량·수급(주)을 현재 기준으로 맞췄습니다.</p>` : ''}
      <div class="stats-line"><b>가격</b> ${inf.from} ~ ${inf.to} (${inf.days}일) · 시가 ${inf.hasOpen ? '✓' : '✕(종가로 대체)'} · 고가/저가 ${inf.hasHL ? '✓' : '✕(종가로 대체)'} · 거래량 ${inf.hasVol ? '✓' : '✕'}</div>
      <div class="tablewrap"><table class="mini"><thead><tr><th>수급</th><th>값이 있는 날</th><th>구간</th></tr></thead><tbody>${flowRows}</tbody></table></div>
      ${inf.anyFlow ? `<div class="stats-line"><b>단위</b> ${inf.unit === 'krw' ? '금액(원) — 표는 백만 원 단위로 줄여 표시' : '수량(주)'}</div>` : ''}
      <div class="stats-line"><b>최근 ${rec.length}일</b> <small class="muted">(순매수: + 매수, − 매도)</small></div>
      <div class="tablewrap"><table class="mini"><thead><tr><th>날짜</th><th>종가</th><th>거래량</th>${sh}</tr></thead><tbody>${rec.map((r) => `<tr><td>${r.d}</td><td>${fmtNum(r.c, r.c < 100 ? 2 : 0)}</td><td>${r.v == null ? '<span class="muted">-</span>' : fmtNum(r.v, 0)}</td>${inf.anyFlow ? `<td>${fmtFlow(r.frgn, inf.unit)}</td><td>${fmtFlow(r.inst, inf.unit)}</td><td>${fmtFlow(r.indiv, inf.unit)}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`;
  }

  // 달력 계산(재생·기간 버튼용)
  const addMonthsStr = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 10); };
  function rangeChips(cur) {
    const d = cur.data.d, last = d[d.length - 1], c = bt.cfg;
    const act = (m) => (m === 0 ? !c.from && !c.to : c.from && !c.to && (c.from === addMonthsStr(last, -m) || (c.from === d[0] && addMonthsStr(last, -m) < d[0])));
    return `<div class="chips" role="group" aria-label="기간">${[[3, '3개월'], [6, '6개월'], [12, '1년'], [36, '3년'], [0, '전체']].map(([m, l]) => `<button type="button" class="chip ${act(m) ? 'on' : ''}" data-act="btRange" data-v="${m}">${l}</button>`).join('')}</div>`;
  }
  // 물타기 기본 전략: 매수 = 30일선 상승 중 AND 직전 매수가 대비 10% 하락 시 추가 매수, 매도 = 평단 +5% 또는 −20%(별개로 도달하면 바로)
  function presetCfg() {
    const c = SM.blankCfg(); c.qtyMode = 'shares'; c.qty = 10; c.growth = 2; c.maxLots = 5; c.maxInvest = 0; c.cooldown = 0; c.minGap = 0; c.fill = 'nextOpen';
    const tr = newCond('maSlope'); tr.ma = 'sma'; tr.n = 30; tr.k = 5; tr.dir = 'up';
    const dl = newCond('dropLast'); dl.pct = 10; dl.basis = 'last'; dl.first = 'yes';
    const tp = newCond('avgPct'); tp.dir = 'up'; tp.pct = 5; const sl = newCond('avgPct'); sl.dir = 'down'; sl.pct = 20;
    c.entries = { mode: 'AND', conds: [tr, dl], expr: { op: 'AND', items: [tr, dl] } }; c.exits = { mode: 'OR', conds: [tp, sl], expr: { op: 'OR', items: [tp, sl] } };
    return c;
  }
  // 수량·한도: 촘촘한 격자(한 줄에 여러 칸)
  function sgrid(c, mg) {
    const f = (k, label, unit) => `<label class="sg"><span>${label}</span><span class="sgi"><input class="inp" data-btc="${k}" value="${esc(c[k] == null ? '' : c[k])}" inputmode="decimal">${unit ? `<i>${unit}</i>` : ''}</span></label>`;
    const noLimit = !(Number(c.maxLots) > 0) && !(Number(c.maxInvest) > 0);
    return `<div class="sgrid">
      <label class="sg"><span>${mg ? '첫 매수' : '매수 수량'} <select class="sg-u" data-change="btTop" data-k="qtyMode" aria-label="수량 단위"><option value="shares" ${c.qtyMode !== 'amount' ? 'selected' : ''}>주</option><option value="amount" ${c.qtyMode === 'amount' ? 'selected' : ''}>금액</option></select></span><span class="sgi"><input class="inp" data-btc="qty" value="${esc(c.qty)}" inputmode="decimal"></span></label>
      ${f('growth', '수량 배수', '배')}${f('maxLots', '최대 횟수', '회')}${f('maxInvest', '최대 투입금', '원')}${f('cooldown', '청산 후 쉬는 날', '일')}${f('minGap', '매수 간격', '일')}
    </div>${Number(c.growth) > 1 && noLimit ? '<p class="hint warn">배수가 1보다 큰데 최대 횟수·투입금이 모두 0입니다. 하락이 이어지면 투입금이 끝없이 커집니다.</p>' : ''}`;
  }
  /* ---------- 예시 탭: 시험해 본 전략을 조건 문장 그대로 보여 주고, 불러와서 수정 ---------- */
  function exSentence(g, side) {
    const ex = SM.exprOf(side), root = ex, list = []; // 식 안의 조건(문장) + 식 밖의 독립 조건
    const walk = (node) => node.items.filter((it) => !(g === 'exits' && isLeaf(it) && isDynC(it))).map((it) => (isLeaf(it) ? condSummary(it) : `( ${walk(it)} )`)).join(` <b>${node.op === 'OR' ? '또는' : '그리고'}</b> `);
    const main = walk(root), indep = root.items.filter((it) => g === 'exits' && isLeaf(it) && isDynC(it)).map((it) => condSummary(it));
    return `${main}${main && indep.length ? ' <b>그리고 별개로</b> ' : ''}${indep.join(' <b>/</b> ')}`;
  }
  function exampleCards() {
    return SM.EXAMPLES.map((ex) => { const c = ex.mk(); return `<section class="card excard" data-ex="${ex.id}">
      <h4>${esc(ex.name)}</h4><p class="hint">${esc(ex.note)}</p>
      <div class="exsent buy"><b>매수</b> ${exSentence('entries', c.entries)}</div>
      <div class="exsent sell"><b>매도</b> ${exSentence('exits', c.exits)}</div>
      <p class="exset">${c.qtyMode === 'amount' ? '금액' : esc(c.qty) + '주'} · 수량 배수 ${esc(c.growth)}배 · 최대 ${esc(c.maxLots)}회${Number(c.minGap) > 0 ? ' · 매수 간격 ' + esc(c.minGap) + '일' : ''}</p>
      ${ex.res ? `<p class="exres"><b>시험값</b> (전체 기간, 최대 투입금 대비) ${esc(ex.res)}</p>` : ''}
      <div class="btns"><button class="btn primary sm" data-act="btExLoad" data-id="${ex.id}">불러와서 수정하기</button><button class="btn sm" data-act="btExRun" data-id="${ex.id}">이 데이터로 바로 실행</button></div></section>`; }).join('');
  }
  // 예시를 직접 조건 만들기로 불러옴(문장 그대로, 바로 고칠 수 있음). quiet이면 안내 문구 생략
  function loadExample(id, quiet) {
    const ex = SM.EXAMPLES.find((x) => x.id === id); if (!ex) return false;
    const keep = { from: bt.cfg.from, to: bt.cfg.to, market: bt.cfg.market, fill: bt.cfg.fill }, cur = bt.mode === 'example' ? bt.exFrom : bt.mode;
    bt.modeCfg[cur] = bt.cfg; bt.cfg = Object.assign(ex.mk(), keep); bt.modeCfg.custom = bt.cfg; bt.mode = 'custom'; bt.strategyId = ''; bt.condOpen = ''; bt.wrap = null; bt.result = null; bt.val = null;
    A.render(); if (!quiet) toast(`“${ex.name}”을 직접 조건 만들기로 불러왔습니다. 조건을 눌러 수정하세요`); window.scrollTo(0, 0); return true;
  }
  A.renderers.btMain = function () {
    if (!repo.loaded && !repo.loading) setTimeout(() => A.btRepoInit(), 0);
    const ds = allDS(), keys = Object.keys(ds), cur = curDS(), c = bt.cfg;
    const rangeTxt = cur ? `${cur.data.d[0]} ~ ${cur.data.d[cur.data.d.length - 1]} (${cur.data.d.length}일)` : '';
    const st = strategies();
    const imp = bt.imp;
    const importBlock = `<p class="hint">일봉 CSV 파일이나 복사한 표를 읽습니다. 데이터는 이 기기에만 저장됩니다.</p>
      <div class="row gap wrap"><label class="btn file">${ic('download')}파일 선택 (여러 개 가능)<input type="file" multiple accept=".csv,.txt,.tsv,text/csv,text/plain" data-change="btFiles" hidden></label><button class="btn" type="button" data-act="btRepo">${ic('stocks')}자동 수집 데이터를 내 기기에 복사</button>
        <label class="mini">제목 줄 번호<input class="inp" data-btimp="headerLine" value="${esc(imp.headerLine)}" inputmode="numeric" placeholder="자동" style="width:90px"></label></div>
      <label>또는 여기에 붙여 넣기<textarea data-btimp="text" rows="4" placeholder="날짜,시가,고가,저가,종가,거래량&#10;2025-01-02,...">${esc(imp.text)}</textarea></label>
      <div class="btns"><button class="btn primary" data-act="btAnalyze">읽기</button>${imp.an ? '<button class="btn" data-act="btImpCancel">취소</button>' : ''}</div>
      ${imp.an ? impPanel() : ''}
      <div id="dsWarn">${bt.warn.map((w) => `<p class="hint warn">${ic('alert')} ${esc(w)}</p>`).join('')}</div>`;
    const seg = (k, items, v) => `<select data-change="btTop" data-k="${k}" data-seg>${opts(items, v)}</select>`;
    const custom = bt.mode === 'custom';
    return `<div class="sim">
    <div class="ios-seg" role="tablist">${`<button class="${bt.mode === 'mg' ? 'on' : ''}" data-act="btMode2" data-v="mg">물타기 전략</button><button class="${custom ? 'on' : ''}" data-act="btMode2" data-v="custom">직접 조건 만들기</button><button class="${bt.mode === 'example' ? 'on' : ''}" data-act="btMode2" data-v="example">예시</button>`}</div>
    ${bt.mode === 'example' ? `<h3 class="sim-h">예시 전략 <small>시험해 본 조건 · 불러와서 수정</small></h3><p class="hint">불러오면 직접 조건 만들기에서 문장의 조건을 눌러 바로 고칠 수 있습니다. 시험값은 과거 4개 종목 결과라 앞으로를 보장하지 않습니다.</p>${exampleCards()}` : ''}
    <h3 class="sim-h">① 종목과 기간</h3>
    <section class="card">
      ${keys.length ? `<div class="ios-list">
        <label class="ios-row"><span>데이터</span><span class="rowr"><select class="inp" data-change="btDS">${dsSelectOptions(ds, keys)}</select></span></label>
        ${cur ? `<div class="ios-row"><span>기간</span><span class="rowr muted">${rangeTxt}</span></div>` : ''}
      </div>
      ${cur ? rangeChips(cur) : ''}
      <div class="grid2"><label>시작일<input type="date" data-btc="from" value="${c.from}"></label><label>종료일<input type="date" data-btc="to" value="${c.to}"></label></div>
      ${bt.datasetId && !cur && isRepoId(bt.datasetId) ? '<p class="hint">저장소에서 불러오는 중…</p>' : ''}${cur && cur.repo ? `<p class="hint">${ic('info')} ${repoNote(cur)}</p>` : ''}${dataInfoCard(cur)}` : '<p class="muted">불러온 데이터가 없습니다. 아래 “데이터 불러오기”에서 자동 수집 시세를 복사하거나 CSV 파일을 읽으세요.</p>'}
      <details class="box" ${keys.length ? '' : 'open'}><summary>데이터 불러오기 · 관리 <small class="muted">(CSV·붙여 넣기·자동 수집)</small></summary>
        ${importBlock}
        ${A.getState().stocks.length ? `<h4>내 종목에 데이터 연결</h4>${stockPickHtml()}` : ''}
        ${keys.length ? `<div class="row gap wrap">${cur && cur.repo ? '' : '<button class="btn sm danger" data-act="btDSDel">선택한 데이터 삭제</button>'}${repo.list.length ? `<button class="btn sm" type="button" data-act="btRepoRefresh">${ic('download')}저장소 새로고침</button>` : ''}</div>` : ''}
      </details>
    </section>
    ${bt.mode !== 'example' ? `
    <h3 class="sim-h">② 전략 <small>${custom ? '조건을 직접 조합 (비어 있음)' : '물타기 기본값 · 조건은 바꿔 쓰세요'}</small></h3>
    <section class="card">
      <div class="stratsave" aria-label="전략 저장·불러오기">
        <div class="stratbar"><select class="inp" data-change="btStratPick"><option value="">저장된 전략 불러오기…</option>${st.map((x) => `<option value="${x.id}" ${bt.strategyId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <input id="stratName" class="inp" placeholder="전략 이름" value="${esc((st.find((x) => x.id === bt.strategyId) || {}).name || '')}">
          <button class="btn sm primary" data-act="btStratSave">저장</button>${bt.strategyId ? '<button class="btn sm danger" data-act="btStratDel">삭제</button>' : ''}<button class="btn sm" data-act="btStratNew">새로 만들기</button></div>
      </div>
      ${sgrid(c, !custom)}
      ${condBox('entries')}${condBox('exits')}
      <div class="btns">${custom ? '' : '<button class="btn sm" data-act="btPreset">물타기 기본값으로 되돌리기</button>'}</div>
      <details class="box"><summary>고급 설정 <small class="muted">(체결 방식 · 수수료 · 기간 분할 검증)</small></summary>
        <div class="ios-list">
          <div class="ios-row stack"><span>체결 방식</span><span class="rowr">${seg('fill', [['nextOpen', '다음 날 시가'], ['close', '당일 종가']], c.fill)}</span></div>
          <div class="ios-row stack"><span>수수료·세금 기준</span><span class="rowr">${seg('market', [['KR', '국내'], ['US', '해외']], c.market)}</span></div>
        </div>
        

      <div class="box2"><label class="chk"><input type="checkbox" data-change="btValidate" ${bt.validate ? 'checked' : ''}> <b>기간 분할 검증</b> — 앞 구간에서 만든 전략이 뒤 구간에서도 통하는지 확인</label>
        ${bt.validate ? `<div class="row gap wrap"><label class="mini">앞 구간 비율 %<input class="inp" data-btsplit="1" value="${bt.splitPct}" inputmode="numeric" style="width:90px"></label><span class="hint">전체 기간의 앞 ${bt.splitPct}%를 “설정용”, 나머지를 “검증용”으로 나눠 각각 돌립니다.</span></div>` : '<p class="hint">조건과 숫자를 마음껏 바꾸다 보면 과거에만 딱 맞는 설정이 만들어지기 쉽습니다. 이 옵션을 켜면 설정하지 않은 구간에서의 결과를 함께 보여줍니다.</p>'}</div>
      </details>
    </section>
    <div class="btns runrow"><button class="btn primary runbtn" data-act="btRun" ${cur ? '' : 'disabled'}>시뮬레이션 실행</button>${st.length ? `<button class="btn" data-act="btCmp" ${cur ? '' : 'disabled'}>저장된 전략 모두 비교 (${st.length}개)</button>` : ''}${Object.keys(ds).length > 1 ? `<button class="btn" data-act="btAll" ${bt.allBusy ? 'disabled' : ''}>${bt.allBusy ? '돌리는 중…' : `모든 데이터에 같은 전략 비교 (${Object.keys(ds).length}개)`}</button>` : ''}</div>` : ''}
    ${bt.all ? allHtml() : ''}${bt.cmp ? cmpHtml() : ''}${bt.val ? valHtml() : ''}${bt.result ? resultHtml() : ''}${pickerHtml()}</div>`;
  };

  /* ---------- 불러오기 패널(열 지정 · 미리보기 · 저장 위치) ---------- */
  const COL_LABELS = [['date', '날짜'], ['close', '종가'], ['open', '시가'], ['high', '고가'], ['low', '저가'], ['volume', '거래량'], ['adj', '수정종가(선택)'], ['frgn', '외국인 순매수'], ['inst', '기관 순매수'], ['indiv', '개인 순매수']];
  const KIND_TXT = { price: '가격 데이터', flow: '수급 데이터(외국인·기관·개인)', both: '가격 + 수급 데이터', unknown: '형식을 알 수 없음 — 아래에서 열을 지정하세요' };
  function impPreview(imp) {
    const an = imp.an, kind = SM.kindOf(an.cols);
    if (kind === 'price' || kind === 'both') return { kind, build: SM.buildDataset(an.table, an.cols, { useAdj: imp.useAdj, unit: imp.unit }) };
    if (kind === 'flow') {
      const dsAll = loadDS(), tgt = dsAll[imp.destId];
      if (!tgt) return { kind, note: '수급은 기존 가격 데이터에 합칩니다. 먼저 가격 데이터를 저장하거나 아래에서 합칠 데이터를 고르세요.' };
      const m = SM.mergeFlow(tgt.data, an.table, an.cols, { unit: imp.unit });
      return { kind, flow: m, tgt };
    }
    return { kind };
  }
  function impPanel() {
    const imp = bt.imp, an = imp.an, hdr = an.table.header, ds = loadDS(), keys = Object.keys(ds);
    const pv = impPreview(imp), kind = pv.kind;
    const sumTxt = (SM.kindOf(an.cols) !== 'unknown' && Array.isArray(an.cols.instSum) && an.cols.instSum.length) ? `(합산: ${an.cols.instSum.map((j) => hdr[j]).join('+')})` : '(없음)';
    const sel = (k, label) => `<label class="mini">${label}<select class="inp" data-change="btImpCol" data-k="${k}"><option value="-1">${k === 'inst' ? esc(sumTxt) : '(없음)'}</option>${hdr.map((h, i) => `<option value="${i}" ${an.cols[k] === i ? 'selected' : ''}>${i + 1}. ${esc(h || '(빈 칸)')}</option>`).join('')}</select></label>`;
    let summary = '';
    if (pv.build) {
      if (pv.build.error) summary = `<p class="hint warn">${ic('alert')} ${esc(pv.build.error)}</p>`;
      else {
        const d = pv.build.data, mn = Math.min(...d.c), mx = Math.max(...d.c);
        const last = d.d.length - 1, pick = [0, 1, 2, last - 2, last - 1, last].filter((i, j, a2) => i >= 0 && i <= last && a2.indexOf(i) === j);
        const f = (v) => (v == null ? '' : fmtNum(v, Math.abs(v) < 100 ? 2 : 0));
        summary = `<div class="stats-line"><b>${pv.build.count}일</b> · ${d.d[0]} ~ ${d.d[last]} · 종가 ${fmtNum(mn, mn < 100 ? 2 : 0)} ~ ${fmtNum(mx, mx < 100 ? 2 : 0)}${d.frgn || d.inst || d.indiv ? ' · 수급 포함' : ''}</div>
          ${pv.build.warnings.map((w) => `<p class="hint warn">${ic('alert')} ${esc(w)}</p>`).join('')}
          <div class="tablewrap"><table class="mini"><thead><tr><th>날짜</th><th>시가</th><th>고가</th><th>저가</th><th>종가</th><th>거래량</th>${d.frgn ? '<th>외국인</th>' : ''}${d.inst ? '<th>기관</th>' : ''}${d.indiv ? '<th>개인</th>' : ''}</tr></thead><tbody>${pick.map((i) => `<tr><td>${d.d[i]}</td><td>${f(d.o[i])}</td><td>${f(d.h[i])}</td><td>${f(d.l[i])}</td><td>${f(d.c[i])}</td><td>${f(d.v[i])}</td>${d.frgn ? `<td>${f(d.frgn[i])}</td>` : ''}${d.inst ? `<td>${f(d.inst[i])}</td>` : ''}${d.indiv ? `<td>${f(d.indiv[i])}</td>` : ''}</tr>`).join('')}</tbody></table></div><p class="hint">처음 3일과 마지막 3일입니다. 증권사 화면과 같은 날짜의 값이 맞는지 한두 개는 직접 대조하세요.</p>`;
      }
    } else if (pv.flow) {
      summary = pv.flow.error ? `<p class="hint warn">${ic('alert')} ${esc(pv.flow.error)}</p>` : `<div class="stats-line"><b>${pv.flow.matched}일</b>이 가격 데이터와 맞았습니다${pv.flow.unmatched ? ` · 가격 데이터에 없는 날짜 ${pv.flow.unmatched}일은 제외` : ''}${pv.flow.missing ? ` · 수급이 비는 거래일 ${pv.flow.missing}일` : ''}</div>`;
    } else if (pv.note) summary = `<p class="hint warn">${ic('alert')} ${esc(pv.note)}</p>`;
    const canNew = kind === 'price' || kind === 'both';
    const dest = canNew ? imp.dest : 'merge';
    const mergeSel = keys.length ? `<select class="inp" data-change="btImpDest" data-k="destId" style="max-width:260px">${opts(keys.map((k) => [k, dsLabel(k, ds[k])]), imp.destId)}</select>` : '<span class="muted">(저장된 데이터 없음)</span>';
    return `<div class="box"><b>읽은 결과: ${KIND_TXT[kind]}</b> <small class="muted">· ${an.table.rows.length}행${imp.fileNames.length > 1 ? ` · 파일 ${imp.fileNames.length}개` : ''}${an.fromSaved ? ' · 이전에 지정한 열 설정을 불러왔습니다' : ''}</small>
      <div class="colgrid">${COL_LABELS.map(([k, l]) => sel(k, l)).join('')}</div>
      ${(an.cols.frgn >= 0 || an.cols.inst >= 0 || an.cols.indiv >= 0 || (an.cols.instSum && an.cols.instSum.length)) ? (() => { const det = imp.unit === 'krwToShares' ? 'shares' : (pv.build && pv.build.data && pv.build.data.flowUnit) || (pv.flow && pv.flow.unit) || 'shares'; return `<label class="mini">수급 값의 단위<select class="inp" data-change="btImpUnit" style="max-width:260px"><option value="" ${imp.unit === '' ? 'selected' : ''}>자동 판단 (지금: ${det === 'krw' ? '금액(원)' : '수량(주)'})</option><option value="shares" ${imp.unit === 'shares' ? 'selected' : ''}>수량(주)</option><option value="krw" ${imp.unit === 'krw' ? 'selected' : ''}>금액(원) 그대로</option><option value="krwToShares" ${imp.unit === 'krwToShares' ? 'selected' : ''}>금액(원) → 수량(주)으로 환산해 저장 (종가 기준)</option></select></label>${det === 'krw' ? '<p class="hint">금액 단위 수급은 시뮬레이션 조건의 기준값도 <b>원</b>으로 입력해야 합니다. (예: 10억 원 = 1000000000) 자동 수집(네이버, 주 단위)과 한 데이터에 이어 쓰려면 위에서 “수량(주)으로 환산”을 고르세요.</p>' : imp.unit === 'krwToShares' ? '<p class="hint">금액을 그날 종가로 나눠 주 수로 바꿉니다. 실제 체결가와 종가가 달라 대략 1% 이내의 오차가 있습니다.</p>' : ''}`; })() : ''}
      ${an.cols.adj >= 0 ? `<label class="chk"><input type="checkbox" data-change="btImpAdj" ${imp.useAdj ? 'checked' : ''}> 수정종가 기준으로 시/고/저/종가 보정</label>` : ''}
      ${summary}
      ${kind !== 'unknown' ? `<h4>저장 위치</h4>
        ${imp.autoNote ? `<p class="hint">${ic('bulb')} ${esc(imp.autoNote)}</p>` : '<p class="hint">같은 종목의 다른 기간 데이터라면 “기존 데이터에 이어붙이기”를 선택하세요.</p>'}
        ${canNew ? `<label class="chk"><input type="radio" name="impDest" value="new" data-change="btImpDest" data-k="dest" ${dest === 'new' ? 'checked' : ''}> 새 데이터로 저장</label>
        ${dest === 'new' ? `<div class="grid2"><label>데이터 이름<input class="inp" data-btimp="name" value="${esc(imp.name)}" placeholder="예: 한국전력"></label><label>시장 (수수료율 기준)<select class="inp" data-change="btImpDest" data-k="market" data-seg>${opts([['KR', '국내'], ['US', '해외']], imp.market)}</select></label><label>연결할 종목 <small class="muted">(선택)</small><select class="inp" data-change="btImpDest" data-k="stockId">${stockOptions(imp.stockId)}</select></label></div>` : ''}` : ''}
        <label class="chk"><input type="radio" name="impDest" value="merge" data-change="btImpDest" data-k="dest" ${dest === 'merge' ? 'checked' : ''} ${keys.length ? '' : 'disabled'}> 기존 데이터에 ${kind === 'flow' ? '수급 합치기' : '이어붙이기(같은 날짜는 새 값으로 덮어씀)'}</label>
        ${dest === 'merge' ? `<div class="row gap wrap">${mergeSel}</div>` : ''}
        <div class="btns"><button class="btn primary" data-act="btImpSave">저장</button></div>` : ''}</div>`;
  }

  function summaryRow(name, r, cur) {
    if (r.error) return `<tr><td>${name}</td><td colspan="7" class="muted">${esc(r.error)}</td></tr>`;
    const s = r.summary;
    return `<tr><td data-label="구간"><span class="v">${name}</span></td><td data-label="기간"><span class="v">${r.cfg.from} ~ ${r.cfg.to}</span></td><td data-label="매수/청산"><span class="v">${s.buyCount}/${s.closed}</span></td><td data-label="총 손익"><span class="v">${money(s.total, cur)}</span></td><td data-label="수익률"><span class="v">${pct(s.retOnPeak)}</span></td><td data-label="단순 보유"><span class="v">${s.bh ? pct(s.bh.ret) : '-'}</span></td><td data-label="최대 낙폭"><span class="v">${fmtMoney(s.mdd, cur)}</span></td></tr>`;
  }
  function valHtml() {
    const v = bt.val, cur = bt.cfg.market === 'US' ? 'USD' : 'KRW';
    const a = v.a, b = v.b;
    let msg = '';
    if (!a.error && !b.error && a.summary.retOnPeak != null && b.summary.retOnPeak != null) {
      const ba = a.summary.bh ? a.summary.bh.ret : null, bb = b.summary.bh ? b.summary.bh.ret : null;
      msg = `설정 구간 수익률 ${fmtPct(a.summary.retOnPeak)}${ba != null ? ` (단순 보유 ${fmtPct(ba)})` : ''} → 검증 구간 ${fmtPct(b.summary.retOnPeak)}${bb != null ? ` (단순 보유 ${fmtPct(bb)})` : ''}. `;
      msg += (a.summary.retOnPeak > 0 && b.summary.retOnPeak <= 0) ? '설정 구간에서는 이익이었지만 검증 구간에서는 이익이 나지 않았습니다. 과거에 맞춘 설정일 수 있습니다.' : (b.summary.retOnPeak > 0 && (bb == null || b.summary.retOnPeak > bb)) ? '검증 구간에서도 이익이고 단순 보유보다 높았습니다. 그래도 구간이 한 번뿐이라 다른 종목·기간에서도 확인하세요.' : '두 구간의 결과를 단순 보유와 함께 비교해서 판단하세요.';
    }
    return `<section class="card"><h2>기간 분할 검증</h2><div class="tablewrap"><table><thead><tr><th>구간</th><th>기간</th><th>매수/청산</th><th>총 손익</th><th>수익률</th><th>단순 보유</th><th>최대 낙폭</th></tr></thead><tbody>${summaryRow('설정용(앞)', a, cur)}${summaryRow('검증용(뒤)', b, cur)}</tbody></table></div><p class="verdict">${msg}</p></section>`;
  }
  // 모든 데이터(종목)에 지금 전략을 돌려 한 표로: 총손익·최대 투입금·수익률·단순 보유·앞/뒤 기간 분할
  function allHtml() {
    const a = bt.all, sm = SM.summarizeMulti(a.rows), cur = a.cur, pc = (v) => (v == null ? '-' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`), cl = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');
    const rows = a.rows.map((r) => r.error ? `<tr><td data-label="종목"><span class="v">${esc(r.name)}</span></td><td colspan="8" class="muted">${esc(r.error)}</td></tr>`
      : `<tr><td data-label="종목"><span class="v">${esc(r.name)}</span><small class="muted">${esc(r.range)}</small></td><td data-label="매수"><span class="v">${r.buys}회</span></td><td data-label="사이클"><span class="v">${r.cycles}${r.loss ? ` <small class="neg">손실 ${r.loss}</small>` : ''}</span></td><td data-label="총손익"><span class="v ${cl(r.total)}">${fmtMoney(r.total, cur)}</span></td><td data-label="최대 투입금"><span class="v">${fmtMoney(r.peak, cur)}</span></td><td data-label="수익률"><span class="v ${cl(r.ret)}">${pc(r.ret)}</span></td><td data-label="단순 보유"><span class="v">${pc(r.bh)}</span></td><td data-label="앞 구간"><span class="v ${cl(r.ret1)}">${pc(r.ret1)}</span></td><td data-label="뒤 구간"><span class="v ${cl(r.ret2)}">${pc(r.ret2)}</span></td></tr>`).join('');
    return `<h3 class="sim-h">종목 일괄 비교 <small>지금 전략을 모든 데이터에 같은 조건으로</small></h3><section class="card">
      <div class="cards cards4"><div class="stat"><span>이익 난 종목</span><b>${sm.win} / ${sm.ran}</b><small>총손익 기준</small></div><div class="stat"><span>수익률 중앙값</span><b>${pc(sm.medRet)}</b><small>최대 투입금 대비</small></div><div class="stat"><span>뒤 구간에서도 이익</span><b>${sm.lateWin} / ${sm.tested}</b><small>앞 70%·뒤 30% 분할</small></div><div class="stat"><span>단순 보유보다 나음</span><b>${sm.beatBh} / ${sm.withBh}</b><small>수익률 비교</small></div></div>
      <div class="tablewrap"><table class="cmp"><thead><tr><th>종목</th><th>매수</th><th>사이클</th><th>총손익</th><th>최대 투입금</th><th>수익률</th><th>단순 보유</th><th>앞 구간</th><th>뒤 구간</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint warn">설정을 바꿔 가며 여러 번 비교해 가장 좋은 것을 고르면 과거에만 맞춘 설정이 되기 쉽습니다. 종목 수가 적으면 결과가 우연일 수 있습니다.</p></section>`;
  }
  function cmpHtml() {
    const cur = bt.cmpCur || 'KRW';
    return `<section class="card"><h2>전략 비교 <small class="muted">(같은 데이터·기간·체결 방식)</small></h2><div class="tablewrap"><table><thead><tr><th>전략</th><th>매수</th><th>청산/보유</th><th>총 손익</th><th>수익률(최대 투입 대비)</th><th>최대 낙폭</th><th>수수료·세금</th><th>단순 보유</th></tr></thead><tbody>
      ${bt.cmp.map((r) => r.res.error ? `<tr><td>${esc(r.name)}</td><td colspan="7" class="muted">${esc(r.res.error)}</td></tr>` : `<tr><td data-label="전략"><span class="v">${esc(r.name)}</span></td><td data-label="매수"><span class="v">${r.res.summary.buyCount}</span></td><td data-label="청산/보유"><span class="v">${r.res.summary.closed}/${r.res.summary.open}</span></td><td data-label="총 손익"><span class="v">${money(r.res.summary.total, cur)}</span></td><td data-label="수익률"><span class="v">${pct(r.res.summary.retOnPeak)}</span></td><td data-label="최대 낙폭"><span class="v">${fmtMoney(r.res.summary.mdd, cur)}</span></td><td data-label="수수료"><span class="v">${fmtMoney(r.res.summary.fees, cur)}</span></td><td data-label="단순 보유"><span class="v">${r.res.summary.bh ? pct(r.res.summary.bh.ret) : '-'}</span></td></tr>`).join('')}
      </tbody></table></div><p class="hint">단순 보유: 전략의 최대 투입금과 같은 금액을 첫 매수일에 한 번에 사서 끝까지 보유했을 때의 수익률입니다. 전략이 이 수치보다 낮다면 그냥 보유하는 편이 나았다는 뜻입니다.</p></section>`;
  }
  function resultHtml() {
    const r = bt.result, s = r.summary, cur = r.cfg.market === 'US' ? 'USD' : 'KRW';
    const data = (allDS()[bt.datasetId] || {}).data;
    if (!data) return '';
    const bh = s.bh, cs = r.cycleStats, hasCyc = cs.count > 0 || !!r.openCycle;
    const verdict = bh ? (s.retOnPeak > bh.ret ? `이 기간에는 전략(${fmtPct(s.retOnPeak)})이 단순 보유(${fmtPct(bh.ret)})보다 높았습니다.` : `이 기간에는 단순 보유(${fmtPct(bh.ret)})가 전략(${fmtPct(s.retOnPeak)})보다 같거나 높았습니다.`) : '매수 신호가 없어 비교할 수 없습니다.';
    const stat = (label, val, sub, cls) => `<div class="stat"><span>${label}</span><b class="${cls || ''}">${val}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
    return `<h3 class="sim-h">③ 결과 <small>${data.d[r.startIdx]} ~ ${data.d[r.endIdx]}</small></h3>
    <section class="card chartfirst">
      ${rpHtml()}
      ${A.chartSection ? A.chartSection(null, `<div id="rpState" class="rp rp-statebox" ${rp.on ? '' : 'hidden'}>${rp.on ? rpStateHtml() : ''}</div>`) : '<canvas id="btCandle" class="chart"></canvas>'}
      <p class="hint"><b>B</b> 매수 (아래 숫자 = 사이클-순서) · <b>S</b> 전량 매도 (수익률) · 주황선 평단 · 초록 점선 목표가</p>
    </section>
    <section class="card">
      <div class="cards cards4">
        ${stat('총 손익', money(s.total, cur), `실현 ${fmtMoney(s.realized, cur)} · 평가 ${fmtMoney(s.unrealized, cur)}`)}
        ${stat('수익률', pct(s.retOnPeak), '최대 투입금 대비')}
        ${stat('최대 투입금', fmtMoney(s.peakInvested, cur), s.skipped ? `한도로 건너뛴 매수 ${s.skipped}회` : '')}
        ${stat('최대 낙폭', fmtMoney(s.mdd, cur), `최저 누적손익 ${fmtMoney(s.minEq, cur)}`)}
      </div>
      <p class="verdict">${verdict}</p>
      <details class="box"><summary>그 밖의 지표</summary><div class="cards">
        ${stat('단순 보유 수익률', bh ? pct(bh.ret) : '-', bh ? bh.startDate + ' 매수 가정' : '')}
        ${stat('매수 / 청산 / 보유중', `${s.buyCount} / ${s.closed} / ${s.open}`, `${s.winRate != null ? `청산 건 승률 ${(s.winRate * 100).toFixed(0)}%` : ''}${s.avgDays != null ? ` · 평균 보유 ${s.avgDays.toFixed(0)}일` : ''}`)}
        ${stat('수수료·세금 합계', fmtMoney(s.fees, cur), '')}
      </div></details>
      ${cycleSection(r, cur)}
      <p class="hint warn">과거 결과일 뿐입니다. 다른 종목·기간에서도 확인하세요.</p>
    </section>
    <section class="card"><h4>누적 손익 곡선 <small class="muted">(실현 + 평가)</small></h4><canvas id="btEquity" class="chart"></canvas></section>
    <section class="card"><details class="box" ${hasCyc ? '' : 'open'}><summary><b>청산된 순번</b> <small class="muted">${r.trades.length}건 · 순번(매수 한 건)별 매도 결과</small></summary>${r.trades.length ? `<div class="tablewrap"><table><thead><tr><th>순번</th><th>매수일</th><th>매수가</th><th>매도일</th><th>매도가</th><th>수량</th><th>손익</th><th>수익률</th><th>보유일</th><th>사유</th></tr></thead><tbody>
      ${r.trades.map((t) => `<tr><td data-label="순번"><span class="v">${t.no}번</span></td><td data-label="매수일"><span class="v">${t.buyDate}</span></td><td data-label="매수가"><span class="v">${fmtNum(t.buyPrice, 2)}</span></td><td data-label="매도일"><span class="v">${t.sellDate}</span></td><td data-label="매도가"><span class="v">${fmtNum(t.sellPrice, 2)}</span></td><td data-label="수량"><span class="v">${fmtNum(t.qty, t.qty % 1 ? 2 : 0)}</span></td><td data-label="손익"><span class="v ${t.pnl >= 0 ? 'pos' : 'neg'}">${fmtMoney(t.pnl, cur)}</span></td><td data-label="수익률"><span class="v">${pct(t.ret)}</span></td><td data-label="보유일"><span class="v">${t.days}일</span></td><td data-label="사유"><span class="v">${esc(t.reason || '')}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">청산된 순번이 없습니다 (매도 조건이 없거나 아직 충족되지 않음).</p>'}</details></section>`;
  }
  /* ---------- 재생(리플레이): 고른 구간을 실제 차트처럼 하루씩(또는 한 주씩) 움직여 봅니다 ---------- */
  const rp = bt.rp || (bt.rp = { on: false, sel: false, open: false, playing: false, start: '', end: '', cur: '', speed: 2, unit: 'day', timer: null });
  const rpMonday = (d) => { const t = new Date(d + 'T00:00:00Z'), k = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - k); return t.toISOString().slice(0, 10); };
  function rpData() { const r = bt.result, ds = allDS()[bt.datasetId]; return r && ds && ds.data ? { r, data: ds.data } : null; }
  function rpIdx(date) { const x = rpData(); if (!x) return -1; let t = -1; for (let i = 0; i < x.data.d.length && x.data.d[i] <= date; i++) t = i; return t; }
  function rpInit() { // 결과가 바뀌면 기본 구간: 결과 끝에서 약 3주 전 ~ 끝
    const x = rpData(); if (!x) return; const { r, data } = x, lo = data.d[r.startIdx], hi = data.d[r.endIdx];
    if (!rp.start || rp.start < lo || rp.start > hi) rp.start = data.d[Math.max(r.startIdx, r.endIdx - 15)];
    if (!rp.end || rp.end <= rp.start || rp.end > hi) rp.end = hi;
    if (rp.cur < rp.start || rp.cur > rp.end) rp.cur = rp.start;
  }
  function rpStateHtml() {
    const x = rpData(); if (!x) return ''; const { r, data } = x, st = SM.replayState(r, data, rp.cur), cur = r.cfg.market === 'US' ? 'USD' : 'KRW';
    if (!st) return '<p class="muted">이 날짜 이전 데이터가 없습니다.</p>';
    const ev = st.today.map((e) => (e.t === 'buy' ? `<span class="ev buy">B ${e.label} 매수 ${fmtNum(e.price, 2)} × ${fmtNum(e.qty, 0)}주</span>` : `<span class="ev sell">S 매도 ${fmtNum(e.price, 2)} × ${fmtNum(e.qty, 0)}주 (${fmtMoney(e.pnl, cur)})</span>`)).join('');
    return `<div class="rp-date"><b>${st.date}</b><span>종가 ${fmtNum(st.close, 2)}</span>${st.cyc ? `<span>${st.cyc}사이클 · ${st.buyCount}번째 매수까지</span>` : '<span class="muted">보유 없음</span>'}</div>
      <div class="rp-grid"><div><small>보유</small><b>${st.qty ? fmtNum(st.qty, 0) + '주' : '-'}</b></div><div><small>평단</small><b>${st.avg ? fmtNum(st.avg, 2) : '-'}</b></div><div><small>투입금</small><b>${st.qty ? fmtMoney(st.cost, cur) : '-'}</b></div>
        <div><small>평가손익</small><b class="${st.unrealized >= 0 ? 'pos' : 'neg'}">${st.qty ? fmtMoney(st.unrealized, cur) + (st.avg ? ` (${(((st.close / st.avg) - 1) * 100).toFixed(1)}%)` : '') : '-'}</b></div><div><small>실현손익</small><b class="${st.realized >= 0 ? 'pos' : 'neg'}">${fmtMoney(st.realized, cur)}</b></div><div><small>완료 사이클</small><b>${st.cyclesDone}번</b></div></div>
      ${ev ? `<div class="rp-ev">${ev}</div>` : ''}`;
  }
  function rpInner() {
    const x = rpData(); if (!x) return '';
    const { data } = x, si = rpIdx(rp.start), ei = rpIdx(rp.end), ci = rpIdx(rp.cur);
    if (!rp.on) return `<div class="rp-off">
      <div class="rp-row"><button type="button" class="btn selbtn ${rp.sel ? 'cancel' : ''}" data-act="rpSel" aria-pressed="${rp.sel}">${rp.sel ? '구간 지정 취소' : '<span class="se-ico"><i class="s">S</i><i class="ar">⟷</i><i class="e">E</i></span> 재생 구간 지정'}</button>
        <button type="button" class="btn primary" data-act="rpStart">▶ 재생</button></div>
      <div class="rp-row"><span class="rp-rng"><input type="date" data-rp="start" value="${rp.start}" aria-label="재생 시작일"><i>~</i><input type="date" data-rp="end" value="${rp.end}" aria-label="재생 종료일"></span>
        ${rp.sel ? '<span class="rp-se"><button type="button" class="se s" data-act="rpSetS" title="차트에서 고른 날짜를 시작으로">S 지정</button><button type="button" class="se e" data-act="rpSetE" title="차트에서 고른 날짜를 끝으로">E 지정</button></span>' : ''}</div>
      ${rp.sel ? `<canvas id="rpTimeline" class="rp-tl" aria-label="재생 구간 선택 막대"></canvas><span class="rp-hint">막대의 <b>S</b>·<b>E</b>를 끌거나, 차트에서 날짜를 고른 뒤 S·E 지정을 누르세요.</span>` : '<span class="rp-hint">날짜를 넣어 바로 재생하거나, “재생 구간 지정”으로 전체 막대에서 시작·끝을 고르세요.</span>'}</div>`;
    return `<div class="rp-bar">
        <button type="button" class="rpb" data-act="rpRestart" title="처음으로" aria-label="처음으로">⏮</button><button type="button" class="rpb" data-act="rpStep" data-v="-1" title="뒤로" aria-label="한 봉 뒤로">◀</button>
        <button type="button" class="rpb play" data-act="rpPlay" id="rpPlayBtn" aria-label="${rp.playing ? '일시정지' : '재생'}">${rp.playing ? '⏸' : '▶'}</button><button type="button" class="rpb" data-act="rpStep" data-v="1" title="앞으로" aria-label="한 봉 앞으로">▶❘</button>
        <button type="button" class="rpb stop" data-act="rpEnd" title="재생 끝내고 전체 보기">■ 종료</button></div>
      <div class="rp-opts"><span class="rp-se"><button type="button" class="se s" data-act="rpSetS" title="차트에서 고른 날짜를 시작으로">S 지정</button><button type="button" class="se e" data-act="rpSetE" title="차트에서 고른 날짜를 끝으로">E 지정</button></span><span class="chips" aria-label="배속">${[1, 2, 5, 10, 30].map((v) => `<button type="button" class="chip ${rp.speed === v ? 'on' : ''}" data-act="rpSpeed" data-v="${v}">${v}×</button>`).join('')}</span>
        <span class="chips" aria-label="한 번에 움직이는 단위">${[['day', '하루씩'], ['week', '한 주씩']].map(([k, l]) => `<button type="button" class="chip ${rp.unit === k ? 'on' : ''}" data-act="rpUnit" data-v="${k}">${l}</button>`).join('')}</span></div>
      <canvas id="rpTimeline" class="rp-tl" aria-label="재생 구간과 진행 위치(S·E 손잡이를 끌어 구간 수정)"></canvas>
      <input type="range" class="rp-slider" id="rpSlider" data-rp="slider" min="${si}" max="${ei}" value="${ci}" aria-label="재생 위치"><div class="rp-lbl"><span>${data.d[si]}</span><span>${data.d[ei]}</span></div>`;
  }
  /* ---- 구간 선택 타임라인(영상 편집기처럼): 전체 기간의 종가 선 위에 S·E 손잡이를 끌어 재생 구간을 정함 ---- */
  const TL = { L: 12, R: 12, H: 58 };
  function rpDrawTL() {
    const cv = document.getElementById('rpTimeline'), x = rpData(); if (!cv || !x) return;
    const { r, data } = x, s0 = r.startIdx, e0 = r.endIdx, n = e0 - s0 + 1, dpr = window.devicePixelRatio || 1, w = Math.max(200, cv.clientWidth || 300), h = TL.H;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.body), col = (k, d) => (css.getPropertyValue(k) || d).trim() || d, accent = col('--accent', '#007aff'), muted = col('--muted', '#888');
    const X = (i) => TL.L + ((i - s0) / Math.max(1, n - 1)) * (w - TL.L - TL.R);
    let lo = Infinity, hi = -Infinity; for (let i = s0; i <= e0; i++) { lo = Math.min(lo, data.c[i]); hi = Math.max(hi, data.c[i]); }
    const Y = (v) => 10 + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (h - 26);
    const iS = Math.max(s0, rpIdx(rp.start)), iE = Math.min(e0, rpIdx(rp.end));
    g.fillStyle = 'rgba(120,120,128,0.10)'; g.beginPath(); if (g.roundRect) g.roundRect(0, 0, w, h, 10); else g.rect(0, 0, w, h); g.fill();
    g.strokeStyle = muted; g.globalAlpha = 0.55; g.lineWidth = 1.2; g.beginPath(); for (let i = s0; i <= e0; i++) { const px = X(i), py = Y(data.c[i]); if (i === s0) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke(); g.globalAlpha = 1;
    // 선택 구간: 음영 + 위아래 굵은 테두리(영상 편집의 트림 막대처럼)
    g.fillStyle = accent; g.globalAlpha = 0.18; g.fillRect(X(iS), 0, Math.max(2, X(iE) - X(iS)), h); g.globalAlpha = 1;
    g.fillStyle = accent; g.fillRect(X(iS), 0, X(iE) - X(iS), 3); g.fillRect(X(iS), h - 3, X(iE) - X(iS), 3);
    g.strokeStyle = accent; g.lineWidth = 1.6; g.beginPath(); for (let i = iS; i <= iE; i++) { const px = X(i), py = Y(data.c[i]); if (i === iS) g.moveTo(px, py); else g.lineTo(px, py); } g.stroke();
    const handle = (xx, label, c) => { g.fillStyle = c; g.beginPath(); if (g.roundRect) g.roundRect(xx - 9, 0, 18, h, 6); else g.rect(xx - 9, 0, 18, h); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 11px -apple-system, "Noto Sans KR", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, xx, h / 2); g.fillRect(xx - 1, 8, 2, 6); g.fillRect(xx - 1, h - 14, 2, 6); };
    handle(X(iS), 'S', '#16a34a'); handle(X(iE), 'E', '#ea580c');
    if (rp.on) { const ic = Math.min(iE, Math.max(iS, rpIdx(rp.cur))); g.strokeStyle = '#ff3b30'; g.lineWidth = 2; g.beginPath(); g.moveTo(X(ic), 0); g.lineTo(X(ic), h); g.stroke(); g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(X(ic), 4, 4, 0, Math.PI * 2); g.fill(); }
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = muted; g.font = '10px -apple-system, "Noto Sans KR", sans-serif';
    g.fillText(data.d[iS].slice(2).replace(/-/g, '.'), Math.min(w - 120, X(iS) + 12), h - 5); g.textAlign = 'right'; g.fillText(data.d[iE].slice(2).replace(/-/g, '.'), Math.max(120, X(iE) - 12), h - 5);
    cv._tl = { s0, e0, n, X }; if (!cv._bound) { cv._bound = true; rpBindTL(cv); }
  }
  function rpBindTL(cv) {
    let drag = null;
    const idxAt = (e) => { const t = cv._tl, rect = cv.getBoundingClientRect(), w = rect.width; return Math.max(t.s0, Math.min(t.e0, t.s0 + Math.round(((e.clientX - rect.left - TL.L) / Math.max(1, w - TL.L - TL.R)) * (t.n - 1)))); };
    cv.addEventListener('pointerdown', (e) => {
      if (!cv._tl) return;
      const t = cv._tl, rect = cv.getBoundingClientRect(), px = e.clientX - rect.left, xs = t.X(rpIdx(rp.start)), xe = t.X(rpIdx(rp.end));
      const ds = Math.abs(px - xs), de = Math.abs(px - xe); drag = ds <= de ? 's' : 'e'; // 가까운 손잡이를 잡음(막대 아무 곳이나 눌러도 가까운 쪽이 이동)
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ } cv.dispatchEvent(new PointerEvent('pointermove', { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId }));
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return; const x = rpData(); if (!x) return; const i = idxAt(e), d = x.data.d, gap = 2;
      if (drag === 's') rp.start = d[Math.min(i, rpIdx(rp.end) - gap)]; else rp.end = d[Math.max(i, rpIdx(rp.start) + gap)];
      rpRangeChanged();
    });
    const end = () => { drag = null; }; cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  }
  function rpApplyRange() { if (A.chartRange) { if (rp.sel || rp.on) A.chartRange(rp.start, rp.end); else A.chartRange(null, null); } } // 필요할 때만(구간 지정·재생 중) 차트에 선택 구간 표시
  function rpRangeChanged() { // 구간이 바뀌면 입력칸·타임라인·슬라이더·차트 음영을 맞춤(재생 중에도 가능)
    const a = document.querySelector('[data-rp=start]'), b = document.querySelector('[data-rp=end]'); if (a) a.value = rp.start; if (b) b.value = rp.end;
    const x = rpData();
    if (rp.on && x) { // 재생 위치가 구간 밖으로 나가면 가장자리로 당김(끝 밖이면 거기서 멈춤)
      const ci = rpIdx(rp.cur), si = rpIdx(rp.start), ei = rpIdx(rp.end);
      if (ci > ei) { rp.cur = rp.end; rpStop(); } else if (ci < si) rp.cur = rp.start;
      const sl = document.getElementById('rpSlider'); if (sl) { sl.min = String(si); sl.max = String(ei); }
      const lb = document.querySelector('.rp-lbl'); if (lb) lb.innerHTML = `<span>${x.data.d[si]}</span><span>${x.data.d[ei]}</span>`;
      rpSync();
    } else if (!rp.on) rp.cur = rp.start;
    rpDrawTL(); rpApplyRange();
  }
  function rpSetFromChart(which) {
    const x = rpData(); if (!x) return; const date = A.chartCrossDate && A.chartCrossDate();
    if (!date) return toast('차트를 눌러 날짜를 먼저 고르세요', true);
    const { r, data } = x, i = Math.max(r.startIdx, Math.min(r.endIdx, rpIdx(date))), d = data.d;
    if (which === 's') { rp.start = d[i]; if (rpIdx(rp.end) <= i + 1) rp.end = d[r.endIdx]; } else { rp.end = d[i]; if (rpIdx(rp.start) >= i - 1) rp.start = d[r.startIdx]; }
    if (rpIdx(rp.end) - rpIdx(rp.start) < 2) { toast('구간이 너무 짧습니다', true); rp.start = d[Math.max(r.startIdx, rpIdx(rp.end) - 5)]; }
    rpRangeChanged();
  }
  function rpHtml() { rpInit(); return `<details class="rpmenu" id="rpWrap" ${rp.open || rp.on || rp.sel ? 'open' : ''}><summary><b>구간 재생</b> <small>원하는 구간을 골라 실제 차트처럼 재생</small></summary><div class="rp ${rp.on ? 'on' : ''}" id="rpPanel">${rpInner()}</div></details>`; }
  document.addEventListener('toggle', (e) => { if (e.target && e.target.id === 'rpWrap') rp.open = e.target.open; }, true);
  function rpRefresh() { const el = document.getElementById('rpPanel'); if (!el) return; el.classList.toggle('on', rp.on); el.innerHTML = rpInner(); const st = document.getElementById('rpState'); if (st) { st.hidden = !rp.on; st.innerHTML = rp.on ? rpStateHtml() : ''; } rpDrawTL(); }
  function rpSync() { // 재생 중 한 칸: 차트·상태·슬라이더만 갱신(패널 전체를 다시 그리지 않음)
    if (A.chartReveal) A.chartReveal(rp.on ? rp.cur : null);
    const stEl = document.getElementById('rpState'); if (stEl) stEl.innerHTML = rpStateHtml();
    const sl = document.getElementById('rpSlider'); if (sl) sl.value = String(rpIdx(rp.cur));
    rpDrawTL();
  }
  function rpStop() { if (rp.timer) clearInterval(rp.timer); rp.timer = null; rp.playing = false; const b = document.getElementById('rpPlayBtn'); if (b) { b.textContent = '▶'; b.setAttribute('aria-label', '재생'); } }
  function rpNext(dir) { // 다음(또는 이전) 위치의 인덱스
    const x = rpData(); if (!x) return -1; const { data } = x, si = rpIdx(rp.start), ei = rpIdx(rp.end), ci = rpIdx(rp.cur);
    let ni = ci + dir;
    if (rp.unit === 'week') { if (dir > 0) { while (ni < ei && rpMonday(data.d[ni + 1]) === rpMonday(data.d[ni])) ni++; } else { while (ni > si && rpMonday(data.d[ni - 1]) === rpMonday(data.d[ni])) ni--; } }
    return Math.max(si, Math.min(ei, ni));
  }
  function rpTick() {
    const x = rpData(); if (!x || !document.getElementById('rpPanel') || !rp.on) return rpStop();
    const ei = rpIdx(rp.end), ci = rpIdx(rp.cur); if (ci >= ei) { rpStop(); return; }
    rp.cur = x.data.d[rpNext(1)]; rpSync(); if (rpIdx(rp.cur) >= ei) rpStop();
  }
  function rpPlay() { rpStop(); if (rpIdx(rp.cur) >= rpIdx(rp.end)) rp.cur = rp.start; rp.playing = true; rp.timer = setInterval(rpTick, Math.max(25, 900 / rp.speed)); const b = document.getElementById('rpPlayBtn'); if (b) { b.textContent = '⏸'; b.setAttribute('aria-label', '일시정지'); } }
  // 차트의 B·S 원을 누르면: 그 사이클만 펼치고(다른 것은 접음) 그 매수(또는 전량 매도) 줄을 강조하며 화면 가운데로 스크롤
  A.btOpenCycle = (h) => {
    const row = document.querySelector(`tr.cycrow[data-cd="${h.no}"]`) || document.querySelector(`tr.cycrow[data-cd="${h.no}o"]`); if (!row) return;
    const tb = row.parentNode;
    tb.querySelectorAll('tr.cycdet').forEach((d) => { d.hidden = d.dataset.cd !== row.dataset.cd; });
    tb.querySelectorAll('tr.cycrow').forEach((r) => { const on = r === row; r.setAttribute('aria-expanded', String(on)); const ar = r.querySelector('.cycar'); if (ar) ar.textContent = on ? '▾' : '▸'; });
    const det = tb.querySelector(`tr.cycdet[data-cd="${row.dataset.cd}"]`), tr = det && (h.kind === 'S' ? det.querySelector('tr.cycsell, tr.muted') : det.querySelector(`tr[data-seq="${h.seq}"]`));
    tb.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl')); row.classList.add('hl'); if (tr) tr.classList.add('hl');
    setTimeout(() => { row.classList.remove('hl'); if (tr) tr.classList.remove('hl'); }, 2600);
    (tr || row).scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  A.rpReset = () => { rpStop(); rp.on = false; rp.sel = false; }; // 새 결과가 나오면 재생 상태 초기화
  A._rp = rp; // 테스트용
  Object.assign(A.handlers, {
    rpSetS: () => rpSetFromChart('s'), rpSetE: () => rpSetFromChart('e'),
    rpSel: () => { rpInit(); rp.sel = !rp.sel; rp.open = true; rpRefresh(); rpApplyRange(); }, // 구간 지정 켜기(전체 막대 표시) / 취소(막대와 차트의 선택 구간이 사라짐)
    rpStart: () => { rpInit(); rp.on = true; rp.cur = rp.start; rpRefresh(); rpApplyRange(); rpSync(); },
    rpEnd: () => { rpStop(); rp.on = false; if (A.chartReveal) A.chartReveal(null); rpRefresh(); rpApplyRange(); },
    rpPlay: () => { if (rp.playing) rpStop(); else rpPlay(); },
    rpRestart: () => { rpStop(); rp.cur = rp.start; rpSync(); },
    rpStep: (el) => { rpStop(); const x = rpData(); if (!x) return; rp.cur = x.data.d[rpNext(+el.dataset.v)]; rpSync(); },
    rpSpeed: (el) => { rp.speed = +el.dataset.v; const was = rp.playing; rpRefresh(); if (was) rpPlay(); },
    rpUnit: (el) => { rp.unit = el.dataset.v === 'week' ? 'week' : 'day'; rpRefresh(); },
  });
  function rpInput(el) {
    const k = el.dataset.rp, x = rpData(); if (!x) return;
    if (k === 'slider') { rpStop(); rp.cur = x.data.d[Math.max(0, Math.min(x.data.d.length - 1, +el.value))]; rpSync(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
    if (k === 'start') rp.start = el.value; else rp.end = el.value;
    const { r, data } = x; if (rp.start < data.d[r.startIdx]) rp.start = data.d[r.startIdx]; if (rp.end > data.d[r.endIdx]) rp.end = data.d[r.endIdx]; if (rp.end <= rp.start) rp.end = data.d[r.endIdx];
    rpRangeChanged();
  }

  // 사이클(첫 매수 → 보유 순번 전부 매도) 요약: 청산까지 몇 번·얼마·몇 주를 샀는지(평균·최대)와 사이클별 목록(눌러서 펼침)
  function cycleSection(r, cur) {
    const cs = r.cycleStats, oc = r.openCycle, cfg = r.cfg;
    const multi = Number(cfg.growth) > 1 || SM.exprLeaves(SM.exprOf(cfg.entries)).some((x) => x.type === 'dropLast');
    if (!multi || (!r.cycles.length && !oc)) return '';
    const tgt = (SM.exprLeaves(SM.exprOf(cfg.exits)).find((c) => c.type === 'avgPct' && c.dir !== 'down') || {}).pct, tp = tgt != null ? Number(tgt) : null;
    const d = (v) => (v == null ? '-' : Math.round(v).toLocaleString('ko-KR') + '일'), n1 = (v) => (v == null ? '-' : (Math.round(v * 10) / 10).toLocaleString('ko-KR')), md = (dt) => dt.slice(2);
    const sgn = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%', pc = (v) => (v == null ? '-' : sgn(v * 100)), cls = (v) => (v >= 0 ? 'pos' : 'neg');
    const done = cs.count;
    const card = (label, avg, max) => `<div class="stat"><span>${label}</span><b>${avg}</b><small>최대 ${max}</small></div>`;
    const dist = Object.keys(cs.dist).map(Number).sort((a, b) => a - b), dmax = Math.max(1, ...dist.map((k) => cs.dist[k]));
    const summary = done ? `<div class="cards cards4">
        ${card('매수 횟수(평균)', n1(cs.avgLots) + '회', cs.maxLotsDone + '회')}
        ${card('쓴 돈(평균)', fmtMoney(cs.avgInvest, cur), fmtMoney(cs.maxInvestDone, cur))}
        ${card('산 수량(평균)', n1(cs.avgQty) + '주', fmtNum(cs.maxQty, 0) + '주')}
        ${card('청산까지(평균)', d(cs.avgDays), d(cs.maxDays))}
      </div>
      <div class="dist" aria-label="몇 번 매수하고 청산됐는지"><span class="dist-t">매수 횟수별 사이클 수 (총 ${done}번 청산)</span>${dist.map((k) => `<span class="dist-r"><i>${k}회</i><u style="width:${Math.max(4, Math.round((cs.dist[k] / dmax) * 100))}%"></u><b>${cs.dist[k]}</b></span>`).join('')}</div>` : '<p class="hint">이 기간에는 이익으로 전부 판 사이클이 없습니다.</p>';
    const prog = oc ? `<p class="hint prog">진행 중 1건(평균·최대 제외): ${md(oc.startDate)} 시작, ${oc.lots}회 매수·${fmtNum(oc.qty, 0)}주, 투입금 ${fmtMoney(oc.peakInv, cur)}, 평가손익 ${fmtMoney(oc.realized + oc.unrealized, cur)}.</p>` : '';
    const opt = bt.cycOpt || (bt.cycOpt = { target: false, pnl: false });
    const whyHtml = (list) => ((list || []).length ? (list || []).map((cd) => condSummary(cd)).join(' <b>·</b> ') : '<span class="muted">-</span>'); // 이 매수가 나온 날 참이었던 매수 조건
    const sellWhyHtml = (w) => (w && (w.text || (w.conds || []).length) ? `<b>${esc(w.text || '')}</b>${(w.conds || []).length ? ' · ' + w.conds.map((cd) => condSummary(cd)).join(' <b>·</b> ') : ''}` : '<span class="muted">-</span>');
    const trOf = (lot) => r.trades.find((t) => t.no === lot);
    const detail = (x) => {
      const rows = x.buys.map((bu) => { const t = trOf(bu.lot), tprice = tp != null ? bu.avg * (1 + tp / 100) : null;
        return `<tr data-seq="${bu.seq}"><td>${SM.cycleLabel(x.no, bu.seq)}</td><td>${md(bu.date)}</td><td>${fmtNum(bu.price, 2)} × ${fmtNum(bu.qty, 0)}</td><td>${fmtNum(bu.cumQty, 0)}주</td><td>${fmtMoney(bu.cost, cur)}</td><td><b>${fmtNum(bu.avg, 2)}</b></td><td class="c-why">${whyHtml(bu.why)}</td><td class="c-target">${tprice != null ? fmtNum(tprice, 2) : '-'}</td><td class="c-pnl ${t ? cls(t.pnl) : ''}">${t ? `${fmtNum(t.sellPrice, 2)} · ${pc(t.ret)}` : '-'}</td></tr>`; }).join('');
      const last = x.buys[x.buys.length - 1];
      const end = x.open ? `<tr class="muted"><td colspan="9">진행 중 · ${md(x.endDate)} 종가 ${fmtNum(x.lastPrice, 2)} · 평가손익 ${fmtMoney(x.realized + x.unrealized, cur)} (${pc(x.ret)})</td></tr>`
        : `<tr class="cycsell"><td>${x.no}✓ 매도</td><td>${md(x.endDate)}</td><td>${fmtNum(x.sellPrice, 2)} × ${fmtNum(x.sellQty, 0)}</td><td></td><td></td><td>평단 ${fmtNum(last.avg, 2)}</td><td class="c-why">${sellWhyHtml(x.sellWhy)}</td><td class="c-target">${tp != null ? '+' + tp + '%' : ''}</td><td class="${cls(x.realized)}"><b>${fmtMoney(x.realized, cur)}</b> (${pc(x.ret)})</td></tr>`;
      return `<tr class="cycdet" data-cd="${x.no}${x.open ? 'o' : ''}" hidden><td colspan="5"><p class="cycsum"><button type="button" class="btn sm" data-act="btCycChart" data-from="${x.startDate}" data-to="${x.endDate}">차트에서 보기</button> 최저 평가손익 ${fmtMoney(x.worst, cur)} · 최대 투입금 ${fmtMoney(x.peakInv, cur)} (수수료 포함)</p><div class="tablewrap"><table class="mini cycmini"><thead><tr><th>매수</th><th>날짜</th><th>가격 × 수량</th><th>누적</th><th>누적 투입금</th><th>평단</th><th class="c-why">매수·매도 조건</th><th class="c-target">목표가</th><th class="c-pnl">이 순번 매도·손익</th></tr></thead><tbody>${rows}${end}</tbody></table></div></td></tr>`;
    };
    const cumOf = new Map(); { let acc = 0; for (const x of r.cycles) { acc += x.realized; cumOf.set(x, acc); } if (oc) cumOf.set(oc, acc + oc.realized + oc.unrealized); } // 누적 손익: 청산된 사이클의 실현손익을 차례로 더함(진행 중 사이클은 평가손익까지 포함)
    const row = (x, k) => `<tr class="cycrow ${x.open ? 'muted' : ''}" data-act="btCycToggle" data-cd="${x.no}${x.open ? 'o' : ''}" data-from="${x.startDate}" data-to="${x.endDate}" tabindex="0" role="button" aria-expanded="false" title="눌러서 매수별 내역 보기"><td data-label="사이클"><span class="v"><i class="cycar">▸</i> ${x.no}${x.open ? ' (진행 중)' : ''}<small class="muted">${md(x.startDate)}~${x.open ? '…' : md(x.endDate)} · ${d(x.days)}</small></span></td><td data-label="매수"><span class="v">${x.lots}회 · ${fmtNum(x.qty, 0)}주</span></td><td data-label="투입금"><span class="v">${fmtMoney(x.peakInv, cur)}</span></td><td data-label="손익"><span class="v ${cls(x.open ? x.realized + x.unrealized : x.realized)}">${fmtMoney(x.open ? x.realized + x.unrealized : x.realized, cur)} <small>(${pc(x.ret)})</small></span></td><td data-label="누적 손익"><span class="v cumc ${cls(cumOf.get(x))}">${fmtMoney(cumOf.get(x), cur)}</span></td></tr>${detail(x)}`;
    return `<h4>사이클 분석 <small class="muted">(첫 매수 → 보유 순번 전부 매도)</small></h4>${summary}${prog}
      <div class="cycopt"><span class="muted">펼쳤을 때 추가로 보기</span><button type="button" class="chip ${opt.target ? 'on' : ''}" data-act="btCycOpt" data-k="target">목표가</button><button type="button" class="chip ${opt.pnl ? 'on' : ''}" data-act="btCycOpt" data-k="pnl">순번별 매도·손익</button></div>
      <div class="cycwrap ${opt.target ? 'show-target' : ''} ${opt.pnl ? 'show-pnl' : ''}"><div class="tablewrap"><table class="cyc cmp"><thead><tr><th>사이클</th><th>매수</th><th>투입금</th><th>손익</th><th>누적 손익</th></tr></thead><tbody>${r.cycles.map((x, k) => row(x, k + 1)).join('')}${oc ? row(oc, 0) : ''}</tbody></table></div></div>
      <p class="hint">줄을 누르면 매수별 내역이 펼쳐집니다. 평균·최대는 청산이 끝난 사이클만 계산합니다.</p>`;
  }

  A.afterRender.backtest = function () {
    const r = bt.result;
    if (!r) return;
    const stored = allDS()[bt.datasetId];
    if (!stored || !stored.data) return;
    const data = stored.data, cfg = r.cfg;
    const vc = SM.exprLeaves(SM.exprOf(cfg.entries)).concat(SM.exprLeaves(SM.exprOf(cfg.exits))).find((c) => c.type === 'vol');
    const targetPct = (SM.exprLeaves(SM.exprOf(cfg.exits)).find((c) => c.type === 'avgPct' && c.dir !== 'down') || {}).pct;
    if (A.mountChart && document.getElementById('chartHost')) {
      const dsId = String(bt.datasetId || ''), code = dsId.startsWith('repo:') ? dsId.slice(5) : '';
      const mounted = A.mountChart({ ds: { name: stored.name || '시뮬레이션 데이터', data }, code, onMarker: (h) => A.btOpenCycle(h), cycles: r.cycles.concat(r.openCycle ? [r.openCycle] : []), target: targetPct != null ? Number(targetPct) : 0 });
      if (mounted && mounted.then) mounted.then(() => { if (rp.on && A.chartReveal) A.chartReveal(rp.cur); rpApplyRange(); rpDrawTL(); }); // 다시 그려져도 재생 위치·구간 유지
    }
    const canvas = document.getElementById('btCandle');
    if (canvas) SM.drawCandles(canvas, data, { from: r.startIdx, to: r.endIdx, lines: SM.overlayLines(data, cfg), buys: r.buys, sells: r.sells, volLine: vc ? num(vc.n) : 0, tip: document.getElementById('candleTip'), height: 360 });
    const eq = document.getElementById('btEquity');
    if (eq) {
      const xs = r.equity.map((e) => e.d), ys = r.equity.map((e) => e.v), draw = (mark) => SM.drawLine(eq, xs, ys, 160, { mark });
      draw(null);
      let down = false; // 누적 손익 곡선을 누르거나 끌면 그 날짜로 차트가 이동(십자선 표시)
      const at = (e) => { const i = SM.lineIndexAt(eq, e.clientX, xs.length); draw(i); if (A.chartFocus) A.chartFocus(xs[i], null); };
      eq.style.cursor = 'pointer';
      eq.addEventListener('pointerdown', (e) => { down = true; try { eq.setPointerCapture(e.pointerId); } catch (x) { /* 무시 */ } at(e); });
      eq.addEventListener('pointermove', (e) => { if (down) at(e); });
      const end = () => { down = false; }; eq.addEventListener('pointerup', end); eq.addEventListener('pointercancel', end);
    }
  };

  /* ---------- 데이터 저장 ---------- */
  // 저장소(data/)의 시세·수급을 하나의 표 텍스트로 합칩니다. 시세가 없으면 수급만, 수급이 없으면 시세만.
  async function repoText(code, force) {
    const st = await SM.data.status(!!force);
    const sst = (st && st.stocks && st.stocks[code]) || {};
    const [pxCsv, flCsv] = await Promise.all([sst.prices && sst.prices.ok ? SM.data.pricesCsv(code, !!force) : null, sst.flow && sst.flow.ok ? SM.data.flowCsv(code, !!force) : null]);
    if (!pxCsv && !flCsv) return { error: '저장소에서 시세·수급 파일을 읽지 못했습니다.' };
    const names = [];
    if (pxCsv) {
      const px = SM.splitTable(pxCsv);
      if (px.error) return { error: px.error };
      names.push(`저장소 ${code} 시세`);
      const flow = new Map();
      if (flCsv) {
        const ft = SM.splitTable(flCsv);
        if (!ft.error) { for (const r of ft.rows) flow.set(r[0], r.slice(1)); names.push(`수급 ${flow.size}일`); }
      }
      const head = px.header.concat(flow.size ? ['외국인', '기관', '개인'] : []);
      return { text: [head.join(',')].concat(px.rows.map((r) => r.concat(flow.size ? (flow.get(r[0]) || ['', '', '']) : []).join(','))).join('\n'), names };
    }
    return { text: flCsv.replace(/^date,frgn,inst,indiv/, '날짜,외국인,기관,개인'), names: [`저장소 ${code} 수급`], flowOnly: true };
  }
  // 종목 화면의 “시뮬레이션으로 불러오기”: 저장소 자동 수집 데이터를 복사 없이 바로 선택
  A.btUseRepo = async (code) => {
    await A.btRepoInit(true);
    if (!repo.list.some((w) => w.code === code)) return A.btLoadRepo(code); // 시세가 없는 종목은 예전 방식(미리보기 후 저장)
    bt.datasetId = repoId(code); bt.result = null; bt.val = null; bt.cmp = null; bt.cfg.from = ''; bt.cfg.to = '';
    const own = ownStockByCode(code); if (own) bt.stockId = own.id;
    A.btRepoLoad(code, true); A.render();
  };
  // 내 기기에 복사해 저장하려는 경우(미리보기·이어붙이기 선택)
  A.btLoadRepo = async (code) => {
    const rt = await repoText(code, true);
    if (rt.error) return toast(rt.error, true);
    const wl = await SM.data.watchlist();
    const t = SM.splitTable(rt.text);
    if (t.error) return toast(t.error, true);
    bt.imp.text = ''; bt.imp.name = ((wl.find((w) => w.code === code) || {}).name || code); bt.imp.unit = '';
    const own = A.getState().stocks.find((x) => String(x.code || '').trim() === code);
    bt.imp.stockId = own ? own.id : bt.stockId || '';
    startImport(t, rt.names);
  };
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder('euc-kr').decode(buf); } catch (e2) { return new TextDecoder('utf-8').decode(buf); } }
  }
  /* ---------- 실행 ---------- */
  function cfgForRun() {
    const c = clone(bt.cfg);
    const ds = curDS();
    if (!c.from) c.from = ds.data.d[0];
    if (!c.to) c.to = ds.data.d[ds.data.d.length - 1];
    return c;
  }
  const H = A.handlers, C = A.changeHandlers;
  Object.assign(H, {
    btRepoRefresh: async () => { SM.data.clear(); repo.cache = {}; repo.initP = null; await A.btRepoInit(true); toast('저장소의 최신 목록을 읽었습니다'); },
    btDSDel: () => { if (isRepoId(bt.datasetId)) return toast('자동 수집 데이터는 삭제하지 않습니다. 수집 대상에서 빼면 목록에서 사라집니다.', true); if (!confirm('이 가격 데이터를 삭제할까요?')) return; const ds = loadDS(); delete ds[bt.datasetId]; saveDS(ds); bt.datasetId = null; bt.result = null; bt.val = null; bt.cmp = null; A.render(); },
    btDel: (el) => {
      const g = el.dataset.g, { parent, idx } = parentAt(g, el.dataset.path); if (!parent) return;
      parent.items.splice(idx, 1); tidy(getSide(g).expr); syncSide(g); bt.condOpen = ''; A.render();
    },
    btCondOpen: (el) => { // 문장 속 조건을 누르면 그 조건의 값 편집칸이 열림(다시 누르면 닫힘). 화면 전체를 다시 그리지 않음
      const key = `${el.dataset.g}:${el.dataset.path}`, was = bt.condOpen === key;
      document.querySelectorAll('.tok.open').forEach((x) => x.classList.remove('open')); document.querySelectorAll('.tok-ed.show').forEach((x) => x.classList.remove('show'));
      if (!was) { const tk = el.closest('.tok'); if (tk) tk.classList.add('open'); const ed = document.querySelector(`.tok-ed[data-g="${el.dataset.g}"][data-path="${el.dataset.path}"]`); if (ed) { ed.classList.add('show'); if (ed.scrollIntoView) ed.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
      bt.condOpen = was ? '' : key;
    },
    btOp: (el) => { const n = nodeAt(el.dataset.g, el.dataset.path); if (!n) return; n.op = n.op === 'OR' ? 'AND' : 'OR'; syncSide(el.dataset.g); A.render(); },
    btPickOpen: (el) => { bt.picker = { g: el.dataset.g, path: el.dataset.path || '' }; A.render(); },
    btPickClose: () => { bt.picker = null; A.render(); },
    btPickTab: (el) => { bt.pickGroup = el.dataset.v; A.render(); },
    btPick: (el) => {
      const pk = bt.picker; if (!pk || !SM.COND_DEFS[el.dataset.t]) return; const g = pk.g;
      let path = pk.path, node = nodeAt(g, path); if (!node || isLeaf(node)) { path = ''; node = nodeAt(g, ''); }
      const leaf = newCond(el.dataset.t); if (g === 'exits' && isDynC(leaf)) { path = ''; node = getSide(g).expr; } // 독립 조건은 맨 바깥에
      node.items.push(leaf); syncSide(g); bt.condOpen = `${g}:${pthOf(path, node.items.length - 1)}`; bt.picker = null; A.render();
    },
    btWrapToggle: (el) => { bt.wrap = bt.wrap && bt.wrap.g === el.dataset.g ? null : { g: el.dataset.g, sel: [] }; A.render(); },
    btSel: (el) => { // 묶기 모드에서 조건·괄호 선택(화면은 다시 그리지 않고 표시만 바꿈)
      if (!bt.wrap) return; const p = el.dataset.path, i = bt.wrap.sel.indexOf(p); if (i >= 0) bt.wrap.sel.splice(i, 1); else bt.wrap.sel.push(p);
      const box = el.closest('.tok') || el.closest('.grp'); if (box) box.classList.toggle('picked', i < 0);
      const b = document.querySelector('[data-act=btWrapDo]'); if (b) b.textContent = `선택 묶기 (${bt.wrap.sel.length})`;
    },
    btWrapDo: () => {
      const wr = bt.wrap; if (!wr) return; const g = wr.g, paths = wr.sel.slice();
      if (paths.length < 2) return toast('묶을 조건을 둘 이상 고르세요', true);
      const pp = paths.map((p) => parentAt(g, p)); if (!pp.every((x) => x.ppath === pp[0].ppath)) return toast('같은 층(같은 괄호 안)의 조건만 함께 묶을 수 있습니다', true);
      const parent = pp[0].parent, idxs = pp.map((x) => x.idx).sort((a, b2) => a - b2), picked = idxs.map((k) => parent.items[k]);
      if (idxs.length === parent.items.length) return toast('모든 조건을 묶을 필요는 없습니다. 일부만 고르세요', true);
      const grp = { op: parent.op, items: picked }; parent.op = parent.op === 'AND' ? 'OR' : 'AND'; // (고른 조건끼리는 지금 연결 그대로) 그리고 나머지와는 반대 연결 → 예: (A and C) or B
      parent.items = parent.items.filter((_, k) => !idxs.includes(k)); parent.items.splice(idxs[0], 0, grp);
      tidy(getSide(g).expr); syncSide(g); bt.wrap = null; bt.condOpen = ''; A.render();
    },
    btUngroup: (el) => {
      const g = el.dataset.g, { parent, idx } = parentAt(g, el.dataset.path); const node = nodeAt(g, el.dataset.path); if (!parent || !node || isLeaf(node)) return;
      parent.items.splice(idx, 1, ...node.items); syncSide(g); bt.condOpen = ''; A.render(); toast(`괄호를 풀었습니다. 이제 같은 층의 조건이 모두 ${parent.op}로 연결됩니다`);
    },
    btRepo: async () => {
      const [wl, st] = await Promise.all([SM.data.watchlist(true), SM.data.status(true)]);
      const okOf = (w, k) => st && st.stocks && st.stocks[w.code] && st.stocks[w.code][k] && st.stocks[w.code][k].ok;
      const have = wl.filter((w) => okOf(w, 'prices') || okOf(w, 'flow'));
      if (!have.length) return toast(st ? '수집된 시세·수급이 있는 종목이 없습니다. 설정 > 자동 수집을 확인하세요.' : '아직 자동 수집이 설정되지 않았습니다. 설정 > 자동 수집을 확인하세요.', true);
      A.openModal(`<h3>자동 수집 데이터를 내 기기에 복사</h3><label>종목<select name="code">${have.map((w) => { const p = st.stocks[w.code].prices, f = st.stocks[w.code].flow; return `<option value="${w.code}">${esc(w.name)} (${w.code}) · ${p && p.ok ? '시세 ' + p.count + '일 · 마지막 ' + p.last : '시세 없음'}${f && f.ok ? ' · 수급 ' + f.count + '일' : ''}</option>`; }).join('')}</select></label><p class="hint">시세는 공공데이터포털 일봉(수정주가 아님), 수급은 네이버 순매수(주)입니다. 읽은 뒤 미리보기에서 확인하고 저장하세요.</p><div class="btns"><button class="btn primary" type="submit">불러오기</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => { A.closeModal(); A.btLoadRepo(fd.get('code')); });
    },
    btAnalyze: () => {
      const imp = bt.imp;
      if (!imp.text.trim()) return toast('붙여 넣을 내용이 없거나 파일을 먼저 선택하세요', true);
      const t = SM.splitTable(imp.text, imp.headerLine);
      if (t.error) return toast(t.error, true);
      startImport(t, ['붙여넣기']);
    },
    btImpCancel: () => { bt.imp.an = null; bt.imp.fileNames = []; A.render(); },
    btImpSave: () => {
      const imp = bt.imp, an = imp.an;
      if (!an) return;
      const kind = SM.kindOf(an.cols), ds = loadDS();
      const msgs = [];
      let targetId = null;
      if (kind === 'flow') {
        const tgt = ds[imp.destId];
        if (!tgt) return toast('수급을 합칠 가격 데이터를 고르세요', true);
        const m = SM.mergeFlow(tgt.data, an.table, an.cols, { unit: imp.unit });
        if (m.error) return toast(m.error, true);
        if (['frgn', 'inst', 'indiv'].some((k) => tgt.data[k]) && tgt.data.flowUnit && tgt.data.flowUnit !== m.unit) return toast(`기존 수급은 ${tgt.data.flowUnit === 'krw' ? '금액(원)' : '수량(주)'} 단위인데 이 표는 ${m.unit === 'krw' ? '금액(원)' : '수량(주)'} 단위입니다. 섞어 쓸 수 없으니 단위를 확인하거나 기존 수급을 지우고 다시 불러오세요.`, true);
        tgt.data.flowUnit = m.unit;
        ['frgn', 'inst', 'indiv'].forEach((k) => {
          if (!m.arrs[k]) return;
          tgt.data[k] = tgt.data[k] ? tgt.data[k].map((v, i) => (m.arrs[k][i] != null ? m.arrs[k][i] : v)) : m.arrs[k]; // 기존 수급은 유지하고 새 값만 덮어씀
        });
        msgs.push(`수급 데이터를 합쳤습니다: ${m.matched}일 매칭` + (m.unmatched ? `, 가격 데이터에 없는 날짜 ${m.unmatched}일은 제외` : '') + (m.missing ? `, 수급이 비는 거래일 ${m.missing}일(해당 날은 수급 조건이 거짓으로 처리됩니다)` : '') + '.');
        targetId = imp.destId;
      } else if (kind === 'price' || kind === 'both') {
        const r = SM.buildDataset(an.table, an.cols, { useAdj: imp.useAdj, unit: imp.unit });
        if (r.error) return toast(r.error, true);
        if (imp.dest === 'merge' && imp.destId && ds[imp.destId]) {
          const tgt = ds[imp.destId];
          const mg = SM.mergeDatasets(tgt.data, r.data);
          if (mg.unitMismatch) return toast('기존 수급과 새 표의 단위(주/원)가 달라 합칠 수 없습니다. 단위를 확인하세요.', true);
          tgt.data = mg.data;
          if (imp.stockId && !tgt.stockId) tgt.stockId = imp.stockId;
          msgs.push(`“${tgt.name}”에 합쳤습니다: 새 날짜 ${mg.added}일 추가, 겹치는 ${mg.overlap}일은 새 값으로 덮어썼습니다. (전체 ${mg.data.d.length}일, ${mg.data.d[0]} ~ ${mg.data.d[mg.data.d.length - 1]})`);
          if (mg.keptOHLC) msgs.push('이 표에는 시가·고가·저가(또는 일부)가 없어, 겹치는 날짜의 기존 시가·고가·저가는 그대로 두고 종가·거래량·수급만 갱신했습니다.');
          if (mg.mismatch) msgs.push(`겹치는 날짜 중 ${mg.mismatch}일은 종가가 1% 넘게 달랐습니다. 한쪽이 수정주가가 아니거나 액면분할이 반영 안 됐을 수 있으니 확인하세요.`);
          targetId = imp.destId;
        } else {
          const id = SM.uid();
          const name = (imp.name || '').trim() || '데이터 ' + new Date().toLocaleDateString('ko-KR');
          ds[id] = { name, market: imp.market, added: Date.now(), data: r.data, stockId: imp.stockId || null };
          bt.cfg.market = imp.market; targetId = id;
          msgs.push(`${name}: ${r.count}일치 (${r.data.d[0]} ~ ${r.data.d[r.data.d.length - 1]}) 저장했습니다.`);
        }
        msgs.push(...r.warnings);
      } else return toast('날짜와 종가(또는 수급) 열을 지정하세요', true);
      if (!saveDS(ds)) return;
      rememberCols(an);
      bt.datasetId = targetId; bt.result = null; bt.val = null; bt.cmp = null;
      if (imp.stockId) bt.stockId = imp.stockId;
      bt.imp = newImp(); bt.warn = msgs;
      A.render(); toast('저장했습니다');
    },
    btStratSave: () => {
      const name = (document.getElementById('stratName').value || '').trim();
      if (!name) return toast('전략 이름을 입력하세요', true);
      const body = clone(bt.cfg); body.from = ''; body.to = '';
      const list = strategies();
      const ex = list.find((x) => x.id === bt.strategyId) || list.find((x) => x.name === name);
      if (ex) { ex.name = name; ex.cfg = body; bt.strategyId = ex.id; }
      else { const n = { id: SM.uid(), name, cfg: body }; list.push(n); bt.strategyId = n.id; }
      A.save(); A.render(); toast('전략을 저장했습니다');
    },
    btStratDel: () => {
      const list = strategies(), i = list.findIndex((x) => x.id === bt.strategyId);
      if (i < 0 || !confirm(`“${list[i].name}” 전략을 삭제할까요?`)) return;
      list.splice(i, 1); bt.strategyId = ''; A.save(); A.render();
    },
    btStratNew: () => { const keep = { from: bt.cfg.from, to: bt.cfg.to, market: bt.cfg.market }; bt.cfg = Object.assign(bt.mode === 'mg' ? presetCfg() : SM.blankCfg(), keep); bt.modeCfg[bt.mode] = bt.cfg; bt.strategyId = ''; bt.result = null; bt.val = null; A.render(); },
    btCycChart: (el) => { if (A.chartFocus) A.chartFocus(el.dataset.from, el.dataset.to, { scroll: true }); },
    btCycOpt: (el) => { const o = bt.cycOpt || (bt.cycOpt = { target: false, pnl: false }), k = el.dataset.k; o[k] = !o[k]; el.classList.toggle('on', o[k]); const w = el.closest('section, .card') && el.closest('section, .card').querySelector('.cycwrap'); if (w) w.classList.toggle('show-' + k, o[k]); },
    btCycToggle: (el) => {
      const row = el.closest('tr'); if (!row) return;
      if (row.dataset.from && A.chartFocus) A.chartFocus(row.dataset.from, row.dataset.to); // 눌러서 펼칠 때 차트도 그 사이클 구간으로 이동
      const det = row.parentNode.querySelector(`tr.cycdet[data-cd="${row.dataset.cd}"]`); if (!det) return;
      const open = det.hidden; det.hidden = !open; row.setAttribute('aria-expanded', String(open)); const ar = row.querySelector('.cycar'); if (ar) ar.textContent = open ? '▾' : '▸';
    },
    btMode2: (el) => { // 물타기 전략 ↔ 직접 조건 만들기 ↔ 예시: 물타기·직접은 각자 설정을 따로 기억(기간·시장·체결 방식은 공유). 예시 탭은 보기만(설정을 바꾸지 않음)
      const to = el.dataset.v === 'custom' ? 'custom' : el.dataset.v === 'example' ? 'example' : 'mg'; if (to === bt.mode) return;
      const cur = bt.mode === 'example' ? bt.exFrom : bt.mode;
      if (to === 'example') { bt.modeCfg[cur] = bt.cfg; bt.exFrom = cur; bt.mode = 'example'; bt.condOpen = ''; bt.wrap = null; A.render(); return; }
      if (to === cur) { bt.mode = to; A.render(); return; } // 예시에서 원래 탭으로 돌아옴
      bt.modeCfg[cur] = bt.cfg; const next = bt.modeCfg[to] || (to === 'mg' ? presetCfg() : SM.blankCfg());
      for (const k of ['from', 'to', 'market', 'fill']) next[k] = bt.cfg[k];
      bt.modeCfg[to] = next; bt.cfg = next; bt.mode = to; bt.condOpen = ''; bt.wrap = null; bt.result = null; bt.val = null; A.render();
    },
    btExLoad: (el) => loadExample(el.dataset.id),
    btExRun: (el) => { if (loadExample(el.dataset.id, true) && A.handlers.btRun) A.handlers.btRun(); },
    btPreset: () => { const keep = { from: bt.cfg.from, to: bt.cfg.to, market: bt.cfg.market, fill: bt.cfg.fill }; bt.cfg = Object.assign(presetCfg(), keep); bt.modeCfg.mg = bt.cfg; bt.strategyId = ''; bt.condOpen = ''; bt.wrap = null; bt.result = null; bt.val = null; A.render(); },
    btRange: (el) => {
      const ds = curDS(); if (!ds) return; const d = ds.data.d, last = d[d.length - 1], m = +el.dataset.v;
      bt.cfg.from = m ? (addMonthsStr(last, -m) < d[0] ? d[0] : addMonthsStr(last, -m)) : ''; bt.cfg.to = ''; bt.result = null; bt.val = null; A.render();
    },
    btRun: () => {
      const ds = curDS();
      if (!ds) return toast('먼저 가격 데이터를 불러오세요', true);
      const cfg = cfgForRun();
      const res = SM.runBacktest(ds.data, cfg, A.getState().settings);
      if (res.error) return toast(res.error, true);
      if (A.rpReset) A.rpReset(); bt.result = res; bt.val = null;
      if (bt.validate) {
        const i0 = ds.data.d.findIndex((d) => d >= cfg.from), i1 = ds.data.d.length - 1 - [...ds.data.d].reverse().findIndex((d) => d <= cfg.to);
        const k = i0 + Math.max(1, Math.floor(((i1 - i0 + 1) * Math.min(95, Math.max(5, num(bt.splitPct, 70)))) / 100)) - 1;
        bt.val = SM.runSplitValidation(ds.data, cfg, A.getState().settings, ds.data.d[Math.min(k, i1 - 1)]);
        [bt.val.a, bt.val.b].forEach((x) => { if (x.cfg) { /* 기간 표시용 */ } });
      }
      A.render();
      setTimeout(() => { const e = document.getElementById('btCandle'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    },
    btAll: async () => {
      if (bt.allBusy) return; const settings = A.getState().settings, base = clone(bt.cfg);
      bt.allBusy = true; A.render();
      try {
        for (const [id, e] of Object.entries(allDS())) if (e.repo && !e.data) { try { await A.btRepoLoad(e.code); } catch (x) { /* 못 읽은 데이터는 표에 오류로 */ } } // 자동 수집 데이터는 필요할 때 읽어 옴
        const rows = [];
        for (const [id, e] of Object.entries(allDS())) {
          if (!e.data) { rows.push({ name: e.name, error: '데이터를 읽지 못했습니다' }); continue; }
          const cfg = clone(base); cfg.from = bt.cfg.from || ''; cfg.to = bt.cfg.to || '';
          const r = SM.runBacktest(e.data, cfg, settings); if (r.error) { rows.push({ name: e.name, error: r.error }); continue; }
          const s = r.summary, d = e.data.d, sp = r.startIdx + Math.floor((r.endIdx - r.startIdx) * 0.7), v = SM.runSplitValidation(e.data, cfg, settings, d[sp]);
          rows.push({ name: e.name, range: `${d[r.startIdx]} ~ ${d[r.endIdx]}`, buys: s.buyCount, cycles: r.cycles.length, loss: r.cycles.filter((c) => c.realized < 0).length, total: s.total, peak: s.peakInvested, ret: s.retOnPeak, bh: s.bh ? s.bh.ret : null, ret1: v.a && !v.a.error ? v.a.summary.retOnPeak : null, ret2: v.b && !v.b.error ? v.b.summary.retOnPeak : null });
        }
        bt.all = { rows, cur: base.market === 'US' ? 'USD' : 'KRW' };
      } finally { bt.allBusy = false; A.render(); }
    },
    btCmp: () => {
      const ds = curDS();
      if (!ds) return toast('먼저 가격 데이터를 불러오세요', true);
      const base = cfgForRun();
      bt.cmp = strategies().map((s) => ({ name: s.name, res: SM.runBacktest(ds.data, Object.assign(clone(s.cfg), { from: base.from, to: base.to }), A.getState().settings) }));
      bt.cmpCur = base.market === 'US' ? 'USD' : 'KRW';
      A.render();
    },
  });
  Object.assign(C, {
    btFiles: async (el) => {
      const files = Array.from(el.files || []);
      el.value = '';
      if (!files.length) return;
      const tables = [];
      for (const f of files) {
        const buf = await new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.onerror = () => rej(rd.error); rd.readAsArrayBuffer(f); });
        const t = SM.splitTable(decode(buf), bt.imp.headerLine);
        if (t.error) return toast(`${f.name}: ${t.error}`, true);
        tables.push({ name: f.name, t });
      }
      const sig = (t) => t.header.map((h) => String(h).trim().toLowerCase().replace(/[\s.]+/g, '')).join('|');
      const first = tables[0].t;
      for (const x of tables.slice(1)) if (sig(x.t) !== sig(first)) return toast(`“${x.name}”의 열 구성이 첫 파일과 달라 함께 합칠 수 없습니다. 파일을 하나씩 불러오세요.`, true);
      const merged = { header: first.header, rows: [].concat(...tables.map((x) => x.t.rows)), delim: first.delim, headerLine: first.headerLine };
      bt.imp.text = '';
      startImport(merged, tables.map((x) => x.name));
    },
    btImpCol: (el) => { const c = bt.imp.an.cols; c[el.dataset.k] = +el.value; if (el.dataset.k === 'inst' && +el.value >= 0) delete c.instSum; bt.imp.an.fromSaved = false; A.render(); },
    btImpUnit: (el) => { bt.imp.unit = el.value; A.render(); },
    btImpAdj: (el) => { bt.imp.useAdj = el.checked; A.render(); },
    btImpDest: (el) => { bt.imp[el.dataset.k] = el.type === 'radio' ? el.value : el.value; A.render(); },
    btDS: (el) => { bt.datasetId = el.value; bt.result = null; bt.val = null; bt.cmp = null; bt.cfg.from = ''; bt.cfg.to = ''; if (isRepoId(el.value)) A.btRepoLoad(el.value.slice(5)); A.render(); },
    btParam: (el) => { const c = leafAtPath(el.dataset.g, el.dataset.path); if (c) { c[el.dataset.k] = el.value; condRefreshPath(el.dataset.g, el.dataset.path); } },
    btTop: (el) => { bt.cfg[el.dataset.k] = el.value; if (el.dataset.k === 'qtyMode') A.render(); },
    btValidate: (el) => { bt.validate = el.checked; A.render(); },
    btStratPick: (el) => {
      const s = strategies().find((x) => x.id === el.value);
      if (!s) { bt.strategyId = ''; return A.render(); }
      const keep = { from: bt.cfg.from, to: bt.cfg.to };
      bt.modeCfg[bt.mode] = bt.cfg; bt.cfg = Object.assign(clone(s.cfg), keep); bt.mode = 'custom'; bt.modeCfg.custom = bt.cfg; bt.strategyId = s.id; bt.result = null; bt.val = null;
      A.render(); toast(`“${s.name}” 전략을 불러왔습니다`);
    },
  });
  /* ---------- 시뮬레이션 메뉴: 종목 선택 · 데이터 연결 · 가상 매매 현황 · 비교 ---------- */
  const stockName = (id) => { const x = A.getState().stocks.find((q) => q.id === id); return x ? x.name : ''; };
  const dsLabel = (id, d) => d.repo ? d.name : d.name + (d.stockId && stockName(d.stockId) ? ' · ' + stockName(d.stockId) : '');
  function stockOptions(sel) {
    const all = A.getState().stocks;
    const grp = (label, list) => (list.length ? `<optgroup label="${label}">${list.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}${x.code ? ' (' + esc(x.code) + ')' : ''}</option>`).join('')}</optgroup>` : '');
    return `<option value="">연결 안 함</option>${grp('보유 종목', all.filter((x) => !x.watch))}${grp('관심 종목', all.filter((x) => x.watch))}`;
  }
  function linkedDatasets(stockId) { return Object.entries(allDS()).filter(([, d]) => d.stockId === stockId).sort((a, b) => (b[1].added || 0) - (a[1].added || 0)); }
  function stockPickHtml() {
    const stocks = A.getState().stocks;
    if (!stocks.length) return '';
    const st = stocks.find((x) => x.id === bt.stockId);
    const linked = st ? linkedDatasets(st.id) : [];
    return `<div class="stockpick">
      <div class="row gap wrap"><select class="inp" data-change="btStock" style="max-width:300px" aria-label="내 종목">${stockOptions(bt.stockId).replace('연결 안 함', '종목 선택')}</select>
      ${st ? (linked.length ? `<span class="muted">연결됨: ${esc(linked.map(([, d]) => d.name).join(', '))}</span>` : `<span class="stale">연결된 데이터 없음</span>`) : ''}</div>
      ${st && !linked.length ? `<div class="btns"><button class="btn sm" data-act="btStockRepo">${ic('stocks')}자동 수집 시세로 불러오기</button><button class="btn sm" data-act="btStockFile">${ic('download')}파일로 불러오기</button></div>` : ''}</div>`;
  }
  A.btPickStock = (id) => {
    bt.stockId = id || '';
    const l = id ? linkedDatasets(id) : [];
    if (l.length) { bt.datasetId = l[0][0]; if (isRepoId(l[0][0])) A.btRepoLoad(l[0][0].slice(5)); }
    const stk = A.getState().stocks.find((x) => x.id === id);
    if (stk && l.length) bt.cfg.market = stk.market;
    bt.result = null; bt.val = null; bt.cmp = null; bt.imp.stockId = id || '';
  };
  // 날짜의 종가: 종목에 연결된 가격 데이터 → 자동 수집 시세 순
  A.closeOn = async (st, date) => {
    try { await A.btRepoEnsureFor(st); } catch (e) { /* 저장소를 못 읽어도 다른 방법으로 */ }
    for (const [, d] of linkedDatasets(st.id).filter(([, x]) => x.data)) { const r = SM.closeOn(d.data, date); if (r) return Object.assign(r, { src: `가격 데이터 “${d.name}”` }); }
    const code = String(st.code || '').trim();
    if (st.market === 'KR' && /^[0-9A-Z]{6}$/.test(code)) {
      try {
        const wl = await SM.data.watchlist();
        if (wl.some((w) => w.code === code)) {
          const csv = await SM.data.pricesCsv(code);
          const p = csv ? SM.parseOHLCV(csv) : null;
          const r = p && p.data ? SM.closeOn(p.data, date) : null;
          if (r) return Object.assign(r, { src: '자동 수집 시세' });
        }
      } catch (e) { /* 없음 */ }
    }
    return null;
  };

  A.renderers.backtest = function () {
    const tabs = `<div class="grpseg-wrap"><div class="seg2 grpseg"><button class="${bt.simTab !== 'paper' ? 'on' : ''}" data-act="simTab" data-v="bt">전략 백테스트</button><button class="${bt.simTab === 'paper' ? 'on' : ''}" data-act="simTab" data-v="paper">가상 매매 현황</button></div></div>`;
    return tabs + (bt.simTab === 'paper' ? A.paperOverview() : A.renderers.btMain());
  };
  A.afterRender.backtest = ((orig) => function () { if (bt.simTab !== 'paper' && orig) orig(); })(A.afterRender.backtest);

  // 가상 매매 vs 백테스트 비교
  Object.assign(A.handlers, {
    simTab: (el) => { bt.simTab = el.dataset.v; A.render(); window.scrollTo(0, 0); },
    btStockRepo: async () => {
      const st = A.getState().stocks.find((x) => x.id === bt.stockId);
      const code = st ? String(st.code || '').trim() : '';
      const wl = await SM.data.watchlist(true);
      if (!/^[0-9A-Z]{6}$/.test(code) || !wl.some((w) => w.code === code)) return toast('이 종목은 자동 수집 대상이 아닙니다. 설정 > 자동 수집에서 대상에 추가하거나 파일로 불러오세요.', true);
      A.btLoadRepo(code);
    },
    btStockFile: () => { bt.imp.stockId = bt.stockId; const inp = document.querySelector('input[data-change=btFiles]'); if (inp) inp.click(); },
    paperCompare: async (el) => {
      const st = A.getState().stocks.find((x) => x.id === el.dataset.id);
      const stt = A.getState();
      const stats = SM.paperStats(st, stt.settings);
      if (stats.empty) return toast('가상 매매 기록이 없습니다', true);
      try { await A.btRepoEnsureFor(st); } catch (e) { /* 무시 */ }
      const ds = allDS();
      const cand = Object.entries(ds).filter(([, x]) => x.data).sort((a, b) => ((b[1].stockId === st.id) - (a[1].stockId === st.id)) || ((b[1].added || 0) - (a[1].added || 0)));
      if (!cand.length) return toast('비교하려면 먼저 시뮬레이션에서 이 종목의 가격 데이터를 불러오세요.', true);
      if (!stt.strategies.length) return toast('비교하려면 먼저 시뮬레이션에서 전략을 만들어 이름을 붙여 저장하세요.', true);
      A.openModal(`<h3>가상 매매 vs 백테스트 · ${esc(st.name)}</h3>
        <label>가격 데이터<select name="ds">${cand.map(([id, d]) => `<option value="${id}">${esc(dsLabel(id, d))} (${d.data.d[0]} ~ ${d.data.d[d.data.d.length - 1]})</option>`).join('')}</select></label>
        <label>전략<select name="strat">${stt.strategies.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></label>
        <p class="hint">비교 기간은 첫 가상 매매일(${stats.firstDate})부터 가격 데이터의 마지막 날까지입니다.</p>
        <div id="cmpOut"></div>
        <div class="btns"><button class="btn primary" type="submit">비교 실행</button><button class="btn" type="button" data-act="closeModal">닫기</button></div>`, (fd) => {
        const d = ds[fd.get('ds')], sObj = stt.strategies.find((x) => x.id === fd.get('strat'));
        const out = document.getElementById('cmpOut');
        const last = d.data.d[d.data.d.length - 1], from = stats.firstDate;
        if (from > last) { out.innerHTML = `<p class="hint warn">${ic('alert')} 가격 데이터가 첫 가상 매매일보다 앞에서 끝납니다.</p>`; return; }
        const cfg = Object.assign(clone(sObj.cfg), { from, to: last, market: st.market });
        const res = SM.runBacktest(d.data, cfg, stt.settings);
        const bh = SM.buyHoldFrom(d.data, from, stats.peak, stt.settings, st.market);
        const cur = SM.curOf(st), na = '<span class="muted">-</span>';
        if (res.error) { out.innerHTML = `<p class="hint warn">${ic('alert')} ${esc(res.error)}</p>`; return; }
        const sm = res.summary;
        out.innerHTML = `<div class="tablewrap"><table class="cmpx"><thead><tr><th></th><th>가상 매매</th><th>전략 “${esc(sObj.name)}”</th><th>단순 보유</th></tr></thead><tbody>
          <tr><td>기간</td><td>${from} ~ 현재</td><td>${from} ~ ${last}</td><td>${bh ? bh.startDate + ' ~ ' + bh.endDate : na}</td></tr>
          <tr><td>최대 투입금</td><td>${fmtMoney(stats.peak, cur)}</td><td>${fmtMoney(sm.peakInvested, cur)}</td><td>${fmtMoney(stats.peak, cur)}</td></tr>
          <tr><td>총 손익</td><td>${money(stats.total, cur)}</td><td>${money(sm.total, cur)}</td><td>${bh ? money(bh.pnl, cur) : na}</td></tr>
          <tr><td>수익률</td><td>${stats.ret != null ? pct(stats.ret) : na}</td><td>${sm.retOnPeak != null ? pct(sm.retOnPeak) : na}</td><td>${bh ? pct(bh.ret) : na}</td></tr>
          <tr><td>매수 / 청산</td><td>${stats.buys} / ${stats.closed}</td><td>${sm.buyCount} / ${sm.closed}</td><td>1 / -</td></tr>
          <tr><td>최대 낙폭</td><td>${na}</td><td>${fmtMoney(sm.mdd, cur)}</td><td>${na}</td></tr></tbody></table></div>
          <p class="hint">공정한 비교가 아닐 수 있습니다. 가상 매매는 직접 입력한 가격·날짜(평가는 입력한 현재가 ${stats.priced ? '' : '— 현재가 미입력'} 기준)이고, 전략과 단순 보유는 일봉 데이터(다음 날 시가 체결 가정, 마지막 종가 평가)입니다. 사후 입력한 가상 매매는 결과를 알고 넣은 값이라 특히 조심해서 보세요.</p>`;
      }, true);
    },
  });
  Object.assign(A.changeHandlers, { btStock: (el) => { A.btPickStock(el.value); A.render(); } });

  A.inputHandlers.bt = (el) => {
    if (el.dataset.btp) { const [g, path, k] = el.dataset.btp.split('|'); const c = leafAtPath(g, path); if (c) { c[k] = el.value; condRefreshPath(g, path); } }
    else if (el.dataset.btc) bt.cfg[el.dataset.btc] = el.value;
    else if (el.dataset.btsplit) bt.splitPct = el.value;
    else if (el.dataset.rp) rpInput(el);
    else if (el.dataset.btimp) bt.imp[el.dataset.btimp] = el.value;
  };
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.btc) bt.cfg[el.dataset.btc] = el.value;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
