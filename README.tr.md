<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Woffluon/unpeek/main/assets/banner-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Woffluon/unpeek/main/assets/banner-light.svg">
    <img src="https://raw.githubusercontent.com/Woffluon/unpeek/main/assets/banner-light.svg" alt="unpeek - call-graph aware client-side javascript protection" width="100%">
  </picture>
</p>

# unpeek

**Bakılacak bir şey yok. Yavaşlayacak hiçbir şey yok.**

Sıfır yapılandırma gerektiren, çağrı grafiği (call-graph) farkındalıklı, <%2 CPU ek yükü ve <%15 Gzip bütçesine sahip istemci tarafı JavaScript koruma ve çalışma zamanı (runtime) müdahale önleme aracı.

[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-111111.svg?style=flat-square)](LICENSE)
[![Sıcak Yol CPU](https://img.shields.io/badge/S%C4%B1cak%20Yol%20CPU-%3C2%25-FF3300.svg?style=flat-square)](packages/unpeek/benchmarks/overhead.bench.ts)
[![Gzip Artışı](https://img.shields.io/badge/Gzip%20Art%C4%B1%C5%9F%C4%B1-%3C15%25-111111.svg?style=flat-square)](packages/unpeek/benchmarks/overhead.bench.ts)
[![Canlı Demo](https://img.shields.io/badge/Showcase-Canl%C4%B1%20Demo-FF3300.svg?style=flat-square)](https://woffluon.github.io/unpeek)
[![Dokümantasyon](https://img.shields.io/badge/Docs-Detayl%C4%B1%20Referans-111111.svg?style=flat-square)](https://woffluon.github.io/unpeek/docs)

[English](./README.md) | Türkçe · [İnteraktif Vitrin](https://woffluon.github.io/unpeek) · [Dokümantasyon](https://woffluon.github.io/unpeek/docs) · [Ajan Mimari Kılavuzu](./AGENTS.md) · [Yapay Zeka Becerisi (SKILL.md)](./skills/unpeek/SKILL.md)

---

## Neden unpeek?

Next.js, Vite veya Webpack ile geliştirilen modern bir web uygulamasını yayına aldığınızda; istemci tarafındaki iş mantığı, iç API uç noktaları, özellik bayrakları (feature flags) ve algoritmalar Chrome DevTools veya `webcrack` / `synchrony` gibi otomatik AST çözücüler aracılığıyla açıkça okunabilir.

Mevcut araçlar geliştiricileri zor bir ödünleşime zorlar:
- **Standart küçültücüler (`esbuild`, `SWC`, `Terser`):** Yalnızca boşlukları siler ve değişken adlarını kısaltır. DevTools içerisindeki Pretty-Print (`{}`) düğmesine tek bir tıklamayla metin sabitleri, API adresleri ve kontrol akışı yeniden okunabilir hale gelir.
- **Geleneksel AST karmaşıklaştırıcılar (`javascript-obfuscator`):** Paketteki her fonksiyona ayrım gözetmeksizin ağır kontrol akışı düzleştirme (control-flow flattening), `eval` tuzakları ve dizi döndürme işlemleri uygular. Bu yaklaşım paket boyutunu %40 ile %300 oranında şişirir, V8 TurboFan JIT derleyicisinin 60fps arayüz döngülerindeki satır içi optimizasyonlarını bozar ve tarayıcıda donmalara yol açar.

`unpeek`, statik çağrı grafiği analizini derleme zamanı polimorfik şifreleme ile birleştirerek bu sorunu çözer:

| Yetenek | Standart Küçültücüler (`Terser` / `SWC`) | Geleneksel AST Karmaşıklaştırıcılar | `unpeek` |
| :--- | :--- | :--- | :--- |
| **Çalışma Zamanı CPU Ek Yükü** | ~%0 | %15 ile %85 (arayüz döngülerini yavaşlatır) | **< %2.0** (Çağrı Grafiği Hot-Path Muafiyeti) |
| **Gzip Paket Büyümesi** | %0 (Referans) | +%45 ile +%300 | **< %15** (O(1) `kConst` Sabit-Dizi Metin Kasası) |
| **Metin ve API Uç Noktası Şifreleme** | Pakette düz metin (plaintext) | Başlangıçta tam dizi çözme (yüksek CPU) | **Polimorfik Periyot-2 XOR + O(1) `kConst` Kasa** |
| **DevTools Pretty-Print (`{}`) Koruması** | Yok | `debugger` döngüleri (kolayca devre dışı bırakılır) | **`Function.prototype.toString()` FNV-1a Bütünlük Doğrulaması** |
| **Source Map Yalıtımı** | Manuel CI betikleri | Manuel yapılandırma | **Otomatik `.unpeek-maps/` Kasası + Yorum Temizliği** |
| **Statik Deobfuscator Direnci** | Yok | Sabit şablonlar (`webcrack` tarafından tanınır) | **Derleme Başına Polimorfik AST Tohumu (Seed)** |
| **SSR / Next.js Uyumluluğu** | Doğal | Sunucu hidrasyonunu (hydration) sıklıkla bozar | **Yalnızca İstemci Otomatik Tespiti + SSR Koruması** |

### Temel Mimari

```mermaid
flowchart TD
  A["İstemci Derleme Çıktısı (.next/static, dist/assets, build/static)"] --> B["Framework Dedektörü (detectTargetFramework)"]
  B --> C["Source Map Kasası (relocateSourceMaps)"]
  C -->|Haritaları taşı ve sourceMappingURL kaldır| D[".unpeek-maps/ (Özel Kasa)"]
  C --> E["İstemci JS Paketleri (.js, .mjs)"]
  E --> F["AST Sıcak Yol Analizi (detectHotPaths)"]
  F -->|Döngüler, Dizi Fonksiyonları, UI Render| G["Sıcak Yol: %0 Vergi (Opak Akış Atlanır)"]
  F -->|Soğuk Fonksiyonlar: Yetki, Lisans, İmza| H["Soğuk Yol: Opak Kontrol Akışı Koruması"]
  G --> I["Polimorfik Metin Kasası (O(1) kConst XOR)"]
  H --> I
  I --> J["Tanımlayıcı ve Sembol Maskeleme"]
  J --> K["Çalışma Zamanı Bütünlük Kalkanı (FNV-1a Özeti)"]
  K --> L["Güçlendirilmiş Üretim Paketleri"]
```

1. **Çağrı Grafiği (Call-Graph) Hot-Path Muafiyeti (`<%2` CPU Bütçesi)**
   [`detectHotPaths`](packages/unpeek/src/ast/index.ts), tek bir AST düğümünü değiştirmeden önce dosyanın çağrı grafiğini çift yönlü tarar. Döngü içeren fonksiyonlar (`for`, `while`, `do-while`, `for-of`), dizi yüksek mertebe geri çağrıları (`.map`, `.filter`, `.reduce`, `.forEach`), `requestAnimationFrame` zamanlayıcıları, React/UI bileşenleri (`useState`, `useEffect`, `createElement`) ve sıcak döngülerden çağrılan tüm yardımcı fonksiyonlar sıcak yol (hot path) olarak işaretlenir. `unpeek` sıcak döngüleri ve yardımcılarını hem opak kontrol akışı korumalarından hem de metin kasası dönüşümünden muaf tutar; korumayı yalnızca soğuk fonksiyonlara (lisans doğrulama, istek imzalama, yetki kontrolü gibi) uygular. Sıcak döngülerdeki V8 JIT optimizasyonu doğal hızında çalışmayı sürdürür.
2. **O(1) Sabit-Dizi Metin Kasası ve Kalkan Dolanıklığı (`<%15` Gzip Bütçesi)**
   Soğuk metin sabitleri (`minStringLength >= 4`), derleme zamanında LZ77/Gzip sıkıştırılabilirliğini koruyan periyot-2 polimorfik bir XOR akış şifresiyle kodlanır. Modül başlangıcında enjekte edilen `const _uC` kasası metinleri tek seferde V8 `kConst` sabit dizi hücrelerine çözer ve XOR anahtarını hem çalışma zamanı bütünlük kalkanına (`String.prototype._u`) hem de çözücü fonksiyonun kendi biçimlendirme kontrolüne (`/\n/.test(f)`) ikili olarak bağlar. Sonraki tüm okumalar doğrudan dizi indeksleme ile O(1) sürede tamamlanır.
3. **Öz-Savunmalı `Function.prototype.toString()` Bütünlük Kontrolü ve Caydırıcı Modlar (Deterrent Modes)**
   Bir analist korumalı bir dosyayı DevTools Pretty-Print (`{}`) ile biçimlendirdiğinde veya Sources panelinde bir koşulu değiştirdiğinde, biçimlendirilen kod `Function.prototype.toString()` çıktısını değiştirir. [`verifyCodeIntegrity`](packages/unpeek/src/runtime/index.ts), dokunulmamış küçültülmüş kodda sıfır yanlış pozitif oranıyla 32-bit FNV-1a özetini (checksum) doğrular. Verilen tepki `deterrentMode` seçeneğiyle yönetilir:
   - `passive` (CLI `protect` varsayılanı): Konsol çıktısını susturmadan veya uygulamayı çökertmeden `window` nesnesine bir telemetri olayı (`unpeek:tamper` event) iletir; tersine mühendislik girişimlerinin sessizce izlenmesini sağlar.
   - `gradual` (`unplugin` varsayılanı): İç çalışma zamanı çözümlemelerini kademeli olarak bozar ve `console` çıktılarını susturur; saldırganların doğrudan yamayabileceği ani bir hata yığın izi (stack trace) üretmeden kodu işlevsizleştirir.
4. **Otomatik Source Map Kasası (`.unpeek-maps/`)**
   Üretim çıktısında `.js.map` dosyalarını bırakmak, orijinal TypeScript proje ağacınızın DevTools içinde birebir yeniden oluşturulmasına yol açar. [`protectProject`](packages/unpeek/src/cli/protect.ts), `.map` dosyalarını genel çıktı dizininden özel `.unpeek-maps/` klasörüne taşır ve tüm istemci paketlerinden `//# sourceMappingURL=` yorumlarını temizler. Böylece haritaları son kullanıcılara sunmadan Sentry veya Datadog gibi platformlara yükleyebilirsiniz.

---

## Hızlı Başlangıç

### 1. Proje Kurulumu (`npx unpeek init`)

Proje kök dizininizde (Next.js, Vite, Webpack veya yalın JS) başlatıcıyı çalıştırın:

```bash
npx unpeek init
```

Bu komut üç hazırlık adımını tamamlar:
1. `package.json` ve yapılandırma dosyalarından çatınızı (`nextjs`, `vite`, `webpack` veya `vanilla`) otomatik tespit eder.
2. Her üretim derlemesinin otomatik olarak korunması için `package.json` betiklerine `"postbuild": "unpeek protect"` satırını ekler.
3. Çıkarılan kaynak haritalarının (source maps) git geçmişine girmemesi için `.gitignore` dosyasına `.unpeek-maps/` dizinini ekler.

### 2. CLI Kullanımı (`unpeek protect`)

`unpeek` paketini geliştirme bağımlılığı olarak kurup CI/CD süreçlerinde veya yerel derlemelerde doğrudan çalıştırabilirsiniz:

```bash
npm install -D unpeek
npx unpeek protect
```

#### CLI Komutları ve Seçenekleri

| Komut / Bayrak | Açıklama | Varsayılan |
| :--- | :--- | :--- |
| `init [--dry-run]` | Proje çerçevesini otomatik algılar, `postbuild` kancasını ve `.unpeek-maps/` kasasını yapılandırır | |
| `protect` | Üretim istemci paketlerini yerinde korur (varsayılan komut) | |
| `--out-dir <yol>` | İstemci çıktı klasörünü açıkça belirtir (ör. `dist/assets`, `.next/static/chunks`) | Proje framework'ünden otomatik tespit |
| `--seed <sayı>` | Deterministik 32-bit polimorfik derleme tohumu (seed) | Derleme başına rastgele |
| `--aggressive` | Katman 2 (Tier 2) agresif korumayı etkinleştirir (Micro-VM ve WASM KDF) | Varsayılan: kapalı (Tier 1 varsayılanı: <%2 CPU, <%15 Gzip) |
| `--passive` | Pasif caydırıcı modunu kullanır (konsol sessize alma olmadan yalnızca telemetri olayı) | CLI varsayılanı: `passive` (`unplugin` varsayılanı: `gradual`) |
| `--no-maps` | `.map` dosyalarını `.unpeek-maps/` klasörüne taşımak yerine kalıcı olarak sil | `.unpeek-maps/` içine taşır |
| `--min-string-length <sayı>` | O(1) `kConst` şifreleme kasasına alınacak minimum metin uzunluğu | `4` |
| `--private-maps-dir <dizin>` | Kaynak haritalarının taşınacağı özel kasa klasörü | `.unpeek-maps` |
| `--no-shield` | Çalışma zamanı anti-tamper kalkanının enjekte edilmesini devre dışı bırak | Giriş paketlerine kalkan eklenir |
| `-h, --help` | Yardım iletisini göster | |
| `-v, --version` | Sürüm numarasını göster | |

> [!NOTE]
> **Koruma Katmanları (Protection Tiers):**
> - **Tier 1 (Varsayılan):** Çağrı grafiği (call-graph) sıcak yol (hot path) muafiyeti (<%2 CPU ek yükü, <%15 Gzip bütçesi), polimorfik O(1) `kConst` sabit metin kasası, sembol maskeleme ve 32-bit FNV-1a sağlama toplamı (checksum) çalışma zamanı kalkanı.
> - **Tier 2 (`--aggressive`):** Güvenlik açısından kritik mantıklar için bayt kodu Micro-VM sanallaştırması ve satır içi WebAssembly Anahtar Türetme Fonksiyonu (WASM KDF - Key Derivation Function).
>
> `protectProject(options)` üzerinden programatik kullanım; `minStringLength`, `privateMapsDir`, `injectRuntimeShield`, `aggressive` ve `cwd` gibi ek yapılandırma seçeneklerini destekler.

> [!IMPORTANT]
> **CommonJS Kullanıcıları İçin Dinamik `import()` Uyarısı:**
> `unpeek` varsayılan olarak yerel ECMAScript Modülleri (`"type": "module"`) ile dağıtılmaktadır. CommonJS kullanan projelerde (`require()` veya `.cjs` yapılandırma dosyaları) `unpeek` modüllerini dinamik `import()` ile yükleyiniz:
> ```javascript
> // CommonJS (next.config.js / webpack.config.js / betikler)
> const unpeek = (await import('unpeek/unplugin')).default;
> const { protectProject, transformJavaScript } = await import('unpeek');
> ```

### 3. Evrensel Paketleyici Eklentisi (`unpeek/unplugin`)

Derleme sonrası CLI adımı yerine paketleyicinin `renderChunk` yaşam döngüsü sırasında bellek içi dönüşüm yapmak isterseniz [`unpeek/unplugin`](packages/unpeek/src/bundler/unplugin.ts) modülünü kullanabilirsiniz:

#### Vite (`vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import unpeek from 'unpeek/unplugin';

export default defineConfig({
  plugins: [
    unpeek.vite({
      deterrentMode: 'gradual',
    }),
  ],
});
```

#### Next.js (`next.config.mjs`)

Node.js sunucu paketlerinin özgün yığın izlerini (stack traces) koruması için eklentiyi istemci paketleriyle (`!isServer`) sınırlandırın:

```js
import unpeek from 'unpeek/unplugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      config.plugins.push(
        unpeek.webpack({
          deterrentMode: 'gradual',
        })
      );
    }
    return config;
  },
};

export default nextConfig;
```

#### Programatik API

```ts
import { transformJavaScript, protectProject } from 'unpeek';

// Tek bir JavaScript kod dizesini bellek içinde dönüştürün
const result = transformJavaScript(sourceCode, {
  seed: 0x7f3a91,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: 'gradual',
});

console.log(result.hotPathReport);
// { totalFunctions: 12, hotFunctionsSkipped: ['renderLoop'], coldFunctionsProtected: ['signRequest'] }

// Veya tüm derleme dizinini koruyun
const summary = await protectProject({
  cwd: process.cwd(),
  keepPrivateMaps: true,
  privateMapsDir: '.unpeek-maps',
});
```

---

## Yapılandırma Dosyası (`unpeek.config.js` / `.mjs` / `.cjs` / `.json`)

`unpeek`, proje kök dizinindeki özel bir yapılandırma dosyası (configuration file) aracılığıyla bildirimsel yapılandırmayı destekler. Hem CLI hem de paketleyici eklentileri (bundler plugins), yapılandırma dosyalarını şu öncelik sırasına göre otomatik olarak keşfeder:
1. `unpeek.config.js`
2. `unpeek.config.mjs`
3. `unpeek.config.cjs`
4. `unpeek.config.json`

### Tip Güvenli Yapılandırma (`defineConfig`)

IDE otomatik tamamlama ve TypeScript tip doğrulamasını etkinleştirmek için `'unpeek'` üzerinden `defineConfig` yardımcısını içe aktarın:

```javascript
// unpeek.config.mjs (veya unpeek.config.js)
import { defineConfig } from 'unpeek';

export default defineConfig({
  // Hedef çatı geçersiz kılma ('nextjs' | 'vite' | 'webpack' | 'vanilla')
  framework: 'nextjs',

  // Hedef çalışma ortamı ('browser' | 'worker' | 'universal')
  target: 'browser',

  // İstemci çıktı dizini geçersiz kılma (belirtilmezse çatıdan otomatik algılanır)
  outDir: '.next/static/chunks',

  // Korumaya dahil edilecek dosya uzantıları
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],

  // Genel statik varlık dizinleri
  publicDirs: ['public', 'static'],

  // Dosya dahil etme ve hariç tutma filtreleri
  filter: {
    include: [],
    exclude: ['node_modules/**', '**/*.test.*', '**/*.spec.*'],
  },

  // Çağrı grafiği analizi ve sıcak yol (hot path) ince ayarları
  hotPath: {
    // Korumadan muaf tutulacak özel animasyon döngüsü ve zamanlayıcı fonksiyonları
    customAnimationCalls: ['requestAnimationFrame', 'ticker', 'renderLoop'],
    // UI render sınırı olarak ele alınacak özel React kancaları (hooks)
    customHooks: ['useAnimation', 'useCanvas'],
    // Sıcak döngü muamelesi görecek yüksek mertebe dizi fonksiyonları
    arrayHofMethods: ['map', 'filter', 'reduce', 'forEach'],
    // Sıcak yol muafiyeti için geçişken çağıran tarama derinliği (varsayılan: 2)
    maxPipelineCallers: 2,
    // AST dönüşümünden tamamen muaf tutulacak bileşen adları
    excludeComponents: ['VirtualTable', 'DataGrid'],
  },

  // Polimorfik metin kasası (string vault) yapılandırması
  vault: {
    // O(1) kConst dizisine şifrelenecek minimum metin uzunluğu (varsayılan: 4)
    minStringLength: 4,
    // CSS çatısı sınıf ayrıştırması ('tailwind' | 'unocss' | 'none')
    cssFramework: 'tailwind',
    // UI sınıf dizgilerini ve anlamsal DOM bağlayıcılarını koru
    semanticAnchors: {
      excludeUiClasses: true,
    },
    // Otomatik entropi tarayıcılarını yanıltmak için sahte metinler üret
    polymorphicDecoys: true,
  },

  // Tanımlayıcı ve sembol maskeleme (mangler) yapılandırması
  mangler: {
    // Maskelemeden muaf tutulacak üst düzey tanımlayıcılar
    reservedIdentifiers: ['__NEXT_DATA__', '__PRELOADED_STATE__'],
    // Korunacak özellik önekleri
    excludePrefixes: ['data-', 'aria-'],
    // Korunacak düzenli ifade (RegExp) desenleri
    excludePatterns: [/^on[A-Z]/],
  },

  // Özel kaynak haritası (source map) kasası seçenekleri
  sourcemaps: {
    // .map dosyalarını özel kasa dizinine taşı (varsayılan: true)
    keepPrivate: true,
    // Taşınan kaynak haritaları için özel dizin adı (varsayılan: '.unpeek-maps')
    vaultDir: '.unpeek-maps',
    // İstemci paketlerinden //# sourceMappingURL= yönergelerini temizle (varsayılan: true)
    stripComments: true,
  },

  // Next.js'e özgü geçersiz kılmalar
  next: {
    // Özel derleme çıktı dizini (varsayılan: '.next')
    distDir: '.next',
  },

  // Vite'a özgü geçersiz kılmalar
  vite: {
    // Çıktı dizini (varsayılan: 'dist')
    outDir: 'dist',
    // outDir içerisindeki varlıklar dizini (varsayılan: 'assets')
    assetsDir: 'assets',
  },
});
```

JSON formatındaki yapılandırmalar için (`unpeek.config.json`):

```json
{
  "framework": "nextjs",
  "target": "browser",
  "vault": {
    "minStringLength": 4,
    "cssFramework": "tailwind"
  },
  "sourcemaps": {
    "keepPrivate": true,
    "vaultDir": ".unpeek-maps"
  },
  "next": {
    "distDir": ".next"
  }
}
```

---

## `.unpeek-maps/` Source Map Kasası ve Sentry İş Akışı

`keepPrivateMaps` etkinleştirildiğinde (varsayılan), `unpeek` genel çıktı dizininizdeki tüm `.js.map` dosyalarını göreli dosya adlarını koruyarak `.unpeek-maps/` dizinine taşır ve genel `.js` dosyalarından `//# sourceMappingURL=` yönergelerini temizler.

> [!CAUTION]
> **Konteyner Güvenliği Uyarısı (`.dockerignore`):**
> Web uygulamalarınızı Docker ile paketlerken `.unpeek-maps/` dizininin `.dockerignore` dosyasına eklendiğinden emin olun. Eğer `.unpeek-maps/` atlanırsa, standart `COPY . .` komutları özel kaynak haritalarını yayınlanan konteyner imaj katmanına kopyalar ve imaja erişimi olan herkesin orijinal kaynak kodlarınızı elde etmesine yol açar. `unpeek` CLI, derleme sırasında `.dockerignore` dosyasını otomatik olarak denetler ve bu kayıt eksikse uyarı mesajı görüntüler.

Üretim hata izleme sistemlerinde tam yığın izi çözümlemesini (symbolication) korumak için:

```bash
# 1. Uygulamanızı derleyin ve unpeek'i çalıştırın (postbuild ile otomatik tetiklenir)
npm run build

# 2. .unpeek-maps/ klasöründeki gizli kaynak haritalarını Sentry veya Datadog'a yükleyin
npx @sentry/cli sourcemaps upload .unpeek-maps --release="$GIT_COMMIT_SHA"

# 3. Genel derleme klasörünüzü (.next/, dist/ veya build/) dağıtın
```

---

## Yapay Zeka Kodlama Ajanı Entegrasyonu (AI Coding Agent Integration)

`unpeek`, açık Vercel Agent Skills belirtimi ve Ajan Becerileri Keşif Optimizasyonu (SDO) standartlarıyla tam uyumlu resmi bir Yapay Zeka Ajan Becerisi ([`skills/unpeek/SKILL.md`](skills/unpeek/SKILL.md)) sunar. Bu beceriyi eklemek; kodlama ajanlarınıza (Claude Code, Cursor, OpenAI Codex, Gemini CLI, GitHub Copilot, OpenCode) istemci paketlerini koruma, hot-path performans bütçelerini (<%2 CPU, <%15 Gzip) koruma, SSR sınırlarını gözetme ve `.unpeek-maps/` kasasını CI/CD hatlarına bağlama konularında doğrudan operasyonel iş akışları kazandırır.

### Beceri (Skill) Kurulumu

#### 1. Standart Kurulum (Vercel Agent Skills CLI)

Beceriyi doğrudan GitHub üzerinden projenize veya yapılandırılmış ajan ortamınıza kurun:

```bash
npx skills add Woffluon/unpeek
```

#### 2. Yerel Depo Kurulumu

`unpeek` deposu içerisinde doğrudan geliştirme veya test yaparken:

```bash
npx skills add .
```

#### 3. Çoklu Ajan Hedefleme ve Global Kurulum

Etkileşimli onay istemlerini atlayarak birden çok kodlama ajanını global olarak hedefleyin:

```bash
npx skills add Woffluon/unpeek --agent claude-code codex cursor gemini-cli github-copilot opencode --global --yes
```

#### 4. Manuel / Doğrudan Kopyalama ile Kurulum

Beceriyi proje düzeyindeki veya genel ajan dizinlerine manuel olarak da indirebilirsiniz:

```bash
# Proje kapsamında (.agents/skills/unpeek/SKILL.md)
mkdir -p .agents/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o .agents/skills/unpeek/SKILL.md

# Genel ajan dizinleri (Antigravity / Gemini CLI / Claude Code)
mkdir -p ~/.agents/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o ~/.agents/skills/unpeek/SKILL.md
```

### Ajan Tetikleme Örneği (Prompt)

Kurulum tamamlandıktan sonra herhangi bir ajan oturumunda `$unpeek` istemiyle koruma sürecini başlatın:

```text
$unpeek Protect this build with passive telemetry and seed 0x7f4a2c.
```

### Token-Optimize Modüler Referans Yapısı (`skills/unpeek/references/`)

Ajan bağlam penceresini (context window) korumak ve gereksiz token tüketimini önlemek için ana [`skills/unpeek/SKILL.md`](skills/unpeek/SKILL.md) dosyası kompakt tutulmuş; detaylı rehberler `skills/unpeek/references/` dizini altındaki 6 modüler dokümana ayrılmıştır:

- **`quickstart.md`**: Sıfır ayarlı kurulum, postbuild betikleri ve 3 adımlı doğrulama döngüsü.
- **`frameworks.md`**: Çatı bazlı yapılandırmalar ve SSR istemci sınırları (Next.js, Vite, Webpack, Rollup).
- **`architecture.md`**: Acorn AST ayrıştırma, geçişken çağrı grafiği hot-path muafiyeti ve FNV-1a sağlama toplamları.
- **`sourcemaps.md`**: `.unpeek-maps/` kasa izolasyonu, CI hatları ve Sentry/Datadog sembol yükleme iş akışları.
- **`api.md`**: CLI bayrakları, programatik Node.js metotları (`protectProject`, `transformJavaScript`) ve TypeScript arayüzleri.
- **`recipes.md`**: Üretim zırhlama tarifleri, deterministik CI tohumları ve pasif telemetri sorun giderme adımları.

Ajanlar yalnızca o anki görevin gerektirdiği referans dosyasını seçici olarak okur; böylece bağlam şişmesi engellenir.

---

## Doğrulama, Testler ve Benchmarklar

Bu monorepo `pnpm` ile yönetilir; semantik denklik, çözücü direnci ve çalışma zamanı ek yük bütçeleri doğrulanır:

```bash
# Çalışma alanı bağımlılıklarını kurun
pnpm install

# Birim ve tersine mühendislik direnç testlerini çalıştırın (Vitest)
pnpm test

# V8 kod kapsamı raporu ile birim testlerini çalıştırın
pnpm --filter unpeek run test:coverage

# V8 VM CPU ek yükü (<%2) ve Gzip artışı (<%15) benchmark testini çalıştırın
pnpm bench

# packages/unpeek ve apps/web genelinde katı TypeScript tip kontrolü yapın
pnpm typecheck

# Çekirdek paketi ve statik interaktif web arayüzünü derleyin
pnpm build
```

### Monorepo Betikleri ve Sürüm Bütünlüğü

```bash
# Conventional Commit sürüm hesaplamasını test edin
powershell -File scripts/test-versioning.ps1

# Planlanan commit ile sürüm uygunluğunu doğrulayın
powershell -File scripts/validate-version.ps1 -Message "fix: description"

# Sürüm paketlerini ve SHA-256 manifestlerini hazırlayın
powershell -File scripts/stage-release.ps1
```

### Benchmark Çıktı Referansı ([`packages/unpeek/benchmarks/overhead.bench.ts`](packages/unpeek/benchmarks/overhead.bench.ts))

- **Derleme / Dönüşüm Süresi:** `< 3000 ms`
- **Gzip Boyut Artışı:** `< %15` (üretim uygulama paketlerinde)
- **Çalışma Zamanı CPU Ek Yükü:** `< %2.00` (aralıklı çok turlu V8 JIT testi)
- **Düz Metin Sızıntı Oranı:** `%0` (`minStringLength` kuralını karşılayan metin sabitleri için)

## Lisans

[MIT Lisansı](./LICENSE) kapsamında yayınlanmıştır.
