/* sync.js - Firebase(Auth + Firestore) 동기화. 설정값이 없으면 아무것도 하지 않습니다. */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});
  const FB_VER = '10.12.2';
  const CFG_KEY = 'stockmgr.firebaseConfig';

  const S = {
    cfg: null, ready: false, user: null, status: 'off', msg: '', fb: null,
    unsub: null, pushTimer: null, applying: false, lastPushed: 0, getState: null, setState: null, onChange: null,
  };

  function loadCfg() {
    try { const t = localStorage.getItem(CFG_KEY); S.cfg = t ? JSON.parse(t) : null; } catch (e) { S.cfg = null; }
    return S.cfg;
  }
  // 콘솔에서 복사한 "const firebaseConfig = {...}" 또는 JSON/JS 객체 문자열을 모두 허용
  function parseConfigText(text) {
    let t = String(text || '').trim();
    const i = t.indexOf('{'), j = t.lastIndexOf('}');
    if (i < 0 || j < 0) throw new Error('{ } 로 둘러싸인 설정값을 붙여 넣어 주세요.');
    t = t.slice(i, j + 1);
    let obj;
    try { obj = JSON.parse(t); }
    catch (e) {
      const fixed = t.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
      obj = JSON.parse(fixed);
    }
    for (const k of ['apiKey', 'authDomain', 'projectId', 'appId']) if (!obj[k]) throw new Error(`설정값에 ${k} 가 없습니다.`);
    return obj;
  }
  function saveCfg(obj) { localStorage.setItem(CFG_KEY, JSON.stringify(obj)); S.cfg = obj; }
  function clearCfg() { localStorage.removeItem(CFG_KEY); S.cfg = null; }

  function setStatus(status, msg) {
    S.status = status; S.msg = msg || '';
    if (S.onChange) S.onChange();
  }

  async function init(hooks) {
    S.getState = hooks.getState; S.setState = hooks.setState; S.onChange = hooks.onChange;
    if (!loadCfg()) { setStatus('off', ''); return; }
    setStatus('connecting', '연결 중…');
    try {
      const base = `https://www.gstatic.com/firebasejs/${FB_VER}/`;
      const [app, auth, fs] = await Promise.all([
        import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js'),
      ]);
      const fbApp = app.initializeApp(S.cfg);
      const a = auth.getAuth(fbApp);
      const db = fs.getFirestore(fbApp);
      S.fb = { app, auth, fs, a, db };
      auth.onAuthStateChanged(a, (u) => onUser(u));
      try { await auth.getRedirectResult(a); } catch (e) { setStatus('error', loginMsg(e)); }
    } catch (e) {
      console.error(e);
      setStatus('error', '연결 실패: ' + (e.message || e) + ' (인터넷 연결과 설정값을 확인하세요)');
    }
  }

  function loginMsg(e) {
    const c = e && e.code || '';
    if (c.includes('unauthorized-domain')) return '이 주소가 Firebase "승인된 도메인"에 없습니다. Authentication > Settings > Authorized domains 에 이 사이트 주소(아이디.github.io)를 추가하세요.';
    if (c.includes('operation-not-allowed')) return '해당 로그인 방식이 Firebase에서 아직 켜져 있지 않습니다. Authentication > Sign-in method 를 확인하세요.';
    if (c.includes('wrong-password') || c.includes('invalid-credential')) return '이메일 또는 비밀번호가 올바르지 않습니다.';
    if (c.includes('email-already-in-use')) return '이미 가입된 이메일입니다. 로그인을 눌러 주세요.';
    if (c.includes('weak-password')) return '비밀번호는 6자 이상이어야 합니다.';
    if (c.includes('popup-closed') || c.includes('cancelled')) return '로그인 창이 닫혔습니다.';
    return '로그인 실패: ' + (e.message || e);
  }

  const docRef = () => S.fb.fs.doc(S.fb.db, 'users', S.user.uid, 'app', 'stock');

  async function onUser(u) {
    S.user = u;
    if (S.unsub) { S.unsub(); S.unsub = null; }
    if (!u) { setStatus('signedout', '로그인하면 기기 간 동기화가 켜집니다.'); return; }
    setStatus('syncing', '동기화 중…');
    try {
      const snap = await S.fb.fs.getDoc(docRef());
      const local = S.getState();
      const localHas = local.stocks.length > 0;
      if (!snap.exists()) {
        if (localHas) await push(true);
        else setStatus('synced', '동기화됨 (서버에 데이터가 아직 없습니다)');
      } else {
        const remote = JSON.parse(snap.data().json || '{}');
        const rHas = (remote.stocks || []).length > 0;
        if (!localHas) { applyRemote(remote); }
        else if (!rHas) { await push(true); }
        else if ((remote.updatedAt || 0) === (local.updatedAt || 0)) { setStatus('synced', '동기화됨'); }
        else {
          const rt = new Date(remote.updatedAt || 0).toLocaleString('ko-KR');
          const lt = new Date(local.updatedAt || 0).toLocaleString('ko-KR');
          const useRemote = confirm(
            `이 기기와 서버에 서로 다른 데이터가 있습니다.\n\n서버: 종목 ${remote.stocks.length}개 (수정 ${rt})\n이 기기: 종목 ${local.stocks.length}개 (수정 ${lt})\n\n[확인] 서버 데이터로 덮어쓰기\n[취소] 이 기기 데이터로 서버를 덮어쓰기\n\n※ 덮어써지는 쪽은 사라집니다. 불안하면 먼저 설정에서 백업을 내려받으세요.`
          );
          if (useRemote) applyRemote(remote); else await push(true);
        }
      }
      S.unsub = S.fb.fs.onSnapshot(docRef(), (s) => {
        if (!s.exists() || s.metadata.hasPendingWrites) return;
        const remote = JSON.parse(s.data().json || '{}');
        if ((remote.updatedAt || 0) > (S.getState().updatedAt || 0) && remote.updatedAt !== S.lastPushed) applyRemote(remote);
      }, (e) => setStatus('error', '동기화 오류: ' + e.message));
    } catch (e) {
      console.error(e);
      setStatus('error', '동기화 오류: ' + (e.message || e) + ' (Firestore 데이터베이스와 보안 규칙을 확인하세요)');
    }
  }

  function applyRemote(remote) {
    S.applying = true;
    S.setState(remote);
    S.applying = false;
    setStatus('synced', '서버 데이터를 불러왔습니다 · ' + new Date().toLocaleTimeString('ko-KR'));
  }

  async function push(now) {
    if (!S.user || !S.fb) return;
    const st = S.getState();
    try {
      setStatus('syncing', '저장 중…');
      S.lastPushed = st.updatedAt;
      await S.fb.fs.setDoc(docRef(), { json: JSON.stringify(st), updatedAt: st.updatedAt });
      setStatus('synced', '동기화됨 · ' + new Date().toLocaleTimeString('ko-KR'));
    } catch (e) {
      console.error(e);
      setStatus('error', '서버 저장 실패: ' + (e.message || e) + ' (이 기기에는 저장되어 있습니다)');
    }
  }
  function schedulePush() {
    if (S.applying || !S.user || !S.fb) return;
    clearTimeout(S.pushTimer);
    S.pushTimer = setTimeout(() => push(), 800);
  }

  async function signInGoogle() {
    const { auth, a } = S.fb;
    const provider = new auth.GoogleAuthProvider();
    try { await auth.signInWithPopup(a, provider); }
    catch (e) {
      const c = e.code || '';
      if (c.includes('popup-blocked') || c.includes('operation-not-supported') || c.includes('web-storage-unsupported')) {
        try { await auth.signInWithRedirect(a, provider); return; } catch (e2) { throw new Error(loginMsg(e2)); }
      }
      throw new Error(loginMsg(e));
    }
  }
  async function emailAuth(email, pw, create) {
    const { auth, a } = S.fb;
    try {
      if (create) await auth.createUserWithEmailAndPassword(a, email, pw);
      else await auth.signInWithEmailAndPassword(a, email, pw);
    } catch (e) { throw new Error(loginMsg(e)); }
  }
  async function signOut() { if (S.fb) await S.fb.auth.signOut(S.fb.a); }

  SM.sync = { S, init, schedulePush, push, parseConfigText, saveCfg, clearCfg, loadCfg, signInGoogle, emailAuth, signOut };
})(typeof globalThis !== 'undefined' ? globalThis : this);
