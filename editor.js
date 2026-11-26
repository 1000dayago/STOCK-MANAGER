/* editor.js - 매매 사유 에디터(서식·표·사진)와 보기 화면 */
(function (root) {
  'use strict';
  const SM = root.SM, M = SM.media;
  const ic = SM.ic;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = (SM.editor = {});
  const toast = (m, err) => SM.app && SM.app.toast(m, err);

  const TEMPLATES = {
    buy: '<h2>매수 이유</h2><ul><li><br></li></ul><h2>근거 (차트 · 수급 · 실적 · 뉴스)</h2><ul><li><br></li></ul><h2>목표가 / 기대 시나리오</h2><p><br></p><h2>손절 기준 · 리스크</h2><p><br></p><h2>메모</h2><p><br></p>',
    sell: '<h2>매도 이유</h2><ul><li><br></li></ul><h2>결과 평가 (계획대로였나?)</h2><p><br></p><h2>잘한 점 / 아쉬운 점</h2><ul><li><br></li></ul><h2>다음에 적용할 것</h2><p><br></p>',
    stock: '<h2>투자 아이디어</h2><p><br></p><h2>체크할 것 (실적 · 공시 · 수급)</h2><ul><li><br></li></ul><h2>메모</h2><p><br></p>',
  };
  const FONTS = [['', '글꼴'], ["'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif", '고딕'], ["'Batang','AppleMyungjo','Noto Serif KR',serif", '명조'], ["Consolas,'D2Coding',Menlo,monospace", '고정폭'], ["'Comic Sans MS','Nanum Pen Script',cursive", '필기체']];
  const SIZES = [['', '크기'], ['1', '아주 작게'], ['2', '작게'], ['3', '보통'], ['4', '크게'], ['5', '더 크게'], ['6', '매우 크게']];
  const BLOCKS = [['', '문단'], ['<p>', '본문'], ['<h1>', '제목 1'], ['<h2>', '제목 2'], ['<h3>', '제목 3'], ['<blockquote>', '인용']];

  const btn = (cmd, label, title, extra = '') => `<button type="button" class="tb" data-cmd="${cmd}" title="${title}" ${extra}>${label}</button>`;
  const ed = (act, label, title, extra = '') => `<button type="button" class="tb" data-ed="${act}" title="${title}" ${extra}>${label}</button>`;
  const sel = (name, list) => `<select class="tb sel" data-sel="${name}" title="${list[0][1]}">${list.map(([v, l]) => `<option value="${esc(v)}">${l}</option>`).join('')}</select>`;

  function toolbarHtml() {
    const L = (t) => `<span class="lbl">${t}</span>`;
    return `<div class="tg">${btn('undo', ic('undo'), '실행 취소')}${btn('redo', ic('redo'), '다시 실행')}</div>
      <div class="tg">${sel('block', BLOCKS)}${sel('font', FONTS)}${sel('size', SIZES)}</div>
      <div class="tg">${btn('bold', '<b>B</b>', '굵게 (Ctrl+B)')}${btn('italic', '<i>I</i>', '기울임 (Ctrl+I)')}${btn('underline', '<u>U</u>', '밑줄 (Ctrl+U)')}${btn('strikeThrough', '<s>S</s>', '취소선')}${btn('superscript', 'x<sup>2</sup>', '위 첨자')}${btn('subscript', 'x<sub>2</sub>', '아래 첨자')}</div>
      <div class="tg"><label class="tb clr" title="글자색"><span class="aletter">A</span><i class="bar"></i><input type="color" data-color="foreColor" value="#d92d20"></label><label class="tb clr" title="형광펜 색 고르기">${ic('highlighter')}<input type="color" data-color="hiliteColor" value="#fff176"></label>${ed('yellow', '<i class="dot"></i>', '노란 형광펜')}${ed('noclr', L('색 해제'), '글자색·배경색 제거')}</div>
      <div class="tg">${btn('justifyLeft', ic('alignL'), '왼쪽 정렬')}${btn('justifyCenter', ic('alignC'), '가운데 정렬')}${btn('justifyRight', ic('alignR'), '오른쪽 정렬')}${btn('justifyFull', ic('alignJ'), '양쪽 정렬')}</div>
      <div class="tg">${btn('insertUnorderedList', ic('list'), '글머리 기호')}${btn('insertOrderedList', ic('listOl'), '번호 목록')}${ed('chk0', ic('square'), '체크박스 넣기')}${ed('chk1', ic('squareCheck'), '체크됨 표시 넣기')}${btn('outdent', ic('outdent'), '내어쓰기')}${btn('indent', ic('indent'), '들여쓰기')}</div>
      <div class="tg">${ed('table', ic('table') + L('표'), '표 삽입')}${ed('link', ic('link') + L('링크'), '링크 걸기')}${btn('insertHorizontalRule', ic('minus'), '구분선')}${ed('date', ic('calendar'), '지금 날짜·시간 넣기')}</div>
      <div class="tg">${ed('photo', ic('image') + L('사진'), '사진 넣기(여러 장 가능)')}${ed('camera', ic('camera'), '카메라로 찍어 넣기')}</div>
      <div class="tg">${btn('removeFormat', ic('eraser'), '선택 영역 서식 지우기')}${ed('tpl', ic('template') + L('템플릿'), '복기용 템플릿 넣기')}</div>`;
  }

  /* ---------- 에디터 ---------- */
  E.open = async function (opts) {
    const key = opts.key;
    const prev = document.getElementById('edRoot');
    if (prev) prev.remove();
    const root0 = document.createElement('div');
    root0.id = 'edRoot'; root0.className = 'ed-overlay';
    root0.innerHTML = `<div class="ed" role="dialog" aria-modal="true">
      <div class="ed-head"><b class="ed-title">${esc(opts.title || '매매 사유')}</b><span id="edStatus" class="ed-status">불러오는 중…</span>
        <button type="button" class="btn sm primary" data-ed="save">${ic('check')}저장</button><button type="button" class="btn sm" data-ed="close">${ic('x')}닫기</button></div>
      <div class="ed-tools" id="edTools">${toolbarHtml()}</div>
      <div class="ed-pop" id="edTablePop" hidden>표 크기: <input type="number" id="tRows" value="3" min="1" max="30"> 행 × <input type="number" id="tCols" value="3" min="1" max="12"> 열 <button type="button" class="btn sm primary" data-ed="tableOk">삽입</button><button type="button" class="btn sm" data-ed="tableCancel">취소</button></div>
      <div class="ed-ctx" id="edTableBar" hidden><b>표</b> <button type="button" class="tb" data-ed="rowAdd">행 추가</button><button type="button" class="tb" data-ed="colAdd">열 추가</button><button type="button" class="tb" data-ed="rowDel">행 삭제</button><button type="button" class="tb" data-ed="colDel">열 삭제</button><button type="button" class="tb" data-ed="tableDel">${ic('trash')}<span class="lbl">표 삭제</span></button></div>
      <div class="ed-ctx" id="edImgBar" hidden><b>사진</b> <button type="button" class="tb" data-ed="img25">25%</button><button type="button" class="tb" data-ed="img50">50%</button><button type="button" class="tb" data-ed="img75">75%</button><button type="button" class="tb" data-ed="img100">100%</button><button type="button" class="tb" data-ed="imgDel">${ic('trash')}<span class="lbl">삭제</span></button></div>
      <div id="edBody" class="note-body ed-body" contenteditable="true" spellcheck="false" data-ph="여기에 매매 사유를 적어 보세요. 위 메뉴로 글자 서식, 표, 사진을 넣을 수 있습니다."></div>
      <div id="edConfirm" class="ed-confirm" hidden><div class="box">저장하지 않은 내용이 있습니다.<div class="btns"><button type="button" class="btn primary" data-ed="saveClose">저장하고 닫기</button><button type="button" class="btn danger" data-ed="discard">저장 안 하고 닫기</button><button type="button" class="btn" data-ed="stay">계속 편집</button></div></div></div>
      <input type="file" id="edFile" accept="image/*" multiple hidden><input type="file" id="edCam" accept="image/*" capture="environment" hidden>
    </div>`;
    document.body.appendChild(root0);
    document.body.classList.add('noscroll');
    const body = root0.querySelector('#edBody');
    const status = root0.querySelector('#edStatus');
    let dirty = false, savedRange = null, curImg = null, draftTimer = null, saving = false;
    const draftKey = 'stockmgr.draft.' + key;

    const setStatus = (t, cls) => { status.textContent = t; status.className = 'ed-status ' + (cls || ''); };
    const markDirty = () => { dirty = true; setStatus('수정됨 · 저장 전', 'warn'); clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 2500); };
    function saveDraft() { try { localStorage.setItem(draftKey, JSON.stringify({ html: body.innerHTML, t: Date.now() })); } catch (e) { /* ignore */ } }

    /* 선택 영역 보관(색상 선택창 등을 눌러도 위치 유지) */
    const onSelChange = () => {
      const s = document.getSelection();
      if (s && s.rangeCount && body.contains(s.anchorNode)) { savedRange = s.getRangeAt(0).cloneRange(); updateBars(); }
    };
    document.addEventListener('selectionchange', onSelChange);
    function restoreSel() {
      body.focus();
      const s = document.getSelection();
      if (savedRange) { s.removeAllRanges(); s.addRange(savedRange); }
      else { const r = document.createRange(); r.selectNodeContents(body); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    }
    function ex(cmd, val) {
      restoreSel();
      try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
      document.execCommand(cmd, false, val == null ? null : val);
      markDirty(); updateBars();
    }
    function insertHTML(html) { restoreSel(); document.execCommand('insertHTML', false, html); markDirty(); updateBars(); }

    /* 표 */
    const cellOf = () => { const s = document.getSelection(); if (!s || !s.anchorNode || !body.contains(s.anchorNode)) return null; const n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement; return n ? n.closest('td,th') : null; };
    function updateBars() {
      root0.querySelector('#edTableBar').hidden = !cellOf();
      root0.querySelector('#edImgBar').hidden = !curImg;
    }
    function tableOp(op) {
      const td = cellOf(); if (!td) return;
      const tr = td.parentElement, table = td.closest('table'), idx = td.cellIndex;
      const mkCell = (tag) => { const c = document.createElement(tag); c.innerHTML = '<br>'; return c; };
      if (op === 'rowAdd') { const n = document.createElement('tr'); for (let i = 0; i < tr.cells.length; i++) n.appendChild(mkCell('td')); tr.after(n); }
      else if (op === 'colAdd') { Array.from(table.rows).forEach((r) => { const ref = r.cells[idx]; const c = mkCell(ref && ref.tagName === 'TH' ? 'th' : 'td'); if (ref) ref.after(c); else r.appendChild(c); }); }
      else if (op === 'rowDel') { tr.remove(); if (!table.rows.length) table.remove(); }
      else if (op === 'colDel') { Array.from(table.rows).forEach((r) => { if (r.cells[idx]) r.cells[idx].remove(); }); if (!table.rows[0] || !table.rows[0].cells.length) table.remove(); }
      else if (op === 'tableDel') table.remove();
      markDirty(); updateBars();
    }

    /* 사진 */
    async function addImages(files) {
      const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
      if (!list.length) return;
      setStatus('사진 처리 중…', 'warn');
      let ok = 0;
      for (const f of list) {
        try { const { id, dataUrl } = await M.putImage(f); insertHTML(`<img data-img="${id}" src="${dataUrl}" style="width:60%"><br>`); ok++; }
        catch (e) { toast('사진을 넣지 못했습니다: ' + e.message, true); }
      }
      if (ok) markDirty(); else setStatus(dirty ? '수정됨 · 저장 전' : '저장됨', dirty ? 'warn' : 'ok');
    }
    function selectImg(im) {
      body.querySelectorAll('img.sel').forEach((x) => x.classList.remove('sel'));
      curImg = im; if (im) im.classList.add('sel'); updateBars();
    }

    /* 저장/닫기 */
    async function save() {
      if (saving) return true;
      saving = true;
      try {
        const clone = body.cloneNode(true);
        clone.querySelectorAll('img.sel').forEach((x) => x.classList.remove('sel'));
        await M.saveNote(key, clone.innerHTML);
        dirty = false; try { localStorage.removeItem(draftKey); } catch (e) { /* ignore */ }
        setStatus('저장됨 ' + new Date().toLocaleTimeString('ko-KR'), 'ok');
        if (opts.onSaved) opts.onSaved();
        return true;
      } catch (e) { toast('저장하지 못했습니다: ' + e.message, true); return false; }
      finally { saving = false; }
    }
    function close() {
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('keydown', onKey, true);
      clearTimeout(draftTimer);
      root0.remove(); document.body.classList.remove('noscroll');
      if (opts.onClose) opts.onClose();
    }
    const askClose = () => { if (!dirty) return close(); root0.querySelector('#edConfirm').hidden = false; };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
      else if (e.key === 'Escape' && !root0.querySelector('#edConfirm').hidden) root0.querySelector('#edConfirm').hidden = true;
    };
    document.addEventListener('keydown', onKey, true);

    /* 이벤트 */
    root0.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tb') && !e.target.closest('select') && !e.target.closest('input')) e.preventDefault(); // 선택 유지
    });
    root0.addEventListener('click', async (e) => {
      const im = e.target.closest('img[data-img]');
      if (im && body.contains(im)) { selectImg(im); return; }
      if (!e.target.closest('.ed-ctx') && curImg && body.contains(e.target)) selectImg(null);
      const c = e.target.closest('[data-cmd]');
      if (c) { ex(c.dataset.cmd); return; }
      const a = e.target.closest('[data-ed]');
      if (!a) return;
      const act = a.dataset.ed;
      if (act === 'save') await save();
      else if (act === 'close') askClose();
      else if (act === 'saveClose') { if (await save()) close(); }
      else if (act === 'discard') { dirty = false; try { localStorage.removeItem(draftKey); } catch (er) { /* ignore */ } close(); }
      else if (act === 'stay') root0.querySelector('#edConfirm').hidden = true;
      else if (act === 'yellow') ex('hiliteColor', '#fff176');
      else if (act === 'noclr') { ex('foreColor', '#1a2230'); ex('hiliteColor', 'transparent'); }
      else if (act === 'chk0') insertHTML('☐&nbsp;');
      else if (act === 'chk1') insertHTML('☑&nbsp;');
      else if (act === 'date') insertHTML(esc(new Date().toLocaleString('ko-KR')) + '&nbsp;');
      else if (act === 'link') {
        const url = prompt('연결할 주소(URL)를 입력하세요', 'https://');
        if (url && url.trim() && url.trim() !== 'https://') { const u = /^(https?:|mailto:|tel:)/i.test(url.trim()) ? url.trim() : 'https://' + url.trim(); const s = document.getSelection(); if (!s || s.isCollapsed) insertHTML(`<a href="${esc(u)}">${esc(u)}</a>&nbsp;`); else ex('createLink', u); }
      }
      else if (act === 'table') { const p = root0.querySelector('#edTablePop'); p.hidden = !p.hidden; }
      else if (act === 'tableCancel') root0.querySelector('#edTablePop').hidden = true;
      else if (act === 'tableOk') {
        const r = Math.min(30, Math.max(1, parseInt(root0.querySelector('#tRows').value, 10) || 3)), cc = Math.min(12, Math.max(1, parseInt(root0.querySelector('#tCols').value, 10) || 3));
        let h = '<table><tbody>';
        for (let i = 0; i < r; i++) { h += '<tr>'; for (let j = 0; j < cc; j++) h += i === 0 ? '<th><br></th>' : '<td><br></td>'; h += '</tr>'; }
        h += '</tbody></table><p><br></p>';
        insertHTML(h); root0.querySelector('#edTablePop').hidden = true;
      }
      else if (['rowAdd', 'colAdd', 'rowDel', 'colDel', 'tableDel'].includes(act)) tableOp(act);
      else if (act === 'photo') root0.querySelector('#edFile').click();
      else if (act === 'camera') root0.querySelector('#edCam').click();
      else if (/^img\d+$/.test(act) && curImg) { curImg.style.width = act.slice(3) + '%'; markDirty(); }
      else if (act === 'imgDel' && curImg) { curImg.remove(); selectImg(null); markDirty(); }
      else if (act === 'tpl') {
        const tpl = TEMPLATES[opts.kind] || TEMPLATES.buy;
        if (M.isEmptyNote(body.innerHTML)) { body.innerHTML = tpl; markDirty(); }
        else insertHTML(tpl);
      }
    });
    root0.addEventListener('change', (e) => {
      const s = e.target.closest('select[data-sel]');
      if (s) {
        const v = s.value, n = s.dataset.sel; s.selectedIndex = 0;
        if (!v) return;
        if (n === 'block') ex('formatBlock', v);
        else if (n === 'font') ex('fontName', v);
        else if (n === 'size') ex('fontSize', v);
        return;
      }
      const c = e.target.closest('input[data-color]');
      if (c) { ex(c.dataset.color, c.value); return; }
      if (e.target.id === 'edFile' || e.target.id === 'edCam') { addImages(e.target.files); e.target.value = ''; }
    });
    body.addEventListener('input', markDirty);
    body.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;
      const files = Array.from(cd.files || []).filter((f) => /^image\//.test(f.type));
      e.preventDefault();
      if (files.length) { addImages(files); return; }
      const html = cd.getData('text/html');
      if (html) insertHTML(M.sanitize(html));
      else document.execCommand('insertText', false, cd.getData('text/plain'));
      markDirty();
    });
    body.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
    body.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files; if (f && f.length) { e.preventDefault(); addImages(f); } });
    body.addEventListener('keyup', updateBars);

    /* 불러오기 */
    const rec = await M.getNote(key);
    body.innerHTML = rec ? M.sanitize(rec.html) : '';
    M.hydrate(body);
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch (e) { draft = null; }
    if (draft && draft.html && draft.t > ((rec && rec.updatedAt) || 0) && confirm('저장하지 않은 임시 저장본이 있습니다 (' + new Date(draft.t).toLocaleString('ko-KR') + ').\n불러올까요?')) {
      body.innerHTML = M.sanitize(draft.html); M.hydrate(body); dirty = true;
      setStatus('임시본 불러옴 · 저장 전', 'warn');
    } else setStatus(rec ? '저장됨 ' + new Date(rec.updatedAt).toLocaleString('ko-KR') : '새 글', 'ok');
    if (!rec && !draft && !opts.noTemplate && opts.kind) {
      // 새 글이면 템플릿을 제안(바로 들어가진 않음)
      body.dataset.ph = '여기에 적어 보세요. 위의 “템플릿” 버튼으로 복기용 틀(이유·근거·손절 기준 등)을 넣을 수 있습니다.';
    }
    body.focus();
  };

  /* ---------- 보기 ---------- */
  E.view = async function (key, opts) {
    const rec = await M.getNote(key);
    const prev = document.getElementById('edRoot');
    if (prev) prev.remove();
    const r = document.createElement('div');
    r.id = 'edRoot'; r.className = 'ed-overlay';
    r.innerHTML = `<div class="ed viewer" role="dialog" aria-modal="true"><div class="ed-head"><b class="ed-title">${esc(opts.title || '매매 사유')}</b><span class="ed-status">${rec ? '수정 ' + new Date(rec.updatedAt).toLocaleString('ko-KR') : ''}</span>
      <button type="button" class="btn sm" data-v="edit">${ic('edit')}수정</button><button type="button" class="btn sm" data-v="print">${ic('printer')}인쇄</button><button type="button" class="btn sm" data-v="close">${ic('x')}닫기</button></div>
      ${opts.header ? `<div class="viewer-meta">${opts.header}</div>` : ''}
      <div class="note-body view-body">${rec ? M.sanitize(rec.html) : '<p class="muted">작성된 내용이 없습니다. “수정”을 눌러 작성하세요.</p>'}</div></div>`;
    document.body.appendChild(r); document.body.classList.add('noscroll');
    const vb = r.querySelector('.view-body');
    M.hydrate(vb);
    const close = () => { r.remove(); document.body.classList.remove('noscroll'); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { const lb = document.getElementById('lightbox'); if (lb) lb.remove(); else close(); } };
    document.addEventListener('keydown', onKey);
    r.addEventListener('click', (e) => {
      const im = e.target.closest('img[data-img]');
      if (im && vb.contains(im)) { const lb = document.createElement('div'); lb.id = 'lightbox'; lb.innerHTML = `<img src="${im.src}" alt="">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); return; }
      const b = e.target.closest('[data-v]'); if (!b) return;
      if (b.dataset.v === 'close') close();
      else if (b.dataset.v === 'edit') { close(); if (opts.onEdit) opts.onEdit(); }
      else if (b.dataset.v === 'print') {
        let pr = document.getElementById('print-root');
        if (!pr) { pr = document.createElement('div'); pr.id = 'print-root'; document.body.appendChild(pr); }
        pr.innerHTML = `<h2>${esc(opts.title || '')}</h2><div class="viewer-meta">${opts.header || ''}</div><div class="note-body">${vb.innerHTML}</div>`;
        document.body.classList.add('printing'); window.print(); document.body.classList.remove('printing');
      }
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
