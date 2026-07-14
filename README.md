# Enophia Studios — Dinamik Portfolyo Sitesi (Firebase + GitHub Actions)

Enophia Studios'un portfolyo sitesi. İçerik **Firebase Firestore**'da durur, admin girişi **Firebase Authentication** ile yapılır. Site **GitHub Actions** ile her push'ta **kendi hostuna** otomatik yüklenir; Firebase config değerleri push sırasında **GitHub Secrets**'tan üretilir (repoda saklanmaz). Admin panelinden yapılan her değişiklik anında **tüm ziyaretçilere** yansır — içerik için kod değiştirmeye/deploy'a gerek yok.

## Hızlı başlangıç (yerel)

```bash
npm install
npm start
```

Site `http://localhost:3000` adresinde açılır. Yerelde Firebase'i bağlamak için:

```
public/js/firebase-config.example.js  →  public/js/firebase-config.js  (kopyala, değerleri doldur)
```

`firebase-config.js` git'e girmez (.gitignore'da) — canlıda GitHub Actions üretir. Config doldurulana kadar site varsayılan içerikle çalışır; admin paneli (`#admin`) kurulum talimatlarını gösterir.

---

## Firebase kurulumu (bir kere yapılır, ~10 dakika)

### 1. Proje oluştur

1. [console.firebase.google.com](https://console.firebase.google.com) → **Add project / Proje ekle**
2. İsim ver (ör. `enophia-studios`) → Google Analytics'i istersen kapat → **Create project**

### 2. Firestore'u aç ve güvenlik kurallarını yapıştır

1. Sol menü → **Build → Firestore Database → Create database**
2. Konum: `europe-west1` (veya sana yakın bir bölge) → **Production mode** seç
3. **Rules** sekmesine geç, içeriği tamamen sil ve şunu yapıştır → **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /site/content {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

> Bu kural: siteyi herkes okuyabilir, ama **sadece giriş yapmış ekip üyeleri** içerik yazabilir. Diğer her şey kapalı. (Aynı kurallar repodaki `firestore.rules` dosyasında da var.)

### 3. Giriş sistemini aç ve ekip hesaplarını ekle

1. Sol menü → **Build → Authentication → Get started**
2. **Sign-in method** sekmesi → **Email/Password** → Enable → Save
3. **Users** sekmesi → **Add user** → kendin ve Ahmet için e-posta + şifre belirle (en az 6 karakter)

> Panele bu e-posta/şifrelerle gireceksiniz. Şifreleri Google saklar (siteye/koda hiçbir şifre yazılmaz), kaba kuvvet saldırılarına karşı koruma Firebase'de hazır gelir.

### 4. Web uygulaması ekle, config'i kopyala

1. Sol üstte ⚙️ → **Project settings** → aşağıda **Your apps** → **`</>`** (Web) simgesi
2. Takma ad ver (ör. `enophia-web`) → **Register app** ("Hosting" kutusunu işaretleyebilirsin)
3. Ekranda çıkan `firebaseConfig = { apiKey: "...", ... }` değerlerini kopyala
4. Bu repodaki **`public/js/firebase-config.js`** dosyasını aç, değerleri yerlerine yapıştır, kaydet

Sayfayı yenile — artık `#admin` → e-posta/şifre giriş ekranı gelir. Giriş yap, panelde ilk kaydettiğin anda içerik Firestore'a yazılır ve site canlı veriyle çalışmaya başlar.

> `firebase-config.js` içindeki değerler gizli değildir (her ziyaretçiye zaten iner); güvenliği 2. adımdaki kurallar ve Authentication sağlar.

### 5. Firestore kurallarını yükle

Kuralları 2. adımda Console'dan yapıştırdıysan bu adım tamam. İstersen dosyadan da yükleyebilirsin:

```bash
npm install -g firebase-tools
firebase login
firebase use --add        # listeden projeni seç
firebase deploy --only firestore:rules
```

---

## Yayınlama: GitHub Actions → kendi hostun

`main` branch'e her push'ta [.github/workflows/deploy.yml](.github/workflows/deploy.yml) çalışır:

1. `public/js/firebase-config.js` dosyasını **GitHub Secrets**'tan üretir
2. `public/` klasörünü hostuna **FTPS** ile yükler (sadece değişen dosyalar)

### Kurulum (bir kere)

1. [github.com/new](https://github.com/new) → yeni repo aç (private olabilir)
2. Bu klasörü pushla:

```bash
git remote add origin https://github.com/KULLANICI/REPO.git
git push -u origin main
```

3. Repo → **Settings → Secrets and variables → Actions → New repository secret** ile şunları ekle:

| Secret | Değer |
|---|---|
| `FIREBASE_API_KEY` | Firebase config'teki `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | `authDomain` (`PROJE-ID.firebaseapp.com`) |
| `FIREBASE_PROJECT_ID` | `projectId` |
| `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `FIREBASE_APP_ID` | `appId` |
| `FTP_SERVER` | Hostunun FTP adresi (ör. `ftp.alanadin.com`) |
| `FTP_USERNAME` | FTP kullanıcı adı |
| `FTP_PASSWORD` | FTP şifresi |
| `FTP_SERVER_DIR` | Yüklenecek klasör, sonunda `/` (ör. `public_html/`) — eklemezsen `public_html/` varsayılır |

4. Push'la (veya repo → Actions → **Deploy to host** → Run workflow) — siten hostunda yayında.

### Host tarafı notları

- **`.htaccess` otomatik yüklenir** (Apache): `/game/villagers` gibi adresleri `index.html`'e yönlendirir + güvenlik başlıklarını ekler. Hostun nginx ise SPA yönlendirmesini panelinden/`nginx.conf`'tan yapman gerekir (`try_files $uri /index.html;`).
- **SSL/HTTPS**: hostunun panelinden ücretsiz SSL (Let's Encrypt) aç; sonra `.htaccess` içindeki HTTPS yönlendirme satırlarının başındaki `#` işaretlerini kaldırıp pushla.
- Hostun FTPS desteklemiyorsa workflow'daki `protocol: ftps` satırını `protocol: ftp` yap (önerilmez; önce hostuna FTPS açtırmayı dene).
- **Alternatif:** İstersen aynı site Firebase Hosting'e de atılabilir (`firebase deploy` — `firebase.json` hazır duruyor).

---

## Yeni oyun nasıl eklenir? 🎮

Kod yok, deploy yok — hepsi panelden:

1. Sitede **Ctrl+Shift+A** (veya adrese `#admin` ekle, ya da footer'daki © yazısına 5 hızlı tık)
2. E-posta/şifrenle gir
3. **Oyunlar** bölümünde **+ Yeni oyun** butonuna bas
4. Alanları doldur:
   - **Oyun adı**, **itch.io linki**, **kapak görseli URL** (itch.io sayfandaki görselin adresini kopyala)
   - **Tür, slogan, hikaye, oynanış, özellikler** — üstteki **TR/EN** düğmesiyle iki dilde ayrı ayrı gir
   - **YouTube video ID** (fragman için; linkteki `watch?v=XXXX` kısmının XXXX'i)
   - **Ekran görüntüleri** (her satıra bir URL)
   - **"Detay sayfası olsun"** işaretliyse oyun sitede kendi sayfasını alır; kapalıysa kart doğrudan itch.io'ya gider
5. Yazarken otomatik kaydedilir ("Kaydedildi" yazısını gör) — o anda tüm ziyaretçilerde canlıdır

Aynı şekilde **blog yazısı**, **ekip üyesi**, **"yakında" kartı** ekleyip silebilir; hero, vizyon/misyon, linkler dahil **her metni** değiştirebilirsin. JSON dışa aktar ile yedek alabilirsin.

> **SEO notu:** Yeni oyuna detay sayfası açtıysan `public/sitemap.xml` dosyasına bir satır ekleyip (`<url><loc>https://alanadin.com/game/SLUG</loc></url>`) yeniden `firebase deploy` demek Google'ın sayfayı daha hızlı bulmasını sağlar (zorunlu değil — Google linklerden de bulur).

---

## Otomatik devlog (repo takibi)

Admin panelde **“Repo Takibi”** bölümüne GitHub repo linklerini ekle. İki şekilde çalışır:

- **Elle (kurulum yok):** “Yeni commit’leri kontrol et ve üret” butonu. Her repoda son kontrolden beri yeni commit varsa, commit’leri + README’yi analiz edip bir devlog yazısı üretir (otomatik Unsplash kapağıyla). Aynı commit için tekrar üretmez.
- **Tam otomatik (zamanlı):** [.github/workflows/autoblog.yml](.github/workflows/autoblog.yml) her 30 dakikada bir [scripts/autoblog.js](scripts/autoblog.js)’i çalıştırır; yeni commit olan repolar için otomatik yazı üretip **Firestore’a** yazar (panelde de düzenlenebilir/silinebilir).

### Tam otomatik kurulumu (bir kere)

1. **Firebase servis hesabı anahtarı al:** Firebase Console → ⚙️ **Project settings → Service accounts → Generate new private key** → bir `.json` dosyası iner.
2. **GitHub secret ekle:** repo → **Settings → Secrets and variables → Actions → New repository secret** → ad: **`FIREBASE_SERVICE_ACCOUNT`**, değer: o JSON dosyasının **tamamını** yapıştır.
3. Bir de AI anahtarını (Gemini/Groq) ve istersen Unsplash anahtarını **admin panelden** girmiş ol (bunlar Firestore’da; script oradan okur).
4. Hepsi bu. Workflow 30 dakikada bir kendiliğinden çalışır; hemen denemek için repo → **Actions → Auto blog from repos → Run workflow**.

> **Not:** “Commit düştüğü an” değil, **~30 dakikada bir** kontrol eder (statik sitede 7/24 sunucu olmadığı için; aralığı `autoblog.yml` içindeki `cron` ile değiştirebilirsin). Repo herkese açıksa GitHub Actions dakikaları sınırsızdır; özel repoda daha uzun aralık (ör. saatte bir) seçmek dakika tasarrufu sağlar.
> **Servis hesabı anahtarı gizlidir** — yalnızca GitHub Secrets’a yapıştırılır, koda/git’e girmez. Firestore’a tam erişim verdiği için kimseyle paylaşma.

---

## Güvenlik

- **Taşıma şifrelemesi (HTTPS/TLS):** Firebase Hosting her zaman HTTPS sunar; tarayıcı ile Google sunucuları arasındaki tüm trafik şifrelidir. ("Uçtan uca şifreleme" mesajlaşma uygulamaları için bir kavramdır — herkese açık bir sitenin içeriği zaten herkese okunur olmalı; burada doğru koruma TLS + yazma yetkisi kontrolüdür.)
- **Kimlik doğrulama:** Google'ın yönettiği Firebase Auth — şifre hash'leme, oturum token'ları, kaba kuvvet koruması, sızmış şifre kontrolü Google tarafında.
- **Yazma yetkisi:** Firestore kuralları sunucu tarafında zorlanır — kural gereği giriş yapmamış hiç kimse tek harf değiştiremez. Panel gizli olsa da olmasa da bu geçerlidir.
- **Tarayıcı koruması:** CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, HSTS başlıkları hem yerel sunucuda hem `firebase.json` üzerinden Hosting'de ayarlı. Tüm içerik render'da HTML-escape edilir (XSS koruması).
- Sitede görünür admin linki yok; `#admin` ayrı bir URL olmadığı için Google'a görünmez.

## Dil (TR/EN)

Dil seçici yoktur — ziyaretçinin tarayıcı dili Türkçe ise site Türkçe, değilse İngilizce açılır. Test: `?lang=en` / `?lang=tr`. Tüm içerik iki dillidir (`{ tr, en }`); paneldeki TR/EN düğmesi hangi dildeki içeriği düzenlediğini seçer.

## SEO

- Gerçek URL'ler (`/game/villagers`, `/blog/yazi`), gerçek `<a href>` linkleri
- Sayfa başına title/description/canonical/og + JSON-LD (Organization, VideoGame, BlogPosting) — tarayıcıda güncellenir; Google JS çalıştırdığı için indeksler
- `public/sitemap.xml` + `public/robots.txt`
- Yayına alınca [Google Search Console](https://search.google.com/search-console)'a ekle, sitemap'i gönder

## Mimari

```
.github/workflows/deploy.yml     Push'ta: config'i Secrets'tan üret + hosta FTPS yükle
server.js                        Yerel geliştirme sunucusu (statik dosya + başlıklar)
firebase.json                    Firebase Hosting alternatifi için (opsiyonel)
firestore.rules                  Firestore güvenlik kuralları
public/
  .htaccess                      Hostta SPA yönlendirme + güvenlik başlıkları (Apache)
  index.html                     SEO etiketleri + Firebase SDK + uygulama kabuğu
  css/style.css                  Tasarım
  js/defaults.js                 Varsayılan içerik (iki dilli) + deepMerge
  js/firebase-config.example.js  Config şablonu (yerel için kopyalanır)
  js/firebase-config.js          Gerçek config — git'e girmez, Actions üretir
  js/i18n.js                     Dil algılama + TR/EN arayüz metinleri
  js/app.js                      Router + public sayfalar + Firestore canlı aboneliği
  js/admin.js                    Admin panel (Firebase Auth girişi + içerik editörü)
  robots.txt, sitemap.xml
```

Veri akışı: site açılır → varsayılan içerik anında görünür → Firestore `site/content` dokümanı gelince onunla değişir (canlı abonelik — panelde kaydedince açık sekmelerde bile anında güncellenir). Panel `set()` ile aynı dokümana yazar.

## Notlar

- Ücretsiz (Spark) plan limitleri portfolyo sitesi için fazlasıyla yeter: Firestore 50K okuma/gün, Hosting 360MB/gün trafik.
- Görseller harici URL olarak tutulur (itch.io CDN). Dosya yükleme istenirse Firebase Storage eklenebilir.
- Aynı anda iki kişi düzenlerse son kaydeden kazanır (last-write-wins).
- `Enophia Studios.dc.html` — eski tasarım mockup'ı, referans olarak duruyor; siteye dahil değil.
