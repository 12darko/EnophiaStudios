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
  aiSource: 'youtube',
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

// ---------------- AI (Gemini) — key in Firestore site/secrets, calls from admin's browser ----------------
async function loadSecrets() {
  if (!fbDb) return;
  try {
    const snap = await fbDb.collection('site').doc('secrets').get();
    if (snap.exists && snap.data().geminiKey) Admin.geminiKey = snap.data().geminiKey;
  } catch (e) { /* rules deny read unless authed — safe to ignore */ }
}

async function saveGeminiKey(key) {
  await fbDb.collection('site').doc('secrets').set({ geminiKey: key }, { merge: true });
  Admin.geminiKey = key;
}

// Ask Gemini for a bilingual blog draft. source = { type:'youtube'|'topic', value }
async function generateBlog(source) {
  if (!Admin.geminiKey) throw new Error('no-key');
  const instr = 'You are the devlog writer for Enophia Studios, an independent game studio. '
    + 'Write ONE blog post and return ONLY valid minified JSON with exactly these string fields: '
    + '{"title_tr","title_en","excerpt_tr","excerpt_en","body_tr","body_en"}. '
    + 'title: short and catchy. excerpt: 1-2 sentence summary. body: 3-6 short paragraphs, natural devlog tone, plain text (no markdown). '
    + 'The _tr fields must be in Turkish and the _en fields in English (not translations of each other word-for-word, but the same post in each language).';
  const parts = [];
  let prompt = instr;
  if (source.type === 'youtube') {
    parts.push({ fileData: { fileUri: source.value } });
    prompt += '\n\nWrite the post based on the linked YouTube video.';
  } else {
    prompt += '\n\nTopic / notes:\n' + source.value;
  }
  parts.push({ text: prompt });
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='
    + encodeURIComponent(Admin.geminiKey);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.85 } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || ('HTTP ' + res.status));
  const txt = data && data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
    && data.candidates[0].content.parts[0].text;
  if (!txt) throw new Error('empty response');
  try { return JSON.parse(txt); }
  catch (e) { return JSON.parse(txt.replace(/```json|```/g, '').trim()); }
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
    ['security', t.admin_s_security],
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

  const blogBody = '<div class="tabs">' + blogTabs + '</div>'
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

  // ---- AI blog generator ----
  const keySet = !!Admin.geminiKey;
  const aiSrc = Admin.aiSource || 'youtube';
  const aiBody =
    '<p class="hint" style="margin:0 0 18px;">' + t.ai_note + '</p>'
    + '<div class="field"><label>' + t.ai_key_label
      + ' · <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:#5bc0be; text-decoration:none;">' + t.ai_key_get + '</a></label>'
      + '<div class="key-row"><input class="input" type="password" id="ai-key" placeholder="' + esc(t.ai_key_ph) + '"' + (keySet ? ' value="••••••••••••"' : '') + '>'
      + '<button type="button" class="tb-btn tb-ghost" data-action="ai-save-key">' + t.ai_key_save + '</button></div>'
      + '<p class="form-ok" id="ai-key-msg" style="display:' + (keySet ? 'block' : 'none') + ';">' + t.ai_key_saved + '</p></div>'
    + '<div class="field"><label>' + t.ai_source_label + '</label><div class="seg">'
      + '<button type="button" class="seg-btn' + (aiSrc === 'youtube' ? ' on' : '') + '" data-action="ai-src" data-src="youtube">' + t.ai_source_youtube + '</button>'
      + '<button type="button" class="seg-btn' + (aiSrc === 'topic' ? ' on' : '') + '" data-action="ai-src" data-src="topic">' + t.ai_source_topic + '</button>'
      + '</div></div>'
    + '<div class="field" id="ai-input-yt"' + (aiSrc === 'youtube' ? '' : ' style="display:none;"') + '><input class="input" id="ai-youtube" placeholder="' + esc(t.ai_youtube_ph) + '"></div>'
    + '<div class="field" id="ai-input-topic"' + (aiSrc === 'topic' ? '' : ' style="display:none;"') + '><textarea class="input" id="ai-topic" rows="3" placeholder="' + esc(t.ai_topic_ph) + '"></textarea></div>'
    + '<button type="button" class="tb-btn tb-primary" id="ai-gen-btn" data-action="ai-generate">✦ ' + t.ai_generate + '</button>'
    + '<p class="form-error" id="ai-err" style="display:none;"></p>'
    + '<p class="form-ok" id="ai-ok" style="display:none;"></p>';

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
    + sec('security', 10, '⚿', t.admin_s_security, securityBody, ' style="background:rgba(91,192,190,0.14);border-color:rgba(91,192,190,0.28);color:#5bc0be;"')
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
      case 'ai-save-key': {
        const inp = document.getElementById('ai-key');
        const val = (inp.value || '').trim();
        const errEl = document.getElementById('ai-err');
        errEl.style.display = 'none';
        if (!val || val.charAt(0) === '•') return; // empty or unchanged mask
        try {
          await saveGeminiKey(val);
          document.getElementById('ai-key-msg').style.display = 'block';
          inp.value = '••••••••••••';
        } catch (err) {
          errEl.textContent = t.ai_err + ': ' + (err.message || err);
          errEl.style.display = 'block';
        }
        break;
      }
      case 'ai-generate': {
        const okEl = document.getElementById('ai-ok'), errEl = document.getElementById('ai-err');
        okEl.style.display = 'none'; errEl.style.display = 'none';
        if (!Admin.geminiKey) { errEl.textContent = t.ai_key_missing; errEl.style.display = 'block'; return; }
        const src = Admin.aiSource || 'youtube';
        const value = src === 'youtube'
          ? document.getElementById('ai-youtube').value.trim()
          : document.getElementById('ai-topic').value.trim();
        if (!value) { errEl.textContent = t.ai_input_missing; errEl.style.display = 'block'; return; }
        const genBtn = document.getElementById('ai-gen-btn');
        genBtn.disabled = true; genBtn.textContent = t.ai_generating;
        try {
          const obj = await generateBlog({ type: src, value });
          if (!C.blog) C.blog = [];
          C.blog.unshift({
            slug: slugify((obj.title_en || obj.title_tr || 'post') + '-' + Date.now().toString(36)),
            date: new Date().toISOString().slice(0, 10), cover: '',
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
