/* 오늘의 세계 앱
 * 화면: 홈(#/), 세계지도(#/map/나라), 내 지역(#/region/지역), 마이(#/my), 기사(#/a/나라/주소)
 * 뉴스: data/news.json (GitHub Actions가 1시간마다 GDELT에서 받아 저장)
 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var topEl = document.getElementById('top');
  var screenEl = document.getElementById('screen');
  var tabsEl = document.getElementById('tabs');
  var toastEl = document.getElementById('toast');

  var BY_ID = {};
  COUNTRIES.forEach(function (c) { BY_ID[c.id] = c; });

  /* ---------- 저장 (이 기기에만 저장돼요) ---------- */
  var KEY = 'today-world.v1';
  var prefs = { saved: {}, favs: { jp: true }, region: '아시아', dark: false, size: 1, country: 'jp', homeRegion: '전체' };
  try { var raw = localStorage.getItem(KEY); if (raw) prefs = Object.assign(prefs, JSON.parse(raw)); } catch (e) {}
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} }

  /* ---------- 도구 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : '#'; }
  function eul(w) { var c = String(w).charCodeAt(String(w).length - 1) - 0xAC00; return w + ((c >= 0 && c <= 11171 && c % 28) ? '을' : '를'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function seenDate(s) {
    var m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : 0;
  }
  function kst(ts) {
    if (!ts) return '';
    var t = new Date(ts + 9 * 3600000);
    return (t.getUTCMonth() + 1) + '월 ' + t.getUTCDate() + '일 ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes());
  }
  function clock(tz) {
    var t = new Date(Date.now() + tz * 3600000);
    var h = t.getUTCHours();
    return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + ':' + pad(t.getUTCMinutes());
  }
  var I = {
    globe: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
    pin: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    share: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7"/></svg>',
    mark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>',
    out: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    search: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'
  };

  /* ---------- 데이터 ---------- */
  var data = { updated: null, countries: {} };
  var loaded = false;

  function articlesOf(cid) {
    var c = data.countries[cid];
    return (c && c.articles ? c.articles : []).map(function (a) {
      return { cid: cid, title: a.title, url: a.url, domain: a.domain, ts: seenDate(a.seen) };
    });
  }
  function allArticles() {
    var all = [];
    COUNTRIES.forEach(function (c) { all = all.concat(articlesOf(c.id)); });
    return all.sort(function (a, b) { return b.ts - a.ts; });
  }
  function photoOf(cid) { var c = data.countries[cid]; return c && c.photo ? c.photo : null; }
  function findArticle(cid, url) {
    var list = articlesOf(cid);
    for (var i = 0; i < list.length; i++) if (list[i].url === url) return list[i];
    return prefs.saved[url] || null;
  }

  /* ---------- 조각 ---------- */
  function href(a) { return '#/a/' + a.cid + '/' + encodeURIComponent(a.url); }
  function thumb(cid, cls) {
    var p = photoOf(cid);
    return p ? '<img class="' + (cls || '') + '" src="' + esc(safeUrl(p.src)) + '" alt="" loading="lazy">' : '<span class="ph ' + (cls || '') + '"></span>';
  }
  function saveBtn(a) {
    var on = !!prefs.saved[a.url];
    return '<button type="button" class="save" data-act="save" data-cid="' + a.cid + '" data-url="' + esc(a.url) + '" aria-label="기사 저장" aria-pressed="' + on + '">' + I.mark + '</button>';
  }
  function itemRow(a, showCountry) {
    return '<div class="item"><a href="' + href(a) + '"><span class="tx">'
      + (showCountry ? '<span class="c">' + esc(BY_ID[a.cid].name) + '</span>' : '')
      + '<span class="t clamp2" lang="en">' + esc(a.title) + '</span></span>' + thumb(a.cid) + '</a>'
      + '<div class="meta"><span>' + esc(a.domain) + ' ' + kst(a.ts) + '</span>' + saveBtn(a) + '</div></div>';
  }
  function emptyBox() {
    return '<div class="card empty"><b>' + (loaded ? '아직 소식이 없어요' : '소식을 불러오는 중이에요') + '</b>'
      + (loaded ? 'GitHub에 올리면 1시간마다 자동으로 채워져요.<br>처음이라면 Actions 탭에서 \'뉴스 자동 업데이트\'를 한 번 실행해 주세요.' : '') + '</div>';
  }
  function chipsRow(items, sel, act, label) {
    return '<div class="hrow" role="tablist" aria-label="' + label + '">' + items.map(function (it) {
      var v = typeof it === 'string' ? it : it.id; var n = typeof it === 'string' ? it : it.name;
      return '<button type="button" class="chip" role="tab" data-act="' + act + '" data-v="' + esc(v) + '" aria-selected="' + (v === sel) + '">' + esc(n) + '</button>';
    }).join('') + '</div>';
  }
  function bigTop(title, extra) { return '<h1 class="big">' + title + '</h1>' + (extra || ''); }

  /* ---------- 화면 ---------- */
  function home() {
    var reg = prefs.homeRegion;
    var all = allArticles();
    var list = reg === '전체' ? all : all.filter(function (a) { return BY_ID[a.cid].region === reg; });
    var lead = list[0];
    var top = '<div class="bar"><a class="brand" href="#/"><i>' + I.globe + '</i>오늘의 세계</a>'
      + '<a class="ibtn" href="#/map/' + prefs.country + '" aria-label="세계지도에서 찾기">' + I.search + '</a></div>'
      + chipsRow(['전체'].concat(REGIONS), reg, 'homeRegion', '지역');
    var h = '';
    if (!lead) {
      h += emptyBox();
    } else {
      if (list[1]) h += '<a class="card live press" href="' + href(list[1]) + '"><b>실시간</b><span>' + esc(BY_ID[list[1].cid].name) + ' ' + esc(list[1].title) + '</span></a>';
      var p = photoOf(lead.cid);
      h += '<a class="lead press" href="' + href(lead) + '">' + (p ? '<img src="' + esc(safeUrl(p.src)) + '" alt="">' : '')
        + '<span class="shade"></span>' + (p ? '<span class="credit">사진 위키백과</span>' : '')
        + '<span class="txt"><span class="kick glass">' + esc(BY_ID[lead.cid].name) + '</span><span class="t clamp3" lang="en">' + esc(lead.title) + '</span>'
        + '<span class="m">' + esc(lead.domain) + ' ' + kst(lead.ts) + '</span></span></a>';
    }
    var mine = all.filter(function (a) { return BY_ID[a.cid].region === prefs.region; }).length;
    h += '<div class="quick"><a class="card press" href="#/map/' + prefs.country + '"><span class="qi">' + I.globe + '</span><span><b>세계지도</b><small>나라를 눌러 소식 보기</small></span></a>'
      + '<a class="card press" href="#/region/' + encodeURIComponent(prefs.region) + '"><span class="qi">' + I.pin + '</span><span><b>내 지역 ' + esc(prefs.region) + '</b><small>새 소식 ' + mine + '건</small></span></a></div>';
    if (lead) {
      h += '<section class="sec"><div class="h2"><h2>' + (reg === '전체' ? '주요 소식' : esc(reg) + ' 소식') + '</h2><span class="more">' + Math.min(list.length, 10) + '건</span></div>'
        + '<div class="card list">' + list.slice(1, 11).map(function (a) { return itemRow(a, true); }).join('') + '</div></section>';
    }
    var rail = COUNTRIES.filter(function (c) { return reg === '전체' || c.region === reg; });
    h += '<section class="sec" style="margin-left:0;margin-right:0"><div class="h2" style="padding:0 16px"><h2>나라별 바로가기</h2><span class="more">' + rail.length + '개 나라</span></div><div class="snap">'
      + rail.map(function (c) {
        var a = articlesOf(c.id);
        return '<a class="card cc press" href="#/map/' + c.id + '"><span class="n">' + esc(c.name) + '<span class="badge">' + a.length + '건</span></span>'
          + '<span class="clamp2" style="font-size:14px;font-weight:600;color:var(--sub)" lang="en">' + esc(a[0] ? a[0].title : '아직 소식이 없어요') + '</span></a>';
      }).join('') + '</div></section>';
    return { tab: 'home', top: top, body: h };
  }

  function mapScreen(cid) {
    var c = BY_ID[cid] || BY_ID[prefs.country] || COUNTRIES[0];
    prefs.country = c.id; persist();
    var list = articlesOf(c.id);
    var fav = !!prefs.favs[c.id];
    var lx = Math.max(4, Math.min(700, c.x - 18)), ly = c.y < 40 ? c.y + 14 : c.y - 34;
    var h = '<div class="card mapcard"><div class="hs"><div class="map" role="group" aria-label="세계지도">'
      + '<span class="seoul" aria-hidden="true"></span>'
      + COUNTRIES.map(function (p) {
        return '<button type="button" class="pin" data-act="country" data-v="' + p.id + '" style="left:' + (p.x - 15) + 'px;top:' + (p.y - 15) + 'px;z-index:' + (p.id === c.id ? 4 : 2) + '" aria-pressed="' + (p.id === c.id) + '" aria-label="' + esc(p.name) + '"><span class="dot"></span></button>';
      }).join('')
      + '<span class="plabel" style="left:' + lx + 'px;top:' + ly + 'px">' + esc(c.name) + '</span></div></div>'
      + '<p class="hint">지도를 옆으로 밀면 아메리카도 볼 수 있어요</p></div>'
      + '<div class="card info"><div class="hd"><span class="ic">' + I.pin + '</span><span><span class="nm">' + esc(c.name) + '</span><span class="sb">현지 시각 ' + clock(c.tz) + '</span></span></div>'
      + '<div class="sw-row"><span style="flex:1">관심 나라로 담기</span><button type="button" class="sw" role="switch" data-act="fav" data-v="' + c.id + '" aria-checked="' + fav + '" aria-label="' + esc(c.name) + ' 관심 나라로 담기"><span></span></button></div></div>'
      + '<section class="sec"><div class="h2"><h2>' + esc(c.name) + ' 소식</h2><span class="more">' + list.length + '건</span></div>'
      + (list.length ? list.map(function (a) {
        return '<a class="card ncard press" href="' + href(a) + '"><span class="w">' + esc(a.domain) + ' ' + kst(a.ts) + '</span><span class="t" lang="en">' + esc(a.title) + '</span></a>';
      }).join('') : emptyBox()) + '</section>';
    return { tab: 'map', top: bigTop('세계지도', chipsRow(COUNTRIES, c.id, 'country', '나라 선택')), body: h, after: function () { centerPin(c); } };
  }

  function regionScreen(reg) {
    if (REGIONS.indexOf(reg) < 0) reg = prefs.region;
    var names = COUNTRIES.filter(function (c) { return c.region === reg; }).map(function (c) { return c.name; }).join(', ');
    var list = allArticles().filter(function (a) { return BY_ID[a.cid].region === reg; });
    var mine = prefs.region === reg;
    var h = '<div class="card info" style="margin-top:0"><div class="hd"><span class="ic">' + I.pin + '</span><span><span class="nm">' + esc(reg) + '</span><span class="sb">' + esc(names) + '</span></span></div>'
      + '<div class="sw-row"><span style="flex:1">이 지역을 내 지역으로</span><button type="button" class="sw" role="switch" data-act="myRegion" data-v="' + esc(reg) + '" aria-checked="' + mine + '" aria-label="' + esc(eul(reg)) + ' 내 지역으로"><span></span></button></div></div>'
      + '<section class="sec"><div class="h2"><h2>' + esc(reg) + ' 소식</h2><span class="more">' + list.length + '건</span></div>'
      + (list.length ? '<div class="card list">' + list.map(function (a) { return itemRow(a, true); }).join('') + '</div>' : emptyBox()) + '</section>';
    return { tab: 'region', top: bigTop('내 지역', chipsRow(REGIONS, reg, 'region', '지역 선택')), body: h };
  }

  function myScreen() {
    var saved = Object.keys(prefs.saved).map(function (k) { return prefs.saved[k]; });
    var favs = COUNTRIES.filter(function (c) { return prefs.favs[c.id]; });
    var h = '<section style="margin:0 16px"><h2 class="lab">관심 나라</h2><div class="card" style="overflow:hidden">'
      + (favs.length ? favs.map(function (c) {
        return '<a class="row" href="#/map/' + c.id + '"><span class="l"><b>' + esc(c.name) + '</b><small>현지 시각 ' + clock(c.tz) + ', 소식 ' + articlesOf(c.id).length + '건</small></span></a>';
      }).join('') : '<p style="margin:0;padding:16px;font-size:14px;color:var(--sub)">세계지도에서 \'관심 나라로 담기\'를 켜면 여기에 모여요.</p>') + '</div></section>'
      + '<section class="sec"><h2 class="lab">화면</h2><div class="card" style="overflow:hidden">'
      + '<div class="row"><span class="l"><b>글자 크기</b></span><div class="seg" role="radiogroup" aria-label="글자 크기">'
      + ['작게', '보통', '크게'].map(function (n, i) { return '<button type="button" role="radio" data-act="size" data-v="' + i + '" aria-checked="' + (prefs.size === i) + '" style="font-size:' + (13 + i * 2) + 'px">' + n + '</button>'; }).join('')
      + '</div></div><div class="row"><span class="l"><b>다크 모드</b></span><button type="button" class="sw" role="switch" data-act="dark" aria-checked="' + prefs.dark + '" aria-label="다크 모드"><span></span></button></div></div></section>'
      + '<section class="sec"><h2 class="lab">저장한 기사</h2><div class="card" style="overflow:hidden">'
      + (saved.length ? saved.map(function (a) {
        return '<a class="row" href="' + href(a) + '"><span class="badge">' + esc(BY_ID[a.cid] ? BY_ID[a.cid].name : '') + '</span><span class="l"><b class="clamp2" style="font-size:15px" lang="en">' + esc(a.title) + '</b></span></a>';
      }).join('') : '<p style="margin:0;padding:16px;font-size:14px;color:var(--sub)">기사 옆 책갈피를 누르면 여기에 모여요.</p>') + '</div></section>'
      + '<section class="sec"><h2 class="lab">정보</h2><div class="card" style="overflow:hidden">'
      + '<a class="row" href="https://www.gdeltproject.org" target="_blank" rel="noopener"><span class="l"><b>소식 데이터</b><small>The GDELT Project</small></span></a>'
      + '<a class="row" href="https://ko.wikipedia.org" target="_blank" rel="noopener"><span class="l"><b>나라 사진</b><small>위키백과, 각 사진의 라이선스를 따름</small></span></a>'
      + '<div class="row"><span class="l"><b>마지막 업데이트</b><small>' + (data.updated ? kst(Date.parse(data.updated)) : '아직 없음') + '</small></span></div>'
      + '<div class="row"><span class="l"><b>안내</b><small>기사 제목과 링크만 보여드려요. 기사 내용과 사진의 권리는 각 언론사에 있어요.</small></span></div>'
      + '</div></section>';
    return { tab: 'my', top: bigTop('마이'), body: h };
  }

  function articleScreen(cid, url) {
    var a = findArticle(cid, url);
    var c = BY_ID[cid];
    if (!a || !c) return { tab: null, top: backTop(''), body: '<div class="card empty"><b>기사를 찾을 수 없어요</b>소식이 업데이트되면서 목록에서 빠졌을 수 있어요.</div>' };
    var p = photoOf(cid);
    var tr = 'https://translate.google.com/translate?sl=auto&tl=ko&u=' + encodeURIComponent(a.url);
    var others = articlesOf(cid).filter(function (o) { return o.url !== a.url; }).slice(0, 5);
    var h = '<article class="art"><a class="ktag" href="#/map/' + c.id + '">' + esc(c.name) + '</a>'
      + '<h1 lang="en">' + esc(a.title) + '</h1>'
      + '<div class="by"><span class="av">' + esc((a.domain || '?').charAt(0).toUpperCase()) + '</span><span style="display:flex;flex-direction:column;line-height:1.35"><b style="font-size:14px">' + esc(a.domain) + '</b><small style="font-size:12px;color:var(--sub)">' + kst(a.ts) + ' 수집, 현지 ' + clock(c.tz) + '</small></span></div>'
      + (p ? '<figure><img src="' + esc(safeUrl(p.src)) + '" alt="' + esc(p.title) + ' 풍경"><figcaption>' + esc(p.title) + ' 풍경 (기사 사진 아님). 사진 <a href="' + esc(safeUrl(p.page)) + '" target="_blank" rel="noopener" style="text-decoration:underline">위키백과</a></figcaption></figure>' : '')
      + '<p>' + esc(c.name) + ' 언론사 ' + esc(a.domain) + '에 실린 영어 기사예요. 오늘의 세계는 제목과 링크만 보여드려요. 전체 내용은 원문에서 읽을 수 있어요.</p></article>'
      + '<div style="margin:22px 16px 0;display:flex;flex-direction:column;gap:10px">'
      + '<a class="pill main press" href="' + esc(safeUrl(a.url)) + '" target="_blank" rel="noopener">원문 보기' + I.out + '</a>'
      + '<a class="pill sub press" href="' + esc(tr) + '" target="_blank" rel="noopener">한국어로 번역해서 보기</a></div>'
      + (others.length ? '<section class="sec"><div class="h2"><h2>' + esc(c.name) + ' 다른 소식</h2></div><div class="card list">' + others.map(function (o) { return itemRow(o, false); }).join('') + '</div></section>' : '');
    var on = !!prefs.saved[a.url];
    var top = '<div class="bar" style="padding:0 14px"><button type="button" class="ibtn" data-act="back" aria-label="뒤로">' + I.back + '</button><span style="flex:1"></span>'
      + '<button type="button" class="ibtn" data-act="bigger" aria-label="글자 크기 바꾸기" style="font-size:15px;font-weight:800">가</button>'
      + '<button type="button" class="ibtn save" data-act="save" data-cid="' + cid + '" data-url="' + esc(a.url) + '" aria-label="기사 저장" aria-pressed="' + on + '" style="margin:0">' + I.mark + '</button>'
      + '<button type="button" class="ibtn" data-act="share" data-url="' + esc(a.url) + '" data-title="' + esc(a.title) + '" aria-label="공유">' + I.share + '</button></div>';
    return { tab: null, top: top, body: h };
  }
  function backTop(title) {
    return '<div class="bar" style="padding:0 14px"><button type="button" class="ibtn" data-act="back" aria-label="뒤로">' + I.back + '</button><span style="flex:1;font-weight:700">' + esc(title) + '</span></div>';
  }

  /* ---------- 그리기 ---------- */
  var lastKey = '';
  function render() {
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    var r;
    if (parts[0] === 'map') r = mapScreen(parts[1]);
    else if (parts[0] === 'region') r = regionScreen(decodeURIComponent(parts[1] || ''));
    else if (parts[0] === 'my') r = myScreen();
    else if (parts[0] === 'a') r = articleScreen(parts[1], decodeURIComponent(parts.slice(2).join('/')));
    else r = home();

    app.classList.toggle('dark', !!prefs.dark);
    app.style.setProperty('--fs', [15, 17, 19][prefs.size] + 'px');
    document.querySelector('meta[name="theme-color"]').setAttribute('content', prefs.dark ? '#0E0F11' : '#F3F2EF');
    topEl.innerHTML = r.top;
    var key = location.hash;
    var keepScroll = key === lastKey;
    var y = screenEl.scrollTop;
    screenEl.innerHTML = '<div class="fade">' + r.body + '</div>';
    if (keepScroll) { screenEl.firstChild.classList.remove('fade'); screenEl.scrollTop = y; } else screenEl.scrollTop = 0;
    lastKey = key;
    app.style.setProperty('--top-h', topEl.offsetHeight + 'px');
    screenEl.style.paddingTop = (topEl.offsetHeight + 12) + 'px';
    tabsEl.classList.toggle('hide', !r.tab);
    Array.prototype.forEach.call(tabsEl.querySelectorAll('.tab'), function (t) {
      if (t.dataset.tab === r.tab) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    if (r.after) r.after();
  }
  function centerPin(c) {
    var hs = screenEl.querySelector('.hs');
    if (hs && !hs.dataset.done) { hs.scrollLeft = Math.max(0, c.x - hs.clientWidth / 2); hs.dataset.done = '1'; }
  }

  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 1800);
  }

  /* ---------- 누르기 ---------- */
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.dataset.act, v = b.dataset.v;
    if (act === 'homeRegion') { prefs.homeRegion = v; persist(); render(); }
    else if (act === 'country') { location.hash = '#/map/' + v; }
    else if (act === 'region') { location.hash = '#/region/' + encodeURIComponent(v); }
    else if (act === 'fav') { prefs.favs[v] = !prefs.favs[v]; persist(); render(); toast(prefs.favs[v] ? '관심 나라에 담았어요' : '관심 나라에서 뺐어요'); }
    else if (act === 'myRegion') { prefs.region = v; persist(); render(); toast(eul(v) + ' 내 지역으로 정했어요'); }
    else if (act === 'size') { prefs.size = +v; persist(); render(); }
    else if (act === 'bigger') { prefs.size = (prefs.size + 1) % 3; persist(); render(); toast('글자 크기 ' + ['작게', '보통', '크게'][prefs.size]); }
    else if (act === 'dark') { prefs.dark = !prefs.dark; persist(); render(); }
    else if (act === 'save') {
      e.preventDefault();
      var url = b.dataset.url;
      if (prefs.saved[url]) { delete prefs.saved[url]; toast('저장을 취소했어요'); }
      else { var a = findArticle(b.dataset.cid, url); if (a) prefs.saved[url] = a; toast('저장했어요'); }
      persist(); render();
    }
    else if (act === 'share') {
      var link = b.dataset.url;
      if (navigator.share) navigator.share({ title: b.dataset.title, url: link }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast('기사 링크를 복사했어요'); }, function () {});
    }
    else if (act === 'back') { if (history.length > 1) history.back(); else location.hash = '#/'; }
  });
  window.addEventListener('hashchange', render);
  setInterval(function () { if (/^#\/(map|my|a)/.test(location.hash)) render(); }, 60000);

  /* ---------- 시작 ---------- */
  render();
  fetch('data/news.json', { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (j) { data = j && j.countries ? j : data; })
    .catch(function () {})
    .then(function () { loaded = true; render(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
