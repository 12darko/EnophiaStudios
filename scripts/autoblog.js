'use strict';
/* Scheduled auto-blog: reads tracked repos from Firestore (site/content.autotrack),
   and for any repo with a commit newer than last-seen, generates a devlog post with
   the configured AI provider and writes it back to Firestore. Runs in GitHub Actions
   on a cron via .github/workflows/autoblog.yml. Uses the Firebase Admin SDK (service
   account secret) so it bypasses security rules and can read site/secrets (the AI keys).

   Env: FIREBASE_SERVICE_ACCOUNT (JSON string), GH_TOKEN (optional, higher GitHub rate limit). */

const admin = require('firebase-admin');

// Not configured yet? Skip cleanly (green), don't spam red failures every 30 min.
const rawSvc = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawSvc || !rawSvc.trim()) {
  console.log('FIREBASE_SERVICE_ACCOUNT secret is not set — auto-blog is disabled. '
    + 'See README → "Otomatik devlog" to enable it.');
  process.exit(0);
}
let svc;
try {
  svc = JSON.parse(rawSvc);
} catch (e) {
  console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Paste the ENTIRE service account .json file content into the secret.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(svc) });
const db = admin.firestore();

const GH_HEADERS = { 'Accept': 'application/vnd.github+json', 'User-Agent': 'enophia-autoblog' };
if (process.env.GH_TOKEN) GH_HEADERS['Authorization'] = 'Bearer ' + process.env.GH_TOKEN;

const BLOG_SYS = 'You are the devlog writer for Enophia Studios, an independent game studio. '
  + 'Write ONE blog post and return ONLY valid minified JSON with exactly these fields: '
  + '{"title_tr","title_en","excerpt_tr","excerpt_en","body_tr","body_en","image_query"}. '
  + 'title: short and catchy. excerpt: 1-2 sentences. body: 4-6 short paragraphs, natural devlog tone, plain text (no markdown). '
  + 'image_query: 2-4 English keywords describing an ATMOSPHERIC, CINEMATIC scene or environment that suits a dark-fantasy / mythology indie game — NOT the technical devlog topic. '
  + 'Good examples: "dark fantasy forest fog", "ancient temple ruins", "misty mountains dusk", "stormy sea mythology", "cinematic night sky stars", "abstract glowing particles". '
  + 'Never use software, coding, computer, office or desk words. '
  + 'The _tr fields in Turkish, the _en fields in English (same post, not word-for-word).';

async function ghJson(url) {
  const r = await fetch(url, { headers: GH_HEADERS });
  if (!r.ok) throw new Error('GitHub ' + r.status);
  return r.json();
}

async function githubContext(owner, repo) {
  const base = 'https://api.github.com/repos/' + owner + '/' + repo;
  const info = await ghJson(base);
  let commits = [];
  try { commits = await ghJson(base + '/commits?per_page=20'); } catch (e) {}
  let readme = '';
  try {
    const rd = await ghJson(base + '/readme');
    if (rd && rd.content) readme = Buffer.from(rd.content, 'base64').toString('utf8').slice(0, 1800);
  } catch (e) {}
  const list = Array.isArray(commits) ? commits : [];
  const commitLines = list.slice(0, 20).map(c => '- ' + String((c.commit && c.commit.message) || '').split('\n')[0]).join('\n');
  return {
    headSha: list[0] ? list[0].sha : null,
    text: 'GITHUB REPO: ' + owner + '/' + repo + '\nAciklama: ' + (info.description || '-')
      + '\nDil: ' + (info.language || '-') + '\nSON COMMITLER:\n' + (commitLines || '-')
      + '\n\nREADME (kisaltilmis):\n' + (readme || '-'),
  };
}

function parseLoose(t) {
  try { return JSON.parse(t); }
  catch (e) {
    const c = String(t).replace(/```json/gi, '').replace(/```/g, '').trim();
    const s = c.indexOf('{'), en = c.lastIndexOf('}');
    return JSON.parse(c.slice(s, en + 1));
  }
}

async function llmJson(provider, secrets, system, userText) {
  if (provider === 'groq') {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + secrets.groqKey },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature: 0.8, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: userText }] }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error((d.error && d.error.message) || ('groq ' + r.status));
    return d.choices[0].message.content;
  }
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(secrets.geminiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error((d.error && d.error.message) || ('gemini ' + r.status));
  return d.candidates[0].content.parts[0].text;
}

async function unsplash(key, query) {
  if (!key || !query) return '';
  try {
    const r = await fetch('https://api.unsplash.com/search/photos?per_page=8&orientation=landscape&content_filter=high&query=' + encodeURIComponent(query), { headers: { 'Authorization': 'Client-ID ' + key } });
    const d = await r.json();
    const results = (d && d.results) || [];
    if (!results.length) return '';
    const x = results[Math.floor(Math.random() * results.length)];
    return x ? (x.urls.regular || x.urls.small || '') : '';
  } catch (e) { return ''; }
}

function slugify(s) {
  const map = { 'ğ': 'g', 'ü': 'u', 'ş': 's', 'ı': 'i', 'ö': 'o', 'ç': 'c' };
  const c = (s || '').toLowerCase().replace(/[ğüşıöç]/g, ch => map[ch] || ch)
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return c || ('item-' + Date.now().toString(36));
}

(async () => {
  const contentRef = db.collection('site').doc('content');
  const secrets = (await db.collection('site').doc('secrets').get()).data() || {};
  // Private tracked repos: use the token stored in the panel (Firestore secrets) unless
  // an env GH_TOKEN was already provided to the Action.
  if (secrets.githubToken && !GH_HEADERS['Authorization']) GH_HEADERS['Authorization'] = 'Bearer ' + secrets.githubToken;
  const provider = secrets.aiProvider === 'groq' ? 'groq' : 'gemini';
  if (provider === 'gemini' && !secrets.geminiKey) return console.log('No Gemini key — nothing to do.');
  if (provider === 'groq' && !secrets.groqKey) return console.log('No Groq key — nothing to do.');

  const content = (await contentRef.get()).data() || {};
  const at = content.autotrack || { repos: [], lastSeen: {} };
  const lastSeen = Object.assign({}, at.lastSeen || {});
  const repos = (at.repos || []).filter(r => r && r.url);
  if (!repos.length) return console.log('No tracked repos.');

  const newPosts = [];
  for (const r of repos) {
    const m = String(r.url).match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
    if (!m) continue;
    const owner = m[1], repo = m[2].replace(/\.git$/, ''), key = owner + '/' + repo;
    try {
      const ctx = await githubContext(owner, repo);
      if (!ctx.headSha || lastSeen[key] === ctx.headSha) { console.log(key, '→ no new commit'); continue; }
      const langLine = r.lang === 'tr' ? 'Primary Turkish.' : r.lang === 'en' ? 'Primary English.' : 'TR + EN.';
      const obj = parseLoose(await llmJson(provider, secrets, BLOG_SYS + '\n' + langLine,
        'GitHub repo activity:\n' + ctx.text + '\n\nWrite a detailed devlog post about the recent progress.'));
      let cover = '';
      if (obj.image_query && secrets.unsplashKey) cover = await unsplash(secrets.unsplashKey, obj.image_query);
      newPosts.push({
        slug: slugify((obj.title_en || obj.title_tr || repo) + '-' + Date.now().toString(36)),
        date: new Date().toISOString().slice(0, 10), cover: cover,
        title: { tr: obj.title_tr || '', en: obj.title_en || '' },
        excerpt: { tr: obj.excerpt_tr || '', en: obj.excerpt_en || '' },
        body: { tr: obj.body_tr || '', en: obj.body_en || '' },
      });
      lastSeen[key] = ctx.headSha;
      console.log(key, '→ generated a post');
    } catch (e) { console.error(key, 'error:', e.message); }
  }

  if (!newPosts.length) return console.log('Nothing new to publish.');

  // Re-read right before writing to minimise clobbering a concurrent panel edit.
  const fresh = (await contentRef.get()).data() || {};
  const freshBlog = Array.isArray(fresh.blog) ? fresh.blog : [];
  const freshAt = fresh.autotrack || at;
  freshAt.lastSeen = Object.assign({}, freshAt.lastSeen || {}, lastSeen);
  await contentRef.set({ blog: newPosts.concat(freshBlog), autotrack: freshAt }, { merge: true });
  console.log('Published', newPosts.length, 'post(s).');
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
