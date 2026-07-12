# Firebase Maliyet Optimizasyon Rehberi

**Hedef kitle:** Firestore / Firebase üzerinde SaaS, e-ticaret, sosyal, chat, oyun veya benzeri bir ürün geliştiren ekipler.
**Amaç:** Sürpriz faturaları engellemek, okuma/yazma maliyetlerini mimari kararlarla en baştan düşürmek.

---

## TL;DR — 5 Altın Kural

1. **Her sorguya `limit()` koy.** Sınırsız sorgu, sınırsız fatura demektir.
2. **Ekran başına 1–3 okuma hedefle.** Veri modelini sorgulara göre tasarla, sorguları modele göre değil.
3. **`onSnapshot`'ı sadece gerçekten canlı gereken ekranlarda kullan** ve ekrandan çıkınca mutlaka `unsubscribe` et.
4. **Security Rules + App Check olmadan yayına çıkma.** Korumasız veritabanını botlar okur, faturayı sen ödersin.
5. **İlk gün bütçe alarmı kur.** Firebase'in yerleşik bir "harcama üst sınırı" yoktur; alarmı ve devre kesiciyi sen kurarsın.

---

## 1. Önce Fiyatlandırma Modelini Anla

Firebase'de sunucu kiralamazsın; **operasyon başına** ödersin. Bu yüzden kötü veri modeli doğrudan para kaybıdır ve sonradan düzeltmesi en pahalı hatadır.

| Servis | Neye para ödersin | Tipik tuzak |
|---|---|---|
| **Cloud Firestore** | Doküman okuma / yazma / silme sayısı, depolama (GiB), ağ çıkışı | Gereksiz ve sınırsız okumalar |
| **Realtime Database** | Depolanan GB + **indirilen GB** | Büyük JSON ağacını komple indirmek |
| **Cloud Storage** | Depolama + indirme bant genişliği + operasyon sayısı | Orijinal boyut görselleri liste ekranında servis etmek |
| **Cloud Functions** | Çağrı sayısı + CPU/RAM-saniye + çıkış trafiği | Sonsuz döngüye giren tetikleyiciler |
| **Authentication** | Telefon/SMS doğrulama ücretlidir | SMS bombing / bot saldırısı (toll fraud) |
| **Hosting** | Depolama + veri transferi | Optimize edilmemiş büyük bundle'lar |

**Bilinmesi gereken referans değerler** (yazım tarihi itibarıyla; bölgeye göre değişir, güncel liste: [firebase.google.com/pricing](https://firebase.google.com/pricing)):

- Spark (ücretsiz) planda Firestore günlük kotası: ~50.000 okuma, 20.000 yazma, 20.000 silme, 1 GiB depolama.
- Blaze planında ABD çoklu bölge için kabaca: okuma ~$0,06 / 100K, yazma ~$0,18 / 100K, silme ~$0,02 / 100K.
- **Kritik fark:** Firestore *operasyon sayısı* üzerinden, Realtime Database ise *indirilen bant genişliği* üzerinden ücretlendirir. Ürün seçimini buna göre yap.

> Bu rakamlar küçük görünür ama çarpan etkisi büyüktür: 10.000 günlük aktif kullanıcı × ekran başına 50 okuma × günde 10 ekran = günde 5 milyon okuma. Aynı uygulama ekran başına 2 okumayla tasarlanırsa maliyet 25 kat düşer.

---

## 2. En Pahalı 10 Hata (Anti-Pattern'ler)

### 2.1 `limit()` olmadan sorgu çekmek

```js
// KÖTÜ: koleksiyonda 100.000 doküman varsa 100.000 okuma
const snap = await getDocs(collection(db, "products"));

// İYİ: her zaman sırala + sınırla
const snap = await getDocs(
  query(collection(db, "products"), orderBy("createdAt", "desc"), limit(20))
);
```

### 2.2 İstemci tarafında filtreleme

Tüm koleksiyonu çekip JavaScript'te `.filter()` yapmak, atılan her doküman için de para ödemek demektir. Filtreyi `where()` ile sorguya taşı; gerekirse composite index oluştur (konsol hatası sana linki zaten verir).

### 2.3 N+1 okuma deseni

Bir liste çekip her satır için ayrı `getDoc()` çağırmak (ör. 20 post + her postun yazarı = 40 okuma). Çözüm: çok okunan, az değişen alanları (yazar adı, avatar URL'i gibi) doğrudan liste dokümanına kopyala (denormalizasyon).

### 2.4 Her ekranda `onSnapshot` açmak

Canlı dinleyici, dinlediği sorguda her değişiklikte okuma üretir ve ekran açık kaldığı sürece çalışır. Ayrıca **unutulan (unsubscribe edilmeyen) dinleyiciler** klasik fatura şişiricidir; kullanıcı ekrandan çıkar, dinleyici arka planda okumaya devam eder.

### 2.5 Bir şeyi saymak için koleksiyonu okumak

```js
// KÖTÜ: 5.000 beğeni = 5.000 okuma
const likes = await getDocs(collection(db, "posts/x/likes"));
console.log(likes.size);

// İYİ: aggregation query — her 1.000 index girdisi ~1 okuma sayılır
const c = await getCountFromServer(collection(db, "posts/x/likes"));
console.log(c.data().count);
```

Ekranda sürekli görünen sayaçlar içinse dokümanda `likeCount` alanı tut ve `increment(1)` ile güncelle: gösterim maliyeti 0 ek okuma.

### 2.6 Kendini tetikleyen Cloud Function (sonsuz döngü)

`onWrite` / `onUpdate` tetikleyicisi aynı dokümana geri yazarsa kendini tekrar tetikler ve dakikalar içinde milyonlarca çağrı üretebilir. Koruma:

- Yazmadan önce ilgili alanın gerçekten değişip değişmediğini kontrol et (`before.data().x === after.data().x` ise çık).
- Mümkünse sonucu farklı bir koleksiyona/dokümana yaz.
- Fonksiyona `maxInstances` tanımla (kaçak ölçeklenmeyi sınırlar).

### 2.7 Geliştirme ve testi gerçek proje üzerinde yapmak

Lokal geliştirme, CI ve yük testleri için **Firebase Emulator Suite** kullan. Emülatör tamamen ücretsizdir; "test scriptim döngüye girdi, 2 milyon yazma yaptı" hikâyesinin tek kesin çözümü budur.

### 2.8 Şişman dokümanlar

Ekranda kullanılmayan dev alanlar (gömülü HTML, log geçmişi vb.) her okumada bant genişliği ve gecikme maliyeti üretir. Liste ekranları için ayrı "özet" dokümanı, detay ekranı için tam doküman tut.

### 2.9 Görselleri orijinal boyutta servis etmek

Storage'daki 4 MB fotoğrafı 80px'lik avatar olarak göstermek hem bant genişliği faturası hem yavaşlıktır. **Resize Images** extension'ı ile otomatik thumbnail üret (ör. 200px / 800px) ve dosyalara uzun `Cache-Control` başlığı ver.

### 2.10 Korumasız kurallar

```
// ASLA: herkese açık veritabanı
allow read, write: if true;
```

Bu kuralla yayına çıkan projeleri tarayan botlar vardır; veritabanını kürek kürek okur/yazarlar ve fatura sana gelir. Auth + Security Rules + App Check üçlüsü maliyet kontrolünün de parçasıdır.

---

## 3. Temel Optimizasyon Stratejileri

### 3.1 Cache-first okuma (offline persistence)

Web'de kalıcı önbelleği açıkça aktifleştirmen gerekir (Android/iOS SDK'larında varsayılan olarak açıktır):

```js
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
```

Değişme sıklığı düşük veriler için önce cache'i dene, boşsa sunucuya git:

```js
import { getDocsFromCache, getDocs } from "firebase/firestore";

async function readCheap(q) {
  try {
    return await getDocsFromCache(q); // 0 maliyet
  } catch {
    return await getDocs(q); // cache boşsa sunucu
  }
}
```

**Uyarı:** Cache bayat olabilir. Bakiye, stok, yetki gibi kritik verilerde sunucudan doğrula; cache-first'ü katalog, profil, ayarlar gibi verilerde kullan.

### 3.2 Agregasyon / gömme — ama 1 MiB limitine dikkat

"Yorumları ürün dokümanına array olarak göm" yaklaşımı doğru yöndedir ama önemli bir sınırı vardır: **bir Firestore dokümanı en fazla 1 MiB olabilir** ve sınırsız büyüyen array'ler zamanla hem bu limite çarpar hem her okumada gereksiz veri taşır.

**Önerilen hibrit desen:**

```
products/{productId}
  ├─ name, price, ...
  ├─ commentCount: 1284        // increment ile güncellenir
  ├─ ratingAvg: 4.6
  └─ lastComments: [ ...son 5 yorum... ]   // gömülü, küçük

products/{productId}/comments/{commentId}
  └─ tüm yorumlar (sadece "tümünü gör" denince sayfalı çekilir)
```

Sonuç: ürün detay sayfası **1 okuma**, tüm yorumlar isteğe bağlı ve sayfalı.

### 3.3 Cursor tabanlı sayfalama

```js
let q = query(col, orderBy("createdAt", "desc"), limit(20));
const first = await getDocs(q);
const last = first.docs[first.docs.length - 1];

// sonraki sayfa
q = query(col, orderBy("createdAt", "desc"), startAfter(last), limit(20));
```

`offset` kullanma (REST/Admin SDK'da mevcuttur): atlanan dokümanlar da okunmuş sayılır ve ücretlendirilir.

### 3.4 `get()` mi `onSnapshot` mı? Karar tablosu

| Senaryo | Öneri |
|---|---|
| Chat, canlı bildirim, ortak düzenleme | `onSnapshot` (limit + unsubscribe ile) |
| Ürün listesi, profil, ayarlar, blog | `get()` + pull-to-refresh |
| Dashboard / raporlar | `get()` + periyodik yenileme veya cache |
| Sipariş durumu takibi | Sadece aktif sipariş ekranında `onSnapshot` |

### 3.5 Denormalizasyon ile fan-out dengesi

Okumayı ucuzlatmak için veriyi kopyalarsın; ama kopya sayısı arttıkça güncelleme maliyeti ve tutarlılık yükü artar. Pratik kural: **çok okunan + az değişen** alanları kopyala (kullanıcı adı, avatar, ürün başlığı), sık değişenleri referansla çöz.

### 3.6 TTL politikalarıyla çöp veriyi otomatik temizle

Oturum kayıtları, geçici bildirimler, kısa ömürlü loglar için Firestore **TTL policy** tanımla. Depolama maliyetin büyümez, cron yazmana gerek kalmaz (TTL silmeleri standart silme ücretine tabidir ama otomatiktir).

### 3.7 Herkese aynı veri gidiyorsa: Bundles + CDN

Ana sayfa vitrini, kategori ağacı, "haftanın öne çıkanları" gibi herkes için aynı olan veriyi her kullanıcıya Firestore'dan okutma. **Firestore data bundle** oluşturup Hosting/CDN üzerinden dağıt: 100.000 kullanıcı, sıfıra yakın Firestore okuması.

### 3.8 Cloud Functions maliyet notları

- Fonksiyonu **veritabanıyla aynı bölgede** çalıştır (çapraz bölge trafiği hem para hem gecikme).
- Her fonksiyona `maxInstances` koy; hatalı bir istemci fonksiyonu sonsuza ölçekleyemesin.
- Ağır agregasyonları anlık tetikleyiciler yerine **zamanlanmış (scheduled) fonksiyonlarla** toplu çalıştır (ör. gece 03:00'te istatistik özetleri).
- Aşırı `console.log` Cloud Logging faturası üretir; production'da log seviyesini kıs.

### 3.9 Güvenlik = maliyet kontrolü

- Security Rules'ta `request.auth != null` kontrolü + alan bazlı veri doğrulama.
- **App Check** aktif et: istekler yalnızca senin gerçek uygulamandan gelsin.
- Telefon/SMS girişini zorunlu tutma; e-posta bağlantısı ve Google/Apple girişini öne çıkar. SMS kullanacaksan bölge kısıtlaması uygula — "SMS toll fraud" gerçek ve pahalı bir saldırı türüdür.

---

## 4. Bütçe Koruması (İlk Gün Kur)

Önemli gerçek: **Firebase/Google Cloud'da yerleşik bir "harcamayı şu tutarda kes" düğmesi yoktur.** Bütçeler yalnızca uyarır. Durdurma mekanizmasını sen kurarsın.

### 4.1 Bütçe alarmı (5 dakika sürer)

1. [console.cloud.google.com](https://console.cloud.google.com) → **Billing → Budgets & alerts**
2. **Create budget** → projeni seç.
3. Aylık tutar belirle (ör. $25) → %50, %90, %100 eşiklerinde e-posta bildirimi ekle.

### 4.2 Devre kesici / kill switch (isteğe bağlı, dikkatli kullan)

Bütçeyi bir Pub/Sub topic'ine bağlayıp limit aşıldığında projeden faturalandırma hesabını ayıran bir fonksiyon yazabilirsin (iskelet kod; tam örnek Google'ın "budget notifications" dokümanındadır):

```js
const { CloudBillingClient } = require("@google-cloud/billing");
const billing = new CloudBillingClient();

exports.stopBilling = functions.pubsub
  .topic("budget-alerts")
  .onPublish(async (message) => {
    const data = message.json;
    if (data.costAmount <= data.budgetAmount) return; // limit aşılmadı

    await billing.updateProjectBillingInfo({
      name: "projects/PROJE_ID",
      projectBillingInfo: { billingAccountName: "" }, // faturalandırmayı ayır
    });
  });
```

**Uyarılar:**

- Faturalandırma kapanınca **tüm servisler durur**; production'da bu, faturadan daha pahalıya mal olabilir ve veri işlemleri yarım kalabilir.
- Daha yumuşak alternatif: limit aşıldığında Security Rules'ı kilitleyen ya da uygulamada feature flag kapatan bir devre kesici. Prototip/hobi projelerinde sert kesici, production'da yumuşak kesici + alarm mantıklıdır.

### 4.3 Günlük izleme alışkanlığı

- Firebase Console → her servisin **Usage** sekmesi.
- Google Cloud → Billing raporları (servise ve SKU'ya göre kırılım).
- Takip edilecek en faydalı metrik: **okuma / günlük aktif kullanıcı** oranı. Ekran başına 1–3 okuma sağlıklıdır; kullanıcı başına günde yüzlerce okuma görüyorsan bir dinleyici sızıntısı veya N+1 deseni var demektir.

---

## 5. Proje Tipine Göre Öneriler

### 5.1 SaaS (multi-tenant)

- **Yapı:** `tenants/{tenantId}/...` alt koleksiyonları → hem izolasyon hem tenant bazlı ölçüm kolaylaşır.
- Kullanım tabanlı fiyatlandırma yapacaksan tenant başına okuma/yazma sayaçlarını fonksiyonlarla ayrı bir `usage` koleksiyonuna logla; kendi müşterine faturalandırma yapabilmen için şart.
- Plan limitlerini (ör. `maxProjects: 3`) Security Rules + sayaç dokümanlarıyla sunucu tarafında uygula; istemci tarafı kontrol maliyeti engellemez.
- Tenant listesi, ayarlar gibi az değişen verilerde cache-first oku.

### 5.2 E-ticaret / ilan sitesi

- Vitrin ve kategori listeleri: bundle + CDN veya saatlik yenilenen cache.
- Ürün detayı: özet doküman deseni (bkz. 3.2) — yorum sayısı ve puan ortalaması `increment` ile tutulur.
- **Arama:** Firestore tam metin arama yapamaz; "her tuş vuruşunda koleksiyon tara" yaklaşımı hem kötü çalışır hem pahalıdır. Algolia / Typesense / Meilisearch entegre et; Firestore "kaynak", arama motoru "index" olsun.
- Stok gibi kritik alanlarda cache'e güvenme, sunucudan oku.

### 5.3 Sosyal / feed uygulaması

- Feed'i okuma anında birleştirmek yerine **fan-out on write** uygula: post atılınca takipçilerin hazır timeline dokümanlarına yaz. Yazma artar, okuma çok ucuzlar — okuma ağırlıklı uygulamada doğru takas.
- Beğeni/yorum sayaçları: `increment` + `getCountFromServer`, asla koleksiyon taraması.

### 5.4 Chat

- `onSnapshot` burada meşru; ama son mesajlara `limit(30)` koy, geçmişi yukarı kaydırınca sayfalı çek.
- Ekrandan çıkınca **mutlaka unsubscribe**; sohbet listesi ekranında her sohbete ayrı dinleyici açma, tek sorgu dinle.
- Presence (çevrimiçi durumu) için Realtime Database genelde daha uygun ve ucuzdur (küçük, çok sık değişen veri).

### 5.5 Oyun

- Leaderboard: her skor değişiminde herkese canlı dinleyici yerine, zamanlanmış fonksiyonla dakikada/5 dakikada bir güncellenen **tek bir top-100 dokümanı** → herkes 1 okuma.
- Anlık oda/maç durumu senkronu gerekiyorsa Realtime Database'i değerlendir.

---

## 6. Lansman Öncesi Kontrol Listesi

- [ ] Tüm liste sorgularında `limit()` var
- [ ] Filtreleme `where()` ile sunucuda, istemcide `.filter()` yok
- [ ] Sayaçlar `getCountFromServer` / `increment` ile; koleksiyon taraması yok
- [ ] `onSnapshot` yalnızca canlı gereken ekranlarda ve hepsi unsubscribe ediliyor
- [ ] Offline persistence / cache-first stratejisi aktif
- [ ] Sınırsız büyüyen array gömülmemiş; 1 MiB doküman limiti gözetilmiş
- [ ] N+1 desenleri denormalizasyonla çözülmüş
- [ ] Security Rules'ta `if true` yok; App Check aktif
- [ ] Function tetikleyicilerinde döngü koruması + `maxInstances` tanımlı
- [ ] Görseller resize edilmiş, `Cache-Control` başlıkları ayarlı
- [ ] Geliştirme ve testler Emulator Suite'te
- [ ] Bütçe alarmı kuruldu (tercihen devre kesiciyle birlikte)
- [ ] Geçici veriler için TTL politikaları tanımlı
- [ ] "Okuma / DAU" metriği izleniyor

---

## 7. Kaynaklar

- Güncel fiyatlar: https://firebase.google.com/pricing
- Firestore best practices: https://firebase.google.com/docs/firestore/best-practices
- Firestore kota ve limitler (1 MiB vb.): https://firebase.google.com/docs/firestore/quotas
- Bütçe bildirimleri ve kill switch örnekleri: https://cloud.google.com/billing/docs/how-to/notify
- Emulator Suite: https://firebase.google.com/docs/emulator-suite
- Resize Images extension: https://extensions.dev/extensions/firebase/storage-resize-images

> **Not:** Fiyatlar ve kotalar zamanla değişir; bu dokümandaki rakamlar yön göstermek içindir. Mimari prensipler (az oku, önbellekle, sınırla, koru) kalıcıdır.
