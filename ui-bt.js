/* ui-bt.js - 백테스트 화면 */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app;
  const { fmtNum, fmtMoney, fmtPct, num } = SM;
  const { esc, opts, money, pct, toast } = A;
  const DS_KEY = 'stockmgr.datasets';

  function loadDS() { try { return JSON.parse(localStorage.getItem(DS_KEY) || '{}'); } catch (e) { return {}; } }
  function saveDS(ds) {
    try { localStorage.setItem(DS_KEY, JSON.stringify(ds)); return true; }
    catch (e) { toast('가격 데이터를 저장할 공간이 부족합니다. 안 쓰는 데이터를 삭제하세요.', true); return false; }
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const bt = (A.ui.bt = { datasetId: null, cfg: null, result: null, cmp: null, warn: [] });
  function defaultCfg(key) { const c = clone(SM.backtestPresets()[key || 'ma'].cfg); c.from = ''; c.to = ''; return c; }
  bt.cfg = defaultCfg('ma');

  function curDS() { const ds = loadDS(); if (!bt.datasetId || !ds[bt.datasetId]) bt.datasetId = Object.keys(ds)[0] || null; return bt.datasetId ? ds[bt.datasetId] : null; }

  /* ---------- 화면 ---------- */
  function condRow(g, i, c) {
    const def = SM.COND_DEFS[c.type];
    const kind = g === 'entries' ? 'entry' : 'exit';
    const typeOpts = Object.entries(SM.COND_DEFS).filter(([, d]) => d.kind === kind).map(([k, d]) => [k, d.label]);
    return `<div class="cond"><select class="inp" data-change="btType" data-g="${g}" data-i="${i}">${opts(typeOpts, c.type)}</select>
      ${def.params.map((p) => p.opts
        ? `<label class="mini">${p.label}<select class="inp" data-change="btParam" data-g="${g}" data-i="${i}" data-k="${p.k}">${opts(p.opts, c[p.k] != null ? c[p.k] : p.def)}</select></label>`
        : `<label class="mini">${p.label}<input class="inp" data-btp="${g}.${i}.${p.k}" value="${esc(c[p.k] != null ? c[p.k] : p.def)}" inputmode="decimal"></label>`).join('')}
      <button class="btn sm danger" type="button" data-act="btDel" data-g="${g}" data-i="${i}">✕</button></div>`;
  }
  function addSel(g) {
    const kind = g === 'entries' ? 'entry' : 'exit';
    const list = Object.entries(SM.COND_DEFS).filter(([, d]) => d.kind === kind).map(([k, d]) => [k, d.label]);
    return `<div class="row gap wrap"><select class="inp" id="add_${g}">${opts(list, '')}</select><button class="btn sm" type="button" data-act="btAdd" data-g="${g}">＋ 조건 추가</button></div>`;
  }

  A.renderers.backtest = function () {
    const ds = loadDS(), keys = Object.keys(ds), cur = curDS(), c = bt.cfg;
    const rangeTxt = cur ? `${cur.data.d[0]} ~ ${cur.data.d[cur.data.d.length - 1]} (${cur.data.d.length}일)` : '';
    return `<section class="card"><h2>1. 가격 데이터 불러오기</h2>
      <p class="hint">증권사/거래소/야후 등에서 내려받은 <b>일봉 CSV</b>를 불러옵니다. 제목 줄에 날짜·시가·고가·저가·종가·거래량(한글/영문 모두 가능)이 있어야 합니다. 엑셀에서 복사한 표를 붙여 넣어도 됩니다. 가격 데이터는 이 기기에만 저장됩니다(동기화 안 됨).</p>
      <div class="grid2"><label>데이터 이름<input id="dsName" placeholder="예: 한국전력 2025"></label><label>시장 (수수료율 기준)<select id="dsMarket">${opts([['KR', '국내'], ['US', '해외']], 'KR')}</select></label></div>
      <label class="chk"><input type="checkbox" id="dsAdj" checked> 수정종가(Adj Close) 열이 있으면 그 기준으로 보정</label>
      <div class="row gap wrap"><label class="btn file">CSV/텍스트 파일 선택<input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" data-change="btFile" hidden></label></div>
      <label>또는 여기에 붙여 넣기<textarea id="dsPaste" rows="4" placeholder="날짜,시가,고가,저가,종가,거래량&#10;2025-01-02,..."></textarea></label>
      <div class="btns"><button class="btn primary" data-act="btPaste">붙여 넣은 데이터 저장</button></div>
      <div id="dsWarn">${bt.warn.map((w) => `<p class="hint warn">⚠ ${esc(w)}</p>`).join('')}</div>
      ${keys.length ? `<h4>저장된 데이터</h4><div class="row gap wrap"><select class="inp" data-change="btDS">${opts(keys.map((k) => [k, ds[k].name]), bt.datasetId)}</select><span class="muted">${rangeTxt}</span><button class="btn sm danger" data-act="btDSDel">삭제</button></div>` : '<p class="muted">저장된 데이터가 없습니다.</p>'}
    </section>
    <section class="card"><h2>2. 전략 설정</h2>
      <p class="hint">프리셋을 누르면 해당 기법의 기본 조건이 채워집니다. 그 뒤 숫자를 자유롭게 바꿔 보세요.</p>
      <div class="row gap wrap">${Object.entries(SM.backtestPresets()).map(([k, p]) => `<button class="btn sm" data-act="btPreset" data-k="${k}">${p.name}</button>`).join('')}</div>
      <div class="grid2"><label>시작일<input type="date" data-btc="from" value="${c.from}"></label><label>종료일<input type="date" data-btc="to" value="${c.to}"></label>
      <label>수수료율 기준<select data-change="btTop" data-k="market">${opts([['KR', '국내'], ['US', '해외']], c.market)}</select></label>
      <label>체결 방식<select data-change="btTop" data-k="fill">${opts([['nextOpen', '신호 다음 날 시가 (현실적)'], ['close', '신호 당일 종가 (낙관적)']], c.fill)}</select></label>
      <label>매수 단위<select data-change="btTop" data-k="qtyMode">${opts([['shares', '주 수'], ['amount', '금액']], c.qtyMode)}</select></label>
      <label>${c.qtyMode === 'amount' ? '신호당 매수 금액' : '신호당 매수 수량(주)'}<input data-btc="qty" value="${esc(c.qty)}" inputmode="decimal"></label>
      <label>최대 보유 순번 수 (0=무제한)<input data-btc="maxLots" value="${esc(c.maxLots)}" inputmode="decimal"></label></div>
      <h4>매수 조건 <span class="seg"><label><input type="radio" name="emode" value="AND" data-change="btMode" data-g="entries" ${c.entries.mode !== 'OR' ? 'checked' : ''}> 모두 만족(AND)</label> <label><input type="radio" name="emode" value="OR" data-change="btMode" data-g="entries" ${c.entries.mode === 'OR' ? 'checked' : ''}> 하나라도(OR)</label></span></h4>
      ${c.entries.conds.map((x, i) => condRow('entries', i, x)).join('') || '<p class="muted">조건이 없습니다.</p>'}${addSel('entries')}
      <h4>매도 조건 <small class="muted">(여러 개면 먼저 충족되는 쪽으로 매도 · 없으면 끝까지 보유)</small></h4>
      ${c.exits.conds.map((x, i) => condRow('exits', i, x)).join('') || '<p class="muted">매도 조건이 없습니다. 기간 끝까지 보유하고 평가손익만 계산합니다.</p>'}${addSel('exits')}
      <details><summary>렌코 차트 설정</summary><div class="grid2"><label>벽돌 크기 기준<select data-change="btRenko" data-k="mode">${opts([['pct', '첫 종가의 N%'], ['fixed', '고정 금액'], ['atr', 'ATR(평균변동폭) × 배수']], c.renko.mode)}</select></label>
      <label>값 (%, 금액, 배수)<input data-btr="value" value="${esc(c.renko.value)}" inputmode="decimal"></label><label>ATR 기간<input data-btr="period" value="${esc(c.renko.period)}" inputmode="decimal"></label></div><p class="hint">일봉 종가로 만든 렌코라서 증권사 렌코 차트와 모양이 다를 수 있습니다.</p></details>
      <div class="btns"><button class="btn primary" data-act="btRun" ${cur ? '' : 'disabled'}>시뮬레이션 실행</button><button class="btn" data-act="btCmp" ${cur ? '' : 'disabled'}>4가지 기법 한 번에 비교</button></div></section>
      ${bt.cmp ? cmpHtml() : ''}${bt.result ? resultHtml() : ''}`;
  };

  function cmpHtml() {
    const cur = bt.cmpCur || 'KRW';
    return `<section class="card"><h2>기법 비교 <small class="muted">(같은 데이터·기간·수량·체결 방식)</small></h2><div class="tablewrap"><table><thead><tr><th>기법</th><th>매수</th><th>청산/보유</th><th>총 손익</th><th>수익률(최대 투입 대비)</th><th>최대 낙폭</th><th>수수료·세금</th><th>단순 보유</th></tr></thead><tbody>
      ${bt.cmp.map((r) => r.res.error ? `<tr><td>${r.name}</td><td colspan="7" class="muted">${esc(r.res.error)}</td></tr>` : `<tr><td data-label="기법"><span class="v">${r.name}</span></td><td data-label="매수"><span class="v">${r.res.summary.buyCount}</span></td><td data-label="청산/보유"><span class="v">${r.res.summary.closed}/${r.res.summary.open}</span></td><td data-label="총 손익"><span class="v">${money(r.res.summary.total, cur)}</span></td><td data-label="수익률"><span class="v">${pct(r.res.summary.retOnPeak)}</span></td><td data-label="최대 낙폭"><span class="v">${fmtMoney(r.res.summary.mdd, cur)}</span></td><td data-label="수수료"><span class="v">${fmtMoney(r.res.summary.fees, cur)}</span></td><td data-label="단순 보유"><span class="v">${r.res.summary.bh ? pct(r.res.summary.bh.ret) : '-'}</span></td></tr>`).join('')}
      </tbody></table></div><p class="hint">단순 보유: 전략의 최대 투입금과 같은 금액을 첫 매수일에 한 번에 사서 끝까지 보유했을 때의 수익률입니다. 기법이 이 수치보다 낮다면 그냥 보유하는 편이 나았다는 뜻입니다.</p></section>`;
  }

  function resultHtml() {
    const r = bt.result, s = r.summary, cur = r.cfg.market === 'US' ? 'USD' : 'KRW';
    const data = loadDS()[bt.datasetId].data;
    const bh = s.bh;
    const verdict = bh ? (s.retOnPeak > bh.ret ? `이 기간에는 기법(${fmtPct(s.retOnPeak)})이 단순 보유(${fmtPct(bh.ret)})보다 높았습니다.` : `이 기간에는 단순 보유(${fmtPct(bh.ret)})가 기법(${fmtPct(s.retOnPeak)})보다 같거나 높았습니다.`) : '매수 신호가 없어 비교할 수 없습니다.';
    return `<section class="card"><h2>3. 결과 <small class="muted">${data.d[r.startIdx]} ~ ${data.d[r.endIdx]}</small></h2>
      <div class="cards">
        <div class="stat"><span>총 손익 (평가 포함)</span><b>${money(s.total, cur)}</b><small>실현 ${fmtMoney(s.realized, cur)} · 평가 ${fmtMoney(s.unrealized, cur)}</small></div>
        <div class="stat"><span>수익률 (최대 투입금 대비)</span><b>${pct(s.retOnPeak)}</b><small>최대 투입금 ${fmtMoney(s.peakInvested, cur)}</small></div>
        <div class="stat"><span>단순 보유 수익률</span><b>${bh ? pct(bh.ret) : '-'}</b><small>${bh ? bh.startDate + ' 매수 가정' : ''}</small></div>
        <div class="stat"><span>최대 낙폭 / 최저 누적손익</span><b>${fmtMoney(s.mdd, cur)}</b><small>최저 ${fmtMoney(s.minEq, cur)}</small></div>
        <div class="stat"><span>매수 / 청산 / 보유중</span><b>${s.buyCount} / ${s.closed} / ${s.open}</b><small>${s.winRate != null ? `청산 건 승률 ${(s.winRate * 100).toFixed(0)}%` : ''}${s.avgDays != null ? ` · 평균 보유 ${s.avgDays.toFixed(0)}일` : ''}</small></div>
        <div class="stat"><span>수수료·세금 합계</span><b>${fmtMoney(s.fees, cur)}</b></div>
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
    const stored = loadDS()[bt.datasetId];
    if (!stored) return;
    const data = stored.data, cfg = r.cfg;
    const palette = ['#2563eb', '#d97706', '#9333ea', '#0891b2', '#be185d', '#65a30d'];
    const lines = [], seen = new Set();
    let pi = 0;
    const conds = [].concat(cfg.entries.conds, cfg.exits.conds);
    for (const c of conds) {
      if (['maCross', 'maAbove', 'maCrossDn'].includes(c.type)) {
        for (const n of [num(c.s, 5), num(c.l, 20)]) { const key = 'ma' + n; if (seen.has(key)) continue; seen.add(key); lines.push({ name: 'MA' + n, arr: SM.sma(data.c, n), color: palette[pi++ % palette.length] }); }
      }
      if (['bbTouch', 'bbUpper'].includes(c.type)) {
        const key = `bb${c.n}_${c.k}`; if (seen.has(key)) continue; seen.add(key);
        const b = SM.bollinger(data.c, num(c.n, 20), num(c.k, 2));
        lines.push({ name: 'BB상단', arr: b.up, color: '#64748b', dash: [4, 3] }, { name: '', arr: b.mid, color: '#94a3b8', dash: [2, 3] }, { name: 'BB하단', arr: b.lo, color: '#64748b', dash: [4, 3] });
      }
    }
    const vc = cfg.entries.conds.find((c) => c.type === 'vol');
    const canvas = document.getElementById('btCandle');
    if (canvas) SM.drawCandles(canvas, data, { from: r.startIdx, to: r.endIdx, lines, buys: r.buys, sells: r.sells, volLine: vc ? num(vc.n) : 0, tip: document.getElementById('candleTip'), height: 360 });
    const eq = document.getElementById('btEquity');
    if (eq) SM.drawLine(eq, r.equity.map((e) => e.d), r.equity.map((e) => e.v));
    const rk = document.getElementById('btRenko');
    if (rk && r.renko) SM.drawRenko(rk, r.renko);
  };

  /* ---------- 데이터 저장 ---------- */
  function storeText(text, fileName) {
    const adj = document.getElementById('dsAdj') ? document.getElementById('dsAdj').checked : true;
    const res = SM.parseOHLCV(text, { useAdj: adj });
    if (res.error) { bt.warn = []; A.render(); toast(res.error, true); return; }
    const nameEl = document.getElementById('dsName');
    const name = (nameEl && nameEl.value.trim()) || (fileName || '').replace(/\.[^.]+$/, '') || '데이터 ' + new Date().toLocaleDateString('ko-KR');
    const market = document.getElementById('dsMarket') ? document.getElementById('dsMarket').value : 'KR';
    const ds = loadDS();
    const id = SM.uid();
    ds[id] = { name, market, added: Date.now(), data: res.data };
    if (!saveDS(ds)) return;
    bt.datasetId = id; bt.result = null; bt.cmp = null; bt.cfg.market = market;
    bt.warn = [`${name}: ${res.count}일치 (${res.data.d[0]} ~ ${res.data.d[res.count - 1]}) 불러왔습니다.`].concat(res.warnings);
    A.render(); toast('불러왔습니다');
  }
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
    btPaste: () => { const t = document.getElementById('dsPaste').value; if (!t.trim()) return toast('붙여 넣을 내용이 없습니다', true); storeText(t, ''); },
    btDSDel: () => { if (!confirm('이 가격 데이터를 삭제할까요?')) return; const ds = loadDS(); delete ds[bt.datasetId]; saveDS(ds); bt.datasetId = null; bt.result = null; bt.cmp = null; A.render(); },
    btPreset: (el) => { const keep = { from: bt.cfg.from, to: bt.cfg.to, market: bt.cfg.market, qty: bt.cfg.qty, qtyMode: bt.cfg.qtyMode, maxLots: bt.cfg.maxLots, fill: bt.cfg.fill }; bt.cfg = Object.assign(defaultCfg(el.dataset.k), keep); A.render(); },
    btAdd: (el) => {
      const g = el.dataset.g, type = document.getElementById('add_' + g).value;
      const c = { type }; SM.COND_DEFS[type].params.forEach((p) => (c[p.k] = p.def));
      bt.cfg[g].conds.push(c); A.render();
    },
    btDel: (el) => { bt.cfg[el.dataset.g].conds.splice(+el.dataset.i, 1); A.render(); },
    btRun: () => {
      const ds = curDS();
      if (!ds) return toast('먼저 가격 데이터를 불러오세요', true);
      const res = SM.runBacktest(ds.data, cfgForRun(), A.getState().settings);
      if (res.error) return toast(res.error, true);
      bt.result = res; A.render();
      setTimeout(() => { const e = document.getElementById('btCandle'); if (e) e.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    },
    btCmp: () => {
      const ds = curDS();
      if (!ds) return toast('먼저 가격 데이터를 불러오세요', true);
      const base = cfgForRun();
      bt.cmp = Object.values(SM.backtestPresets()).map((p) => {
        const c = Object.assign(clone(p.cfg), { from: base.from, to: base.to, market: base.market, qty: base.qty, qtyMode: base.qtyMode, maxLots: base.maxLots, fill: base.fill, renko: clone(base.renko) });
        return { name: p.name, res: SM.runBacktest(ds.data, c, A.getState().settings) };
      });
      bt.cmpCur = base.market === 'US' ? 'USD' : 'KRW';
      A.render();
    },
  });
  Object.assign(C, {
    btFile: (el) => {
      const f = el.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => storeText(decode(rd.result), f.name);
      rd.readAsArrayBuffer(f);
    },
    btDS: (el) => { bt.datasetId = el.value; bt.result = null; bt.cmp = null; bt.cfg.from = ''; bt.cfg.to = ''; A.render(); },
    btType: (el) => {
      const g = el.dataset.g, i = +el.dataset.i, type = el.value;
      const c = { type }; SM.COND_DEFS[type].params.forEach((p) => (c[p.k] = p.def));
      bt.cfg[g].conds[i] = c; A.render();
    },
    btParam: (el) => { bt.cfg[el.dataset.g].conds[+el.dataset.i][el.dataset.k] = el.value; },
    btMode: (el) => { bt.cfg[el.dataset.g].mode = el.value; },
    btTop: (el) => { bt.cfg[el.dataset.k] = el.value; if (el.dataset.k === 'qtyMode') A.render(); },
    btRenko: (el) => { bt.cfg.renko[el.dataset.k] = el.value; },
  });
  A.inputHandlers.bt = (el) => {
    if (el.dataset.btp) { const [g, i, k] = el.dataset.btp.split('.'); bt.cfg[g].conds[+i][k] = el.value; }
    else if (el.dataset.btc) bt.cfg[el.dataset.btc] = el.value;
    else if (el.dataset.btr) bt.cfg.renko[el.dataset.btr] = el.value;
  };
  // date input 은 change 로 들어옴
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.btc) bt.cfg[el.dataset.btc] = el.value;
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
