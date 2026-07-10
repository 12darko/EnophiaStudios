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
  if (fbAuth.currentUser) renderPanel();
  else renderLogin();
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
    // hero
    + '<section class="admin-section">' + sectionHead('✦', t.admin_s_hero)
    + fld(t.f_hero_title, 'hero.title.' + al, C.hero.title[al])
    + fldArea(t.f_hero_sub, 'hero.sub.' + al, C.hero.sub[al], 3)
    + '</section>'
    // vision/mission/story
    + '<section class="admin-section">' + sectionHead('◷', t.admin_s_about)
    + fldArea(t.vision_h, 'vision.' + al, C.vision[al], 3)
    + fldArea(t.mission_h, 'mission.' + al, C.mission[al], 3)
    + fldArea(t.f_story, 'story.' + al, C.story[al], 3)
    + fldArea(t.f_about_lead, 'about.lead.' + al, C.about.lead[al], 2)
    + '</section>'
    // next cards
    + '<section class="admin-section">' + sectionHead('▸', t.admin_s_next)
    + nextRows
    + '<button type="button" class="mini-add" data-action="add-next">' + t.admin_add_next + '</button>'
    + '</section>'
    // team
    + '<section class="admin-section">' + sectionHead('◍', t.team_title)
    + teamRows
    + '<button type="button" class="mini-add" data-action="add-member">' + t.admin_add_member + '</button>'
    + '</section>'
    // contact
    + '<section class="admin-section">' + sectionHead('✉', t.admin_s_contact)
    + fldArea(t.f_contact_sub, 'contact.sub.' + al, C.contact.sub[al], 2)
    + '</section>'
    // links
    + '<section class="admin-section">' + sectionHead('⚲', t.admin_s_links)
    + fld('itch.io', 'links.itch', C.links.itch)
    + fld('E-mail', 'links.email', C.links.email)
    + fld('YouTube 1', 'links.youtube1', C.links.youtube1)
    + fld('YouTube 2', 'links.youtube2', C.links.youtube2)
    + fld('LinkedIn — 1', 'links.linkedin1', C.links.linkedin1)
    + fld('LinkedIn — 2', 'links.linkedin2', C.links.linkedin2)
    + '</section>'
    // games
    + '<section class="admin-section">' + sectionHead('✦', t.admin_s_games)
    + '<div class="tabs">' + gameTabs + '</div>'
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
    ) : '')
    + '</section>'
    // blog
    + '<section class="admin-section">' + sectionHead('✎', t.admin_s_blog)
    + '<div class="tabs">' + blogTabs + '</div>'
    + (p ? (
      '<button type="button" class="mini-danger" style="margin-bottom:20px;" data-action="remove-post">' + t.admin_remove_post + '</button>'
      + fld(t.f_blog_title, 'blog.' + bi + '.title.' + al, (p.title && p.title[al]) || '')
      + '<div class="grid-2">'
      + fld(t.f_blog_date, 'blog.' + bi + '.date', p.date || '')
      + fld(t.f_blog_cover, 'blog.' + bi + '.cover', p.cover || '')
      + '</div>'
      + fldArea(t.f_blog_excerpt, 'blog.' + bi + '.excerpt.' + al, (p.excerpt && p.excerpt[al]) || '', 2)
      + fldArea(t.f_blog_body, 'blog.' + bi + '.body.' + al, (p.body && p.body[al]) || '', 8)
    ) : '<p class="hint" style="font-size:13.5px;">' + t.admin_no_posts + '</p>')
    + '</section>'
    // security
    + '<section class="admin-section">'
    + sectionHead('⚿', t.admin_s_security, ' style="background:rgba(91,192,190,0.14);border-color:rgba(91,192,190,0.28);color:#5bc0be;"')
    + '<p class="hint" style="margin:0 0 16px; font-size:13px;">' + t.admin_security_note + '</p>'
    + '<form id="pass-form">'
    + '<div class="field"><label>' + t.f_cur_pass + '</label><input class="input" type="password" id="cp0" autocomplete="current-password"></div>'
    + '<div class="grid-2">'
    + '<div class="field"><label>' + t.f_new_pass + '</label><input class="input" type="password" id="cp1" autocomplete="new-password"></div>'
    + '<div class="field"><label>' + t.f_new_pass2 + '</label><input class="input" type="password" id="cp2" autocomplete="new-password"></div>'
    + '</div>'
    + '<p class="form-error" id="pass-err" style="display:none;"></p>'
    + '<p class="form-ok" id="pass-ok" style="display:none;">' + t.pass_changed + '</p>'
    + '<button type="submit" class="tb-btn tb-ghost">' + t.btn_change_pass + '</button>'
    + '</form>'
    + '</section>'
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
