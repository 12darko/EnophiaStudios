# Enophia Studios — Geliştirici Dokümanı

> Kurulum, deploy ve panel kullanımı için ana kaynak: **[README.md](README.md)**.
> `Enophia Studios.dc.html` eski tasarım mockup'ıdır, sadece referans.

## Hızlı özet

- Mimari: statik SPA (vanilla JS) + **Firebase** (Firestore = içerik, Auth = giriş)
- Yayın: **GitHub Actions** (`.github/workflows/deploy.yml`) — main'e push'ta
  `firebase-config.js`'i repo Secrets'tan üretir, `public/` klasörünü hosta FTPS ile yükler
- `public/js/firebase-config.js` git'e girmez (.gitignore); yerelde example dosyasından kopyalanır
- `public/.htaccess`: hostta SPA yönlendirmesi + güvenlik başlıkları (Apache)
- Yerel çalıştırma: `npm start` → `http://localhost:3000` (server.js sadece statik sunucu)
- İçerik: Firestore `site/content` dokümanı; panel kaydedince tüm ziyaretçilere canlı yansır
- Config doldurulmadıysa site varsayılan içerikle çalışır, panel kurulum talimatı gösterir
- Gizli admin girişi: footer'a 5 tık / Ctrl+Shift+A / `#admin`
- Dil: tarayıcıdan otomatik TR/EN, header'da seçici yok (`?lang=` test override'ı)

## Yeni içerik alanı eklemek

1. `public/js/defaults.js` → `CONTENT_DEFAULTS` içine alanı ekle (iki dilli alanlar `{ tr, en }`).
2. Firestore'dan gelen veri her yüklemede defaults üzerine deep-merge edilir —
   yeni alan mevcut kurulumda otomatik belirir, migration gerekmez.
3. Public tarafta göstermek için `public/js/app.js` içindeki ilgili view fonksiyonuna
   ekle (`viewHome`, `viewAbout`, `viewGame`...). Dinamik değerleri her zaman `esc()` ile bas.
4. Panelden düzenlenebilir olması için `public/js/admin.js` → `renderPanel()` içinde
   `fld()` / `fldArea()` ile input ekle. `data-path` içerik nesnesindeki noktalı yoldur
   (ör. `hero.title.tr`); binding ve otomatik kayıt kendiliğinden çalışır.
   Satır-listesi alanlar için `data-kind="lines"` (features, shots gibi).

## Dikkat

- Public render string şablonlarıyla yapılır; kullanıcı verisini `esc()`siz HTML'e gömme (XSS).
- `bindPanel()` listener'ları her render'da yeniden oluşturulan `.admin-page` elemanına
  bağlanır — `#app`'e bağlarsan handler'lar birikir (çift ekleme bug'ı).
- Firestore `onSnapshot` içinde `snap.metadata.hasPendingWrites` kontrolü var:
  kendi yazdığımızın yankısını ve panelde yazarken re-render'ı engeller — kaldırma.
- CSP üç yerde tanımlı: `server.js`, `public/.htaccess` ve `firebase.json`;
  yeni bir dış kaynak (script/API) eklersen **üçünü birden** güncelle.
- Firestore kuralları değişirse hem Console'da hem `firestore.rules` dosyasında güncel tut
  (`firebase deploy` rules dosyasını da yükler).
