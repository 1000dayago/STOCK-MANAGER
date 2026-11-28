/* chart-stock.js - 종목 차트: 캔들 + 볼린저·이동평균 + 평단가선 + 외국인·기관·개인 수급(일별 막대 + 누적선) + 거래량
   - 위쪽 "순수 계산" 함수들은 화면 없이 테스트할 수 있습니다(봉 변환, 지표, 누적, 보이는 구간).
   - 아래쪽 SM.mountStockChart(...)가 캔버스에 그리고 드래그·핀치·휠·탭(십자선)을 처리합니다. 외부 라이브러리 없음. */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});

  /* ================= 순수 계산 ================= */
  const weekKey = (d) => { // 월요일 시작 주의 대표 날짜
    const t = Date.parse(d + 'T00:00:00Z'), dow = (new Date(t).getUTCDay() + 6) % 7;
    return new Date(t - dow * 86400000).toISOString().slice(0, 10);
  };
  const FK = ['frgn', 'inst', 'indiv'];

  // 일봉 데이터를 주봉('W')·월봉('M')으로 묶습니다. 수급은 기간 합계(전부 비면 null), 날짜는 그 기간의 마지막 거래일.
  function aggregateBars(data, tf) {
    if (tf !== 'W' && tf !== 'M') return data;
    const keyOf = tf === 'W' ? weekKey : (d) => d.slice(0, 7);
    const out = { d: [], o: [], h: [], l: [], c: [], v: [], hd: [], ld: [], hasVol: data.hasVol, flowUnit: data.flowUnit }; // hd/ld: 그 봉의 최고·최저가가 나온 실제 날짜
    for (const k of FK) out[k] = data[k] ? [] : null;
    let key = null;
    for (let i = 0; i < data.d.length; i++) {
      const k = keyOf(data.d[i]);
      if (k !== key) {
        key = k;
        out.d.push(data.d[i]); out.o.push(data.o[i]); out.h.push(data.h[i]); out.l.push(data.l[i]); out.c.push(data.c[i]); out.v.push(data.v[i] || 0); out.hd.push(data.d[i]); out.ld.push(data.d[i]);
        for (const f of FK) if (out[f]) out[f].push(data[f][i] == null ? null : data[f][i]);
      } else {
        const j = out.d.length - 1;
        out.d[j] = data.d[i]; if (data.h[i] > out.h[j]) { out.h[j] = data.h[i]; out.hd[j] = data.d[i]; } if (data.l[i] < out.l[j]) { out.l[j] = data.l[i]; out.ld[j] = data.d[i]; } out.c[j] = data.c[i]; out.v[j] += data.v[i] || 0;
        for (const f of FK) if (out[f] && data[f][i] != null) out[f][j] = (out[f][j] == null ? 0 : out[f][j]) + data[f][i];
      }
    }
    return out;
  }
  function sma(arr, n) {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) { sum += arr[i]; if (i >= n) sum -= arr[i - n]; if (i >= n - 1) out[i] = sum / n; }
    return out;
  }
  function bollinger(arr, n, k) { // 모집단 표준편차
    const mid = sma(arr, n), up = new Array(arr.length).fill(null), lo = new Array(arr.length).fill(null);
    for (let i = n - 1; i < arr.length; i++) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (arr[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n);
      up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd;
    }
    return { mid, up, lo };
  }
  // 보이는 구간: end(마지막 봉 위치)와 count(봉 개수)를 데이터 범위 안으로 맞춥니다.
  function windowRange(n, count, end) {
    const c = Math.max(Math.min(n, 5), Math.min(n, Math.round(count)));
    const e = Math.max(c - 1, Math.min(n - 1, end == null ? n - 1 : Math.round(end)));
    return { from: e - c + 1, to: e, count: c };
  }
  // from~to 구간의 누적합(빈 값은 0 취급). any=구간에 실제 값이 하나라도 있는지
  function cumulative(arr, from, to) {
    const out = []; let s = 0, any = false;
    for (let i = from; i <= to; i++) { if (arr && arr[i] != null) { s += arr[i]; any = true; } out.push(s); }
    return { cum: out, any };
  }
  // 개월 수를 봉 개수로(일봉 21일/월, 주봉 4.35주/월, 월봉 1개/월). 0이면 전체.
  function barsForMonths(tf, months, n) {
    if (!months) return n;
    return Math.max(5, Math.min(n, Math.round(months * (tf === 'W' ? 4.35 : tf === 'M' ? 1 : 21))));
  }
  function extremes(h, l, from, to) {
    let hi = from, lo = from;
    for (let i = from; i <= to; i++) { if (h[i] > h[hi]) hi = i; if (l[i] < l[lo]) lo = i; }
    return { hiIdx: hi, loIdx: lo };
  }
  function niceTicks(min, max, count) {
    const span = max - min || 1, raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag, step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  const fmtInt = (v) => Math.round(v).toLocaleString('ko-KR');
  const fmtPrice = (v) => (Math.abs(v) >= 100 ? fmtInt(v) : (+v.toFixed(2)).toString());
  // 수급·거래량의 짧은 표기: 주 단위 → K/M, 금액(원) 단위 → 억
  function fmtCompact(v, unit) {
    const a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (unit === 'krw') return sg + (a >= 1e8 ? (a / 1e8).toFixed(a >= 1e10 ? 0 : 1) + '억' : fmtInt(a / 1e4) + '만');
    if (a >= 1e6) return sg + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
    if (a >= 1e3) return sg + fmtInt(a / 1e3) + 'K';
    return sg + fmtInt(a);
  }
  const signed = (v, f) => (v > 0 ? '+' : '') + f(v);

  /* ---------- 분기 영업이익(실적) ---------- */
  const shiftYm = (ym, n) => { const [y, m] = ym.split('-').map(Number), t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
  const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  // 공시일을 모를 때의 추정: 분기 말 + 45일(1·2·3분기), 연간(사업보고서)은 + 90일
  function estimateFiled(ym) { return new Date(Date.parse(lastDay(ym) + 'T00:00:00Z') + (ym.endsWith('-12') ? 90 : 45) * 86400000).toISOString().slice(0, 10); }
  // 전년 동기 대비. 직전(전년) 값이 0 이하이면 % 대신 전환/지속으로 표시합니다.
  //  pct: 증가율(%) · turn_profit: 흑자전환 · turn_loss: 적자전환 · loss: 적자 지속(better=적자 축소 여부) · na: 전년 값 없음/0
  function yoyOf(cur, prev) {
    if (cur == null || prev == null || prev === 0) return { kind: 'na' };
    if (prev > 0) return cur >= 0 ? { kind: 'pct', pct: (cur / prev - 1) * 100 } : { kind: 'turn_loss' };
    return cur > 0 ? { kind: 'turn_profit' } : { kind: 'loss', better: cur > prev };
  }
  // quarters: [{ym, op, revenue, net, filed, derived}] (원 단위) → 화면용(억원, 이익률, 증가율, 막대를 그릴 날짜 at)
  function earningsSeries(quarters) {
    const list = (quarters || []).filter((q) => q && /^\d{4}-\d{2}$/.test(q.ym) && Number.isFinite(q.op)).slice().sort((a, b) => (a.ym < b.ym ? -1 : 1));
    const by = new Map(list.map((q) => [q.ym, q]));
    return list.map((q) => {
      const prev = by.get(shiftYm(q.ym, -12)), num = (v) => (Number.isFinite(v) ? v : null);
      const liab = num(q.liab), pl = prev ? num(prev.liab) : null, eq = num(q.equity);
      return Object.assign({}, q, {
        opEok: q.op / 1e8, margin: q.revenue > 0 ? (q.op / q.revenue) * 100 : null, yoy: yoyOf(q.op, prev && prev.op), filedEst: !q.filed, at: q.filed || estimateFiled(q.ym),
        dOpEok: prev && Number.isFinite(prev.op) ? (q.op - prev.op) / 1e8 : null, // 전년 동기 대비 영업이익 증감액(억원): 전년이 적자·0이어도 항상 계산됨
        liabEok: liab == null ? null : liab / 1e8, dLiabEok: liab != null && pl != null ? (liab - pl) / 1e8 : null,
        liabPct: liab != null && pl > 0 ? (liab / pl - 1) * 100 : null, debtRatio: liab != null && eq > 0 ? (liab / eq) * 100 : null, // 부채비율 = 부채 ÷ 자본
      });
    }).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }
  // raw(일봉 묶음)에서 date 이하의 날짜만 남김(모든 배열을 같은 길이로 자름)
  function cutRaw(raw, date) {
    let t = -1; for (let lo = 0, hi = raw.d.length - 1; lo <= hi;) { const mid = (lo + hi) >> 1; if (raw.d[mid] <= date) { t = mid; lo = mid + 1; } else hi = mid - 1; }
    const out = {}; for (const k of Object.keys(raw)) out[k] = Array.isArray(raw[k]) && raw[k].length === raw.d.length ? raw[k].slice(0, t + 1) : raw[k];
    return out;
  }
  const EVENT_COLORS = { 유: '#f97316', 무: '#16a34a', 감: '#dc2626', 분: '#6b7280', 합: '#7c3aed', CB: '#0891b2' };
  const escHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 사이클 매수 표시 글자: 사이클의 첫 매수는 "1", 두 번째부터 "1-2", "1-3"…
  const cycleLabel = (no, seq) => (seq > 1 ? `${no}-${seq}` : String(no));
  // 증감 패널의 세로 눈금. 두 계열(각각 값 배열)을 한 패널에 그릴 때의 위치 계산.
  //  mode 'zero'(0 맞춘 분리): 두 계열이 같은 0 높이를 공유하되 각자의 눈금을 씀 / 'same'(같은 눈금): 하나의 눈금
  //  반환: { z: 0의 위치(위에서부터 0~1), scale:[계열별 '1(패널 전체 높이)당 값'] } → y = z*H - v/scale*H 로 환산
  function chgScale(seriesList, mode) {
    const lists = (seriesList || []).map((a) => (a || []).filter(Number.isFinite)).filter((a) => a.length);
    if (!lists.length) return { z: 0.5, scale: [] };
    const pn = lists.map((a) => [Math.max(0, ...a), Math.max(0, ...a.map((v) => -v))]);
    const clamp = (z) => Math.min(0.85, Math.max(0.15, z));
    const fit = (z, [p, n]) => Math.max(p / z, n / (1 - z), 1e-9) * 1.08; // 위·아래 8% 여유
    if (mode === 'same') {
      const P = Math.max(...pn.map((x) => x[0])), N = Math.max(...pn.map((x) => x[1])), z = clamp(P + N > 0 ? P / (P + N) : 0.5), sc = fit(z, [P, N]);
      return { z, scale: lists.map(() => sc) };
    }
    // 0 위치 z를 정함: 계열마다 ‘패널을 얼마나 알차게 쓰는가’(실제 폭 ÷ 눈금 폭)를 구해, 가장 덜 쓰는 계열이 가장 커지는 z(maximin). 눈금은 계열마다 선형이라 모양이 왜곡되지 않음
    const eff = (z, [p, n]) => (p + n > 0 ? (p + n) / fit(z, [p, n]) : 1);
    let z = 0.5, best = -1;
    for (let k = 15; k <= 85; k++) { const zz = k / 100, e = Math.min(...pn.map((x) => eff(zz, x))); if (e > best + 1e-12) { best = e; z = zz; } }
    return { z, scale: pn.map((x) => fit(z, x)) };
  }
  // 기준 날짜까지 공시된(공시일이 그 날짜 이전인) 가장 최근 실적 — 미래 정보를 쓰지 않기 위함
  function earningsAsOf(series, date) { let r = null; for (const e of series || []) { if (e.at <= date) r = e; else break; } return r; }
  const fmtEok = (v) => (Math.abs(v) >= 10000 ? (v / 10000).toFixed(Math.abs(v) >= 100000 ? 0 : 1) + '조' : Math.round(v).toLocaleString('ko-KR') + '억');
  const yoyText = (y) => (y.kind === 'pct' ? `${y.pct > 0 ? '+' : ''}${y.pct.toFixed(Math.abs(y.pct) >= 100 ? 0 : 1)}%` : y.kind === 'turn_profit' ? '흑자전환' : y.kind === 'turn_loss' ? '적자전환' : y.kind === 'loss' ? (y.better ? '적자 축소' : '적자 확대') : '-');
  // 날짜 배열(오름차순)에서 date 이후 첫 위치. 마지막 날짜보다 뒤면 -1
  function firstIdxOnOrAfter(dates, date) { let lo = 0, hi = dates.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < date) lo = mid + 1; else hi = mid; } return lo < dates.length ? lo : -1; }

  Object.assign(SM, { cutRaw, cycleLabel, chgScale, earningsSeries, earningsAsOf, estimateFiled, yoyOf, chartFmtEok: fmtEok, chartYoyText: yoyText, chartFirstIdx: firstIdxOnOrAfter, aggregateBars, chartSma: sma, chartBollinger: bollinger, chartWindow: windowRange, chartCumulative: cumulative, chartBarsForMonths: barsForMonths, chartExtremes: extremes, chartNiceTicks: niceTicks, chartFmtCompact: fmtCompact });

  /* ================= 그리기 · 조작 ================= */
  if (typeof document === 'undefined') return;

  const MA_COLORS = ['#f59e0b', '#ec4899', '#65a30d', '#0d9488', '#0ea5e9', '#8b5cf6'];
  const WHO = [['frgn', '외국인', '#d946ef'], ['inst', '기관', '#f59e0b'], ['indiv', '개인', '#84cc16']];
  function theme() {
    const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
    return { text: g('--muted'), grid: g('--line'), up: g('--up'), down: g('--down'), fg: g('--fg'), accent: g('--accent'), bg: g('--card') };
  }

  // host: 캔버스를 넣을 div, readEl: 십자선 값 표시 영역, cfg: { ma:[5,20,..], bb:{on,n,k}, flow:true, vol:true, avg:null, lots:[{date,no}], full:false, onChange }
  function mountStockChart(host, readEl, cfg0) {
    const canvas = document.createElement('canvas');
    canvas.className = 'stockchart';
    canvas.style.touchAction = 'pan-y'; // 세로 스크롤은 페이지가, 가로 드래그·핀치는 차트가
    host.appendChild(canvas);
    const S = { raw: null, tf: 'D', bars: null, ind: null, count: 126, end: 0, cross: null, range: null, zoomSel: false, selRect: null, views: [], homeView: null, hits: [], events: [], reveal: null, rawFull: null, cfg: Object.assign({ ma: [5, 20, 60, 120], bb: { on: true, n: 20, k: 2 }, flow: true, vol: true, earn: true, chg: false, chgScale: 'zero', cycles: null, cycleTarget: 0, sells: [], showEvents: true, earnStep: false, avg: null, lots: [], full: false }, cfg0 || {}), geom: null, earn: null };

    function rebuild(keepWindow) {
      if (!S.raw) { S.bars = null; return; }
      S.bars = aggregateBars(S.raw, S.tf);
      const b = S.bars, n = b.d.length;
      S.ind = { ma: {}, bb: S.cfg.bb.on ? bollinger(b.c, S.cfg.bb.n, S.cfg.bb.k) : null, v5: sma(b.v, 5), v20: sma(b.v, 20) };
      for (const p of S.cfg.ma) S.ind.ma[p] = sma(b.c, p);
      if (!keepWindow) { S.end = n - 1; }
      const w = windowRange(n, S.count, S.end); S.count = w.count; S.end = w.to;
    }
    const hasFlow = () => !!(S.bars && FK.some((k) => S.bars[k]));
    function layout() {
      const full = S.cfg.full, main = full ? Math.max(300, Math.round(window.innerHeight * 0.42)) : 250, sub = full ? 92 : 80;
      const P = [{ k: 'main', h: main }];
      if (S.cfg.flow && hasFlow()) for (const [k, name, color] of WHO) if (S.bars[k]) P.push({ k, h: sub, name, color });
      if (S.cfg.vol && S.bars.hasVol !== false) P.push({ k: 'vol', h: sub });
      if (S.cfg.earn && S.earn && S.earn.length) P.push({ k: 'earn', h: sub + 34 });
      if (S.cfg.chg && S.earn && S.earn.length) P.push({ k: 'chg', h: sub + 54 });
      if (P.length > 1) P.splice(1, 0, { k: 'dates', h: 16 }); // 캔들 바로 아래에 날짜 줄(그 아래로 수급·거래량 패널)
      let y = 0; for (const p of P) { p.y = y; y += p.h; }
      return { P, H: y + 22 };
    }
    const idxToX = (g, i) => g.PL + (i - g.from + 0.5) * g.bw;

    function draw() {
      if (!S.bars) { const c = canvas.getContext('2d'); c.clearRect(0, 0, canvas.width, canvas.height); return; }
      const T = theme(), b = S.bars, n = b.d.length, dpr = window.devicePixelRatio || 1;
      const W = Math.max(280, host.clientWidth || 320), { P, H } = layout();
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); canvas.style.height = H + 'px'; canvas.style.width = W + 'px';
      const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const w = windowRange(n, S.count, S.end), from = w.from, to = w.to;
      const PL = 6, PR = 72, pw = W - PL - PR, bw = pw / w.count;
      const g = (S.geom = { W, H, PL, PR, pw, bw, from, to, P });
      const X = (i) => idxToX(g, i);
      ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.textBaseline = 'middle';
      const up = (i) => b.c[i] >= b.o[i];
      S.hits = []; // 눌러서 반응하는 표시(시뮬레이션 B·S 원)의 위치
      const tagBoxes = []; // 오른쪽 축의 태그 위치(눈금 글자와 겹치지 않게 피하는 데 사용)
      const label = (txt, x, y, fg, bg, sub) => { // 값 태그: 한 줄 또는 두 줄(sub)
        const h = sub ? 26 : 16, tw = Math.max(ctx.measureText(txt).width, sub ? ctx.measureText(sub).width : 0) + 8, top = Math.round(y - h / 2);
        ctx.fillStyle = bg; ctx.fillRect(x, top, Math.min(tw, W - x), h); ctx.fillStyle = fg; ctx.textAlign = 'left';
        if (sub) { ctx.fillText(txt, x + 4, top + 8); ctx.fillText(sub, x + 4, top + 19); } else ctx.fillText(txt, x + 4, top + 8);
        tagBoxes.push([top, top + h]);
      };
      const nearTag = (y) => tagBoxes.some(([a, b]) => y > a - 7 && y < b + 7);
      // 세로 격자 + x축 날짜
      const nx = W < 420 ? 4 : 6, xl = [];
      for (let k = 0; k < nx; k++) { const i = Math.round(from + (w.count - 1) * (k / (nx - 1 || 1))); xl.push(i); }
      ctx.strokeStyle = T.grid; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
      for (const i of xl) { const x = Math.round(X(i)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 22); ctx.stroke(); }
      ctx.globalAlpha = 1;
      for (const p of P) { ctx.strokeStyle = T.grid; ctx.beginPath(); ctx.moveTo(0, p.y + p.h - 0.5); ctx.lineTo(W, p.y + p.h - 0.5); ctx.stroke(); }
      ctx.fillStyle = T.text; ctx.textAlign = 'center';
      for (const i of xl) { const d = b.d[i]; ctx.fillText(S.tf === 'M' ? d.slice(2, 7).replace('-', '.') : d.slice(2).replace(/-/g, '.'), Math.min(W - 30, Math.max(30, X(i))), H - 10); }
      { const dp = P.find((p) => p.k === 'dates'); if (dp) { ctx.fillStyle = T.text; ctx.textAlign = 'center'; for (const i of xl) { const d = b.d[i]; ctx.fillText(S.tf === 'M' ? d.slice(2, 7).replace('-', '.') : d.slice(2).replace(/-/g, '.'), Math.min(W - 30, Math.max(30, X(i))), dp.y + dp.h / 2 + 0.5); } ctx.textAlign = 'left'; } }
      const lastClose = b.c[to], prevClose = to > 0 ? b.c[to - 1] : b.c[to];

      /* ---- 메인: 캔들 + 지표 ---- */
      const m = P[0], mt = 14, mb = 8, mh = m.h - mt - mb;
      let lo = Infinity, hi = -Infinity;
      for (let i = from; i <= to; i++) { if (b.l[i] < lo) lo = b.l[i]; if (b.h[i] > hi) hi = b.h[i]; }
      const addR = (arr) => { if (!arr) return; for (let i = from; i <= to; i++) if (arr[i] != null) { if (arr[i] < lo) lo = arr[i]; if (arr[i] > hi) hi = arr[i]; } };
      if (S.ind.bb) { addR(S.ind.bb.up); addR(S.ind.bb.lo); }
      for (const p of S.cfg.ma) addR(S.ind.ma[p]);
      if (S.cfg.avg) { lo = Math.min(lo, S.cfg.avg); hi = Math.max(hi, S.cfg.avg); }
      const pad = (hi - lo) * 0.06 || 1; lo -= pad; hi += pad;
      const Y = (v) => m.y + mt + ((hi - v) / (hi - lo)) * mh;
      ctx.strokeStyle = T.grid; ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.globalAlpha = 0.7;
      const priceTicks = niceTicks(lo, hi, 5);
      for (const v of priceTicks) { const y = Math.round(Y(v)) + 0.5; ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(W - PR, y); ctx.stroke(); }
      ctx.globalAlpha = 1;
      const line = (arr, color, lw, dash) => { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.setLineDash(dash || []); ctx.beginPath(); let on = false; for (let i = from; i <= to; i++) { if (arr[i] == null) { on = false; continue; } const x = X(i), y = Y(arr[i]); if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); } ctx.stroke(); ctx.setLineDash([]); };
      if (S.ind.bb) { // 밴드 안쪽을 옅게 칠하고 상·하한선, 중심선(점선)
        ctx.fillStyle = 'rgba(148,163,184,0.10)'; ctx.beginPath(); let started = false;
        for (let i = from; i <= to; i++) if (S.ind.bb.up[i] != null) { const x = X(i), y = Y(S.ind.bb.up[i]); if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y); }
        for (let i = to; i >= from; i--) if (S.ind.bb.lo[i] != null) ctx.lineTo(X(i), Y(S.ind.bb.lo[i]));
        ctx.closePath(); ctx.fill();
        line(S.ind.bb.up, 'rgba(148,163,184,0.9)', 1.6); line(S.ind.bb.lo, 'rgba(148,163,184,0.9)', 1.6); line(S.ind.bb.mid, 'rgba(148,163,184,0.7)', 1, [4, 3]);
      }
      // 재생 구간(S~E): 전체 높이에 옅은 음영 + 양 끝선, 위쪽에 S·E 깃발
      if (S.range) {
        const iS = firstIdxOnOrAfter(b.d, S.range.from), iE0 = firstIdxOnOrAfter(b.d, S.range.to), iE = iE0 < 0 ? n - 1 : iE0;
        if (iS >= 0 && iE >= from && iS <= to) {
          const x0 = Math.max(PL, X(Math.max(iS, from)) - bw / 2), x1 = Math.min(W - PR, X(Math.min(iE, to)) + bw / 2);
          ctx.fillStyle = 'rgba(37,99,235,0.09)'; ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H - 22);
          ctx.lineWidth = 1.5;
          const flag = (x, label, col, left) => { ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H - 22); ctx.stroke(); const fx = left ? x : x - 18; ctx.fillStyle = col; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(fx, m.y + 38, 18, 15, 3); else ctx.rect(fx, m.y + 38, 18, 15); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, fx + 9, m.y + 46); ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'left'; };
          if (iS >= from) flag(X(iS) - bw / 2, 'S', '#16a34a', true);
          if (iE <= to) flag(X(iE) + bw / 2, 'E', '#ea580c', false);
        }
      }
      // 캔들(봉이 너무 촘촘하면 종가선)
      if (bw >= 1.3) {
        for (let i = from; i <= to; i++) {
          const x = X(i), col = up(i) ? T.up : T.down, bwid = Math.max(1, Math.min(14, bw * 0.7));
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, Y(b.h[i])); ctx.lineTo(Math.round(x) + 0.5, Y(b.l[i])); ctx.stroke();
          const yo = Y(b.o[i]), yc = Y(b.c[i]); ctx.fillRect(x - bwid / 2, Math.min(yo, yc), bwid, Math.max(1, Math.abs(yo - yc)));
        }
      } else {
        ctx.strokeStyle = T.fg; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let i = from; i <= to; i++) { const x = X(i), y = Y(b.c[i]); if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
        ctx.stroke();
      }
      S.cfg.ma.forEach((p, k) => line(S.ind.ma[p], MA_COLORS[k % MA_COLORS.length], p >= 20 ? 1.6 : 1.1));
      // 매수 순번 표시(보유 중인 순번의 매수일)
      for (const lt of S.cfg.lots || []) {
        let i = b.d.findIndex((d) => d >= lt.date); if (i < 0 || i < from || i > to) continue;
        const x = X(i), y = Y(b.l[i]) + 11; ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.fill(); // 매수: 파란 원 안에 B, 아래에 순번
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('B', x, y + 0.5);
        ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.fillStyle = T.fg; ctx.fillText(String(lt.no), x, y + 17); ctx.textAlign = 'left';
      }
      // 시뮬레이션 사이클: 사이클 구간 띠 · 평단·목표가 계단선 · 매수 ▲(사이클-순번) · 전량 매도 ▼
      for (const cy of (S.reveal ? SM.cyclesAsOf(S.cfg.cycles || [], S.reveal) : S.cfg.cycles) || []) {
        const iS = firstIdxOnOrAfter(b.d, cy.startDate), iE = cy.endDate ? firstIdxOnOrAfter(b.d, cy.endDate) : -1, iEnd = iE < 0 ? n - 1 : iE;
        if (iS < 0 || iEnd < from || iS > to) continue;
        const xs = Math.max(PL, X(Math.max(iS, from)) - bw / 2), xe = Math.min(W - PR, X(Math.min(iEnd, to)) + bw / 2), tint = cy.no % 2 ? '37,99,235' : '217,119,6';
        ctx.fillStyle = `rgba(${tint},0.07)`; ctx.fillRect(xs, m.y + mt, Math.max(2, xe - xs), mh);
        ctx.fillStyle = `rgba(${tint},0.9)`; ctx.textAlign = 'left'; ctx.fillText(`${cy.no}사이클${cy.open ? '(진행 중)' : ''}`, Math.max(PL + 2, xs + 2), m.y + mt + 8);
        const bs = cy.buys || [];
        ctx.save(); ctx.beginPath(); ctx.rect(PL, m.y, pw, m.h); ctx.clip();
        bs.forEach((bu, k) => { // 평단(주황 실선)과 목표가(초록 점선)는 다음 매수(또는 매도) 전까지 유지
          const i0 = firstIdxOnOrAfter(b.d, bu.date), i1 = k + 1 < bs.length ? firstIdxOnOrAfter(b.d, bs[k + 1].date) : iEnd;
          if (i0 < 0) return; const x0 = X(i0), x1 = X(i1 < 0 ? n - 1 : i1);
          ctx.strokeStyle = '#d97706'; ctx.lineWidth = 1.4; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(x0, Y(bu.avg)); ctx.lineTo(x1, Y(bu.avg)); if (k + 1 < bs.length) ctx.lineTo(x1, Y(bs[k + 1].avg)); ctx.stroke();
          if (S.cfg.cycleTarget > 0) { ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); const ty = Y(bu.avg * (1 + S.cfg.cycleTarget / 100)); ctx.beginPath(); ctx.moveTo(x0, ty); ctx.lineTo(x1, ty); ctx.stroke(); ctx.setLineDash([]); }
        });
        ctx.restore(); ctx.setLineDash([]);
        for (const bu of bs) {
          const i = firstIdxOnOrAfter(b.d, bu.date); if (i < from || i > to) continue;
          const x = X(i), y = Y(b.l[i]) + 11; ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.fill(); // 매수: 파란 원 안에 B
          S.hits.push({ x, y, r: 10, no: cy.no, seq: bu.seq, kind: 'B' });
          ctx.fillStyle = '#fff'; ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('B', x, y + 0.5);
          ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.fillStyle = T.fg; ctx.fillText(cycleLabel(cy.no, bu.seq), x, y + 17); ctx.textAlign = 'left';
        }
        if (!cy.open && iE >= from && iE <= to) { // 전량 매도 ▼ + 수익률
          const x = X(iE), y = Y(b.h[iE]) - 11, good = (cy.ret || 0) >= 0; ctx.fillStyle = good ? T.up : T.down; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.fill(); // 매도: 원 안에 S(이익이면 상승색, 손실이면 하락색)
          S.hits.push({ x, y, r: 10, no: cy.no, seq: 0, kind: 'S' });
          ctx.fillStyle = '#fff'; ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('S', x, y + 0.5); ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.fillStyle = good ? T.up : T.down;
          ctx.fillText(`${cy.no}✓${cy.ret != null ? ' ' + (cy.ret >= 0 ? '+' : '') + (cy.ret * 100).toFixed(1) + '%' : ''}`, Math.min(W - PR - 24, Math.max(PL + 24, x)), y - 17); ctx.textAlign = 'left';
        }
      }
      // 종목 화면의 매도 기록: 매도일 캔들 위에 S 원(손익률, 이익이면 상승색·손실이면 하락색). 같은 봉의 여러 매도는 합산
      if ((S.cfg.sells || []).length) {
        const byBar = new Map();
        for (const sl of S.cfg.sells) { const i = firstIdxOnOrAfter(b.d, sl.date); if (i < from || i > to) continue; const o = byBar.get(i) || { pnl: 0, cost: 0, qty: 0 }; o.pnl += sl.pnl || 0; o.cost += sl.cost || 0; o.qty += sl.qty || 0; byBar.set(i, o); }
        for (const [i, o] of byBar) {
          const x = X(i), y = Y(b.h[i]) - 11, good = o.pnl >= 0, ret = o.cost > 0 ? o.pnl / o.cost : null;
          ctx.fillStyle = good ? T.up : T.down; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('S', x, y + 0.5);
          if (ret != null) { ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.fillStyle = good ? T.up : T.down; ctx.fillText((ret >= 0 ? '+' : '') + (ret * 100).toFixed(1) + '%', Math.min(W - PR - 20, Math.max(PL + 20, x)), y - 17); }
          ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'left';
        }
      }
      // 최고·최저 표시 (현재 종가 대비 %)
      const ex = extremes(b.h, b.l, from, to);
      const mark = (i, price, isHi) => {
        const x = X(i), y = Y(price), pct = ((lastClose - price) / price) * 100, day = (isHi ? b.hd : b.ld), txt = `${fmtPrice(price)} (${((day && day[i]) || b.d[i]).slice(2).replace(/-/g, '.')}) ${signed(+pct.toFixed(2), String)}%`;
        const tw = ctx.measureText(txt).width, right = x + tw + 14 < W - PR;
        ctx.fillStyle = isHi ? T.up : T.down; ctx.textAlign = right ? 'left' : 'right'; ctx.fillText(txt, right ? x + 10 : x - 10, y + (isHi ? -2 : 2));
        ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(right ? x + 8 : x - 8, y); ctx.stroke(); ctx.textAlign = 'left';
      };
      mark(ex.hiIdx, b.h[ex.hiIdx], true); mark(ex.loIdx, b.l[ex.loIdx], false);
      // 평단가선
      let avgY = null;
      if (S.cfg.avg) { avgY = Y(S.cfg.avg); ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 1.2; ctx.setLineDash([6, 3]); ctx.beginPath(); ctx.moveTo(PL, avgY); ctx.lineTo(W - PR, avgY); ctx.stroke(); ctx.setLineDash([]); }
      { // 현재(마지막 봉) 종가 태그, 평단 태그와 겹치면 서로 밀어냅니다
        let yc = Y(lastClose), ya = avgY, pc = prevClose ? ((lastClose - prevClose) / prevClose) * 100 : 0;
        if (ya != null && Math.abs(yc - ya) < 28) { if (yc <= ya) { yc = ya - 28; } else { yc = ya + 28; } }
        if (ya != null) label('평균단가', W - PR + 2, ya, '#fff', '#1d4ed8', fmtPrice(S.cfg.avg));
        label(fmtPrice(lastClose), W - PR + 2, yc, '#fff', pc >= 0 ? T.up : T.down, signed(+pc.toFixed(2), String) + '%');
      }
      ctx.fillStyle = T.text; ctx.textAlign = 'left';
      for (const v of priceTicks) { const y = Y(v); if (!nearTag(y)) ctx.fillText(fmtPrice(v), W - PR + 6, y); }
      // 범례(이동평균·볼린저)
      { let lx = PL + 2; ctx.textAlign = 'left'; const leg = (txt, c) => { ctx.fillStyle = c; ctx.fillRect(lx, m.y + 3, 10, 3); ctx.fillStyle = T.text; ctx.fillText(txt, lx + 13, m.y + 5); lx += 13 + ctx.measureText(txt).width + 8; };
        if (S.ind.bb) leg(`BB(${S.cfg.bb.n},${S.cfg.bb.k})`, 'rgba(148,163,184,0.95)'); S.cfg.ma.forEach((p, k) => leg(String(p), MA_COLORS[k % MA_COLORS.length])); }

      /* ---- 수급 패널: 일별 막대 + 누적선 ---- */
      const unit = b.flowUnit === 'krw' ? 'krw' : 'shares', unitTxt = unit === 'krw' ? '' : '';
      for (const p of P) {
        if (!WHO.some((x) => x[0] === p.k)) continue;
        const arr = b[p.k], ct = 15, cb = 6, ch = p.h - ct - cb, cu = cumulative(arr, from, to);
        ctx.fillStyle = p.color; ctx.fillRect(PL + 2, p.y + 4, 8, 8); ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.fillText(`${p.name} (누적순매수 · 일별)`, PL + 14, p.y + 8);
        if (!cu.any) { ctx.fillStyle = T.text; ctx.textAlign = 'center'; ctx.fillText('이 구간에는 수급 데이터가 없습니다', PL + pw / 2, p.y + p.h / 2 + 4); ctx.textAlign = 'left'; continue; }
        let cmin = Math.min(0, ...cu.cum), cmax = Math.max(0, ...cu.cum); if (cmin === cmax) cmax = cmin + 1;
        const cpad = (cmax - cmin) * 0.08; cmin -= cpad; cmax += cpad;
        const CY = (v) => p.y + ct + ((cmax - v) / (cmax - cmin)) * ch, zero = CY(0);
        let amax = 1; for (let i = from; i <= to; i++) if (arr[i] != null) amax = Math.max(amax, Math.abs(arr[i]));
        const bh = (v) => (Math.abs(v) / amax) * (ch * 0.45);
        // 없는 날 표시(옅은 회색 띠)
        ctx.fillStyle = 'rgba(148,163,184,0.10)'; for (let i = from; i <= to; i++) if (arr[i] == null) ctx.fillRect(X(i) - bw / 2, p.y + ct, Math.max(1, bw), ch);
        ctx.globalAlpha = 0.6;
        for (let i = from; i <= to; i++) { const v = arr[i]; if (v == null) continue; const x = X(i), h = Math.max(0.5, bh(v)); ctx.fillStyle = v >= 0 ? T.up : T.down; ctx.fillRect(x - Math.max(0.6, bw * 0.38), v >= 0 ? zero - h : zero, Math.max(1, bw * 0.76), h); }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = T.grid; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(PL, Math.round(zero) + 0.5); ctx.lineTo(W - PR, Math.round(zero) + 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = p.color; ctx.lineWidth = 1.8; ctx.beginPath(); cu.cum.forEach((v, k) => { const x = X(from + k), y = CY(v); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
        const lastCum = cu.cum[cu.cum.length - 1], ty = Math.min(p.y + p.h - 10, Math.max(p.y + 22, CY(lastCum)));
        label(fmtCompact(lastCum, unit), W - PR + 2, ty, '#fff', p.color);
        ctx.fillStyle = T.text; ctx.textAlign = 'left';
        for (const v of niceTicks(cmin, cmax, 2)) { const y = CY(v); if (nearTag(y) || y < p.y + 12 || y > p.y + p.h - 6) continue; ctx.fillText(Math.abs(v) < 1e-9 ? '0' : fmtCompact(v, unit), W - PR + 6, y); }
      }

      /* ---- 거래량 패널 ---- */
      const vp = P.find((p) => p.k === 'vol');
      if (vp) {
        const vt = 15, vb = 6, vh = vp.h - vt - vb; let vmax = 1; for (let i = from; i <= to; i++) vmax = Math.max(vmax, b.v[i] || 0);
        const VY = (v) => vp.y + vt + (1 - v / vmax) * vh;
        ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.fillText('거래량', PL + 2, vp.y + 8);
        ctx.fillStyle = '#0ea5e9'; ctx.fillRect(PL + 44, vp.y + 7, 10, 3); ctx.fillStyle = T.text; ctx.fillText('5', PL + 57, vp.y + 8);
        ctx.fillStyle = '#ec4899'; ctx.fillRect(PL + 70, vp.y + 7, 10, 3); ctx.fillStyle = T.text; ctx.fillText('20', PL + 83, vp.y + 8);
        ctx.globalAlpha = 0.65;
        for (let i = from; i <= to; i++) { const v = b.v[i] || 0; ctx.fillStyle = i > 0 && b.c[i] < b.c[i - 1] ? T.down : T.up; const y = VY(v); ctx.fillRect(X(i) - Math.max(0.6, bw * 0.38), y, Math.max(1, bw * 0.76), vp.y + vt + vh - y); }
        ctx.globalAlpha = 1;
        const vline = (arr, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); let on = false; for (let i = from; i <= to; i++) { if (arr[i] == null) { on = false; continue; } const x = X(i), y = VY(arr[i]); if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y); } ctx.stroke(); };
        vline(S.ind.v5, '#0ea5e9'); vline(S.ind.v20, '#ec4899');
        ctx.fillStyle = T.text; ctx.textAlign = 'left';
        const vy = Math.min(vp.y + vp.h - 10, Math.max(vp.y + 22, VY(b.v[to] || 0)));
        label(fmtCompact(b.v[to] || 0, 'shares'), W - PR + 2, vy, '#fff', '#64748b');
        ctx.fillStyle = T.text; ctx.textAlign = 'left';
        for (const v of niceTicks(0, vmax, 2)) { const y = VY(v); if (v > 0 && !nearTag(y) && y > vp.y + 12) ctx.fillText(fmtCompact(v, 'shares'), W - PR + 6, y); }
      }

      /* ---- 영업이익 패널: 분기 선그래프(공시일 위치의 점) + 전년 동기 대비 증가율 ---- */
      const ep = P.find((p) => p.k === 'earn');
      const visEarn = (S.earn || []).map((e) => ({ e, i: firstIdxOnOrAfter(b.d, e.at) })).filter((x) => x.i >= from && x.i <= to);
      if (ep) {
        const et = 26, eb = 8, eh = ep.h - et - eb;
        ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.fillText(S.cfg.earnStep ? '영업이익 (분기 · 공시일마다 갱신)' : '영업이익 (분기 · 공시일 위치)', PL + 2, ep.y + 8);
        if (!visEarn.length) { ctx.textAlign = 'center'; ctx.fillText('이 구간에는 공시된 분기 실적이 없습니다', PL + pw / 2, ep.y + ep.h / 2 + 4); ctx.textAlign = 'left'; }
        else {
          let emin = 0, emax = 0; for (const x of visEarn) { emin = Math.min(emin, x.e.opEok); emax = Math.max(emax, x.e.opEok); }
          if (emin === emax) emax = emin + 1;
          const rng = emax - emin; emax += rng * 0.42; if (emin < 0) emin -= rng * 0.42; // 점 위·아래에 글자 자리
          const EY = (v) => ep.y + et + ((emax - v) / (emax - emin)) * eh, zero = EY(0);
          ctx.strokeStyle = T.grid; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(PL, Math.round(zero) + 0.5); ctx.lineTo(W - PR, Math.round(zero) + 0.5); ctx.stroke(); ctx.setLineDash([]);
          const geomOf = (e, i) => { const x = X(i), y = EY(e.opEok); return { x, lx: Math.min(W - PR - 24, Math.max(PL + 24, x)), y, col: e.opEok >= 0 ? T.up : T.down }; };
          // 선: 공시일 위치의 점들을 잇습니다(창 밖의 이웃 점까지 이어 그려 선이 끊기지 않게, 패널 밖은 잘라냄). 계단형이면 다음 공시 전까지 직전 값을 유지
          const near = (S.earn || []).map((e) => ({ e, i: firstIdxOnOrAfter(b.d, e.at) })).filter((x) => x.i >= 0 && x.i >= from - 140 && x.i <= to + 140);
          ctx.save(); ctx.beginPath(); ctx.rect(PL, ep.y + 1, pw + 1, ep.h - 2); ctx.clip();
          ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
          near.forEach(({ e, i }, k) => { const g = geomOf(e, i); if (k === 0) ctx.moveTo(g.x, g.y); else if (S.cfg.earnStep) { const pg = geomOf(near[k - 1].e, near[k - 1].i); ctx.lineTo(g.x, pg.y); ctx.lineTo(g.x, g.y); } else ctx.lineTo(g.x, g.y); });
          if (S.cfg.earnStep && near.length) { const lg = geomOf(near[near.length - 1].e, near[near.length - 1].i); ctx.lineTo(W - PR, lg.y); } // 마지막 공시 값이 지금까지 유지
          ctx.stroke(); ctx.restore();
          for (const { e, i } of visEarn) { // 점: 흑자 빨강 · 적자 파랑, 공시일 추정이면 속이 빈 점
            const g = geomOf(e, i); ctx.beginPath(); ctx.arc(g.x, g.y, 4, 0, Math.PI * 2);
            if (e.filedEst) { ctx.fillStyle = T.bg; ctx.fill(); ctx.strokeStyle = g.col; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]); } else { ctx.fillStyle = g.col; ctx.fill(); ctx.strokeStyle = T.bg; ctx.lineWidth = 1.5; ctx.stroke(); }
          }
          let lastLabelX = 1e9; // 글자(금액·증가율): 가장 최근(오른쪽) 분기부터 배치하고, 너무 가까우면 건너뜀 → 최근 값은 항상 표시
          for (let k = visEarn.length - 1; k >= 0; k--) {
            const { e, i } = visEarn[k], g = geomOf(e, i);
            if (lastLabelX - g.lx < 46) continue;
            const pos = e.opEok >= 0, yy = SM.chartYoyText(e.yoy);
            ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = T.fg; ctx.fillText(fmtEok(e.opEok) + (e.derived ? '*' : ''), g.lx, pos ? g.y - 21 : g.y + 8);
            const yc = e.yoy.kind === 'pct' ? (e.yoy.pct >= 0 ? T.up : T.down) : e.yoy.kind === 'turn_profit' ? T.up : e.yoy.kind === 'turn_loss' ? T.down : e.yoy.kind === 'loss' ? (e.yoy.better ? T.up : T.down) : T.text;
            ctx.font = '10px -apple-system, "Noto Sans KR", sans-serif'; ctx.fillStyle = yc; if (yy !== '-') ctx.fillText(yy, g.lx, pos ? g.y - 9 : g.y + 19);
            ctx.fillStyle = T.text; ctx.textAlign = 'left'; ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif';
            lastLabelX = g.lx;
          }
          ctx.fillStyle = T.text; ctx.textAlign = 'left';
          for (const v of niceTicks(emin, emax, 2)) { const y = EY(v); if (y < ep.y + 12 || y > ep.y + ep.h - 6) continue; ctx.fillText(Math.abs(v) < 1e-9 ? '0' : fmtEok(v), W - PR + 6, y); }
        }
      }
      /* ---- 전년 동기 대비 증감 패널: 영업이익 증감액 · 부채 증감액(억원). 모든 분기를 선으로 잇고, 분리 모드에서는 0 높이를 맞춤 ---- */
      const cp = P.find((p) => p.k === 'chg');
      if (cp) {
        const ct = 26, cb = 8, ch = cp.h - ct - cb;
        const COP = '#7c3aed', CLB = '#0d9488', hasL = (S.earn || []).some((e) => e.dLiabEok != null);
        const ser = [{ key: 'dOpEok', name: '영업이익', col: COP, pct: (e) => (e.yoy.kind === 'pct' ? e.yoy.pct : null) }];
        if (hasL) ser.push({ key: 'dLiabEok', name: '부채', col: CLB, pct: (e) => e.liabPct });
        const near = (S.earn || []).map((e) => ({ e, i: firstIdxOnOrAfter(b.d, e.at) })).filter((x) => x.i >= 0 && x.i >= from - 140 && x.i <= to + 140);
        const vis = near.filter((x) => x.i >= from && x.i <= to);
        ctx.textAlign = 'left'; ctx.fillStyle = T.text; ctx.fillText('전년 동기 대비 증감(억원)', PL + 2, cp.y + 8);
        let lx = PL + 2 + ctx.measureText('전년 동기 대비 증감(억원)').width + 12;
        for (const sr of ser) { ctx.fillStyle = sr.col; ctx.fillRect(lx, cp.y + 7, 12, 3); ctx.fillStyle = T.text; ctx.fillText(sr.name + (S.cfg.chgScale === 'same' || ser.length < 2 ? '' : sr.key === 'dOpEok' ? ' (왼쪽)' : ' (오른쪽)'), lx + 16, cp.y + 8); lx += 20 + ctx.measureText(sr.name + ' (오른쪽)').width + 6; }
        const vals = ser.map((sr) => vis.map((x) => x.e[sr.key]).filter(Number.isFinite));
        if (!vis.length || !vals.some((a) => a.length)) { ctx.textAlign = 'center'; ctx.fillStyle = T.text; ctx.fillText('이 구간에는 비교할 분기 실적이 없습니다', PL + pw / 2, cp.y + cp.h / 2 + 4); ctx.textAlign = 'left'; }
        else {
          const sc = SM.chgScale(vals, S.cfg.chgScale), CY = (v, k) => cp.y + ct + (sc.z - v / sc.scale[k]) * ch, zero = CY(0, 0);
          ctx.strokeStyle = T.grid; ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(PL, Math.round(zero) + 0.5); ctx.lineTo(W - PR, Math.round(zero) + 0.5); ctx.stroke(); ctx.setLineDash([]);
          ser.forEach((sr, k) => {
            const pts = near.filter((x) => Number.isFinite(x.e[sr.key]));
            ctx.save(); ctx.beginPath(); ctx.rect(PL, cp.y + 1, pw + 1, cp.h - 2); ctx.clip();
            ctx.strokeStyle = sr.col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
            pts.forEach((x, j) => { const px = X(x.i), py = CY(x.e[sr.key], k); if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
            ctx.stroke(); ctx.restore();
            for (const x of vis) { const v = x.e[sr.key]; if (!Number.isFinite(v)) continue; ctx.beginPath(); ctx.arc(X(x.i), CY(v, k), 3.5, 0, Math.PI * 2); if (x.e.filedEst) { ctx.fillStyle = T.bg; ctx.fill(); ctx.strokeStyle = sr.col; ctx.lineWidth = 1.5; ctx.stroke(); } else { ctx.fillStyle = sr.col; ctx.fill(); ctx.strokeStyle = T.bg; ctx.lineWidth = 1.5; ctx.stroke(); } }
            // 글자: 오른쪽(최근) 분기부터. 영업이익은 점 위, 부채는 점 아래에 적어 서로 가리지 않게 함
            let lastX = 1e9; ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center';
            for (let j = vis.length - 1; j >= 0; j--) {
              const x = vis[j], v = x.e[sr.key]; if (!Number.isFinite(v)) continue;
              const lxp = Math.min(W - PR - 24, Math.max(PL + 24, X(x.i))); if (lastX - lxp < 50) continue;
              const py = CY(v, k), oy = ser.length > 1 && Number.isFinite(x.e[ser[1 - k].key]) ? CY(x.e[ser[1 - k].key], 1 - k) : null, above = oy == null ? k === 0 : py < oy || (py === oy && k === 0); ctx.fillStyle = sr.col; // 같은 분기에서 더 위에 있는 점은 글자를 위에, 아래 점은 아래에 적어 서로 가리지 않게 함
               ctx.fillText((v > 0 ? '+' : v < 0 ? '−' : '') + fmtEok(Math.abs(v)), lxp, py + (above ? -9 : 10));
              lastX = lxp;
            }
            ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif';
          });
          // 눈금: 영업이익(왼쪽 눈금)은 패널 안 왼쪽, 부채(오른쪽 눈금)는 오른쪽 여백. 같은 눈금이면 오른쪽 하나
          const tick = (k, v, xx, al, col) => { const y = CY(v, k); if (y < cp.y + 12 || y > cp.y + cp.h - 6) return; ctx.fillStyle = col; ctx.textAlign = al; ctx.fillText(Math.abs(v) < 1e-9 ? '0' : (v > 0 ? '+' : '−') + fmtEok(Math.abs(v)), xx, y); };
          const topV = (k) => sc.z * sc.scale[k], botV = (k) => -(1 - sc.z) * sc.scale[k];
          if (S.cfg.chgScale === 'same' || ser.length < 2) { tick(0, 0, W - PR + 6, 'left', T.text); tick(0, topV(0) * 0.85, W - PR + 6, 'left', T.text); tick(0, botV(0) * 0.85, W - PR + 6, 'left', T.text); }
          else { ser.forEach((sr, k) => { const xx = k === 0 ? PL + 2 : W - PR + 6, al = 'left'; tick(k, topV(k) * 0.85, xx, al, sr.col); tick(k, botV(k) * 0.85, xx, al, sr.col); }); tick(1, 0, W - PR + 6, 'left', T.text); }
          ctx.textAlign = 'left'; ctx.fillStyle = T.text;
        }
      }
      // 캔들 패널 아래쪽: 실적 공시일 표시(위를 향한 작은 삼각형). 영업이익 점과 같은 위치
      if (visEarn.length) for (const { e, i } of visEarn) { const x = X(i); ctx.fillStyle = e.filedEst ? 'rgba(148,163,184,0.9)' : (e.opEok >= 0 ? T.up : T.down); ctx.beginPath(); ctx.moveTo(x - 4, m.y + m.h - 2); ctx.lineTo(x + 4, m.y + m.h - 2); ctx.lineTo(x, m.y + m.h - 9); ctx.closePath(); ctx.fill(); }

      // 이슈 표시(유상증자 유 · 무상증자 무 · 감자 감 · 분할/병합 분 · 합병/분할 합 · CB/BW): 캔들 패널 아래쪽에 작은 글자 상자
      if (S.cfg.showEvents !== false && (S.events || []).length) {
        const byBar = new Map();
        for (const ev of S.events) { const i = firstIdxOnOrAfter(b.d, ev.date); if (i < from || i > to) continue; if (!byBar.has(i)) byBar.set(i, []); byBar.get(i).push(ev); }
        ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center';
        for (const [i, list] of byBar) list.forEach((ev, k) => {
          const w = ev.kind.length > 1 ? 24 : 17, x = Math.min(W - PR - w / 2, Math.max(PL + w / 2, X(i))), y = m.y + m.h - 30 - k * 17;
          ctx.fillStyle = EVENT_COLORS[ev.kind] || '#6b7280'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - 7, w, 14, 3); else ctx.rect(x - w / 2, y - 7, w, 14); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.fillText(ev.kind, x, y + 0.5);
        });
        ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'left';
      }

      /* ---- 십자선 ---- */
      if (S.cross != null && S.cross >= from && S.cross <= to) {
        const x = Math.round(X(S.cross)) + 0.5; ctx.strokeStyle = T.fg; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 22); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        // 끌어서 옮기는 손잡이(위쪽 원)와 날짜 칩: 이 선 근처를 잡고 좌우로 끌면 선이 따라 움직임
        const dtxt = b.d[S.cross].slice(2).replace(/-/g, '.'), cw = ctx.measureText(dtxt).width + 12, cx = Math.min(W - PR - cw / 2, Math.max(PL + cw / 2, x));
        ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(x, 9, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = 'bold 10px -apple-system, "Noto Sans KR", sans-serif'; ctx.fillText('◂▸', x, 9.5);
        ctx.fillStyle = '#2563eb'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(cx - cw / 2, 20, cw, 15, 4); else ctx.rect(cx - cw / 2, 20, cw, 15); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif'; ctx.fillText(dtxt, cx, 28); ctx.textAlign = 'left';
      }
      updateRead(S.cross != null && S.cross >= from && S.cross <= to ? S.cross : to, S.cross != null, from, to);
      if (S.cross != null && b.d[S.cross]) S.lastCrossDate = b.d[S.cross]; // 마우스가 차트를 벗어나 선이 사라져도 마지막으로 가리킨 날짜는 기억(S·E 지정 버튼용)
      if (S.selRect) { // 구간 확대 선택 사각형: 왼쪽 방향(파랑)=확대, 오른쪽 방향(초록)=원래 화면
        const xa = Math.min(S.selRect.x0, S.selRect.x1), xb = Math.max(S.selRect.x0, S.selRect.x1), zin = S.selRect.x1 > S.selRect.x0, col = zin ? '37,99,235' : '22,163,74';
        ctx.fillStyle = `rgba(${col},0.16)`; ctx.fillRect(xa, 0, xb - xa, H - 22); ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 1.5; ctx.strokeRect(xa + 0.5, 0.5, xb - xa, H - 23);
        ctx.fillStyle = `rgb(${col})`; ctx.font = 'bold 12px -apple-system, "Noto Sans KR", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(zin ? '이 구간 확대 ▸' : (S.homeView ? '◂ 원래 화면으로' : '(확대한 적 없음)'), (xa + xb) / 2, 14); ctx.textAlign = 'left'; ctx.font = '11px -apple-system, "Noto Sans KR", sans-serif';
      }
      canvas.style.touchAction = S.zoomSel || S.cross != null ? 'none' : 'pan-y'; canvas.style.cursor = S.zoomSel ? 'zoom-in' : ''; // 십자선이 있을 땐 터치를 모두 차트가 받아 끌기가 끊기지 않게, 없을 땐 세로 스크롤은 페이지가
    }

    function updateRead(i, pinned, from, to) {
      if (!readEl || !S.bars) return;
      const b = S.bars, unit = b.flowUnit === 'krw' ? 'krw' : 'shares', prev = i > 0 ? b.c[i - 1] : b.c[i], pc = prev ? ((b.c[i] - prev) / prev) * 100 : 0;
      const col = (v) => (v > 0 ? 'cr-up' : v < 0 ? 'cr-down' : '');
      let h = `<span class="cr-date">${b.d[i]}${pinned ? '' : ' (최근)'}</span> 시 <b>${fmtPrice(b.o[i])}</b> 고 <b>${fmtPrice(b.h[i])}</b> 저 <b>${fmtPrice(b.l[i])}</b> 종 <b class="${col(pc)}">${fmtPrice(b.c[i])}</b> <span class="${col(pc)}">${signed(+pc.toFixed(2), String)}%</span>`;
      if (b.hasVol !== false) h += ` · 거래량 <b>${fmtInt(b.v[i] || 0)}</b>`;
      if (hasFlow()) {
        h += '<br>' + WHO.filter(([k]) => b[k]).map(([k, name, color]) => {
          const cu = cumulative(b[k], from, i), v = b[k][i];
          return `<span class="cr-who" style="--c:${color}">${name}</span> <b class="${col(v)}">${v == null ? '-' : signed(v, (x) => fmtCompact(x, unit))}</b> <small>(누적 ${cu.any ? signed(cu.cum[cu.cum.length - 1], (x) => fmtCompact(x, unit)) : '-'})</small>`;
        }).join(' · ');
      }
      if (S.earn && S.earn.length && S.cfg.earn) {
        const e = earningsAsOf(S.earn, b.d[i]);
        h += '<br>' + (e ? `<span class="cr-who" style="--c:#64748b">실적</span> <b>${e.label || e.ym}</b> 영업이익 <b class="${e.opEok > 0 ? 'cr-up' : e.opEok < 0 ? 'cr-down' : ''}">${fmtEok(e.opEok)}</b> <small>(전년 동기 대비 <b>${SM.chartYoyText(e.yoy)}</b>${e.margin != null ? ' · 이익률 ' + e.margin.toFixed(1) + '%' : ''} · 공시 ${e.at}${e.filedEst ? ' 추정' : ''}${e.derived ? ' · 연간−3분기' : ''})</small>` : '<span class="muted">이 날짜 이전에 공시된 분기 실적이 없습니다.</span>');
      }
      if (S.earn && S.earn.length && S.cfg.chg) {
        const e = earningsAsOf(S.earn, b.d[i]), sg = (v) => (v == null ? '-' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtEok(Math.abs(v)));
        if (e) h += '<br>' + `<span class="cr-who" style="--c:#7c3aed">증감</span> 영업이익 <b class="${e.dOpEok > 0 ? 'cr-up' : e.dOpEok < 0 ? 'cr-down' : ''}">${sg(e.dOpEok)}</b>` + (e.dLiabEok != null ? ` · 부채 <b>${sg(e.dLiabEok)}</b>${e.liabPct != null ? ` (${e.liabPct > 0 ? '+' : ''}${e.liabPct.toFixed(1)}%)` : ''}${e.debtRatio != null ? ' · 부채비율 ' + e.debtRatio.toFixed(0) + '%' : ''}` : ' <small class="muted">· 부채 자료 없음</small>') + ` <small>(${e.label || e.ym} · 전년 동기 대비)</small>`;
      }
      if (S.cfg.showEvents !== false && (S.events || []).length) {
        const evs = S.events.filter((ev) => firstIdxOnOrAfter(b.d, ev.date) === i);
        if (evs.length) h += '<br>' + evs.map((ev) => `<span class="cr-who" style="--c:${EVENT_COLORS[ev.kind] || '#6b7280'}">${escHtml(ev.label || ev.kind)}</span> ${escHtml(ev.date)} <small>${escHtml(ev.title || '')}</small>`).join(' · ');
      }
      readEl.innerHTML = h;
    }

    /* ---- 조작: 드래그 이동 · 핀치/휠 확대 · 탭(터치)·호버(마우스) 십자선 ---- */
    const ptrs = new Map(); let pan = null, pinch = null, moved = false, dragCross = false, zsel = null;
    const xToIdx = (clientX) => { const r = canvas.getBoundingClientRect(), g = S.geom; if (!g) return null; return Math.max(g.from, Math.min(g.to, g.from + Math.floor((clientX - r.left - g.PL) / g.bw))); };
    const hitAt = (e) => { const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, pad = e.pointerType === 'mouse' ? 2 : 8; let best = null, bd = 1e9; for (const h of S.hits || []) { const d = Math.hypot(h.x - px, h.y - py); if (d <= h.r + pad && d < bd) { best = h; bd = d; } } return best; };
    const setWindow = (count, end) => { const n = S.bars.d.length, w = windowRange(n, count, end); S.count = w.count; S.end = w.to; draw(); if (S.cfg.onChange) S.cfg.onChange(); };
    canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // 우클릭 드래그를 확대·축소에 씀
    canvas.addEventListener('pointerdown', (e) => {
      if (!S.bars) return;
      canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = false;
      if (ptrs.size === 1 && (S.zoomSel || (e.pointerType === 'mouse' && (e.shiftKey || e.button === 2)))) { zsel = { x0: e.clientX }; moved = true; pan = null; return; } // 구간 확대 선택(버튼, Shift+드래그, 마우스 우클릭 드래그)
      if (ptrs.size === 1) pan = { x: e.clientX, end: S.end, count: S.count };
      if (ptrs.size === 1 && S.cross != null && S.geom && S.cross >= S.geom.from && S.cross <= S.geom.to) { // 십자선 근처를 잡으면 차트 이동 대신 선을 끌어 옮김
        const r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, mouse = e.pointerType === 'mouse'; // 마우스는 선이 호버를 따라다니므로 위쪽 손잡이를 잡을 때만, 터치는 선 근처 어디든
        if (Math.abs(px - idxToX(S.geom, S.cross)) <= (mouse ? 12 : 30) && (!mouse || py <= 28)) { dragCross = true; pan = null; moved = true; const i = xToIdx(e.clientX); if (i !== S.cross) { S.cross = i; draw(); } }
      }
      if (ptrs.size === 2) { const [a, c] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - c.x, a.y - c.y), count: S.count, end: S.end, anchor: S.geom ? anchorOf((a.x + c.x) / 2) : null }; pan = null; }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!S.bars || !S.geom) return;
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zsel && ptrs.size === 1) { const r = canvas.getBoundingClientRect(); S.selRect = { x0: zsel.x0 - r.left, x1: e.clientX - r.left }; draw(); return; }
      if (dragCross && ptrs.size === 1) { const i = xToIdx(e.clientX); if (i !== S.cross) { S.cross = i; draw(); } return; }
      if (pinch && ptrs.size === 2) { const [a, c] = [...ptrs.values()], d = Math.hypot(a.x - c.x, a.y - c.y); moved = true; if (pinch.d > 0) { const cnt = pinch.count * (pinch.d / Math.max(1, d)); if (pinch.anchor) zoomTo(pinch.anchor, cnt); else setWindow(cnt, pinch.end); } return; }
      if (pan && ptrs.size === 1) {
        const dx = e.clientX - pan.x;
        if (Math.abs(dx) > 5) moved = true;
        if (moved) { S.cross = null; setWindow(pan.count, pan.end - Math.round(dx / S.geom.bw)); }
        return;
      }
      if (e.pointerType === 'mouse' && !ptrs.size) { canvas.style.cursor = hitAt(e) && S.cfg.onMarkerClick ? 'pointer' : 'crosshair'; const i = xToIdx(e.clientX); if (i !== S.cross) { S.cross = i; draw(); } }
    });
    const finishZoom = (e) => { // 오른쪽→왼쪽으로 끌면 그 구간을 화면 가득, 왼쪽→오른쪽으로 끌면 원래 보던 화면으로
      const dx = e.clientX - zsel.x0, x0 = zsel.x0; zsel = null; S.selRect = null;
      if (S.bars && Math.abs(dx) >= 14) {
        if (dx > 0) { const a = xToIdx(Math.min(x0, e.clientX)), b = xToIdx(Math.max(x0, e.clientX)); if (!S.homeView) S.homeView = { count: S.count, end: S.end }; setWindow(Math.max(8, b - a + 1), b); S.cross = null; } // 시작점에서 오른쪽으로 끌면 그 구간 확대
        else if (S.homeView) { const v = S.homeView; S.homeView = null; setWindow(v.count, v.end); S.cross = null; } // 왼쪽으로 끌면 원래 화면
      }
      S.zoomSel = false; if (S.cfg.onZoomDone) S.cfg.onZoomDone(); draw();
    };
    const up = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      if (zsel) { ptrs.delete(e.pointerId); finishZoom(e); if (!ptrs.size) { pan = null; dragCross = false; } return; }
      if (ptrs.size === 1 && !moved && S.bars) {
        const hit = hitAt(e);
        if (hit && S.cfg.onMarkerClick) S.cfg.onMarkerClick({ no: hit.no, seq: hit.seq, kind: hit.kind }); // B·S 원을 누르면 그 사이클을 펼쳐 보여 줌
        else { const i = xToIdx(e.clientX); S.cross = S.cross === i && e.pointerType !== 'mouse' ? null : i; draw(); }
      }
      ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { pan = null; dragCross = false; }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && S.cross != null && !ptrs.size) { S.cross = null; draw(); } });
    // 확대·축소: 커서(또는 두 손가락 중심) 아래에 있던 봉이 같은 자리에 그대로 있도록 창을 옮김
    const anchorOf = (clientX) => { const r = canvas.getBoundingClientRect(), g = S.geom; return { idx: g.from + (clientX - r.left - g.PL) / g.bw, pos: (clientX - r.left - g.PL) / g.bw, count: S.count }; };
    const zoomTo = (a, count) => {
      const n = S.bars.d.length, w0 = windowRange(n, count, S.end), n2 = w0.count; // 한계(최소·최대 봉 수)를 먼저 적용
      const from2 = a.idx - a.pos * (n2 / a.count); setWindow(n2, Math.round(from2 + n2 - 1));
    };
    canvas.addEventListener('wheel', (e) => {
      if (!S.bars || !S.geom) return;
      e.preventDefault();
      const a = anchorOf(e.clientX); zoomTo(a, S.count * (e.deltaY > 0 ? 1 / 1.18 : 1.18)); // 휠을 아래로 굴리면 확대, 위로 굴리면 축소
    }, { passive: false });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;
    if (ro) ro.observe(host);

    return {
      state: S,
      setData(raw) { S.rawFull = raw; S.raw = S.reveal ? cutRaw(raw, S.reveal) : raw; rebuild(false); draw(); },
      // 재생: date까지의 봉만 보이게(그 뒤는 숨김), null이면 전체. 창은 항상 마지막 봉을 따라감
      setReveal(date) { S.reveal = date || null; S.cross = null; if (S.rawFull) { S.raw = S.reveal ? cutRaw(S.rawFull, S.reveal) : S.rawFull; rebuild(false); draw(); } },
      setTf(tf) { // 보이는 기간(개월)은 유지한 채 봉 단위만 바꿉니다
        S.homeView = null;
        const per = (t) => (t === 'W' ? 4.35 : t === 'M' ? 1 : 21), months = S.count / per(S.tf);
        S.tf = tf; rebuild(false); const n = S.bars.d.length;
        const w = windowRange(n, Math.max(5, Math.round(months * per(tf))), n - 1); S.count = w.count; S.end = w.to; S.cross = null; draw();
      },
      setMonths(months) { if (!S.bars) return; S.homeView = null; S.count = barsForMonths(S.tf, months, S.bars.d.length); S.end = S.bars.d.length - 1; const w = windowRange(S.bars.d.length, S.count, S.end); S.count = w.count; S.end = w.to; S.cross = null; draw(); },
      setConfig(c) { Object.assign(S.cfg, c); rebuild(true); draw(); },
      setZoomMode(on) { S.zoomSel = !!on; S.selRect = null; draw(); },
      resetZoom() { if (S.homeView) { const v = S.homeView; S.homeView = null; setWindow(v.count, v.end); } },
      setRange(from, to) { S.range = from && to ? { from, to } : null; draw(); },
      setEvents(list) { S.events = (list || []).filter((x) => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.kind).slice().sort((a, b) => (a.date < b.date ? -1 : 1)); draw(); },
      // 날짜 구간(from~to)이 보이도록 창을 옮김(to가 없으면 그 날짜 하나를 가운데에 놓고 십자선 표시). 성공하면 true
      focusRange(from, to, opt) {
        if (!S.bars) return false;
        const b = S.bars, n = b.d.length; let iS = firstIdxOnOrAfter(b.d, from); if (iS < 0) iS = n - 1;
        let iE = to ? firstIdxOnOrAfter(b.d, to) : iS; if (iE < 0) iE = n - 1; if (iE < iS) iE = iS;
        const span = iE - iS + 1, want = to ? Math.round(span * 1.5) + 12 : Math.max(S.count, 40), count = Math.max(30, Math.min(n, (opt && opt.count) || want));
        const w = windowRange(n, count, Math.min(n - 1, Math.round((iS + iE) / 2 + count / 2)));
        S.count = w.count; S.end = w.to; S.cross = to ? null : iS; draw(); return true;
      },
      setEarnings(quarters) { S.earn = earningsSeries(quarters); draw(); },
      redraw() { draw(); },
      destroy() { if (ro) ro.disconnect(); canvas.remove(); },
    };
  }
  SM.mountStockChart = mountStockChart;
})(typeof globalThis !== 'undefined' ? globalThis : this);
