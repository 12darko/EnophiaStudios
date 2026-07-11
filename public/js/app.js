'use strict';
/* Enophia Studios — public site (vanilla JS SPA, hash routing).
   Content comes from GET /api/content; the admin panel (admin.js) writes back. */

const App = {
  lang: detectLang(),
  t: null,
  content: null,
  view: { name: 'home' },
};
App.t = LABELS[App.lang];

const $app = document.getElementById('app');
const $nav = document.getElementById('nav-links');

// ---------------- utils ----------------
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---------------- Firebase (Firestore = content DB, Auth = admin login) ----------------
let fbAuth = null, fbDb = null;

function firebaseConfigured() {
  return typeof FIREBASE_CONFIG === 'object' && !!FIREBASE_CONFIG.apiKey
    && FIREBASE_CONFIG.apiKey.indexOf('BURAYA') === -1
    && typeof firebase !== 'undefined';
}

function initFirebase() {
  if (!firebaseConfigured()) return false;
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    fbDb.collection('site').doc('content').onSnapshot(snap => {
      if (snap.metadata.hasPendingWrites) return; // our own write echoing back
      if (!snap.exists) return;
      App.content = deepMerge(clone(CONTENT_DEFAULTS), snap.data());
      // live-update public views; never re-render mid-typing in the admin panel
      if (App.view.name !== 'admin') render();
    }, err => console.warn('Firestore subscribe:', err && err.code));
    return true;
  } catch (e) {
    console.warn('Firebase init failed:', e && e.message);
    return false;
  }
}

function localizeGame(g, lang) {
  const isTR = lang === 'tr';
  const cover = g.cover || '';
  const coverCss = cover
    ? "background-image:linear-gradient(180deg, rgba(10,12,16,0) 45%, rgba(10,12,16,0.6)), url('" + esc(cover) + "');"
    : 'background:radial-gradient(120% 120% at 30% 20%, ' + esc(g.accent || '#e0a85e') + '40, transparent 60%), linear-gradient(160deg,#161a20,#0d1014);';
  const heroCss = cover
    ? "background-image:linear-gradient(180deg, rgba(10,12,16,0.1) 30%, rgba(10,12,16,0.75)), url('" + esc(cover) + "');"
    : 'background:radial-gradient(120% 120% at 30% 15%, ' + esc(g.accent || '#e0a85e') + '44, transparent 60%), linear-gradient(160deg,#161a20,#0d1014);';
  return {
    slug: g.slug, hasDetail: !!g.hasDetail, itch: g.itch || '', title: g.title || '',
    genre: (g.genre && g.genre[lang]) || '',
    tagline: (g.tagline && g.tagline[lang]) || '',
    story: (g.story && g.story[lang]) || '',
    gameplay: (g.gameplay && g.gameplay[lang]) || '',
    features: (g.features && g.features[lang]) || [],
    shots: g.shots || [],
    platforms: g.platforms || '', jam: g.jam || '', video: g.video || '',
    statusLabel: isTR ? 'Yayında' : 'Released',
    ctaLabel: g.hasDetail ? App.t.cta_view : App.t.cta_itch,
    coverCss, heroCss, noCover: !cover, letter: (g.title || '?').charAt(0),
  };
}

// ---------------- router (real paths for SEO; #admin stays a hidden hash) ----------------
function parseRoute() {
  if (location.hash === '#admin') return { name: 'admin' };
  const p = decodeURIComponent(location.pathname);
  if (p === '/about') return { name: 'about' };
  if (p === '/blog') return { name: 'blog' };
  if (p.indexOf('/blog/') === 0) return { name: 'post', slug: p.slice(6) };
  if (p.indexOf('/game/') === 0) return { name: 'game', slug: p.slice(6) };
  return { name: 'home' };
}

function navigate(url) {
  history.pushState(null, '', url);
  onRoute();
}

function onRoute() {
  App.view = parseRoute();
  render();
  const sec = (location.hash && location.hash !== '#admin') ? location.hash.slice(1) : '';
  const el = sec && App.view.name === 'home' ? document.getElementById(sec) : null;
  if (el) el.scrollIntoView();
  else window.scrollTo(0, 0);
}

// old #/... hash URLs redirect to their real-path equivalents
(function redirectLegacyHash() {
  const h = location.hash || '';
  if (h.indexOf('#/') === 0 && h !== '#/admin') history.replaceState(null, '', h.slice(1));
  else if (h === '#/admin') history.replaceState(null, '', '/#admin');
})();

function syncTitle() {
  const t = App.t, isTR = App.lang === 'tr';
  let title = isTR ? 'Enophia Studios — Bağımsız Oyun Stüdyosu' : 'Enophia Studios — Indie Game Studio';
  const v = App.view;
  if (v.name === 'about') title = t.nav_about + ' — Enophia Studios';
  else if (v.name === 'blog') title = 'Blog — Enophia Studios';
  else if (v.name === 'admin') title = 'Admin — Enophia Studios';
  else if (v.name === 'game' && App.content) {
    const g = App.content.games.find(x => x.slug === v.slug);
    if (g) title = g.title + ' — Enophia Studios';
  } else if (v.name === 'post' && App.content) {
    const p = (App.content.blog || []).find(x => x.slug === v.slug);
    if (p) title = ((p.title && p.title[App.lang]) || 'Blog') + ' — Enophia Studios';
  }
  if (document.title !== title) document.title = title;
}

// keep description/canonical/og tags + JSON-LD in sync during SPA navigation
// (crawlers get the server-rendered versions; this covers client transitions)
function updateMeta() {
  syncTitle();
  const v = App.view, C = App.content, lang = App.lang;
  if (!C) return;
  let desc = (C.hero.sub && C.hero.sub[lang]) || '';
  if (v.name === 'about') desc = (C.about.lead && C.about.lead[lang]) || desc;
  else if (v.name === 'blog') desc = App.t.blog_sub;
  else if (v.name === 'post') {
    const p = (C.blog || []).find(x => x.slug === v.slug);
    if (p && p.excerpt) desc = p.excerpt[lang] || desc;
  } else if (v.name === 'game') {
    const g = C.games.find(x => x.slug === v.slug);
    if (g && g.tagline) desc = g.tagline[lang] || desc;
  }
  const setAttr = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
  const url = location.origin + location.pathname;
  setAttr('meta[name="description"]', 'content', desc);
  setAttr('link[rel="canonical"]', 'href', url);
  setAttr('meta[property="og:title"]', 'content', document.title);
  setAttr('meta[property="og:description"]', 'content', desc);
  setAttr('meta[property="og:url"]', 'content', url);

  const old = document.getElementById('dyn-jsonld');
  if (old) old.remove();
  let ld = null;
  if (v.name === 'game') {
    const g = C.games.find(x => x.slug === v.slug);
    if (g) ld = {
      '@context': 'https://schema.org', '@type': 'VideoGame',
      name: g.title, url, description: (g.tagline && g.tagline[lang]) || '',
      image: g.cover || undefined, genre: (g.genre && g.genre[lang]) || undefined,
      gamePlatform: g.platforms || undefined,
      author: { '@type': 'Organization', name: 'Enophia Studios' },
    };
  } else if (v.name === 'post') {
    const p = (C.blog || []).find(x => x.slug === v.slug);
    if (p) ld = {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: (p.title && p.title[lang]) || '', url, datePublished: p.date || undefined,
      image: p.cover || undefined, description: (p.excerpt && p.excerpt[lang]) || '',
      author: { '@type': 'Organization', name: 'Enophia Studios' },
    };
  }
  if (ld) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = 'dyn-jsonld';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }
}

// ---------------- render ----------------
function render() {
  renderNav();
  updateMeta();
  const v = App.view;
  if (v.name === 'admin') { renderAdmin(); return; }
  if (!App.content) { $app.innerHTML = ''; return; }
  if (v.name === 'about') $app.innerHTML = viewAbout();
  else if (v.name === 'blog') $app.innerHTML = viewBlog();
  else if (v.name === 'post') $app.innerHTML = viewPost(v.slug);
  else if (v.name === 'game') $app.innerHTML = viewGame(v.slug);
  else $app.innerHTML = viewHome();
}

function renderNav() {
  const t = App.t;
  const onHome = App.view.name === 'home';
  let html = '';
  if (onHome) {
    html += '<a href="/#games">' + t.nav_games + '</a>'
      + '<a href="/#vision">' + t.nav_vision + '</a>'
      + '<a href="/#next">' + t.nav_next + '</a>'
      + '<a href="/#press">' + t.nav_press + '</a>'
      + '<a href="/#contact">' + t.nav_contact + '</a>';
  }
  html += '<a href="/blog">' + t.nav_blog + '</a>'
    + '<a href="/about">' + t.nav_about + '</a>';
  $nav.innerHTML = html;
}

// ---------------- views ----------------
function gameCard(lg) {
  // real <a href> links so crawlers can discover detail pages
  const href = lg.hasDetail
    ? ' href="/game/' + encodeURIComponent(lg.slug) + '"'
    : ' href="' + esc(lg.itch) + '" target="_blank" rel="noopener"';
  return '<a class="game-card"' + href + '>'
    + '<div class="game-cover" style="' + lg.coverCss + '">'
    + (lg.noCover ? '<span class="letter">' + esc(lg.letter) + '</span>' : '')
    + '<span class="game-status">' + esc(lg.statusLabel) + '</span>'
    + '</div>'
    + '<div class="game-card-body">'
    + '<div class="game-genre">' + esc(lg.genre) + '</div>'
    + '<h3>' + esc(lg.title) + '</h3>'
    + '<p>' + esc(lg.tagline) + '</p>'
    + '<div class="game-cta">' + esc(lg.ctaLabel) + ' <span aria-hidden="true">→</span></div>'
    + '</div></a>';
}

function viewHome() {
  const t = App.t, C = App.content, lang = App.lang;
  const L = C.links;
  const mailto = 'mailto:' + (L.email || '');
  const games = C.games.map(g => localizeGame(g, lang));

  const teamCards = C.team.map((m, i) =>
    '<div class="team-card">'
    + '<span class="avatar g' + (i % 2) + '">' + esc(m.initials) + '</span>'
    + '<div><h3>' + esc(m.name) + '</h3>'
    + '<div class="team-roleline">' + esc((m.role && m.role[lang]) || '') + '</div>'
    + '<div class="team-role">@' + esc(m.handle) + '</div>'
    + '<a href="' + esc(m.linkedin) + '" target="_blank" rel="noopener">LinkedIn ↗</a>'
    + '</div></div>'
  ).join('');

  const nextCards = (C.next || []).map((n, i) =>
    '<div class="next-card">'
    + '<span class="next-chip c' + (i % 3) + '">' + esc((n.tag && n.tag[lang]) || '') + '</span>'
    + '<h3>' + esc((n.h && n.h[lang]) || '') + '</h3>'
    + '<p>' + esc((n.t && n.t[lang]) || '') + '</p>'
    + '</div>'
  ).join('');

  return '<main>'
    // HERO
    + '<section class="hero"><div class="hero-box">'
    + '<div class="kicker"><span class="dot"></span>' + t.hero_kicker + '</div>'
    + '<h1>' + esc(C.hero.title[lang]) + '</h1>'
    + '<p>' + esc(C.hero.sub[lang]) + '</p>'
    + '<div class="hero-ctas">'
    + '<a href="#games" class="btn btn-primary">' + t.hero_cta1 + '</a>'
    + '<a href="' + esc(L.itch) + '" target="_blank" rel="noopener" class="btn btn-ghost">' + t.hero_cta2 + '</a>'
    + '</div></div></section>'
    // GAMES
    + '<section id="games" class="block">'
    + '<div style="margin-bottom:36px;"><h2 class="sec-title">' + t.games_title + '</h2><p class="sec-sub" style="margin-bottom:0;">' + t.games_sub + '</p></div>'
    + '<div class="games-grid">' + games.map(gameCard).join('') + '</div>'
    + '</section>'
    // VISION & MISSION
    + '<section id="vision" class="block" style="padding-top:70px;padding-bottom:70px;">'
    + '<h2 class="sec-title" style="margin-bottom:36px;">' + t.vision_title + '</h2>'
    + '<div class="vm-grid">'
    + '<div class="vm-card"><div class="vm-label">' + t.vision_h + '</div><p>' + esc(C.vision[lang]) + '</p></div>'
    + '<div class="vm-card"><div class="vm-label teal">' + t.mission_h + '</div><p>' + esc(C.mission[lang]) + '</p></div>'
    + '</div></section>'
    // WHAT'S NEXT
    + '<section id="next" class="block" style="padding-top:70px;padding-bottom:70px;">'
    + '<h2 class="sec-title">' + t.next_title + '</h2><p class="sec-sub">' + t.next_sub + '</p>'
    + '<div class="next-grid">' + nextCards + '</div>'
    + '</section>'
    // STORY
    + '<section id="story" class="block" style="padding-top:70px;padding-bottom:70px;">'
    + '<div class="story-box">'
    + '<div class="story-stat"><span class="num">' + String(C.games.length).padStart(2, '0') + '</span><span class="lbl">' + t.story_stat + '</span></div>'
    + '<div><h2>' + t.story_title + '</h2><p>' + esc(C.story[lang]) + '</p></div>'
    + '</div></section>'
    // TEAM
    + '<section id="team" class="block" style="padding-top:70px;padding-bottom:70px;">'
    + '<h2 class="sec-title">' + t.team_title + '</h2><p class="sec-sub">' + t.team_sub + '</p>'
    + '<div class="team-grid">' + teamCards + '</div>'
    + '</section>'
    // STORES
    + '<section id="play" class="block" style="padding-top:70px;padding-bottom:70px;">'
    + '<h2 class="sec-title">' + t.play_title + '</h2><p class="sec-sub">' + t.play_sub + '</p>'
    + '<div class="stores-grid">'
    + '<a href="' + esc(L.itch) + '" target="_blank" rel="noopener" class="store-card itch">'
    + '<div class="store-head"><span class="store-icon itch">i</span><span class="store-badge live">' + t.live + '</span></div>'
    + '<div><div class="store-name">itch.io</div><p>' + t.itch_t + '</p></div>'
    + '<span class="store-foot itch">' + t.visit + ' <span aria-hidden="true">↗</span></span></a>'
    + '<div class="store-card steam">'
    + '<div class="store-head"><span class="store-icon steam">S</span><span class="store-badge soon">' + t.soon + '</span></div>'
    + '<div><div class="store-name">Steam</div><p>' + t.steam_t + '</p></div>'
    + '<span class="store-foot off">' + t.soon + '</span></div>'
    + '<div class="store-card gplay">'
    + '<div class="store-head"><span class="store-icon gplay">▶</span><span class="store-badge returning">' + t.returning + '</span></div>'
    + '<div><div class="store-name">Play Store</div><p>' + t.playstore_t + '</p></div>'
    + '<span class="store-foot off">' + t.returning + '</span></div>'
    + '<a href="' + esc(L.youtube1) + '" target="_blank" rel="noopener" class="store-card yt">'
    + '<div class="store-head"><span class="store-icon yt">▶</span><span class="store-badge live">' + t.live + '</span></div>'
    + '<div><div class="store-name">YouTube</div><p>' + t.youtube_t + '</p></div>'
    + '<span class="store-foot yt">' + t.visit + ' <span aria-hidden="true">↗</span></span></a>'
    + '</div></section>'
    // PRESS KIT
    + '<section id="press" class="block" style="padding-top:70px;padding-bottom:70px;">'
    + '<div class="press-grid"><div>'
    + '<h2 class="sec-title">' + t.press_title + '</h2><p>' + t.press_sub + '</p>'
    + '<div class="press-btns">'
    + '<a href="' + esc(mailto) + '" class="btn btn-primary-sm">' + t.btn_email + '</a>'
    + '<a href="' + esc(L.itch) + '" target="_blank" rel="noopener" class="btn btn-ghost-sm">' + t.btn_itch + '</a>'
    + '</div></div>'
    + '<div class="press-facts">'
    + '<div class="press-row"><span class="k">' + t.fact_studio + '</span><span class="v">Enophia Studios</span></div>'
    + '<div class="press-row"><span class="k">' + t.fact_based + '</span><span class="v">' + t.val_based + '</span></div>'
    + '<div class="press-row"><span class="k">' + t.fact_team + '</span><span class="v">' + t.val_team + '</span></div>'
    + '<div class="press-row"><span class="k">' + t.fact_releases + '</span><span class="v">' + t.val_releases + '</span></div>'
    + '<div class="press-row"><span class="k">' + t.fact_contact + '</span><span class="v accent">' + esc(L.email) + '</span></div>'
    + '</div></div></section>'
    // CONTACT
    + '<section id="contact" class="block" style="padding-top:70px;padding-bottom:56px;">'
    + '<div class="contact-box"><div class="contact-inner">'
    + '<div class="kicker"><span class="dot"></span>' + t.nav_contact + '</div>'
    + '<h2>' + t.contact_title + '</h2>'
    + '<p>' + esc(C.contact.sub[lang]) + '</p>'
    + '<a href="' + esc(mailto) + '" class="contact-email">✉ ' + esc(L.email) + '</a>'
    + '<div class="contact-links">'
    + '<a href="' + esc(L.itch) + '" target="_blank" rel="noopener">itch.io <span aria-hidden="true">↗</span></a>'
    + '<a href="' + esc(L.youtube2) + '" target="_blank" rel="noopener">YouTube <span aria-hidden="true">↗</span></a>'
    + '<a href="' + esc(L.linkedin1) + '" target="_blank" rel="noopener">Ender <span aria-hidden="true">↗</span></a>'
    + '<a href="' + esc(L.linkedin2) + '" target="_blank" rel="noopener">Ahmet <span aria-hidden="true">↗</span></a>'
    + '</div></div></div></section>'
    + '</main>';
}

function viewAbout() {
  const t = App.t, C = App.content, lang = App.lang;
  const team = C.team.map((m, i) =>
    '<div class="about-team-row">'
    + '<span class="avatar g' + (i % 2) + '">' + esc(m.initials) + '</span>'
    + '<div><div class="nm">' + esc(m.name) + '</div><div class="rl">' + esc((m.role && m.role[lang]) || '') + '</div></div>'
    + '</div>'
  ).join('');
  return '<main class="page-narrow">'
    + '<div class="page-kicker">' + t.about_kicker + '</div>'
    + '<h1 class="page-title">' + t.about_title + '</h1>'
    + '<p class="about-lead">' + esc(C.about.lead[lang]) + '</p>'
    + '<div class="about-grid">'
    + '<div><h2>' + t.about_story_h + '</h2><p>' + esc(C.story[lang]) + '</p></div>'
    + '<div class="about-vm">'
    + '<div class="about-vm-card"><div class="vm-label">' + t.vision_h + '</div><p>' + esc(C.vision[lang]) + '</p></div>'
    + '<div class="about-vm-card"><div class="vm-label teal">' + t.mission_h + '</div><p>' + esc(C.mission[lang]) + '</p></div>'
    + '</div>'
    + '<div><h2>' + t.about_milestones_h + '</h2><div>'
    + '<div class="milestone"><span class="year">2024</span><div class="what"><strong>Protect The Misty</strong><span> · ScoreSpace Jam #31</span></div></div>'
    + '<div class="milestone"><span class="year">2024</span><div class="what"><strong>Villagers vs. Gods</strong><span> · Brackeys Game Jam 2024.2</span></div></div>'
    + '<div class="milestone"><span class="year now">' + t.about_now + '</span><div class="what"><strong>' + t.about_now_h + '</strong><span> · Steam &amp; Play Store</span></div></div>'
    + '</div></div>'
    + '<div><h2>' + t.team_title + '</h2><div class="about-team">' + team + '</div></div>'
    + '<a href="mailto:' + esc(C.links.email) + '" class="btn btn-primary" style="align-self:start;">' + t.btn_email + '</a>'
    + '</div></main>';
}

function viewBlog() {
  const t = App.t, C = App.content, lang = App.lang;
  const posts = (C.blog || []);
  const list = posts.map(p =>
    '<a class="blog-item" href="/blog/' + encodeURIComponent(p.slug) + '">'
    + '<span class="date">' + esc(p.date) + '</span>'
    + '<h3>' + esc((p.title && p.title[lang]) || '') + '</h3>'
    + '<p>' + esc((p.excerpt && p.excerpt[lang]) || '') + '</p>'
    + '<span class="read">' + t.blog_read + ' <span aria-hidden="true">→</span></span>'
    + '</a>'
  ).join('');
  return '<main class="page-blog">'
    + '<div class="page-kicker">' + t.nav_blog + '</div>'
    + '<h1 class="page-title" style="margin-bottom:16px;">' + t.blog_title + '</h1>'
    + '<p class="blog-sub">' + t.blog_sub + '</p>'
    + (posts.length ? '<div class="blog-list">' + list + '</div>' : '<p class="blog-empty">' + t.blog_empty + '</p>')
    + '</main>';
}

function viewPost(slug) {
  const t = App.t, C = App.content, lang = App.lang;
  const p = (C.blog || []).find(x => x.slug === slug);
  if (!p) return '<main class="page-post"><p class="blog-empty">' + t.blog_empty + '</p></main>';
  return '<main class="page-post">'
    + '<a class="btn-back" href="/blog">← ' + t.blog_back + '</a>'
    + (p.cover ? '<img class="post-cover" src="' + esc(p.cover) + '" alt="">' : '')
    + '<span class="post-date">' + esc(p.date) + '</span>'
    + '<h1 class="post-title">' + esc((p.title && p.title[lang]) || '') + '</h1>'
    + '<p class="post-body">' + esc((p.body && p.body[lang]) || '') + '</p>'
    + '</main>';
}

function viewGame(slug) {
  const t = App.t, C = App.content, lang = App.lang;
  const g = C.games.find(x => x.slug === slug);
  if (!g || !g.hasDetail) return '<main class="page-game"><p class="blog-empty">404</p></main>';
  const lg = localizeGame(g, lang);
  const features = lg.features.map(f =>
    '<div class="feature-row"><span class="diamond">◆</span><span class="txt">' + esc(f) + '</span></div>'
  ).join('');
  const shots = lg.shots.map(s =>
    '<img src="' + esc(s) + '" alt="" loading="lazy">'
  ).join('');
  return '<main class="page-game">'
    + '<a class="btn-back" href="/">← ' + t.back + '</a>'
    + '<div class="game-hero" style="' + lg.heroCss + '">'
    + (lg.noCover ? '<span class="letter">' + esc(lg.letter) + '</span>' : '') + '</div>'
    + '<div class="game-head"><div>'
    + '<div class="genre">' + esc(lg.genre) + '</div>'
    + '<h1>' + esc(lg.title) + '</h1></div>'
    + '<a href="' + esc(lg.itch) + '" target="_blank" rel="noopener" class="btn btn-primary">' + t.detail_play + '</a>'
    + '</div>'
    + '<p class="game-tagline">' + esc(lg.tagline) + '</p>'
    + '<div class="game-chips">'
    + '<span class="chip">' + esc(lg.statusLabel) + '</span>'
    + (lg.platforms ? '<span class="chip">' + esc(lg.platforms) + '</span>' : '')
    + (lg.jam ? '<span class="chip jam">🏆 ' + esc(lg.jam) + '</span>' : '')
    + '</div>'
    + '<div class="detail-grid">'
    + '<div class="detail-card"><div class="vm-label">' + t.detail_story + '</div><p>' + esc(lg.story) + '</p></div>'
    + '<div class="detail-card"><div class="vm-label teal">' + t.detail_gameplay + '</div><p>' + esc(lg.gameplay) + '</p></div>'
    + '</div>'
    + (lg.features.length ? '<div class="detail-label">' + t.detail_features + '</div><div class="features-grid">' + features + '</div>' : '')
    + (lg.shots.length ? '<div class="detail-label">' + t.detail_screens + '</div><div class="shots-grid">' + shots + '</div>' : '')
    + (lg.video ? '<div class="detail-label">' + t.detail_trailer + '</div>'
      + '<div class="trailer-box"><iframe src="https://www.youtube.com/embed/' + encodeURIComponent(lg.video) + '" title="trailer" '
      + 'allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>' : '')
    + '</main>';
}

// ---------------- hidden admin entries ----------------
// No visible "Admin" link anywhere. Entry points: Ctrl+Shift+A, #admin in the
// URL, or 5 quick clicks on the footer copyright line.
window.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) location.hash = '#admin';
});
(function () {
  let clicks = 0, last = 0;
  document.getElementById('footer-mark').addEventListener('click', () => {
    const now = Date.now();
    if (now - last > 1500) clicks = 0;
    clicks++; last = now;
    if (clicks >= 5) { clicks = 0; location.hash = '#admin'; }
  });
})();

// ---------------- boot ----------------
document.documentElement.lang = App.lang;
document.getElementById('footer-made').textContent = App.t.footer_made;
document.querySelector('.brand').addEventListener('click', () => {
  if (location.pathname !== '/' || location.hash) navigate('/');
  else window.scrollTo({ top: 0 });
});

// SPA link interception: same-origin path links navigate client-side;
// in-page anchors, downloads, target=_blank and external links stay native.
document.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
  let url;
  try { url = new URL(a.href); } catch (err) { return; }
  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.hash) return; // native anchor scroll
  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});

window.addEventListener('popstate', onRoute);
window.addEventListener('hashchange', () => {
  // only #admin enters/leaves a view via hash; section anchors scroll natively
  if (location.hash === '#admin' || App.view.name === 'admin') onRoute();
});

// Run after ALL scripts load (admin.js defines renderAdmin, which a direct
// #admin page load needs immediately) — DOMContentLoaded guarantees that.
document.addEventListener('DOMContentLoaded', function init() {
  // defaults render instantly; Firestore snapshot (if configured) refreshes on arrival
  App.content = clone(CONTENT_DEFAULTS);
  App.fb = initFirebase();
  onRoute();
});
