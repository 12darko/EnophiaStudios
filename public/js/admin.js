'use strict';
/* Enophia Studios — hidden admin panel (Firebase edition).
   Login: Firebase Authentication (email/password, managed by Google — built-in
   brute-force protection). Content: Firestore doc site/content; security rules
   allow public read, authenticated write. Edits are bound with data-path
   attributes and auto-saved (debounced setDoc). */

const Admin = {
  lang: 'tr',      // which language of the content is being edited (not the UI language)
  gameIdx: 0,
  blogIdx: 0,
  saveTimer: null,
  authWatcherOn: false,
  authReady: false,
  seedChecked: false,
  geminiKey: '',      // cached in memory; persisted in Firestore site/secrets (admin-only)
  groqKey: '',
  unsplashKey: '',
  githubToken: '',    // default GitHub PAT (fallback for all tracked repos)
  repoTokens: {},     // per-repo PAT map: "owner/repo" (lowercased) -> token; overrides githubToken
  provider: 'gemini', // 'gemini' | 'groq'
  aiSource: 'youtube',
  chat: [],           // ephemeral chat transcript (not saved)
  pendingActions: null,
  chatBusy: false,
};

function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
}

function slugify(s) {
  const map = { 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ı': 'i', 'ö': 'o', 'ç': 'c' };
  const cleaned = (s || '').toLowerCase().replace(/[ğüşıöç]/g, ch => map[ch] || ch)
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return cleaned || ('item-' + Date.now().toString(36));
}

function authErrorText(err) {
  const t = App.t, code = (err && err.code) || '';
  if (code === 'auth/too-many-requests') return t.login_err_rate;
  if (code === 'auth/invalid-email') return t.login_err_email;
  if (code === 'auth/network-request-failed') return t.login_err_server;
  if (code === 'auth/weak-password') return t.login_err_short;
  return t.login_err_wrong; // invalid-credential / wrong-password / user-not-found
}

// ---------------- saving (Firestore) ----------------
function setSaveStatus(cls) {
  const el = document.getElementById('save-status');
  if (!el) return;
  const t = App.t;
  el.className = 'save-status' + (cls === 'saving' ? ' saving' : cls === 'error' ? ' error' : '');
  el.innerHTML = '<span class="dot"></span>' + (cls === 'saving' ? t.admin_saving : cls === 'error' ? t.admin_save_err : t.admin_saved);
}

function scheduleSave() {
  setSaveStatus('saving');
  clearTimeout(Admin.saveTimer);
  Admin.saveTimer = setTimeout(saveNow, 700);
}

async function saveNow() {
  clearTimeout(Admin.saveTimer);
  if (!fbDb || !fbAuth || !fbAuth.currentUser) { setSaveStatus('error'); return; }
  try {
    await fbDb.collection('site').doc('content').set(App.content);
    setSaveStatus('saved');
  } catch (e) { setSaveStatus('error'); }
}

// ---------------- entry ----------------
function renderAdmin() {
  if (!App.fb) { renderFbSetup(); return; }
  if (!Admin.authWatcherOn) {
    Admin.authWatcherOn = true;
    fbAuth.onAuthStateChanged(() => {
      Admin.authReady = true;
      if (App.view.name === 'admin') renderAdmin();
    });
  }
  if (!Admin.authReady) {
    $app.innerHTML = '<main class="login-page"><div class="login-card"><span class="login-logo">E</span>'
      + '<p class="sub" style="margin:0;">…</p></div></main>';
    return;
  }
  if (fbAuth.currentUser) {
    if (!Admin.seedChecked) { ensureSeeded().then(renderPanel); }
    else renderPanel();
  } else {
    renderLogin();
  }
}

// On first login, publish ALL current content to Firestore so the database
// holds the full editable dataset (the user sees everything in the console and
// edits it from here). On later logins, pull the freshest saved content into
// the editor. Runs once per admin session.
async function ensureSeeded() {
  Admin.seedChecked = true;
  if (!fbDb) return;
  try {
    const ref = fbDb.collection('site').doc('content');
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set(App.content); // seed full defaults → visible in Firestore
    } else {
      App.content = deepMerge(clone(CONTENT_DEFAULTS), snap.data());
    }
  } catch (e) { console.warn('seed/load:', e && e.code); }
  await loadSecrets();
}

// ---------------- AI — keys in Firestore site/secrets (admin-only), calls from admin's browser ----------------
async function loadSecrets() {
  if (!fbDb) return;
  try {
    const snap = await fbDb.collection('site').doc('secrets').get();
    if (snap.exists) {
      const s = snap.data();
      Admin.geminiKey = s.geminiKey || '';
      Admin.groqKey = s.groqKey || '';
      Admin.unsplashKey = s.unsplashKey || '';
      Admin.githubToken = s.githubToken || '';
      Admin.repoTokens = (s.repoTokens && typeof s.repoTokens === 'object') ? s.repoTokens : {};
      if (s.aiProvider === 'groq' || s.aiProvider === 'gemini') Admin.provider = s.aiProvider;
    }
  } catch (e) { /* rules deny read unless authed — safe to ignore */ }
}

async function saveSecret(field, value) {
  const patch = {}; patch[field] = value;
  await fbDb.collection('site').doc('secrets').set(patch, { merge: true });
}

function activeLlmKey() { return Admin.provider === 'groq' ? Admin.groqKey : Admin.geminiKey; }

function parseJsonLoose(txt) {
  try { return JSON.parse(txt); }
  catch (e) {
    const c = String(txt).replace(/```json/gi, '').replace(/```/g, '').trim();
    const s = c.indexOf('{'), en = c.lastIndexOf('}');
    return JSON.parse(s >= 0 && en > s ? c.slice(s, en + 1) : c);
  }
}

// Provider-agnostic chat completion. history = [{role:'user'|'assistant', content}]
async function llmChat(system, history, wantJson) {
  const msgs = history.filter(m => m.role === 'user' || m.role === 'assistant');
  if (Admin.provider === 'groq') {
    if (!Admin.groqKey) throw new Error('no-key');
    const messages = [{ role: 'system', content: system }].concat(msgs.map(m => ({ role: m.role, content: m.content })));
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Admin.groqKey },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages, temperature: 0.7,
        response_format: wantJson ? { type: 'json_object' } : undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
    return data.choices[0].message.content;
  }
  if (!Admin.geminiKey) throw new Error('no-key');
  const contents = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(Admin.geminiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents,
      generationConfig: { temperature: 0.7, responseMimeType: wantJson ? 'application/json' : 'text/plain' } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
  return data.candidates[0].content.parts[0].text;
}

// Find a royalty-free cover image on Unsplash (LLMs can't browse the web themselves).
// Pull the top few relevant landscape photos and pick one at random so covers vary
// between posts instead of always returning the single #1 result.
async function unsplashImage(query) {
  if (!Admin.unsplashKey || !query) return '';
  try {
    const res = await fetch('https://api.unsplash.com/search/photos?per_page=8&orientation=landscape&content_filter=high&query=' + encodeURIComponent(query), {
      headers: { 'Authorization': 'Client-ID ' + Admin.unsplashKey },
    });
    const data = await res.json();
    const results = (data && data.results) || [];
    if (!results.length) return '';
    const r = results[Math.floor(Math.random() * results.length)];
    return r ? (r.urls.regular || r.urls.small || '') : '';
  } catch (e) { return ''; }
}

// Resolve the GitHub token for a repo: the repo's own token wins, else the default one.
function repoToken(owner, repo) {
  const key = (owner + '/' + repo).toLowerCase();
  return (Admin.repoTokens && Admin.repoTokens[key]) || Admin.githubToken || '';
}
function ghHeaders(owner, repo) {
  const H = { 'Accept': 'application/vnd.github+json' };
  const tok = repoToken(owner, repo);
  if (tok) H['Authorization'] = 'Bearer ' + tok;
  return H;
}

// Fetch a GitHub repo's recent activity to feed the LLM. Public repos need no auth;
// a stored GitHub token (per-repo or default) unlocks private repos + a higher rate limit.
// The LLM can't browse the web, so we gather the material and hand it over.
async function githubContext(owner, repo) {
  const H = ghHeaders(owner, repo);
  const base = 'https://api.github.com/repos/' + owner + '/' + repo;
  const repoRes = await fetch(base, { headers: H });
  if (!repoRes.ok) {
    throw new Error(repoRes.status === 404 ? 'repo bulunamadı (özel repo ise GitHub token gir)'
      : repoRes.status === 401 ? 'GitHub token geçersiz'
      : repoRes.status === 403 ? 'GitHub API limiti (biraz sonra dene)' : 'GitHub ' + repoRes.status);
  }
  const info = await repoRes.json();
  let commits = [];
  try { commits = await (await fetch(base + '/commits?per_page=20', { headers: H })).json(); } catch (e) {}
  let readme = '';
  try {
    const rd = await (await fetch(base + '/readme', { headers: H })).json();
    if (rd && rd.content) {
      const b64 = rd.content.replace(/\n/g, '');
      try { readme = decodeURIComponent(escape(atob(b64))); } catch (e) { readme = atob(b64); }
      readme = readme.slice(0, 1800);
    }
  } catch (e) {}
  const commitLines = (Array.isArray(commits) ? commits : []).slice(0, 20)
    .map(c => '- ' + String((c.commit && c.commit.message) || '').split('\n')[0]).join('\n');
  return 'GITHUB REPO: ' + owner + '/' + repo + '\n'
    + 'Aciklama: ' + (info.description || '-') + '\n'
    + 'Dil: ' + (info.language || '-') + ' · Yildiz: ' + (info.stargazers_count || 0)
    + (info.homepage ? ' · Site: ' + info.homepage : '') + '\n'
    + 'SON COMMITLER:\n' + (commitLines || '-') + '\n\n'
    + 'README (kisaltilmis):\n' + (readme || '-');
}

const BLOG_SYS = 'You are the devlog writer for Enophia Studios, an independent game studio. '
  + 'Write ONE blog post and return ONLY valid minified JSON with exactly these fields: '
  + '{"title_tr","title_en","excerpt_tr","excerpt_en","body_tr","body_en","image_query"}. '
  + 'title: short and catchy. excerpt: 1-2 sentences. body: 3-6 short paragraphs, plain text (no markdown). '
  + 'TONE: write like a REAL indie dev casually sharing progress with players — warm, natural, first person plural ("biz"/"we"), a little personality and humour. NOT corporate, NOT marketing hype, NOT robotic. Avoid AI/marketing cliches ("heyecanla duyuruyoruz", "oyun dunyasinda", "stay tuned", "thrilled to announce", "delve", "game-changer", "bir adim daha"). Short, human sentences, like talking to a friend. '
  + 'image_query: 2-4 English keywords describing an ATMOSPHERIC, CINEMATIC scene or environment that suits a dark-fantasy / mythology indie game — NOT the technical devlog topic. '
  + 'Good examples: "dark fantasy forest fog", "ancient temple ruins", "misty mountains dusk", "stormy sea mythology", "cinematic night sky stars", "abstract glowing particles". '
  + 'Never use software, coding, computer, office or desk words. '
  + 'The _tr fields in NATURAL Turkish, the _en fields in natural English (same post, not word-for-word). '
  + 'Turkish text MUST use correct Turkish letters (c->ç, g->ğ, i->ı/İ, o->ö, s->ş, u->ü where appropriate) and grammar — NEVER ASCII-ise it (write "Karanlık Fantezi Dünyamıza Doğru", never "Karanlik Fantazi Dunyamiza Dogru").';

// Repo tracking only: let the model skip trivial commits instead of posting on every push.
const REPO_SKIP_RULE = 'Also include a boolean field "skip" in the JSON. '
  + 'If the recent commits are only trivial/minor (typo, formatting/whitespace, "wip", config or dependency bumps, '
  + 'merge commits, renames, tiny fixes) and not worth a public devlog, set "skip":true and leave the post fields empty. '
  + 'Only write an actual post ("skip":false) when the changes are meaningful progress a player/reader would care about.';

// One-shot generator (AI Blog Üreteci). source = { type:'youtube'|'topic', value }
async function generateBlog(source) {
  if (source.type === 'youtube') {
    if (!Admin.geminiKey) throw new Error('YouTube: Gemini');
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(Admin.geminiKey), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: BLOG_SYS }] },
        contents: [{ role: 'user', parts: [{ fileData: { fileUri: source.value } }, { text: 'Write the post based on the linked video.' }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.85 } }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
    return parseJsonLoose(data.candidates[0].content.parts[0].text);
  }
  return parseJsonLoose(await llmChat(BLOG_SYS, [{ role: 'user', content: 'Topic / notes:\n' + source.value }], true));
}

// ---------------- chat assistant (edits any content, with a confirm step) ----------------
function agentContext() {
  const C = App.content;
  // Give the assistant enough to actually ANALYSE the studio (games, tone, existing
  // copy) before proposing vision/mission-style rewrites — not just the editable paths.
  return 'CURRENT CONTENT (studyoyu analiz etmek + path/index referansi icin):\n' + JSON.stringify({
    hero: C.hero, vision: C.vision, mission: C.mission, story: C.story,
    about: C.about, contact: C.contact, links: C.links, next: C.next,
    team: C.team.map((m, i) => ({ i: i, name: m.name, role: m.role })),
    games: C.games.map((g, i) => ({ i: i, title: g.title, genre: g.genre, tagline: g.tagline, story: g.story })),
    blogCount: Array.isArray(C.blog) ? C.blog.length : 0,
    updates: C.updates,
  });
}

const AGENT_SYS = [
  'Sen Enophia Studios bagimsiz oyun studyosunun site admin asistanisin.',
  'Kullanicinin istegini yerine getir ve SADECE gecerli JSON dondur, baska hicbir metin yazma.',
  'Sema: {"reply":"kullaniciya kisa Turkce yanit","actions":[...]}.',
  'actions bos [] olabilir (sadece sohbet/soru ise). Action tipleri:',
  '- Blog ekle: {"type":"add_post","title_tr","title_en","excerpt_tr","excerpt_en","body_tr","body_en","image_query":"2-4 ingilizce anahtar kelime ya da bos"}',
  '  image_query: teknik konuyu DEGIL, karanlik-fantezi / mitoloji temali bir oyuna yakisan ATMOSFERIK bir sahne/ortam tarif et (or: "dark fantasy forest fog", "ancient temple ruins", "misty mountains dusk"). Yazilim/kod/bilgisayar/ofis kelimeleri KULLANMA.',
  '- Alan degistir: {"type":"set","path":"NOKTALI_YOL","value":"YENI DEGER"}',
  'Gecerli path ornekleri: hero.title.tr, hero.title.en, hero.sub.tr, hero.sub.en, vision.tr, vision.en, mission.tr, mission.en, story.tr, story.en, about.lead.tr, about.lead.en, contact.sub.tr, contact.sub.en, links.email, links.itch, links.youtube1, links.youtube2, team.0.name, team.0.role.tr, team.0.role.en, games.0.title, games.0.tagline.tr, games.0.genre.tr, updates.count.',
  'Iki dilli bir alani degistiriyorsan hem .tr hem .en icin AYRI set action uret. Metinlerde markdown kullanma.',
  'SITE/PROJE ANALIZI: CURRENT CONTENT sana studyonun tum metinlerini ve oyunlarini (tur, tagline, hikaye) verir. Vizyon/misyon/hero/about/story gibi tanitim metinlerini "iyilestir / daha iyi yap / guncelle / profesyonellestir" denirse: once bu oyunlari, ortak temayi (or: mitoloji, karanlik-fantezi, atmosferik bulmaca) ve mevcut tonu ANALIZ et; sonra bu analize DAYALI, tutarli ve profesyonel bir oneri uret (ilgili set action(lar)i + onay adimi). Bu durumda "iyilestir" yeterli bir yondur, tekrar sorma.',
  'Metni yeniden yazarken: stüdyonun GERCEK bilgilerine (oyunlar, tema, ekip) dayan, olmayan oyun/ozellik/iddia/rakam UYDURMA; INSAN gibi dogal, samimi ve akici yaz (abartili pazarlama dili, yapay-zeka klisesi ve süslü laf yok); mevcut uzunluga yakin kal. Türkçe alanlarda MUTLAKA dogru Türkçe harflerle (ç ğ ı İ ö ş ü) dogal Türkçe, İngilizce alanlarda dogal İngilizce (birebir çeviri degil).',
  'Ama istek TAMAMEN bos/yonsuzse ya da hangi alani kastettigi belirsizse metni UYDURMA; actions bos birak ve reply ile kisaca ne istedigini sor.',
  'Yeni oyun veya ekip uyesi EKLEMEK gibi seyleri su an desteklemiyorsun; oyle bir istekte actions bos birak ve reply icinde bunun panelden yapilmasi gerektigini soyle.',
  'Emin olmadigin HER istekte degisiklik yapma; actions bos birak ve reply ile sor.',
].join('\n');

const CONTENT_TOP = ['hero', 'vision', 'mission', 'story', 'about', 'contact', 'links', 'team', 'games', 'next', 'updates'];

function describeAction(a) {
  if (!a || !a.type) return '';
  if (a.type === 'add_post') return 'Blog yazısı ekle: “' + (a.title_tr || a.title_en || '') + '”' + (a.image_query ? ' (+ görsel)' : '');
  if (a.type === 'set') return a.path + ' = ' + String(a.value == null ? '' : a.value).slice(0, 70);
  return a.type;
}

function setPathSafe(obj, parts, value) {
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) return false; // never invent new structures
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
  return true;
}

async function applyActions(actions) {
  for (const a of actions) {
    if (!a || !a.type) continue;
    if (a.type === 'add_post') {
      if (!App.content.blog) App.content.blog = [];
      let cover = '';
      if (a.image_query && Admin.unsplashKey) cover = await unsplashImage(a.image_query);
      App.content.blog.unshift({
        slug: slugify((a.title_en || a.title_tr || 'post') + '-' + Date.now().toString(36)),
        date: new Date().toISOString().slice(0, 10), cover: cover,
        title: { tr: a.title_tr || '', en: a.title_en || '' },
        excerpt: { tr: a.excerpt_tr || '', en: a.excerpt_en || '' },
        body: { tr: a.body_tr || '', en: a.body_en || '' },
      });
      Admin.blogIdx = 0;
    } else if (a.type === 'set' && typeof a.path === 'string') {
      const parts = a.path.split('.');
      if (CONTENT_TOP.indexOf(parts[0]) < 0) continue; // allowlist top-level content keys only
      let val = a.value;
      if (parts[parts.length - 1] === 'count') val = parseInt(val, 10) || 6;
      setPathSafe(App.content, parts, val);
    }
  }
  await saveNow();
}

// ---------------- Firebase not configured yet: show setup steps ----------------
function renderFbSetup() {
  const t = App.t;
  $app.innerHTML = '<main class="login-page" style="max-width:560px;"><div class="login-card">'
    + '<span class="login-logo">E</span>'
    + '<h1>' + t.fb_setup_title + '</h1>'
    + '<p class="sub">' + t.fb_setup_sub + '</p>'
    + '<ol style="margin:0 0 20px; padding-left:20px; color:#cdd2d8; font-size:14px; line-height:1.9;">'
    + '<li>' + t.fb_setup_s1 + '</li>'
    + '<li>' + t.fb_setup_s2 + '</li>'
    + '<li>' + t.fb_setup_s3 + '</li>'
    + '<li>' + t.fb_setup_s4 + '</li>'
    + '<li>' + t.fb_setup_s5 + '</li>'
    + '</ol>'
    + '<p class="sub" style="margin-bottom:0;">' + t.fb_setup_readme + '</p>'
    + '<button type="button" class="login-back" id="login-back">' + t.login_back + '</button>'
    + '</div></main>';
  document.getElementById('login-back').addEventListener('click', () => navigate('/'));
}

// ---------------- login (Firebase email/password) ----------------
function renderLogin() {
  const t = App.t;
  $app.innerHTML = '<main class="login-page"><div class="login-card">'
    + '<span class="login-logo">E</span>'
    + '<h1>' + t.login_enter_title + '</h1>'
    + '<p class="sub">' + t.login_enter_sub + '</p>'
    + '<form id="login-form">'
    + '<div class="field"><label>' + t.login_email_label + '</label><input class="input" type="email" id="le" autocomplete="username"></div>'
    + '<div class="field"><label>' + t.login_pass_label + '</label><input class="input" type="password" id="lp1" autocomplete="current-password"></div>'
    + '<p class="form-error" id="login-err" style="display:none;"></p>'
    + '<button type="submit" class="login-submit">' + t.login_enter_btn + '</button>'
    + '</form>'
    + '<button type="button" class="login-back" id="login-back">' + t.login_back + '</button>'
    + '</div></main>';

  document.getElementById('login-back').addEventListener('click', () => navigate('/'));
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('login-err');
    const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
    const email = document.getElementById('le').value.trim();
    const pass = document.getElementById('lp1').value;
    if (!email) return showErr(t.login_err_email);
    try {
      await fbAuth.signInWithEmailAndPassword(email, pass);
      renderAdmin(); // onAuthStateChanged also re-renders; this is just belt-and-suspenders
    } catch (err) { showErr(authErrorText(err)); }
  });
}

// ---------------- panel ----------------
function fld(label, path, value, extra) {
  return '<div class="field"><label>' + label + '</label>'
    + '<input class="input" data-path="' + path + '" value="' + esc(value) + '"' + (extra || '') + '></div>';
}

function fldArea(label, path, value, rows, kind) {
  return '<div class="field"><label>' + label + '</label>'
    + '<textarea class="input" data-path="' + path + '"' + (kind ? ' data-kind="' + kind + '"' : '') + ' rows="' + (rows || 3) + '">' + esc(value) + '</textarea></div>';
}

function sectionHead(icon, title, iconStyle) {
  return '<h2><span class="icon"' + (iconStyle || '') + '>' + icon + '</span>' + title + '</h2>';
}

function renderPanel() {
  const t = App.t, C = App.content, al = Admin.lang;
  Admin.gameIdx = Math.max(0, Math.min(Admin.gameIdx, C.games.length - 1));
  const gi = Admin.gameIdx;
  const g = C.games[gi];
  const posts = C.blog || [];
  Admin.blogIdx = Math.max(0, Math.min(Admin.blogIdx, posts.length - 1));
  const bi = Admin.blogIdx;
  const p = posts[bi];

  const gameTabs = C.games.map((x, i) =>
    '<button type="button" class="tab' + (i === gi ? ' on' : '') + '" data-action="game-tab" data-idx="' + i + '">' + esc(x.title) + '</button>'
  ).join('') + '<button type="button" class="tab-add" data-action="add-game">' + t.admin_add_game + '</button>';

  const blogTabs = posts.map((x, i) =>
    '<button type="button" class="tab' + (i === bi ? ' on' : '') + '" data-action="post-tab" data-idx="' + i + '">' + esc((x.title && (x.title[al] || x.title.tr)) || '(untitled)') + '</button>'
  ).join('') + '<button type="button" class="tab-add" data-action="add-post">' + t.admin_add_post + '</button>';

  const teamRows = C.team.map((m, i) =>
    '<div class="row-sep">'
    + '<div class="grid-2">'
    + fld(t.f_name, 'team.' + i + '.name', m.name)
    + fld(t.f_role, 'team.' + i + '.role.' + al, (m.role && m.role[al]) || '')
    + '</div>'
    + '<div class="grid-2">'
    + fld(t.f_handle, 'team.' + i + '.handle', m.handle || '')
    + fld(t.f_initials, 'team.' + i + '.initials', m.initials || '')
    + '</div>'
    + fld('LinkedIn URL', 'team.' + i + '.linkedin', m.linkedin || '')
    + '<button type="button" class="mini-danger" data-action="remove-member" data-idx="' + i + '">' + t.admin_remove_member + '</button>'
    + '</div>'
  ).join('');

  const nextRows = (C.next || []).map((n, i) =>
    '<div class="row-sep">'
    + '<div class="grid-2">'
    + fld(t.f_next_tag, 'next.' + i + '.tag.' + al, (n.tag && n.tag[al]) || '')
    + fld(t.f_next_h, 'next.' + i + '.h.' + al, (n.h && n.h[al]) || '')
    + '</div>'
    + fldArea(t.f_next_t, 'next.' + i + '.t.' + al, (n.t && n.t[al]) || '', 2)
    + '<button type="button" class="mini-danger" data-action="remove-next" data-idx="' + i + '">' + t.admin_remove_next + '</button>'
    + '</div>'
  ).join('');

  const userEmail = (fbAuth.currentUser && fbAuth.currentUser.email) || '';

  // section builder: id anchor + numbered header (clearer separation, more air)
  const sec = (id, n, icon, title, body, headExtra) =>
    '<section class="admin-section" id="sec-' + id + '">'
    + '<h2 class="sec-h"><span class="sec-num">' + n + '</span>'
    + '<span class="icon"' + (headExtra || '') + '>' + icon + '</span>' + title + '</h2>'
    + body + '</section>';

  const navItems = [
    ['hero', t.admin_s_hero], ['about', t.admin_s_about], ['next', t.admin_s_next],
    ['team', t.team_title], ['contact', t.admin_s_contact], ['links', t.admin_s_links],
    ['games', t.admin_s_games], ['ai', t.admin_s_ai], ['blog', t.admin_s_blog],
    ['autotrack', t.admin_s_autotrack], ['security', t.admin_s_security], ['chat', t.admin_s_chat],
  ];
  const navHtml = navItems.map(x =>
    '<button type="button" class="nav-chip" data-action="jump" data-target="sec-' + x[0] + '">' + x[1] + '</button>'
  ).join('');

  // ---- section bodies ----
  const heroBody = fld(t.f_hero_title, 'hero.title.' + al, C.hero.title[al])
    + fldArea(t.f_hero_sub, 'hero.sub.' + al, C.hero.sub[al], 3);

  const aboutBody = fldArea(t.vision_h, 'vision.' + al, C.vision[al], 3)
    + fldArea(t.mission_h, 'mission.' + al, C.mission[al], 3)
    + fldArea(t.f_story, 'story.' + al, C.story[al], 3)
    + fldArea(t.f_about_lead, 'about.lead.' + al, C.about.lead[al], 2);

  const nextBody = nextRows
    + '<button type="button" class="mini-add" data-action="add-next">' + t.admin_add_next + '</button>';

  const teamBody = teamRows
    + '<button type="button" class="mini-add" data-action="add-member">' + t.admin_add_member + '</button>';

  const contactBody = fldArea(t.f_contact_sub, 'contact.sub.' + al, C.contact.sub[al], 2);

  const linksBody = fld('itch.io', 'links.itch', C.links.itch)
    + fld('E-mail', 'links.email', C.links.email)
    + fld('YouTube 1', 'links.youtube1', C.links.youtube1)
    + fld('YouTube 2', 'links.youtube2', C.links.youtube2)
    + fld('LinkedIn — 1', 'links.linkedin1', C.links.linkedin1)
    + fld('LinkedIn — 2', 'links.linkedin2', C.links.linkedin2);

  const gamesBody = '<div class="tabs">' + gameTabs + '</div>'
    + (g ? (
      '<button type="button" class="mini-danger" style="margin-bottom:20px;" data-action="remove-game">' + t.admin_remove_game + '</button>'
      + fld(t.f_game_title, 'games.' + gi + '.title', g.title)
      + '<div class="check-row"><input type="checkbox" data-path="games.' + gi + '.hasDetail"' + (g.hasDetail ? ' checked' : '') + ' id="chk-detail"><label for="chk-detail" style="cursor:pointer;">' + t.f_has_detail + '</label></div>'
      + '<div class="grid-2">'
      + fld(t.f_genre, 'games.' + gi + '.genre.' + al, (g.genre && g.genre[al]) || '')
      + fld(t.f_platforms, 'games.' + gi + '.platforms', g.platforms || '')
      + '</div>'
      + fld(t.f_tagline, 'games.' + gi + '.tagline.' + al, (g.tagline && g.tagline[al]) || '')
      + fldArea(t.detail_story, 'games.' + gi + '.story.' + al, (g.story && g.story[al]) || '', 3)
      + fldArea(t.detail_gameplay, 'games.' + gi + '.gameplay.' + al, (g.gameplay && g.gameplay[al]) || '', 3)
      + fldArea(t.f_features, 'games.' + gi + '.features.' + al, ((g.features && g.features[al]) || []).join('\n'), 4, 'lines')
      + '<div class="grid-2">'
      + fld(t.f_jam, 'games.' + gi + '.jam', g.jam || '')
      + fld(t.f_video, 'games.' + gi + '.video', g.video || '')
      + '</div>'
      + '<div class="grid-2">'
      + fld(t.f_itch, 'games.' + gi + '.itch', g.itch || '')
      + fld(t.f_accent, 'games.' + gi + '.accent', g.accent || '#e0a85e')
      + '</div>'
      + fld(t.f_cover, 'games.' + gi + '.cover', g.cover || '')
      + fldArea(t.f_shots, 'games.' + gi + '.shots', (g.shots || []).join('\n'), 3, 'lines')
    ) : '');

  const uCfg = C.updates || {};
  const sliderBody = '<div class="slider-settings">'
    + '<div class="slider-settings-h">' + t.updates_settings_h + '</div>'
    + '<div class="check-row" style="margin-bottom:12px;"><input type="checkbox" data-path="updates.enabled"' + (uCfg.enabled !== false ? ' checked' : '') + ' id="chk-updates"><label for="chk-updates" style="cursor:pointer;">' + t.updates_enable_label + '</label></div>'
    + '<div class="field" style="max-width:220px;margin-bottom:0;"><label>' + t.updates_count_label + '</label><input class="input" type="number" min="1" max="12" data-path="updates.count" value="' + esc(uCfg.count != null ? uCfg.count : 6) + '"></div>'
    + '</div>';

  const blogBody = sliderBody + '<div class="tabs">' + blogTabs + '</div>'
    + (p ? (
      '<button type="button" class="mini-danger" style="margin-bottom:20px;" data-action="remove-post">' + t.admin_remove_post + '</button>'
      + fld(t.f_blog_title, 'blog.' + bi + '.title.' + al, (p.title && p.title[al]) || '')
      + '<div class="grid-2">'
      + fld(t.f_blog_date, 'blog.' + bi + '.date', p.date || '')
      + fld(t.f_blog_cover, 'blog.' + bi + '.cover', p.cover || '')
      + '</div>'
      + fldArea(t.f_blog_excerpt, 'blog.' + bi + '.excerpt.' + al, (p.excerpt && p.excerpt[al]) || '', 2)
      + fldArea(t.f_blog_body, 'blog.' + bi + '.body.' + al, (p.body && p.body[al]) || '', 8)
    ) : '<p class="hint" style="font-size:13.5px;">' + t.admin_no_posts + '</p>');

  // ---- AI blog generator + provider/keys ----
  const prov = Admin.provider || 'gemini';
  const provKeySet = prov === 'groq' ? !!Admin.groqKey : !!Admin.geminiKey;
  const provKeyLabel = prov === 'groq' ? t.ai_groq_key_label : t.ai_gemini_key_label;
  const provKeyUrl = prov === 'groq' ? 'https://console.groq.com/keys' : 'https://aistudio.google.com/apikey';
  const aiSrc = Admin.aiSource || 'youtube';
  const aiBody =
    '<p class="hint" style="margin:0 0 18px;">' + t.ai_note + '</p>'
    + '<div class="field"><label>' + t.ai_provider_label + '</label><div class="seg">'
      + '<button type="button" class="seg-btn' + (prov === 'gemini' ? ' on' : '') + '" data-action="ai-provider" data-prov="gemini">Gemini</button>'
      + '<button type="button" class="seg-btn' + (prov === 'groq' ? ' on' : '') + '" data-action="ai-provider" data-prov="groq">Groq</button>'
      + '</div></div>'
    + '<div class="field"><label>' + provKeyLabel
      + ' · <a href="' + provKeyUrl + '" target="_blank" rel="noopener" style="color:#5bc0be; text-decoration:none;">' + t.ai_key_get + '</a></label>'
      + '<div class="key-row"><input class="input" type="password" id="ai-key" placeholder="' + esc(t.ai_key_ph) + '"' + (provKeySet ? ' value="••••••••••••"' : '') + '>'
      + '<button type="button" class="tb-btn tb-ghost" data-action="ai-save-key">' + t.ai_key_save + '</button></div>'
      + '<p class="form-ok" id="ai-key-msg" style="display:' + (provKeySet ? 'block' : 'none') + ';">' + t.ai_key_saved + '</p></div>'
    + '<div class="field"><label>' + t.ai_unsplash_label
      + ' · <a href="https://unsplash.com/oauth/applications" target="_blank" rel="noopener" style="color:#5bc0be; text-decoration:none;">' + t.ai_unsplash_get + '</a></label>'
      + '<div class="key-row"><input class="input" type="password" id="unsplash-key" placeholder="' + esc(t.ai_unsplash_ph) + '"' + (Admin.unsplashKey ? ' value="••••••••••••"' : '') + '>'
      + '<button type="button" class="tb-btn tb-ghost" data-action="ai-save-unsplash">' + t.ai_key_save + '</button></div>'
      + '<p class="form-ok" id="unsplash-msg" style="display:' + (Admin.unsplashKey ? 'block' : 'none') + ';">' + t.ai_key_saved + '</p></div>'
    + '<div class="field"><label>' + t.ai_source_label + '</label><div class="seg">'
      + '<button type="button" class="seg-btn' + (aiSrc === 'youtube' ? ' on' : '') + '" data-action="ai-src" data-src="youtube">' + t.ai_source_youtube + '</button>'
      + '<button type="button" class="seg-btn' + (aiSrc === 'topic' ? ' on' : '') + '" data-action="ai-src" data-src="topic">' + t.ai_source_topic + '</button>'
      + '</div></div>'
    + '<div class="field" id="ai-input-yt"' + (aiSrc === 'youtube' ? '' : ' style="display:none;"') + '><input class="input" id="ai-youtube" placeholder="' + esc(t.ai_youtube_ph) + '"></div>'
    + '<div class="field" id="ai-input-topic"' + (aiSrc === 'topic' ? '' : ' style="display:none;"') + '><textarea class="input" id="ai-topic" rows="3" placeholder="' + esc(t.ai_topic_ph) + '"></textarea></div>'
    + '<button type="button" class="tb-btn tb-primary" id="ai-gen-btn" data-action="ai-generate">✦ ' + t.ai_generate + '</button>'
    + '<p class="form-error" id="ai-err" style="display:none;"></p>'
    + '<p class="form-ok" id="ai-ok" style="display:none;"></p>';

  // ---- AI assistant chat (bottom of panel) ----
  const chatLog = Admin.chat.length
    ? Admin.chat.map(m => '<div class="chat-msg ' + m.role + '">' + esc(m.content).replace(/\n/g, '<br>') + '</div>').join('')
      + (Admin.chatBusy ? '<div class="chat-msg note">' + t.chat_thinking + '</div>' : '')
    : '<div class="chat-empty">' + t.chat_empty + '</div>';
  const confirmCard = Admin.pendingActions && Admin.pendingActions.length
    ? '<div class="chat-confirm"><div class="chat-confirm-h">' + t.chat_confirm_h + '</div><ul>'
      + Admin.pendingActions.map(a => '<li>' + esc(describeAction(a)) + '</li>').join('')
      + '</ul><div class="chat-confirm-btns">'
      + '<button type="button" class="tb-btn tb-primary" data-action="chat-apply">' + t.chat_apply + '</button>'
      + '<button type="button" class="tb-btn tb-ghost" data-action="chat-cancel">' + t.chat_cancel + '</button>'
      + '</div></div>'
    : '';
  const chatBody = '<p class="hint" style="margin:0 0 14px;">' + t.chat_note + '</p>'
    + '<div class="chat-log" id="chat-log">' + chatLog + '</div>'
    + confirmCard
    + '<div class="chat-input-row"><textarea class="input" id="chat-input" rows="2" placeholder="' + esc(t.chat_ph) + '"' + (Admin.chatBusy ? ' disabled' : '') + '></textarea>'
    + '<button type="button" class="tb-btn tb-primary" id="chat-send" data-action="chat-send"' + (Admin.chatBusy ? ' disabled' : '') + '>' + t.chat_send + '</button></div>'
    + '<p class="form-error" id="chat-err" style="display:none;"></p>';

  // ---- repo tracking (auto blog) ----
  const at = C.autotrack || { repos: [], lastSeen: {} };
  const repoRows = (at.repos || []).map((r, i) => {
    const rm = String(r.url || '').match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
    const rkey = rm ? (rm[1] + '/' + rm[2].replace(/\.git$/, '')).toLowerCase() : '';
    const hasTok = !!(rkey && Admin.repoTokens[rkey]);
    return '<div class="row-sep"><div class="grid-2">'
    + fld('GitHub repo URL', 'autotrack.repos.' + i + '.url', r.url || '')
    + '<div class="field"><label>' + t.autotrack_lang + '</label>'
      + '<select class="input" data-path="autotrack.repos.' + i + '.lang">'
      + '<option value="both"' + (!r.lang || r.lang === 'both' ? ' selected' : '') + '>TR + EN</option>'
      + '<option value="tr"' + (r.lang === 'tr' ? ' selected' : '') + '>TR</option>'
      + '<option value="en"' + (r.lang === 'en' ? ' selected' : '') + '>EN</option></select></div>'
    + '</div>'
    + '<div class="field"><label>' + t.github_token_label + '</label>'
      + '<div class="key-row"><input class="input" type="password" id="repo-token-' + i + '" placeholder="' + esc(t.github_token_ph) + '"' + (hasTok ? ' value="••••••••••••"' : '') + '>'
      + '<button type="button" class="tb-btn tb-ghost" data-action="repo-save-token" data-idx="' + i + '">' + t.ai_key_save + '</button></div>'
      + '<p class="hint" style="margin:6px 0 0; font-size:12px;">' + t.github_token_row_note + '</p></div>'
    + '<button type="button" class="mini-danger" data-action="repo-remove" data-idx="' + i + '">' + t.admin_remove_member + '</button>'
    + '</div>';
  }).join('');
  const repoBody = '<p class="hint" style="margin:0 0 16px;">' + t.autotrack_note + '</p>'
    + '<div class="field"><label>' + t.github_token_label
      + ' · <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener" style="color:#5bc0be; text-decoration:none;">' + t.github_token_get + '</a></label>'
      + '<div class="key-row"><input class="input" type="password" id="github-token" placeholder="' + esc(t.github_token_ph) + '"' + (Admin.githubToken ? ' value="••••••••••••"' : '') + '>'
      + '<button type="button" class="tb-btn tb-ghost" data-action="ai-save-github">' + t.ai_key_save + '</button></div>'
      + '<p class="hint" style="margin:6px 0 0; font-size:12px;">' + t.github_token_note + '</p>'
      + '<p class="form-ok" id="github-msg" style="display:' + (Admin.githubToken ? 'block' : 'none') + ';">' + t.ai_key_saved + '</p></div>'
    + repoRows
    + '<button type="button" class="mini-add" data-action="repo-add">' + t.autotrack_add + '</button>'
    + '<div style="margin-top:22px;"><button type="button" class="tb-btn tb-primary" id="repo-check-btn" data-action="repo-check">' + t.autotrack_check + '</button></div>'
    + '<p class="form-error" id="repo-err" style="display:none;"></p>'
    + '<p class="form-ok" id="repo-ok" style="display:none;"></p>';

  const securityBody = '<p class="hint" style="margin:0 0 16px; font-size:13px;">' + t.admin_security_note + '</p>'
    + '<form id="pass-form">'
    + '<div class="field"><label>' + t.f_cur_pass + '</label><input class="input" type="password" id="cp0" autocomplete="current-password"></div>'
    + '<div class="grid-2">'
    + '<div class="field"><label>' + t.f_new_pass + '</label><input class="input" type="password" id="cp1" autocomplete="new-password"></div>'
    + '<div class="field"><label>' + t.f_new_pass2 + '</label><input class="input" type="password" id="cp2" autocomplete="new-password"></div>'
    + '</div>'
    + '<p class="form-error" id="pass-err" style="display:none;"></p>'
    + '<p class="form-ok" id="pass-ok" style="display:none;">' + t.pass_changed + '</p>'
    + '<button type="submit" class="tb-btn tb-ghost">' + t.btn_change_pass + '</button>'
    + '</form>';

  $app.innerHTML = '<main class="admin-page">'
    // banner
    + '<div class="admin-banner"><div class="admin-banner-inner">'
    + '<div class="admin-banner-top">'
    + '<div class="admin-id"><span class="admin-logo">E</span><div>'
    + '<h1>' + t.admin_title + '</h1>'
    + '<div class="save-status" id="save-status"><span class="dot"></span>' + t.admin_saved + '</div>'
    + '</div></div>'
    + '<div class="admin-actions">'
    + '<div class="lang-toggle">'
    + '<button type="button" data-action="admin-lang" data-lang="tr" class="' + (al === 'tr' ? 'on' : '') + '">TR</button>'
    + '<button type="button" data-action="admin-lang" data-lang="en" class="' + (al === 'en' ? 'on' : '') + '">EN</button>'
    + '</div>'
    + '<button type="button" class="btn-danger-sm" data-action="logout">' + t.admin_logout + '</button>'
    + '</div></div>'
    + '<p class="admin-banner-sub">' + t.admin_sub + '</p>'
    + '<p class="admin-banner-sub hint" style="margin-top:8px;">' + t.admin_lang_note
    + (userEmail ? ' · <span style="color:#5bc0be;">' + esc(userEmail) + '</span>' : '') + '</p>'
    + '</div></div>'
    // toolbar
    + '<div class="admin-toolbar">'
    + '<button type="button" class="tb-btn tb-primary" data-action="export">↓ ' + t.admin_export + '</button>'
    + '<label class="tb-btn tb-ghost">↑ ' + t.admin_import + '<input type="file" id="import-file" accept="application/json,.json" style="display:none;"></label>'
    + '<button type="button" class="tb-btn tb-danger" data-action="reset">↺ ' + t.admin_reset + '</button>'
    + '<button type="button" class="tb-btn tb-ghost tb-right" data-action="view-site">' + t.admin_view_site + ' ↗</button>'
    + '</div>'
    // section navigation (jump links)
    + '<nav class="admin-nav"><span class="admin-nav-title">' + t.admin_nav_title + '</span>' + navHtml + '</nav>'
    // sections
    + sec('hero', 1, '✦', t.admin_s_hero, heroBody)
    + sec('about', 2, '◷', t.admin_s_about, aboutBody)
    + sec('next', 3, '▸', t.admin_s_next, nextBody)
    + sec('team', 4, '◍', t.team_title, teamBody)
    + sec('contact', 5, '✉', t.admin_s_contact, contactBody)
    + sec('links', 6, '⚲', t.admin_s_links, linksBody)
    + sec('games', 7, '✦', t.admin_s_games, gamesBody)
    + sec('ai', 8, '✦', t.admin_s_ai, aiBody, ' style="background:rgba(155,108,216,0.16);border-color:rgba(155,108,216,0.32);color:#b98be0;"')
    + sec('blog', 9, '✎', t.admin_s_blog, blogBody)
    + sec('autotrack', 10, '❯', t.admin_s_autotrack, repoBody, ' style="background:rgba(91,140,255,0.14);border-color:rgba(91,140,255,0.3);color:#7fa0ff;"')
    + sec('security', 11, '⚿', t.admin_s_security, securityBody, ' style="background:rgba(91,192,190,0.14);border-color:rgba(91,192,190,0.28);color:#5bc0be;"')
    + sec('chat', 12, '✦', t.admin_s_chat, chatBody, ' style="background:rgba(155,108,216,0.16);border-color:rgba(155,108,216,0.32);color:#b98be0;"')
    + '</main>';

  bindPanel();
}

// ---------------- panel events ----------------
function bindPanel() {
  // Listeners go on the freshly created .admin-page element (not on the
  // persistent #app container) so re-renders never stack duplicate handlers.
  const t = App.t, root = $app.querySelector('.admin-page');

  // live data binding for every input/textarea/checkbox with a data-path
  root.addEventListener('input', e => {
    const el = e.target;
    const pathStr = el.dataset && el.dataset.path;
    if (!pathStr) return;
    let val;
    if (el.type === 'checkbox') val = el.checked;
    else if (el.dataset.kind === 'lines') val = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    else val = el.value;
    setPath(App.content, pathStr.split('.'), val);
    scheduleSave();
  });

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.idx || '0', 10);
    const C = App.content;

    switch (action) {
      case 'admin-lang':
        Admin.lang = btn.dataset.lang;
        renderPanel();
        break;
      case 'view-site':
        navigate('/');
        break;
      case 'logout':
        try { await fbAuth.signOut(); } catch (err) {}
        renderAdmin();
        break;
      case 'game-tab':
        Admin.gameIdx = idx; renderPanel();
        break;
      case 'post-tab':
        Admin.blogIdx = idx; renderPanel();
        break;
      case 'add-game': {
        const n = C.games.length + 1;
        C.games.push({
          slug: slugify('game-' + Date.now().toString(36)), hasDetail: true, accent: '#e0a85e',
          title: t.admin_new_game + ' ' + n, itch: '', cover: '', platforms: '', jam: '', video: '', shots: [],
          genre: { tr: '', en: '' }, tagline: { tr: '', en: '' },
          story: { tr: '', en: '' }, gameplay: { tr: '', en: '' }, features: { tr: [], en: [] },
        });
        Admin.gameIdx = C.games.length - 1;
        await saveNow(); renderPanel();
        break;
      }
      case 'remove-game':
        if (!confirm(t.admin_remove_game_confirm)) return;
        C.games.splice(Admin.gameIdx, 1);
        Admin.gameIdx = Math.max(0, Admin.gameIdx - 1);
        await saveNow(); renderPanel();
        break;
      case 'add-post':
        if (!C.blog) C.blog = [];
        C.blog.unshift({
          slug: slugify('post-' + Date.now().toString(36)),
          date: new Date().toISOString().slice(0, 10), cover: '',
          title: { tr: 'Yeni Yazı', en: 'New Post' },
          excerpt: { tr: '', en: '' }, body: { tr: '', en: '' },
        });
        Admin.blogIdx = 0;
        await saveNow(); renderPanel();
        break;
      case 'remove-post':
        if (!confirm(t.admin_remove_post_confirm)) return;
        C.blog.splice(Admin.blogIdx, 1);
        Admin.blogIdx = Math.max(0, Admin.blogIdx - 1);
        await saveNow(); renderPanel();
        break;
      case 'add-member':
        C.team.push({ name: t.admin_new_member, handle: 'handle', role: { tr: 'Geliştirici', en: 'Developer' }, linkedin: '', initials: 'XX' });
        await saveNow(); renderPanel();
        break;
      case 'remove-member':
        if (!confirm(t.admin_remove_member_confirm)) return;
        C.team.splice(idx, 1);
        await saveNow(); renderPanel();
        break;
      case 'add-next':
        if (!C.next) C.next = [];
        C.next.push({ tag: { tr: '', en: '' }, h: { tr: '', en: '' }, t: { tr: '', en: '' } });
        await saveNow(); renderPanel();
        break;
      case 'remove-next':
        C.next.splice(idx, 1);
        await saveNow(); renderPanel();
        break;
      case 'export': {
        const blob = new Blob([JSON.stringify(App.content, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'enophia-content.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        break;
      }
      case 'reset': {
        if (!confirm(t.admin_reset_confirm)) return;
        App.content = clone(CONTENT_DEFAULTS);
        await saveNow();
        renderPanel();
        break;
      }
      case 'jump': {
        const el = document.getElementById(btn.dataset.target);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
      case 'ai-src': {
        Admin.aiSource = btn.dataset.src;
        root.querySelectorAll('[data-action="ai-src"]').forEach(b => b.classList.toggle('on', b.dataset.src === Admin.aiSource));
        document.getElementById('ai-input-yt').style.display = Admin.aiSource === 'youtube' ? '' : 'none';
        document.getElementById('ai-input-topic').style.display = Admin.aiSource === 'topic' ? '' : 'none';
        break;
      }
      case 'ai-provider': {
        Admin.provider = btn.dataset.prov;
        try { await saveSecret('aiProvider', Admin.provider); } catch (e) {}
        renderPanel();
        break;
      }
      case 'ai-save-key': {
        const inp = document.getElementById('ai-key');
        const val = (inp.value || '').trim();
        const errEl = document.getElementById('ai-err');
        errEl.style.display = 'none';
        if (!val || val.charAt(0) === '•') return; // empty or unchanged mask
        try {
          const field = Admin.provider === 'groq' ? 'groqKey' : 'geminiKey';
          await saveSecret(field, val);
          if (Admin.provider === 'groq') Admin.groqKey = val; else Admin.geminiKey = val;
          document.getElementById('ai-key-msg').style.display = 'block';
          inp.value = '••••••••••••';
        } catch (err) {
          errEl.textContent = t.ai_err + ': ' + (err.message || err);
          errEl.style.display = 'block';
        }
        break;
      }
      case 'ai-save-unsplash': {
        const inp = document.getElementById('unsplash-key');
        const val = (inp.value || '').trim();
        if (!val || val.charAt(0) === '•') return;
        try {
          await saveSecret('unsplashKey', val);
          Admin.unsplashKey = val;
          document.getElementById('unsplash-msg').style.display = 'block';
          inp.value = '••••••••••••';
        } catch (err) {
          const errEl = document.getElementById('ai-err');
          errEl.textContent = t.ai_err + ': ' + (err.message || err); errEl.style.display = 'block';
        }
        break;
      }
      case 'ai-save-github': {
        const inp = document.getElementById('github-token');
        const val = (inp.value || '').trim();
        if (val.charAt(0) === '•') return; // unchanged mask
        try {
          await saveSecret('githubToken', val);
          Admin.githubToken = val;
          document.getElementById('github-msg').style.display = 'block';
          inp.value = val ? '••••••••••••' : '';
        } catch (err) {
          const errEl = document.getElementById('repo-err');
          errEl.textContent = t.ai_err + ': ' + (err.message || err); errEl.style.display = 'block';
        }
        break;
      }
      case 'chat-send': {
        const inp = document.getElementById('chat-input');
        const msg = (inp.value || '').trim();
        if (!msg) return;
        if (!activeLlmKey()) {
          const ce = document.getElementById('chat-err');
          ce.textContent = t.chat_key_missing; ce.style.display = 'block';
          return;
        }
        Admin.chat.push({ role: 'user', content: msg });
        Admin.pendingActions = null;
        Admin.chatBusy = true;
        renderPanel();
        // If a GitHub repo URL is present, fetch its activity and hand it to the LLM.
        let extra = '';
        const gh = msg.match(/https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/i);
        if (gh) {
          try {
            const ctx = await githubContext(gh[1], gh[2].replace(/\.git$/, ''));
            extra = '\n\n' + ctx
              + '\n\nYukaridaki GitHub repo aktivitesinden yararlanarak istenen dilde DOLU ve DETAYLI bir devlog blog yazisi olustur (add_post action; body_tr ve body_en en az 4-6 paragraf). image_query alanina uygun ingilizce anahtar kelimeler koy.';
          } catch (e) {
            extra = '\n\n(GitHub verisi alinamadi: ' + (e.message || e) + ')';
          }
        }
        try {
          const raw = await llmChat(AGENT_SYS + '\n\n' + agentContext() + extra, Admin.chat, true);
          let obj; try { obj = parseJsonLoose(raw); } catch (e) { obj = { reply: raw, actions: [] }; }
          Admin.chat.push({ role: 'assistant', content: obj.reply || '…' });
          Admin.pendingActions = (obj.actions && obj.actions.length) ? obj.actions : null;
        } catch (err) {
          Admin.chat.push({ role: 'note', content: t.ai_err + ': ' + (err.message || err) });
        }
        Admin.chatBusy = false;
        renderPanel();
        break;
      }
      case 'chat-apply': {
        const acts = Admin.pendingActions || [];
        Admin.pendingActions = null;
        Admin.chatBusy = true; renderPanel();
        try { await applyActions(acts); Admin.chat.push({ role: 'note', content: t.chat_applied }); }
        catch (err) { Admin.chat.push({ role: 'note', content: t.ai_err + ': ' + (err.message || err) }); }
        Admin.chatBusy = false; renderPanel();
        break;
      }
      case 'chat-cancel':
        Admin.pendingActions = null; renderPanel();
        break;
      case 'repo-add':
        if (!C.autotrack) C.autotrack = { repos: [], lastSeen: {} };
        if (!C.autotrack.repos) C.autotrack.repos = [];
        C.autotrack.repos.push({ url: '', lang: 'both' });
        await saveNow(); renderPanel();
        break;
      case 'repo-remove':
        C.autotrack.repos.splice(idx, 1);
        await saveNow(); renderPanel();
        break;
      case 'repo-save-token': {
        const r = (C.autotrack && C.autotrack.repos) ? C.autotrack.repos[idx] : null;
        const inp = document.getElementById('repo-token-' + idx);
        const errEl = document.getElementById('repo-err'), okEl = document.getElementById('repo-ok');
        if (errEl) errEl.style.display = 'none';
        if (okEl) okEl.style.display = 'none';
        if (!r || !inp) return;
        const val = (inp.value || '').trim();
        if (val.charAt(0) === '•') return; // unchanged mask
        const m = String(r.url || '').match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
        if (!m) { if (errEl) { errEl.textContent = t.github_token_need_url; errEl.style.display = 'block'; } return; }
        const key = (m[1] + '/' + m[2].replace(/\.git$/, '')).toLowerCase();
        try {
          Admin.repoTokens[key] = val; // '' clears it (falls back to default token)
          await saveSecret('repoTokens', Admin.repoTokens);
          inp.value = val ? '••••••••••••' : '';
          if (okEl) { okEl.textContent = t.ai_key_saved; okEl.style.display = 'block'; }
        } catch (err) {
          if (errEl) { errEl.textContent = t.ai_err + ': ' + (err.message || err); errEl.style.display = 'block'; }
        }
        break;
      }
      case 'repo-check': {
        const okEl = document.getElementById('repo-ok'), errEl = document.getElementById('repo-err');
        okEl.style.display = 'none'; errEl.style.display = 'none';
        if (!C.autotrack) C.autotrack = { repos: [], lastSeen: {} };
        if (!C.autotrack.lastSeen) C.autotrack.lastSeen = {};
        const repos = (C.autotrack.repos || []).filter(r => r.url);
        if (!repos.length) { errEl.textContent = t.autotrack_no_repos; errEl.style.display = 'block'; return; }
        if (!activeLlmKey()) { errEl.textContent = t.chat_key_missing; errEl.style.display = 'block'; return; }
        const cbtn = document.getElementById('repo-check-btn');
        cbtn.disabled = true; cbtn.textContent = t.autotrack_checking;
        let made = 0, checked = 0, skipped = 0; const errs = [];
        for (const r of repos) {
          const m = String(r.url).match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
          if (!m) continue;
          const owner = m[1], repo = m[2].replace(/\.git$/, ''), key = owner + '/' + repo;
          checked++;
          try {
            const head = await fetch('https://api.github.com/repos/' + owner + '/' + repo + '/commits?per_page=1', { headers: ghHeaders(owner, repo) }).then(x => x.json());
            if (!Array.isArray(head)) { // 404/401/403 → private repo without a valid token, or rate limit
              errs.push(key + ': ' + ((head && head.message) || 'repo okunamadı') + ' (private ise token gir)');
              continue;
            }
            const sha = head[0] ? head[0].sha : null;
            if (!sha || C.autotrack.lastSeen[key] === sha) continue; // no new commit
            const ctx = await githubContext(owner, repo);
            const langLine = r.lang === 'tr' ? 'Öncelikli dil Türkçe.' : r.lang === 'en' ? 'Primary language English.' : 'TR + EN.';
            const obj = parseJsonLoose(await llmChat(BLOG_SYS + '\n' + langLine + '\n' + REPO_SKIP_RULE,
              [{ role: 'user', content: 'GitHub repo activity:\n' + ctx + '\n\nDecide if this is worth a devlog post; if yes, write it.' }], true));
            if (obj && obj.skip === true) { C.autotrack.lastSeen[key] = sha; skipped++; continue; } // trivial commits — no post
            let cover = '';
            if (obj.image_query && Admin.unsplashKey) { try { cover = await unsplashImage(obj.image_query); } catch (e) {} }
            if (!C.blog) C.blog = [];
            C.blog.unshift({
              slug: slugify((obj.title_en || obj.title_tr || repo) + '-' + Date.now().toString(36)),
              date: new Date().toISOString().slice(0, 10), cover: cover,
              title: { tr: obj.title_tr || '', en: obj.title_en || '' },
              excerpt: { tr: obj.excerpt_tr || '', en: obj.excerpt_en || '' },
              body: { tr: obj.body_tr || '', en: obj.body_en || '' },
            });
            C.autotrack.lastSeen[key] = sha;
            made++;
          } catch (e) { errs.push(key + ': ' + (e.message || e)); }
        }
        await saveNow();
        renderPanel();
        const fresh = document.getElementById('repo-ok'), freshErr = document.getElementById('repo-err');
        if (fresh) {
          let msg = made ? (made + ' ' + t.autotrack_result_1 + ' (' + checked + ' repo)')
            : (skipped ? (skipped + ' ' + t.autotrack_skipped) : t.autotrack_none);
          fresh.textContent = msg; fresh.style.display = 'block';
        }
        if (errs.length && freshErr) { freshErr.textContent = t.ai_err + ': ' + errs.join(' · '); freshErr.style.display = 'block'; }
        break;
      }
      case 'ai-generate': {
        const okEl = document.getElementById('ai-ok'), errEl = document.getElementById('ai-err');
        okEl.style.display = 'none'; errEl.style.display = 'none';
        const src = Admin.aiSource || 'youtube';
        const needGemini = src === 'youtube';
        if ((needGemini && !Admin.geminiKey) || (!needGemini && !activeLlmKey())) {
          errEl.textContent = t.ai_key_missing; errEl.style.display = 'block'; return;
        }
        const value = src === 'youtube'
          ? document.getElementById('ai-youtube').value.trim()
          : document.getElementById('ai-topic').value.trim();
        if (!value) { errEl.textContent = t.ai_input_missing; errEl.style.display = 'block'; return; }
        const genBtn = document.getElementById('ai-gen-btn');
        genBtn.disabled = true; genBtn.textContent = t.ai_generating;
        try {
          const obj = await generateBlog({ type: src, value });
          let cover = '';
          if (obj.image_query && Admin.unsplashKey) { try { cover = await unsplashImage(obj.image_query); } catch (e) {} }
          if (!C.blog) C.blog = [];
          C.blog.unshift({
            slug: slugify((obj.title_en || obj.title_tr || 'post') + '-' + Date.now().toString(36)),
            date: new Date().toISOString().slice(0, 10), cover: cover,
            title: { tr: obj.title_tr || '', en: obj.title_en || '' },
            excerpt: { tr: obj.excerpt_tr || '', en: obj.excerpt_en || '' },
            body: { tr: obj.body_tr || '', en: obj.body_en || '' },
          });
          Admin.blogIdx = 0;
          await saveNow();
          renderPanel();
          const freshOk = document.getElementById('ai-ok');
          if (freshOk) { freshOk.textContent = t.ai_done; freshOk.style.display = 'block'; }
          const blogSec = document.getElementById('sec-blog');
          if (blogSec) blogSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (err) {
          genBtn.disabled = false; genBtn.textContent = '✦ ' + t.ai_generate;
          errEl.textContent = t.ai_err + ': ' + (err.message || err);
          errEl.style.display = 'block';
        }
        break;
      }
    }
  });

  // import JSON
  const importInput = document.getElementById('import-file');
  if (importInput) importInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        App.content = deepMerge(clone(CONTENT_DEFAULTS), parsed);
        await saveNow();
        renderPanel();
      } catch (err) { alert(t.admin_import_err); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // change password (Firebase requires a fresh login: reauthenticate first)
  const passForm = document.getElementById('pass-form');
  if (passForm) passForm.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('pass-err');
    const okEl = document.getElementById('pass-ok');
    errEl.style.display = 'none'; okEl.style.display = 'none';
    const showErr = msg => { errEl.textContent = msg; errEl.style.display = 'block'; };
    const cur = document.getElementById('cp0').value;
    const n1 = document.getElementById('cp1').value;
    const n2 = document.getElementById('cp2').value;
    if (n1.length < 6) return showErr(t.login_err_short);
    if (n1 !== n2) return showErr(t.login_err_mismatch);
    try {
      const user = fbAuth.currentUser;
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(n1);
      okEl.style.display = 'block';
      passForm.reset();
    } catch (err) { showErr(authErrorText(err)); }
  });
}
