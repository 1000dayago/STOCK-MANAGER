/* ui-chart.js - 종목 화면의 차트 섹션(조작 버튼·지표 설정·전체 화면)과 차트 연결 */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app;
  const { esc } = A;
  const ic = SM.ic;
  const ui = A.ui;
  const KEY = 'stockmgr.chartcfg';
  const DEF = { tf: 'D', months: 6, ma: [5, 20, 60, 120], bbOn: true, bbN: 20, bbK: 2, flow: true, vol: true, earnView: 'line', earnStep: false, chg: true, chgScale: 'zero' }; // chg: 증감 패널 · chgScale: 'zero'(0 맞춘 분리) | 'same'(같은 눈금) // earnView: 'line'(선그래프) | 'table'(표) | 'off'
  const MONTHS = [[3, '3개월'], [6, '6개월'], [12, '1년'], [36, '3년'], [0, '전체']];

  // 보기 설정은 이 기기에만 기억합니다(편의 기능)
  function loadPrefs() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null'), p = Object.assign({}, DEF, o && typeof o === 'object' ? o : {});
      if (o && o.earn === false && !o.earnView) p.earnView = 'off'; // 예전 설정(영업이익 패널 끔) 이어받기
      if (!['line', 'table', 'off'].includes(p.earnView)) p.earnView = 'line';
      if (!['zero', 'same'].includes(p.chgScale)) p.chgScale = 'zero';
      p.chg = p.chg !== false;
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

  A.chartSection = (st) => {
    const open = ui.sec.chart !== undefined ? ui.sec.chart : true;
    const seg = (attr, items, cur) => `<div class="seg2 chartseg" role="group">${items.map(([v, l]) => `<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-act="${attr}" data-v="${v}">${l}</button>`).join('')}</div>`;
    return `<details class="card sec chartcard" id="chartCard" data-sec="chart" ${open ? 'open' : ''}><summary><span class="st">차트 <small class="muted">가격 · 수급</small></span><span class="chev"></span></summary><div class="sec-b">
      <div class="chartbar">
        ${seg('chartTf', [['D', '일'], ['W', '주'], ['M', '월']], prefs.tf)}
        ${seg('chartMonths', MONTHS, prefs.months)}
        <button type="button" class="btn sm" data-act="chartFull" aria-label="전체 화면">${ic('expand') || ''}전체 화면</button>
      </div>
      <div class="chartread" id="chartRead" aria-live="polite"><span class="muted">차트를 불러오는 중…</span></div>
      <div class="chartwrap" id="chartHost"></div>
      <div class="chartmsg" id="chartMsg"></div>
      <div class="earnbar" id="earnBar" hidden><span class="muted">영업이익(분기, DART)</span>${seg('chartEarn', [['line', '선그래프'], ['table', '표'], ['off', '끄기']], prefs.earnView)}</div>
      <div class="earnbar" id="chgBar" hidden><span class="muted">전년 동기 대비 증감</span>${seg('chartChg', [['on', '켜기'], ['off', '끄기']], prefs.chg ? 'on' : 'off')}${seg('chartChgScale', [['zero', '0 맞춘 분리'], ['same', '같은 눈금']], prefs.chgScale)}</div>
      <div id="earnTable"></div>
      <details class="chartopts"><summary>지표 · 패널 설정</summary>
        <div class="chartopts-b">
          <label class="chk"><input type="checkbox" data-chartopt="bbOn" ${prefs.bbOn ? 'checked' : ''}> 볼린저밴드</label>
          <div class="grid2"><label>볼린저 기간<input class="inp" data-chartopt="bbN" value="${prefs.bbN}" inputmode="numeric"></label><label>볼린저 배수<input class="inp" data-chartopt="bbK" value="${prefs.bbK}" inputmode="decimal"></label></div>
          <label>이동평균 기간 <small class="muted">(쉼표로 구분, 최대 6개)</small><input class="inp" data-chartopt="ma" value="${esc(prefs.ma.join(', '))}" inputmode="numeric" placeholder="예: 5, 20, 60, 120, 200"></label>
          <div class="row gap wrap"><label class="chk"><input type="checkbox" data-chartopt="flow" ${prefs.flow ? 'checked' : ''}> 외국인·기관·개인 수급</label><label class="chk"><input type="checkbox" data-chartopt="vol" ${prefs.vol ? 'checked' : ''}> 거래량</label><label class="chk"><input type="checkbox" data-chartopt="earnStep" ${prefs.earnStep ? 'checked' : ''}> 영업이익 선을 계단형으로(다음 공시 전까지 직전 값 유지)</label></div>
          <p class="hint">설정은 이 기기에만 저장됩니다. 주·월봉에서는 이동평균·볼린저가 주·월 단위로 계산됩니다.</p>
        </div></details>
      <p class="hint chartguide">좌우로 <b>드래그</b>하면 이동, <b>두 손가락 벌리기</b>(PC는 마우스 휠)로 확대·축소, <b>탭</b>(PC는 마우스 올리기)하면 그 날의 시세와 수급이 위에 표시됩니다. 수급 누적선은 화면에 보이는 구간의 첫 날부터 합산합니다. 영업이익 선은 <b>공시일</b> 위치의 점을 잇습니다. 맨 아래 <b>증감</b> 패널은 전년 동기 대비 영업이익·부채 증감액을 모든 분기에서 이어 보여 주며, “0 맞춘 분리”는 두 선의 0 높이를 같게 하고 각자의 눈금(영업이익 왼쪽·부채 오른쪽)을 쓰며 “같은 눈금”은 실제 크기를 그대로 비교합니다(빨강 흑자·파랑 적자, 공시일을 모르면 속이 빈 점으로 분기 말 + 45일 추정). <b>*</b>는 연간 실적에서 앞 3분기를 뺀 4분기 값이고, 차트 아래 “표”로 바꿔 분기별 숫자를 볼 수 있습니다.</p>
    </div></details>`;
  };

  function stockOf() { return A.curStock && A.curStock(); }
  function optsFor(st) {
    const sm = SM.stockSummary(st, A.getState().settings);
    const avg = st.market === 'US' ? (sm && sm.avgLocal) : sm && sm.avg;
    const lots = st.lots.filter((l) => SM.lotRem(st, l) > 0).map((l) => ({ date: l.date, no: l.no }));
    return { ma: prefs.ma, bb: { on: prefs.bbOn, n: Math.max(2, Math.min(200, Math.round(+prefs.bbN) || 20)), k: Math.max(0.5, Math.min(5, +prefs.bbK || 2)) }, flow: prefs.flow, vol: prefs.vol, earn: prefs.earnView === 'line', chg: prefs.chg, chgScale: prefs.chgScale, earnStep: !!prefs.earnStep, avg: sm && sm.qty > 0 && avg ? avg : null, lots };
  }

  // 분기 실적 표(최근 분기부터): 매출·영업이익·전년 동기 대비·영업이익률·순이익(억원)
  function earnTableHtml(quarters) {
    const rows = SM.earningsSeries(quarters).slice().sort((a, b) => (a.ym < b.ym ? 1 : -1));
    const eok = (v) => (v == null ? '-' : Math.round(v / 1e8).toLocaleString('ko-KR'));
    const cls = (v) => (v > 0 ? 'cr-up' : v < 0 ? 'cr-down' : '');
    const yc = (y) => (y.kind === 'pct' ? cls(y.pct) : y.kind === 'turn_profit' ? 'cr-up' : y.kind === 'turn_loss' ? 'cr-down' : y.kind === 'loss' ? (y.better ? 'cr-up' : 'cr-down') : '');
    const qLabel = (e) => `${e.ym.slice(2, 4)}.${Math.ceil(+e.ym.slice(5) / 3)}Q`; // 분기 말 기준 달력 분기(예: 26.3Q)
    const short = (d) => d.slice(2); // 2026-11-13 → 26-11-13
    const hasL = rows.some((e) => e.liabEok != null), sg = (v) => (v == null ? '-' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)).toLocaleString('ko-KR'));
    const pc = (v) => (v == null ? '' : ` <small class="muted">${v > 0 ? '+' : ''}${v.toFixed(0)}%</small>`);
    const head = `<th>분기</th><th>공시일</th><th>매출</th><th>영업이익</th><th title="전년 동기 대비 영업이익 증감액(억원)">증감</th><th title="전년 동기 대비 영업이익 증가율">전년비</th><th>이익률</th><th>순이익</th>` + (hasL ? `<th>부채</th><th title="전년 동기 대비 부채 증감액(억원)와 증가율">부채 증감</th><th title="부채 ÷ 자본">부채비율</th>` : '');
    const body = rows.map((e) => `<tr><td title="${esc(e.label || e.ym)}">${qLabel(e)}${e.derived ? '*' : ''}</td><td>${short(e.at)}${e.filedEst ? '<small class="muted">추정</small>' : ''}</td><td>${eok(e.revenue)}</td><td class="${cls(e.op)}"><b>${eok(e.op)}</b></td><td class="${cls(e.dOpEok)}">${sg(e.dOpEok)}</td><td class="${yc(e.yoy)}">${SM.chartYoyText(e.yoy)}</td><td>${e.margin == null ? '-' : e.margin.toFixed(1) + '%'}</td><td class="${cls(e.net)}">${eok(e.net)}</td>` + (hasL ? `<td>${e.liabEok == null ? '-' : Math.round(e.liabEok).toLocaleString('ko-KR')}</td><td>${sg(e.dLiabEok)}${pc(e.liabPct)}</td><td>${e.debtRatio == null ? '-' : e.debtRatio.toFixed(0) + '%'}</td>` : '') + '</tr>').join('');
    return `<div class="tablewrap earnwrap"><table class="mini earntable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <p class="hint">단위: 억원 · 연결 기준 우선(DART) · 증감 = 전년 동기 대비(전년이 적자여도 계산됨) · 전년비 = 영업이익 증가율 · 부채 증감의 %는 전년 동기 부채 대비 · 부채비율 = 부채 ÷ 자본 · <b>*</b> 4분기는 사업보고서(연간)에서 앞 3분기를 뺀 값 · 공시일 “추정”은 분기 말 + 45일(4분기 90일)${hasL ? '' : ' · 부채 자료는 다음 자동 수집 뒤에 표시됩니다'}</p>`;
  }
  let curQuarters = null;
  function renderEarnUi() { // 선그래프/표/끄기 선택에 맞춰 차트 패널과 표를 갱신
    const bar = document.getElementById('earnBar'), tbl = document.getElementById('earnTable');
    if (!bar || !tbl) return;
    bar.hidden = !curQuarters;
    const cb = document.getElementById('chgBar');
    if (cb) {
      cb.hidden = !curQuarters;
      cb.querySelectorAll('[data-act=chartChg]').forEach((b) => b.classList.toggle('on', b.dataset.v === (prefs.chg ? 'on' : 'off')));
      cb.querySelectorAll('[data-act=chartChgScale]').forEach((b) => b.classList.toggle('on', b.dataset.v === prefs.chgScale));
    }
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === prefs.earnView));
    tbl.innerHTML = curQuarters && prefs.earnView === 'table' ? earnTableHtml(curQuarters) : '';
    if (chart) { const st = stockOf(); chart.setConfig(Object.assign(st ? optsFor(st) : {}, { earn: prefs.earnView === 'line', chg: prefs.chg && !!curQuarters })); }
  }
  // 분기 실적(DART): 수집된 종목만. 없으면 null
  async function loadQuarters(st) {
    const code = String(st.code || '').trim();
    if (st.market !== 'KR' || !/^[0-9A-Z]{6}$/.test(code)) return null;
    const c = A.collect, info = c && c.status && c.status.stocks && c.status.stocks[code];
    if (c && c.loaded && c.status && !(info && info.fin && info.fin.ok)) return null; // 재무 수집이 안 된 종목은 요청하지 않음(404 방지)
    try { const d = await SM.data.fin(code); return d && Array.isArray(d.quarters) && d.quarters.length ? d.quarters : null; } catch (e) { return null; }
  }
  // 종목 화면이 그려진 뒤 호출: 차트 영역이 있으면 데이터를 읽어 그립니다
  A.mountChart = async () => {
    const host = document.getElementById('chartHost'), card = document.getElementById('chartCard');
    if (!host || !card) { if (chart) { chart.destroy(); chart = null; mountedFor = null; } return; }
    const st = stockOf();
    if (!st) return;
    const read = document.getElementById('chartRead'), msg = document.getElementById('chartMsg');
    const my = ++loadSeq;
    if (chart) { chart.destroy(); chart = null; }
    msg.innerHTML = '';
    const ds = A.stockDataset ? await A.stockDataset(st) : null;
    if (my !== loadSeq || !document.getElementById('chartHost')) return; // 그 사이 다른 화면으로 바뀜
    if (!ds) {
      read.innerHTML = '';
      msg.innerHTML = `<p class="hint warn">${ic('alert')} 이 종목의 가격 데이터가 없습니다. ${st.market === 'KR' ? '국내 종목이면 설정 › 자동 수집에서 <b>수집 대상 반영</b>을 하거나, ' : ''}시뮬레이션에서 CSV 파일을 불러와 이 종목에 연결하세요.</p><div class="btns"><button class="btn sm" data-act="simForStock">${ic('lab')}시뮬레이션으로 이동</button></div>`;
      return;
    }
    const target = document.getElementById('chartHost');
    chart = SM.mountStockChart(target, read, Object.assign({ onChange: null }, optsFor(st)));
    mountedFor = st.id;
    chart.state.tf = prefs.tf;
    chart.setData(ds.data);
    chart.setMonths(prefs.months);
    const quarters = await loadQuarters(st);
    if (my !== loadSeq || !chart) return;
    curQuarters = quarters || null;
    chart.setEarnings(curQuarters || []);
    renderEarnUi();
    const info = chart.state.bars, unit = ds.data.flowUnit === 'krw' ? '금액(원) 단위' : '수량(주) 단위';
    const hasFlow = ['frgn', 'inst', 'indiv'].some((k) => ds.data[k]);
    msg.innerHTML = `<small class="muted">데이터: ${esc(ds.name)} · ${ds.data.d[0]} ~ ${ds.data.d[ds.data.d.length - 1]} (${ds.data.d.length}일)${hasFlow ? ' · 수급 ' + unit : ' · 수급 없음(수급 패널은 숨겨집니다)'}${quarters ? ` · 실적(DART) ${quarters[0].ym} ~ ${quarters[quarters.length - 1].ym} ${quarters.length}분기` : ' · 영업이익 패널 없음(DART 키로 재무가 수집된 종목만 표시)'}</small>`;
  };

  const setOn = (btn) => { btn.parentNode.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn)); };
  Object.assign(A.handlers, {
    chartChg: (el) => { prefs.chg = el.dataset.v === 'on'; savePrefs(); renderEarnUi(); },
    chartChgScale: (el) => { prefs.chgScale = el.dataset.v === 'same' ? 'same' : 'zero'; savePrefs(); renderEarnUi(); },
    chartEarn: (el) => { prefs.earnView = el.dataset.v; savePrefs(); renderEarnUi(); },
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
    if (k === 'bbOn' || k === 'flow' || k === 'vol' || k === 'earnStep') prefs[k] = el.checked;
    else if (k === 'ma') { const v = parseMa(el.value); prefs.ma = v.length ? v : DEF.ma; el.value = prefs.ma.join(', '); }
    else if (k === 'bbN') { prefs.bbN = Math.max(2, Math.min(200, Math.round(+el.value) || DEF.bbN)); el.value = prefs.bbN; }
    else if (k === 'bbK') { prefs.bbK = Math.max(0.5, Math.min(5, +el.value || DEF.bbK)); el.value = prefs.bbK; }
    savePrefs();
    const st = stockOf();
    if (chart && st) chart.setConfig(optsFor(st));
  });
  A._chartPrefs = () => prefs; // 테스트용
})(typeof globalThis !== 'undefined' ? globalThis : this);
