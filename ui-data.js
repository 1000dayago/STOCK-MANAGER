/* ui-data.js - 자동 수집 자료(공시·뉴스·재무·시세) 화면과 설정 안내 */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app, D = SM.data;
  const { esc } = A;
  const ic = SM.ic;
  const ui = A.ui;
  ui.autoTab = 'dart';

  const when = (iso) => { const d = new Date(iso); return Number.isFinite(+d) ? d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
  const eok = (v) => (v == null ? '-' : SM.fmtNum(Math.round(v / 1e8)));
  const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const KIND = { dart: '공시', news: '뉴스', fin: '재무', prices: '시세', flow: '수급' };

  /* ---------- 종목 화면: 공시·뉴스·재무 ---------- */
  A.autoBody = (st) => `<div id="autoBody" data-code="${esc(st.code || '')}"><p class="muted">불러오는 중…</p></div>`;

  function statusLine(sst) {
    return `<div class="autostat">${Object.keys(KIND).map((k) => {
      const s = sst && sst[k];
      if (!s) return '';
      if (s.ok) return `<span class="as ok">${ic('check')}${KIND[k]} <small>${esc(when(s.at))}</small></span>`;
      if (s.skipped) return `<span class="as skip">${KIND[k]} <small>${esc(s.skipped)}</small></span>`;
      return `<span class="as bad" title="${esc(s.error || '')}">${ic('alert')}${KIND[k]} 오류 <small>${esc(String(s.error || '').slice(0, 90))}</small></span>`;
    }).join('')}</div>`;
  }

  function content(st, d) {
    const code = st.code;
    const btns = `<div class="btns"><button class="btn sm" data-act="goSettings">${ic('sliders')}설정 열기</button><button class="btn sm ghost" data-act="autoRefresh">${ic('download')}다시 확인</button></div>`;
    if (!d.watch.length) return `<div class="empty-note"><p>아직 자동 수집이 설정되지 않았습니다. 설정 화면의 <b>자동 수집</b>에서 키를 등록하고 수집 대상을 올리면, 이곳에 최근 공시·뉴스·재무가 표시됩니다.</p>${btns}</div>`;
    if (!d.watch.some((w) => w.code === code)) return `<div class="empty-note"><p><b>${esc(st.name)}</b>은(는) 자동 수집 대상에 없습니다. 설정 › 자동 수집에서 대상 목록에 추가하세요.</p>${btns}</div>`;
    if (!d.status) return `<div class="empty-note"><p><b>${esc(st.name)}</b>은(는) 수집 대상으로 등록되어 있지만 아직 수집 기록이 없습니다. 저장소 Actions 탭에서 <b>자료 수집</b>을 한 번 실행해 보세요.</p>${btns}</div>`;
    const sst = d.status.stocks && d.status.stocks[code];
    if (!sst) return `<div class="empty-note"><p><b>${esc(st.name)}</b>은(는) 대상 목록에 올라 있지만 다음 수집 때부터 자료가 생깁니다. Actions 탭에서 바로 실행할 수도 있습니다.</p>${btns}</div>`;
    const tabs = [['dart', '공시'], ['news', '뉴스'], ['fin', '재무'], ['px', '시세·수급']];
    let body = '';
    if (ui.autoTab === 'dart') {
      const items = (d.dart && d.dart.items) || [];
      body = items.length ? `<ul class="alist">${items.slice(0, 12).map((x) => `<li><span class="ad">${esc(x.date.slice(5))}</span>${A.linkA(x.url, esc(x.title) + ic('ext'), { title: x.title })}</li>`).join('')}</ul>` : '<p class="muted">수집된 공시가 없습니다.</p>';
    } else if (ui.autoTab === 'news') {
      const items = (d.news && d.news.items) || [];
      body = items.length ? `<ul class="alist">${items.slice(0, 12).map((x) => `<li><span class="ad">${esc((x.date || '').slice(5, 10))}</span><span class="grow">${A.linkA(x.url, esc(x.title) + ic('ext'), { title: x.title })} <small class="muted">${esc(domain(x.url))}</small></span></li>`).join('')}</ul><p class="hint">제목과 링크만 보여줍니다. 내용은 원문에서 확인하세요.</p>` : '<p class="muted">수집된 뉴스가 없습니다.</p>';
    } else if (ui.autoTab === 'fin') {
      const ps = (d.fin && d.fin.periods) || [];
      body = ps.length ? `<div class="tablewrap"><table class="mini"><thead><tr><th>기간</th><th>매출(억)</th><th>영업이익(억)</th><th>영업이익률</th><th>순이익(억)</th><th>부채비율</th></tr></thead><tbody>${ps.slice(0, 8).map((p) => `<tr><td>${esc(p.label)} <small class="muted">${esc(p.fs || '')}</small></td><td>${eok(p.revenue)}</td><td>${eok(p.op)}</td><td>${p.revenue && p.op != null ? SM.fmtNum(p.op / p.revenue * 100, 1) + '%' : '-'}</td><td>${eok(p.net)}</td><td>${p.equity && p.liab != null ? SM.fmtNum(p.liab / p.equity * 100, 0) + '%' : '-'}</td></tr>`).join('')}</tbody></table></div><p class="hint">DART 공시 기준 요약입니다. 분기·반기 수치는 보고서에 따라 누적일 수 있어 기간 간 단순 비교는 조심하세요.</p>` : '<p class="muted">수집된 재무 자료가 없습니다.</p>';
    } else {
      const px = sst.prices;
      const fl = sst.flow, pxOk = px && px.ok, flOk = fl && fl.ok;
      body = pxOk || flOk ? `${pxOk ? `<p>일봉 <b>${px.count}일</b> 수집됨 · ${px.from ? esc(px.from) + ' ~ ' : '마지막 '}<b>${esc(px.last)}</b>${px.source === 'naver' ? ` <small class="muted">(네이버, 설정 기간 ${px.years || '-'}년)</small>` : ''}</p>` : ''}${flOk ? `<p>외국인·기관·개인 순매수 <b>${fl.count}일</b> 누적 · 마지막 <b>${esc(fl.last)}</b> <small class="muted">(단위: 주)</small></p>` : ''}<div class="btns"><button class="btn sm primary" data-act="autoToBt" data-code="${esc(code)}">${ic('lab')}시뮬레이션으로 불러오기</button></div>${pxOk ? `<p class="hint">${px.source === 'naver' ? '네이버 모바일 증권(비공식 주소)에서 받은 일봉입니다. 수정주가인지는 확인되지 않았으니 액면분할·배당이 있었다면 가격이 어긋날 수 있습니다. 장이 끝나기 전의 당일 값은 받지 않습니다.' : '공공데이터포털 시세이며 <b>수정주가가 아닙니다</b>(액면분할·배당 미반영). 당일 시세는 늦게 반영될 수 있어 다음 수집 때 이어받습니다.'}</p>` : ''}${flOk ? '<p class="hint">수급은 네이버 모바일 증권에서 매 수집 때 최근 60거래일을 받아 날짜별로 이어 붙입니다(수집을 쉰 기간은 비게 됩니다). 비공식 주소라 형식이 바뀌면 실패할 수 있습니다.</p>' : ''}` : '<p class="muted">수집된 시세·수급이 없습니다.</p>';
    }
    return `<div class="seg2 autotabs">${tabs.map(([k, l]) => `<button class="${ui.autoTab === k ? 'on' : ''}" data-act="autoTab" data-v="${k}">${l}</button>`).join('')}</div>${body}${statusLine(sst)}
      <div class="row between wrap"><small class="muted">마지막 수집 ${esc(when(d.status.updatedAt))}</small><button class="btn sm ghost" data-act="autoRefresh">${ic('download')}새로고침</button></div>`;
  }

  async function fillAuto(force) {
    const el = document.getElementById('autoBody');
    if (!el) return;
    const st = A.curStock();
    if (!st) return;
    if (!/^\d{6}$/.test(String(st.code || '').trim()) || st.market !== 'KR') {
      el.innerHTML = '<p class="muted">자동 수집은 국내 종목(종목코드 6자리)만 지원합니다. 종목 수정에서 종목코드를 입력하세요.</p>';
      return;
    }
    const stc = Object.assign({}, st, { code: st.code.trim() });
    const d = await D.all(stc.code, force);
    const cur = document.getElementById('autoBody');
    if (!cur || cur.dataset.code !== st.code) return; // 그 사이에 화면이 바뀜
    cur.innerHTML = content(stc, d);
  }
  A.afterRender.stocks = () => fillAuto(false);

  /* ---------- 설정: 자동 수집 카드 ---------- */
  A.autoCard = () => {
    const repo = D.repo();
    const link = (u, t) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${t}${ic('ext')}</a>` : t);
    const years = A.getState().settings.collectYears;
    const json = D.watchJson(A.getState().stocks, years);
    const kr = A.getState().stocks.filter((s) => s.market === 'KR' && /^\d{6}$/.test(String(s.code || '').trim())).length;
    return `<section class="card" id="autoCard"><h2>자동 수집 <small class="muted">공시 · 뉴스 · 재무 · 일봉 시세 · 수급 (국내 종목)</small></h2>
      <p class="hint">GitHub Actions가 평일 저녁 7시(한국시간)에 공식 API로 자료를 받아 저장소의 <code>data/</code> 폴더에 저장하고, 앱이 그 파일을 읽어 보여줍니다. 키는 GitHub Secrets에만 저장되며 앱이나 코드에는 들어가지 않습니다.</p>
      <div id="autoStatus" class="autostat-box"><span class="muted">상태를 확인하는 중…</span></div>
      <div class="warnbox"><div>${ic('alert')}<span><b>저장소가 공개라서</b> 수집 대상 목록(종목코드·이름)과 수집 결과가 누구에게나 보입니다. 보유 수량·매입금액·매매 기록은 올라가지 않습니다. 꺼려지면 이 기능을 쓰지 마세요.</span></div></div>
      <details><summary><b>설정 방법 (처음 한 번)</b></summary>
        <ol class="steps">
          <li><b>키 3개 발급</b> (모두 무료, 개인용 신청)
            <ul><li><a href="https://www.data.go.kr" target="_blank" rel="noopener noreferrer">공공데이터포털${ic('ext')}</a> 가입 → <b>“금융위원회_주식시세정보”</b> 검색 → 활용신청 → 마이페이지의 <b>일반 인증키</b> 복사 (승인까지 시간이 걸릴 수 있습니다) — <b>건너뛰어도 됩니다.</b> 키가 없으면 일봉 시세는 네이버에서 받아 옵니다</li>
            <li><a href="https://opendart.fss.or.kr" target="_blank" rel="noopener noreferrer">DART 오픈API${ic('ext')}</a> 가입 → 인증키 신청 → 키 복사</li>
            <li><a href="https://developers.naver.com" target="_blank" rel="noopener noreferrer">네이버 개발자센터${ic('ext')}</a> → Application → 애플리케이션 등록 → 사용 API <b>검색</b> 선택 → <b>Client ID / Client Secret</b> 복사</li></ul></li>
          <li>${link(repo && repo.secrets, 'GitHub 저장소 Settings › Secrets and variables › Actions')}에서 <b>New repository secret</b>으로 아래 4개를 등록합니다. 이름은 정확히 같아야 합니다.
            <div class="tablewrap"><table class="mini"><thead><tr><th>이름(Name)</th><th>넣을 값</th></tr></thead><tbody><tr><td><code>DATA_GO_KR_KEY</code></td><td>공공데이터포털 일반 인증키</td></tr><tr><td><code>DART_API_KEY</code></td><td>DART 인증키</td></tr><tr><td><code>NAVER_CLIENT_ID</code></td><td>네이버 Client ID</td></tr><tr><td><code>NAVER_CLIENT_SECRET</code></td><td>네이버 Client Secret</td></tr></tbody></table></div>
            <small class="muted">키는 채팅이나 코드에 붙여 넣지 마세요. 일부만 등록해도 되며, 없는 항목은 건너뜁니다.</small></li>
          <li><b>수집할 종목</b>: 아래 목록을 복사해서 ${link(repo && repo.editWatch, '저장소의 data/watchlist.json')}에 붙여 넣고 저장(Commit)합니다.</li>
          <li>${link(repo && repo.actions, '저장소 Actions 탭 › “자료 수집”')} › <b>Run workflow</b>로 한 번 실행합니다. 몇 분 뒤 이 화면을 새로고침하면 상태가 나타나고, 종목 화면의 <b>공시·뉴스·재무</b> 카드에 자료가 보입니다. 이후에는 평일마다 자동으로 실행됩니다.</li></ol></details>
      <div class="box"><label>일봉 시세 수집 기간 <small class="muted">(년, 1~15)</small><input class="inp" data-setting="collectYears" value="${esc(years)}" inputmode="numeric" style="max-width:120px"></label>
        <p class="hint">공공데이터 키가 <b>없으면</b> 시세를 네이버에서 받습니다(키 불필요). 처음 수집할 때 이 기간만큼 과거 일봉을 채우고, 이후에는 최근 며칠만 이어 붙입니다. 기간을 <b>늘리면</b> 다음 수집 때 더 과거가 채워지고, <b>줄여도</b> 이미 받은 데이터는 지우지 않습니다. 값을 바꾸면 아래 목록이 바뀌니, <b>다시 복사해서 data/watchlist.json 에 붙여 넣어야</b> 적용됩니다. 종목마다 다르게 하려면 목록에서 그 종목 줄에 <code>"years": 5</code> 를 직접 추가하세요.</p></div>
      <h4>수집 대상 목록 <small class="muted">(내 국내 종목 ${kr}개 · 종목코드 6자리가 입력된 종목만)</small></h4>
      <textarea id="watchJson" rows="${Math.min(10, json.split('\n').length + 1)}" readonly>${esc(json)}</textarea>
      <div class="btns"><button class="btn" data-act="copyWatch">${ic('note')}목록 복사</button>${repo ? `<a class="btn" href="${esc(repo.editWatch)}" target="_blank" rel="noopener noreferrer">${ic('edit')}GitHub에서 편집${ic('ext')}</a><a class="btn" href="${esc(repo.actions)}" target="_blank" rel="noopener noreferrer">${ic('stocks')}수집 실행하기${ic('ext')}</a>` : ''}</div>
      <p class="hint">실행 시각은 몇십 분 늦어질 수 있고, 저장소에 60일 넘게 활동이 없으면 GitHub가 예약 실행을 멈출 수 있습니다. 그때는 Actions 탭에서 다시 켜세요. 시세는 공공데이터 제공 시점 때문에 당일분이 늦게 올라올 수 있습니다.</p></section>`;
  };
  async function fillAutoCard() {
    const el = document.getElementById('autoStatus');
    if (!el) return;
    const wl = await D.watchlist(true);
    const st = wl.length ? await D.status(true) : null; // 대상이 없으면 상태 파일을 찾지 않는다(404 방지)
    if (!document.getElementById('autoStatus')) return;
    if (!wl.length) { el.innerHTML = `<span class="as skip">${ic('info')}수집 대상이 아직 없습니다.</span> <small class="muted">아래 목록을 저장소의 data/watchlist.json 에 올리면 시작됩니다.</small>`; return; }
    if (!st) { el.innerHTML = `<span class="as skip">${ic('info')}아직 수집 기록이 없습니다.</span> <small class="muted">대상 종목 ${wl.length}개 등록됨. 위 설정 방법을 따라 한 번 실행해 보세요.</small>`; return; }
    const k = st.keys || {};
    const bad = Object.values(st.stocks || {}).flatMap((s) => Object.entries(s).filter(([, v]) => v && v.ok === false).map(([kind, v]) => `${KIND[kind] || kind}: ${v.error}`));
    el.innerHTML = `<div><span class="as ok">${ic('check')}마지막 수집 ${esc(when(st.updatedAt))}</span> <small class="muted">· 종목 ${Object.keys(st.stocks || {}).length}개 · 키: 시세 ${k.prices ? '있음' : '없음'} / DART ${k.dart ? '있음' : '없음'} / 뉴스 ${k.news ? '있음' : '없음'}</small></div>
      ${bad.length ? `<div class="autostat">${[...new Set(bad)].slice(0, 6).map((b) => `<span class="as bad">${ic('alert')}${esc(b.slice(0, 160))}</span>`).join('')}</div>` : ''}
      ${(st.skipped || []).length ? `<small class="muted">제외된 항목: ${esc(st.skipped.join(', '))}</small>` : ''}`;
  }
  A.afterRender.settings = fillAutoCard;

  Object.assign(A.handlers, {
    autoTab: (el) => { ui.autoTab = el.dataset.v; fillAuto(false); },
    autoRefresh: () => { D.clear(); const b = document.getElementById('autoBody'); if (b) b.innerHTML = '<p class="muted">불러오는 중…</p>'; fillAuto(true); },
    autoToBt: (el) => { ui.view = 'backtest'; A.render(); window.scrollTo(0, 0); if (A.btLoadRepo) A.btLoadRepo(el.dataset.code); },
    copyWatch: async () => {
      const t = document.getElementById('watchJson').value;
      try { await navigator.clipboard.writeText(t); A.toast('수집 대상 목록을 복사했습니다'); }
      catch (e) { const ta = document.getElementById('watchJson'); ta.focus(); ta.select(); A.toast('자동 복사가 안 돼요. 선택된 내용을 직접 복사하세요', true); }
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
