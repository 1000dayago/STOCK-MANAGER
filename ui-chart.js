/* ui-chart.js - 종목 화면의 차트 섹션(조작 버튼·지표 설정·전체 화면)과 차트 연결 */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app;
  const { esc } = A;
  const ic = SM.ic;
  const ui = A.ui;
  const KEY = 'stockmgr.chartcfg';
  const DEF = { tf: 'D', months: 6, ma: [5, 20, 60, 120], bbOn: true, bbN: 20, bbK: 2, flow: true, vol: true, earnView: 'line', earnStep: false, chg: true, chgScale: 'zero', events: true }; // chg: 증감 패널 · chgScale: 'zero'(0 맞춘 분리) | 'same'(같은 눈금) // earnView: 'line'(선그래프) | 'table'(표) | 'off'
  const MONTHS = [[3, '3개월'], [6, '6개월'], [12, '1년'], [36, '3년'], [0, '전체']];

  // 보기 설정은 이 기기에만 기억합니다(편의 기능)
  function loadPrefs() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null'), p = Object.assign({}, DEF, o && typeof o === 'object' ? o : {});
      if (o && o.earn === false && !o.earnView) p.earnView = 'off'; // 예전 설정(영업이익 패널 끔) 이어받기
      if (!['line', 'off'].includes(p.earnView)) p.earnView = 'line'; // 표 보기는 없앰
      if (!['zero', 'same'].includes(p.chgScale)) p.chgScale = 'zero';
      p.chg = p.chg !== false; p.events = p.events !== false;
      return p;
    } catch (e) { return Object.assign({}, DEF); }
  }
  let prefs = loadPrefs();
  function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* 무시 */ } }
  function parseMa(txt) { // "5, 20, 60" → [5,20,60] (2~300, 최대 6개, 중복 제거, 정렬)
    const out = [...new Set(String(txt || '').split(/[\s,]+/).map((x) => Math.round(+x)).filter((x) => Number.isFinite(x) && x >= 2 && x <= 300))].sort((a, b) => a - b);
    return out.slice(0, 6);
  }
  A.chartParseMa = parseMa;

  let chart = null, mountedFor = null, loadSeq = 0;

  A.chartSection = (st, afterCanvas) => {
    const open = ui.sec.chart !== undefined ? ui.sec.chart : true;
    const seg = (attr, items, cur) => `<div class="seg2 chartseg" role="group">${items.map(([v, l]) => `<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-act="${attr}" data-v="${v}">${l}</button>`).join('')}</div>`;
    return `<details class="card sec chartcard" id="chartCard" data-sec="chart" ${open ? 'open' : ''}><summary><span class="st">차트 <small class="muted">가격 · 수급</small></span><span class="chev"></span></summary><div class="sec-b">
      <div class="chartbar">
        ${seg('chartTf', [['D', '일'], ['W', '주'], ['M', '월']], prefs.tf)}
        ${seg('chartMonths', MONTHS, prefs.months)}
        <button type="button" class="btn sm" data-act="chartZoomSel" id="zoomBtn" title="켠 뒤 차트를 드래그: 시작점에서 오른쪽으로 = 그 구간 확대, 왼쪽으로 = 원래 화면 (마우스는 우클릭 드래그·Shift+드래그도 가능)">구간 확대</button>
        <span class="panelbtns" role="group" aria-label="패널 켜기·끄기">
          <button type="button" class="btn sm${prefs.flow ? ' on' : ''}" data-act="chartPanel" data-v="flow" aria-pressed="${prefs.flow}" title="외국인·기관·개인 수급 패널 켜기/끄기">수급</button>
          <button type="button" class="btn sm${prefs.vol ? ' on' : ''}" data-act="chartPanel" data-v="vol" aria-pressed="${prefs.vol}" title="거래량 패널 켜기/끄기">거래량</button>
          <button type="button" class="btn sm${prefs.earnView !== 'off' ? ' on' : ''}" data-act="chartPanel" data-v="earn" id="earnBtn" aria-pressed="${prefs.earnView !== 'off'}" title="영업이익·증감 패널 켜기/끄기(DART로 수집된 종목만)" hidden>영업이익</button>
        </span>
        <button type="button" class="btn sm" data-act="chartFull" aria-label="전체 화면">${ic('expand') || ''}전체 화면</button>
      </div>
      <div class="chartread" id="chartRead" aria-live="polite"><span class="muted">차트를 불러오는 중…</span></div>
      <div class="chartwrap" id="chartHost"></div>
      ${afterCanvas || ''}
      <div class="chartmsg" id="chartMsg"></div>
      <details class="chartopts"><summary>지표 · 패널 설정</summary>
        <div class="chartopts-b">
          <label class="chk"><input type="checkbox" data-chartopt="bbOn" ${prefs.bbOn ? 'checked' : ''}> 볼린저밴드</label>
          <div class="grid2"><label>볼린저 기간<input class="inp" data-chartopt="bbN" value="${prefs.bbN}" inputmode="numeric"></label><label>볼린저 배수<input class="inp" data-chartopt="bbK" value="${prefs.bbK}" inputmode="decimal"></label></div>
          <label>이동평균 기간 <small class="muted">(쉼표로 구분, 최대 6개)</small><input class="inp" data-chartopt="ma" value="${esc(prefs.ma.join(', '))}" inputmode="numeric" placeholder="예: 5, 20, 60, 120, 200"></label>
          <div class="row gap wrap"><label class="chk"><input type="checkbox" data-chartopt="events" ${prefs.events ? 'checked' : ''}> 이슈 표시(증자·감자 등)</label><label class="chk"><input type="checkbox" data-chartopt="earnStep" ${prefs.earnStep ? 'checked' : ''}> 영업이익 선을 계단형으로(다음 공시 전까지 직전 값 유지)</label></div>
          <p class="hint">설정은 이 기기에만 저장됩니다. 주·월봉에서는 이동평균·볼린저가 주·월 단위로 계산됩니다.</p>
        </div></details>
    </div></details>`;
  };

  function zoomBtnOff() { const b = document.getElementById('zoomBtn'); if (b) { b.classList.remove('on'); b.textContent = '구간 확대'; } }
  function stockOf() { return A.curStock && A.curStock(); }
  let btCtx = null; // 시뮬레이션 결과 화면에서 쓸 때: { ds:{name,data}, code, cycles, target }
  function btOpts(c) { return { ma: prefs.ma, bb: { on: prefs.bbOn, n: Math.max(2, Math.min(200, Math.round(+prefs.bbN) || 20)), k: Math.max(0.5, Math.min(5, +prefs.bbK || 2)) }, flow: prefs.flow, vol: prefs.vol, earn: prefs.earnView === 'line', chg: prefs.chg, chgScale: prefs.chgScale, earnStep: !!prefs.earnStep, showEvents: prefs.events, onMarkerClick: c.onMarker || null, avg: null, lots: [], cycles: c.cycles || [], cycleTarget: c.target || 0 }; }
  function curOpts() { if (btCtx) return btOpts(btCtx); const st = stockOf(); return st ? optsFor(st) : null; }
  function optsFor(st) {
    const sm = SM.stockSummary(st, A.getState().settings);
    const avg = st.market === 'US' ? (sm && sm.avgLocal) : sm && sm.avg;
    const lots = st.lots.filter((l) => SM.lotRem(st, l) > 0).map((l) => ({ date: l.date, no: l.no }));
    // 매도 기록: 날짜별로 합쳐 S 원으로 표시(손익률 = 손익 ÷ 원가, 현지 통화 기준)
    const sells = (st.sales || []).map((x) => ({ date: x.date, price: x.price, qty: x.qty, pnl: x.pnlLocal, cost: (x.lines || []).reduce((a, l) => a + (l.costLocal || 0), 0), lots: (x.lines || []).map((l) => l.lotNo) })).filter((x) => x.date);
    return { onZoomDone: zoomBtnOff, showEvents: prefs.events, sells, ma: prefs.ma, bb: { on: prefs.bbOn, n: Math.max(2, Math.min(200, Math.round(+prefs.bbN) || 20)), k: Math.max(0.5, Math.min(5, +prefs.bbK || 2)) }, flow: prefs.flow, vol: prefs.vol, earn: prefs.earnView === 'line', chg: prefs.chg, chgScale: prefs.chgScale, earnStep: !!prefs.earnStep, avg: sm && sm.qty > 0 && avg ? avg : null, lots };
  }

  let curQuarters = null;
  function renderEarnUi() { // 영업이익(증감 포함) 버튼 표시와 차트 패널을 켜기/끄기 상태에 맞춤
    const eb = document.getElementById('earnBtn'), on = prefs.earnView !== 'off';
    if (eb) { eb.hidden = !curQuarters; eb.classList.toggle('on', on); eb.setAttribute('aria-pressed', String(on)); }
    if (chart) chart.setConfig(Object.assign(curOpts() || {}, { earn: on, chg: on && !!curQuarters }));
  }
  // 분기 실적(DART): 수집된 종목만. 없으면 null
  async function loadQuarters(st) {
    const code = String(st.code || '').trim();
    if (st.market !== 'KR' || !/^[0-9A-Z]{6}$/.test(code)) return null;
    const c = A.collect, info = c && c.status && c.status.stocks && c.status.stocks[code];
    if (c && c.loaded && c.status && !(info && info.fin && info.fin.ok)) return null; // 재무 수집이 안 된 종목은 요청하지 않음(404 방지)
    try { const d = await SM.data.fin(code); return d && Array.isArray(d.quarters) && d.quarters.length ? d.quarters : null; } catch (e) { return null; }
  }
  // 이슈(유상증자·무상증자·감자·분할/병합·합병/분할·CB): 수집된 DART 주요사항보고 + 가격에서 감지한 액면분할(보정) 내역
  async function loadEvents(st, ds) {
    const out = [], code = String(st.code || '').trim();
    if (st.market === 'KR' && /^[0-9A-Z]{6}$/.test(code)) { try { const d = await SM.data.events(code); if (d && Array.isArray(d.items)) for (const x of d.items) if (x && x.date && x.kind) out.push({ date: x.date, kind: String(x.kind), label: x.label || x.kind, title: x.title || '' }); } catch (e) { /* 없음 */ } }
    for (const sp of (ds && ds.data && ds.data.splits) || []) out.push({ date: sp.date, kind: '분', label: sp.factor >= 1 ? `액면분할 ${sp.factor}:1` : `액면병합 1:${Math.round(1 / sp.factor)}`, title: '가격 흐름에서 감지(이전 가격·거래량 보정)' });
    return out;
  }
  // 종목 화면이 그려진 뒤 호출: 차트 영역이 있으면 데이터를 읽어 그립니다
  A.mountChart = async (bt) => {
    const host = document.getElementById('chartHost'), card = document.getElementById('chartCard');
    if (!host || !card) { if (chart) { chart.destroy(); chart = null; mountedFor = null; } return; }
    btCtx = bt || null;
    const st = bt ? { market: bt.code ? 'KR' : '', code: bt.code || '', lots: [] } : stockOf();
    if (!st) return;
    const read = document.getElementById('chartRead'), msg = document.getElementById('chartMsg');
    const my = ++loadSeq;
    if (chart) { chart.destroy(); chart = null; }
    msg.innerHTML = '';
    const ds = bt ? bt.ds : A.stockDataset ? await A.stockDataset(st) : null;
    if (my !== loadSeq || !document.getElementById('chartHost')) return; // 그 사이 다른 화면으로 바뀜
    if (!ds) {
      read.innerHTML = '';
      msg.innerHTML = `<p class="hint warn">${ic('alert')} 이 종목의 가격 데이터가 없습니다. ${st.market === 'KR' ? '국내 종목이면 설정 › 자동 수집에서 <b>수집 대상 반영</b>을 하거나, ' : ''}시뮬레이션에서 CSV 파일을 불러와 이 종목에 연결하세요.</p><div class="btns"><button class="btn sm" data-act="simForStock">${ic('lab')}시뮬레이션으로 이동</button></div>`;
      return;
    }
    const target = document.getElementById('chartHost');
    chart = SM.mountStockChart(target, read, Object.assign({ onChange: null }, bt ? btOpts(bt) : optsFor(st)));
    mountedFor = st.id;
    chart.state.tf = prefs.tf;
    chart.setData(ds.data);
    chart.setMonths(prefs.months);
    const quarters = await loadQuarters(st);
    if (my !== loadSeq || !chart) return;
    curQuarters = quarters || null;
    chart.setEarnings(curQuarters || []);
    try { const ev = await loadEvents(st, ds); if (my === loadSeq && chart) chart.setEvents(ev); } catch (e) { /* 이슈 없이 표시 */ }
    renderEarnUi();
    const info = chart.state.bars, unit = ds.data.flowUnit === 'krw' ? '금액(원) 단위' : '수량(주) 단위';
    const hasFlow = ['frgn', 'inst', 'indiv'].some((k) => ds.data[k]);
    msg.innerHTML = `<small class="muted">데이터: ${esc(ds.name)} · ${ds.data.d[0]} ~ ${ds.data.d[ds.data.d.length - 1]} (${ds.data.d.length}일)${hasFlow ? ' · 수급 ' + unit : ' · 수급 없음(수급 패널은 숨겨집니다)'}${ds.data.splits && ds.data.splits.length ? ' · 액면분할 보정: ' + ds.data.splits.map((e) => e.date + ' ' + (e.factor >= 1 ? e.factor + '분할' : Math.round(1 / e.factor) + '병합')).join(', ') : ''}${quarters ? ` · 실적(DART) ${quarters[0].ym} ~ ${quarters[quarters.length - 1].ym} ${quarters.length}분기` : ' · 영업이익 패널 없음(DART 키로 재무가 수집된 종목만 표시)'}</small>`;
  };

  const setOn = (btn) => { btn.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn)); };
  Object.assign(A.handlers, {
    chartPanel: (el) => { // 수급·거래량·영업이익 패널 켜기/끄기(설정에 저장)
      const k = el.dataset.v;
      if (k === 'earn') { const on = prefs.earnView === 'off'; prefs.earnView = on ? 'line' : 'off'; prefs.chg = on; savePrefs(); renderEarnUi(); return; }
      if (k !== 'flow' && k !== 'vol') return;
      prefs[k] = !prefs[k]; savePrefs(); el.classList.toggle('on', prefs[k]); el.setAttribute('aria-pressed', String(prefs[k]));
      const o = curOpts(); if (chart && o) chart.setConfig(o);
    },
    chartZoomSel: () => { // 켜 두고 차트를 드래그: 오른쪽→왼쪽 확대, 왼쪽→오른쪽 원래 화면(한 번 쓰면 꺼짐)
      if (!chart) return; const b = document.getElementById('zoomBtn'), on = !chart.state.zoomSel; chart.setZoomMode(on);
      if (b) { b.classList.toggle('on', on); b.textContent = on ? '→ 확대 · ← 원래대로' : '구간 확대'; }
    },
    chartTf: (el) => { if (!chart) return; prefs.tf = el.dataset.v; savePrefs(); setOn(el); chart.setTf(prefs.tf); },
    chartMonths: (el) => { if (!chart) return; prefs.months = +el.dataset.v; savePrefs(); setOn(el); chart.setMonths(prefs.months); },
    chartFull: () => {
      const card = document.getElementById('chartCard');
      if (!card || !chart) return;
      const on = !card.classList.contains('chart-full');
      card.classList.toggle('chart-full', on); document.body.classList.toggle('chart-fullbody', on);
      const b = card.querySelector('[data-act=chartFull]'); if (b) b.lastChild.textContent = on ? '닫기' : '전체 화면';
      chart.setConfig({ full: on });
      if (on) { try { history.pushState({ chartFull: 1 }, ''); } catch (e) { /* 무시 */ } }
    },
  });
  // 전체 화면에서 뒤로가기·Esc로 닫기
  function closeFull() { const card = document.getElementById('chartCard'); if (card && card.classList.contains('chart-full')) A.handlers.chartFull(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFull(); });
  window.addEventListener('popstate', closeFull);
  window.addEventListener('resize', () => { if (chart) chart.redraw(); });

  // 지표·패널 설정 입력
  document.addEventListener('change', (e) => {
    const el = e.target, k = el && el.dataset && el.dataset.chartopt;
    if (!k) return;
    if (k === 'bbOn' || k === 'earnStep' || k === 'events') prefs[k] = el.checked;
    else if (k === 'ma') { const v = parseMa(el.value); prefs.ma = v.length ? v : DEF.ma; el.value = prefs.ma.join(', '); }
    else if (k === 'bbN') { prefs.bbN = Math.max(2, Math.min(200, Math.round(+el.value) || DEF.bbN)); el.value = prefs.bbN; }
    else if (k === 'bbK') { prefs.bbK = Math.max(0.5, Math.min(5, +el.value || DEF.bbK)); el.value = prefs.bbK; }
    savePrefs();
    const o = curOpts();
    if (chart && o) chart.setConfig(o);
  });
  // 시뮬레이션 결과 등에서 차트를 특정 날짜(구간)로 옮김. scroll이면 차트가 화면에 보이게 스크롤
  A.chartFocus = (from, to, opt) => { if (!chart) return false; const ok = chart.focusRange(from, to, opt); if (ok && opt && opt.scroll) { const c = document.getElementById('chartCard'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); } return ok; };
  A.chartRange = (from, to) => { if (chart) chart.setRange(from, to); }; // 재생 구간(S~E) 음영
  A.chartCrossDate = () => { if (!chart) return null; const st = chart.state; return st.cross != null && st.bars ? st.bars.d[st.cross] : st.lastCrossDate || null; }; // 십자선(없으면 마지막으로 가리킨 날짜)
  A.chartReveal = (date) => { if (chart) chart.setReveal(date); }; // 시뮬레이션 재생: date까지만 표시(null이면 전체)
  A.chartSetTf = (tf) => { if (!chart) return; prefs.tf = tf; savePrefs(); chart.setTf(tf); };
  A._chart = () => chart; // 테스트용
  A._chartPrefs = () => prefs; // 테스트용
})(typeof globalThis !== 'undefined' ? globalThis : this);
