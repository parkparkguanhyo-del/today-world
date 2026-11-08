// 나라별 최신 뉴스 제목과 링크를 GDELT에서 받아 data/news.json에 저장합니다.
// GitHub Actions가 1시간마다 실행합니다. 직접 실행: node scripts/fetch-news.mjs
//
// GDELT는 15분마다 전 세계 기사 목록 파일(GKG)을 공개합니다. 검색 API와 달리 요청 제한이 없어요.
// 최근 6시간치 파일을 받아, 기사에서 가장 많이 나온 나라를 그 기사의 나라로 정합니다.
// 데이터 출처: The GDELT Project (https://www.gdeltproject.org) — 출처 표시가 이용 조건입니다.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { COUNTRIES } = require('../countries.js');

const OUT = new URL('../data/news.json', import.meta.url);
const FILES = 24;          // 15분 x 24 = 최근 6시간
const PER_COUNTRY = 10;    // 나라마다 보여줄 기사 수
const KEEP_HOURS = 36;     // 새 기사가 적은 나라는 이 시간 안의 이전 기사를 유지
const UA = 'today-world-news-app (student project)';

const byFips = {};
COUNTRIES.forEach((c) => { byFips[c.fips] = c; });

function unzipFirst(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('zip 형식이 아님');
  const cd = buf.readUInt32LE(e + 16);
  const method = buf.readUInt16LE(cd + 10);
  const size = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + size);
  return method === 0 ? data : inflateRawSync(data);
}

function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`;
}
function seenOf(t) { return `${t.slice(0, 8)}T${t.slice(8, 14)}Z`; }

async function latestStamp() {
  const txt = await (await fetch('http://data.gdeltproject.org/gdeltv2/lastupdate.txt', { headers: { 'User-Agent': UA } })).text();
  const m = txt.match(/(\d{14})\.gkg\.csv\.zip/);
  if (!m) throw new Error('lastupdate.txt에서 파일 이름을 찾지 못함');
  const t = m[1];
  return new Date(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12)));
}

function parse(text, found) {
  for (const line of text.split('\n')) {
    const c = line.split('\t');
    if (c.length < 27) continue;
    const url = c[4];
    const title = (c[26].match(/<PAGE_TITLE>(.*?)<\/PAGE_TITLE>/) || [])[1];
    if (!/^https?:\/\//.test(url) || !title) continue;
    const counts = {};
    for (const loc of c[9].split(';')) {
      const code = loc.split('#')[2];
      if (code) counts[code] = (counts[code] || 0) + 1;
    }
    let best = null;
    for (const k of Object.keys(counts)) if (!best || counts[k] > counts[best]) best = k;
    const country = best && byFips[best];
    if (!country) continue;
    const t = decode(title);
    if (t.length < 20) continue;
    (found[country.id] = found[country.id] || []).push({ title: t, url, domain: c[3] || new URL(url).hostname, seen: seenOf(c[1]) });
  }
}

async function wikiPhoto(country) {
  try {
    const res = await fetch('https://ko.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(country.wiki), { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const j = await res.json();
    const thumb = j.thumbnail && j.thumbnail.source;
    const src = thumb ? thumb.replace(/\/\d+px-/, '/800px-') : (j.originalimage && j.originalimage.source);
    if (!src) return null;
    return { src, page: j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : '', title: j.title };
  } catch (e) {
    return null;
  }
}

function merge(fresh, old) {
  const cutoff = Date.now() - KEEP_HOURS * 3600000;
  const time = (a) => Date.parse(a.seen.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) || 0;
  const seenTitle = new Set();
  return fresh.concat(old || [])
    .filter((a) => time(a) >= cutoff)
    .sort((a, b) => time(b) - time(a))
    .filter((a) => { const k = a.title.toLowerCase(); if (seenTitle.has(k)) return false; seenTitle.add(k); return true; })
    .slice(0, PER_COUNTRY);
}

async function main() {
  let prev = { countries: {} };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch (e) { /* 처음 실행 */ }

  const last = await latestStamp();
  const found = {};
  let ok = 0;
  for (let i = 0; i < FILES; i++) {
    const t = stamp(new Date(last.getTime() - i * 15 * 60000));
    try {
      const res = await fetch(`http://data.gdeltproject.org/gdeltv2/${t}.gkg.csv.zip`, { headers: { 'User-Agent': UA } });
      if (!res.ok) { console.warn(`${t}: ${res.status}`); continue; }
      parse(unzipFirst(Buffer.from(await res.arrayBuffer())).toString('utf8'), found);
      ok++;
    } catch (e) {
      console.warn(`${t}: ${e.message}`);
    }
  }
  console.log(`파일 ${ok}/${FILES}개 처리`);

  const out = { updated: new Date().toISOString(), source: 'The GDELT Project', countries: {} };
  for (const c of COUNTRIES) {
    const old = (prev.countries && prev.countries[c.id]) || {};
    const articles = merge(found[c.id] || [], old.articles);
    const photo = old.photo || await wikiPhoto(c);
    out.countries[c.id] = { articles, photo: photo || null };
    console.log(`${c.name}: 새 기사 ${(found[c.id] || []).length}건, 보여줄 기사 ${articles.length}건`);
  }
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
