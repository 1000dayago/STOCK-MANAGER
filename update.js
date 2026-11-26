/* update.js - 버전 표시 · 업데이트 확인 · 적용 */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app;
  const { esc } = A;
  const ic = SM.ic;
  const APP = root.SM_APP || { version: '0.0.0', date: '', history: [] };
  const LAST_KEY = 'stockmgr.updLast', SEEN_KEY = 'stockmgr.seenVersion';
  const CHECK_EVERY = 6 * 3600 * 1000;
  const U = (SM.update = { current: APP.version, available: null, status: '', checking: false, lastCheck: 0 });
  try { U.lastCheck = +localStorage.getItem(LAST_KEY) || 0; } catch (e) { /* ignore */ }

  const cmp = SM.compareVersions;
  const notesOf = (v) => ((APP.history || []).find((h) => h.version === v) || {}).notes || [];

  U.check = async function (manual) {
    if (U.checking) return;
    U.checking = true;
    if (manual) { U.status = '확인 중…'; changed(); }
    try {
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!j || !/^\d+\.\d+\.\d+$/.test(j.version || '')) throw new Error('형식 오류');
      U.lastCheck = Date.now();
      try { localStorage.setItem(LAST_KEY, String(U.lastCheck)); } catch (e) { /* ignore */ }
      if (cmp(j.version, APP.version) > 0) {
        const notes = [];
        (j.history || []).forEach((h) => { if (cmp(h.version, APP.version) > 0) notes.push({ version: h.version, date: h.date, notes: h.notes || [] }); });
        U.available = { version: j.version, date: j.date, notes };
        U.status = `새 버전 v${j.version}이 있습니다.`;
      } else { U.available = null; U.status = '최신 버전입니다.'; }
    } catch (e) {
      U.status = manual ? '확인하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.' : U.status;
    } finally { U.checking = false; changed(); }
  };

  U.apply = async function () {
    if (document.getElementById('edRoot') && !confirm('작성 중인 글이 있으면 저장되지 않을 수 있습니다. 먼저 저장했나요?\n계속 업데이트할까요?')) return;
    A.toast('업데이트하는 중…');
    try { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); } catch (e) { /* ignore */ }
    try { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); } catch (e) { /* ignore */ }
    location.replace(location.pathname + '?u=' + Date.now()); // 저장된 데이터는 지워지지 않습니다
  };

  function changed() {
    const b = document.getElementById('updBanner');
    if (b) b.outerHTML = A.banner();
    const c = document.getElementById('updCard');
    if (c) c.innerHTML = cardInner();
  }

  /* ---------- 화면 ---------- */
  A.banner = function () {
    if (!U.available) return '<div id="updBanner" hidden></div>';
    return `<div id="updBanner" class="updbanner"><span class="ub-t">${ic('download')}새 버전 <b>v${esc(U.available.version)}</b>이 있습니다.</span><span class="row gap"><button class="btn sm" data-act="updNotes">변경 내용</button><button class="btn sm primary" data-act="updApply">지금 업데이트</button></span></div>`;
  };
  function histHtml(list, max) {
    return list.slice(0, max).map((h) => `<div class="rel"><b>v${esc(h.version)}</b> <small class="muted">${esc(h.date || '')}</small><ul>${(h.notes || []).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`).join('');
  }
  function cardInner() {
    const last = U.lastCheck ? new Date(U.lastCheck).toLocaleString('ko-KR') : '아직 확인 전';
    return `<h2>앱 버전</h2>
      <div class="row between wrap"><div><b class="ver">v${esc(APP.version)}</b> <small class="muted">${esc(APP.date)}</small></div><button class="btn primary sm" data-act="updCheck" ${U.checking ? 'disabled' : ''}>업데이트 확인</button></div>
      <p class="syncmsg ${U.available ? 'warn' : U.status === '최신 버전입니다.' ? 'synced' : ''}">${esc(U.status || '')} <small class="muted">마지막 확인: ${esc(last)}</small></p>
      ${U.available ? `<div class="box"><b>v${esc(U.available.version)} 변경 내용</b>${histHtml(U.available.notes, 5)}<div class="btns"><button class="btn primary" data-act="updApply">지금 업데이트</button></div><p class="hint">업데이트해도 입력한 종목·매매 기록·사유·사진은 지워지지 않습니다. 앱 파일만 새로 받아 화면이 다시 열립니다.</p></div>` : ''}
      <details><summary>이전 변경 내용 보기</summary>${histHtml(APP.history || [], 10)}</details>`;
  }
  A.updateCard = () => `<section class="card" id="updCard">${cardInner()}</section>`;
  A.versionTag = () => `<div class="vtag">주식 관리 v${esc(APP.version)}</div>`;

  Object.assign(A.handlers, {
    updCheck: () => U.check(true),
    updApply: () => U.apply(),
    updNotes: () => {
      if (!U.available) return;
      A.openModal(`<h3>v${esc(U.available.version)} 변경 내용</h3>${histHtml(U.available.notes, 8)}<p class="hint">업데이트해도 입력한 데이터는 지워지지 않습니다.</p><div class="btns"><button class="btn primary" type="button" data-act="updApply">지금 업데이트</button><button class="btn" type="button" data-act="closeModal">나중에</button></div>`, null);
    },
  });

  /* ---------- 자동 확인 / 업데이트 직후 안내 ---------- */
  U.boot = function () {
    try { if (/[?&]u=/.test(location.search)) history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    let seen = null;
    try { seen = localStorage.getItem(SEEN_KEY); localStorage.setItem(SEEN_KEY, APP.version); } catch (e) { /* ignore */ }
    if (seen && cmp(APP.version, seen) > 0) {
      const list = (APP.history || []).filter((h) => cmp(h.version, seen) > 0);
      setTimeout(() => A.openModal(`<h3>업데이트되었습니다</h3><p>v${esc(seen)} → <b>v${esc(APP.version)}</b></p>${histHtml(list, 5)}<div class="btns"><button class="btn primary" type="button" data-act="closeModal">확인</button></div>`, null), 400);
    }
    const auto = () => { if (Date.now() - U.lastCheck > CHECK_EVERY) U.check(false); };
    setTimeout(auto, 2500);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') auto(); });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
