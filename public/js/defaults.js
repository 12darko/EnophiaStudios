'use strict';
/* Default site content. Every text field is bilingual: { tr: '...', en: '...' }.
   Content saved in Firestore (site/content) is deep-merged over these defaults
   at load time, so newly added fields automatically appear for existing data. */

function clone(o) { return JSON.parse(JSON.stringify(o)); }

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object') {
    const out = Array.isArray(base) ? [] : Object.assign({}, base);
    for (const k of Object.keys(over)) {
      if (over[k] && typeof over[k] === 'object' && base && typeof base[k] === 'object' && !Array.isArray(over[k])) {
        out[k] = deepMerge(base[k], over[k]);
      } else {
        out[k] = over[k];
      }
    }
    return out;
  }
  return over;
}

const CONTENT_DEFAULTS = {
  hero: {
    title: { tr: 'Büyük fikirleri olan küçük dünyalar kuruyoruz.', en: 'We build small worlds with big ideas.' },
    sub: {
      tr: 'Enophia, strateji savaşlarından bulmaca-survival’a uzanan oyunlar geliştiren bağımsız bir oyun stüdyosu. Tasarımdan koda her aşamayı stüdyo bünyesinde, özenle üretiyoruz.',
      en: 'Enophia is an independent game studio crafting titles that range from strategy battles to puzzle survival. Every stage — from design to code — is produced in-house with care.'
    },
  },
  vision: {
    tr: 'Hatırlanmaya değer dünyalar kurmak. Kapsam yerine sıkı ve dürüst oynanışın peşindeyiz — oyuncunun zamanına saygı duyan deneyimler.',
    en: 'To build worlds worth remembering. We chase tight, honest gameplay over scope — experiences that respect the player’s time.'
  },
  mission: {
    tr: 'Kendimizin oynamak isteyeceği oyunları çıkarmak. Jam prototiplerini bitmiş oyunlara dönüştürüp itch.io, Steam ve mobile taşımak — her seferinde özenli tek bir sürüm.',
    en: 'Ship games we’d want to play. Turn jam prototypes into finished titles and bring them to itch.io, Steam, and mobile — one polished release at a time.'
  },
  next: [
    { tag: { tr: 'Steam', en: 'Steam' }, h: { tr: 'Çok yakında', en: 'Coming soon' }, t: { tr: 'Favori oyunlarımızı daha büyük bir sahneye, Steam’e taşıyoruz.', en: 'Bringing our favorites to a bigger stage on Steam.' } },
    { tag: { tr: 'Play Store', en: 'Play Store' }, h: { tr: 'Geri dönüyor', en: 'Returning' }, t: { tr: 'Mobil sayfamız şu an kapalı; yeniden yapılıyor ve yakında tekrar yayında olacak.', en: 'Our mobile page is closed for now — it’s being rebuilt and will be back online soon.' } },
    { tag: { tr: 'Yeni proje', en: 'New project' }, h: { tr: 'Geliştiriliyor', en: 'In development' }, t: { tr: 'Perde arkasında yeni bir şey şekilleniyor.', en: 'Something new is taking shape behind the scenes.' } },
  ],
  story: {
    tr: 'Enophia, Türkiye merkezli bağımsız bir oyun stüdyosu. Tasarım, kod, sanat ve ses dahil tüm geliştirme süreçlerini stüdyo bünyesinde yürütüyoruz. Bu odaklı yapı, yayınladığımız her oyunun detayına doğrudan dokunabilmemizi sağlıyor; amacımız özenle işlenmiş, akılda kalıcı oyunlar ortaya koymak.',
    en: 'Enophia is an independent game studio based in Turkey. All development — design, code, art, and sound — is handled in-house. This focused structure lets us shape every detail of every title we ship; our goal is carefully crafted, memorable games.'
  },
  about: {
    lead: {
      tr: 'Enophia, game jam’lerde doğan projeleri özenle geliştirilmiş oyunlara dönüştüren, Türkiye merkezli bağımsız bir oyun stüdyosu.',
      en: 'Enophia is an independent game studio from Turkey, turning projects born in game jams into carefully crafted releases.'
    }
  },
  team: [
    { name: 'Eyüp Ender Okyay', handle: 'reinells', role: { tr: 'Kurucu Ortak · Oyun Geliştirici', en: 'Co-Founder · Game Developer' }, linkedin: 'https://www.linkedin.com/in/ey%C3%BCp-ender-okyay-a09504238/', initials: 'EE' },
    { name: 'Ahmet Ali Kınalı', handle: 'aakinali', role: { tr: 'Kurucu Ortak · Oyun Geliştirici', en: 'Co-Founder · Game Developer' }, linkedin: 'https://www.linkedin.com/in/ahmet-ali-kinali/', initials: 'AA' },
  ],
  contact: {
    sub: { tr: 'Bir fikir, iş birliği ya da sadece merhaba — her zaman bekleriz.', en: 'An idea, a collaboration, or just a hello — we’re always glad to hear from you.' }
  },
  blog: [],
  links: {
    itch: 'https://enophia.itch.io/',
    youtube1: 'https://www.youtube.com/@enophiastudios5117',
    youtube2: 'https://www.youtube.com/@teamenophiastudio',
    linkedin1: 'https://www.linkedin.com/in/ey%C3%BCp-ender-okyay-a09504238/',
    linkedin2: 'https://www.linkedin.com/in/ahmet-ali-kinali/',
    email: 'enophiastudio@gmail.com',
  },
  games: [
    {
      slug: 'villagers', hasDetail: true, accent: '#e0a85e',
      title: 'Villagers vs. Gods',
      itch: 'https://enophia.itch.io/villagers-vs-gods',
      cover: 'https://img.itch.zone/aW1nLzE3Nzg5MDc3LnBuZw==/original/8ZrpFr.png',
      platforms: 'Windows', jam: 'Brackeys Game Jam 2024.2', video: 'deiVQ-Uzx7E',
      shots: [
        'https://img.itch.zone/aW1hZ2UvMjk3Mzg2NC8xNzc5MDUwNC5wbmc=/original/F1ozLX.png',
        'https://img.itch.zone/aW1hZ2UvMjk3Mzg2NC8xNzc5MDUwNi5wbmc=/original/ihgnm2.png',
        'https://img.itch.zone/aW1hZ2UvMjk3Mzg2NC8xNzc5MDUwNy5wbmc=/original/sj%2Ffb3.png',
      ],
      genre: { tr: 'RTS · Strateji · Minimalist', en: 'RTS · Strategy · Minimalist' },
      tagline: { tr: 'Poseidon’u yönet. Durmadan inşa eden bir köyü yerle bir et.', en: 'Play as Poseidon. Tear down a village that won’t stop building.' },
      story: {
        tr: 'Deniz tanrısı Poseidon ile Athena’nın sadık köylüleri arasında şiddetli bir savaş sürer. Köylüler evler kurar ve Athena’nın kutsal heykelini tahkim ederken, sen — Poseidon — ilahi gücünle tüm çabalarını yok etmeye çalışırsın.',
        en: 'An intense battle rages between Poseidon, god of the sea, and the devoted villagers of Athena. The villagers build homes and fortify Athena’s sacred statue, while you — Poseidon — unleash divine wrath to destroy their efforts.'
      },
      gameplay: {
        tr: 'Sakin, tepeden bakışlı ortografik bir görünüme sahip minimalist bir RTS. Yapay zeka köylüler heykeli korumak için sürekli bina diker; sen savunmalarını kırmak için her hamleni planlamalısın.',
        en: 'A minimalist RTS with a calm, top-down orthographic view. The AI villagers constantly construct buildings to defend the statue; you must plan every strike to break their defenses.'
      },
      features: {
        tr: ['Tanrıya karşı köylüler — heykellerini savunurken kaos sal', 'Rahatlatıcı ama stratejik, sade ve şık grafikler', 'Tepeden bakışlı ortografik savaş alanı', 'Brackeys Game Jam 2024.2 için bir haftada geliştirildi'],
        en: ['God vs. villagers — unleash chaos as they defend their statue', 'Minimalist, chill graphics for a relaxing yet strategic feel', 'Top-down orthographic battlefield', 'Built in one week for Brackeys Game Jam 2024.2']
      },
    },
    {
      slug: 'misty', hasDetail: true, accent: '#5bc0be',
      title: 'Protect The Misty',
      itch: 'https://enophia.itch.io/protect-the-misty',
      cover: 'https://img.itch.zone/aW1nLzE3NjM0ODcyLnBuZw==/original/%2B8%2Fkyv.png',
      platforms: 'Windows · macOS · Linux', jam: 'ScoreSpace Jam #31', video: '0stxQ5V19pY',
      shots: [
        'https://img.itch.zone/aW1hZ2UvMjk0NTk0NS8xNzY0MzAzNy5wbmc=/original/vaSP9W.png',
        'https://img.itch.zone/aW1hZ2UvMjk0NTk0NS8xNzY0MzAzNi5wbmc=/original/y2L1U3.png',
        'https://img.itch.zone/aW1hZ2UvMjk0NTk0NS8xNzY0MzAzOC5wbmc=/original/wqL0y4.png',
        'https://img.itch.zone/aW1hZ2UvMjk0NTk0NS8xNzY0MzAzOS5wbmc=/original/LkIZGZ.png',
      ],
      genre: { tr: '2D Platform · Bulmaca · Hayatta Kalma', en: '2D Platformer · Puzzle · Survival' },
      tagline: { tr: 'Slime Misty tehlikede. Tehditler gelmeden savunmasını kur.', en: 'Misty the slime is in danger. Build her defenses before the threats arrive.' },
      story: {
        tr: 'Sevimli ama savunmasız bir slime olan Misty, tehlikeli bir dünyaya düşer. Lav, göktaşları ve ölümcül tehditler her yönden yaklaşır — onu hayatta tutmak sana kalmıştır.',
        en: 'Misty, a cute but vulnerable slime, has fallen into a dangerous world. Lava, meteors and deadly threats close in from every direction — and it’s up to you to keep her alive.'
      },
      gameplay: {
        tr: 'Her tehdidin nereden geleceğini imleçler gösterir. Her bölümün başındaki hazırlık süresinde platformlar ve engeller yerleştirerek Misty’yi güvene al, sonra saldırıdan sağ çık.',
        en: 'Cursors mark where each threat will strike. During the prep time at the start of every level, place platforms and obstacles to seal Misty in safety, then survive the assault.'
      },
      features: {
        tr: ['Her yönden tehdit — lav, göktaşı ve dahası', 'Her bölüm öncesi stratejik hazırlık aşaması', 'Sade ama zorlayıcı, akıcı mekanikler', 'ScoreSpace Jam #31 için geliştirildi'],
        en: ['Threats from every direction — lava, meteors and more', 'Strategic preparation phase before each level', 'Simple, fluid mechanics that stay challenging', 'Built for ScoreSpace Jam #31']
      },
    },
    {
      slug: 'echoes', hasDetail: false, accent: '#9b6cd8',
      title: 'Echoes in the Shadow',
      itch: 'https://enophia.itch.io/echoes-in', platforms: '', jam: '', video: '', cover: '', shots: [],
      genre: { tr: 'Bulmaca', en: 'Puzzle' },
      tagline: { tr: 'Işık ve gölgenin atmosferik bir bulmacası.', en: 'An atmospheric puzzle of light and shadow.' },
      story: { tr: '', en: '' }, gameplay: { tr: '', en: '' }, features: { tr: [], en: [] },
    },
    {
      slug: 'temple', hasDetail: false, accent: '#c4544a',
      title: 'The Evil In The Temple',
      itch: 'https://enophia.itch.io/the-evil-in-the-temple', platforms: '', jam: '', video: '', cover: '', shots: [],
      genre: { tr: 'Oyun · itch.io', en: 'Game · itch.io' },
      tagline: { tr: 'Tapınağın içinde kadim bir şey kıpırdanıyor.', en: 'Something ancient stirs inside the temple.' },
      story: { tr: '', en: '' }, gameplay: { tr: '', en: '' }, features: { tr: [], en: [] },
    },
    {
      slug: 'yilbasi', hasDetail: false, accent: '#5b8cff',
      title: 'Yılbaşının Laneti',
      itch: 'https://enophia.itch.io/ylbann-laneti', platforms: '', jam: '', video: '', cover: '', shots: [],
      genre: { tr: 'Oyun · itch.io', en: 'Game · itch.io' },
      tagline: { tr: 'Şenlikli bir gece bir lanete dönüşür.', en: 'A festive night turns into a curse.' },
      story: { tr: '', en: '' }, gameplay: { tr: '', en: '' }, features: { tr: [], en: [] },
    },
  ],
};
