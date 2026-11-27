# data/ — 자동 수집 결과

`tools/collect.js`가 GitHub Actions에서 채우는 폴더입니다. 직접 고치지 마세요(`watchlist.json`만 직접 편집).

- `watchlist.json` 수집할 국내 종목 `{"stocks":[{"code":"015760","name":"한국전력"}]}`
- `prices/<코드>.csv` 일봉 시세 (공공데이터포털, 수정주가 아님)
- `dart/<코드>.json` 최근 공시, `fin/<코드>.json` 재무 요약 (DART)
- `news/<코드>.json` 뉴스 헤드라인 (네이버 검색 API)
- `status.json` 마지막 수집 결과(성공/오류)
