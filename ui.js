/* ui.js - 화면(종목/매도/손익/계산기/설정) */
(function (root) {
  'use strict';
  const SM = root.SM;
  const { fmtNum, fmtMoney, fmtPct, num, todayStr } = SM;
  const KEY = 'stockmgr.v1';
  const A = (SM.app = { renderers: {}, handlers: {}, changeHandlers: {}, inputHandlers: {}, afterRender: {} });

  let state = SM.newState();
  const ui = (A.ui = {
    view: 'stocks', stockId: null, showSold: false, selected: new Set(),
    pnl: { group: 'month', stockId: 'all', from: '', to: '' },
    calc: { market: 'KR', baseQty: '', baseAvg: '', feeOn: true, buys: [{ qty: '', price: '' }, { qty: '', price: '' }], target: '', tprice: '', beAvg: '' },
  });
  A.getState = () => state;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cls = (v) => (v > 0 ? 'gain' : v < 0 ? 'loss' : '');
  const money = (v, cur) => `<span class="${cls(v)}">${fmtMoney(v, cur)}</span>`;
  const pct = (v) => `<span class="${cls(v)}">${fmtPct(v)}</span>`;
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
  Object.assign(A, { esc, cls, money, pct, opts });

  /* ---------- 저장/불러오기 ---------- */
  function load() {
    try { state = SM.normalizeState(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { state = SM.newState(); }
    if (!ui.stockId && state.stocks[0]) ui.stockId = state.stocks[0].id;
  }
  function save() {
    state.updatedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('이 기기에 저장하지 못했습니다 (저장 공간 부족/차단). 백업을 내려받아 주세요.', true); }
    SM.sync.schedulePush();
  }
  A.save = save;
  const curStock = () => state.stocks.find((s) => s.id === ui.stockId) || null;
  A.curStock = curStock;

  /* ---------- 토스트/모달 ---------- */
  let toastTimer;
  function toast(msg, err) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.className = 'show' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.className = ''), err ? 5000 : 2600);
  }
  let modalSubmit = null;
  function openModal(html, onSubmit, wide) {
    const r = document.getElementById('modal-root');
    r.innerHTML = `<div class="overlay"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><form id="mform" autocomplete="off">${html}</form></div></div>`;
    modalSubmit = onSubmit;
    const f = r.querySelector('input:not([type=hidden]):not([type=checkbox]),select');
    if (f && !wide) f.focus();
  }
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; modalSubmit = null; A.sell = null; }
  Object.assign(A, { toast, openModal, closeModal });
  function ask(title, label, def, cb) {
    openModal(`<h3>${esc(title)}</h3><label>${esc(label)}<input name="v" value="${esc(def)}" inputmode="decimal"></label><div class="btns"><button class="btn primary" type="submit">확인</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => cb(fd.get('v')));
  }

  /* ---------- 헤더/내비 ---------- */
  const VIEWS = [['stocks', '종목'], ['pnl', '손익'], ['calc', '계산기'], ['backtest', '백테스트'], ['settings', '설정']];
  function syncBadge() {
    const s = SM.sync.S;
    const map = { off: ['이 기기에만 저장', 'off'], connecting: ['연결 중', 'warn'], signedout: ['로그인 필요', 'warn'], syncing: ['동기화 중', 'warn'], synced: ['동기화됨', 'ok'], error: ['동기화 오류', 'err'] };
    const [t, c] = map[s.status] || map.off;
    return `<button class="badge ${c}" data-act="goSettings" title="${esc(s.msg)}">${t}</button>`;
  }
  function renderChrome(body) {
    return `<header class="top"><div class="brand">📈 주식 관리</div><nav class="nav-top">${VIEWS.map(([k, l]) => `<button class="${ui.view === k ? 'on' : ''}" data-act="nav" data-v="${k}">${l}</button>`).join('')}</nav><span id="syncBadgeBox">${syncBadge()}</span></header>
    <main>${body}</main>
    <nav class="nav-bottom">${VIEWS.map(([k, l]) => `<button class="${ui.view === k ? 'on' : ''}" data-act="nav" data-v="${k}">${l}</button>`).join('')}</nav>`;
  }

  function render() {
    document.body.classList.toggle('up-green', state.settings.upColor === 'green');
    const fn = A.renderers[ui.view] || A.renderers.stocks;
    const keepScroll = window.scrollY;
    document.getElementById('app').innerHTML = renderChrome(fn());
    if (A.afterRender[ui.view]) A.afterRender[ui.view]();
    window.scrollTo(0, keepScroll);
  }
  A.render = render;

  /* ---------- 종목 화면 ---------- */
  A.renderers.stocks = function () {
    const st = curStock();
    let h = `<div class="tabs">${state.stocks.map((s) => `<button class="tab ${s.id === ui.stockId ? 'on' : ''}" data-act="tab" data-id="${s.id}">${esc(s.name)}${s.market === 'US' ? ' <small>US</small>' : ''}</button>`).join('')}<button class="tab add" data-act="addStock">＋ 종목 추가</button></div>`;
    if (!st) {
      return h + `<section class="card empty"><h2>시작하기</h2><p>종목을 추가하면 종목마다 탭이 만들어지고, 매수할 때마다 <b>순번(1번, 2번…)</b>이 따로 기록됩니다.</p><p><button class="btn primary" data-act="addStock">첫 종목 추가</button></p><p class="muted">여러 기기에서 쓰려면 <a href="#" data-act="goSettings">설정</a>에서 Firebase 동기화를 연결하세요. 연결 전에는 이 기기에만 저장됩니다.</p></section>`;
    }
    const cur = SM.curOf(st), us = st.market === 'US';
    const sm = SM.stockSummary(st, state.settings);
    const realized = st.sales.reduce((a, s) => a + s.pnlKRW, 0);
    h += `<section class="card"><div class="row between"><div><h2>${esc(st.name)} <small class="muted">${esc(st.code)} · ${us ? '해외(USD)' : '국내(KRW)'}</small></h2></div>
      <div class="row gap"><button class="btn sm" data-act="editStock">수정</button><button class="btn sm danger" data-act="delStock">삭제</button></div></div>
      <div class="row gap wrap pricebox"><label>현재가 (${cur})<input class="inp" data-change="price" value="${st.price == null ? '' : st.price}" inputmode="decimal" placeholder="직접 입력"></label>
      ${us ? `<label>현재 환율 (원/$) <input class="inp" data-change="fxNow" value="${state.settings.fxNow}" inputmode="decimal"></label>` : ''}</div>
      <div class="cards">
        <div class="stat"><span>보유 수량</span><b>${fmtNum(sm.qty, sm.qty % 1 ? 4 : 0)}주</b></div>
        <div class="stat"><span>전체 평단가</span><b>${fmtMoney(sm.avg, cur)}</b><small>수수료 포함 ${fmtMoney(sm.avgInclFee, cur)}${us && sm.avgKRW ? `<br>원화 ${fmtMoney(sm.avgKRW, 'KRW')}` : ''}</small></div>
        <div class="stat"><span>총 매입금</span><b>${fmtMoney(sm.cost, cur)}</b>${us ? `<small>${fmtMoney(sm.costKRW, 'KRW')}</small>` : ''}</div>
        <div class="stat"><span>평가손익${us ? ' (원화)' : ''}</span><b>${sm.value != null ? money(sm.unrlKRW, 'KRW') + ' ' + pct(sm.unrlRetKRW) : '<span class="muted">현재가 입력</span>'}</b>${us && sm.value != null ? `<small>달러 ${money(sm.unrl, 'USD')} ${pct(sm.unrlRet)}</small>` : ''}</div>
        <div class="stat"><span>누적 실현손익</span><b>${money(realized, 'KRW')}</b><small>${st.sales.length}건</small></div>
      </div></section>`;
    // 순번 표
    const lots = st.lots.slice().sort((a, b) => a.no - b.no);
    const visible = lots.filter((l) => ui.showSold || SM.lotRem(st, l) > 0);
    const selLots = lots.filter((l) => ui.selected.has(l.id) && SM.lotRem(st, l) > 0);
    let selBar = '';
    if (selLots.length) {
      const q = selLots.reduce((a, l) => a + SM.lotRem(st, l), 0);
      const amt = selLots.reduce((a, l) => a + SM.lotRem(st, l) * l.price, 0);
      const amtF = selLots.reduce((a, l) => a + SM.lotRem(st, l) * (l.price + SM.lotFeePerShare(l)), 0);
      const avg = amt / q, avgF = amtF / q;
      selBar = `<div class="selbar">선택 ${selLots.map((l) => l.no + '번').join('·')} 합산: <b>${fmtNum(q, q % 1 ? 4 : 0)}주</b> · 평단 <b>${fmtMoney(avg, cur)}</b> (수수료 포함 ${fmtMoney(avgF, cur)})${st.price ? ` · 현재가 대비 ${pct((st.price - avgF) / avgF)}` : ''}</div>`;
    }
    h += `<section class="card"><div class="row between wrap"><h2>매수 순번</h2><div class="row gap wrap">
      <button class="btn primary" data-act="addLot">＋ 매수 추가</button>
      <button class="btn" data-act="mergeSel" ${selLots.length < 2 ? 'disabled' : ''}>선택 병합</button>
      <button class="btn accent" data-act="openSell" ${sm.qty > 0 ? '' : 'disabled'}>매도 / 시뮬레이션</button></div></div>
      ${selBar}
      <label class="chk"><input type="checkbox" data-change="showSold" ${ui.showSold ? 'checked' : ''}> 매도 완료된 순번도 보기</label>
      <div class="tablewrap"><table class="lots"><thead><tr><th></th><th>순번</th><th>매수일</th><th>매수가</th><th>수량(잔여/전체)</th><th>수수료</th><th>현재 수익률</th><th>평가손익</th><th>보유일</th><th></th></tr></thead><tbody>
      ${visible.length ? visible.map((l) => lotRow(st, l, cur, us)).join('') : `<tr><td colspan="10" class="muted center">매수 기록이 없습니다. “＋ 매수 추가”를 눌러 첫 순번을 기록하세요.</td></tr>`}
      </tbody></table></div>
      <p class="hint">수익률은 매수 수수료를 포함한 원가 기준이며 매도 비용(수수료·세금)은 매도/시뮬레이션 화면에서 반영됩니다.${us ? ' 해외주식은 달러 기준과 원화(환율 반영) 기준을 함께 표시합니다.' : ''}</p></section>`;
    h += `<section class="card"><h2>매도 기록</h2>${st.sales.length ? `<div class="tablewrap"><table><thead><tr><th>매도일</th><th>매도가</th><th>수량</th><th>사용 순번</th><th>실현손익(원)</th><th>수익률</th><th></th></tr></thead><tbody>
      ${st.sales.slice().reverse().map((s) => `<tr><td data-label="매도일"><span class="v">${s.date}</span></td><td data-label="매도가"><span class="v">${fmtMoney(s.price, cur)}${us ? `<br><small class="muted">환율 ${fmtNum(s.fx, 2)}</small>` : ''}</span></td><td data-label="수량"><span class="v">${fmtNum(s.qty, s.qty % 1 ? 4 : 0)}</span></td><td data-label="사용 순번"><span class="v">${s.lines.map((l) => `${l.lotNo}번×${fmtNum(l.qty, l.qty % 1 ? 4 : 0)}`).join(', ')}</span></td><td data-label="실현손익"><span class="v">${money(s.pnlKRW, 'KRW')}</span></td><td data-label="수익률"><span class="v">${pct(s.costKRW > 0 ? s.pnlKRW / s.costKRW : null)}</span></td><td><button class="btn sm danger" data-act="delSale" data-id="${s.id}">삭제</button></td></tr>`).join('')}
      </tbody></table></div><p class="hint">매도 기록을 삭제하면 해당 순번의 잔여 수량이 원래대로 돌아옵니다.</p>` : '<p class="muted">아직 매도 기록이 없습니다.</p>'}</section>`;
    return h;
  };

  function lotRow(st, l, cur, us) {
    const v = SM.lotView(st, l, state.settings);
    const done = v.rem <= 0;
    const days = SM.daysBetween(l.date, todayStr());
    const retTxt = v.ret != null ? (us ? `${pct(v.ret)}<br><small>원화 ${pct(v.retKRW)}</small>` : pct(v.ret)) : '<span class="muted">-</span>';
    const unrlTxt = v.unrl != null ? (us ? `${money(v.unrlKRW, 'KRW')}<br><small>${money(v.unrl, 'USD')}</small>` : money(v.unrl, 'KRW')) : '<span class="muted">-</span>';
    const sold = SM.lotSold(st, l.id) > 0;
    return `<tr class="${done ? 'done' : ''}">
      <td data-label="">${done ? '' : `<input type="checkbox" data-change="selLot" data-id="${l.id}" ${ui.selected.has(l.id) ? 'checked' : ''}>`}</td>
      <td data-label="순번"><span class="v"><b class="no">${l.no}번</b>${l.parts ? ' <small class="tag">병합</small>' : ''}${l.note ? `<br><small class="muted">${esc(l.note)}</small>` : ''}</span></td>
      <td data-label="매수일"><span class="v">${l.date}</span></td>
      <td data-label="매수가"><span class="v">${fmtMoney(l.price, cur)}${us ? `<br><small class="muted">환율 ${fmtNum(l.fx, 2)}</small>` : ''}</span></td>
      <td data-label="수량"><span class="v">${done ? '<span class="muted">매도완료</span>' : fmtNum(v.rem, v.rem % 1 ? 4 : 0)} <small class="muted">/ ${fmtNum(l.qty, l.qty % 1 ? 4 : 0)}</small></span></td>
      <td data-label="수수료"><span class="v">${fmtMoney(l.fee, cur)}</span></td>
      <td data-label="현재 수익률"><span class="v">${done ? '-' : retTxt}</span></td><td data-label="평가손익"><span class="v">${done ? '-' : unrlTxt}</span></td>
      <td data-label="보유일"><span class="v">${days}일</span></td>
      <td class="acts"><button class="btn sm" data-act="editLot" data-id="${l.id}">수정</button>
        ${!sold && l.qty > 1 ? `<button class="btn sm" data-act="splitLot" data-id="${l.id}">분할</button>` : ''}
        ${l.parts && !sold ? `<button class="btn sm" data-act="unmerge" data-id="${l.id}">병합취소</button>` : ''}
        ${!sold ? `<button class="btn sm danger" data-act="delLot" data-id="${l.id}">삭제</button>` : ''}</td></tr>`;
  }

  /* ---------- 종목/순번 폼 ---------- */
  function stockForm(st) {
    openModal(`<h3>${st ? '종목 수정' : '종목 추가'}</h3>
      <label>종목명<input name="name" value="${esc(st ? st.name : '')}" required placeholder="예: 한국전력"></label>
      <label>종목코드/티커 (선택)<input name="code" value="${esc(st ? st.code : '')}" placeholder="예: 015760 / AAPL"></label>
      <label>시장<select name="market" ${st && st.lots.length ? 'disabled' : ''}>${opts([['KR', '국내 (원화)'], ['US', '해외 (달러, 환율 기록)']], st ? st.market : 'KR')}</select></label>
      ${st && st.lots.length ? '<p class="hint">매수 기록이 있는 종목은 시장을 바꿀 수 없습니다.</p>' : ''}
      <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => {
      const name = String(fd.get('name') || '').trim();
      if (!name) return toast('종목명을 입력하세요', true);
      if (st) { st.name = name; st.code = fd.get('code') || ''; if (!st.lots.length) st.market = fd.get('market'); }
      else { const ns = SM.newStock({ name, code: fd.get('code'), market: fd.get('market') }); state.stocks.push(ns); ui.stockId = ns.id; }
      save(); closeModal(); render();
    });
  }
  function lotForm(st, lot) {
    const us = st.market === 'US', cur = SM.curOf(st);
    openModal(`<h3>${lot ? lot.no + '번 수정' : '매수 추가'} · ${esc(st.name)}</h3>
      <div class="grid2"><label>매수일<input type="date" name="date" value="${lot ? lot.date : todayStr()}" required></label>
      <label>매수가 (${cur})<input name="price" value="${lot ? lot.price : ''}" inputmode="decimal" required></label>
      <label>수량(주)<input name="qty" value="${lot ? lot.qty : ''}" inputmode="decimal" required></label>
      ${us ? `<label>매수 환율 (원/$)<input name="fx" value="${lot ? lot.fx : state.settings.fxNow}" inputmode="decimal"></label>` : ''}
      <label>매수 수수료 (${cur})<input name="fee" value="${lot ? lot.fee : ''}" inputmode="decimal" placeholder="비우면 설정 요율로 자동"></label>
      <label>메모<input name="note" value="${esc(lot ? lot.note : '')}" placeholder="선택"></label></div>
      ${lot && lot.parts ? '<p class="hint warn">병합된 순번을 수정하면 “병합 취소”로 되돌릴 수 없게 됩니다.</p>' : ''}
      <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => {
      const f = Object.fromEntries(fd.entries());
      try { if (lot) SM.updateLot(st, lot.id, f, state.settings); else SM.addLot(st, f, state.settings); }
      catch (e) { return toast(e.message, true); }
      save(); closeModal(); render(); toast(lot ? '수정했습니다' : '매수를 기록했습니다');
    });
  }

  /* ---------- 매도 / 시뮬레이션 ---------- */
  function openSell(st) {
    const us = st.market === 'US', cur = SM.curOf(st);
    const lots = st.lots.filter((l) => SM.lotRem(st, l) > 0).sort((a, b) => a.no - b.no);
    A.sell = { stockId: st.id };
    openModal(`<h3>매도 / 시뮬레이션 · ${esc(st.name)}</h3>
      <p class="hint">“매도 기록 저장”을 누르기 전까지는 아무것도 기록되지 않는 시뮬레이션입니다.</p>
      <div class="grid2">
        <label>매도일<input type="date" id="sDate" value="${todayStr()}"></label>
        <label>매도가 (${cur})<input id="sPrice" value="${st.price || ''}" inputmode="decimal" placeholder="예상 매도가"></label>
        ${us ? `<label>매도 환율 (원/$)<input id="sFx" value="${state.settings.fxNow}" inputmode="decimal"></label>` : ''}
        <label>매도 수수료<input id="sFee" inputmode="decimal" placeholder="비우면 자동"></label>
        <label>세금(거래세)<input id="sTax" inputmode="decimal" placeholder="비우면 자동"></label></div>
      <div class="box"><b>N주를 한 번에 배분</b> <span class="muted">(그 뒤 개별 수량을 직접 고칠 수 있습니다)</span>
        <div class="row gap wrap"><input id="sTotal" class="inp" inputmode="decimal" placeholder="총 매도 수량" style="max-width:130px">
        <select id="sStrat" class="inp"><option value="fifo">먼저 산 순번부터</option><option value="high">매수가 높은 순번부터</option><option value="low">매수가 낮은 순번부터</option><option value="pro">평단 비례(모든 순번에서 고르게)</option></select>
        <button class="btn" type="button" data-act="sellFill">자동 배분</button><button class="btn" type="button" data-act="sellAll">전량</button></div></div>
      <div class="tablewrap"><table class="sell"><thead><tr><th></th><th>순번</th><th>매수가</th><th>잔여</th><th>매도 수량</th><th>순번별 손익(원)</th><th>수익률</th></tr></thead><tbody>
      ${lots.map((l) => `<tr class="sellrow" data-lot="${l.id}"><td><input type="checkbox" class="schk" ${ui.selected.has(l.id) ? 'checked' : ''}></td><td><b>${l.no}번</b></td><td>${fmtMoney(l.price, cur)}</td><td>${fmtNum(SM.lotRem(st, l), 4).replace(/\.?0+$/, '')}</td>
      <td><input class="sq inp" inputmode="decimal" value="${ui.selected.has(l.id) ? SM.lotRem(st, l) : ''}" style="width:90px"></td><td class="spnl">-</td><td class="sret">-</td></tr>`).join('')}
      </tbody></table></div>
      <div id="sellOut"></div>
      <div class="btns"><button class="btn primary" type="submit">매도 기록 저장</button><button class="btn" type="button" data-act="closeModal">닫기</button></div>`,
      () => saveSale(st), true);
    sellRefresh();
  }
  function sellRead(st) {
    const q = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
    const lines = [];
    document.querySelectorAll('.sellrow').forEach((tr) => {
      const lot = st.lots.find((l) => l.id === tr.dataset.lot);
      let v = num(tr.querySelector('.sq').value);
      const rem = SM.lotRem(st, lot);
      const bad = v > rem + 1e-9;
      tr.querySelector('.sq').classList.toggle('bad', bad);
      if (bad) v = rem;
      if (v > 0) lines.push({ lotId: lot.id, qty: v });
    });
    return { lines, p: { price: q('sPrice'), date: q('sDate') || todayStr(), fx: q('sFx'), sellFee: q('sFee'), tax: q('sTax') } };
  }
  function sellRefresh() {
    const st = state.stocks.find((s) => s.id === (A.sell || {}).stockId);
    if (!st) return;
    const cur = SM.curOf(st), us = st.market === 'US';
    const { lines, p } = sellRead(st);
    const out = document.getElementById('sellOut');
    document.querySelectorAll('.sellrow').forEach((tr) => { tr.querySelector('.spnl').textContent = '-'; tr.querySelector('.sret').textContent = '-'; });
    if (!(num(p.price) > 0)) { out.innerHTML = '<p class="muted">매도가를 입력하면 순번별 손익이 계산됩니다.</p>'; return; }
    if (!lines.length) { out.innerHTML = '<p class="muted">매도할 순번의 수량을 입력하거나 체크하세요.</p>'; return; }
    const c = SM.computeSale(st, lines, p, state.settings);
    c.lines.forEach((l) => {
      const tr = document.querySelector(`.sellrow[data-lot="${l.lotId}"]`);
      tr.querySelector('.spnl').innerHTML = money(l.pnlKRW, 'KRW');
      tr.querySelector('.sret').innerHTML = pct(l.retKRW);
    });
    const rem = SM.remainingAfter(st, lines);
    const avgBase = c.costLocal / c.totalQty;
    const compare = ['fifo', 'high', 'low', 'pro'].map((k) => ({ k, name: { fifo: '먼저 산 순서', high: '비싸게 산 것부터', low: '싸게 산 것부터', pro: '평단 비례' }[k], lines: Object.entries(SM.allocate(st, c.totalQty, k)).map(([lotId, qty]) => ({ lotId, qty })) }));
    compare.unshift({ k: 'cur', name: '지금 선택한 구성', lines });
    const rows = compare.map((x) => {
      const r = SM.computeSale(st, x.lines, p, state.settings);
      const re = SM.remainingAfter(st, x.lines);
      return { x, r, re };
    });
    const best = Math.max(...rows.map((o) => o.r.pnlKRW));
    out.innerHTML = `<div class="result"><h4>이번 매도 결과</h4>
      <div class="cards small">
        <div class="stat"><span>매도 수량</span><b>${fmtNum(c.totalQty, c.totalQty % 1 ? 4 : 0)}주</b></div>
        <div class="stat"><span>매도 금액</span><b>${fmtMoney(c.proceeds, cur)}</b>${us ? `<small>${fmtMoney(c.proceeds * c.fx, 'KRW')}</small>` : ''}</div>
        <div class="stat"><span>수수료·세금</span><b>${fmtMoney(c.sellFee + c.tax, cur)}</b><small>매도 시</small></div>
        <div class="stat"><span>실현손익 (원)</span><b>${money(c.pnlKRW, 'KRW')} ${pct(c.retKRW)}</b>${us ? `<small>달러 ${money(c.pnlLocal, 'USD')} ${pct(c.retLocal)}</small>` : ''}</div>
        <div class="stat"><span>선택 순번 합산 평단</span><b>${fmtMoney(avgBase, cur)}</b><small>수수료 포함 원가 기준</small></div>
        <div class="stat"><span>매도 후 남는 수량</span><b>${fmtNum(rem.qty, rem.qty % 1 ? 4 : 0)}주</b><small>${rem.qty > 0 ? '평단 ' + fmtMoney(rem.avg, cur) : ''}</small></div>
      </div>
      <h4>배분 방식 비교 <small class="muted">(같은 수량·같은 매도가)</small></h4>
      <div class="tablewrap"><table class="cmp"><thead><tr><th>방식</th><th>사용 순번</th><th>실현손익(원)</th><th>수익률</th><th>남는 수량</th><th>남는 평단</th></tr></thead><tbody>
      ${rows.map(({ x, r, re }) => `<tr class="${Math.abs(r.pnlKRW - best) < 0.5 ? 'best' : ''}"><td>${x.name}</td><td>${x.lines.map((l) => st.lots.find((q) => q.id === l.lotId).no + '번×' + fmtNum(l.qty, l.qty % 1 ? 2 : 0)).join(', ')}</td><td>${money(r.pnlKRW, 'KRW')}</td><td>${pct(r.retKRW)}</td><td>${fmtNum(re.qty, re.qty % 1 ? 2 : 0)}주</td><td>${re.avg ? fmtMoney(re.avg, cur) : '-'}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="hint">이번 매도로 실현되는 손익이 큰 방식이 곧 유리한 선택은 아닙니다. 어느 순번을 팔아도 전체를 모두 매도했을 때의 총손익은 같고, 방식에 따라 <b>지금 확정되는 손익과 남는 물량의 평단·손익이 달라질 뿐</b>입니다. 세금 규정은 별도로 확인하세요.${us ? ' 해외주식 양도세는 연간 합산으로 계산되므로 여기서는 매도 건별 세금을 0으로 두었습니다(손익 화면에서 연간 추정).' : ''}</p></div>`;
  }
  function saveSale(st) {
    const { lines, p } = sellRead(st);
    if (!(num(p.price) > 0)) return toast('매도가를 입력하세요', true);
    if (!lines.length) return toast('매도할 수량을 입력하세요', true);
    if (us(st) && !(num(p.fx) > 0)) return toast('매도 환율을 입력하세요', true);
    const c = SM.computeSale(st, lines, p, state.settings);
    if (!confirm(`${c.lines.map((l) => l.lotNo + '번×' + l.qty).join(', ')}\n${fmtMoney(c.price, SM.curOf(st))} 에 매도, 실현손익 ${fmtMoney(c.pnlKRW, 'KRW')}\n\n기록할까요?`)) return;
    SM.recordSale(st, c);
    if (!st.price) st.price = c.price;
    ui.selected.clear();
    save(); closeModal(); render(); toast('매도를 기록했습니다');
  }
  const us = (st) => st.market === 'US';

  /* ---------- 손익 화면 ---------- */
  A.renderers.pnl = function () {
    const f = ui.pnl;
    const rep = SM.pnlReport(state, f);
    const stockOpts = [['all', '전체 종목']].concat(state.stocks.map((s) => [s.id, s.name]));
    let unrlTot = 0, unrlRows = '';
    for (const s of state.stocks) {
      const sm = SM.stockSummary(s, state.settings);
      if (sm.qty > 0 && sm.value != null) { unrlTot += sm.unrlKRW; unrlRows += `<tr><td>${esc(s.name)}</td><td>${fmtNum(sm.qty)}주</td><td>${money(sm.unrlKRW, 'KRW')}</td><td>${pct(sm.unrlRetKRW)}</td></tr>`; }
      else if (sm.qty > 0) unrlRows += `<tr><td>${esc(s.name)}</td><td>${fmtNum(sm.qty)}주</td><td colspan="2" class="muted">현재가 미입력</td></tr>`;
    }
    const gl = { month: '월별', year: '연도별', stock: '종목별', all: '기간 합계' }[f.group];
    return `<section class="card"><h2>실현 손익</h2>
      <div class="filters"><label>보기<select data-change="pnlf" data-k="group">${opts([['month', '월별'], ['year', '연도별'], ['stock', '종목별'], ['all', '기간 합계']], f.group)}</select></label>
      <label>종목<select data-change="pnlf" data-k="stockId">${opts(stockOpts, f.stockId)}</select></label>
      <label>시작일<input type="date" data-change="pnlf" data-k="from" value="${f.from}"></label>
      <label>종료일<input type="date" data-change="pnlf" data-k="to" value="${f.to}"></label></div>
      <div class="cards small"><div class="stat"><span>실현손익 (수수료·세금 반영, 원화)</span><b>${money(rep.total.pnlKRW, 'KRW')}</b></div>
      <div class="stat"><span>수익률 (매입 원가 대비)</span><b>${pct(rep.total.ret)}</b></div>
      <div class="stat"><span>매도 건수 / 이익 건수</span><b>${rep.total.count} / ${rep.total.wins}</b></div>
      <div class="stat"><span>수수료·세금 합계</span><b>${fmtMoney(rep.total.feesKRW, 'KRW')}</b></div></div>
      ${rep.groups.length ? `<canvas id="pnlChart" class="chart"></canvas>
      <div class="tablewrap"><table><thead><tr><th>${gl}</th><th>매도 건수</th><th>매도 금액(순)</th><th>매입 원가</th><th>수수료·세금</th><th>실현손익</th><th>수익률</th></tr></thead><tbody>
      ${rep.groups.map((g) => `<tr><td data-label="${gl}"><span class="v">${esc(g.key)}</span></td><td data-label="건수"><span class="v">${g.count}</span></td><td data-label="매도 금액"><span class="v">${fmtMoney(g.proceedsKRW, 'KRW')}</span></td><td data-label="매입 원가"><span class="v">${fmtMoney(g.costKRW, 'KRW')}</span></td><td data-label="수수료·세금"><span class="v">${fmtMoney(g.feesKRW, 'KRW')}</span></td><td data-label="실현손익"><span class="v">${money(g.pnlKRW, 'KRW')}</span></td><td data-label="수익률"><span class="v">${pct(g.ret)}</span></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted">조건에 맞는 매도 기록이 없습니다.</p>'}
      <p class="hint">“매도 금액(순)”은 매도 수수료·세금을 뺀 금액이고, 매입 원가에는 매수 수수료가 포함됩니다. 해외주식은 매수·매도 시점의 환율이 반영된 원화 기준입니다.</p></section>
      ${rep.usTax.length ? `<section class="card"><h2>해외주식 양도소득세 추정</h2><div class="tablewrap"><table><thead><tr><th>연도</th><th>해외 실현손익(원)</th><th>기본공제 후 과세표준</th><th>추정 세액</th><th>공제 여유</th></tr></thead><tbody>
      ${rep.usTax.map((t) => `<tr><td>${t.year}</td><td>${money(t.pnlKRW, 'KRW')}</td><td>${fmtMoney(t.taxable, 'KRW')}</td><td>${fmtMoney(t.tax, 'KRW')}</td><td>${fmtMoney(t.remainDeduction, 'KRW')}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint warn">단순 추정입니다 (연간 해외주식 실현손익 합계 − 공제 ${fmtMoney(state.settings.us.deduction, 'KRW')}, 세율 ${state.settings.us.taxRate}%). 실제 신고는 증권사 자료와 세법 기준을 따르세요.</p></section>` : ''}
      <section class="card"><h2>평가 손익 (보유 중)</h2>${unrlRows ? `<div class="tablewrap"><table><thead><tr><th>종목</th><th>수량</th><th>평가손익(원)</th><th>수익률</th></tr></thead><tbody>${unrlRows}<tr class="total"><td colspan="2">합계(현재가 입력된 종목)</td><td>${money(unrlTot, 'KRW')}</td><td></td></tr></tbody></table></div>` : '<p class="muted">보유 중인 종목이 없습니다.</p>'}
      <p class="hint">평가손익은 아직 확정되지 않은 값이며 매도 수수료·세금은 반영되지 않았습니다. 실현손익과 합치지 않고 따로 보는 것을 권합니다.</p></section>`;
  };
  A.afterRender.pnl = function () {
    const c = document.getElementById('pnlChart');
    if (!c) return;
    const rep = SM.pnlReport(state, ui.pnl);
    SM.drawBars(c, rep.groups.map((g) => g.key), rep.groups.map((g) => g.pnlKRW));
  };

  /* ---------- 계산기 ---------- */
  A.renderers.calc = function () {
    const c = ui.calc;
    return `<section class="card"><h2>평단가 계산기</h2>
      <p class="hint">“이 종목을 몇 주 더 사면 평단이 얼마가 되는지” 계산합니다. 저장되는 값이 아니라 계산용입니다.</p>
      <div class="grid2"><label>종목에서 불러오기<select data-change="calcLoad"><option value="">직접 입력</option>${state.stocks.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label>시장 (수수료율)<select data-calc="market">${opts([['KR', '국내'], ['US', '해외']], c.market)}</select></label>
      <label>현재 보유 수량<input data-calc="baseQty" value="${esc(c.baseQty)}" inputmode="decimal"></label>
      <label>현재 평단가<input data-calc="baseAvg" value="${esc(c.baseAvg)}" inputmode="decimal"></label></div>
      <h4>추가 매수 계획</h4>
      ${c.buys.map((b, i) => `<div class="row gap buyrow"><span class="idx">${i + 1}</span><input class="inp" data-calcbuy="${i}.qty" value="${esc(b.qty)}" inputmode="decimal" placeholder="수량"><input class="inp" data-calcbuy="${i}.price" value="${esc(b.price)}" inputmode="decimal" placeholder="매수가"><button class="btn sm danger" type="button" data-act="calcDel" data-i="${i}">✕</button></div>`).join('')}
      <div class="row gap"><button class="btn" data-act="calcAdd">＋ 매수 추가</button><label class="chk"><input type="checkbox" data-calc="feeOn" ${c.feeOn ? 'checked' : ''}> 매수 수수료 포함</label></div>
      <div id="calcOut" class="result"></div></section>
      <section class="card"><h2>목표 평단가 역산</h2><p class="hint">목표 평단가에 도달하려면 특정 가격에 몇 주를 더 사야 하는지 계산합니다. (위의 현재 보유 수량/평단 사용)</p>
      <div class="grid2"><label>목표 평단가<input data-calc="target" value="${esc(c.target)}" inputmode="decimal"></label><label>매수 가격<input data-calc="tprice" value="${esc(c.tprice)}" inputmode="decimal"></label></div><div id="targetOut" class="result"></div></section>
      <section class="card"><h2>손익분기 매도가</h2><p class="hint">평단을 넣으면 매도 수수료·세금까지 감안해 본전이 되는 가격을 계산합니다.</p>
      <div class="grid2"><label>평단가(수수료 포함 원가)<input data-calc="beAvg" value="${esc(c.beAvg)}" inputmode="decimal"></label></div><div id="beOut" class="result"></div></section>`;
  };
  A.afterRender.calc = calcOut;
  function calcOut() {
    const c = ui.calc, rates = SM.ratesOf(state.settings, c.market);
    const r = SM.avgCalc({ baseQty: c.baseQty, baseAvg: c.baseAvg, buys: c.buys, feeRate: c.feeOn ? rates.buyFee : 0 });
    const el = document.getElementById('calcOut');
    if (!el) return;
    const base = num(c.baseQty) * num(c.baseAvg);
    el.innerHTML = r.qty > 0 ? `<div class="cards small"><div class="stat"><span>총 수량</span><b>${fmtNum(r.qty, r.qty % 1 ? 4 : 0)}주</b></div><div class="stat"><span>새 평단가</span><b>${fmtNum(r.avg, 2)}</b>${num(c.baseAvg) > 0 ? `<small>기존 대비 ${pct(r.avg / num(c.baseAvg) - 1)}</small>` : ''}</div><div class="stat"><span>총 투입금</span><b>${fmtNum(r.cost)}</b><small>추가 투입 ${fmtNum(r.cost - base)}</small></div></div>` : '<p class="muted">수량과 가격을 입력하세요.</p>';
    const t = SM.qtyForTarget({ baseQty: c.baseQty, baseAvg: c.baseAvg, target: c.target, price: c.tprice });
    const te = document.getElementById('targetOut');
    if (te) te.innerHTML = !(num(c.target) > 0 && num(c.tprice) > 0) ? '<p class="muted">목표 평단가와 매수 가격을 입력하세요.</p>' : t.ok ? `<div class="cards small"><div class="stat"><span>필요 수량</span><b>${fmtNum(t.qty)}주</b></div><div class="stat"><span>추가 투입금</span><b>${fmtNum(t.qty * num(c.tprice))}</b></div></div>` : `<p class="hint warn">${t.msg}</p>`;
    const be = document.getElementById('beOut');
    if (be) { const v = SM.breakEvenPrice({ avg: c.beAvg, sellFeePct: rates.sellFee, taxPct: rates.sellTax }); be.innerHTML = num(c.beAvg) > 0 ? `<div class="stat"><span>손익분기 매도가</span><b>${fmtNum(v, 2)}</b><small>매도 수수료 ${rates.sellFee}% + 세금 ${rates.sellTax}% 반영</small></div>` : '<p class="muted">평단가를 입력하세요.</p>'; }
  }

  /* ---------- 설정 ---------- */
  function syncCard() {
    const S = SM.sync.S, sy = SM.sync;
    if (!S.cfg) {
      return `<h3>기기 간 동기화 (Firebase)</h3><p class="hint">PC와 휴대폰에서 같은 데이터를 쓰려면 Firebase 설정값을 붙여 넣으세요. 설정값은 <b>이 기기의 브라우저에만</b> 저장되며 기기마다 한 번씩 붙여 넣으면 됩니다. 만드는 방법은 아래 “Firebase 준비 방법”을 보세요.</p>
        <textarea id="fbCfg" rows="7" placeholder='const firebaseConfig = {\n  apiKey: "...",\n  authDomain: "...firebaseapp.com",\n  projectId: "...",\n  appId: "..."\n};'></textarea>
        <div class="btns"><button class="btn primary" data-act="fbSave">설정값 저장</button></div>`;
    }
    const email = S.user ? esc(S.user.email || S.user.displayName || S.user.uid) : '';
    return `<h3>기기 간 동기화 (Firebase)</h3>
      <p class="syncmsg ${S.status}">${esc(S.msg || '')}${S.status === 'connecting' ? '' : ''}</p>
      ${S.user ? `<p>로그인: <b>${email}</b></p><div class="btns"><button class="btn" data-act="fbPush">지금 서버에 저장</button><button class="btn" data-act="fbOut">로그아웃</button></div>`
        : (S.fb ? `<div class="btns"><button class="btn primary" data-act="fbGoogle">Google로 로그인</button></div>
        <div class="grid2"><label>이메일<input id="fbEmail" type="email" autocomplete="username"></label><label>비밀번호 (6자 이상)<input id="fbPw" type="password" autocomplete="current-password"></label></div>
        <div class="btns"><button class="btn" data-act="fbLogin">이메일 로그인</button><button class="btn" data-act="fbSignup">이메일 가입</button></div>` : '')}
      <div class="btns"><button class="btn danger sm" data-act="fbClear">설정값 지우기</button></div>`;
  }
  A.syncCard = syncCard;
  const RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}`;
  A.renderers.settings = function () {
    const s = state.settings;
    const f = (path, label, step) => `<label>${label}<input class="inp" data-setting="${path}" value="${path.split('.').reduce((o, k) => o[k], s)}" inputmode="decimal"></label>`;
    return `<section class="card"><h2>수수료 · 세금 (%)</h2><p class="hint warn">아래 기본값은 예시입니다. 실제 요율은 증권사·시기에 따라 다르므로 직접 확인해서 고쳐 주세요. 이미 기록된 매도 건은 <b>매도 당시의 금액이 그대로 보존</b>되고, 바꾼 요율은 이후 계산에만 적용됩니다.</p>
      <div class="cols"><div><h4>국내</h4><div class="grid2">${f('kr.buyFee', '매수 수수료')}${f('kr.sellFee', '매도 수수료')}${f('kr.sellTax', '매도 거래세 등')}</div></div>
      <div><h4>해외</h4><div class="grid2">${f('us.buyFee', '매수 수수료')}${f('us.sellFee', '매도 수수료')}${f('us.sellTax', '매도 시 기타 세금')}${f('us.taxRate', '양도세율')}${f('us.deduction', '연 기본공제(원)')}</div></div></div>
      <div class="grid2">${f('fxNow', '현재 환율 (원/$)')}<label>수익 색상<select data-setting="upColor">${opts([['red', '수익=빨강, 손실=파랑 (한국식)'], ['green', '수익=초록, 손실=빨강 (해외식)']], s.upColor)}</select></label></div></section>
      <section class="card" id="syncCard">${syncCard()}</section>
      <section class="card"><h2>백업 / 복원</h2><p class="hint">동기화를 쓰더라도 정기적으로 백업 파일을 받아두세요. (브라우저 데이터 삭제, 로그인 문제에 대비)</p>
      <div class="btns"><button class="btn primary" data-act="export">백업 내려받기 (JSON)</button><label class="btn file">백업 불러오기<input type="file" accept=".json,application/json" data-change="import" hidden></label></div>
      <div class="btns"><button class="btn danger" data-act="wipe">이 기기의 모든 데이터 삭제</button></div></section>
      <section class="card"><details><summary><b>Firebase 준비 방법 (처음 한 번)</b></summary>
      <ol class="steps"><li><a href="https://console.firebase.google.com" target="_blank" rel="noopener">Firebase 콘솔</a>에서 프로젝트를 만듭니다 (Google Analytics는 꺼도 됩니다).</li>
      <li><b>Authentication → 시작하기 → Sign-in method</b>에서 <b>Google</b>과 <b>이메일/비밀번호</b>를 사용 설정합니다.</li>
      <li>Authentication → <b>Settings → Authorized domains</b>에 이 앱 주소의 도메인(예: <code>${esc(location.hostname || '아이디.github.io')}</code>)을 추가합니다.</li>
      <li><b>Firestore Database → 데이터베이스 만들기</b> (프로덕션 모드, 지역은 가까운 곳).</li>
      <li>Firestore <b>규칙(Rules)</b> 탭에 아래 내용을 붙여 넣고 <b>게시</b>합니다. 이 규칙이 “내 계정만 내 데이터 접근”을 보장하는 유일한 장치입니다.<pre id="rulesTxt">${esc(RULES)}</pre><button class="btn sm" data-act="copyRules">규칙 복사</button></li>
      <li>프로젝트 설정(톱니바퀴) → <b>일반 → 내 앱 → 웹 앱(&lt;/&gt;) 추가</b> 후 나오는 <code>firebaseConfig</code> 블록을 위 칸에 붙여 넣습니다.</li></ol></details></section>
      <section class="card"><h2>이 앱에 대하여</h2><p class="hint">휴대폰에서는 브라우저 메뉴의 “홈 화면에 추가”로 앱처럼 설치할 수 있습니다. 백테스트용 가격 데이터는 용량 때문에 동기화되지 않고 기기별로 저장됩니다. 이 앱의 계산 결과는 참고용이며 투자 판단과 세금 신고의 책임은 사용자에게 있습니다.</p></section>`;
  };

  /* ---------- 이벤트 ---------- */
  const H = A.handlers;
  Object.assign(H, {
    nav: (el) => { ui.view = el.dataset.v; render(); window.scrollTo(0, 0); },
    goSettings: () => { ui.view = 'settings'; render(); },
    tab: (el) => { ui.stockId = el.dataset.id; ui.selected.clear(); render(); },
    addStock: () => stockForm(null),
    editStock: () => stockForm(curStock()),
    delStock: () => {
      const st = curStock();
      if (!confirm(`“${st.name}” 종목을 삭제할까요?\n\n매수 ${st.lots.length}건과 매도 기록 ${st.sales.length}건, 이 종목의 실현손익 기록이 모두 삭제됩니다. 되돌릴 수 없습니다.`)) return;
      state.stocks = state.stocks.filter((s) => s.id !== st.id);
      ui.stockId = state.stocks[0] ? state.stocks[0].id : null; ui.selected.clear();
      save(); render();
    },
    addLot: () => lotForm(curStock(), null),
    editLot: (el) => { const st = curStock(); lotForm(st, st.lots.find((l) => l.id === el.dataset.id)); },
    delLot: (el) => {
      const st = curStock(), l = st.lots.find((x) => x.id === el.dataset.id);
      if (!confirm(`${l.no}번 순번을 삭제할까요?`)) return;
      try { SM.deleteLot(st, l.id); } catch (e) { return toast(e.message, true); }
      ui.selected.delete(l.id); save(); render();
    },
    splitLot: (el) => {
      const st = curStock(), l = st.lots.find((x) => x.id === el.dataset.id);
      ask(`${l.no}번 분할`, `분리해서 새 순번으로 만들 수량 (현재 ${l.qty}주)`, '', (v) => {
        try { const nl = SM.splitLot(st, l.id, v); toast(`${nl.no}번으로 ${nl.qty}주를 분리했습니다`); } catch (e) { return toast(e.message, true); }
        save(); closeModal(); render();
      });
    },
    unmerge: (el) => {
      const st = curStock();
      try { SM.unmergeLot(st, el.dataset.id); } catch (e) { return toast(e.message, true); }
      ui.selected.clear(); save(); render(); toast('병합을 취소하고 원래 순번으로 되돌렸습니다');
    },
    mergeSel: () => {
      const st = curStock();
      const ids = [...ui.selected];
      const nums = ids.map((id) => (st.lots.find((l) => l.id === id) || {}).no).filter(Boolean).sort((a, b) => a - b);
      if (!confirm(`${nums.join('번, ')}번을 하나의 순번(평단가 기준)으로 병합할까요?\n병합 후에도 “병합취소”로 원래 순번으로 되돌릴 수 있습니다.`)) return;
      try { SM.mergeLots(st, ids); } catch (e) { return toast(e.message, true); }
      ui.selected.clear(); save(); render(); toast('병합했습니다');
    },
    openSell: () => openSell(curStock()),
    delSale: (el) => {
      const st = curStock(), s = st.sales.find((x) => x.id === el.dataset.id);
      if (!confirm(`${s.date} 매도 기록(${s.qty}주)을 삭제할까요?\n해당 순번의 잔여 수량이 원래대로 돌아옵니다.`)) return;
      st.sales = st.sales.filter((x) => x.id !== s.id); save(); render();
    },
    closeModal: () => closeModal(),
    sellFill: () => {
      const st = curStock();
      const total = num(document.getElementById('sTotal').value);
      if (!(total > 0)) return toast('총 매도 수량을 입력하세요', true);
      const alloc = SM.allocate(st, total, document.getElementById('sStrat').value);
      document.querySelectorAll('.sellrow').forEach((tr) => {
        const q = alloc[tr.dataset.lot] || 0;
        tr.querySelector('.sq').value = q || '';
        tr.querySelector('.schk').checked = q > 0;
      });
      sellRefresh();
    },
    sellAll: () => {
      const st = curStock();
      document.querySelectorAll('.sellrow').forEach((tr) => {
        tr.querySelector('.sq').value = SM.lotRem(st, st.lots.find((l) => l.id === tr.dataset.lot));
        tr.querySelector('.schk').checked = true;
      });
      sellRefresh();
    },
    calcAdd: () => { ui.calc.buys.push({ qty: '', price: '' }); render(); },
    calcDel: (el) => { ui.calc.buys.splice(+el.dataset.i, 1); if (!ui.calc.buys.length) ui.calc.buys.push({ qty: '', price: '' }); render(); },
    export: () => {
      const data = { app: 'stock-manager', exportedAt: new Date().toISOString(), state };
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `주식관리백업_${todayStr()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    },
    wipe: () => {
      if (!confirm('이 기기의 모든 데이터를 삭제합니다.\n(동기화가 켜져 있으면 다른 기기와 서버의 데이터는 그대로입니다. 하지만 이후 이 기기에서 저장하면 서버도 빈 데이터로 덮어써질 수 있습니다.)\n\n계속할까요?')) return;
      if (!confirm('정말 삭제할까요? 먼저 백업을 내려받았는지 확인하세요.')) return;
      state = SM.newState(); ui.stockId = null; save(); render();
    },
    copyRules: () => { try { navigator.clipboard.writeText(RULES); toast('규칙을 복사했습니다'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 복사하세요', true); } },
    fbSave: () => {
      try { SM.sync.saveCfg(SM.sync.parseConfigText(document.getElementById('fbCfg').value)); } catch (e) { return toast(e.message, true); }
      toast('저장했습니다. 연결합니다…');
      SM.sync.init(syncHooks);
    },
    fbClear: () => { if (!confirm('Firebase 설정값을 이 기기에서 지울까요? (서버의 데이터는 그대로입니다)')) return; SM.sync.signOut().catch(() => {}); SM.sync.clearCfg(); location.reload(); },
    fbGoogle: () => SM.sync.signInGoogle().catch((e) => toast(e.message, true)),
    fbLogin: () => SM.sync.emailAuth(document.getElementById('fbEmail').value.trim(), document.getElementById('fbPw').value, false).catch((e) => toast(e.message, true)),
    fbSignup: () => SM.sync.emailAuth(document.getElementById('fbEmail').value.trim(), document.getElementById('fbPw').value, true).catch((e) => toast(e.message, true)),
    fbOut: () => SM.sync.signOut(),
    fbPush: () => SM.sync.push(),
  });

  const C = A.changeHandlers;
  Object.assign(C, {
    price: (el) => { const st = curStock(); st.price = el.value.trim() === '' ? null : num(el.value); save(); render(); },
    fxNow: (el) => { state.settings.fxNow = num(el.value, 1400); save(); render(); },
    showSold: (el) => { ui.showSold = el.checked; render(); },
    selLot: (el) => { if (el.checked) ui.selected.add(el.dataset.id); else ui.selected.delete(el.dataset.id); render(); },
    pnlf: (el) => { ui.pnl[el.dataset.k] = el.value; render(); },
    calcLoad: (el) => {
      const st = state.stocks.find((s) => s.id === el.value);
      if (!st) return;
      const sm = SM.stockSummary(st, state.settings);
      Object.assign(ui.calc, { market: st.market, baseQty: sm.qty ? String(sm.qty) : '', baseAvg: sm.avg ? String(Math.round(sm.avg * 100) / 100) : '', beAvg: sm.avgInclFee ? String(Math.round(sm.avgInclFee * 100) / 100) : '' });
      render();
    },
    import: (el) => {
      const file = el.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const o = JSON.parse(rd.result);
          const incoming = SM.normalizeState(o.state || o);
          if (!incoming.stocks.length && !confirm('불러올 종목이 없습니다. 그래도 현재 데이터를 비울까요?')) return;
          if (!confirm(`백업 파일: 종목 ${incoming.stocks.length}개\n현재 이 기기의 데이터를 이 파일로 교체할까요?`)) return;
          state = incoming; ui.stockId = state.stocks[0] ? state.stocks[0].id : null; ui.selected.clear();
          save(); render(); toast('복원했습니다');
        } catch (e) { toast('백업 파일을 읽지 못했습니다: ' + e.message, true); }
      };
      rd.readAsText(file);
    },
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'A') e.preventDefault();
    const h = H[el.dataset.act];
    if (h) h(el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.change && C[el.dataset.change]) return C[el.dataset.change](el, e);
    if (el.dataset && el.dataset.setting) {
      const path = el.dataset.setting.split('.'); let o = state.settings;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      const k = path[path.length - 1];
      o[k] = k === 'upColor' ? el.value : num(el.value, o[k]);
      save();
      if (k === 'upColor') render(); else toast('저장했습니다');
    }
    if (el.closest && el.closest('.sellrow') && el.classList.contains('schk')) {
      const tr = el.closest('.sellrow'), st = curStock();
      const rem = SM.lotRem(st, st.lots.find((l) => l.id === tr.dataset.lot));
      tr.querySelector('.sq').value = el.checked ? rem : '';
      sellRefresh();
    }
  });
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (A.sell && el.closest && el.closest('#mform')) { sellRefresh(); return; }
    if (el.dataset && el.dataset.calc) {
      const k = el.dataset.calc;
      ui.calc[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'market' || el.type === 'checkbox') return calcOut();
      return calcOut();
    }
    if (el.dataset && el.dataset.calcbuy) {
      const [i, k] = el.dataset.calcbuy.split('.');
      ui.calc.buys[+i][k] = el.value; calcOut();
    }
    for (const fn of Object.values(A.inputHandlers)) fn(el, e);
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'mform') {
      e.preventDefault();
      if (modalSubmit) modalSubmit(new FormData(e.target));
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalSubmit) closeModal(); });

  /* ---------- 부팅 ---------- */
  const syncHooks = {
    getState: () => state,
    setState: (remote) => {
      state = SM.normalizeState(remote);
      if (!state.stocks.find((s) => s.id === ui.stockId)) ui.stockId = state.stocks[0] ? state.stocks[0].id : null;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      if (!A.sell && !modalSubmit) render();
    },
    onChange: () => {
      const b = document.getElementById('syncBadgeBox');
      if (b) b.innerHTML = syncBadge();
      const c = document.getElementById('syncCard');
      if (c && !document.activeElement.closest('#syncCard')) c.innerHTML = syncCard();
      else if (c && SM.sync.S.status !== 'connecting') c.innerHTML = syncCard();
    },
  };
  A.boot = function () {
    load();
    render();
    SM.sync.init(syncHooks);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
