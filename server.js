'use strict';
/* Local dev/preview server. Production hosting is Firebase Hosting
   (see firebase.json — same headers, same SPA rewrite). Content and auth
   live in Firebase (Firestore + Authentication), so this server has no API:
   it only serves the static site with the right security headers. */
const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');

const CSP =
  "default-src 'self'; " +
  "script-src 'self' https://www.gstatic.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; " +
  "img-src 'self' https: data:; " +
  "frame-src https://www.youtube.com; " +
  "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://generativelanguage.googleapis.com https://api.groq.com https://api.unsplash.com; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': CSP,
  });
  next();
});

app.use(express.static(PUB, { index: false }));
app.get('*', (req, res) => {
  res.sendFile(path.join(PUB, 'index.html'));
});

app.listen(PORT, () => {
  console.log('Enophia Studios (dev) running at http://localhost:' + PORT);
});
