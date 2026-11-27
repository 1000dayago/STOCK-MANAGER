/* ui-watch.js - 관심 종목 목록 · 가상 매매 · 분할 매수 계획 · 가상 매매 현황 */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app;
  const { esc, money, pct, opts, toast } = A;
  const { fmtNum, fmtMoney, fmtPct, num, todayStr } = SM;
  const ic = SM.ic;
  const ui = A.ui;
  const S = () => A.getState();
  const curStock = () => A.curStock();

  /* ---------- 공통 조각 ---------- */
  function gapChip(st) {
    const g = SM.watchGap(st);
    if (!g) return '<span class="muted">목표가 없음</span>';
    if (g.gap == null) return '<span class="muted">현재가 입력</span>';
    if (g.reached) return `<span class="chip hit">목표가 도달 · ${(Math.abs(g.gap) * 100).toFixed(1)}% 낮음</span>`;
    return `<span class="chip neu">목표까지 ${fmtPct(g.target / g.price - 1)}</span>`;
  }
  const paperChip = (st) => {
    const p = SM.paperStats(st, S().settings);
    if (p.empty) return '<span class="muted">가상 기록 없음</span>';
    return `${money(p.total, SM.curOf(st))} ${p.ret != null ? pct(p.ret) : ''}`;
  };
  const gapKey = (st) => {
    const g = SM.watchGap(st);
    if (!g) return 3e9;
    if (g.gap == null) return 2e9;
    return g.gap; // 목표가 이하(음수)가 맨 앞, 그다음 목표가에 가까운 순
  };

  /* ---------- 관심 종목 목록 (종목 화면 '관심' 탭) ---------- */
  A.watchList = (G) => {
    const sorters = { gap: (a, b) => gapKey(a) - gapKey(b), new: (a, b) => (b.watchAt || 0) - (a.watchAt || 0), name: (a, b) => a.name.localeCompare(b.name, 'ko') };
    const rows = G.slice().sort(sorters[ui.watchSort] || sorters.gap);
    return `<section class="card wl"><div class="sec-h"><h2>관심 종목 <span class="count">${G.length}</span></h2><div class="sec-tools">
      <select class="inp sm" data-change="watchSort" aria-label="정렬">${opts([['gap', '목표가에 가까운 순'], ['new', '최근 추가순'], ['name', '이름순']], ui.watchSort)}</select>
      <button class="btn primary sm" data-act="addStock">${ic('plus')}관심 종목</button></div></div>
      ${rows.length ? `<div class="wlist" role="list">${rows.map((st) => {
        const cur = SM.curOf(st), age = SM.priceAge(st), g = SM.watchGap(st);
        return `<div class="wrow ${st.id === ui.stockId ? 'on' : ''}" role="listitem" data-act="goWatch" data-id="${st.id}" tabindex="0">
          <span class="wn"><b>${esc(st.name)}</b> <small class="muted">${esc(st.code)}${st.market === 'US' ? ' · US' : ''}</small></span>
          <span class="wg">${gapChip(st)}</span>
          <span class="wp">${st.price ? `<b>${fmtNum(st.price, cur === 'USD' ? 2 : 0)}</b> <small class="${age > 3 ? 'stale' : 'muted'}">${age > 365 ? '' : age === 0 ? '오늘' : age + '일 전'}</small>` : '<span class="muted">현재가 -</span>'}${g ? `<span class="wtm"> · 목표 ${fmtNum(g.target, cur === 'USD' ? 2 : 0)}</span>` : ''}</span>
          <span class="wt">${g ? `<span class="muted">목표</span> ${fmtNum(g.target, cur === 'USD' ? 2 : 0)}` : ''}</span>
          <span class="wv">${paperChip(st)}</span></div>`;
      }).join('')}</div>` : `<div class="empty-note"><p>아직 관심 종목이 없습니다. 사고 싶은 종목을 등록하고 목표 매수가와 메모를 남겨 보세요. 가상 매수·매도로 결과도 시험할 수 있습니다.</p><button class="btn primary sm" data-act="addStock">${ic('plus')}첫 관심 종목 추가</button></div>`}</section>`;
  };

  // 관심 종목 상세의 요약 카드
  A.watchCards = (st) => {
    const cur = SM.curOf(st), us = st.market === 'US';
    const stats = SM.paperStats(st, S().settings), plan = SM.planPreview(st, S().settings);
    return `<div class="cards">
      <div class="stat"><span>목표 매수가</span><b><input class="inp tgt" data-change="target" value="${st.target || ''}" inputmode="decimal" placeholder="입력"></b><small>${gapChip(st)}</small></div>
      <div class="stat wide2"><span>가상 손익</span><b>${stats.empty ? '<span class="muted">가상 기록 없음</span>' : money(stats.total, cur) + ' <small>' + (stats.ret != null ? pct(stats.ret) : '') + '</small>'}</b><small>${stats.empty ? '아래 “가상 매매”에서 가상 매수를 입력해 보세요' : `실현 ${fmtMoney(stats.realized, cur)} · 평가 ${stats.priced ? fmtMoney(stats.unrealized, cur) : '현재가 입력 필요'}`}</small></div>
      <div class="stat"><span>분할 계획 평단</span><b>${plan.steps.length ? fmtMoney(plan.final.avg, cur) : '<span class="muted">-</span>'}</b><small>${plan.steps.length ? `${plan.steps.length}단계 · ${fmtNum(plan.final.qty)}주` : '계획 없음'}</small></div>
    </div>`;
  };

  // 홈의 관심 종목 카드
  A.homeWatchCard = () => {
    const W = S().stocks.filter((x) => x.watch);
    if (!W.length) return '';
    const rows = W.slice().sort((a, b) => gapKey(a) - gapKey(b)).slice(0, 5);
    return `<section class="card"><div class="row between wrap"><h2>관심 종목 <small class="muted">목표가에 가까운 순</small></h2><button class="btn sm" data-act="goWatchTab">${ic('chevR')}전체 보기</button></div>
      <div class="wlist" role="list">${rows.map((st) => { const cur = SM.curOf(st); return `<div class="wrow" role="listitem" data-act="goWatch" data-id="${st.id}" tabindex="0"><span class="wn"><b>${esc(st.name)}</b> <small class="muted">${esc(st.code)}</small></span><span class="wg">${gapChip(st)}</span><span class="wp">${st.price ? `<b>${fmtNum(st.price, cur === 'USD' ? 2 : 0)}</b>` : '<span class="muted">-</span>'}</span><span class="wt">${st.target ? `<span class="muted">목표</span> ${fmtNum(st.target, cur === 'USD' ? 2 : 0)}` : ''}</span><span class="wv">${paperChip(st)}</span></div>`; }).join('')}</div></section>`;
  };

  /* ---------- 가상 매매 ---------- */
  const tagOf = (rec) => (rec.pre ? '<span class="tag pre" title="입력한 날 또는 그 이후 날짜의 매매">사전</span>' : '<span class="tag post" title="과거 날짜로 입력한 매매(결과를 아는 상태)">사후</span>');
  function paperRow(st, l, cur, us, ps) {
    const pv = SM.paperStock(st);
    const v = SM.lotView(pv, l, ps);
    const done = v.rem <= 0, open = ui.openLots.has(l.id), sold = SM.lotSold(pv, l.id) > 0;
    const retV = us ? v.retKRW : v.ret;
    const chip = done ? '<span class="chip off">완료</span>' : retV != null ? `<span class="chip ${retV >= 0 ? 'up' : 'down'}">${fmtPct(retV)}</span>` : '<span class="muted">-</span>';
    const pnl = done || v.unrl == null ? '<span class="muted">-</span>' : money(us ? v.unrlKRW : v.unrl, 'KRW');
    const acts = [
      A.abtn('paperEdit', 'edit', '수정', '', `data-id="${l.id}"`),
      A.abtn('paperToReal', 'plus', '실제 매수로 전환', '', `data-id="${l.id}"`),
      !sold ? A.abtn('paperDel', 'trash', '삭제', 'danger', `data-id="${l.id}"`) : '',
    ].join('');
    return `<div class="lrow paper ${done ? 'done' : ''} ${open ? 'open' : ''}" role="listitem" data-act="lotToggle" data-id="${l.id}">
      <label class="lchk">${done ? '' : `<input type="checkbox" data-change="paperSelLot" data-id="${l.id}" ${ui.paperSel.has(l.id) ? 'checked' : ''} aria-label="${l.no}번 선택">`}</label>
      <b class="lno">${l.no}번 ${tagOf(l)}${l.realLot ? ' <span class="tag real">실매수</span>' : ''}</b>
      <span class="ldate">${A.fd(l.date)}</span>
      <span class="lqty">${done ? '<span class="muted">매도완료</span>' : `<b>${A.qn(v.rem)}주</b>${v.rem !== l.qty ? `<small class="muted">/${A.qn(l.qty)}</small>` : ''}`} <span class="muted">@${fmtNum(l.price, us ? 2 : 0)}</span></span>
      <span class="lret">${chip}</span><span class="lpnl">${pnl}</span>
      <span class="acts">${acts}</span>
      <div class="ldet">${l.pre ? '사전 기록' : '사후 입력'} · 입력 ${esc(A.ymdLocal(l.at || Date.now()))} · 수수료 ${fmtMoney(l.fee, cur)}${l.note ? ' · ' + esc(l.note) : ''}</div></div>`;
  }
  A.paperBody = (st) => {
    const cur = SM.curOf(st), us = st.market === 'US';
    const ps = SM.paperSettings(S().settings, st.paper.fee);
    const stats = SM.paperStats(st, S().settings);
    const lots = st.paper.lots.slice().sort((a, b) => a.no - b.no);
    const selN = lots.filter((l) => ui.paperSel.has(l.id) && SM.lotRem(SM.paperStock(st), l) > 0).length;
    let h = `<p class="hint">실제 계좌와 무관하게 사고파는 것을 가정해 결과를 확인하는 곳입니다. 보유 합계·손익 화면에는 반영되지 않습니다.</p>`;
    if (!stats.empty) {
      h += `<div class="cards paper-cards"><div class="stat wide2"><span>가상 손익 합계</span><b>${money(stats.total, cur)} <small>${stats.ret != null ? pct(stats.ret) : ''}</small></b><small>실현 ${fmtMoney(stats.realized, cur)} · 평가 ${stats.priced ? fmtMoney(stats.unrealized, cur) : '현재가 입력 필요'}${us ? ` · 원화 환산 ${fmtMoney(stats.totalKRW, 'KRW')}` : ''}</small></div>
        <div class="stat"><span>가상 최대 투입</span><b>${fmtMoney(stats.peak, cur)}</b></div>
        <div class="stat"><span>청산 승률</span><b>${stats.winRate != null ? (stats.winRate * 100).toFixed(0) + '%' : '-'}</b><small>청산 ${stats.closed}건</small></div></div>
        <p class="hint">기록 구분: <span class="tag pre">사전</span> ${stats.pre.lots + stats.pre.sales}건 · <span class="tag post">사후</span> ${stats.post.lots + stats.post.sales}건${stats.post.sales ? ` (사후 입력 실현손익 ${fmtMoney(stats.post.realized, cur)})` : ''} — <b>사전 기록</b>은 입력한 날 또는 그 이후 날짜의 매매, <b>사후 입력</b>은 과거 날짜로 넣은 매매(결과를 아는 상태)입니다. 판단을 검증하려면 사전 기록만 의미가 큽니다.</p>`;
    }
    h += `<div class="toolbar"><button class="btn primary sm" data-act="paperBuy">${ic('plus')}가상 매수</button><button class="btn sm accent" data-act="paperSell" ${stats.qty > 0 ? '' : 'disabled'}>가상 매도</button><button class="btn sm" data-act="paperCompare" data-id="${st.id}">${ic('lab')}백테스트와 비교</button><span class="grow"></span>
      <label class="chk inl"><input type="checkbox" data-change="paperFee" ${st.paper.fee !== false ? 'checked' : ''}> 수수료·세금 반영</label></div>`;
    h += `<div class="lots" role="list"><div class="lhead"><span></span><span>순번</span><span>매수일</span><span>수량 · 단가</span><span>수익률</span><span>평가손익</span><span></span></div>${lots.length ? lots.map((l) => paperRow(st, l, cur, us, ps)).join('') : '<div class="lempty">가상 매수 기록이 없습니다. “가상 매수”로 시작하세요.</div>'}</div>`;
    if (st.paper.sales.length) {
      h += `<h4>가상 매도 기록</h4><div class="slist">${st.paper.sales.slice().reverse().map((x) => {
        const cost = x.lines.reduce((a, l) => a + l.costLocal, 0), r = cost > 0 ? x.pnlLocal / cost : null;
        return `<div class="srow"><span class="sd">${A.fd(x.date)}</span><span class="sq"><b>${A.qn(x.qty)}주</b> <span class="muted">@${fmtNum(x.price, us ? 2 : 0)}</span> ${tagOf(x)}</span><span class="sl muted">${x.lines.map((l) => `${l.lotNo}번×${A.qn(l.qty)}`).join(', ')}</span><span class="sr"><span class="chip ${r >= 0 ? 'up' : 'down'}">${fmtPct(r)}</span> ${money(x.pnlLocal, cur)}</span><span class="acts inline">${A.abtn('paperSaleDel', 'trash', '삭제', 'danger', `data-id="${x.id}"`)}</span></div>`;
      }).join('')}</div>`;
    }
    h += `<p class="hint">가상 결과는 슬리피지(원하는 가격에 못 사는 경우), 체결 지연, 실제 손실을 볼 때의 심리를 반영하지 못합니다.${lots.length || st.paper.sales.length ? ' 수수료·세금 설정은 이후 입력부터 적용되고 이미 입력한 기록은 바뀌지 않습니다.' : ''}</p>`;
    if (lots.length || st.paper.sales.length) h += `<div class="btns"><button class="btn sm ghost danger" data-act="paperReset">${ic('trash')}가상 기록 모두 지우기</button></div>`;
    return h;
  };

  /* ---------- 분할 매수 계획 ---------- */
  A.planBody = (st) => {
    const cur = SM.curOf(st), us = st.market === 'US';
    const pv = SM.planPreview(st, S().settings);
    const done = (st.plan || []).filter((p) => p.done);
    let h = `<p class="hint">가격별로 나눠 살 계획을 적어 두면 단계마다 누적 평단과 필요한 금액을 보여줍니다. 실제 보유 순번이 있으면 함께 계산합니다.</p>`;
    if (pv.steps.length) {
      h += `<div class="tablewrap"><table class="plantbl"><thead><tr><th>단계</th><th>가격</th><th>수량</th><th>금액(수수료 포함)</th><th>누적 수량</th><th>누적 평단</th><th></th></tr></thead><tbody>${pv.steps.map((x, i) => `<tr><td>${i + 1}</td><td>${fmtNum(x.price, us ? 2 : 0)}</td><td>${A.qn(x.qty)}주</td><td>${fmtMoney(x.total, cur)}</td><td>${A.qn(x.cumQty)}주</td><td><b>${fmtMoney(x.cumAvg, cur)}</b></td><td class="acts">${x.paperLot ? '<span class="tag paper">가상 반영됨</span> ' : A.abtn('planPaper', 'lab', '가상 매수로', '', `data-id="${x.id}"`)}${A.abtn('planReal', 'plus', '실제 매수', '', `data-id="${x.id}"`)}${A.abtn('planDel', 'trash', '삭제', 'danger', `data-id="${x.id}"`)}</td></tr>${x.note ? `<tr class="pn"><td></td><td colspan="6" class="muted">${esc(x.note)}</td></tr>` : ''}`).join('')}</tbody></table></div>
        <div class="cards plan-cards"><div class="stat"><span>계획 완료 시 평단</span><b>${fmtMoney(pv.final.avg, cur)}</b><small>${pv.base.avg ? `현재 ${fmtMoney(pv.base.avg, cur)} → ${fmtPct(pv.avgChange)}` : `${A.qn(pv.final.qty)}주`}</small></div>
          <div class="stat"><span>필요 금액</span><b>${fmtMoney(pv.planned, cur)}</b><small>${A.qn(pv.plannedQty)}주 추가</small></div>
          <div class="stat"><span>손익분기 매도가</span><b>${fmtMoney(pv.breakEven, cur)}</b><small>${pv.riseNeeded == null ? '' : pv.riseNeeded > 0 ? `현재가에서 ${fmtPct(pv.riseNeeded)} 필요` : `현재가보다 ${(Math.abs(pv.riseNeeded) * 100).toFixed(1)}% 낮음`}</small></div></div>`;
    } else h += '<p class="muted">남은 계획이 없습니다. 아래에서 단계를 추가하세요.</p>';
    h += `<div class="evform planform"><input id="planPrice" class="inp" inputmode="decimal" placeholder="가격"><input id="planQty" class="inp" inputmode="decimal" placeholder="수량(주)"><input id="planNote" class="inp" placeholder="메모(선택)"><button class="btn primary sm" data-act="planAdd">${ic('plus')}단계 추가</button></div>`;
    if (done.length) h += `<p class="hint">실행 완료한 단계 ${done.length}개: ${done.map((p) => `${fmtNum(p.price, us ? 2 : 0)}×${A.qn(p.qty)}`).join(', ')}</p>`;
    return h;
  };

  /* ---------- 가상 매매 현황 (시뮬레이션 탭) ---------- */
  A.paperOverview = () => {
    const stocks = S().stocks.filter((s) => s.paper && (s.paper.lots.length || s.paper.sales.length));
    if (!stocks.length) return `<section class="card empty"><h2>가상 매매 기록이 없습니다</h2><p>관심 종목이나 보유 종목 화면의 <b>가상 매매</b>에서 가상 매수·매도를 입력하면 이곳에 종목별 결과가 모입니다.</p><button class="btn primary" data-act="goWatchTab">${ic('stocks')}관심 종목으로 가기</button></section>`;
    const rows = stocks.map((st) => ({ st, p: SM.paperStats(st, S().settings) }));
    const tot = rows.reduce((a, r) => { a.krw += r.p.totalKRW; a.closed += r.p.closed; a.wins += r.p.wins; a.pre += r.p.pre.lots + r.p.pre.sales; a.post += r.p.post.lots + r.p.post.sales; return a; }, { krw: 0, closed: 0, wins: 0, pre: 0, post: 0 });
    return `<section class="card"><h2>가상 매매 현황 <small class="muted">종목별 결과 (실제 매매와 분리)</small></h2>
      <div class="cards"><div class="stat wide2"><span>가상 손익 합계 (원화 환산)</span><b>${money(tot.krw, 'KRW')}</b><small>현재가가 입력된 종목만 평가에 반영</small></div><div class="stat"><span>청산 승률</span><b>${tot.closed ? ((tot.wins / tot.closed) * 100).toFixed(0) + '%' : '-'}</b><small>${tot.closed}건</small></div><div class="stat"><span>사전 / 사후</span><b>${tot.pre} / ${tot.post}</b><small>건</small></div></div>
      <div class="tablewrap"><table><thead><tr><th>종목</th><th>구분</th><th>가상 손익</th><th>수익률(최대 투입 대비)</th><th>실현</th><th>평가</th><th>승률</th><th>사전/사후</th><th></th></tr></thead><tbody>${rows.map(({ st, p }) => { const cur = SM.curOf(st); return `<tr><td data-label="종목"><span class="v"><a href="#" data-act="goStock" data-id="${st.id}">${esc(st.name)}</a> <small class="muted">${esc(st.code)}</small></span></td><td data-label="구분"><span class="v">${st.watch ? '관심' : '보유'}</span></td><td data-label="가상 손익"><span class="v">${money(p.total, cur)}</span></td><td data-label="수익률"><span class="v">${p.ret != null ? pct(p.ret) : '-'}</span></td><td data-label="실현"><span class="v">${fmtMoney(p.realized, cur)}</span></td><td data-label="평가"><span class="v">${p.priced ? fmtMoney(p.unrealized, cur) : '<span class="muted">현재가 입력</span>'}</span></td><td data-label="승률"><span class="v">${p.winRate != null ? (p.winRate * 100).toFixed(0) + '%' : '-'}</span></td><td data-label="사전/사후"><span class="v">${p.pre.lots + p.pre.sales} / ${p.post.lots + p.post.sales}</span></td><td class="acts"><button class="btn sm" data-act="paperCompare" data-id="${st.id}">${ic('lab')}백테스트와 비교</button></td></tr>`; }).join('')}</tbody></table></div>
      <p class="hint">종목마다 현재가는 직접 입력한 값 기준입니다. <b>사후 입력</b>이 많으면 결과를 알고 넣은 매매라서 판단의 증거로 쓰기 어렵습니다.</p></section>`;
  };

  /* ---------- 핸들러 ---------- */
  const H = A.handlers, C = A.changeHandlers;
  Object.assign(H, {
    goWatch: (el, e) => { if (e && e.target.closest('input,select,button')) return; ui.stockTab = 'watch'; ui.stockId = el.dataset.id; ui.view = 'stocks'; A.render(); window.scrollTo(0, 0); },
    goWatchTab: () => { ui.stockTab = 'watch'; ui.view = 'stocks'; const f = S().stocks.find((x) => x.watch); ui.stockId = f ? f.id : null; A.render(); window.scrollTo(0, 0); },
    paperBuy: () => A.lotForm(curStock(), null, { paper: true }),
    paperEdit: (el) => { const st = curStock(); A.lotForm(st, st.paper.lots.find((l) => l.id === el.dataset.id), { paper: true }); },
    paperDel: (el) => {
      const st = curStock(), l = st.paper.lots.find((x) => x.id === el.dataset.id);
      if (!confirm(`가상 ${l.no}번을 삭제할까요?`)) return;
      try { SM.deleteLot(SM.paperStock(st), l.id); } catch (e) { return toast(e.message, true); }
      (st.plan || []).forEach((p) => { if (p.paperLot === l.id) p.paperLot = null; });
      ui.paperSel.delete(l.id); A.save(); A.render();
    },
    paperSell: () => A.openSell(curStock(), { paper: true }),
    paperSaleDel: (el) => {
      const st = curStock(), x = st.paper.sales.find((q) => q.id === el.dataset.id);
      if (!confirm(`${x.date} 가상 매도(${x.qty}주)를 삭제할까요? 해당 순번의 잔여 수량이 되돌아옵니다.`)) return;
      st.paper.sales = st.paper.sales.filter((q) => q.id !== x.id); A.save(); A.render();
    },
    paperToReal: (el) => {
      const st = curStock(), l = st.paper.lots.find((x) => x.id === el.dataset.id);
      A.lotForm(st, null, { prefill: { date: todayStr(), price: l.price, qty: l.qty }, fromPaper: l.id });
    },
    paperReset: () => {
      const st = curStock();
      if (!confirm(`“${st.name}”의 가상 매수·매도 기록을 모두 지울까요? (계획은 유지됩니다)`)) return;
      st.paper.lots = []; st.paper.sales = []; st.paper.nextNo = 1; (st.plan || []).forEach((p) => { p.paperLot = null; }); ui.paperSel.clear(); A.save(); A.render();
    },
    paperClose: async () => {
      const ctx = A.lotPrev, form = document.getElementById('mform');
      if (!ctx || !form) return;
      const st = S().stocks.find((x) => x.id === ctx.stockId), msg = document.getElementById('closeMsg');
      msg.textContent = '찾는 중…';
      const r = A.closeOn ? await A.closeOn(st, form.elements.date.value) : null;
      if (!r) { msg.textContent = '해당 날짜의 종가를 찾지 못했습니다. 시뮬레이션 화면에서 이 종목의 가격 데이터를 불러와 연결하거나, 자동 수집 시세를 쓰세요.'; return; }
      const px = st.market === 'US' ? Math.round(r.price * 100) / 100 : Math.round(r.price);
      form.elements.price.value = px;
      msg.textContent = `${r.date} 종가 ${fmtNum(px, st.market === 'US' ? 2 : 0)}를 채웠습니다 (${r.src})${r.exact ? '' : ' · 휴장일이라 직전 거래일 종가'}. 종가 체결을 가정한 값입니다.`;
      A.lotPrevRefresh();
    },
    planAdd: () => {
      const st = curStock();
      try { SM.addPlan(st, { price: document.getElementById('planPrice').value, qty: document.getElementById('planQty').value, note: document.getElementById('planNote').value }); } catch (e) { return toast(e.message, true); }
      A.save(); A.render();
    },
    planDel: (el) => { SM.removePlan(curStock(), el.dataset.id); A.save(); A.render(); },
    planPaper: (el) => { const st = curStock(), p = st.plan.find((x) => x.id === el.dataset.id); A.lotForm(st, null, { paper: true, prefill: { price: p.price, qty: p.qty }, planId: p.id }); },
    planReal: (el) => { const st = curStock(), p = st.plan.find((x) => x.id === el.dataset.id); A.lotForm(st, null, { prefill: { price: p.price, qty: p.qty }, planId: p.id }); },
  });
  Object.assign(C, {
    paperFee: (el) => { const st = curStock(); st.paper.fee = el.checked; A.save(); A.render(); },
    paperSelLot: (el) => { if (el.checked) ui.paperSel.add(el.dataset.id); else ui.paperSel.delete(el.dataset.id); A.render(); },
  });
  // Enter 키로 목록 행 열기
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('wrow')) e.target.click(); });
})(typeof globalThis !== 'undefined' ? globalThis : this);
