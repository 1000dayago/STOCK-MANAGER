/* media.js - 매매 사유(서식 있는 글)와 사진의 저장/동기화/보안 정리 */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});
  const hooks = { index: () => {}, refresh: () => {} }; // ui.js 가 연결
  const M = (SM.media = { hooks });

  /* ---------- IndexedDB (없으면 메모리) ---------- */
  const DBN = 'stockmgr-media';
  let dbp = null;
  const mem = { notes: new Map(), images: new Map() };
  let useMem = false;
  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      try {
        if (!root.indexedDB) throw new Error('no idb');
        const r = indexedDB.open(DBN, 1);
        r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('notes', { keyPath: 'key' }); d.createObjectStore('images', { keyPath: 'id' }); };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    }).catch(() => { useMem = true; return null; });
    return dbp;
  }
  const kp = (store) => (store === 'notes' ? 'key' : 'id');
  async function idbGet(store, k) {
    const d = await openDB();
    if (!d) return mem[store].get(k);
    return new Promise((res, rej) => { const r = d.transaction(store).objectStore(store).get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function idbPut(store, v) {
    const d = await openDB();
    if (!d) { mem[store].set(v[kp(store)], v); return; }
    return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(v); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function idbDel(store, k) {
    const d = await openDB();
    if (!d) { mem[store].delete(k); return; }
    return new Promise((res, rej) => { const t = d.transaction(store, 'readwrite'); t.objectStore(store).delete(k); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function idbAll(store) {
    const d = await openDB();
    if (!d) return [...mem[store].values()];
    return new Promise((res, rej) => { const r = d.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async function idbClear() {
    const d = await openDB();
    if (!d) { mem.notes.clear(); mem.images.clear(); return; }
    return new Promise((res, rej) => { const t = d.transaction(['notes', 'images'], 'readwrite'); t.objectStore('notes').clear(); t.objectStore('images').clear(); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  M.usingMemory = () => useMem;

  /* ---------- HTML 정리(보안) ---------- */
  const TAGS = new Set(['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'hr', 'pre', 'code', 'mark', 'font', 'colgroup', 'col']);
  const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'noscript', 'template', 'svg', 'math', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'canvas', 'title', 'head']);
  const STYLE_OK = new Set(['color', 'background-color', 'background', 'font-size', 'font-family', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'width', 'margin-left', 'padding-left', 'line-height', 'text-indent', 'vertical-align']);
  const FONT_SIZES = ['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large'];
  function cleanStyle(str, tag) {
    const out = [];
    String(str || '').split(';').forEach((decl) => {
      const i = decl.indexOf(':');
      if (i < 0) return;
      const prop = decl.slice(0, i).trim().toLowerCase();
      let val = decl.slice(i + 1).trim();
      if (!STYLE_OK.has(prop)) return;
      if (!/^[#\w\s.,%()\-"'가-힣]+$/.test(val) || /url\(|expression|javascript|import/i.test(val)) return;
      if (prop === 'background') { if (!/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(val)) return; }
      if (prop === 'width' && !/^\d{1,4}(\.\d+)?(%|px)$/.test(val)) return;
      if (tag === 'img' && prop !== 'width') return;
      out.push(prop + ':' + val);
    });
    return out.join(';');
  }
  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    const out = document.createElement('div');
    (function walk(src, dst) {
      for (const n of Array.from(src.childNodes)) {
        if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        if (DROP.has(tag)) continue;
        if (!TAGS.has(tag)) { walk(n, dst); continue; }
        if (tag === 'img') {
          const id = n.getAttribute('data-img');
          if (!id || !/^[\w-]{4,64}$/.test(id)) continue;
          const im = document.createElement('img');
          im.setAttribute('data-img', id);
          const st = cleanStyle(n.getAttribute('style'), 'img');
          if (st) im.setAttribute('style', st);
          dst.appendChild(im);
          continue;
        }
        const outTag = tag === 'font' ? 'span' : tag;
        const el = document.createElement(outTag);
        let style = cleanStyle(n.getAttribute('style'), outTag);
        if (tag === 'font') {
          const parts = [];
          const c = n.getAttribute('color'); if (c && /^[#\w]+$/.test(c)) parts.push('color:' + c);
          const f = n.getAttribute('face'); if (f && /^[\w\s,'"가-힣-]+$/.test(f)) parts.push('font-family:' + f);
          const sz = parseInt(n.getAttribute('size'), 10); if (sz >= 1 && sz <= 7) parts.push('font-size:' + FONT_SIZES[sz - 1]);
          style = parts.join(';') + (style ? ';' + style : '');
        }
        if (style) el.setAttribute('style', style);
        if (tag === 'a') {
          const href = (n.getAttribute('href') || '').trim();
          if (/^(https?:|mailto:|tel:)/i.test(href)) { el.setAttribute('href', href); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        }
        if (tag === 'td' || tag === 'th') {
          ['colspan', 'rowspan'].forEach((a) => { const v = parseInt(n.getAttribute(a), 10); if (v > 1 && v < 50) el.setAttribute(a, v); });
        }
        walk(n, el);
        dst.appendChild(el);
      }
    })(doc.body, out);
    return out.innerHTML;
  }
  const imageIds = (html) => { const ids = []; String(html || '').replace(/data-img="([\w-]+)"/g, (_, id) => ids.push(id)); return ids; };
  function plainText(html) {
    const d = new DOMParser().parseFromString('<body>' + String(html || '').replace(/<\/(p|div|li|h[1-3]|tr|blockquote)>/gi, ' </$1>').replace(/<br\s*\/?>/gi, ' ') + '</body>', 'text/html');
    return (d.body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  const isEmptyNote = (html) => plainText(html) === '' && imageIds(html).length === 0 && !/<table|<hr/i.test(html);
  Object.assign(M, { sanitize, imageIds, plainText, isEmptyNote });

  /* ---------- 글 ---------- */
  const idxEntry = (rec) => ({ u: rec.updatedAt, t: plainText(rec.html).slice(0, 90), n: imageIds(rec.html).length });
  M.getNote = async (key) => { const r = await idbGet('notes', key); return r && !r.deleted ? r : null; };
  M.saveNote = async (key, html) => {
    const clean = sanitize(html);
    if (isEmptyNote(clean)) return M.deleteNote(key);
    if (clean.length > 600000) throw new Error('글이 너무 큽니다. 사진을 줄이거나 나눠서 저장하세요.');
    const rec = { key, html: clean, updatedAt: Date.now(), dirty: true };
    await idbPut('notes', rec);
    hooks.index(key, idxEntry(rec), false);
    schedulePush();
    return rec;
  };
  M.deleteNote = async (key) => {
    const old = await idbGet('notes', key);
    if (!old) { hooks.index(key, null, false); return null; }
    await idbPut('notes', { key, html: '', deleted: true, updatedAt: Date.now(), dirty: true });
    hooks.index(key, null, false);
    schedulePush();
    return null;
  };

  /* ---------- 사진 ---------- */
  const imgCache = new Map();
  async function compress(file) {
    let bmp;
    try { bmp = await createImageBitmap(file); }
    catch (e) {
      bmp = await new Promise((res, rej) => { const im = new Image(); const u = URL.createObjectURL(file); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => rej(new Error('이미지를 읽을 수 없습니다.')); im.src = u; });
    }
    let w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    let max = 1600, dataUrl = '';
    for (let attempt = 0; attempt < 6; attempt++) {
      const sc = Math.min(1, max / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc));
      const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); cx.drawImage(bmp, 0, 0, cw, ch);
      for (let q = 0.85; q >= 0.4; q -= 0.15) { dataUrl = cv.toDataURL('image/jpeg', q); if (dataUrl.length <= 700000) return dataUrl; }
      max = Math.round(max * 0.75);
    }
    throw new Error('사진을 충분히 줄이지 못했습니다. 다른 사진을 사용하세요.');
  }
  M.putImage = async (file) => {
    const dataUrl = await compress(file);
    const id = 'i' + SM.uid() + Math.random().toString(36).slice(2, 6);
    await idbPut('images', { id, dataUrl, updatedAt: Date.now(), dirty: true });
    imgCache.set(id, dataUrl);
    schedulePush();
    return { id, dataUrl };
  };
  M.imageURL = async (id) => {
    if (imgCache.has(id)) return imgCache.get(id);
    const r = await idbGet('images', id);
    if (r && r.dataUrl) { imgCache.set(id, r.dataUrl); return r.dataUrl; }
    const S = SM.sync && SM.sync.S;
    if (S && S.fb && S.user) {
      try {
        const snap = await S.fb.fs.getDoc(S.fb.fs.doc(S.fb.db, 'users', S.user.uid, 'images', id));
        if (snap.exists()) { const d = snap.data(); await idbPut('images', { id, dataUrl: d.dataUrl, updatedAt: d.updatedAt || 0, dirty: false }); imgCache.set(id, d.dataUrl); return d.dataUrl; }
      } catch (e) { /* 오프라인 */ }
    }
    return null;
  };
  // 컨테이너 안의 <img data-img> 에 실제 그림을 채웁니다.
  M.hydrate = (container) => {
    container.querySelectorAll('img[data-img]').forEach(async (im) => {
      if (im.getAttribute('src')) return;
      im.alt = '사진 불러오는 중…';
      const u = await M.imageURL(im.getAttribute('data-img'));
      if (u) { im.src = u; im.alt = ''; } else im.alt = '사진을 불러오지 못했습니다 (다른 기기에서 아직 올라가지 않았거나 오프라인)';
    });
  };

  /* ---------- Firestore 동기화 ---------- */
  let pushTimer = null, unsub = null, pushing = false;
  const ready = () => { const S = SM.sync && SM.sync.S; return S && S.fb && S.user ? S : null; };
  function schedulePush() { clearTimeout(pushTimer); pushTimer = setTimeout(pushDirty, 1200); }
  async function pushDirty() {
    const S = ready();
    if (!S || pushing) return;
    pushing = true;
    const { fs, db } = S.fb;
    try {
      for (const n of await idbAll('notes')) {
        if (!n.dirty) continue;
        await fs.setDoc(fs.doc(db, 'users', S.user.uid, 'notes', n.key), { html: n.html || '', deleted: !!n.deleted, updatedAt: n.updatedAt });
        await idbPut('notes', Object.assign({}, n, { dirty: false }));
      }
      for (const im of await idbAll('images')) {
        if (!im.dirty) continue;
        await fs.setDoc(fs.doc(db, 'users', S.user.uid, 'images', im.id), { dataUrl: im.dataUrl, updatedAt: im.updatedAt });
        await idbPut('images', Object.assign({}, im, { dirty: false }));
      }
    } catch (e) { console.error('media push', e); }
    pushing = false;
  }
  M.pushDirty = pushDirty;
  M.onLogin = () => {
    const S = ready();
    if (!S) return;
    if (unsub) unsub();
    const { fs, db } = S.fb;
    unsub = fs.onSnapshot(fs.collection(db, 'users', S.user.uid, 'notes'), async (snap) => {
      let changed = false;
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        const d = ch.doc.data(), key = ch.doc.id;
        const local = await idbGet('notes', key);
        if (local && local.updatedAt >= (d.updatedAt || 0)) continue;
        const rec = { key, html: d.html || '', deleted: !!d.deleted, updatedAt: d.updatedAt || 0, dirty: false };
        await idbPut('notes', rec);
        hooks.index(key, rec.deleted ? null : idxEntry(rec), true);
        changed = true;
      }
      if (changed) hooks.refresh();
    }, (e) => console.error('notes snapshot', e));
    pushDirty();
  };
  M.onLogout = () => { if (unsub) { unsub(); unsub = null; } };

  /* ---------- 백업 / 정리 ---------- */
  M.exportAll = async (withImages) => {
    const notes = (await idbAll('notes')).filter((n) => !n.deleted).map((n) => ({ key: n.key, html: n.html, updatedAt: n.updatedAt }));
    const images = withImages ? (await idbAll('images')).map((i) => ({ id: i.id, dataUrl: i.dataUrl, updatedAt: i.updatedAt })) : [];
    // 다른 기기에만 있는 사진도 가능한 만큼 가져옵니다
    if (withImages) {
      const have = new Set(images.map((i) => i.id));
      for (const n of notes) for (const id of imageIds(n.html)) if (!have.has(id)) { const u = await M.imageURL(id); if (u) { images.push({ id, dataUrl: u, updatedAt: 0 }); have.add(id); } }
    }
    return { notes, images };
  };
  M.importAll = async (data) => {
    let n = 0, im = 0;
    for (const x of (data && data.notes) || []) {
      if (!x.key) continue;
      const clean = sanitize(x.html);
      const rec = { key: String(x.key), html: clean, updatedAt: Date.now(), dirty: true };
      await idbPut('notes', rec); hooks.index(rec.key, idxEntry(rec), false); n++;
    }
    for (const x of (data && data.images) || []) {
      if (!x.id || typeof x.dataUrl !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(x.dataUrl)) continue;
      await idbPut('images', { id: String(x.id), dataUrl: x.dataUrl, updatedAt: Date.now(), dirty: true }); imgCache.set(x.id, x.dataUrl); im++;
    }
    schedulePush();
    return { n, im };
  };
  M.gcImages = async () => {
    const used = new Set();
    for (const n of await idbAll('notes')) if (!n.deleted) imageIds(n.html).forEach((id) => used.add(id));
    let removed = 0;
    const S = ready();
    for (const im of await idbAll('images')) {
      if (used.has(im.id)) continue;
      await idbDel('images', im.id); imgCache.delete(im.id); removed++;
      if (S) { try { await S.fb.fs.deleteDoc(S.fb.fs.doc(S.fb.db, 'users', S.user.uid, 'images', im.id)); } catch (e) { /* ignore */ } }
    }
    return removed;
  };
  M.wipeLocal = async () => { await idbClear(); imgCache.clear(); };
  M.counts = async () => ({ notes: (await idbAll('notes')).filter((n) => !n.deleted).length, images: (await idbAll('images')).length });
})(typeof globalThis !== 'undefined' ? globalThis : this);
