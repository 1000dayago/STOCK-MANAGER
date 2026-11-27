#!/usr/bin/env node
/* 앱의 “수집 대상 반영” 이슈를 읽어 data/watchlist.json 을 갱신합니다. (GitHub Actions: watchlist-issue.yml)
   - 이슈 본문의 ```json 블록만 읽고, 알려진 항목(종목코드 6자리·이름·기간)만 받아들입니다. 그 밖의 내용은 무시합니다.
   - 이슈 본문은 신뢰하지 않는 입력으로 다룹니다(워크플로가 소유자가 연 이슈만 넘기지만 여기서도 검증).
   - 비어 있거나 읽을 수 없으면 기존 목록을 그대로 둡니다. 외부 패키지 없음. */
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_STOCKS = 200;
const MARKER = '<!-- stock-manager:watchlist -->';
const isYmd = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(v));
const clampYears = (v) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(15, Math.max(1, x)) : null; };
const cleanName = (v, code) => { const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>`$\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40); return s || code; };

function extractJson(body) {
  const text = String(body || '');
  if (!text.includes(MARKER)) return { error: '이슈 본문에 앱이 만든 표시가 없습니다. 앱의 “수집 대상 반영” 버튼으로 연 이슈만 처리합니다.' };
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!m) return { error: '이슈 본문에서 목록(JSON)을 찾지 못했습니다.' };
  try { return { value: JSON.parse(m[1]) }; } catch (e) { return { error: '목록(JSON)을 읽지 못했습니다: ' + e.message.slice(0, 80) }; }
}

// existing: 현재 data/watchlist.json 내용(객체 또는 배열)
function applyWatchlist(body, existing) {
  const ex = Array.isArray(existing) ? { stocks: existing } : existing && typeof existing === 'object' ? existing : { stocks: [] };
  const exStocks = new Map((Array.isArray(ex.stocks) ? ex.stocks : []).filter((s) => s && /^[0-9A-Z]{6}$/.test(String(s.code))).map((s) => [String(s.code), s]));
  const ext = extractJson(body);
  if (ext.error) return { ok: false, error: ext.error };
  const req = ext.value;
  if (!req || typeof req !== 'object' || Array.isArray(req) || !Array.isArray(req.stocks)) return { ok: false, error: '목록 형식이 올바르지 않습니다. {"stocks":[…]} 모양이어야 합니다.' };
  if (req.stocks.length > MAX_STOCKS) return { ok: false, error: `종목이 너무 많습니다(최대 ${MAX_STOCKS}개).` };
  const out = { stocks: [] }, seen = new Set(), skipped = [];
  const years = req.years != null ? clampYears(req.years) : null;
  if (years) out.years = years;
  const from = isYmd(req.from) ? req.from : null, to = isYmd(req.to) ? req.to : null;
  if (from && to && from > to) return { ok: false, error: '시작일이 종료일보다 늦습니다.' };
  if (from) out.from = from;
  if (to) out.to = to;
  for (const s of req.stocks) {
    const code = String((s && s.code) || '').trim();
    if (!/^[0-9A-Z]{6}$/.test(code)) { skipped.push(String((s && (s.name || s.code)) || '?').slice(0, 20)); continue; }
    if (seen.has(code)) continue;
    seen.add(code);
    const prev = exStocks.get(code) || {};
    const item = { code, name: cleanName(s.name || prev.name, code) };
    // 종목별 기간은 이슈에 있으면 그것을, 없으면 기존 목록의 값을 유지
    const sy = s.years != null ? clampYears(s.years) : prev.years != null ? clampYears(prev.years) : null;
    const sf = isYmd(s.from) ? s.from : isYmd(prev.from) ? prev.from : null, st = isYmd(s.to) ? s.to : isYmd(prev.to) ? prev.to : null;
    if (sf && st && sf > st) return { ok: false, error: `${item.name}: 시작일이 종료일보다 늦습니다.` };
    if (sy) item.years = sy;
    if (sf) item.from = sf;
    if (st) item.to = st;
    out.stocks.push(item);
  }
  if (!out.stocks.length) return { ok: false, error: '반영할 국내 종목(6자리 코드)이 없어 기존 목록을 그대로 두었습니다.' };
  const nameOf = (c) => (out.stocks.find((x) => x.code === c) || exStocks.get(c) || { name: c }).name;
  const added = out.stocks.filter((s) => !exStocks.has(s.code)).map((s) => s.name);
  const removed = [...exStocks.keys()].filter((c) => !seen.has(c)).map(nameOf);
  const optsChanged = (ex.years || null) !== (out.years || null) || (ex.from || null) !== (out.from || null) || (ex.to || null) !== (out.to || null);
  return { ok: true, json: JSON.stringify(out, null, 2) + '\n', list: out, added, removed, skipped, optsChanged, kept: out.stocks.length - added.length };
}

function commentFor(r) {
  if (!r.ok) return `수집 대상 목록을 **반영하지 못했습니다.**\n\n- 이유: ${r.error}\n- 기존 목록은 그대로입니다.`;
  const range = r.list.from || r.list.to ? `${r.list.from || '(최근 ' + (r.list.years || 3) + '년 전부터)'} ~ ${r.list.to || '오늘'}` : `최근 ${r.list.years || 3}년`;
  return ['수집 대상 목록을 **반영했습니다.**', '', `- 대상 종목: ${r.list.stocks.length}개 (${r.list.stocks.map((s) => `${s.name} ${s.code}`).join(', ')})`,
    `- 새로 추가: ${r.added.length ? r.added.join(', ') : '없음'}`, `- 목록에서 빠짐: ${r.removed.length ? r.removed.join(', ') : '없음'}`, `- 수집 기간: ${range}`,
    ...(r.skipped.length ? [`- 제외된 항목(국내 6자리 코드가 아님): ${r.skipped.join(', ')}`] : []),
    '', '“자료 수집”을 바로 실행했습니다. 새 종목은 1~2분 뒤 `data/` 폴더와 앱의 자동 수집 카드에 나타납니다.'].join('\n');
}

function main() {
  const file = path.join(__dirname, '..', 'data', 'watchlist.json');
  let existing = { stocks: [] };
  try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* 없음 */ }
  const r = applyWatchlist(process.env.ISSUE_BODY || '', existing);
  if (r.ok) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, r.json); }
  const resultFile = process.env.RESULT_FILE || path.join(process.env.RUNNER_TEMP || '/tmp', 'watchlist-result.md');
  fs.writeFileSync(resultFile, commentFor(r) + '\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `ok=${r.ok ? 'true' : 'false'}\nresult_file=${resultFile}\n`);
  console.log(r.ok ? `반영: 종목 ${r.list.stocks.length}개 (추가 ${r.added.length}, 제외 ${r.removed.length})` : `반영 안 함: ${r.error}`);
}

if (require.main === module) main();
module.exports = { applyWatchlist, extractJson, commentFor, MARKER };
