/* ui-link.js - 링크를 새 창으로 열지, 앱 안(보기 창)에서 열지 선택 */
(function (root) {
  'use strict';
  const SM = root.SM, A = SM.app;
  const { esc } = A;
  const ic = SM.ic;
  const S = () => A.getState();

  const hostOf = (url) => { try { return new URL(url, location.href).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const isHttp = (url) => { try { return /^https?:$/.test(new URL(url, location.href).protocol); } catch (e) { return false; } };

  const MODES = ['tab', 'browser', 'app'];
  A.isAndroid = () => /Android/i.test(navigator.userAgent || '');
  // 안드로이드에서 앱(홈 화면 앱) 밖의 기본 브라우저로 보내는 인텐트 주소. 처리할 앱이 없으면 원래 주소로 열립니다.
  A.intentUrl = (url) => {
    const u = new URL(url, location.href);
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
  };
  A.openExternal = (url) => {
    if (A.isAndroid()) { location.href = A.intentUrl(url); return; }
    window.open(url, '_blank', 'noopener,noreferrer');
  };
  // 열기 방식 결정: 링크별 지정 > 새 창으로 고정한 사이트 > 전체 설정
  A.linkMode = (url, link) => {
    if (!isHttp(url)) return 'tab';
    if (link && MODES.includes(link.open)) return link.open;
    const st = S().settings;
    if ((st.linkTabHosts || []).includes(hostOf(url))) return 'tab';
    return MODES.includes(st.linkMode) ? st.linkMode : 'tab';
  };
  // 새 창 링크가 기본 동작(우클릭·길게 누르기·Ctrl+클릭도 정상 동작)이고, 앱 안에서 보기는 클릭 때 가로챕니다.
  A.linkA = (url, label, opt) => {
    opt = opt || {};
    return `<a class="${opt.cls || ''}" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-vlink="1" data-vtitle="${esc(opt.title || '')}"${opt.lid ? ` data-lid="${esc(opt.lid)}"` : ''}>${label}</a>`;
  };

  /* ---------- 보기 창 ---------- */
  let view = null;
  function closeView(fromPop) {
    if (!view) return;
    const v = view; view = null;
    v.el.remove(); document.body.classList.remove('noscroll');
    document.removeEventListener('keydown', v.onKey);
    window.removeEventListener('popstate', v.onPop);
    if (!fromPop && v.pushed) { try { history.back(); } catch (e) { /* ignore */ } }
  }
  A.closeViewer = () => closeView(false);
  A.openViewer = function (url, title) {
    if (view) closeView(true);
    const host = hostOf(url);
    const el = document.createElement('div');
    el.className = 'vw-overlay'; el.id = 'viewerRoot';
    el.innerHTML = `<div class="vw-head"><button type="button" class="btn sm" data-vw="close">${ic('x')}닫기</button>
        <div class="vw-title"><b>${esc(title || host)}</b><small class="muted">${esc(host)}</small></div>
        <button type="button" class="btn sm" data-vw="reload" title="다시 불러오기">${ic('download')}<span class="vw-lbl">새로고침</span></button>
        <a class="btn sm primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-vw="ext">${ic('ext')}${A.isAndroid() ? '브라우저로 열기' : '새 창으로 열기'}</a></div>
      <div class="vw-hint" id="vwHint">${ic('info')}<span>화면이 비어 있거나 “연결을 거부했습니다”로 나오면 이 사이트는 앱 안에서 열 수 없는 사이트입니다.</span>
        <button type="button" class="btn sm" data-vw="pin">이 사이트는 항상 새 창으로</button><button type="button" class="vw-x" data-vw="hint" aria-label="안내 닫기">${ic('x')}</button></div>
      <div class="vw-body"><div class="vw-loading" id="vwLoading">불러오는 중…</div>
        <iframe class="vw-frame" id="vwFrame" src="${esc(url)}" title="${esc(title || host)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe></div>`;
    document.body.appendChild(el); document.body.classList.add('noscroll');
    const frame = el.querySelector('#vwFrame');
    frame.addEventListener('load', () => { const l = el.querySelector('#vwLoading'); if (l) l.remove(); });
    const onKey = (e) => { if (e.key === 'Escape') closeView(false); };
    const onPop = () => closeView(true);
    let pushed = false;
    try { history.pushState({ vw: 1 }, ''); pushed = true; } catch (e) { /* ignore */ }
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    view = { el, onKey, onPop, pushed, url, host };
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-vw]');
      if (!b) return;
      const a = b.dataset.vw;
      if (a === 'ext') { if (A.isAndroid()) { e.preventDefault(); A.openExternal(url); } return; }
      if (a === 'close') closeView(false);
      else if (a === 'reload') { const f = el.querySelector('#vwFrame'); const u = f.src; f.src = 'about:blank'; setTimeout(() => { f.src = u; }, 30); }
      else if (a === 'hint') el.querySelector('#vwHint').remove();
      else if (a === 'pin') {
        const st = S().settings;
        if (host && !(st.linkTabHosts || []).includes(host)) { st.linkTabHosts = (st.linkTabHosts || []).concat([host]); A.save(); }
        A.toast(`${host} 은(는) 앞으로 새 창으로 엽니다`);
        A.openExternal(url);
        closeView(false);
      }
    });
  };

  // 앱 안에서 보기가 선택된 링크는 클릭을 가로채 보기 창으로 엽니다
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-vlink]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = a.dataset.lid ? (S().settings.links || []).find((l) => l.id === a.dataset.lid) : null;
    const mode = A.linkMode(a.href, link);
    if (mode === 'browser') { if (!A.isAndroid()) return; e.preventDefault(); A.openExternal(a.href); return; } // 안드로이드 외에서는 새 창과 동일
    if (mode !== 'app') return;
    e.preventDefault();
    A.openViewer(a.href, a.dataset.vtitle || '');
  });

  Object.assign(A.handlers, {
    hostUnpin: (el) => { const st = S().settings; st.linkTabHosts = (st.linkTabHosts || []).filter((h) => h !== el.dataset.host); A.save(); A.render(); },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
