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
  const bt = (A.ui.bt = { datasetId: null, cfg: SM.blankCfg(), result: null, val: null, cmp: null, warn: [], validate: false, splitPct: 70, strategyId: '', simTab: 'bt', stockId: '', imp: newImp() });
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
  const allDS = () => Object.assign({}, loadDS(), repoEntries());
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
  A.btRepoEnsureFor = async (st) => { // 이 종목이 자동 수집 대상이면 데이터를 읽어 둡니다(종가 채우기·비교용)
    const code = String(st.code || '').trim();
    if (st.market !== 'KR' || !/^\d{6}$/.test(code)) return;
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
  function typeOptions(g, selected) {
    const want = g === 'entries' ? (d) => d.use !== 'exit' : (d) => d.use !== 'entry';
    const groups = {};
    Object.entries(SM.COND_DEFS).filter(([, d]) => want(d)).forEach(([k, d]) => { (groups[d.group] = groups[d.group] || []).push([k, d.label]); });
    return (selected ? '' : '<option value="">조건 추가…</option>') + Object.entries(groups).map(([gr, list]) => `<optgroup label="${gr}">${list.map(([k, l]) => `<option value="${k}" ${k === selected ? 'selected' : ''}>${esc(l)}</option>`).join('')}</optgroup>`).join('');
  }
  function condRow(g, i, c) {
    const def = SM.COND_DEFS[c.type];
    return `<div class="cond"><select class="inp" data-change="btType" data-g="${g}" data-i="${i}">${typeOptions(g, c.type)}</select>
      ${def.params.map((p) => p.opts
        ? `<label class="mini">${p.label}<select class="inp" data-change="btParam" data-g="${g}" data-i="${i}" data-k="${p.k}">${opts(p.opts, c[p.k] != null ? c[p.k] : p.def)}</select></label>`
        : `<label class="mini">${p.label}<input class="inp" data-btp="${g}.${i}.${p.k}" value="${esc(c[p.k] != null ? c[p.k] : p.def)}" inputmode="decimal"></label>`).join('')}
      <button class="btn sm danger" type="button" data-act="btDel" data-g="${g}" data-i="${i}" aria-label="삭제">${ic('x')}</button></div>`;
  }
  const adder = (g) => `<div class="row gap wrap"><select class="inp" data-change="btAdd" data-g="${g}">${typeOptions(g, '')}</select></div>`;

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
    const usesFlow = [].concat(bt.cfg.entries.conds, bt.cfg.exits.conds).some((c) => c.type === 'flow');
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
    return `<details class="box datainfo" ${warn.length ? 'open' : ''}><summary><b>데이터 정보</b> <small class="muted">· 가격 ${inf.days}일${inf.anyFlow ? ` · 수급 ${inf.flowFrom} ~ ${inf.flowTo}` : ' · 수급 없음'}${warn.length ? ` · 확인할 점 ${warn.length}건` : ''}</small></summary>
      ${warn.map((w) => `<p class="hint warn">${ic('alert')} ${esc(w)}</p>`).join('')}
      <div class="stats-line"><b>가격</b> ${inf.from} ~ ${inf.to} (${inf.days}일) · 시가 ${inf.hasOpen ? '✓' : '✕(종가로 대체)'} · 고가/저가 ${inf.hasHL ? '✓' : '✕(종가로 대체)'} · 거래량 ${inf.hasVol ? '✓' : '✕'}</div>
      <div class="tablewrap"><table class="mini"><thead><tr><th>수급</th><th>값이 있는 날</th><th>구간</th></tr></thead><tbody>${flowRows}</tbody></table></div>
      ${inf.anyFlow ? `<div class="stats-line"><b>단위</b> ${inf.unit === 'krw' ? '금액(원) — 표는 백만 원 단위로 줄여 표시' : '수량(주)'}</div>` : ''}
      <div class="stats-line"><b>최근 ${rec.length}일</b> <small class="muted">(순매수: + 매수, − 매도)</small></div>
      <div class="tablewrap"><table class="mini"><thead><tr><th>날짜</th><th>종가</th><th>거래량</th>${sh}</tr></thead><tbody>${rec.map((r) => `<tr><td>${r.d}</td><td>${fmtNum(r.c, r.c < 100 ? 2 : 0)}</td><td>${r.v == null ? '<span class="muted">-</span>' : fmtNum(r.v, 0)}</td>${inf.anyFlow ? `<td>${fmtFlow(r.frgn, inf.unit)}</td><td>${fmtFlow(r.inst, inf.unit)}</td><td>${fmtFlow(r.indiv, inf.unit)}</td>` : ''}</tr>`).join('')}</tbody></table></div></details>`;
  }

  A.renderers.btMain = function () {
    if (!repo.loaded && !repo.loading) setTimeout(() => A.btRepoInit(), 0);
    const ds = allDS(), keys = Object.keys(ds), cur = curDS(), c = bt.cfg;
    const rangeTxt = cur ? `${cur.data.d[0]} ~ ${cur.data.d[cur.data.d.length - 1]} (${cur.data.d.length}일)` : '';
    const st = strategies();
    const imp = bt.imp;
    return `${stockPickHtml()}<section class="card"><h2>1. 데이터 불러오기 <small class="muted">(가격 · 수급)</small></h2>
      <p class="hint">증권사·거래소·포털에서 받은 <b>일봉 파일(CSV)</b>이나 화면의 <b>표를 복사해서 붙여 넣은 것</b>을 읽습니다. 제목 줄 위치와 열 이름(한글·영문)을 자동으로 찾고, 틀리면 아래에서 열을 직접 고를 수 있습니다. 가격·수급이 한 파일에 같이 있어도, 수급만 따로 있어도 됩니다. 엑셀 파일(.xlsx)은 CSV로 저장하거나 표를 복사해서 붙여 넣으세요. 데이터는 용량 때문에 이 기기에만 저장됩니다.</p>
      <div class="row gap wrap"><label class="btn file">${ic('download')}파일 선택 (여러 개 가능)<input type="file" multiple accept=".csv,.txt,.tsv,text/csv,text/plain" data-change="btFiles" hidden></label><button class="btn" type="button" data-act="btRepo">${ic('stocks')}자동 수집 데이터를 내 기기에 복사</button>
        <label class="mini">제목 줄 번호<input class="inp" data-btimp="headerLine" value="${esc(imp.headerLine)}" inputmode="numeric" placeholder="자동" style="width:90px"></label></div>
      <label>또는 여기에 붙여 넣기<textarea data-btimp="text" rows="4" placeholder="날짜,시가,고가,저가,종가,거래량&#10;2025-01-02,...">${esc(imp.text)}</textarea></label>
      <div class="btns"><button class="btn primary" data-act="btAnalyze">읽기</button>${imp.an ? '<button class="btn" data-act="btImpCancel">취소</button>' : ''}</div>
      ${imp.an ? impPanel() : ''}
      <div id="dsWarn">${bt.warn.map((w) => `<p class="hint warn">${ic('alert')} ${esc(w)}</p>`).join('')}</div>
      ${keys.length ? `<h4>저장된 데이터 ${repo.list.length ? '<small class="muted">· “자동 수집”은 복사 없이 저장소의 최신 파일을 바로 읽습니다</small>' : ''}</h4><div class="row gap wrap"><select class="inp" data-change="btDS" style="max-width:300px">${dsSelectOptions(ds, keys)}</select><span class="muted">${rangeTxt}</span>${cur && cur.repo ? '' : '<button class="btn sm danger" data-act="btDSDel">삭제</button>'}${repo.list.length ? `<button class="btn sm" type="button" data-act="btRepoRefresh">${ic('download')}저장소 새로고침</button>` : ''}</div>${bt.datasetId && !cur && isRepoId(bt.datasetId) ? '<p class="hint">저장소에서 불러오는 중…</p>' : ''}${cur && cur.repo ? `<p class="hint">${ic('info')} ${repoNote(cur)}</p>` : ''}<p class="hint">${flowStatus(cur)}</p>${dataInfoCard(cur)}` : '<p class="muted">저장된 데이터가 없습니다.</p>'}
    </section>
    <section class="card"><h2>2. 전략 설정</h2>
      <p class="hint">조건을 자유롭게 조합하세요. 만든 전략은 이름을 붙여 저장해 두고 나중에 불러오거나 서로 비교할 수 있습니다. (전략은 계정에 저장되어 동기화됩니다)</p>
      <div class="stratbar"><select class="inp" data-change="btStratPick"><option value="">저장된 전략 불러오기…</option>${st.map((x) => `<option value="${x.id}" ${bt.strategyId === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <input id="stratName" class="inp" placeholder="전략 이름" value="${esc((st.find((x) => x.id === bt.strategyId) || {}).name || '')}">
        <button class="btn sm primary" data-act="btStratSave">저장</button>${bt.strategyId ? '<button class="btn sm danger" data-act="btStratDel">삭제</button>' : ''}<button class="btn sm" data-act="btStratNew">새로 만들기</button></div>
      <div class="grid2"><label>시작일<input type="date" data-btc="from" value="${c.from}"></label><label>종료일<input type="date" data-btc="to" value="${c.to}"></label>
      <label>수수료율 기준<select data-change="btTop" data-k="market">${opts([['KR', '국내'], ['US', '해외']], c.market)}</select></label>
      <label>체결 방식<select data-change="btTop" data-k="fill">${opts([['nextOpen', '신호 다음 날 시가 (현실적)'], ['close', '신호 당일 종가 (낙관적)']], c.fill)}</select></label>
      <label>매수 단위<select data-change="btTop" data-k="qtyMode">${opts([['shares', '주 수'], ['amount', '금액']], c.qtyMode)}</select></label>
      <label>${c.qtyMode === 'amount' ? '신호당 매수 금액' : '신호당 매수 수량(주)'}<input data-btc="qty" value="${esc(c.qty)}" inputmode="decimal"></label>
      <label>순번이 쌓일 때 수량 배수<input data-btc="growth" value="${esc(c.growth)}" inputmode="decimal" placeholder="1 = 항상 같은 수량"></label>
      <label>최대 투입금 (0=제한 없음)<input data-btc="maxInvest" value="${esc(c.maxInvest)}" inputmode="decimal"></label>
      <label>최대 보유 순번 수 (0=무제한)<input data-btc="maxLots" value="${esc(c.maxLots)}" inputmode="decimal"></label></div>
      ${num(c.growth, 1) > 1 ? '<p class="hint warn">수량 배수가 1보다 크면 하락할수록 매수량이 커집니다. 하락장에서 손실이 매우 커질 수 있으니 결과의 최대 낙폭과 최대 투입금을 꼭 확인하세요.</p>' : ''}
      <h4>매수 조건 <span class="seg"><label><input type="radio" name="emode" value="AND" data-change="btMode" data-g="entries" ${c.entries.mode !== 'OR' ? 'checked' : ''}> 모두 만족(AND)</label> <label><input type="radio" name="emode" value="OR" data-change="btMode" data-g="entries" ${c.entries.mode === 'OR' ? 'checked' : ''}> 하나라도(OR)</label></span></h4>
      ${c.entries.conds.map((x, i) => condRow('entries', i, x)).join('') || '<p class="muted">매수 조건이 없습니다. 아래에서 추가하세요.</p>'}${adder('entries')}
      <h4>매도 조건 <span class="seg"><label><input type="radio" name="xmode" value="OR" data-change="btMode" data-g="exits" ${c.exits.mode !== 'AND' ? 'checked' : ''}> 하나라도(OR)</label> <label><input type="radio" name="xmode" value="AND" data-change="btMode" data-g="exits" ${c.exits.mode === 'AND' ? 'checked' : ''}> 모두 만족(AND)</label></span></h4>
      <p class="hint">“순번별” 조건은 그 순번만 팔고, 그 외 조건이 참이 되면 보유한 순번을 <b>전량 매도</b>합니다. 매도 조건이 없으면 기간 끝까지 보유하고 평가손익만 계산합니다.</p>
      ${c.exits.conds.map((x, i) => condRow('exits', i, x)).join('') || '<p class="muted">매도 조건이 없습니다.</p>'}${adder('exits')}
      <details><summary>렌코 차트 설정 (렌코 조건에 사용)</summary><div class="grid2"><label>벽돌 크기 기준<select data-change="btRenko" data-k="mode">${opts([['pct', '첫 종가의 N%'], ['fixed', '고정 금액'], ['atr', 'ATR(평균변동폭) × 배수']], c.renko.mode)}</select></label>
      <label>값 (%, 금액, 배수)<input data-btr="value" value="${esc(c.renko.value)}" inputmode="decimal"></label><label>ATR 기간<input data-btr="period" value="${esc(c.renko.period)}" inputmode="decimal"></label></div><p class="hint">일봉 종가로 만든 렌코라서 증권사 렌코 차트와 모양이 다를 수 있습니다.</p></details>
      <div class="box"><label class="chk"><input type="checkbox" data-change="btValidate" ${bt.validate ? 'checked' : ''}> <b>기간 분할 검증</b> — 앞 구간에서 만든 전략이 뒤 구간에서도 통하는지 확인</label>
        ${bt.validate ? `<div class="row gap wrap"><label class="mini">앞 구간 비율 %<input class="inp" data-btsplit="1" value="${bt.splitPct}" inputmode="numeric" style="width:90px"></label><span class="hint">전체 기간의 앞 ${bt.splitPct}%를 “설정용”, 나머지를 “검증용”으로 나눠 각각 돌립니다.</span></div>` : '<p class="hint">조건과 숫자를 마음껏 바꾸다 보면 과거에만 딱 맞는 설정이 만들어지기 쉽습니다. 이 옵션을 켜면 설정하지 않은 구간에서의 결과를 함께 보여줍니다.</p>'}</div>
      <div class="btns"><button class="btn primary" data-act="btRun" ${cur ? '' : 'disabled'}>시뮬레이션 실행</button><button class="btn" data-act="btCmp" ${cur && st.length ? '' : 'disabled'}>저장된 전략 모두 비교${st.length ? ` (${st.length}개)` : ''}</button></div></section>
      ${bt.cmp ? cmpHtml() : ''}${bt.val ? valHtml() : ''}${bt.result ? resultHtml() : ''}`;
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
        ${dest === 'new' ? `<div class="grid2"><label>데이터 이름<input class="inp" data-btimp="name" value="${esc(imp.name)}" placeholder="예: 한국전력"></label><label>시장 (수수료율 기준)<select class="inp" data-change="btImpDest" data-k="market">${opts([['KR', '국내'], ['US', '해외']], imp.market)}</select></label><label>연결할 종목 <small class="muted">(선택)</small><select class="inp" data-change="btImpDest" data-k="stockId">${stockOptions(imp.stockId)}</select></label></div>` : ''}` : ''}
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
    const bh = s.bh;
    const verdict = bh ? (s.retOnPeak > bh.ret ? `이 기간에는 전략(${fmtPct(s.retOnPeak)})이 단순 보유(${fmtPct(bh.ret)})보다 높았습니다.` : `이 기간에는 단순 보유(${fmtPct(bh.ret)})가 전략(${fmtPct(s.retOnPeak)})보다 같거나 높았습니다.`) : '매수 신호가 없어 비교할 수 없습니다.';
    return `<section class="card"><h2>3. 결과 <small class="muted">${data.d[r.startIdx]} ~ ${data.d[r.endIdx]}</small></h2>
      <div class="cards">
        <div class="stat"><span>총 손익 (평가 포함)</span><b>${money(s.total, cur)}</b><small>실현 ${fmtMoney(s.realized, cur)} · 평가 ${fmtMoney(s.unrealized, cur)}</small></div>
        <div class="stat"><span>수익률 (최대 투입금 대비)</span><b>${pct(s.retOnPeak)}</b><small>최대 투입금 ${fmtMoney(s.peakInvested, cur)}</small></div>
        <div class="stat"><span>단순 보유 수익률</span><b>${bh ? pct(bh.ret) : '-'}</b><small>${bh ? bh.startDate + ' 매수 가정' : ''}</small></div>
        <div class="stat"><span>최대 낙폭 / 최저 누적손익</span><b>${fmtMoney(s.mdd, cur)}</b><small>최저 ${fmtMoney(s.minEq, cur)}</small></div>
        <div class="stat"><span>매수 / 청산 / 보유중</span><b>${s.buyCount} / ${s.closed} / ${s.open}</b><small>${s.winRate != null ? `청산 건 승률 ${(s.winRate * 100).toFixed(0)}%` : ''}${s.avgDays != null ? ` · 평균 보유 ${s.avgDays.toFixed(0)}일` : ''}</small></div>
        <div class="stat"><span>수수료·세금 합계</span><b>${fmtMoney(s.fees, cur)}</b>${s.skipped ? `<small>투입 한도로 건너뛴 매수 ${s.skipped}회</small>` : ''}</div>
      </div>
      <p class="verdict">${verdict}</p>
      <p class="hint warn">과거 결과일 뿐 미래 수익을 보장하지 않습니다. 한 종목·한 기간 결과는 우연일 수 있으니 다른 종목·기간에서도 비슷한지 확인하세요. 일봉으로는 장중 체결 순서를 알 수 없고, 기간 끝에 남은 순번은 평가손익으로만 반영됩니다.</p>
      <div class="legend-tip" id="candleTip">차트 위에 마우스/손가락을 올리면 해당 날짜의 값이 표시됩니다.</div>
      <canvas id="btCandle" class="chart"></canvas>
      <h4>누적 손익 곡선 <small class="muted">(실현 + 평가)</small></h4><canvas id="btEquity" class="chart"></canvas>
      ${r.renko ? `<h4>렌코 차트</h4><canvas id="btRenko" class="chart"></canvas>` : ''}
      <h4>청산된 순번</h4>${r.trades.length ? `<div class="tablewrap"><table><thead><tr><th>순번</th><th>매수일</th><th>매수가</th><th>매도일</th><th>매도가</th><th>수량</th><th>손익</th><th>수익률</th><th>보유일</th><th>사유</th></tr></thead><tbody>
      ${r.trades.map((t) => `<tr><td data-label="순번"><span class="v">${t.no}번</span></td><td data-label="매수일"><span class="v">${t.buyDate}</span></td><td data-label="매수가"><span class="v">${fmtNum(t.buyPrice, 2)}</span></td><td data-label="매도일"><span class="v">${t.sellDate}</span></td><td data-label="매도가"><span class="v">${fmtNum(t.sellPrice, 2)}</span></td><td data-label="수량"><span class="v">${fmtNum(t.qty, t.qty % 1 ? 2 : 0)}</span></td><td data-label="손익"><span class="v">${money(t.pnl, cur)}</span></td><td data-label="수익률"><span class="v">${pct(t.ret)}</span></td><td data-label="보유일"><span class="v">${t.days}일</span></td><td data-label="사유"><span class="v">${t.reason}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">청산된 순번이 없습니다 (매도 조건이 없거나 아직 충족되지 않음).</p>'}</section>`;
  }

  A.afterRender.backtest = function () {
    const r = bt.result;
    if (!r) return;
    const stored = allDS()[bt.datasetId];
    if (!stored || !stored.data) return;
    const data = stored.data, cfg = r.cfg;
    const vc = cfg.entries.conds.concat(cfg.exits.conds).find((c) => c.type === 'vol');
    const canvas = document.getElementById('btCandle');
    if (canvas) SM.drawCandles(canvas, data, { from: r.startIdx, to: r.endIdx, lines: SM.overlayLines(data, cfg), buys: r.buys, sells: r.sells, volLine: vc ? num(vc.n) : 0, tip: document.getElementById('candleTip'), height: 360 });
    const eq = document.getElementById('btEquity');
    if (eq) SM.drawLine(eq, r.equity.map((e) => e.d), r.equity.map((e) => e.v));
    const rk = document.getElementById('btRenko');
    if (rk && r.renko) SM.drawRenko(rk, r.renko);
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
    btDel: (el) => { bt.cfg[el.dataset.g].conds.splice(+el.dataset.i, 1); A.render(); },
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
    btStratNew: () => { const keep = { from: bt.cfg.from, to: bt.cfg.to, market: bt.cfg.market }; bt.cfg = Object.assign(SM.blankCfg(), keep); bt.strategyId = ''; bt.result = null; bt.val = null; A.render(); },
    btRun: () => {
      const ds = curDS();
      if (!ds) return toast('먼저 가격 데이터를 불러오세요', true);
      const cfg = cfgForRun();
      const res = SM.runBacktest(ds.data, cfg, A.getState().settings);
      if (res.error) return toast(res.error, true);
      bt.result = res; bt.val = null;
      if (bt.validate) {
        const i0 = ds.data.d.findIndex((d) => d >= cfg.from), i1 = ds.data.d.length - 1 - [...ds.data.d].reverse().findIndex((d) => d <= cfg.to);
        const k = i0 + Math.max(1, Math.floor(((i1 - i0 + 1) * Math.min(95, Math.max(5, num(bt.splitPct, 70)))) / 100)) - 1;
        bt.val = SM.runSplitValidation(ds.data, cfg, A.getState().settings, ds.data.d[Math.min(k, i1 - 1)]);
        [bt.val.a, bt.val.b].forEach((x) => { if (x.cfg) { /* 기간 표시용 */ } });
      }
      A.render();
      setTimeout(() => { const e = document.getElementById('btCandle'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
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
    btAdd: (el) => { if (!el.value) return; bt.cfg[el.dataset.g].conds.push(newCond(el.value)); A.render(); },
    btType: (el) => { bt.cfg[el.dataset.g].conds[+el.dataset.i] = newCond(el.value); A.render(); },
    btParam: (el) => { bt.cfg[el.dataset.g].conds[+el.dataset.i][el.dataset.k] = el.value; },
    btMode: (el) => { bt.cfg[el.dataset.g].mode = el.value; },
    btTop: (el) => { bt.cfg[el.dataset.k] = el.value; if (el.dataset.k === 'qtyMode') A.render(); },
    btRenko: (el) => { bt.cfg.renko[el.dataset.k] = el.value; },
    btValidate: (el) => { bt.validate = el.checked; A.render(); },
    btStratPick: (el) => {
      const s = strategies().find((x) => x.id === el.value);
      if (!s) { bt.strategyId = ''; return A.render(); }
      const keep = { from: bt.cfg.from, to: bt.cfg.to };
      bt.cfg = Object.assign(clone(s.cfg), keep); bt.strategyId = s.id; bt.result = null; bt.val = null;
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
    return `<section class="card"><h2>시험할 종목 <small class="muted">관심·보유 종목에서 고르기</small></h2>
      <div class="row gap wrap"><select class="inp" data-change="btStock" style="max-width:300px" aria-label="시험할 종목">${stockOptions(bt.stockId).replace('연결 안 함', '종목 선택 (선택 사항)')}</select>
      ${st ? (linked.length ? `<span class="muted">연결된 가격 데이터: ${esc(linked.map(([, d]) => d.name).join(', '))}</span>` : `<span class="stale">연결된 가격 데이터가 없습니다</span>`) : ''}</div>
      ${st && !linked.length ? `<div class="btns"><button class="btn sm" data-act="btStockRepo">${ic('stocks')}자동 수집 시세로 불러오기</button><button class="btn sm" data-act="btStockFile">${ic('download')}파일로 불러오기</button></div><p class="hint">불러올 때 “${esc(st.name)}”에 자동으로 연결됩니다. 연결해 두면 이 종목을 고를 때 바로 그 데이터로 시험하고, 가상 매매의 “종가 채우기”와 “백테스트와 비교”에도 쓰입니다.</p>` : ''}
      ${st && linked.length ? `<p class="hint">아래 “2. 전략 설정”에서 이 종목의 데이터로 시험합니다.</p>` : ''}</section>`;
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
    if (st.market === 'KR' && /^\d{6}$/.test(code)) {
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
      if (!/^\d{6}$/.test(code) || !wl.some((w) => w.code === code)) return toast('이 종목은 자동 수집 대상이 아닙니다. 설정 > 자동 수집에서 대상에 추가하거나 파일로 불러오세요.', true);
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
    if (el.dataset.btp) { const [g, i, k] = el.dataset.btp.split('.'); const c = bt.cfg[g].conds[+i]; if (c) c[k] = el.value; }
    else if (el.dataset.btc) bt.cfg[el.dataset.btc] = el.value;
    else if (el.dataset.btr) bt.cfg.renko[el.dataset.btr] = el.value;
    else if (el.dataset.btsplit) bt.splitPct = el.value;
    else if (el.dataset.btimp) bt.imp[el.dataset.btimp] = el.value;
  };
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.btc) bt.cfg[el.dataset.btc] = el.value;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
