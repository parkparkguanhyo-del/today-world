// 나라별 최신 뉴스 제목과 링크를 GDELT에서 받아 data/news.json에 저장합니다.
// GitHub Actions가 1시간마다 실행합니다. 직접 실행: node scripts/fetch-news.mjs
// GDELT 무료 API는 5초에 한 번만 요청할 수 있어서 나라마다 12초씩 쉬어 갑니다.
// 데이터 출처: The GDELT Project (https://www.gdeltproject.org) — 출처 표시가 이용 조건입니다.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { COUNTRIES } = require('../countries.js');

const OUT = new URL('../data/news.json', import.meta.url);
const WAIT_MS = 12000;
const PER_COUNTRY = 10;
const UA = 'today-world-news-app (student project)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gdelt(country) {
  const query = `sourcecountry:${country.gdelt} sourcelang:english`;
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?mode=ArtList&format=json&sort=DateDesc&timespan=1d'
    + `&maxrecords=${PER_COUNTRY * 2}&query=${encodeURIComponent(query)}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const text = await res.text();
    if (text.trim().startsWith('{')) {
      const json = JSON.parse(text);
      const seen = new Set();
      return (json.articles || [])
        .filter((a) => /^https?:\/\//.test(a.url) && a.title)
        .filter((a) => { const k = a.title.trim().toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, PER_COUNTRY)
        .map((a) => ({ title: a.title.trim(), url: a.url, domain: a.domain || new URL(a.url).hostname, seen: a.seendate, lang: a.language || '' }));
    }
    console.warn(`  ${country.name}: 응답이 JSON이 아님 (${attempt}회째) ${text.slice(0, 80).replace(/\s+/g, ' ')}`);
    await sleep(WAIT_MS * 2 * attempt);
  }
  return null;
}

async function wikiPhoto(country) {
  try {
    const res = await fetch('https://ko.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(country.wiki), { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const j = await res.json();
    const src = (j.originalimage && j.originalimage.source) || (j.thumbnail && j.thumbnail.source);
    if (!src) return null;
    return { src: (j.thumbnail && j.thumbnail.source) ? j.thumbnail.source.replace(/\/\d+px-/, '/800px-') : src, page: j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : '', title: j.title };
  } catch (e) {
    return null;
  }
}

async function main() {
  let prev = { countries: {} };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch (e) { /* 처음 실행 */ }

  const out = { updated: new Date().toISOString(), source: 'The GDELT Project', countries: {} };
  for (const c of COUNTRIES) {
    const old = (prev.countries && prev.countries[c.id]) || {};
    const articles = await gdelt(c);
    const photo = old.photo || await wikiPhoto(c);
    out.countries[c.id] = {
      articles: articles && articles.length ? articles : (old.articles || []),
      photo: photo || null
    };
    console.log(`${c.name}: ${articles ? articles.length + '건' : '실패, 이전 데이터 유지'}`);
    await sleep(WAIT_MS);
  }
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
