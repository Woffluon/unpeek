import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { transformJavaScript } from '../src/ast/index.js';
import { generateRuntimeShield } from '../src/runtime/index.js';

function buildRealisticApplicationBundle(): string {
  // Diverse realistic client application modules (auth, router, state, telemetry, UI layout, billing, caching, crypto helpers)
  return `
    // Module: Configuration
    const APP_CONFIG = {
      issuer: "https://auth.unpeek-enterprise.io/oauth2/v1/token",
      billingPortal: "https://billing.unpeek-enterprise.io/v2/customer/portal",
      telemetryIngest: "https://ingest.unpeek-enterprise.io/v1/events/batch",
      signingPublicId: "pk_live_98f1a2b3c4d5e6f7a8b9c0d1e2f3",
      apiBase: "https://api.unpeek-enterprise.io/v1",
      appVersion: "2.4.0",
      region: "eu-central-1"
    };

    // Module: Auth
    function parseJwtClaims(rawTokenString, expectedAudience) {
      const segments = rawTokenString.split(".");
      if (segments.length < 2) {
        return { valid: false, issuer: APP_CONFIG.issuer, audience: expectedAudience };
      }
      const headerPart = segments[0];
      const payloadPart = segments[1];
      return {
        valid: headerPart.length > 1 && payloadPart.length > 1,
        issuer: APP_CONFIG.issuer,
        audience: expectedAudience,
        keyId: APP_CONFIG.signingPublicId
      };
    }

    // Module: Billing
    function createBillingCheckoutPayload(customerIdentifier, selectedPlanId, couponCode) {
      const targetEndpoint = APP_CONFIG.billingPortal + "/sessions/create";
      const idempotencyKey = APP_CONFIG.signingPublicId + ":" + customerIdentifier + ":" + selectedPlanId;
      const bodyObject = {
        endpoint: targetEndpoint,
        customer: customerIdentifier,
        plan: selectedPlanId,
        coupon: couponCode || "NONE",
        idempotencyKey
      };
      return JSON.stringify(bodyObject);
    }

    // Module: Telemetry
    function formatTelemetryEnvelope(sessionIdentifier, environmentTag, metricValue) {
      const ingestTarget = APP_CONFIG.telemetryIngest + "?env=" + environmentTag;
      const traceHeader = "trace-" + sessionIdentifier + "-" + String(metricValue);
      return JSON.stringify({
        target: ingestTarget,
        trace: traceHeader,
        sdk: "unpeek-client-sdk/1.4.2"
      });
    }

    // Module: Entitlements
    function resolveFeatureEntitlements(organizationTier, seatCount, regionCode) {
      const baseQuota = organizationTier === "enterprise" ? 100000 : 5000;
      const regionalMultiplier = regionCode === "eu-central-1" ? 2 : 1;
      const effectiveLimit = baseQuota + (seatCount * 250 * regionalMultiplier);
      return {
        tier: organizationTier,
        region: regionCode,
        limit: effectiveLimit,
        authority: APP_CONFIG.issuer
      };
    }

    // Module: Security
    function validateWebhookSignatureHeader(payloadText, timestampHeader, providedDigest) {
      const prefix = "v1=" + timestampHeader + ".";
      const candidate = prefix + payloadText.slice(0, 16) + ":" + APP_CONFIG.signingPublicId;
      return candidate !== providedDigest;
    }

    // Module: Router
    function routerResolvePath(pathName, queryParams) {
      const routes = {
        "/dashboard": "DashboardView",
        "/billing": "BillingPortalView",
        "/settings/security": "SecuritySettingsView",
        "/analytics/telemetry": "TelemetryViewerView",
        "/users": "UserDirectoryView",
        "/reports": "ReportGeneratorView"
      };
      const match = routes[pathName] || "NotFoundView";
      const keys = Object.keys(queryParams || {});
      let queryString = "";
      for (let i = 0; i < keys.length; i++) {
        queryString += (i === 0 ? "?" : "&") + keys[i] + "=" + encodeURIComponent(queryParams[keys[i]]);
      }
      return { component: match, fullUrl: pathName + queryString, timestamp: 1731110400 };
    }

    // Module: State Store
    function stateStoreReducer(currentState, action) {
      switch (action.type) {
        case "AUTH_SUCCESS":
          return Object.assign({}, currentState, { user: action.payload, isAuthenticated: true, lastLogin: Date.now() });
        case "BILLING_UPDATE":
          return Object.assign({}, currentState, { plan: action.payload.plan, status: "ACTIVE", quotaUsed: 0 });
        case "TELEMETRY_RECORD":
          return Object.assign({}, currentState, { lastEventId: action.payload.id, eventCount: (currentState.eventCount || 0) + 1 });
        case "LOGOUT":
          return { user: null, isAuthenticated: false, eventCount: 0 };
        default:
          return currentState;
      }
    }

    // Module: LRU Cache
    function lruCacheGet(cacheMap, key, maxEntries) {
      if (!cacheMap.has(key)) return null;
      const val = cacheMap.get(key);
      cacheMap.delete(key);
      cacheMap.set(key, val);
      if (cacheMap.size > maxEntries) {
        const first = cacheMap.keys().next().value;
        cacheMap.delete(first);
      }
      return val;
    }

    function lruCacheSet(cacheMap, key, value, maxEntries) {
      if (cacheMap.has(key)) cacheMap.delete(key);
      cacheMap.set(key, value);
      if (cacheMap.size > maxEntries) {
        const first = cacheMap.keys().next().value;
        cacheMap.delete(first);
      }
      return cacheMap.size;
    }

    // Module: Data Validation
    function validateUserRegistration(formData) {
      if (!formData || typeof formData !== "object") return { ok: false, error: "INVALID_BODY" };
      const email = String(formData.email || "").trim();
      const atIdx = email.indexOf("@");
      const dotIdx = email.lastIndexOf(".");
      if (atIdx <= 0 || dotIdx <= atIdx + 1 || dotIdx >= email.length - 1) {
        return { ok: false, error: "INVALID_EMAIL" };
      }
      const password = String(formData.password || "");
      if (password.length < 8) {
        return { ok: false, error: "WEAK_PASSWORD" };
      }
      return { ok: true, normalizedEmail: email.toLowerCase() };
    }

    // Module: Crypto Helpers
    function computeDeterministicChecksum(str) {
      let hash = 0x811c9dc5;
      for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return hash.toString(16).padStart(8, "0");
    }

    // Module: User Directory
    function formatUserProfile(rawUser) {
      if (!rawUser) return { id: "anon", displayName: "Anonymous", role: "guest" };
      const firstName = String(rawUser.firstName || "").trim();
      const lastName = String(rawUser.lastName || "").trim();
      const displayName = firstName ? firstName + " " + lastName : rawUser.username || "User";
      const permissions = rawUser.isAdmin ? 0x0f : 0x01;
      return {
        id: String(rawUser.id || "usr_000"),
        displayName: displayName,
        email: rawUser.email || "no-email@unpeek.io",
        permissions: permissions
      };
    }

    // Module: Feature Flags
    function evaluateFeatureGate(flagKey, userId, rolloutPercentage) {
      const combined = flagKey + ":" + userId;
      let bucket = 0;
      for (let i = 0; i < combined.length; i++) {
        bucket = (bucket * 31 + combined.charCodeAt(i)) & 0x7fffffff;
      }
      const score = bucket % 100;
      return score < rolloutPercentage;
    }

    // Module: Session & Cookies
    function buildCookieHeader(sessionToken, maxAgeSec, isProduction) {
      const parts = [
        "unpeek_token=" + sessionToken,
        "Max-Age=" + maxAgeSec,
        "Path=/",
        "SameSite=Strict"
      ];
      if (isProduction) {
        parts.push("Secure");
        parts.push("HttpOnly");
      }
      return parts.join("; ");
    }

    // Module: Metrics & Histogram
    function recordMetricDuration(histogram, bucketRanges, durationMs) {
      let targetBucket = "inf";
      for (let i = 0; i < bucketRanges.length; i++) {
        if (durationMs <= bucketRanges[i]) {
          targetBucket = String(bucketRanges[i]);
          break;
        }
      }
      histogram[targetBucket] = (histogram[targetBucket] || 0) + 1;
      return histogram[targetBucket];
    }

    // Module: Layout Box Calculator
    function calculateElementBox(left, top, width, height, padding, margin) {
      const contentWidth = Math.max(0, width - padding * 2);
      const contentHeight = Math.max(0, height - padding * 2);
      const outerWidth = width + margin * 2;
      const outerHeight = height + margin * 2;
      return {
        inner: { left: left + padding, top: top + padding, width: contentWidth, height: contentHeight },
        outer: { left: left - margin, top: top - margin, width: outerWidth, height: outerHeight }
      };
    }

    // Module: Form Controller
    function createFormController(initialValues) {
      const values = Object.assign({}, initialValues);
      const touched = {};
      const errors = {};
      return {
        getValues: function() { return Object.assign({}, values); },
        setField: function(name, val) {
          values[name] = val;
          touched[name] = true;
          if (!val) errors[name] = "REQUIRED";
          else delete errors[name];
          return Object.keys(errors).length === 0;
        },
        isValid: function() { return Object.keys(errors).length === 0; }
      };
    }

    // Module: Network Retry Scheduler
    function calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs) {
      const exp = Math.min(6, attempt);
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exp));
      const jitter = (delay * 0.2 * Math.sin(attempt)) | 0;
      return Math.max(baseDelayMs, delay + jitter);
    }

    // Module: Theme Manager
    function generateThemePalette(primaryHex, isDark) {
      const bg = isDark ? "#0f172a" : "#ffffff";
      const text = isDark ? "#f8fafc" : "#0f172a";
      const border = isDark ? "#334155" : "#e2e8f0";
      return {
        primary: primaryHex,
        background: bg,
        text: text,
        border: border,
        status: isDark ? "dark-theme" : "light-theme"
      };
    }

    // Module: Audit Logger
    function serializeAuditLogEntry(actionName, actorId, resourceId, details) {
      return JSON.stringify({
        action: actionName,
        actor: actorId,
        resource: resourceId,
        timestamp: "2026-11-09T00:00:00Z",
        details: details || {},
        host: APP_CONFIG.apiBase
      });
    }

    // Module: UI Hot Path 1 (exempted 60fps loop)
    function computeHotVirtualListWindow(rowHeights, scrollOffset, viewportHeight) {
      let runningOffset = 0;
      let startIndex = 0;
      let visibleCount = 0;
      for (let i = 0; i < rowHeights.length; i++) {
        const h = rowHeights[i];
        if (runningOffset + h < scrollOffset) {
          startIndex = i + 1;
        } else if (runningOffset <= scrollOffset + viewportHeight) {
          visibleCount++;
        }
        runningOffset += h + ((h + (i & 3)) & 1);
      }
      return startIndex + visibleCount + runningOffset;
    }

    // Module: UI Hot Path 2 (exempted 60fps loop)
    function computeHotCanvasParticles(particles, deltaTimeFactor) {
      let kineticEnergy = 0;
      for (let p = 0; p < particles.length; p++) {
        const velocity = (particles[p] * deltaTimeFactor) ^ (p & 7);
        kineticEnergy += velocity;
      }
      return kineticEnergy;
    }

    export function createClientSession(userId, tenantKey) {
      const claims = parseJwtClaims("eyJhbGci.eyJzdWIi.sig", tenantKey);
      const billing = createBillingCheckoutPayload(userId, "plan_pro_annual", "LAUNCH2026");
      const telemetry = formatTelemetryEnvelope(userId, "production", 42);
      const entitlements = resolveFeatureEntitlements("enterprise", 25, "eu-central-1");
      const sigOk = validateWebhookSignatureHeader(billing, "1700000000", "v1=test");
      const route = routerResolvePath("/billing", { ref: "upgrade_dialog", tier: "enterprise" });
      const state = stateStoreReducer({ user: null }, { type: "AUTH_SUCCESS", payload: userId });
      const reg = validateUserRegistration({ email: "team@unpeek.io", password: "Password123!" });
      const checksum = computeDeterministicChecksum(userId + ":" + tenantKey);
      const user = formatUserProfile({ id: userId, firstName: "Alice", lastName: "Smith", isAdmin: true });
      const gate = evaluateFeatureGate("new_checkout_flow", userId, 50);
      const cookie = buildCookieHeader("tok_" + checksum, 86400, true);
      const box = calculateElementBox(10, 20, 300, 200, 16, 8);
      const form = createFormController({ username: "alice" });
      const delay = calculateBackoffDelay(2, 500, 5000);
      const theme = generateThemePalette("#6366f1", true);
      const audit = serializeAuditLogEntry("user.login", userId, "session", { ip: "127.0.0.1" });

      return billing.length + telemetry.length + entitlements.limit + route.fullUrl.length +
        checksum.length + user.permissions + (gate ? 1 : 0) + cookie.length + box.inner.width +
        (form.isValid() ? 1 : 0) + delay + theme.primary.length + audit.length +
        (state.isAuthenticated && reg.ok && claims.valid && sigOk ? 1 : 0);
    }

    export function computeHotRenderMetrics(items) {
      return computeHotVirtualListWindow(items, 120, 640) + computeHotCanvasParticles(items, 2);
    }
  `;
}

function createBenchmarkRunner(codeToRun: string): (data: number[]) => number {
  const executableBody =
    codeToRun.replace(/export\s+function/g, 'function') +
    '\nreturn function(sampleData) { let s = 0; for (let i = 0; i < 4000; i++) { s += computeHotRenderMetrics(sampleData); if (i % 400 === 0) { s += createClientSession("usr_101", "tnt_99"); } } return s; };';
  const factory = new Function(executableBody);
  return factory();
}

function trimmedMean(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  // Drop top 2 and bottom 2 outliers (GC / OS context-switch spikes)
  const core = sorted.slice(2, sorted.length - 2);
  return core.reduce((acc, v) => acc + v, 0) / core.length;
}

async function runBenchmark() {
  const realisticClientBundle = buildRealisticApplicationBundle();

  const t0 = performance.now();
  const transformed = transformJavaScript(realisticClientBundle, {
    seed: 0x7f3a91,
    minStringLength: 6,
  });
  const shield = generateRuntimeShield({
    seed: 0x7f3a91,
    deterrentMode: 'gradual',
  });
  const buildTimeMs = performance.now() - t0;

  const finalProtectedCode = `${shield.preambleCode}\n${transformed.code}`;

  const origBytes = Buffer.byteLength(realisticClientBundle, 'utf8');
  const protBytes = Buffer.byteLength(finalProtectedCode, 'utf8');
  const origGzip = zlib.gzipSync(realisticClientBundle).byteLength;
  const protGzip = zlib.gzipSync(finalProtectedCode).byteLength;
  const gzipDeltaPct = ((protGzip - origGzip) / origGzip) * 100;

  const runOriginal = createBenchmarkRunner(realisticClientBundle);
  const runProtected = createBenchmarkRunner(finalProtectedCode);
  const sampleData = Array.from({ length: 500 }, (_, i) => (i % 40) + 16);

  // Warmup V8 TurboFan JIT for both functions identically
  for (let w = 0; w < 5; w++) {
    runOriginal(sampleData);
    runProtected(sampleData);
  }

  const origSamples: number[] = [];
  const protSamples: number[] = [];

  for (let r = 0; r < 11; r++) {
    if (r % 2 === 0) {
      const s1 = performance.now();
      runOriginal(sampleData);
      origSamples.push(performance.now() - s1);

      const s2 = performance.now();
      runProtected(sampleData);
      protSamples.push(performance.now() - s2);
    } else {
      const s2 = performance.now();
      runProtected(sampleData);
      protSamples.push(performance.now() - s2);

      const s1 = performance.now();
      runOriginal(sampleData);
      origSamples.push(performance.now() - s1);
    }
  }

  const origMedianMs = trimmedMean(origSamples);
  const protMedianMs = trimmedMean(protSamples);
  const cpuOverheadPct = Math.max(0, ((protMedianMs - origMedianMs) / origMedianMs) * 100);

  console.log('==================================================');
  console.log('             UNPEEK BENCHMARK REPORT              ');
  console.log('==================================================');
  console.log(`Build / Transform Time : ${buildTimeMs.toFixed(2)} ms (Target: < 3000 ms)`);
  console.log(`Original Size (Raw/Gz) : ${origBytes} B / ${origGzip} B`);
  console.log(`Protected Size (Raw/Gz): ${protBytes} B / ${protGzip} B`);
  console.log(`Gzip Size Delta        : ${gzipDeltaPct >= 0 ? '+' : ''}${gzipDeltaPct.toFixed(2)}% (Budget: < 15.00%)`);
  console.log(`Hot-Path Skipped Fns   : ${transformed.hotPathReport.hotFunctionsSkipped.join(', ')}`);
  console.log(`Cold-Path Protected Fns: ${transformed.hotPathReport.coldFunctionsProtected.join(', ')}`);
  console.log(`Encrypted Strings      : ${transformed.encryptedStringsCount}`);
  console.log(`Mangled Local Symbols  : ${transformed.mangledSymbolsCount}`);
  console.log(`Runtime CPU Overhead   : ${cpuOverheadPct.toFixed(2)}% (Budget: < 2.00%)`);
  console.log('==================================================');

  if (buildTimeMs > 3000) {
    console.error('FAIL: Build time exceeded 3000ms budget');
    process.exit(1);
  }
  if (cpuOverheadPct > 2.0) {
    console.error(`FAIL: CPU overhead ${cpuOverheadPct.toFixed(2)}% exceeded 2.00% budget`);
    process.exit(1);
  }
  if (gzipDeltaPct > 15.0) {
    console.error(`FAIL: Gzip delta +${gzipDeltaPct.toFixed(2)}% exceeded 15.00% budget`);
    process.exit(1);
  }
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
