'use strict';
/* ============================================================
   ORNEK DOSYA — yerel gelistirme icin bunu kopyala:

     public/js/firebase-config.example.js  →  public/js/firebase-config.js

   ve Firebase Console'daki degerleri yapistir.

   ONEMLI: firebase-config.js git'e GIRMEZ (.gitignore'da).
   Canli sitede bu dosya GitHub Actions tarafindan deploy sirasinda
   repo Secrets'larindan otomatik uretilir — bkz. .github/workflows/deploy.yml
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: 'BURAYA_YAPISTIR',
  authDomain: 'PROJE-ID.firebaseapp.com',
  projectId: 'PROJE-ID',
  storageBucket: 'PROJE-ID.appspot.com',
  messagingSenderId: 'BURAYA_YAPISTIR',
  appId: 'BURAYA_YAPISTIR',
};
