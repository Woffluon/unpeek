# unpeek

**Sıfır yapılandırma gerektiren, çağrı grafiği (call-graph) farkındalıklı, <%2 CPU ek yüküne sahip polimorfik JavaScript koruma ve çalışma zamanı (runtime) müdahale önleme aracı.**

[![Lisans: MIT](https://img.shields.io/badge/Lisans-MIT-emerald.svg)](LICENSE)
[![CPU Ek Yükü](https://img.shields.io/badge/CPU_Ek_Y%C3%BCk%C3%BC-%3C2%25-10b981.svg)](packages/unpeek/benchmarks/overhead.bench.ts)
[![Gzip Artışı](https://img.shields.io/badge/Gzip_Art%C4%B1%C5%9F%C4%B1-%3C15%25-06b6d4.svg)](packages/unpeek/benchmarks/overhead.bench.ts)
[![Canlı Playground](https://img.shields.io/badge/Playground-Canl%C4%B1_Demo-6366f1.svg)](https://woffluon.github.io/unpeek)

[English](./README.md) | Türkçe · [Canlı İnteraktif Playground](https://woffluon.github.io/unpeek) · [Ajan Mimari Kılavuzu](./AGENTS.md) · [Yapay Zeka Becerisi (SKILL.md)](./skills/unpeek/SKILL.md)

---

<baglam>

## Neden unpeek?

Next.js, Vite veya Webpack ile geliştirilen modern bir web uygulamasını yayına aldığınızda; istemci tarafındaki iş mantığı, iç API uç noktaları, özellik bayrakları (feature flags) ve özel algoritmalar Chrome DevTools'u açan veya otomatik AST çözücüleri (`webcrack`, `synchrony`) çalıştıran herkes için okunabilir hale gelir.

Mevcut araçlar geliştiricileri zor bir ödünleşime zorlar:
- **Standart küçültücüler (`esbuild`, `SWC`, `Terser`)** yalnızca boşlukları siler ve değişken adlarını kısaltır; DevTools içerisindeki Pretty-Print (`{}`) düğmesine tek bir tıklamayla metin sabitleri, API adresleri ve kontrol akışı yeniden okunabilir olur.
- **Geleneksel AST karmaşıklaştırıcılar (`javascript-obfuscator`)** paketteki her fonksiyona ayrım gözetmeksizin ağır kontrol akışı düzleştirme (control-flow flattening), `eval` tuzakları ve dizi döndürme işlemleri uygular. Bu yaklaşım paket boyutunu %40–%300 oranında şişirir, V8 TurboFan JIT derleyicisinin 60fps arayüz döngülerindeki satır içi (inlining) optimizasyonlarını bozar ve tarayıcıda donmalara yol açar.

`unpeek`, statik çağrı grafiği analizini derleme zamanı polimorfik şifreleme ile birleştirerek bu sorunu çözer:

| Yetenek | Standart Küçültücüler (`Terser` / `SWC`) | Geleneksel AST Karmaşıklaştırıcılar | `unpeek` |
| :--- | :--- | :--- | :--- |
| **Çalışma Zamanı CPU Ek Yükü** | ~%0 | %15 – %85 (UI döngülerini yavaşlatır) | **< %2.0** (Çağrı Grafiği Hot-Path Muafiyeti) |
| **Gzip Paket Büyümesi** | %0 (Referans) | +%45 – +%300 | **< %15** (O(1) Tembel Metin Kasası) |
| **Metin ve API Uç Noktası Şifreleme** | Pakette düz metin (plaintext) | Başlangıçta tam dizi çözme (yüksek CPU) | **Polimorfik XOR + O(1) Önbellekli Kasa** |
| **DevTools Pretty-Print (`{}`) Koruması** | Yok | `debugger` döngüleri (kolayca devre dışı bırakılır) | **`Function.prototype.toString()` FNV-1a Bütünlük Doğrulaması** |
| **Source Map Yalıtımı** | Manuel CI betikleri | Manuel yapılandırma | **Otomatik `.unpeek-maps/` Kasası + Yorum Temizliği** |
| **Statik Deobfuscator Direnci** | Yok | Sabit şablonlar (`webcrack` tarafından tanınır) | **Derleme Başına Polimorfik AST Tohumu (Seed)** |
| **SSR / Next.js Uyumluluğu** | Doğal | Sunucu hidrasyonunu (hydration) sıkça bozar | **Yalnızca İstemci Otomatik Tespiti + SSR Koruması** |

### Temel Mimari

1. **Çağrı Grafiği (Call-Graph) Hot-Path Muafiyeti (`<%2` CPU Bütçesi)**
   [`detectHotPaths`](packages/unpeek/src/ast/index.ts), tek bir AST düğümünü değiştirmeden önce dosyanın çağrı grafiğini tarar. Döngü içeren fonksiyonlar (`for`, `while`, `do-while`, `for-of`), dizi yüksek mertebe geri çağrıları (`.map`, `.filter`, `.reduce`, `.forEach`), `requestAnimationFrame` zamanlayıcıları ve React/UI bileşenleri (`useState`, `useEffect`, `createElement`) sıcak yol (hot path) olarak işaretlenir. `unpeek` tüm paketteki yerel tanımlayıcıları maskeler ve metin sabitlerini şifreler; buna karşılık opak kontrol akışı korumalarını yalnızca soğuk fonksiyonlara (lisans doğrulama, istek imzalama, yetki kontrolü gibi) enjekte eder. Böylece sıcak döngülerdeki V8 JIT optimizasyonu doğal hızında çalışmaya devam eder.
2. **O(1) Tembel Metin Kasası — Lazy String Vault (`<%15` Gzip Bütçesi)**
   Düz metin sabitleri (`minStringLength >= 4`), derleme zamanında 32-bitlik polimorfik bir tohum (seed) ile anahtarlanan XOR akış şifresiyle kodlanır. Sayfa açılışında tüm metinleri aynı anda çözmek yerine, enjekte edilen kasa yardımcısı her metni ilk erişildiğinde tembel (lazy) olarak çözer ve düz metin sonucunu kendi dizi hücresine önbellekler. Sonraki tüm okumalar doğrudan dizi indeksleme ile O(1) sürede tamamlanır.
3. **Öz-Savunmalı `Function.prototype.toString()` Bütünlük Kontrolü ve Pasif Caydırıcı**
   Bir analist korumalı bir dosyayı DevTools Pretty-Print (`{}`) ile biçimlendirdiğinde veya Sources panelinde bir koşulu değiştirdiğinde, biçimlendirilen kod `Function.prototype.toString()` çıktısını değiştirir. [`verifyCodeIntegrity`](packages/unpeek/src/runtime/index.ts), dokunulmamış küçültülmüş kodda sıfır yanlış pozitif oranıyla 32-bit FNV-1a özetini doğrular ve saldırganların kolayca yamayabileceği ani bir çökme yerine kademeli durum bozulması (`deterrentMode: 'gradual'`) başlatır.
4. **Otomatik Source Map Kasası (`.unpeek-maps/`)**
   Üretim çıktısında `.js.map` dosyalarını bırakmak, orijinal TypeScript proje ağacınızın DevTools içinde birebir yeniden oluşturulmasına yol açar. [`protectDirectory`](packages/unpeek/src/cli/index.ts), `.map` dosyalarını genel çıktı dizininden özel `.unpeek-maps/` klasörüne taşır ve tüm istemci paketlerinden `//# sourceMappingURL=` yorumlarını temizler. Böylece haritaları son kullanıcılara sunmadan Sentry veya Datadog'a yükleyebilirsiniz.

</baglam>

---

<talimat>

## Hızlı Başlangıç

### 1. Tek Komutla Proje Kurulumu (`npx unpeek init`)

Proje kök dizininizde (Next.js, Vite, Webpack veya yalın JS) başlatıcıyı çalıştırın:

```bash
npx unpeek init
```

Bu komut mevcut yapıyı bozmadan üç hazırlık adımını tamamlar:
1. `package.json` ve yapılandırma dosyalarından çatınızı (`nextjs`, `vite`, `webpack` veya `vanilla`) otomatik tespit eder.
2. Her üretim derlemesinin otomatik olarak korunması için `package.json` betiklerine `"postbuild": "unpeek protect"` satırını ekler.
3. Çıkarılan kaynak haritalarının (source maps) git geçmişine girmemesi için `.gitignore` dosyasına `.unpeek-maps/` dizinini ekler.

### 2. CLI Kullanımı (`unpeek protect`)

`unpeek` paketini geliştirme bağımlılığı olarak kurup CI/CD süreçlerinde veya yerel derlemelerde doğrudan çalıştırabilirsiniz:

```bash
npm install -D unpeek
npx unpeek protect
```

#### CLI Seçenekleri

| Bayrak | Açıklama | Varsayılan |
| :--- | :--- | :--- |
| `--dir <yol>` | İstemci çıktı dizinini açıkça belirtir (ör. `dist/assets`, `.next/static/chunks`) | Otomatik tespit |
| `--seed <sayı>` | Deterministik 32-bit polimorfik derleme tohumu (seed) | Derleme başına rastgele |
| `--mode <gradual\|passive>` | Çalışma zamanı müdahale caydırıcı modu | `gradual` |
| `--min-str <sayı>` | O(1) tembel metin kasasında şifrelenecek en kısa metin uzunluğu | `4` |
| `--no-shield` | Çalışma zamanı bütünlük ve DevTools telemetri önsözünü eklemeyi atlar | Kalkan aktif |
| `--delete-maps` | `.map` dosyalarını `.unpeek-maps/` klasörüne taşımak yerine kalıcı olarak siler | `.unpeek-maps/` içine taşır |

### 3. Evrensel Paketleyici Eklentisi (`unpeek/unplugin`)

Derleme sonrası CLI adımı yerine paketleyicinin `renderChunk` yaşam döngüsü sırasında bellek içi (in-memory) dönüşüm yapmak isterseniz [`unpeek/unplugin`](packages/unpeek/src/bundler/unplugin.ts) modülünü kullanabilirsiniz:

#### Vite (`vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import unpeek from 'unpeek/unplugin';

export default defineConfig({
  build: {
    sourcemap: true, // Otomatik olarak .unpeek-maps/ içerisine ayrıştırılır
  },
  plugins: [
    unpeek.vite({
      deterrentMode: 'gradual',
      keepPrivateMaps: true,
    }),
  ],
});
```

#### Next.js (`next.config.mjs`)

Node.js sunucu paketlerinin doğal hata izlerini (stack trace) koruması için eklentiyi yalnızca istemci paketleriyle (`!isServer`) sınırlandırın:

```js
import unpeek from 'unpeek/unplugin';

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config, { dev, isServer }) {
    if (!dev && !isServer) {
      config.plugins.push(
        unpeek.webpack({
          deterrentMode: 'gradual',
          keepPrivateMaps: true,
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
import { transformJavaScript, protectDirectory } from 'unpeek';

// Tek bir JavaScript metnini bellek içinde dönüştürün
const result = transformJavaScript(sourceCode, {
  seed: 0x7f3a91,
  minStringLength: 4,
  injectRuntimeShield: true,
  deterrentMode: 'gradual',
});

console.log(result.hotPathReport);
// { totalFunctions: 12, hotFunctionsSkipped: ['renderLoop'], coldFunctionsProtected: ['signRequest'] }

// Veya tüm derleme çıktı dizinini koruyun
const summary = await protectDirectory({
  cwd: process.cwd(),
  keepPrivateMaps: true,
  privateMapsDir: '.unpeek-maps',
});
```

---

## `.unpeek-maps/` Source Map Kasası ve Sentry İş Akışı

`keepPrivateMaps` etkin olduğunda (varsayılan), `unpeek` genel çıktı dizinindeki tüm `.js.map` dosyalarını göreli dosya adlarını koruyarak `.unpeek-maps/` klasörüne taşır ve genel `.js` dosyalarındaki `//# sourceMappingURL=` yönergelerini temizler.

Üretim ortamındaki hata izleme araçlarında tam sembol çözümlemesini korumak için şu adımları izleyin:

```bash
# 1. Uygulamanızı derleyin ve unpeek korumasını çalıştırın (postbuild ile otomatik tetiklenir)
npm run build

# 2. Özel kaynak haritalarını .unpeek-maps/ dizininden Sentry veya Datadog'a yükleyin
npx @sentry/cli sourcemaps upload .unpeek-maps --release="$GIT_COMMIT_SHA"

# 3. Yalnızca temizlenmiş genel çıktı klasörünü (.next/, dist/ veya build/) yayına alın
```

---

## Resmi Yapay Zeka Ajan Becerisi (AI Agent Skill) Kurulumu

`unpeek`, Agent Skills Discovery Optimization (SDO) standartlarına göre hazırlanmış, belirteç (token) açısından optimize edilmiş resmi bir yapay zeka beceri dosyasıyla ([`skills/unpeek/SKILL.md`](skills/unpeek/SKILL.md)) birlikte gelir. Bu beceriyi kurmak; kodlama ajanınıza (Claude Code, Cursor, Antigravity, OpenAI Codex veya Gemini CLI) `unpeek` yapılandırmasını, SSR paketlerini güvenli tutmayı ve `.unpeek-maps/` klasörünü CI/CD hatlarına bağlamayı öğretir.

### Proje Bazlı Kurulum (Git ile Ekip İçinde Paylaşılan)

Beceri dosyasını deponuzun `.agents/skills/unpeek/` dizinine kopyalayın:

```bash
mkdir -p .agents/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o .agents/skills/unpeek/SKILL.md
```

### Makine Genelinde Kurulum (Antigravity / Gemini CLI / Claude Code)

```bash
# Antigravity & Gemini CLI
mkdir -p ~/.gemini/config/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o ~/.gemini/config/skills/unpeek/SKILL.md

# Ajanlar arası ortak standart (~/.agents/skills)
mkdir -p ~/.agents/skills/unpeek
curl -fsSL https://raw.githubusercontent.com/Woffluon/unpeek/main/skills/unpeek/SKILL.md \
  -o ~/.agents/skills/unpeek/SKILL.md
```

</talimat>

---

<dogrulama>

## Doğrulama, Testler ve Performans Ölçümleri

Bu monorepo `pnpm` ile yönetilir ve anlamsal eşdeğerlik, tersine mühendislik direnci ve çalışma zamanı bütçelerine karşı doğrulanır:

```bash
# Çalışma alanı (workspace) bağımlılıklarını kurun
pnpm install

# Birim ve tersine mühendislik direnci testlerini çalıştırın (Vitest)
pnpm test

# V8 VM CPU ek yükü (<%2) ve Gzip artış (<%15) kıyaslamasını çalıştırın
pnpm bench

# packages/unpeek ve apps/web genelinde sıkı TypeScript tip kontrolünü çalıştırın
pnpm typecheck

# Çekirdek paketi ve statik interaktif web playground uygulamasını derleyin
pnpm build
```

### Kıyaslama (Benchmark) Çıktı Referansı ([`packages/unpeek/benchmarks/overhead.bench.ts`](packages/unpeek/benchmarks/overhead.bench.ts))

- **Derleme / Dönüşüm Süresi**: `< 3000 ms`
- **Gzip Boyut Artışı**: Üretim uygulama paketlerinde `< %15`
- **Çalışma Zamanı CPU Ek Yükü**: `< %2.00` (ardışık çok turlu V8 JIT kıyaslaması)
- **Düz Metin Sızıntı Oranı**: `minStringLength` sınırını karşılayan metin sabitleri için `%0`

</dogrulama>

## Lisans

[MIT Lisansı](./LICENSE) altında sunulmaktadır.
