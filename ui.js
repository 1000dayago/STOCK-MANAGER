/* ui.js - 화면(종목/매도/손익/계산기/설정) */
(function (root) {
  'use strict';
  const SM = root.SM;
  const { fmtNum, fmtMoney, fmtPct, num, todayStr } = SM;
  const ic = SM.ic;
  const KEY = 'stockmgr.v1';
  const A = (SM.app = { renderers: {}, handlers: {}, changeHandlers: {}, inputHandlers: {}, afterRender: {} });

  let state = SM.newState();
  const ui = (A.ui = {
    view: 'home', stockId: null, showSold: false, journalOnly: false, lotSort: 'no', stockTab: 'held', watchSort: 'gap', paperSel: new Set(), openLots: new Set(), sideRail: (() => { try { return localStorage.getItem('stockmgr.sideRail') === '1'; } catch (e) { return false; } })(), sec: { sales: true, auto: true, events: false, memo: true, journal: true }, selected: new Set(),
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
  function closeModal() { document.getElementById('modal-root').innerHTML = ''; modalSubmit = null; A.sell = null; A.lotPrev = null; }
  Object.assign(A, { toast, openModal, closeModal });
  function ask(title, label, def, cb) {
    openModal(`<h3>${esc(title)}</h3><label>${esc(label)}<input name="v" value="${esc(def)}" inputmode="decimal"></label><div class="btns"><button class="btn primary" type="submit">확인</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => cb(fd.get('v')));
  }

  /* ---------- 헤더/내비 ---------- */
  const VIEWS = [['home', '홈', 'home'], ['stocks', '종목', 'stocks'], ['pnl', '손익', 'bars'], ['calc', '계산기', 'calc'], ['backtest', '시뮬레이션', 'lab'], ['settings', '설정', 'sliders']];
  function syncBadge() {
    const s = SM.sync.S;
    const map = { off: ['이 기기에만 저장', 'off'], connecting: ['연결 중', 'warn'], signedout: ['로그인 필요', 'warn'], syncing: ['동기화 중', 'warn'], synced: ['동기화됨', 'ok'], error: ['동기화 오류', 'err'] };
    const [t, c] = map[s.status] || map.off;
    return `<button class="badge ${c}" data-act="goSettings" data-tab="sync" title="${esc(s.msg)}">${t}</button>`;
  }
  const APPV = () => ((root.SM_APP || {}).version || '');
  A.sideVerHtml = () => `v${esc(APPV())}${SM.update && SM.update.available ? '<i class="udot" title="새 버전이 있습니다"></i>' : ''}`;
  function renderChrome(body) {
    const banner = A.banner ? A.banner() : '';
    const vtag = A.versionTag ? A.versionTag() : '';
    const cur = VIEWS.find((v) => v[0] === ui.view) || VIEWS[0];
    const navBtns = VIEWS.map(([k, l, nm]) => `<button class="${ui.view === k ? 'on' : ''}" data-act="nav" data-v="${k}" title="${l}" ${ui.view === k ? 'aria-current="page"' : ''}><i>${ic(nm)}</i><span>${l}</span></button>`).join('');
    return `<div class="shell ${ui.sideRail ? 'rail' : ''}">
      <aside class="side"><div class="side-brand"><span class="logo">${ic('logo')}</span><b>주식 관리</b></div>
        <nav class="side-nav" aria-label="주 메뉴">${navBtns}</nav>
        <div class="side-foot"><span class="syncbox">${syncBadge()}</span>
          <button class="side-ver" data-act="goSettings" data-tab="about" title="설정 · 업데이트 확인">${A.sideVerHtml()}</button>
          <button class="side-toggle" data-act="sideToggle" title="${ui.sideRail ? '사이드바 펼치기' : '사이드바 접기'}" aria-label="사이드바 접기/펼치기">${ic(ui.sideRail ? 'chevR' : 'chevL')}<span>접기</span></button></div></aside>
      <div class="mainwrap">
        <header class="top"><div class="brand"><span class="logo">${ic('logo')}</span>주식 관리</div><span class="syncbox">${syncBadge()}</span></header>
        ${banner}<main><h1 class="ptitle">${cur[1]}</h1>${body}${ui.view === 'home' || ui.view === 'settings' ? vtag : ''}</main>
      </div></div>
    <nav class="nav-bottom">${VIEWS.map(([k, l, nm]) => `<button class="${ui.view === k ? 'on' : ''}" data-act="nav" data-v="${k}"><i>${ic(nm)}</i><span>${l}</span></button>`).join('')}</nav>`;
  }

  /* ---------- 버튼형 선택: data-seg 가 붙은 <select> 를 터치하기 쉬운 버튼 묶음으로 보여 줍니다 ----------
     선택지가 2~5개이고 짧을 때만 바꾸며(길면 드롭다운 그대로), 실제 <select>는 숨겨 두고 값을 대신 바꿔 'change' 를 보내므로
     기존 처리 코드와 폼 전송(FormData)이 그대로 동작합니다. */
  function segOk(sel) {
    const o = Array.from(sel.options), n = o.length;
    if (n < 2 || n > 5 || sel.multiple) return false;
    const lens = o.map((x) => x.textContent.trim().length), sum = lens.reduce((a, b) => a + b, 0), mx = Math.max.apply(null, lens);
    return n <= 2 ? mx <= 24 && sum <= 48 : mx <= 18 && sum <= 36;
  }
  function enhanceSelects(root) {
    (root || document).querySelectorAll('select[data-seg]:not(.segsel-src)').forEach((sel) => {
      if (!segOk(sel)) { sel.removeAttribute('data-seg'); return; }
      const wrap = document.createElement('div');
      wrap.className = 'segsel' + (sel.disabled ? ' disabled' : '');
      wrap.setAttribute('role', 'radiogroup');
      const lab = sel.getAttribute('aria-label') || (sel.closest('label') ? sel.closest('label').firstChild.textContent.trim() : '');
      if (lab) wrap.setAttribute('aria-label', lab);
      Array.from(sel.options).forEach((op) => {
        const b = document.createElement('button');
        b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.sv = op.value; b.textContent = op.textContent;
        b.setAttribute('aria-checked', String(op.value === sel.value));
        wrap.appendChild(b);
      });
      sel.classList.add('segsel-src');
      sel.insertAdjacentElement('afterend', wrap);
    });
  }
  A.enhanceSelects = enhanceSelects;
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.segsel button') : null;
    if (!b) return;
    e.preventDefault(); // 감싸는 <label>이 숨은 select 를 건드리지 않게
    const wrap = b.parentNode, sel = wrap.previousElementSibling;
    if (!sel || !sel.classList.contains('segsel-src') || wrap.classList.contains('disabled') || sel.disabled) return;
    if (sel.value === b.dataset.sv) return;
    sel.value = b.dataset.sv;
    wrap.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  let segTimer = 0;
  new MutationObserver(() => { if (!segTimer) segTimer = requestAnimationFrame(() => { segTimer = 0; enhanceSelects(document); }); }).observe(document.body, { childList: true, subtree: true });

  function render() {
    document.body.classList.toggle('up-green', state.settings.upColor === 'green');
    const fn = A.renderers[ui.view] || A.renderers.home;
    const keepScroll = window.scrollY;
    document.getElementById('app').innerHTML = renderChrome(fn());
    enhanceSelects(document.getElementById('app'));
    if (ui.view === 'stocks' && A.mountChart) A.mountChart();
    if (A.afterRender[ui.view]) A.afterRender[ui.view]();
    window.scrollTo(0, keepScroll);
  }
  A.render = render;

  /* ---------- 매매 사유(노트) 연결 ---------- */
  const EVENT_KINDS = ['실적 발표', '배당', '주총', '공시', '기타'];
  function findByKey(key) {
    const [type, id] = [key.slice(0, key.indexOf('_')), key.slice(key.indexOf('_') + 1)];
    for (const st of state.stocks) {
      if (type === 'stock' && st.id === id) return { st, type };
      if (type === 'lot') { const l = st.lots.find((x) => x.id === id); if (l) return { st, type, lot: l }; }
      if (type === 'sale') { const s = st.sales.find((x) => x.id === id); if (s) return { st, type, sale: s }; }
    }
    return null;
  }
  function noteInfo(key) {
    const f = findByKey(key);
    if (!f) return { title: '매매 사유', kind: 'buy', header: '' };
    const cur = SM.curOf(f.st);
    if (f.type === 'lot') {
      const v = SM.lotView(f.st, f.lot, state.settings);
      return { title: `${f.st.name} ${f.lot.no}번 매수 사유`, kind: 'buy', header: `${f.lot.date} 매수 · ${fmtNum(f.lot.qty, f.lot.qty % 1 ? 4 : 0)}주 @ ${fmtMoney(f.lot.price, cur)}${v.ret != null ? ' · 현재 ' + fmtPct(v.ret) : ''}` };
    }
    if (f.type === 'sale') {
      const s = f.sale;
      return { title: `${f.st.name} ${s.date} 매도 사유`, kind: 'sell', header: `${s.date} 매도 · ${fmtNum(s.qty, s.qty % 1 ? 4 : 0)}주 @ ${fmtMoney(s.price, cur)} · ${s.lines.map((l) => l.lotNo + '번').join(',')} · 실현손익 ${fmtMoney(s.pnlKRW, 'KRW')} (${fmtPct(s.costKRW > 0 ? s.pnlKRW / s.costKRW : null)})` };
    }
    return { title: `${f.st.name} 종목 메모`, kind: 'stock', header: `${f.st.name} ${f.st.code || ''}` };
  }
  function editNote(key) {
    const i = noteInfo(key);
    SM.editor.open({ key, title: i.title, kind: i.kind, onSaved: () => render(), onClose: () => render() });
  }
  function openNote(key) {
    if (state.noteIdx[key]) { const i = noteInfo(key); SM.editor.view(key, { title: i.title, header: esc(i.header), onEdit: () => editNote(key) }); }
    else editNote(key);
  }
  A.editNote = editNote; A.openNote = openNote;
  const noteBtn = (key, short) => {
    const e = state.noteIdx[key];
    return `<button class="btn sm ${e ? 'has' : ''}" data-act="note" data-key="${key}" title="${e ? esc(e.t) : '작성'}">${ic('note')}${e ? (short ? '보기' : '사유 보기') : (short ? '쓰기' : '사유 쓰기')}${e && e.n ? ` <span class="imgc">${ic('image')}${e.n}</span>` : ''}</button>`;
  };
  const noteLine = (key) => (state.noteIdx[key] ? `<div class="nprev">${esc(state.noteIdx[key].t)}</div>` : '');
  SM.media.hooks.index = (key, entry, remote) => {
    if (entry) state.noteIdx[key] = entry; else delete state.noteIdx[key];
    if (remote) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } } else save();
  };
  SM.media.hooks.refresh = () => render();
  async function mergeNotes(parts, merged) {
    const chunks = [];
    for (const p of parts) { const rec = await SM.media.getNote('lot_' + p.id); if (rec) chunks.push(`<h3>${p.no}번 매수 사유 (${p.date})</h3>` + rec.html); }
    if (chunks.length) { await SM.media.saveNote('lot_' + merged.id, chunks.join('<hr>')); render(); }
  }
  const delNotes = (keys) => keys.forEach((k) => { if (state.noteIdx[k]) SM.media.deleteNote(k); });

  /* ---------- 홈 ---------- */
  const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#be185d', '#65a30d', '#0891b2', '#dc2626'];
  A.renderers.home = function () {
    if (!state.stocks.length) return `<section class="card empty"><h2>시작하기</h2><p>종목을 추가하면 종목마다 탭이 만들어지고, 매수할 때마다 <b>순번(1번, 2번…)</b>이 따로 기록됩니다. 매수·매도할 때마다 <b>사유와 사진</b>을 남길 수 있어 나중에 복기하기 좋습니다.</p><p><button class="btn primary" data-act="addStock">첫 종목 추가</button></p><p class="muted">여러 기기에서 쓰려면 <a href="#" data-act="goSettings" data-tab="sync">설정</a>에서 Firebase 동기화를 연결하세요. 연결 전에는 이 기기에만 저장됩니다.</p></section>`;
    const pf = SM.portfolio(state);
    const today = todayStr();
    let h = `<section class="card"><div class="row between wrap"><h2>내 자산 요약 <small class="muted">(원화 기준)</small></h2><button class="btn sm primary" data-act="priceAll">현재가 한 번에 입력</button></div>
      <div class="cards homecards"><div class="stat"><span>총 매입금</span><b>${fmtMoney(pf.costKRW, 'KRW')}</b><small>보유 ${pf.holdings}종목</small></div>
      <div class="stat"><span>총 평가금액</span><b>${pf.pricedCostKRW ? fmtMoney(pf.valueKRW, 'KRW') : '<span class="muted">현재가 입력</span>'}</b></div>
      <div class="stat"><span>실현손익 (누적)</span><b>${money(pf.realizedAll, 'KRW')}</b></div>
      <div class="stat wide2"><span>평가손익</span><b>${pf.pricedCostKRW ? money(pf.unrlKRW, 'KRW') + ' <small>' + pct(pf.unrlRet) + '</small>' : '-'}</b><small>현재가 입력된 종목 기준</small></div>
      <div class="stat"><span>실현손익 (올해)</span><b>${money(pf.realizedYear, 'KRW')}</b><small>이번 달 ${fmtMoney(pf.realizedMonth, 'KRW')}</small></div></div>`;
    const warn = [];
    if (pf.missing.length) warn.push(`현재가가 없는 종목: ${pf.missing.map((s) => esc(s.name)).join(', ')} (평가금액에서 빠져 있습니다)`);
    if (pf.stale.length) warn.push(`현재가가 3일 넘게 갱신되지 않은 종목: ${pf.stale.map((s) => esc(s.name) + '(' + (SM.priceAge(s) > 365 ? '입력일 불명' : SM.priceAge(s) + '일 전') + ')').join(', ')}`);
    const bk = state.lastBackupAt ? SM.daysBetween(new Date(state.lastBackupAt).toISOString().slice(0, 10), today) : null;
    if (bk === null) warn.push('아직 백업한 적이 없습니다. <a href="#" data-act="goSettings" data-tab="sync">설정 › 동기화·백업</a>에서 백업을 내려받아 두세요.');
    else if (bk > 30) warn.push(`마지막 백업이 ${bk}일 전입니다.`);
    if (A.collectWarnings) warn.push(...A.collectWarnings());
    if (warn.length) h += `<div class="warnbox">${warn.map((w) => `<div>${ic('alert')}<span>${w}</span></div>`).join('')}</div>`;
    if (pf.weights.length > 1) {
      const tot = pf.weights.reduce((a, w) => a + w.valueKRW, 0);
      h += `<h4>종목 비중 <small class="muted">(평가금액 기준)</small></h4><div class="wbar">${pf.weights.map((w, i) => `<span style="width:${(w.valueKRW / tot) * 100}%;background:${PALETTE[i % PALETTE.length]}" title="${esc(w.name)} ${(w.valueKRW / tot * 100).toFixed(1)}%"></span>`).join('')}</div>
        <div class="wleg">${pf.weights.map((w, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(w.name)} ${(w.valueKRW / tot * 100).toFixed(0)}%</span>`).join('')}</div>`;
    }
    h += `</section>`;
    // 종목 카드
    h += `<div class="row between wrap"><h2 class="sec">내 종목</h2><button class="btn sm" data-act="addStock">${ic('plus')}종목 추가</button></div><div class="scards">`;
    for (const st of state.stocks.filter((x) => !x.watch)) {
      const sm = SM.stockSummary(st, state.settings), cur = SM.curOf(st);
      const age = SM.priceAge(st), pn = SM.priceNote(st);
      const lots = st.lots.filter((l) => SM.lotRem(st, l) > 0).sort((a, b) => a.no - b.no);
      const mem = state.noteIdx['stock_' + st.id];
      h += `<article class="scard" data-act="goStock" data-id="${st.id}" tabindex="0"><div class="row between"><b>${esc(st.name)} <small class="muted">${esc(st.code)}${st.market === 'US' ? ' · US' : ''}</small></b>${sm.value != null ? `<span class="chip ${SM.num(sm.unrlRetKRW) >= 0 ? 'up' : 'down'}">${fmtPct(sm.unrlRetKRW)}</span>` : ''}</div>
        ${sm.qty > 0 ? `<div class="sline">보유 <b>${fmtNum(sm.qty, sm.qty % 1 ? 4 : 0)}주</b> · 평단 <b>${fmtMoney(sm.avg, cur)}</b>${st.price ? ` · 현재가 <b>${fmtMoney(st.price, cur)}</b> <small class="${pn.stale ? 'stale' : 'muted'}">(${pn.auto ? pn.text : age > 365 ? '입력일 불명' : age === 0 ? '오늘' : age + '일 전'})</small>` : ' · <span class="stale">현재가 미입력</span>'}</div>
        ${sm.value != null ? `<div class="sline">평가손익 ${money(sm.unrlKRW, 'KRW')}</div>` : ''}
        <div class="lchips">${lots.map((l) => { const v = SM.lotView(st, l, state.settings); return `<span class="lchip"><b>${l.no}번</b> ${fmtNum(v.rem, v.rem % 1 ? 4 : 0)}주 @${fmtNum(l.price, cur === 'USD' ? 2 : 0)}${v.ret != null ? ` <em class="${cls(v.ret)}">${fmtPct(v.ret)}</em>` : ''}${state.noteIdx['lot_' + l.id] ? ' ' + ic('note') : ''}</span>`; }).join('')}</div>` : '<div class="sline muted">보유 수량 없음</div>'}
        ${mem ? `<div class="nprev">${ic('pin')} ${esc(mem.t)}</div>` : ''}</article>`;
    }
    h += `</div>`;
    h += A.homeWatchCard ? A.homeWatchCard() : '';
    // 일정
    const evs = SM.upcomingEvents(state, today, 45, 3);
    h += `<section class="card"><h2>다가오는 일정</h2>${evs.length ? `<ul class="evlist">${evs.map((e) => `<li class="${e.days < 0 ? 'past' : e.days <= 3 ? 'soon' : ''}"><span class="evd">${e.ev.date.slice(5)}</span><span class="evk">${esc(e.ev.kind)}</span><b>${esc(e.stock.name)}</b> ${esc(e.ev.title)} <small class="muted">${e.days === 0 ? '오늘' : e.days > 0 ? e.days + '일 후' : -e.days + '일 지남'}</small></li>`).join('')}</ul>` : '<p class="muted">앞으로 45일 안에 등록된 일정이 없습니다. 종목 화면의 “일정”에서 실적 발표일 등을 등록하세요.</p>'}</section>`;
    // 최근 매매
    const recent = [];
    for (const st of state.stocks) {
      st.lots.forEach((l) => recent.push({ st, type: 'lot', date: l.date, lot: l }));
      st.sales.forEach((s) => recent.push({ st, type: 'sale', date: s.date, sale: s }));
    }
    recent.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    h += `<section class="card"><h2>최근 매매</h2>${recent.length ? recent.slice(0, 6).map((r) => {
      const cur = SM.curOf(r.st), key = r.type === 'lot' ? 'lot_' + r.lot.id : 'sale_' + r.sale.id;
      return `<div class="tl"><div class="tl-h"><span class="tl-d">${r.date}</span> <b>${esc(r.st.name)}</b> ${r.type === 'lot' ? `<span class="tag buy">매수 ${r.lot.no}번</span> ${fmtNum(r.lot.qty, r.lot.qty % 1 ? 4 : 0)}주 @ ${fmtMoney(r.lot.price, cur)}` : `<span class="tag sell">매도</span> ${fmtNum(r.sale.qty, r.sale.qty % 1 ? 4 : 0)}주 @ ${fmtMoney(r.sale.price, cur)} · ${money(r.sale.pnlKRW, 'KRW')}`}</div>${noteLine(key)}<div class="tl-b">${noteBtn(key, true)}</div></div>`;
    }).join('') : '<p class="muted">매매 기록이 없습니다.</p>'}</section>`;
    return h;
  };

  /* ---------- 종목 화면 ---------- */
  const fd = (d) => String(d).slice(2).replace(/-/g, '.');   // 2026-10-01 → 26.10.01
  const qn = (x) => fmtNum(x, x % 1 ? 4 : 0);
  const SORTS = [['no', '번호순'], ['retDesc', '수익률 높은순'], ['retAsc', '수익률 낮은순'], ['priceAsc', '단가 낮은순'], ['priceDesc', '단가 높은순'], ['dateDesc', '최근 매수순']];
  const abtn = (act, icon, label, extra = '', attrs = '') => `<button type="button" class="ab ${extra}" data-act="${act}" ${attrs} title="${label}"><i>${ic(icon)}</i><span>${label}</span></button>`;
  const section = (id, title, count, body, defOpen) => `<details class="card sec" data-sec="${id}" ${(ui.sec[id] !== undefined ? ui.sec[id] : defOpen !== false) ? 'open' : ''}><summary><span class="st">${title}</span>${count != null ? `<span class="count">${count}</span>` : ''}<span class="chev"></span></summary><div class="sec-b">${body}</div></details>`;

  // 배당 섹션 본문: 누적 요약 + 목록 + 기록 버튼
  function divBody(st, cur, us) {
    const list = st.dividends || [], tot = SM.dividendTotals([st]);
    const rows = list.slice().reverse().map((d) => {
      const net = d.gross - d.tax;
      const main = us ? `${fmtMoney(net, 'USD')} <small class="muted">(≈ ${fmtMoney(net * d.fx, 'KRW')})</small>` : `<b>${fmtMoney(net, 'KRW')}</b>`;
      const sub = `세전 ${fmtMoney(d.gross, cur)} · 세금 ${fmtMoney(d.tax, cur)}${us ? ' · 환율 ' + fmtNum(d.fx, 0) : ''}`;
      return `<div class="divrow"><span class="dd">${d.date}</span><span class="da">${us ? main : main} <small class="muted">${sub}</small>${d.note ? `<small class="dnote">${esc(d.note)}</small>` : ''}</span><button class="btn sm ghost" type="button" data-act="divDel" data-id="${d.id}" aria-label="배당 기록 삭제">${ic('x')}</button></div>`;
    }).join('');
    const years = Object.keys(tot.byYear).sort().reverse().map((y) => `<span class="chip">${y} ${fmtMoney(tot.byYear[y], 'KRW')}</span>`).join(' ');
    return `<div class="row between wrap"><div>${list.length ? `누적 수령(세후) <b>${fmtMoney(tot.netKRW, 'KRW')}</b> <small class="muted">· 세전 ${fmtMoney(tot.grossKRW, 'KRW')} · 세금 ${fmtMoney(tot.taxKRW, 'KRW')}</small>` : '<span class="muted">아직 배당 기록이 없습니다.</span>'}</div><button class="btn primary sm" type="button" data-act="divAdd">${ic('plus')}배당 기록</button></div>
      ${years ? `<div class="toolbar">${years}</div>` : ''}${rows ? `<div class="divlist">${rows}</div>` : ''}
      <p class="hint">배당금은 실현손익(매도 손익)에 섞지 않고 따로 집계합니다. 손익 화면에서 “실현손익 + 배당”으로 함께 볼 수 있습니다. 세금은 비워 두면 ${us ? '해외 15%' : '국내 15.4%'}로 계산하며 실제와 다르면 직접 입력하세요.</p>`;
  }

  A.renderers.stocks = function () {
    const group = ui.stockTab === 'watch' ? 'watch' : 'held';
    const G = state.stocks.filter((x) => !!x.watch === (group === 'watch'));
    let st = curStock();
    if (!st || !!st.watch !== (group === 'watch')) { st = G[0] || null; ui.stockId = st ? st.id : null; }
    const nHeld = state.stocks.filter((x) => !x.watch).length, nWatch = state.stocks.length - nHeld;
    let h = `<div class="grpseg-wrap"><div class="seg2 grpseg"><button class="${group === 'held' ? 'on' : ''}" data-act="stockTab" data-v="held">보유 <span class="count">${nHeld}</span></button><button class="${group === 'watch' ? 'on' : ''}" data-act="stockTab" data-v="watch">관심 <span class="count">${nWatch}</span></button></div></div>`;
    if (group === 'watch') h += A.watchList(G);
    else h += `<div class="tabs">${G.map((x) => `<button class="tab ${x.id === ui.stockId ? 'on' : ''}" data-act="tab" data-id="${x.id}">${esc(x.name)}${x.market === 'US' ? ' <small>US</small>' : ''}</button>`).join('')}<button class="tab add" data-act="addStock">${ic('plus')}종목</button></div>`;
    if (!st) return h + (group === 'watch' ? '' : `<section class="card empty"><h2>보유 종목이 없습니다</h2><p><button class="btn primary" data-act="addStock">첫 종목 추가</button></p></section>`);
    const cur = SM.curOf(st), us = st.market === 'US';
    const sm = SM.stockSummary(st, state.settings);
    const realized = st.sales.reduce((a, s) => a + s.pnlKRW, 0);
    const age = SM.priceAge(st), pn = SM.priceNote(st);
    const links = SM.linksFor(state, st);
    const menuItems = ['<button data-act="editStock">종목 수정</button>', '<button data-act="splitAdj">액면분할 조정</button>', '<button data-act="simForStock">백테스트 해보기</button>',
      st.watch ? `<button data-act="toHeld">보유 종목으로 이동</button><button data-act="collectToggle">${st.collect ? '자동 수집 끄기' : '자동 수집 켜기 (공개 저장소)'}</button>` : (!st.lots.length ? '<button data-act="toWatch">관심 종목으로 이동</button>' : ''),
      '<button class="danger" data-act="delStock">종목 삭제</button>'].join('');
    h += `<section class="card stockhead"><div class="sh-top"><div class="sh-title"><b class="sh-name">${esc(st.name)}</b> <small class="muted">${esc(st.code)} · ${us ? '해외 USD' : '국내 KRW'}</small></div>
      <div class="sh-right"><label class="px">현재가<input class="inp" data-change="price" value="${st.price == null ? '' : st.price}" inputmode="decimal" placeholder="입력"></label>
      ${us ? `<label class="px">환율<input class="inp" data-change="fxNow" value="${state.settings.fxNow}" inputmode="decimal"></label>` : ''}
      <button class="btn sm editbtn" type="button" data-act="editStock" aria-label="종목 수정 (이름·종목코드·시장)">${ic('edit')}수정</button>
      <details class="menu"><summary aria-label="더보기">${ic('more')}</summary><div class="menu-body">${menuItems}</div></details></div></div>
      <div class="sh-sub"><small class="${pn.stale ? 'stale' : 'muted'}">${st.price ? '현재가 ' + pn.text : pn.text}</small>
        ${links.map((l) => A.linkA(SM.fillLink(l.url, st), esc(l.label) + ic('ext'), { cls: 'lnk', lid: l.id, title: `${l.label} · ${st.name}` })).join('')}</div>
      ${st.watch ? A.watchCards(st) : `<div class="cards">
        <div class="stat"><span>보유 수량</span><b>${qn(sm.qty)}주</b></div>
        <div class="stat"><span>전체 평단가</span><b>${fmtMoney(sm.avg, cur)}</b><small>수수료 포함 ${fmtMoney(sm.avgInclFee, cur)}${us && sm.avgKRW ? ` · 원화 ${fmtMoney(sm.avgKRW, 'KRW')}` : ''}</small></div>
        <div class="stat"><span>총 매입금</span><b>${fmtMoney(sm.cost, cur)}</b>${us ? `<small>${fmtMoney(sm.costKRW, 'KRW')}</small>` : ''}</div>
        <div class="stat wide2"><span>평가손익${us ? ' (원화)' : ''}</span><b>${sm.value != null ? money(sm.unrlKRW, 'KRW') + ' <small>' + pct(sm.unrlRetKRW) + '</small>' : '<span class="muted">-</span>'}</b>${us && sm.value != null ? `<small>달러 ${money(sm.unrl, 'USD')} ${pct(sm.unrlRet)}</small>` : ''}</div>
        <div class="stat"><span>누적 실현손익</span><b>${money(realized, 'KRW')}</b><small>${st.sales.length}건</small></div>
      </div>`}</section>`;

    if (st.watch) {
      h += `<section class="card promo"><div class="row between wrap"><div><b>관심 종목입니다</b><div class="hint">아직 실제 매수 기록이 없습니다. 실제로 매수를 기록하면 이 종목은 <b>보유 종목으로 이동</b>합니다.</div></div><button class="btn primary sm" data-act="addLot">${ic('plus')}실제 매수 기록</button></div></section>`;
    } else {
    /* 매수 순번 목록 (작은 리스트) */
    const all = st.lots.slice();
    const heldN = all.filter((l) => SM.lotRem(st, l) > 0).length;
    let rows = all.filter((l) => ui.showSold || SM.lotRem(st, l) > 0).map((l) => ({ l, v: SM.lotView(st, l, state.settings) }));
    const retKey = (x) => (x.v.retKRW == null ? null : x.v.retKRW);
    const cmpNull = (fn) => (a, b) => { const x = fn(a), y = fn(b); return x == null ? (y == null ? 0 : 1) : y == null ? -1 : x - y; };
    const sorters = {
      no: (a, b) => a.l.no - b.l.no, retDesc: cmpNull((x) => (retKey(x) == null ? null : -retKey(x))), retAsc: cmpNull(retKey),
      priceAsc: (a, b) => a.l.price * (a.l.fx || 1) - b.l.price * (b.l.fx || 1), priceDesc: (a, b) => b.l.price * (b.l.fx || 1) - a.l.price * (a.l.fx || 1),
      dateDesc: (a, b) => (a.l.date < b.l.date ? 1 : a.l.date > b.l.date ? -1 : b.l.no - a.l.no),
    };
    rows.sort(sorters[ui.lotSort] || sorters.no);
    const selLots = all.filter((l) => ui.selected.has(l.id) && SM.lotRem(st, l) > 0);
    let selBar = '';
    if (selLots.length) {
      const q = selLots.reduce((a, l) => a + SM.lotRem(st, l), 0);
      const amt = selLots.reduce((a, l) => a + SM.lotRem(st, l) * l.price, 0);
      const amtF = selLots.reduce((a, l) => a + SM.lotRem(st, l) * (l.price + SM.lotFeePerShare(l)), 0);
      const avg = amt / q, avgF = amtF / q;
      selBar = `<div class="selbar">선택 ${selLots.map((l) => l.no + '번').join('·')} · <b>${qn(q)}주</b> · 평단 <b>${fmtMoney(avg, cur)}</b> <small>(수수료 포함 ${fmtMoney(avgF, cur)})</small>${st.price ? ` · 현재가 대비 ${pct((st.price - avgF) / avgF)}` : ''}</div>`;
    }
    h += `<section class="card"><div class="sec-h"><h2>매수 순번 <span class="count">${heldN}</span></h2>
      <div class="sec-tools"><div class="seg2"><button class="${!ui.showSold ? 'on' : ''}" data-act="lotFilter" data-v="held">보유</button><button class="${ui.showSold ? 'on' : ''}" data-act="lotFilter" data-v="all">전체</button></div>
      <select class="inp sm" data-change="lotSort" aria-label="정렬">${opts(SORTS, ui.lotSort)}</select></div></div>
      <div class="toolbar"><button class="btn primary sm" data-act="addLot">${ic('plus')}매수</button><button class="btn sm" data-act="mergeSel" ${selLots.length < 2 ? 'disabled' : ''}>병합</button><button class="btn sm accent" data-act="openSell" ${sm.qty > 0 ? '' : 'disabled'}>매도·시뮬레이션</button><span class="grow"></span>${rows.some((r) => r.v.rem > 0) ? `<button class="btn sm ghost" data-act="selAll">${selLots.length ? '선택 해제' : '전체 선택'}</button>` : ''}</div>
      ${selBar}
      <div class="lots" role="list">
        <div class="lhead"><span></span><span>순번</span><span>매수일</span><span>수량 · 단가</span><span>수익률</span><span>평가손익</span><span></span></div>
        ${rows.length ? rows.map((r) => lotRow(st, r.l, r.v, cur, us)).join('') : `<div class="lempty">매수 기록이 없습니다. “매수” 버튼을 눌러 첫 순번을 기록하세요.</div>`}
      </div>
      <p class="hint">줄을 누르면 수수료·메모·수정/삭제가 펼쳐집니다. 수익률은 매수 수수료 포함 원가 기준이고 매도 비용은 매도/시뮬레이션에서 반영됩니다.${us ? ' 해외주식은 원화(환율 반영) 기준입니다.' : ''}${(st.splits || []).length ? ` 액면분할 조정: ${st.splits.map((x) => x.date + ' ×' + +x.ratio.toFixed(6)).join(', ')}` : ''}</p></section>`;

    /* 차트: 가격·지표·수급 */
    h += A.chartSection ? A.chartSection(st) : '';

    /* 매도 기록 */
    h += section('sales', '매도 기록', st.sales.length, st.sales.length
      ? `<div class="slist">${st.sales.slice().reverse().map((s) => saleRow(st, s, cur, us)).join('')}</div><p class="hint">삭제하면 해당 순번의 잔여 수량이 원래대로 돌아옵니다.</p>`
      : '<p class="muted">아직 매도 기록이 없습니다.</p>');
    }

    /* 가상 매매 / 분할 매수 계획 */
    /* 배당 */
    h += section('div', '배당 <small class="muted">수령 기록</small>', (st.dividends || []).length, divBody(st, cur, us), false);

    h += section('paper', '가상 매매 <small class="muted">실제 계좌와 무관한 시험</small>', st.paper.lots.length + st.paper.sales.length, A.paperBody ? A.paperBody(st) : '', !!st.watch);
    h += section('plan', '분할 매수 계획 <small class="muted">가격별 단계</small>', (st.plan || []).filter((p) => !p.done).length, A.planBody ? A.planBody(st) : '', !!st.watch);

    /* 자동 수집 자료 (공시·뉴스·재무·시세) */
    h += section('auto', '공시 · 뉴스 · 재무 <small class="muted">자동 수집</small>', null, A.autoBody ? A.autoBody(st) : '');

    /* 일정 */
    const evs = (st.events || []).slice();
    h += section('events', '일정 <small class="muted">실적·배당·주총</small>', evs.length, `
      ${evs.length ? `<ul class="evlist">${evs.map((e) => { const d = SM.daysBetween(todayStr(), e.date); return `<li class="${d < 0 ? 'past' : d <= 3 ? 'soon' : ''}"><span class="evd">${e.date}</span><span class="evk">${esc(e.kind)}</span><span class="grow">${esc(e.title)} <small class="muted">${d === 0 ? '오늘' : d > 0 ? d + '일 후' : -d + '일 지남'}</small></span><button class="ab danger" data-act="delEvent" data-id="${e.id}" title="삭제"><i>${ic('trash')}</i></button></li>`; }).join('')}</ul>` : '<p class="muted">등록된 일정이 없습니다.</p>'}
      <div class="evform"><input type="date" id="evDate" class="inp" value="${todayStr()}"><select id="evKind" class="inp">${EVENT_KINDS.map((k) => `<option>${k}</option>`).join('')}</select><input id="evTitle" class="inp" placeholder="예: 3분기 실적 발표"><button class="btn primary sm" data-act="addEvent">추가</button></div>`);

    /* 종목 메모 */
    const mkey = 'stock_' + st.id;
    h += section('memo', '종목 메모', null, `<div class="row between wrap"><div class="grow">${noteLine(mkey) || '<span class="muted">투자 아이디어, 체크할 것 등을 적어 두세요 (서식·표·사진 가능).</span>'}</div><div class="row gap">${noteBtn(mkey, true)} ${state.noteIdx[mkey] ? `<button class="btn sm" data-act="noteEdit" data-key="${mkey}">수정</button>` : ''}</div></div>`);

    /* 매매 일지 */
    const tl = [];
    st.lots.forEach((l) => tl.push({ type: 'lot', date: l.date, lot: l }));
    st.sales.forEach((s) => tl.push({ type: 'sale', date: s.date, sale: s }));
    tl.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const shown = ui.journalOnly ? tl.filter((r) => state.noteIdx[(r.type === 'lot' ? 'lot_' + r.lot.id : 'sale_' + r.sale.id)]) : tl;
    h += section('journal', '매매 일지 <small class="muted">복기</small>', tl.length, `<label class="chk"><input type="checkbox" data-change="journalOnly" ${ui.journalOnly ? 'checked' : ''}> 사유가 있는 것만</label>
      ${shown.length ? shown.map((r) => {
        const key = r.type === 'lot' ? 'lot_' + r.lot.id : 'sale_' + r.sale.id;
        return `<div class="tl"><div class="tl-h"><span class="tl-d">${fd(r.date)}</span> ${r.type === 'lot' ? `<span class="tag buy">매수 ${r.lot.no}번</span> ${qn(r.lot.qty)}주 @${fmtNum(r.lot.price, us ? 2 : 0)}` : `<span class="tag sell">매도</span> ${qn(r.sale.qty)}주 @${fmtNum(r.sale.price, us ? 2 : 0)} · ${money(r.sale.pnlKRW, 'KRW')} ${pct(r.sale.costKRW > 0 ? r.sale.pnlKRW / r.sale.costKRW : null)}`}</div>${noteLine(key)}<div class="tl-b">${noteBtn(key, true)} ${state.noteIdx[key] ? `<button class="btn sm" data-act="noteEdit" data-key="${key}">수정</button>` : ''}</div></div>`;
      }).join('') : '<p class="muted">표시할 기록이 없습니다.</p>'}`);
    return h;
  };

  function lotRow(st, l, v, cur, us) {
    const done = v.rem <= 0;
    const days = SM.daysBetween(l.date, todayStr());
    const sold = SM.lotSold(st, l.id) > 0;
    const key = 'lot_' + l.id, has = !!state.noteIdx[key];
    const open = ui.openLots.has(l.id);
    const retV = us ? v.retKRW : v.ret;
    const chip = done ? '<span class="chip off">완료</span>' : retV != null ? `<span class="chip ${retV >= 0 ? 'up' : 'down'}">${fmtPct(retV)}</span>` : '<span class="muted">-</span>';
    const pnl = done || v.unrl == null ? '<span class="muted">-</span>' : money(us ? v.unrlKRW : v.unrl, 'KRW');
    const acts = [
      abtn('note', 'note', has ? '사유 보기' : '사유 쓰기', has ? 'on' : '', `data-key="${key}"`),
      abtn('editLot', 'edit', '수정', '', `data-id="${l.id}"`),
      !sold && l.qty > 1 ? abtn('splitLot', 'scissors', '분할', '', `data-id="${l.id}"`) : '',
      l.parts && !sold ? abtn('unmerge', 'undo', '병합취소', '', `data-id="${l.id}"`) : '',
      !sold ? abtn('delLot', 'trash', '삭제', 'danger', `data-id="${l.id}"`) : '',
    ].join('');
    return `<div class="lrow ${done ? 'done' : ''} ${open ? 'open' : ''}" role="listitem" data-act="lotToggle" data-id="${l.id}">
      <label class="lchk">${done ? '' : `<input type="checkbox" data-change="selLot" data-id="${l.id}" ${ui.selected.has(l.id) ? 'checked' : ''} aria-label="${l.no}번 선택">`}</label>
      <b class="lno">${l.no}번${l.parts ? ' <small class="tag">병합</small>' : ''}${has ? ` <button type="button" class="nmark" data-act="note" data-key="${key}" title="사유 보기" aria-label="${l.no}번 사유 보기">${ic('note')}</button>` : ''}</b>
      <span class="ldate">${fd(l.date)}<small class="muted"> · ${days}일</small></span>
      <span class="lqty">${done ? '<span class="muted">매도완료</span>' : `<b>${qn(v.rem)}주</b>${v.rem !== l.qty ? `<small class="muted">/${qn(l.qty)}</small>` : ''}`} <span class="muted">@${fmtNum(l.price, us ? 2 : 0)}</span></span>
      <span class="lret">${chip}</span><span class="lpnl">${pnl}</span>
      <span class="acts">${acts}</span>
      <div class="ldet">수수료 ${fmtMoney(l.fee, cur)} · 수수료 포함 단가 ${fmtMoney(l.price + SM.lotFeePerShare(l), cur)}${us ? ` · 매수환율 ${fmtNum(l.fx, 2)}${!done && v.ret != null ? ` · 달러 기준 ${fmtPct(v.ret)}` : ''}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}${has ? `<div class="nprev">${esc(state.noteIdx[key].t)}</div>` : ''}</div>
    </div>`;
  }

  function saleRow(st, s, cur, us) {
    const key = 'sale_' + s.id, has = !!state.noteIdx[key];
    const r = s.costKRW > 0 ? s.pnlKRW / s.costKRW : null;
    return `<div class="srow"><span class="sd">${fd(s.date)}</span><span class="sq"><b>${qn(s.qty)}주</b> <span class="muted">@${fmtNum(s.price, us ? 2 : 0)}${us ? ` (환율 ${fmtNum(s.fx, 0)})` : ''}</span></span>
      <span class="sl muted">${s.lines.map((l) => `${l.lotNo}번×${qn(l.qty)}`).join(', ')}</span>
      <span class="sr"><span class="chip ${r >= 0 ? 'up' : 'down'}">${fmtPct(r)}</span> ${money(s.pnlKRW, 'KRW')}</span>
      <span class="acts inline">${abtn('note', 'note', has ? '사유 보기' : '사유 쓰기', has ? 'on' : '', `data-key="${key}"`)}${abtn('delSale', 'trash', '삭제', 'danger', `data-id="${s.id}"`)}</span></div>`;
  }

  /* ---------- 종목/순번 폼 ---------- */
  function stockForm(st) {
    const watch = st ? !!st.watch : ui.stockTab === 'watch';
    openModal(`<h3>${st ? (watch ? '관심 종목 수정' : '종목 수정') : (watch ? '관심 종목 추가' : '종목 추가')}</h3>
      <label>종목명 <small class="muted">(국내 종목은 이름·초성으로 검색)</small><input name="name" value="${esc(st ? st.name : '')}" required placeholder="예: 한국전력, 산일, ㅅㅇㅈㄱ" data-suggest="name" autocomplete="off"></label>
      <div class="suggest" id="stSuggest" hidden></div>
      <label>종목코드/티커 (선택)<input name="code" value="${esc(st ? st.code : '')}" placeholder="국내 6자리 코드(예: 015760) / 해외 티커(예: AAPL)" data-suggest="code" autocomplete="off" autocapitalize="characters"></label>
      <div class="codehint" id="stCodeHint" aria-live="polite"></div>
      <label>시장<select name="market" data-seg ${st && st.lots.length ? 'disabled' : ''}>${opts([['KR', '국내 (원화)'], ['US', '해외 (달러, 환율 기록)']], st ? st.market : 'KR')}</select></label>
      ${watch ? `<label>목표 매수가 (선택)<input name="target" value="${st && st.target ? st.target : ''}" inputmode="decimal" placeholder="이 가격 이하면 사고 싶다"></label>` : ''}
      ${st && st.lots.length ? '<p class="hint">매수 기록이 있는 종목은 시장을 바꿀 수 없습니다.</p>' : ''}
      <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => {
      const name = String(fd.get('name') || '').trim();
      if (!name) return toast('종목명을 입력하세요', true);
      let code = String(fd.get('code') || '').trim();
      if (fd.get('market') === 'KR' && code) code = code.toUpperCase(); // 국내 코드는 대문자(예: 0126Z0)
      if (fd.get('market') === 'KR' && code && !/^[0-9A-Z]{6}$/.test(code) && !confirm(`국내 종목코드는 6자리(숫자·영문 대문자)입니다. “${code}”는 가격이 아닌가요?\n이대로 저장하면 자동 수집 대상에서 빠집니다. 그래도 저장할까요?`)) return;
      const target = fd.has('target') && String(fd.get('target')).trim() !== '' ? num(fd.get('target')) : null;
      if (st) { st.name = name; st.code = code; if (!st.lots.length) st.market = fd.get('market'); if (fd.has('target')) st.target = target; }
      else { const ns = SM.newStock({ name, code, market: fd.get('market'), watch }); if (watch) ns.target = target; state.stocks.push(ns); ui.stockId = ns.id; }
      save(); closeModal(); render();
    });
  }

  /* 매수 입력 미리보기: 저장 전에 평단·총액·손익분기·하락 시나리오를 보여줍니다 */
  function lotPrevHtml(st, res, qtyNote) {
    const cur = SM.curOf(st), us = st.market === 'US';
    const edit = res.editing;
    let h = `<div class="prev-h">${ic('info')}<b>저장 전 미리보기</b><small>${edit ? '수정 전 → 수정 후' : '이번 매수를 반영하면'}</small></div>`;
    if (qtyNote) h += `<p class="prev-note">${esc(qtyNote)}</p>`;
    if (!res.ok) return h + `<p class="muted prev-empty">${esc(res.msg)}</p>`;
    const b = res.before, a = res.after, ch = res.change;
    const row = (label, before, after, sub, cls) => `<div class="prow ${cls || ''}"><span class="pl">${label}</span><span class="b">${before}</span><span class="ar">${ic('chevR')}</span><span class="a">${after}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    const dash = '<span class="muted">-</span>';
    const chip = (v) => (v == null ? '' : `<span class="chip neu">${fmtPct(v)}</span>`);
    h += `<div class="prow head"><span></span><span class="b">${edit ? '수정 전' : '현재'}</span><span></span><span class="a">${edit ? '수정 후' : '매수 후'}</span></div>`;
    h += row('보유 수량', b.qty > 0 ? qn(b.qty) + '주' : dash, qn(a.qty) + '주', ch.qty ? `${ch.qty > 0 ? '+' : ''}${qn(ch.qty)}주` : '');
    h += row('평단가', b.avg != null ? fmtMoney(b.avg, cur) : dash, `${fmtMoney(a.avg, cur)} ${chip(ch.avg)}`);
    h += row('수수료 포함', b.avgInclFee != null ? fmtMoney(b.avgInclFee, cur) : dash, fmtMoney(a.avgInclFee, cur));
    if (us) h += row('원화 평단', b.avgKRW != null ? fmtMoney(b.avgKRW, 'KRW') : dash, fmtMoney(a.avgKRW, 'KRW'), `매수 환율 ${fmtNum(res.buy.fx, 2)} 반영`);
    h += row('총 매입금', b.qty > 0 ? fmtMoney(b.cost, cur) : dash, fmtMoney(a.cost, cur), `${edit ? '변화' : '이번 매수'} ${ch.cost >= 0 ? '+' : ''}${fmtMoney(ch.cost, cur)}`);
    h += `<div class="prow sum"><span class="pl">이번 매수 금액</span><span class="a wide">${fmtMoney(res.buy.total, cur)}</span><small>${fmtMoney(res.buy.gross, cur)} + 수수료 ${fmtMoney(res.buy.fee, cur)} (${res.feeAuto ? '설정 요율로 자동' : '직접 입력'})${us ? ` · 약 ${fmtMoney(res.buy.totalKRW, 'KRW')}` : ''}</small></div>`;
    const be = res.breakEven;
    h += row('손익분기 매도가', be.before && b.qty > 0 ? fmtMoney(be.before, cur) : dash, fmtMoney(be.after, cur), `매도 수수료·세금 반영${res.riseNeeded != null ? (res.riseNeeded > 0 ? ` · 현재가에서 <b>${fmtPct(res.riseNeeded)}</b> 올라야 본전` : ` · 현재가가 손익분기보다 <b>${(Math.abs(res.riseNeeded) * 100).toFixed(1)}%</b> 높음`) : ''}${us ? ' · 환율 변동 제외' : ''}`);
    const refTxt = res.refIsBuy ? `이번 매수가 ${fmtNum(res.refPrice, us ? 2 : 0)}` : `현재가 ${fmtNum(res.refPrice, us ? 2 : 0)}`;
    h += row('평가손익', b.qty > 0 ? money(res.unrl.before, 'KRW') : dash, money(res.unrl.after, 'KRW'), `${refTxt} 기준${res.refIsBuy ? ' (현재가 미입력)' : ''}`);
    const lossB = res.unrl.before - res.down10.before, lossA = res.unrl.after - res.down10.after;
    h += row('10% 하락 시', b.qty > 0 ? money(res.down10.before, 'KRW') : dash, money(res.down10.after, 'KRW'), `${fmtNum(res.down10.price, us ? 2 : 0)}로 하락 · 줄어드는 금액 ${b.qty > 0 ? fmtMoney(lossB, 'KRW') + ' → ' : ''}<b>${fmtMoney(lossA, 'KRW')}</b>${b.qty > 0 && lossA > lossB ? ` (+${fmtMoney(lossA - lossB, 'KRW')})` : ''}`);
    h += `<p class="hint prev-foot">평단이 낮아져도 이미 난 손실이 줄어드는 것은 아니고, 투입금이 늘어난 만큼 이후 가격 변동의 영향도 커집니다.${us ? ' 평가손익은 현재 환율 ' + fmtNum(state.settings.fxNow, 0) + '원 기준 원화입니다.' : ''}</p>`;
    h += res.errors.map((e) => `<p class="prev-err">${ic('alert')} ${esc(e)}</p>`).join('') + res.warnings.map((w) => `<p class="prev-warn">${ic('alert')} ${esc(w)}</p>`).join('');
    return h;
  }
  function lotPrevRefresh() {
    const ctx = A.lotPrev;
    const form = document.getElementById('mform');
    const host = document.getElementById('lotPrev');
    if (!ctx || !form || !host) return;
    const st = state.stocks.find((x) => x.id === ctx.stockId);
    if (!st) return;
    const tg = ctx.paper ? SM.paperStock(st) : st;
    const pset = ctx.paper ? SM.paperSettings(state.settings, st.paper.fee) : state.settings;
    const g = (n) => (form.elements[n] ? form.elements[n].value : '');
    const cur = SM.curOf(st);
    const byAmt = !!(form.elements.byAmount && form.elements.byAmount.checked);
    const amtRow = form.querySelector('.amtrow');
    if (amtRow) amtRow.hidden = !byAmt;
    form.elements.qty.readOnly = byAmt;
    let qtyNote = '';
    if (byAmt) {
      const r = SM.qtyForAmount(st, g('amount'), g('price'), pset, g('fee'));
      form.elements.qty.value = r.qty > 0 ? String(r.qty) : '';
      qtyNote = r.qty > 0 ? `금액 ${fmtMoney(num(g('amount')), cur)} → ${qn(r.qty)}주 (사용 ${fmtMoney(r.used, cur)}, 남는 금액 ${fmtMoney(r.rest, cur)})` : (num(g('amount')) > 0 && num(g('price')) > 0 ? '입력한 금액으로는 1주도 살 수 없습니다.' : '금액과 매수가를 입력하면 수량이 자동 계산됩니다.');
    }
    const res = SM.lotPreview(tg, { price: g('price'), qty: g('qty'), fee: g('fee'), fx: g('fx'), date: g('date') }, pset, ctx.lotId);
    if (ctx.paper && g('date') && g('date') < todayStr()) res.warnings.push('과거 날짜로 입력하면 “사후 입력”으로 표시됩니다. 결과를 알고 입력하는 매매라서 앞으로의 판단을 검증하는 용도로는 의미가 약합니다.');
    host.innerHTML = lotPrevHtml(st, res, qtyNote);
    const bar = document.getElementById('lotPrevBar');
    if (bar) bar.innerHTML = lotPrevBarHtml(st, res);
  }
  function lotPrevBarHtml(st, res) {
    if (!res.ok) return `<span class="muted">${ic('info')} 매수가와 수량을 입력하면 평단가가 여기에 표시됩니다.</span>`;
    const cur = SM.curOf(st), b = res.before, a = res.after, ch = res.change;
    return `<span class="pb-l">${res.editing ? '수정 후' : '매수 후'} 평단</span><span class="pb-v">${b.avg != null ? `<s>${fmtMoney(b.avg, cur)}</s> ${ic('chevR')}` : ''}<b>${fmtMoney(a.avg, cur)}</b>${ch.avg != null ? ` <span class="chip neu">${fmtPct(ch.avg)}</span>` : ''}</span><span class="pb-s">${qn(a.qty)}주 · 총 ${fmtMoney(a.cost, cur)}</span>`;
  }
  A.lotPrevRefresh = lotPrevRefresh;

  const ymdLocal = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  // opt: { paper: 가상 매수, prefill: {date, price, qty}, planId: 계획 단계에서 열었을 때, fromPaper: 가상 매수를 실제로 전환할 때 }
  function lotForm(st, lot, opt) {
    opt = opt || {};
    const paper = !!opt.paper, pf = opt.prefill || {};
    const us = st.market === 'US', cur = SM.curOf(st);
    A.lotPrev = { stockId: st.id, lotId: lot ? lot.id : null, paper };
    openModal(`<h3>${paper ? (lot ? lot.no + '번 가상 매수 수정' : '가상 매수 추가') : (lot ? lot.no + '번 수정' : '매수 추가')} · ${esc(st.name)}${paper ? ' <span class="tag paper">가상</span>' : ''}</h3>
      ${paper ? '<p class="hint">실제 계좌와 무관한 가상 기록입니다. 가상 손익에만 반영됩니다.</p>' : ''}
      <div class="grid2"><label>매수일<input type="date" name="date" value="${lot ? lot.date : (pf.date || todayStr())}" required></label>
      <label>매수가 (${cur})<input name="price" value="${lot ? lot.price : (pf.price || '')}" inputmode="decimal" required></label>
      <label>수량(주)<input name="qty" value="${lot ? lot.qty : (pf.qty || '')}" inputmode="decimal" required></label>
      <label class="amtrow" hidden>금액 (${cur})<input name="amount" inputmode="decimal" placeholder="예: ${us ? '1000' : '1000000'}"></label>
      ${us ? `<label>매수 환율 (원/$)<input name="fx" value="${lot ? lot.fx : state.settings.fxNow}" inputmode="decimal"></label>` : ''}
      <label>매수 수수료 (${cur})<input name="fee" value="${lot ? lot.fee : ''}" inputmode="decimal" placeholder="비우면 설정 요율로 자동"></label>
      <label>메모<input name="note" value="${esc(lot ? lot.note : '')}" placeholder="선택"></label></div>
      ${paper ? `<div class="row gap wrap closerow"><button type="button" class="btn sm" data-act="paperClose">${ic('download')}이 날짜의 종가 채우기</button><small class="muted" id="closeMsg">연결된 가격 데이터나 자동 수집 시세가 있는 종목에서 쓸 수 있습니다.</small></div>` : ''}
      ${lot ? '' : '<label class="chk"><input type="checkbox" name="byAmount"> 금액으로 입력 (수량을 자동 계산)</label>'}
      <div id="lotPrev" class="prev" aria-live="polite"></div>
      ${lot && lot.parts ? '<p class="hint warn">병합된 순번을 수정하면 “병합 취소”로 되돌릴 수 없게 됩니다.</p>' : ''}
      ${paper ? '' : `<label class="chk"><input type="checkbox" name="writeNote" ${lot ? '' : 'checked'}> 저장 후 매수 사유 작성하기 (서식·표·사진 가능)</label>`}
      <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-act="closeModal">취소</button></div>
      <div id="lotPrevBar" class="prev-bar" aria-hidden="true"></div>`, (fd) => {
      const f = Object.fromEntries(fd.entries());
      const tg = paper ? SM.paperStock(st) : st;
      const pset = paper ? SM.paperSettings(state.settings, st.paper.fee) : state.settings;
      let saved;
      try { saved = lot ? SM.updateLot(tg, lot.id, f, pset) : SM.addLot(tg, f, pset); }
      catch (e) { return toast(e.message, true); }
      const step = opt.planId ? (st.plan || []).find((p) => p.id === opt.planId) : null;
      if (paper) {
        if (lot) saved.pre = SM.isPre(saved.date, ymdLocal(saved.at || Date.now())); else SM.tagPaper(saved);
        if (step) step.paperLot = saved.id;
        save(); closeModal(); render(); return toast(lot ? '수정했습니다' : '가상 매수를 기록했습니다');
      }
      let moved = false;
      if (!lot && st.watch) { st.watch = false; ui.stockTab = 'held'; moved = true; }
      if (step) { step.done = true; step.realLot = saved.id; }
      if (opt.fromPaper) { const pl = st.paper.lots.find((x) => x.id === opt.fromPaper); if (pl) pl.realLot = saved.id; }
      save(); closeModal(); render(); toast(moved ? '매수를 기록했고 보유 종목으로 이동했습니다' : (lot ? '수정했습니다' : '매수를 기록했습니다'));
      if (f.writeNote) editNote('lot_' + saved.id);
    });
    lotPrevRefresh();
  }

  /* ---------- 매도 / 시뮬레이션 ---------- */
  const sellCtx = () => {
    const real = state.stocks.find((x) => x.id === (A.sell || {}).stockId);
    if (!real) return null;
    return A.sell.paper ? { real, tg: SM.paperStock(real), set: SM.paperSettings(state.settings, real.paper.fee), paper: true } : { real, tg: real, set: state.settings, paper: false };
  };
  function openSell(realSt, opt) {
    opt = opt || {};
    const paper = !!opt.paper;
    const st = paper ? SM.paperStock(realSt) : realSt;
    const sel = paper ? ui.paperSel : ui.selected;
    const us = st.market === 'US', cur = SM.curOf(st);
    const lots = st.lots.filter((l) => SM.lotRem(st, l) > 0).sort((a, b) => a.no - b.no);
    A.sell = { stockId: realSt.id, paper };
    openModal(`<h3>${paper ? '가상 매도' : '매도 계산'} · ${esc(st.name)}${paper ? ' <span class="tag paper">가상</span>' : ''}</h3>
      <p class="hint">${paper ? '실제 계좌와 무관한 가상 매도입니다. 저장하면 가상 손익에 기록됩니다.' : '“매도 기록 저장”을 누르기 전까지는 아무것도 기록되지 않는 계산입니다.'}</p>
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
      ${lots.map((l) => `<tr class="sellrow" data-lot="${l.id}"><td><input type="checkbox" class="schk" ${sel.has(l.id) ? 'checked' : ''}></td><td><b>${l.no}번</b></td><td>${fmtMoney(l.price, cur)}</td><td>${fmtNum(SM.lotRem(st, l), 4).replace(/\.?0+$/, '')}</td>
      <td><input class="sq inp" inputmode="decimal" value="${sel.has(l.id) ? SM.lotRem(st, l) : ''}" style="width:90px"></td><td class="spnl">-</td><td class="sret">-</td></tr>`).join('')}
      </tbody></table></div>
      <div id="sellOut"></div>
      ${paper ? '' : '<label class="chk"><input type="checkbox" id="sNote" checked> 저장 후 매도 사유 작성하기 (서식·표·사진 가능)</label>'}
      <div class="btns"><button class="btn primary" type="submit">${paper ? '가상 매도 저장' : '매도 기록 저장'}</button><button class="btn" type="button" data-act="closeModal">닫기</button></div>`,
      () => saveSale(realSt, paper), true);
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
    const ctx = sellCtx();
    if (!ctx) return;
    const st = ctx.tg, sset = ctx.set;
    const cur = SM.curOf(st), us = st.market === 'US';
    const { lines, p } = sellRead(st);
    const out = document.getElementById('sellOut');
    document.querySelectorAll('.sellrow').forEach((tr) => { tr.querySelector('.spnl').textContent = '-'; tr.querySelector('.sret').textContent = '-'; });
    if (!(num(p.price) > 0)) { out.innerHTML = '<p class="muted">매도가를 입력하면 순번별 손익이 계산됩니다.</p>'; return; }
    if (!lines.length) { out.innerHTML = '<p class="muted">매도할 순번의 수량을 입력하거나 체크하세요.</p>'; return; }
    const c = SM.computeSale(st, lines, p, sset);
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
      const r = SM.computeSale(st, x.lines, p, sset);
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
  function saveSale(realSt, paper) {
    const st = paper ? SM.paperStock(realSt) : realSt;
    const sset = paper ? SM.paperSettings(state.settings, realSt.paper.fee) : state.settings;
    const { lines, p } = sellRead(st);
    if (!(num(p.price) > 0)) return toast('매도가를 입력하세요', true);
    if (!lines.length) return toast('매도할 수량을 입력하세요', true);
    if (us(st) && !(num(p.fx) > 0)) return toast('매도 환율을 입력하세요', true);
    const c = SM.computeSale(st, lines, p, sset);
    if (!confirm(`${paper ? '[가상] ' : ''}${c.lines.map((l) => l.lotNo + '번×' + l.qty).join(', ')}\n${fmtMoney(c.price, SM.curOf(st))} 에 매도, 실현손익 ${fmtMoney(c.pnlKRW, 'KRW')}\n\n기록할까요?`)) return;
    const sale = SM.recordSale(st, c);
    if (paper) { SM.tagPaper(sale); ui.paperSel.clear(); save(); closeModal(); render(); return toast('가상 매도를 기록했습니다'); }
    if (!st.price) SM.setPrice(st, c.price);
    ui.selected.clear();
    const writeNote = document.getElementById('sNote') && document.getElementById('sNote').checked;
    save(); closeModal(); render(); toast('매도를 기록했습니다');
    if (writeNote) editNote('sale_' + sale.id);
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
      <div class="filters"><label>보기<select data-change="pnlf" data-k="group" data-seg>${opts([['month', '월별'], ['year', '연도별'], ['stock', '종목별'], ['all', '기간 합계']], f.group)}</select></label>
      <label>종목<select data-change="pnlf" data-k="stockId">${opts(stockOpts, f.stockId)}</select></label>
      <label>시작일<input type="date" data-change="pnlf" data-k="from" value="${f.from}"></label>
      <label>종료일<input type="date" data-change="pnlf" data-k="to" value="${f.to}"></label></div>
      <div class="cards small"><div class="stat"><span>실현손익 (수수료·세금 반영, 원화)</span><b>${money(rep.total.pnlKRW, 'KRW')}</b></div>
      <div class="stat"><span>수익률 (매입 원가 대비)</span><b>${pct(rep.total.ret)}</b></div>
      <div class="stat"><span>매도 건수 / 이익 건수</span><b>${rep.total.count} / ${rep.total.wins}</b></div>
      <div class="stat"><span>수수료·세금 합계</span><b>${fmtMoney(rep.total.feesKRW, 'KRW')}</b></div>
      <div class="stat"><span>배당 수령 (세후, ${rep.div.count}건)</span><b>${money(rep.div.netKRW, 'KRW')}</b></div>
      <div class="stat"><span>실현손익 + 배당</span><b>${money(rep.total.pnlKRW + rep.div.netKRW, 'KRW')}</b></div></div>
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
      <label>시장 (수수료율)<select data-calc="market" data-seg>${opts([['KR', '국내'], ['US', '해외']], c.market)}</select></label>
      <label>현재 보유 수량<input data-calc="baseQty" value="${esc(c.baseQty)}" inputmode="decimal"></label>
      <label>현재 평단가<input data-calc="baseAvg" value="${esc(c.baseAvg)}" inputmode="decimal"></label></div>
      <h4>추가 매수 계획</h4>
      ${c.buys.map((b, i) => `<div class="row gap buyrow"><span class="idx">${i + 1}</span><input class="inp" data-calcbuy="${i}.qty" value="${esc(b.qty)}" inputmode="decimal" placeholder="수량"><input class="inp" data-calcbuy="${i}.price" value="${esc(b.price)}" inputmode="decimal" placeholder="매수가"><button class="btn sm danger" type="button" data-act="calcDel" data-i="${i}" aria-label="삭제">${ic('x')}</button></div>`).join('')}
      <div class="row gap"><button class="btn" data-act="calcAdd">${ic('plus')}매수 추가</button><label class="chk"><input type="checkbox" data-calc="feeOn" ${c.feeOn ? 'checked' : ''}> 매수 수수료 포함</label></div>
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
    const T = {};
    T.basic = `<section class="card"><h2>수수료 · 세금 (%)</h2><p class="hint warn">아래 기본값은 예시입니다. 실제 요율은 증권사·시기에 따라 다르므로 직접 확인해서 고쳐 주세요. 이미 기록된 매도 건은 <b>매도 당시의 금액이 그대로 보존</b>되고, 바꾼 요율은 이후 계산에만 적용됩니다.</p>
      <div class="cols"><div><h4>국내</h4><div class="grid2">${f('kr.buyFee', '매수 수수료')}${f('kr.sellFee', '매도 수수료')}${f('kr.sellTax', '매도 거래세 등')}</div></div>
      <div><h4>해외</h4><div class="grid2">${f('us.buyFee', '매수 수수료')}${f('us.sellFee', '매도 수수료')}${f('us.sellTax', '매도 시 기타 세금')}${f('us.taxRate', '양도세율')}${f('us.deduction', '연 기본공제(원)')}</div></div></div>
      <div class="grid2">${f('fxNow', '현재 환율 (원/$)')}<label>수익 색상<select data-setting="upColor" data-seg>${opts([['red', '빨강 수익 (한국식)'], ['green', '초록 수익 (해외식)']], s.upColor)}</select><small class="muted">한국식: 수익 빨강·손실 파랑 / 해외식: 수익 초록·손실 빨강</small></label></div></section>
      <section class="card"><h2>종목 바로가기 링크</h2>
      <div class="grid2"><label>링크 열기 방식 <small class="muted">(공시·뉴스 링크 포함)</small><select data-setting="linkMode" data-seg>${opts([['tab', '새 창'], ['browser', '기본 브라우저'], ['app', '앱 안에서 보기']], s.linkMode)}</select><small class="muted">새 창: 브라우저 새 탭 · 기본 브라우저: 안드로이드에서 앱 안 임시 탭을 피함 · 앱 안에서 보기: 이 앱의 보기 창(막는 사이트는 안 열림)</small></label></div>
      <p class="hint"><b>홈 화면에 설치한 앱</b>에서는 ‘새 창’이 앱 안의 인앱 탭(위에 X·제목·⋮가 있는 창)으로 열립니다. 이건 휴대폰(안드로이드)이 정하는 동작이라 앱 설정으로 막을 수 없습니다. 안드로이드에서 브라우저 쪽으로 보내려면 <b>기본 브라우저로 열기</b>를 고르세요. 기기에 따라 브라우저 선택 창이 뜰 수도 있고, 안 되는 기기에서는 원래 주소로 열립니다. (PC나 일반 브라우저에서는 새 창과 같습니다.)</p>
      <p class="hint">앱 안에서 보기는 사이트를 이 앱 화면 위에 띄웁니다. <b>네이버·구글 등 많은 사이트가 이 방식을 막아 두어서</b> 화면이 비거나 “연결을 거부했습니다”로 나올 수 있습니다. 그럴 때는 보기 창의 <b>새 창으로 열기</b>를 쓰거나 “이 사이트는 항상 새 창으로”를 눌러 두세요. 링크마다 따로 정하려면 아래 목록의 열기 방식을 바꾸세요.</p>
      ${(s.linkTabHosts || []).length ? `<div class="pinhosts"><small class="muted">새 창으로 고정한 사이트:</small> ${s.linkTabHosts.map((h) => `<span class="pinhost">${esc(h)}<button type="button" data-act="hostUnpin" data-host="${esc(h)}" aria-label="${esc(h)} 고정 해제">${ic('x')}</button></span>`).join('')}</div>` : ''}
      <p class="hint">종목 화면에 보이는 링크입니다. 주소에 <code>{code}</code>(종목코드/티커)와 <code>{name}</code>(종목명)을 넣으면 종목마다 자동으로 바뀝니다. 사이트 주소 형식이 바뀌면 여기서 직접 고치세요.</p>
      ${s.links.map((l, i) => `<div class="linkrow"><input class="inp" data-link="${i}.label" value="${esc(l.label)}" placeholder="이름"><input class="inp wide" data-link="${i}.url" value="${esc(l.url)}" placeholder="https://..."><select class="inp" data-link="${i}.market" aria-label="시장">${opts([['ALL', '전체'], ['KR', '국내'], ['US', '해외']], l.market || 'ALL')}</select><select class="inp" data-link="${i}.open" aria-label="열기 방식">${opts([['default', '기본 방식'], ['tab', '새 창'], ['browser', '브라우저로'], ['app', '앱 안에서']], l.open || 'default')}</select><button class="btn sm danger" data-act="linkDel" data-i="${i}" aria-label="삭제">${ic('x')}</button></div>`).join('')}
      <div class="btns"><button class="btn" data-act="linkAdd">${ic('plus')}링크 추가</button><button class="btn sm" data-act="linkReset">기본값으로</button></div></section>`;
    T.auto = A.autoCard ? A.autoCard() : '';
    T.sync = `<section class="card" id="syncCard">${syncCard()}</section>
      <section class="card"><h2>백업 / 복원</h2><p class="hint">동기화를 쓰더라도 정기적으로 백업 파일을 받아두세요. (브라우저 데이터 삭제, 로그인 문제에 대비)</p>
      <label class="chk"><input type="checkbox" id="expImg" checked> 매매 사유의 사진도 백업에 포함 (파일이 커질 수 있습니다)</label>
      <div class="btns"><button class="btn primary" data-act="export">백업 내려받기 (JSON)</button><label class="btn file">백업 불러오기<input type="file" accept=".json,application/json" data-change="import" hidden></label></div>
      <div class="btns"><button class="btn" data-act="gcImages">사용하지 않는 사진 정리</button><button class="btn danger" data-act="wipe">이 기기의 모든 데이터 삭제</button></div>
      <p class="hint">${state.lastBackupAt ? '마지막 백업: ' + new Date(state.lastBackupAt).toLocaleString('ko-KR') : '아직 백업한 적이 없습니다.'}</p></section>
      <section class="card"><details><summary><b>Firebase 준비 방법 (처음 한 번)</b></summary>
      <ol class="steps"><li><a href="https://console.firebase.google.com" target="_blank" rel="noopener">Firebase 콘솔</a>에서 프로젝트를 만듭니다 (Google Analytics는 꺼도 됩니다).</li>
      <li><b>Authentication → 시작하기 → Sign-in method</b>에서 <b>Google</b>과 <b>이메일/비밀번호</b>를 사용 설정합니다.</li>
      <li>Authentication → <b>Settings → Authorized domains</b>에 이 앱 주소의 도메인(예: <code>${esc(location.hostname || '아이디.github.io')}</code>)을 추가합니다.</li>
      <li><b>Firestore Database → 데이터베이스 만들기</b> (프로덕션 모드, 지역은 가까운 곳).</li>
      <li>Firestore <b>규칙(Rules)</b> 탭에 아래 내용을 붙여 넣고 <b>게시</b>합니다. 이 규칙이 “내 계정만 내 데이터 접근”을 보장하는 유일한 장치입니다.<pre id="rulesTxt">${esc(RULES)}</pre><button class="btn sm" data-act="copyRules">규칙 복사</button></li>
      <li>프로젝트 설정(톱니바퀴) → <b>일반 → 내 앱 → 웹 앱(&lt;/&gt;) 추가</b> 후 나오는 <code>firebaseConfig</code> 블록을 위 칸에 붙여 넣습니다.</li></ol></details></section>`;
    T.about = `${A.updateCard ? A.updateCard() : ''}
      <section class="card"><h2>이 앱에 대하여</h2><p class="hint">휴대폰에서는 브라우저 메뉴의 “홈 화면에 추가”로 앱처럼 설치할 수 있습니다. 백테스트용 가격 데이터는 용량 때문에 동기화되지 않고 기기별로 저장됩니다. 이 앱의 계산 결과는 참고용이며 투자 판단과 세금 신고의 책임은 사용자에게 있습니다.</p></section>`;
    const tabs = [['basic', '기본 설정'], ['auto', '자동 수집'], ['sync', '동기화 · 백업'], ['about', '앱 정보']];
    const cur = T[ui.setTab] !== undefined ? ui.setTab : 'basic';
    return `<div class="grpseg-wrap"><div class="seg2 grpseg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${cur === k}" class="${cur === k ? 'on' : ''}" data-act="setTab" data-v="${k}">${l}</button>`).join('')}</div></div>${T[cur]}`;
  };

  /* ---------- 이벤트 ---------- */
  const H = A.handlers;
  Object.assign(H, {
    nav: (el) => { ui.view = el.dataset.v; render(); window.scrollTo(0, 0); },
    sideToggle: () => { ui.sideRail = !ui.sideRail; try { localStorage.setItem('stockmgr.sideRail', ui.sideRail ? '1' : '0'); } catch (e) { /* ignore */ } render(); },
    goSettings: (el) => { ui.view = 'settings'; if (el && el.dataset && el.dataset.tab) ui.setTab = el.dataset.tab; render(); window.scrollTo(0, 0); },
    setTab: (el) => { ui.setTab = el.dataset.v; render(); window.scrollTo(0, 0); },
    tab: (el) => { ui.stockId = el.dataset.id; ui.selected.clear(); render(); },
    addStock: () => stockForm(null),
    editStock: () => stockForm(curStock()),
    delStock: () => {
      const st = curStock();
      if (!confirm(`“${st.name}” 종목을 삭제할까요?\n\n매수 ${st.lots.length}건과 매도 기록 ${st.sales.length}건, 이 종목의 실현손익 기록이 모두 삭제됩니다. 되돌릴 수 없습니다.`)) return;
      delNotes(SM.noteKeysOfStock(st));
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
      delNotes(['lot_' + l.id]);
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
      delNotes(['lot_' + el.dataset.id]); // 병합 때 합쳐 만든 사유는 정리 (원래 순번의 사유는 그대로)
      ui.selected.clear(); save(); render(); toast('병합을 취소하고 원래 순번으로 되돌렸습니다');
    },
    mergeSel: () => {
      const st = curStock();
      const ids = [...ui.selected];
      const nums = ids.map((id) => (st.lots.find((l) => l.id === id) || {}).no).filter(Boolean).sort((a, b) => a - b);
      if (!confirm(`${nums.join('번, ')}번을 하나의 순번(평단가 기준)으로 병합할까요?\n병합 후에도 “병합취소”로 원래 순번으로 되돌릴 수 있습니다.`)) return;
      let merged;
      try { merged = SM.mergeLots(st, ids); } catch (e) { return toast(e.message, true); }
      mergeNotes(merged.parts, merged);
      ui.selected.clear(); save(); render(); toast('병합했습니다');
    },
    openSell: () => openSell(curStock()),
    delSale: (el) => {
      const st = curStock(), s = st.sales.find((x) => x.id === el.dataset.id);
      if (!confirm(`${s.date} 매도 기록(${s.qty}주)을 삭제할까요?\n해당 순번의 잔여 수량이 원래대로 돌아옵니다.`)) return;
      delNotes(['sale_' + s.id]);
      st.sales = st.sales.filter((x) => x.id !== s.id); save(); render();
    },
    closeModal: () => closeModal(),
    lotToggle: (el, e) => {
      if (e && e.target.closest('input,button,a,label,select')) return;
      const id = el.dataset.id;
      if (ui.openLots.has(id)) ui.openLots.delete(id); else ui.openLots.add(id);
      el.classList.toggle('open');
    },
    lotFilter: (el) => { ui.showSold = el.dataset.v === 'all'; render(); },
    selAll: () => {
      const st = curStock();
      const held = st.lots.filter((l) => SM.lotRem(st, l) > 0);
      if (held.some((l) => ui.selected.has(l.id))) ui.selected.clear(); else held.forEach((l) => ui.selected.add(l.id));
      render();
    },
    goStock: (el) => { ui.stockId = el.dataset.id; const t = state.stocks.find((x) => x.id === ui.stockId); ui.stockTab = t && t.watch ? 'watch' : 'held'; ui.selected.clear(); ui.view = 'stocks'; render(); window.scrollTo(0, 0); },
    stockTab: (el) => { ui.stockTab = el.dataset.v; const first = state.stocks.find((x) => !!x.watch === (ui.stockTab === 'watch')); ui.stockId = first ? first.id : null; ui.selected.clear(); render(); },
    toWatch: () => { const st = curStock(); if (st.lots.length) return toast('매수 기록이 있는 종목은 관심 종목으로 옮길 수 없습니다', true); st.watch = true; st.watchAt = Date.now(); ui.stockTab = 'watch'; save(); render(); toast('관심 종목으로 옮겼습니다'); },
    toHeld: () => { const st = curStock(); st.watch = false; ui.stockTab = 'held'; save(); render(); toast('보유 종목으로 옮겼습니다 (실제 매수 기록을 추가하세요)'); },
    collectToggle: () => { const st = curStock(); st.collect = !st.collect; save(); render();
      const code = String(st.code || '').trim();
      if (st.collect && st.market !== 'KR') return toast('해외 종목은 자동 수집을 지원하지 않아 수집 대상 목록에 들어가지 않습니다.', true);
      if (st.collect && !/^[0-9A-Z]{6}$/.test(code)) return toast(`종목코드가 ${code ? '“' + code + '”로 6자리(숫자·영문 대문자) 코드가 아니라' : '비어 있어'} 목록에 들어가지 않습니다. ⋯ 메뉴 › 종목 수정에서 6자리 코드를 입력하세요.`, true);
      toast(st.collect ? '자동 수집 대상에 포함했습니다. 공개 저장소의 목록에 이 종목이 보입니다.' : '자동 수집 대상에서 뺐습니다'); },
    simForStock: () => { const st = curStock(); if (A.ui.bt) { A.ui.bt.stockId = st.id; A.ui.bt.simTab = 'bt'; if (A.btPickStock) A.btPickStock(st.id); } ui.view = 'backtest'; render(); window.scrollTo(0, 0); },
    note: (el) => openNote(el.dataset.key),
    noteEdit: (el) => editNote(el.dataset.key),
    divAdd: () => {
      const st = curStock(); if (!st) return;
      const us = st.market === 'US', cur = SM.curOf(st);
      openModal(`<h3>배당 기록 · ${esc(st.name)}</h3>
        <label>수령일<input type="date" name="date" value="${todayStr()}" required></label>
        <label>배당금 (세전, ${us ? '달러' : '원'}) <small class="muted">총액 기준</small><input name="gross" inputmode="decimal" data-divcalc placeholder="${us ? '예: 12.5' : '예: 85000'}" required></label>
        <label>세금 <small class="muted">(비우면 ${us ? '해외 15%' : '국내 15.4%'} 자동)</small><input name="tax" inputmode="decimal" data-divcalc placeholder="자동 계산"></label>
        ${us ? `<label>환율 (원/$) <small class="muted">비우면 현재 환율 ${fmtNum(state.settings.fxNow, 0)}</small><input name="fx" inputmode="decimal" data-divcalc placeholder="${state.settings.fxNow}"></label>` : ''}
        <label>메모 (선택)<input name="note" maxlength="100" placeholder="예: 2025 결산배당"></label>
        <div class="box" id="divPrev"><span class="muted">배당금을 입력하면 세후 수령액이 계산됩니다.</span></div>
        <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => {
        try { SM.addDividend(st, { date: fd.get('date'), gross: fd.get('gross'), tax: fd.get('tax'), fx: fd.get('fx'), note: fd.get('note') }, state.settings); }
        catch (e) { return toast(e.message, true); }
        ui.sec.div = true; save(); closeModal(); render(); toast('배당을 기록했습니다');
      });
    },
    divDel: (el) => { const st = curStock(); if (!st || !confirm('이 배당 기록을 삭제할까요?')) return; SM.removeDividend(st, el.dataset.id); save(); render(); },
    addEvent: () => {
      const st = curStock();
      try { SM.addEvent(st, { date: document.getElementById('evDate').value, kind: document.getElementById('evKind').value, title: document.getElementById('evTitle').value }); }
      catch (e) { return toast(e.message, true); }
      save(); render(); toast('일정을 추가했습니다');
    },
    delEvent: (el) => { SM.removeEvent(curStock(), el.dataset.id); save(); render(); },
    splitAdj: () => {
      const st = curStock();
      openModal(`<h3>액면분할 · 병합 조정 · ${esc(st.name)}</h3>
        <p class="hint">주식 수와 단가를 한 번에 조정합니다. <b>투자 금액과 손익은 그대로</b>이고 모든 순번·매도 기록의 수량과 단가가 같은 비율로 바뀝니다. 분할일 이전에 입력해 둔 기록을 분할 후 기준에 맞출 때 사용하세요.</p>
        <label>기존 1주가 몇 주가 되나요?<input name="ratio" inputmode="decimal" placeholder="1:5 분할이면 5 · 10주→1주 병합이면 0.1" required></label>
        <label>분할/병합일<input type="date" name="date" value="${todayStr()}"></label>
        <p class="hint warn">되돌리려면 반대 비율(예: 5 → 0.2)로 다시 조정하세요. 백테스트용 가격 데이터는 자동으로 바뀌지 않습니다. 조정 전에 백업을 권합니다.</p>
        <div class="btns"><button class="btn primary" type="submit">조정하기</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => {
        const r = num(fd.get('ratio'));
        const before = SM.stockSummary(st, state.settings);
        if (!confirm(`현재 보유 ${fmtNum(before.qty, 4)}주 → ${fmtNum(before.qty * r, 4)}주 (평단 ${fmtMoney(before.avg, SM.curOf(st))} → ${fmtMoney(before.avg / r, SM.curOf(st))})\n모든 순번과 매도 기록에 적용합니다. 진행할까요?`)) return;
        try { SM.splitAdjust(st, r, fd.get('date')); } catch (e) { return toast(e.message, true); }
        save(); closeModal(); render(); toast('조정했습니다');
      });
    },
    priceAll: () => {
      const hold = state.stocks.filter((st) => st.watch || SM.stockSummary(st, state.settings).qty > 0);
      if (!hold.length) return toast('보유 중인 종목이 없습니다', true);
      const hasUS = hold.some((s) => s.market === 'US');
      openModal(`<h3>현재가 한 번에 입력</h3><p class="hint">바뀐 값만 저장되고, 입력한 날짜가 함께 기록됩니다.</p>
        ${hold.map((st) => { const age = SM.priceAge(st); return `<label>${esc(st.name)} (${SM.curOf(st)}) <small class="${age > 3 ? 'stale' : 'muted'}">${st.price ? (age > 365 ? '입력일 불명' : age === 0 ? '오늘 입력' : age + '일 전 입력') : '미입력'}</small><input name="p_${st.id}" value="${st.price == null ? '' : st.price}" inputmode="decimal"></label>`; }).join('')}
        ${hasUS ? `<label>현재 환율 (원/$)<input name="fx" value="${state.settings.fxNow}" inputmode="decimal"></label>` : ''}
        <div class="btns"><button class="btn primary" type="submit">저장</button><button class="btn" type="button" data-act="closeModal">취소</button></div>`, (fd) => {
        let n = 0;
        for (const st of hold) {
          const v = fd.get('p_' + st.id);
          if (String(v).trim() === String(st.price == null ? '' : st.price)) continue;
          SM.setPrice(st, String(v).trim() === '' ? null : num(v)); n++;
        }
        if (hasUS && num(fd.get('fx')) > 0) state.settings.fxNow = num(fd.get('fx'));
        save(); closeModal(); render(); toast(n ? `${n}개 종목의 현재가를 저장했습니다` : '바뀐 값이 없습니다');
      });
    },
    linkAdd: () => { state.settings.links.push({ id: SM.uid(), label: '새 링크', url: 'https://example.com/?q={name}', market: 'ALL' }); save(); render(); },
    linkDel: (el) => { state.settings.links.splice(+el.dataset.i, 1); save(); render(); },
    linkReset: () => { if (!confirm('링크 목록을 기본값으로 되돌릴까요?')) return; state.settings.links = SM.DEFAULT_SETTINGS().links; save(); render(); },
    gcImages: async () => { const n = await SM.media.gcImages(); toast(n ? `사용하지 않는 사진 ${n}장을 정리했습니다` : '정리할 사진이 없습니다'); },
    sellFill: () => {
      const st = sellCtx().tg;
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
      const st = sellCtx().tg;
      document.querySelectorAll('.sellrow').forEach((tr) => {
        tr.querySelector('.sq').value = SM.lotRem(st, st.lots.find((l) => l.id === tr.dataset.lot));
        tr.querySelector('.schk').checked = true;
      });
      sellRefresh();
    },
    calcAdd: () => { ui.calc.buys.push({ qty: '', price: '' }); render(); },
    calcDel: (el) => { ui.calc.buys.splice(+el.dataset.i, 1); if (!ui.calc.buys.length) ui.calc.buys.push({ qty: '', price: '' }); render(); },
    export: async () => {
      const withImages = !document.getElementById('expImg') || document.getElementById('expImg').checked;
      let media = { notes: [], images: [] };
      try { media = await SM.media.exportAll(withImages); } catch (e) { toast('매매 사유를 읽지 못했습니다: ' + e.message, true); }
      state.lastBackupAt = Date.now(); save();
      const data = { app: 'stock-manager', exportedAt: new Date().toISOString(), state, media };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `주식관리백업_${todayStr()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast(`백업했습니다 (매매 사유 ${media.notes.length}개${withImages ? ', 사진 ' + media.images.length + '장' : ''})`);
    },
    wipe: async () => {
      if (!confirm('이 기기의 모든 데이터를 삭제합니다.\n(동기화가 켜져 있으면 다른 기기와 서버의 데이터는 그대로입니다. 하지만 이후 이 기기에서 저장하면 서버도 빈 데이터로 덮어써질 수 있습니다.)\n\n계속할까요?')) return;
      if (!confirm('정말 삭제할까요? 먼저 백업을 내려받았는지 확인하세요.')) return;
      state = SM.newState(); ui.stockId = null; await SM.media.wipeLocal(); save(); render();
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
    target: (el) => { const st = curStock(); st.target = el.value.trim() === '' ? null : num(el.value); save(); render(); },
    watchSort: (el) => { ui.watchSort = el.value; render(); },
    price: (el) => { const st = curStock(); SM.setPrice(st, el.value.trim() === '' ? null : num(el.value)); save(); render(); },
    lotSort: (el) => { ui.lotSort = el.value; render(); },
    journalOnly: (el) => { ui.journalOnly = el.checked; render(); },
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
      rd.onload = async () => {
        try {
          const o = JSON.parse(rd.result);
          const incoming = SM.normalizeState(o.state || o);
          const nn = o.media && o.media.notes ? o.media.notes.length : 0, ni = o.media && o.media.images ? o.media.images.length : 0;
          if (!incoming.stocks.length && !confirm('불러올 종목이 없습니다. 그래도 현재 데이터를 비울까요?')) return;
          if (!confirm(`백업 파일: 종목 ${incoming.stocks.length}개, 매매 사유 ${nn}개, 사진 ${ni}장\n현재 이 기기의 데이터를 이 파일로 교체할까요?`)) return;
          state = incoming; ui.stockId = state.stocks[0] ? state.stocks[0].id : null; ui.selected.clear();
          if (o.media) await SM.media.importAll(o.media);
          save(); render(); toast('복원했습니다');
        } catch (e) { toast('백업 파일을 읽지 못했습니다: ' + e.message, true); }
        el.value = '';
      };
      rd.readAsText(file);
    },
  });

  // 배당 입력 창: 세후 수령액 미리보기
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || !el.dataset || el.dataset.divcalc === undefined) return;
    const m = el.closest('.modal'), prev = m && m.querySelector('#divPrev'), st = curStock();
    if (!prev || !st) return;
    const us = st.market === 'US', g = num(m.querySelector('[name=gross]').value), tv = m.querySelector('[name=tax]').value, fxEl = m.querySelector('[name=fx]');
    if (!(g > 0)) { prev.innerHTML = '<span class="muted">배당금을 입력하면 세후 수령액이 계산됩니다.</span>'; return; }
    const auto = String(tv).trim() === '', tax = auto ? Math.round(g * SM.DIV_TAX[us ? 'US' : 'KR']) / 100 : num(tv);
    if (!(tax >= 0) || tax > g) { prev.innerHTML = '<span class="warn">세금은 0 이상, 배당금 이하여야 합니다.</span>'; return; }
    const fx = us ? (num(fxEl && fxEl.value) > 0 ? num(fxEl.value) : state.settings.fxNow) : 1, cur = SM.curOf(st);
    prev.innerHTML = `세후 수령 <b>${fmtMoney(g - tax, cur)}</b>${us ? ` <small class="muted">(≈ ${fmtMoney((g - tax) * fx, 'KRW')})</small>` : ''}<br><small class="muted">세금 ${fmtMoney(tax, cur)}${auto ? ' (자동 ' + SM.DIV_TAX[us ? 'US' : 'KR'] + '%)' : ''}</small>`;
  });
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d && d.matches && d.matches('details.sec[data-sec]')) ui.sec[d.dataset.sec] = d.open;
  }, true);
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.menu[open]').forEach((d) => { if (!d.contains(e.target) || e.target.closest('.menu-body button')) d.open = false; });
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'A') e.preventDefault();
    const h = H[el.dataset.act];
    if (h) h(el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (A.lotPrev && el.closest && el.closest('#mform')) { lotPrevRefresh(); return; }
    if (el.dataset && el.dataset.change && C[el.dataset.change]) return C[el.dataset.change](el, e);
    if (el.dataset && el.dataset.link) {
      const [i, k] = el.dataset.link.split('.');
      const lk = state.settings.links[+i];
      if (lk) { lk[k] = el.value.trim(); save(); toast('저장했습니다'); }
      return;
    }
    if (el.dataset && el.dataset.setting) {
      const path = el.dataset.setting.split('.'); let o = state.settings;
      for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
      const k = path[path.length - 1];
      if (k === 'collectFrom' || k === 'collectTo') {
        const v = String(el.value || '').trim(), other = k === 'collectFrom' ? o.collectTo : o.collectFrom;
        const bad = v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)));
        const order = v && other && (k === 'collectFrom' ? v > other : other > v);
        if (bad || order) { toast(bad ? '날짜 형식이 올바르지 않습니다' : '시작일이 종료일보다 늦을 수 없습니다', true); render(); return; }
        o[k] = v; save(); render(); return;
      }
      o[k] = ['upColor', 'linkMode'].includes(k) ? el.value : k === 'collectYears' ? Math.min(15, Math.max(1, Math.round(num(el.value, o[k])))) : num(el.value, o[k]);
      save();
      if (k === 'upColor' || k === 'collectYears') render(); else toast('저장했습니다');
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
    if (A.lotPrev && el.closest && el.closest('#mform')) { lotPrevRefresh(); return; }
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
      document.querySelectorAll('.syncbox').forEach((b) => { b.innerHTML = syncBadge(); });
      const c = document.getElementById('syncCard');
      if (c && !document.activeElement.closest('#syncCard')) c.innerHTML = syncCard();
      else if (c && SM.sync.S.status !== 'connecting') c.innerHTML = syncCard();
    },
  };
  Object.assign(A, { qn, fd, abtn, section, lotForm, openSell, noteLine, ymdLocal });
  A.boot = function () {
    load();
    render();
    SM.sync.init(syncHooks);
    if (SM.update) SM.update.boot();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
