#!/usr/bin/env node
/* 새 버전을 낼 때 쓰는 도구.
   사용법:  node tools/bump-version.js 1.3.0 "바뀐 점 1" "바뀐 점 2"
   하는 일: version.json / version.js 갱신(변경 내용 이력 포함), index.html 의 스크립트 ?v= 갱신 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const [ver, ...notes] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(ver || '')) { console.error('사용법: node tools/bump-version.js 1.3.0 "변경 내용" ...'); process.exit(1); }
const jp = path.join(root, 'version.json');
const cur = JSON.parse(fs.readFileSync(jp, 'utf8'));
if (cur.history.some((h) => h.version === ver)) { console.error(`이미 있는 버전입니다: ${ver}`); process.exit(1); }
const d = new Date();
const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const next = { version: ver, date, history: [{ version: ver, date, notes: notes.length ? notes : ['개선'] }, ...cur.history] };
fs.writeFileSync(jp, JSON.stringify(next, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'version.js'), `/* 자동 생성: tools/bump-version.js */\n(function (r) { r.SM_APP = ${JSON.stringify(next)}; })(typeof self !== 'undefined' ? self : globalThis);\n`);
const ip = path.join(root, 'index.html');
let html = fs.readFileSync(ip, 'utf8');
html = html.replace(/(<script src="[^"?]+\.js)(\?v=[^"]*)?"/g, `$1?v=${ver}"`).replace(/(<link rel="stylesheet" href="style\.css)(\?v=[^"]*)?"/, `$1?v=${ver}"`);
fs.writeFileSync(ip, html);
console.log(`버전 ${ver} (${date}) 반영 완료. 커밋·푸시하면 배포됩니다.`);
