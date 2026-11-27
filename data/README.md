# data/ — 자동 수집 결과

`tools/collect.js`가 GitHub Actions에서 채우는 폴더입니다. 직접 고치지 마세요(`watchlist.json`만 직접 편집).

- `watchlist.json` 수집할 국내 종목 `{"stocks":[{"code":"015760","name":"한국전력"}]}`
- `prices/<코드>.csv` 일봉 시세 (공공데이터포털, 수정주가 아님)
- `flow/<코드>.csv` 외국인·기관·개인 순매수(단위: 주, 키 불필요). 네이버 모바일 증권(비공식 주소)에서 매번 최근 60거래일을 받아 날짜별로 이어 붙입니다. 수집을 쉰 기간은 비며, 형식이 바뀌면 수급 항목만 실패로 기록됩니다. 끄려면 `COLLECT_FLOW=0`
- `dart/<코드>.json` 최근 공시, `fin/<코드>.json` 재무 요약 (DART)
- `news/<코드>.json` 뉴스 헤드라인 (네이버 검색 API)
- `status.json` 마지막 수집 결과(성공/오류)
