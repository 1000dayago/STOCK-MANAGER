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
  const newImp = () => ({ autoNote: '', text: '', headerLine: '', an: null, fileNames: [], dest: 'new', destId: '', name: '', market: 'KR', useAdj: true });
  const bt = (A.ui.bt = { datasetId: null, cfg: SM.blankCfg(), result: null, val: null, cmp: null, warn: [], validate: false, splitPct: 70, strategyId: '', imp: newImp() });
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
    bt.warn = [];
    A.render();
    toast(kind === 'unknown' ? '열을 자동으로 찾지 못했습니다. 열을 직접 지정하세요.' : '읽었습니다. 아래 내용을 확인하고 저장하세요.', kind === 'unknown');
  }
  const strategies = () => A.getState().strategies;

  function curDS() { const ds = loadDS(); if (!bt.datasetId || !ds[bt.datasetId]) bt.datasetId = Object.keys(ds)[0] || null; return bt.datasetId ? ds[bt.datasetId] : null; }
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

  function flowStatus(ds) {
    if (!ds) return '';
    const d = ds.data, f = (k) => (d[k] ? `<span class="okm">${ic('check')}</span>` : `<span class="nom">${ic('xmark')}</span>`);
    const n = d.frgn ? d.frgn.filter((v) => v != null).length : d.inst ? d.inst.filter((v) => v != null).length : 0;
    return `수급 데이터: 외국인 ${f('frgn')} · 기관 ${f('inst')} · 개인 ${f('indiv')}${n ? ` (${n}일 매칭)` : ''}`;
  }

  A.renderers.backtest = function () {
    const ds = loadDS(), keys = Object.keys(ds), cur = curDS(), c = bt.cfg;
    const rangeTxt = cur ? `${cur.data.d[0]} ~ ${cur.data.d[cur.data.d.length - 1]} (${cur.data.d.length}일)` : '';
    const st = strategies();
    const imp = bt.imp;
    return `<section class="card"><h2>1. 데이터 불러오기 <small class="muted">(가격 · 수급)</small></h2>
      <p class="hint">증권사·거래소·포털에서 받은 <b>일봉 파일(CSV)</b>이나 화면의 <b>표를 복사해서 붙여 넣은 것</b>을 읽습니다. 제목 줄 위치와 열 이름(한글·영문)을 자동으로 찾고, 틀리면 아래에서 열을 직접 고를 수 있습니다. 가격·수급이 한 파일에 같이 있어도, 수급만 따로 있어도 됩니다. 엑셀 파일(.xlsx)은 CSV로 저장하거나 표를 복사해서 붙여 넣으세요. 데이터는 용량 때문에 이 기기에만 저장됩니다.</p>
      <div class="row gap wrap"><label class="btn file">파일 선택 (여러 개 가능)<input type="file" multiple accept=".csv,.txt,.tsv,text/csv,text/plain" data-change="btFiles" hidden></label>
        <label class="mini">제목 줄 번호<input class="inp" data-btimp="headerLine" value="${esc(imp.headerLine)}" inputmode="numeric" placeholder="자동" style="width:90px"></label></div>
      <label>또는 여기에 붙여 넣기<textarea data-btimp="text" rows="4" placeholder="날짜,시가,고가,저가,종가,거래량&#10;2025-01-02,...">${esc(imp.text)}</textarea></label>
      <div class="btns"><button class="btn primary" data-act="btAnalyze">읽기</button>${imp.an ? '<button class="btn" data-act="btImpCancel">취소</button>' : ''}</div>
      ${imp.an ? impPanel() : ''}
      <div id="dsWarn">${bt.warn.map((w) => `<p class="hint warn">${ic('alert')} ${esc(w)}</p>`).join('')}</div>
      ${keys.length ? `<h4>저장된 데이터</h4><div class="row gap wrap"><select class="inp" data-change="btDS" style="max-width:260px">${opts(keys.map((k) => [k, ds[k].name]), bt.datasetId)}</select><span class="muted">${rangeTxt}</span><button class="btn sm danger" data-act="btDSDel">삭제</button></div><p class="hint">${flowStatus(cur)}</p>` : '<p class="muted">저장된 데이터가 없습니다.</p>'}
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
    if (kind === 'price' || kind === 'both') return { kind, build: SM.buildDataset(an.table, an.cols, { useAdj: imp.useAdj }) };
    if (kind === 'flow') {
      const dsAll = loadDS(), tgt = dsAll[imp.destId];
      if (!tgt) return { kind, note: '수급은 기존 가격 데이터에 합칩니다. 먼저 가격 데이터를 저장하거나 아래에서 합칠 데이터를 고르세요.' };
      const m = SM.mergeFlow(tgt.data, an.table, an.cols);
      return { kind, flow: m, tgt };
    }
    return { kind };
  }
  function impPanel() {
    const imp = bt.imp, an = imp.an, hdr = an.table.header, ds = loadDS(), keys = Object.keys(ds);
    const pv = impPreview(imp), kind = pv.kind;
    const sel = (k, label) => `<label class="mini">${label}<select class="inp" data-change="btImpCol" data-k="${k}"><option value="-1">(없음)</option>${hdr.map((h, i) => `<option value="${i}" ${an.cols[k] === i ? 'selected' : ''}>${i + 1}. ${esc(h || '(빈 칸)')}</option>`).join('')}</select></label>`;
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
    const mergeSel = keys.length ? `<select class="inp" data-change="btImpDest" data-k="destId" style="max-width:260px">${opts(keys.map((k) => [k, ds[k].name]), imp.destId)}</select>` : '<span class="muted">(저장된 데이터 없음)</span>';
    return `<div class="box"><b>읽은 결과: ${KIND_TXT[kind]}</b> <small class="muted">· ${an.table.rows.length}행${imp.fileNames.length > 1 ? ` · 파일 ${imp.fileNames.length}개` : ''}${an.fromSaved ? ' · 이전에 지정한 열 설정을 불러왔습니다' : ''}</small>
      <div class="colgrid">${COL_LABELS.map(([k, l]) => sel(k, l)).join('')}</div>
      ${an.cols.adj >= 0 ? `<label class="chk"><input type="checkbox" data-change="btImpAdj" ${imp.useAdj ? 'checked' : ''}> 수정종가 기준으로 시/고/저/종가 보정</label>` : ''}
      ${summary}
      ${kind !== 'unknown' ? `<h4>저장 위치</h4>
        ${imp.autoNote ? `<p class="hint">${ic('bulb')} ${esc(imp.autoNote)}</p>` : '<p class="hint">같은 종목의 다른 기간 데이터라면 “기존 데이터에 이어붙이기”를 선택하세요.</p>'}
        ${canNew ? `<label class="chk"><input type="radio" name="impDest" value="new" data-change="btImpDest" data-k="dest" ${dest === 'new' ? 'checked' : ''}> 새 데이터로 저장</label>
        ${dest === 'new' ? `<div class="grid2"><label>데이터 이름<input class="inp" data-btimp="name" value="${esc(imp.name)}" placeholder="예: 한국전력"></label><label>시장 (수수료율 기준)<select class="inp" data-change="btImpDest" data-k="market">${opts([['KR', '국내'], ['US', '해외']], imp.market)}</select></label></div>` : ''}` : ''}
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
    const data = (loadDS()[bt.datasetId] || {}).data;
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
    const stored = loadDS()[bt.datasetId];
    if (!stored) return;
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
    btDSDel: () => { if (!confirm('이 가격 데이터를 삭제할까요?')) return; const ds = loadDS(); delete ds[bt.datasetId]; saveDS(ds); bt.datasetId = null; bt.result = null; bt.val = null; bt.cmp = null; A.render(); },
    btDel: (el) => { bt.cfg[el.dataset.g].conds.splice(+el.dataset.i, 1); A.render(); },
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
        const m = SM.mergeFlow(tgt.data, an.table, an.cols);
        if (m.error) return toast(m.error, true);
        ['frgn', 'inst', 'indiv'].forEach((k) => {
          if (!m.arrs[k]) return;
          tgt.data[k] = tgt.data[k] ? tgt.data[k].map((v, i) => (m.arrs[k][i] != null ? m.arrs[k][i] : v)) : m.arrs[k]; // 기존 수급은 유지하고 새 값만 덮어씀
        });
        msgs.push(`수급 데이터를 합쳤습니다: ${m.matched}일 매칭` + (m.unmatched ? `, 가격 데이터에 없는 날짜 ${m.unmatched}일은 제외` : '') + (m.missing ? `, 수급이 비는 거래일 ${m.missing}일(해당 날은 수급 조건이 거짓으로 처리됩니다)` : '') + '.');
        targetId = imp.destId;
      } else if (kind === 'price' || kind === 'both') {
        const r = SM.buildDataset(an.table, an.cols, { useAdj: imp.useAdj });
        if (r.error) return toast(r.error, true);
        if (imp.dest === 'merge' && imp.destId && ds[imp.destId]) {
          const tgt = ds[imp.destId];
          const mg = SM.mergeDatasets(tgt.data, r.data);
          tgt.data = mg.data;
          msgs.push(`“${tgt.name}”에 합쳤습니다: 새 날짜 ${mg.added}일 추가, 겹치는 ${mg.overlap}일은 새 값으로 덮어썼습니다. (전체 ${mg.data.d.length}일, ${mg.data.d[0]} ~ ${mg.data.d[mg.data.d.length - 1]})`);
          if (mg.keptOHLC) msgs.push('이 표에는 시가·고가·저가(또는 일부)가 없어, 겹치는 날짜의 기존 시가·고가·저가는 그대로 두고 종가·거래량·수급만 갱신했습니다.');
          if (mg.mismatch) msgs.push(`겹치는 날짜 중 ${mg.mismatch}일은 종가가 1% 넘게 달랐습니다. 한쪽이 수정주가가 아니거나 액면분할이 반영 안 됐을 수 있으니 확인하세요.`);
          targetId = imp.destId;
        } else {
          const id = SM.uid();
          const name = (imp.name || '').trim() || '데이터 ' + new Date().toLocaleDateString('ko-KR');
          ds[id] = { name, market: imp.market, added: Date.now(), data: r.data };
          bt.cfg.market = imp.market; targetId = id;
          msgs.push(`${name}: ${r.count}일치 (${r.data.d[0]} ~ ${r.data.d[r.data.d.length - 1]}) 저장했습니다.`);
        }
        msgs.push(...r.warnings);
      } else return toast('날짜와 종가(또는 수급) 열을 지정하세요', true);
      if (!saveDS(ds)) return;
      rememberCols(an);
      bt.datasetId = targetId; bt.result = null; bt.val = null; bt.cmp = null;
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
    btImpCol: (el) => { bt.imp.an.cols[el.dataset.k] = +el.value; bt.imp.an.fromSaved = false; A.render(); },
    btImpAdj: (el) => { bt.imp.useAdj = el.checked; A.render(); },
    btImpDest: (el) => { bt.imp[el.dataset.k] = el.type === 'radio' ? el.value : el.value; A.render(); },
    btDS: (el) => { bt.datasetId = el.value; bt.result = null; bt.val = null; bt.cmp = null; bt.cfg.from = ''; bt.cfg.to = ''; A.render(); },
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
