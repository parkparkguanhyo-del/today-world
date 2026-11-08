// 앱에 나오는 나라 목록입니다. 앱(app.js)과 뉴스 수집 스크립트(scripts/fetch-news.mjs)가 함께 씁니다.
// fips: GDELT가 쓰는 나라 코드(FIPS 10-4). 예: 한국 KS, 영국 UK, 베트남 VM
// wiki: 사진을 가져올 한국어 위키백과 문서 이름
// tz: 표준시 기준 시차(서머타임은 반영하지 않습니다)
// x, y: worldmap.svg 위의 위치(px)
const COUNTRIES = [
  { id: 'jp', name: '일본', region: '아시아', fips: 'JA', wiki: '도쿄', tz: 9, x: 335, y: 85 },
  { id: 'cn', name: '중국', region: '아시아', fips: 'CH', wiki: '베이징', tz: 8, x: 285, y: 76 },
  { id: 'tw', name: '대만', region: '아시아', fips: 'TW', wiki: '타이베이', tz: 8, x: 296, y: 108 },
  { id: 'mm', name: '미얀마', region: '아시아', fips: 'BM', wiki: '양곤', tz: 6.5, x: 241, y: 120 },
  { id: 'my', name: '말레이시아', region: '아시아', fips: 'MY', wiki: '쿠알라룸푸르', tz: 8, x: 253, y: 156 },
  { id: 'id', name: '인도네시아', region: '아시아', fips: 'ID', wiki: '자카르타', tz: 7, x: 264, y: 176 },
  { id: 'fr', name: '프랑스', region: '유럽', fips: 'FR', wiki: '파리', tz: 1, x: 38, y: 57 },
  { id: 'de', name: '독일', region: '유럽', fips: 'GM', wiki: '베를린', tz: 1, x: 62, y: 49 },
  { id: 'pl', name: '폴란드', region: '유럽', fips: 'PL', wiki: '바르샤바', tz: 1, x: 76, y: 54 },
  { id: 'it', name: '이탈리아', region: '유럽', fips: 'IT', wiki: '로마', tz: 1, x: 60, y: 72 },
  { id: 'ru', name: '러시아', region: '유럽', fips: 'RS', wiki: '모스크바', tz: 3, x: 114, y: 42 },
  { id: 'il', name: '이스라엘', region: '중동', fips: 'IS', wiki: '텔아비브', tz: 2, x: 109, y: 94 },
  { id: 'ir', name: '이란', region: '중동', fips: 'IR', wiki: '테헤란', tz: 3.5, x: 144, y: 85 },
  { id: 'us', name: '미국', region: '미주', fips: 'US', wiki: '뉴욕', tz: -5, x: 646, y: 78 },
  { id: 'uy', name: '우루과이', region: '미주', fips: 'UY', wiki: '몬테비데오', tz: -3, x: 691, y: 238 },
  { id: 'au', name: '호주', region: '오세아니아', fips: 'AS', wiki: '시드니', tz: 11, x: 347, y: 244 },
  { id: 'nz', name: '뉴질랜드', region: '오세아니아', fips: 'NZ', wiki: '오클랜드', tz: 13, x: 411, y: 252 }
];
const REGIONS = ['아시아', '유럽', '미주', '중동', '오세아니아'];

if (typeof module !== 'undefined') module.exports = { COUNTRIES, REGIONS };
