// 나라별 최신 뉴스를 모아 data/news.json에 저장합니다. GitHub Actions가 2시간마다 실행합니다.
//
// 1. GDELT가 15분마다 공개하는 전 세계 기사 목록 파일(GKG)에서 최근 6시간치 기사 제목과 링크를 받아요.
//    기사에서 가장 많이 나온 나라를 그 기사의 나라로 정해요.
// 2. GEMINI_API_KEY가 있으면 구글 제미나이가 나라마다
//    정말 그 나라 소식인 기사만 고르고, 제목을 한국어로 번역하고, 제목만 보고 한 문장 설명을 써요.
//    마지막으로 오늘의 세계 요약(실시간 요약) 3개를 만들어요.
// 3. 나라 사진은 위키백과에서 가져와요(위키미디어 공용에 있는 자유 이용 사진만).
//
// 데이터 출처: The GDELT Project (https://www.gdeltproject.org) — 출처 표시가 이용 조건입니다.

import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { COUNTRIES, REGIONS } = require('../countries.js');

const OUT = new URL('../data/news.json', import.meta.url);
const FILES = 24;            // 15분 x 24 = 최근 6시간
const CANDIDATES = 30;       // 나라마다 AI에게 보여줄 후보 수
const PICK = 8;              // AI가 고를 최대 수
const PER_COUNTRY = 10;      // 앱에 보여줄 기사 수
const KEEP_HOURS = 36;       // 이전 기사를 유지하는 시간
const PHOTO_VERSION = 2;
const KEY = process.env.GEMINI_API_KEY || '';
const MODELS = (process.env.GEMINI_MODEL || 'gemini-flash-latest,gemini-2.5-flash').split(',').map((s) => s.trim()).filter(Boolean);
const REPO = process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : 'local';
const UA = `today-world-news-app/1.0 (${REPO})`;

const byFips = {};
COUNTRIES.forEach((c) => { byFips[c.fips] = c; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- GDELT ---------------- */
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
const seenOf = (t) => `${t.slice(0, 8)}T${t.slice(8, 14)}Z`;
const timeOf = (s) => Date.parse(String(s).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) || 0;
const SPAM = /\b(NYSE|NASDAQ|OTCMKTS|NYSEARCA|TSE:|ASX:|stock price|shares (sold|bought|acquired)|price target|position in|stake in|recipe|horoscope|lottery results|obituar)/i;

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
    const raw = (c[26].match(/<PAGE_TITLE>(.*?)<\/PAGE_TITLE>/) || [])[1];
    if (!/^https?:\/\//.test(url) || !raw) continue;
    const counts = {};
    let total = 0;
    for (const loc of c[9].split(';')) {
      const code = loc.split('#')[2];
      if (code) { counts[code] = (counts[code] || 0) + 1; total++; }
    }
    let best = null;
    for (const k of Object.keys(counts)) if (!best || counts[k] > counts[best]) best = k;
    const country = best && byFips[best];
    if (!country || counts[best] * 2 < total) continue;   // 그 나라가 기사 위치의 절반 이상일 때만
    const title = decode(raw);
    if (title.length < 25 || SPAM.test(title)) continue;
    (found[country.id] = found[country.id] || []).push({ title, url, domain: c[3] || new URL(url).hostname, seen: seenOf(c[1]) });
  }
}
async function collect() {
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
    } catch (e) { console.warn(`${t}: ${e.message}`); }
  }
  console.log(`GDELT 파일 ${ok}/${FILES}개 처리`);
  return found;
}
function dedupe(list) {
  const seenT = new Set(); const seenU = new Set();
  return list.filter((a) => {
    const k = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenT.has(k) || seenU.has(a.url)) return false;
    seenT.add(k); seenU.add(a.url); return true;
  });
}

/* ---------------- 제미나이 ---------------- */
async function gemini(prompt) {
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } })
      });
      if (res.ok) {
        const j = await res.json();
        const text = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts.map((p) => p.text || '').join('');
        try { return JSON.parse(text); } catch (e) { console.warn(`  ${model}: JSON 해석 실패`); }
      } else {
        const msg = (await res.text()).slice(0, 160).replace(/\s+/g, ' ');
        console.warn(`  ${model}: ${res.status} ${msg}`);
        if (res.status === 404 || res.status === 400 || res.status === 403) break;   // 다음 모델로
      }
      await sleep(15000 * attempt);
    }
  }
  return null;
}
const clean = (s) => String(s || '').replace(/·/g, ', ').replace(/\s+/g, ' ').trim();

async function curateRegion(region, cands) {
  const lines = [];
  for (const c of COUNTRIES.filter((x) => x.region === region)) {
    const list = cands[c.id] || [];
    if (!list.length) continue;
    lines.push(`## ${c.id} (${c.name})`);
    list.forEach((a, i) => lines.push(`${i}. ${a.title} [${a.domain}]`));
  }
  if (!lines.length) return {};
  const prompt = `너는 한국 뉴스 앱의 국제부 편집자야. 아래는 나라별 영어 기사 제목 후보야.
나라마다 다음을 해 줘.
1. 정말 그 나라에서 일어난 일이거나 그 나라가 중심인 뉴스만 고른다. 주가 시세, 투자 광고, 상품 홍보, 요리법, 운세, 연예 가십, 다른 나라가 중심인 기사는 뺀다. 같은 사건을 다룬 기사는 하나만 남긴다.
2. 한국 독자에게 중요한 순서로 최대 ${PICK}개를 고른다. 마땅한 기사가 없으면 빈 배열로 둔다.
3. 고른 기사의 제목을 자연스러운 한국어 뉴스 제목으로 번역한다. 인명과 지명은 한국 언론이 쓰는 표기를 따르고, 40자 안팎으로 간결하게 쓴다.
4. 제목에 담긴 내용만으로 무슨 일인지 쉬운 한국어 한 문장으로 설명한다. 제목에 없는 사실, 숫자, 원인은 절대 지어내지 않는다.
5. 가운뎃점(·)은 쓰지 않는다. 존댓말 대신 뉴스 문체(~했다, ~이다)로 쓴다.

JSON으로만 답한다. 형식: {"나라id": [{"i": 후보번호, "ko": "한국어 제목", "sum": "한 문장 설명"}]}

${lines.join('\n')}`;
  const out = await gemini(prompt);
  return out && typeof out === 'object' ? out : null;
}

async function briefing(countries) {
  const lines = [];
  for (const c of COUNTRIES) {
    (countries[c.id].articles || []).slice(0, 3).forEach((a, i) => { if (a.ko) lines.push(`${c.id}|${i}|${c.name}|${a.ko}`); });
  }
  if (lines.length < 3) return null;
  const prompt = `아래는 오늘 나라별 주요 뉴스 제목이야(형식: 나라id|번호|나라|제목).
한국 독자가 꼭 알아야 할 세계 소식 3개를 골라, 각각 제목 내용만으로 쉬운 한국어 한 문장(40자 안팎)으로 요약해 줘.
제목에 없는 사실은 지어내지 말고, 가운뎃점(·)은 쓰지 마. 뉴스 문체(~했다, ~이다)로 써.
JSON으로만 답해. 형식: [{"cid": "나라id", "i": 번호, "text": "요약 문장"}]

${lines.join('\n')}`;
  const out = await gemini(prompt);
  if (!Array.isArray(out)) return null;
  const items = out.filter((x) => x && countries[x.cid] && countries[x.cid].articles[x.i])
    .slice(0, 3)
    .map((x) => ({ cid: x.cid, url: countries[x.cid].articles[x.i].url, text: clean(x.text) }));
  return items.length ? { updated: new Date().toISOString(), items } : null;
}

/* ---------------- 사진 ---------------- */
async function pageImage(lang, title) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages|info&inprop=url&piprop=thumbnail|name&pithumbsize=960&titles=${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const p = ((await res.json()).query || {}).pages || [];
    const page = p[0];
    if (!page || page.missing || !page.thumbnail || !page.pageimage) return null;
    const src = page.thumbnail.source;
    if (/\.svg$/i.test(page.pageimage) || !/\/wikipedia\/commons\//.test(src)) return null;   // 지도 그림과 비자유 사진 제외
    return { v: PHOTO_VERSION, src, page: page.fullurl, title: page.title, file: page.pageimage };
  } catch (e) { return null; }
}
async function photoFor(c) {
  for (const t of c.pics || []) { const p = await pageImage('ko', t); if (p) return p; await sleep(800); }
  for (const t of c.picsEn || []) { const p = await pageImage('en', t); if (p) return p; await sleep(800); }
  return null;
}

/* ---------------- 실행 ---------------- */
async function main() {
  let prev = { countries: {} };
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch (e) { /* 처음 실행 */ }
  const oldOf = (id) => (prev.countries && prev.countries[id]) || {};
  const cutoff = Date.now() - KEEP_HOURS * 3600000;

  const found = await collect();
  const cands = {};
  for (const c of COUNTRIES) {
    const known = new Set((oldOf(c.id).articles || []).map((a) => a.url));
    cands[c.id] = dedupe((found[c.id] || []).sort((a, b) => timeOf(b.seen) - timeOf(a.seen)))
      .filter((a) => !known.has(a.url)).slice(0, CANDIDATES);
  }

  const picked = {};
  let aiOk = false;
  if (KEY) {
    for (const region of REGIONS) {
      const out = await curateRegion(region, cands);
      if (out === null) { console.warn(`${region}: 제미나이 실패, 이전 기사 유지`); continue; }
      aiOk = true;
      for (const c of COUNTRIES.filter((x) => x.region === region)) {
        picked[c.id] = (Array.isArray(out[c.id]) ? out[c.id] : [])
          .filter((x) => x && cands[c.id][x.i] && x.ko)
          .map((x) => ({ ...cands[c.id][x.i], ko: clean(x.ko), sum: clean(x.sum) }));
      }
      await sleep(6000);
    }
  } else {
    console.log('GEMINI_API_KEY가 없어서 영어 제목 그대로 저장해요');
    for (const c of COUNTRIES) picked[c.id] = cands[c.id].slice(0, PER_COUNTRY);
  }

  const out = { updated: new Date().toISOString(), source: 'The GDELT Project', ai: KEY ? (aiOk ? 'gemini' : 'gemini-failed') : 'none', countries: {} };
  for (const c of COUNTRIES) {
    const old = oldOf(c.id);
    const keepOld = (old.articles || []).filter((a) => timeOf(a.seen) >= cutoff && (!KEY || a.ko));
    const articles = dedupe((picked[c.id] || []).concat(keepOld))
      .sort((a, b) => timeOf(b.seen) - timeOf(a.seen)).slice(0, PER_COUNTRY);
    let photo = old.photo && old.photo.v === PHOTO_VERSION ? old.photo : null;
    if (!photo) { photo = await photoFor(c); await sleep(500); }
    out.countries[c.id] = { articles, photo };
    console.log(`${c.name}: 후보 ${cands[c.id].length}건, 선택 ${(picked[c.id] || []).length}건, 보여줄 기사 ${articles.length}건, 사진 ${photo ? '있음' : '없음'}`);
  }
  out.briefing = (KEY && (await briefing(out.countries))) || prev.briefing || null;
  await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
