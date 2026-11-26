/* icons.js - 라인 아이콘 세트 (24x24, 선 스타일). SM.ic('이름') -> <svg> 문자열 */
(function (root) {
  'use strict';
  const SM = (root.SM = root.SM || {});
  const dot = (cx, cy, r = 1.1) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
  const P = {
    // 내비게이션
    home: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 9.8V19a1 1 0 0 0 1 1H10v-5.2h4V20h3.5a1 1 0 0 0 1-1V9.8"/>',
    stocks: '<polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/>',
    bars: '<line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="14"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><rect x="8" y="6" width="8" height="3.5" rx=".8"/>' + dot(8.5, 13.5) + dot(12, 13.5) + dot(15.5, 13.5) + dot(8.5, 17) + dot(12, 17) + dot(15.5, 17),
    lab: '<path d="M9.5 3.5h5"/><path d="M10.5 3.5v5.6L5 18.6a1.8 1.8 0 0 0 1.6 2.7h10.8a1.8 1.8 0 0 0 1.6-2.7l-5.5-9.5V3.5"/><path d="M7.8 15h8.4"/>',
    sliders: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2.3" fill="var(--card)"/><circle cx="15" cy="17" r="2.3" fill="var(--card)"/>',
    logo: '<polyline points="4 16.5 9.5 11 13 14.5 20 7.5"/><polyline points="15.5 7.5 20 7.5 20 12"/>',
    // 동작
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    x: '<line x1="6.5" y1="6.5" x2="17.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="6.5" y2="17.5"/>',
    check: '<polyline points="5 12.5 10 17.5 19 7"/>',
    edit: '<path d="M16.2 4.6a2.2 2.2 0 0 1 3.1 3.1L8.2 18.8 4 20l1.2-4.2Z"/><line x1="14.5" y1="6.3" x2="17.7" y2="9.5"/>',
    trash: '<line x1="4" y1="7" x2="20" y2="7"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/><line x1="10.2" y1="11" x2="10.2" y2="16.5"/><line x1="13.8" y1="11" x2="13.8" y2="16.5"/>',
    scissors: '<circle cx="6" cy="6.5" r="2.4"/><circle cx="6" cy="17.5" r="2.4"/><line x1="7.8" y1="8.1" x2="20" y2="17.5"/><line x1="7.8" y1="15.9" x2="20" y2="6.5"/>',
    undo: '<polyline points="9 14 4 9 9 4"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<polyline points="15 14 20 9 15 4"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    note: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8Z"/><polyline points="14 3.5 14 8 18.5 8"/><line x1="9" y1="12.5" x2="15" y2="12.5"/><line x1="9" y1="16" x2="13" y2="16"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.8" r="1.5"/><path d="m20.5 16-4.8-4.8L7 19.5"/>',
    camera: '<path d="M4 8.5a2 2 0 0 1 2-2h1.8l1.4-2h5.6l1.4 2H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><circle cx="12" cy="13" r="3.4"/>',
    more: dot(5.5, 12, 1.4) + dot(12, 12, 1.4) + dot(18.5, 12, 1.4),
    chevD: '<polyline points="6 9.5 12 15.5 18 9.5"/>',
    chevR: '<polyline points="9.5 6 15.5 12 9.5 18"/>',
    ext: '<path d="M14 4.5h5.5V10"/><line x1="19.5" y1="4.5" x2="11" y2="13"/><path d="M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    alert: '<path d="M10.4 4.5 3 17.6A1.9 1.9 0 0 0 4.7 20.4h14.6a1.9 1.9 0 0 0 1.7-2.8L13.6 4.5a1.9 1.9 0 0 0-3.2 0Z"/><line x1="12" y1="9.5" x2="12" y2="13.5"/>' + dot(12, 16.8, .9),
    info: '<circle cx="12" cy="12" r="8.5"/><line x1="12" y1="11" x2="12" y2="16"/>' + dot(12, 8, .9),
    bell: '<path d="M6.2 16.5V11a5.8 5.8 0 0 1 11.6 0v5.5l1.7 2H4.5Z"/><path d="M10 21a2.2 2.2 0 0 0 4 0"/>',
    download: '<line x1="12" y1="4" x2="12" y2="15"/><polyline points="7.5 11 12 15.5 16.5 11"/><line x1="5" y1="19.5" x2="19" y2="19.5"/>',
    bulb: '<path d="M9.5 18h5"/><path d="M10.5 21h3"/><path d="M12 3.5a5.8 5.8 0 0 0-3.4 10.5c.7.5 1.1 1.3 1.1 2.2v.3h4.6v-.3c0-.9.4-1.7 1.1-2.2A5.8 5.8 0 0 0 12 3.5Z"/>',
    pin: '<path d="M9 4.5h6l-.9 5.6 2.9 3V15H7v-1.9l2.9-3Z"/><line x1="12" y1="15" x2="12" y2="20.5"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><line x1="4" y1="10" x2="20" y2="10"/><line x1="8.5" y1="3.5" x2="8.5" y2="7"/><line x1="15.5" y1="3.5" x2="15.5" y2="7"/>',
    sort: '<line x1="8" y1="19.5" x2="8" y2="5"/><polyline points="4.5 8.5 8 5 11.5 8.5"/><line x1="16" y1="4.5" x2="16" y2="19"/><polyline points="12.5 15.5 16 19 19.5 15.5"/>',
    // 에디터
    alignL: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10.7" x2="14" y2="10.7"/><line x1="4" y1="15.3" x2="20" y2="15.3"/><line x1="4" y1="20" x2="14" y2="20"/>',
    alignC: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="10.7" x2="17" y2="10.7"/><line x1="4" y1="15.3" x2="20" y2="15.3"/><line x1="7" y1="20" x2="17" y2="20"/>',
    alignR: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="10.7" x2="20" y2="10.7"/><line x1="4" y1="15.3" x2="20" y2="15.3"/><line x1="10" y1="20" x2="20" y2="20"/>',
    alignJ: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="10.7" x2="20" y2="10.7"/><line x1="4" y1="15.3" x2="20" y2="15.3"/><line x1="4" y1="20" x2="20" y2="20"/>',
    list: '<line x1="9.5" y1="6" x2="20" y2="6"/><line x1="9.5" y1="12" x2="20" y2="12"/><line x1="9.5" y1="18" x2="20" y2="18"/>' + dot(4.8, 6, 1.2) + dot(4.8, 12, 1.2) + dot(4.8, 18, 1.2),
    listOl: '<line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><path d="M4 5.2 5.3 4.2V8"/><path d="M3.8 11.3a1.4 1.4 0 0 1 2.6.7c0 .9-1.2 1.3-2.6 2.5h2.8"/><path d="M3.8 16.6h2.6l-1.2 1.5a1.4 1.4 0 1 1-1.4 2"/>',
    indent: '<line x1="4" y1="5" x2="20" y2="5"/><line x1="12" y1="10" x2="20" y2="10"/><line x1="12" y1="14.5" x2="20" y2="14.5"/><line x1="4" y1="19.5" x2="20" y2="19.5"/><polyline points="4 9 8 12.3 4 15.6"/>',
    outdent: '<line x1="4" y1="5" x2="20" y2="5"/><line x1="12" y1="10" x2="20" y2="10"/><line x1="12" y1="14.5" x2="20" y2="14.5"/><line x1="4" y1="19.5" x2="20" y2="19.5"/><polyline points="8 9 4 12.3 8 15.6"/>',
    table: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="3.5" y1="14.5" x2="20.5" y2="14.5"/><line x1="9.5" y1="5" x2="9.5" y2="19"/>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"/>',
    eraser: '<path d="M20 20H10"/><path d="M5.6 14.6l9-9a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L11 17.8H8Z"/><line x1="11.5" y1="8.8" x2="16" y2="13.3"/>',
    template: '<rect x="3.5" y="4" width="17" height="5.5" rx="1.6"/><rect x="3.5" y="12.5" width="7" height="7.5" rx="1.6"/><rect x="13.5" y="12.5" width="7" height="7.5" rx="1.6"/>',
    highlighter: '<path d="M15.8 3.8 20.2 8.2 11 17.4H6.6v-4.4Z"/><line x1="13.4" y1="6.2" x2="17.8" y2="10.6"/><line x1="4" y1="21" x2="14" y2="21"/>',
    square: '<rect x="5" y="5" width="14" height="14" rx="3"/>',
    squareCheck: '<rect x="5" y="5" width="14" height="14" rx="3"/><polyline points="8.8 12.2 11.2 14.6 15.4 9.8"/>',
    printer: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2.2"/><rect x="7.5" y="14" width="9" height="6" rx="1.2" fill="var(--card)"/>',
    xmark: '<line x1="7" y1="7" x2="17" y2="17"/><line x1="17" y1="7" x2="7" y2="17"/>',
  };
  SM.ic = function (name, cls) {
    const body = P[name];
    if (!body) return '';
    return `<svg class="ic ic-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  };
  SM.icNames = Object.keys(P);
})(typeof globalThis !== 'undefined' ? globalThis : this);
