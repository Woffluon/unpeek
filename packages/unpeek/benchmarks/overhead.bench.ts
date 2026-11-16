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

    // Module: Permission Matrix
    function evaluateRbacPermission(roleMap, userRoles, resource, action) {
      const target = resource + ":" + action;
      for (let i = 0; i < userRoles.length; i++) {
        const grants = roleMap[userRoles[i]];
        if (grants && (grants.includes(target) || grants.includes(resource + ":*") || grants.includes("*:*"))) {
          return { allowed: true, grantedBy: userRoles[i], scope: target };
        }
      }
      return { allowed: false, grantedBy: "none", scope: target };
    }

    // Module: Search Tokenizer
    function tokenizeSearchQuery(rawQuery, stopWords) {
      const normalized = String(rawQuery || "").toLowerCase().trim();
      const parts = normalized.split(/[\\s,;:+|/]+/);
      const tokens = [];
      for (let i = 0; i < parts.length; i++) {
        const tok = parts[i].replace(/[^a-z0-9_-]/g, "");
        if (tok.length >= 2 && !stopWords[tok]) {
          tokens.push(tok);
        }
      }
      return { tokens: tokens, count: tokens.length, digest: tokens.join(" ") };
    }

    // Module: Schema Validator
    function validatePayloadSchema(payload, rules) {
      const failures = [];
      const keys = Object.keys(rules);
      for (let i = 0; i < keys.length; i++) {
        const field = keys[i];
        const rule = rules[field];
        const val = payload ? payload[field] : undefined;
        if (rule.required && (val === undefined || val === null || val === "")) {
          failures.push({ field: field, reason: "MISSING_REQUIRED_FIELD" });
          continue;
        }
        if (val !== undefined && rule.type && typeof val !== rule.type) {
          failures.push({ field: field, reason: "TYPE_MISMATCH_" + rule.type.toUpperCase() });
        }
        if (typeof val === "string" && rule.minLen && val.length < rule.minLen) {
          failures.push({ field: field, reason: "MIN_LENGTH_VIOLATION" });
        }
        if (typeof val === "number" && rule.maxVal !== undefined && val > rule.maxVal) {
          failures.push({ field: field, reason: "MAX_VALUE_EXCEEDED" });
        }
      }
      return { valid: failures.length === 0, errors: failures };
    }

    // Module: Query String Builder
    function buildSignedApiQuery(endpoint, params, signatureKey) {
      const sortedKeys = Object.keys(params || {}).sort();
      const pairs = [];
      for (let i = 0; i < sortedKeys.length; i++) {
        const k = sortedKeys[i];
        const v = params[k];
        if (v !== undefined && v !== null) {
          pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)));
        }
      }
      const canonical = pairs.join("&");
      const sig = computeDeterministicChecksum(endpoint + "?" + canonical + "#" + signatureKey);
      return endpoint + "?" + canonical + (canonical ? "&" : "") + "sig=" + sig;
    }

    // Module: Sync Conflict Resolver
    function mergeDocumentRevisions(localDoc, remoteDoc, localClock, remoteClock) {
      const merged = {};
      const allFields = new Set(Object.keys(localDoc || {}).concat(Object.keys(remoteDoc || {})));
      const conflicts = [];
      allFields.forEach((field) => {
        const lVal = localDoc ? localDoc[field] : undefined;
        const rVal = remoteDoc ? remoteDoc[field] : undefined;
        if (lVal === rVal) {
          merged[field] = lVal;
        } else if (remoteClock > localClock) {
          merged[field] = rVal !== undefined ? rVal : lVal;
          conflicts.push({ field: field, winner: "remote" });
        } else {
          merged[field] = lVal !== undefined ? lVal : rVal;
          conflicts.push({ field: field, winner: "local" });
        }
      });
      return { document: merged, conflicts: conflicts, resolvedAt: Math.max(localClock, remoteClock) };
    }

    // Module: Notification Queue
    function enqueueNotificationItem(queue, channel, title, severity, maxDepth) {
      const entry = {
        id: "ntf_" + computeDeterministicChecksum(channel + ":" + title + ":" + queue.length),
        channel: channel,
        title: title,
        severity: severity || "info",
        unread: true,
        createdAt: 1731110400 + queue.length
      };
      queue.push(entry);
      while (queue.length > maxDepth) {
        queue.shift();
      }
      return { insertedId: entry.id, depth: queue.length };
    }

    // Module: Invoice & Tax Engine
    function computeInvoiceLineTotals(items, taxRatePct, discountCode) {
      let subtotalCents = 0;
      for (let i = 0; i < items.length; i++) {
        const line = items[i];
        subtotalCents += Math.round((line.unitPriceCents || 0) * (line.quantity || 1));
      }
      const discountPct = discountCode === "ENTERPRISE20" ? 20 : discountCode === "LAUNCH10" ? 10 : 0;
      const discountCents = Math.round((subtotalCents * discountPct) / 100);
      const taxableCents = Math.max(0, subtotalCents - discountCents);
      const taxCents = Math.round((taxableCents * taxRatePct) / 100);
      return {
        subtotalCents: subtotalCents,
        discountCents: discountCents,
        taxCents: taxCents,
        totalCents: taxableCents + taxCents,
        currency: "USD"
      };
    }

    // Module: Rate Limiter Token Bucket
    function consumeRateLimitToken(bucket, nowMs, capacity, refillPerSec) {
      const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
      const replenished = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
      if (replenished < 1) {
        return { allowed: false, remaining: 0, retryAfterMs: Math.ceil(((1 - replenished) / refillPerSec) * 1000) };
      }
      bucket.tokens = replenished - 1;
      bucket.lastRefillMs = nowMs;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    // Module: Undo/Redo History Stack
    function createHistoryTimeline(initialSnapshot, maxSnapshots) {
      const past = [];
      const future = [];
      let present = Object.assign({}, initialSnapshot);
      return {
        commit: function(nextState) {
          past.push(present);
          if (past.length > maxSnapshots) past.shift();
          present = Object.assign({}, nextState);
          future.length = 0;
          return past.length;
        },
        undo: function() {
          if (past.length === 0) return present;
          future.push(present);
          present = past.pop();
          return present;
        },
        redo: function() {
          if (future.length === 0) return present;
          past.push(present);
          present = future.pop();
          return present;
        },
        current: function() { return present; }
      };
    }

    // Module: CSV Sanitizer & Exporter
    function serializeRecordsToCsv(columns, rows) {
      const escapeCell = (raw) => {
        const str = raw === null || raw === undefined ? "" : String(raw);
        const safe = /^[=+\-@]/.test(str) ? "'" + str : str;
        if (safe.indexOf(",") >= 0 || safe.indexOf('"') >= 0 || safe.indexOf("\\n") >= 0) {
          return '"' + safe.replace(/"/g, '""') + '"';
        }
        return safe;
      };
      const lines = [columns.map(escapeCell).join(",")];
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        const cells = [];
        for (let c = 0; c < columns.length; c++) {
          cells.push(escapeCell(row[columns[c]]));
        }
        lines.push(cells.join(","));
      }
      return lines.join("\\n");
    }

    // Module: URL Pattern Matcher
    function matchRoutePattern(pattern, pathname) {
      const patSegs = pattern.split("/").filter(Boolean);
      const pathSegs = pathname.split("/").filter(Boolean);
      if (patSegs.length !== pathSegs.length) return { matched: false, params: {} };
      const params = {};
      for (let i = 0; i < patSegs.length; i++) {
        const seg = patSegs[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = decodeURIComponent(pathSegs[i]);
        } else if (seg !== pathSegs[i]) {
          return { matched: false, params: {} };
        }
      }
      return { matched: true, params: params };
    }

    // Module: Tree Node Flattener
    function flattenNavigationTree(roots) {
      const flat = [];
      const stack = [];
      for (let i = roots.length - 1; i >= 0; i--) {
        stack.push({ node: roots[i], depth: 0, parentId: null });
      }
      while (stack.length > 0) {
        const frame = stack.pop();
        flat.push({ id: frame.node.id, label: frame.node.label, depth: frame.depth, parentId: frame.parentId });
        const children = frame.node.children || [];
        for (let c = children.length - 1; c >= 0; c--) {
          stack.push({ node: children[c], depth: frame.depth + 1, parentId: frame.node.id });
        }
      }
      return flat;
    }

    // Module: Color Contrast Calculator
    function parseHexRgbAndLuminance(hexColor) {
      const clean = String(hexColor || "#000000").replace("#", "");
      const r = parseInt(clean.slice(0, 2), 16) || 0;
      const g = parseInt(clean.slice(2, 4), 16) || 0;
      const b = parseInt(clean.slice(4, 6), 16) || 0;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return { r: r, g: g, b: b, luminance: lum, highContrastText: lum > 0.5 ? "#0f172a" : "#f8fafc" };
    }

    // Module: Batch Request Coalescer
    function partitionBatchOperations(operations, maxBatchSize) {
      const batches = [];
      let current = [];
      for (let i = 0; i < operations.length; i++) {
        current.push(operations[i]);
        if (current.length >= maxBatchSize) {
          batches.push({ batchIndex: batches.length, items: current });
          current = [];
        }
      }
      if (current.length > 0) {
        batches.push({ batchIndex: batches.length, items: current });
      }
      return batches;
    }

    // Module: Storage Quota Estimator
    function calculateCacheEvictionPlan(entries, quotaBytes, reserveBytes) {
      const targetLimit = Math.max(0, quotaBytes - reserveBytes);
      let used = 0;
      for (let i = 0; i < entries.length; i++) used += entries[i].bytes;
      const sorted = entries.slice().sort((a, b) => a.lastAccessMs - b.lastAccessMs);
      const evicted = [];
      let idx = 0;
      while (used > targetLimit && idx < sorted.length) {
        used -= sorted[idx].bytes;
        evicted.push(sorted[idx].key);
        idx++;
      }
      return { remainingBytes: used, evictedKeys: evicted };
    }

    // Module: Critical Signing Helper (Tier 3 @unpeek-critical target)
    // @unpeek-critical
    function deriveCriticalSessionNonce(tenantId, sequenceNo, saltTag) {
      const base = String(tenantId || "default") + ":" + String(sequenceNo | 0);
      const tag = String(saltTag || "v4");
      const acc = (sequenceNo > 0 && tag.length > 0) ? (sequenceNo * 31 + base.length) : 17;
      return "nonce_" + acc + "_" + tag;
    }

    // Module: Client i18n Catalog & Pluralizer
    const I18N_MESSAGES = {
      en: {
        "billing.seatLimit": "Seat allocation reached for current workspace tier.",
        "billing.invoiceReady": "Monthly statement generated and archived.",
        "auth.mfaRequired": "Multi-factor challenge required before key rotation.",
        "auth.sessionExpired": "Session credential expired; re-authenticate to continue.",
        "sync.conflictResolved": "Offline revision reconciled with server state.",
        "export.csvQueued": "Audit ledger export prepared for browser download."
      },
      tr: {
        "billing.seatLimit": "Mevcut calisma alani paketi icin koltuk sinirina ulasildi.",
        "billing.invoiceReady": "Aylik fatura ozeti olusturuldu ve arsivlendi.",
        "auth.mfaRequired": "Anahtar yenilemeden once cok faktorlu dogrulama gerekir.",
        "auth.sessionExpired": "Oturum suresi doldu; devam etmek icin tekrar giris yapin.",
        "sync.conflictResolved": "Cevrimdisi duzenleme sunucu durumu ile esitlendi.",
        "export.csvQueued": "Denetim kaydi disa aktarimi tarayici indirmesi icin hazir."
      }
    };

    function formatLocalizedMessage(localeCode, messageKey, replacements) {
      const catalog = I18N_MESSAGES[localeCode] || I18N_MESSAGES.en;
      let text = catalog[messageKey] || messageKey;
      const keys = Object.keys(replacements || {});
      for (let i = 0; i < keys.length; i++) {
        text = text.split("{" + keys[i] + "}").join(String(replacements[keys[i]]));
      }
      return text;
    }

    // Module: Date & Relative Time Formatter
    function formatRelativeTimestamp(targetEpochMs, nowEpochMs, includeSeconds) {
      const diffSec = Math.round((nowEpochMs - targetEpochMs) / 1000);
      const absSec = Math.abs(diffSec);
      const suffix = diffSec >= 0 ? "ago" : "from now";
      if (absSec < 60) {
        return includeSeconds ? absSec + "s " + suffix : "just now";
      }
      const mins = Math.floor(absSec / 60);
      if (mins < 60) return mins + "m " + suffix;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return hours + "h " + suffix;
      const days = Math.floor(hours / 24);
      return days + "d " + suffix;
    }

    // Module: Currency & Precision Formatter
    function formatCurrencyAmount(minorUnits, currencyCode, decimalPlaces) {
      const decimals = typeof decimalPlaces === "number" ? decimalPlaces : 2;
      const divisor = Math.pow(10, decimals);
      const major = (minorUnits / divisor).toFixed(decimals);
      const symbols = { USD: "$", EUR: "EUR ", GBP: "GBP ", TRY: "TRY " };
      const prefix = symbols[currencyCode] || (currencyCode + " ");
      return prefix + major;
    }

    // Module: Chart Axis Tick & Scale Calculator
    function computeLinearAxisTicks(minValue, maxValue, desiredTickCount) {
      const lo = Math.min(minValue, maxValue);
      const hi = Math.max(minValue, maxValue);
      const span = hi - lo || 1;
      const roughStep = span / Math.max(2, desiredTickCount);
      const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
      const normalized = roughStep / magnitude;
      const niceNorm = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
      const step = niceNorm * magnitude;
      const start = Math.floor(lo / step) * step;
      const end = Math.ceil(hi / step) * step;
      const ticks = [];
      for (let v = start; v <= end + step * 0.5 && ticks.length < 32; v += step) {
        ticks.push(Number(v.toFixed(6)));
      }
      return { min: start, max: end, step: step, ticks: ticks };
    }

    // Module: Workflow State Machine
    function transitionWorkflowState(currentStep, eventType, contextFlags) {
      const transitions = {
        draft: { SUBMIT: "pending_review", ARCHIVE: "archived" },
        pending_review: { APPROVE: "approved", REJECT: "changes_requested", CANCEL: "draft" },
        changes_requested: { RESUBMIT: "pending_review", ARCHIVE: "archived" },
        approved: { PUBLISH: "published", REVOKE: "pending_review" },
        published: { UNPUBLISH: "approved", ARCHIVE: "archived" },
        archived: { RESTORE: "draft" }
      };
      const table = transitions[currentStep] || {};
      const nextStep = table[eventType];
      if (!nextStep) {
        return { transitioned: false, state: currentStep, reason: "INVALID_TRANSITION" };
      }
      if (nextStep === "published" && contextFlags && !contextFlags.compliancePassed) {
        return { transitioned: false, state: currentStep, reason: "COMPLIANCE_GATE_BLOCKED" };
      }
      return { transitioned: true, state: nextStep, reason: "OK" };
    }

    // Module: Normalized Entity Store
    function normalizeEntityCollection(records, idField) {
      const byId = {};
      const allIds = [];
      const keyName = idField || "id";
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        if (!rec || rec[keyName] === undefined) continue;
        const idStr = String(rec[keyName]);
        if (!byId[idStr]) {
          allIds.push(idStr);
        }
        byId[idStr] = Object.assign({}, byId[idStr] || {}, rec);
      }
      return { byId: byId, allIds: allIds, count: allIds.length };
    }

    // Module: WebSocket Frame Envelope Codec
    function encodeSocketCommandFrame(channelName, opCode, payloadObj, seqNum) {
      const header = {
        v: 4,
        ch: channelName,
        op: opCode,
        seq: seqNum | 0,
        ts: 1731110400 + (seqNum | 0)
      };
      const body = JSON.stringify(payloadObj || {});
      const checksum = computeDeterministicChecksum(channelName + ":" + opCode + ":" + body);
      return JSON.stringify({ h: header, b: body, c: checksum });
    }

    // Module: Drag-and-Drop Grid Layout Solver
    function resolveGridPlacement(cards, columnCount, rowHeightPx, gapPx) {
      const colHeights = [];
      for (let c = 0; c < columnCount; c++) colHeights.push(0);
      const placements = [];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const span = Math.min(columnCount, Math.max(1, card.colSpan || 1));
        let bestCol = 0;
        let bestY = Infinity;
        for (let c = 0; c <= columnCount - span; c++) {
          let maxColY = 0;
          for (let k = c; k < c + span; k++) {
            if (colHeights[k] > maxColY) maxColY = colHeights[k];
          }
          if (maxColY < bestY) {
            bestY = maxColY;
            bestCol = c;
          }
        }
        const height = Math.max(1, card.rowSpan || 1) * rowHeightPx;
        placements.push({ id: card.id, col: bestCol, y: bestY, span: span, height: height });
        for (let k = bestCol; k < bestCol + span; k++) {
          colHeights[k] = bestY + height + gapPx;
        }
      }
      return { placements: placements, totalHeight: Math.max.apply(null, colHeights.concat([0])) };
    }

    // Module: Form Wizard Step Controller
    function evaluateWizardProgress(steps, completedMap, skippedSet) {
      let completedCount = 0;
      let nextIncompleteId = null;
      for (let i = 0; i < steps.length; i++) {
        const stepId = steps[i].id;
        const done = Boolean(completedMap[stepId]) || Boolean(skippedSet && skippedSet[stepId]);
        if (done) {
          completedCount++;
        } else if (nextIncompleteId === null) {
          nextIncompleteId = stepId;
        }
      }
      const pct = steps.length === 0 ? 100 : Math.round((completedCount / steps.length) * 100);
      return { completedCount: completedCount, totalSteps: steps.length, percentComplete: pct, nextStepId: nextIncompleteId };
    }

    // Module: Keyboard Shortcut Normalizer
    function normalizeShortcutBinding(comboString) {
      const parts = String(comboString || "").toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
      const mods = { ctrl: false, shift: false, alt: false, meta: false };
      let primaryKey = "";
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p === "ctrl" || p === "control") mods.ctrl = true;
        else if (p === "shift") mods.shift = true;
        else if (p === "alt" || p === "option") mods.alt = true;
        else if (p === "meta" || p === "cmd" || p === "command") mods.meta = true;
        else primaryKey = p;
      }
      const ordered = [];
      if (mods.ctrl) ordered.push("ctrl");
      if (mods.alt) ordered.push("alt");
      if (mods.shift) ordered.push("shift");
      if (mods.meta) ordered.push("meta");
      if (primaryKey) ordered.push(primaryKey);
      return { canonical: ordered.join("+"), key: primaryKey, modifiers: mods };
    }

    // Module: Telemetry Span Aggregator
    function aggregatePerformanceSpans(spans) {
      const summary = {};
      for (let i = 0; i < spans.length; i++) {
        const sp = spans[i];
        const op = sp.operation || "unknown";
        if (!summary[op]) {
          summary[op] = { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 };
        }
        const entry = summary[op];
        entry.count++;
        entry.totalMs += sp.durationMs || 0;
        if ((sp.durationMs || 0) > entry.maxMs) entry.maxMs = sp.durationMs || 0;
        if (sp.status === "error") entry.errorCount++;
      }
      const ops = Object.keys(summary);
      for (let j = 0; j < ops.length; j++) {
        const s = summary[ops[j]];
        s.avgMs = Number((s.totalMs / s.count).toFixed(2));
      }
      return summary;
    }

    // Module: Experiment Variant Allocator
    function assignExperimentVariant(experimentKey, subjectId, variants) {
      if (!variants || variants.length === 0) return { variant: "control", bucket: 0 };
      const digest = computeDeterministicChecksum(experimentKey + "::" + subjectId);
      const bucket = parseInt(digest.slice(0, 6), 16) % 10000;
      let cursor = 0;
      for (let i = 0; i < variants.length; i++) {
        cursor += Math.round((variants[i].weightPct || 0) * 100);
        if (bucket < cursor) {
          return { variant: variants[i].name, bucket: bucket };
        }
      }
      return { variant: variants[variants.length - 1].name, bucket: bucket };
    }

    // Module: Semantic Diff Summarizer
    function computeObjectFieldDiff(beforeObj, afterObj) {
      const added = [];
      const removed = [];
      const changed = [];
      const bKeys = Object.keys(beforeObj || {});
      const aKeys = Object.keys(afterObj || {});
      for (let i = 0; i < aKeys.length; i++) {
        const k = aKeys[i];
        if (!(k in (beforeObj || {}))) {
          added.push(k);
        } else if (beforeObj[k] !== afterObj[k]) {
          changed.push({ field: k, from: beforeObj[k], to: afterObj[k] });
        }
      }
      for (let j = 0; j < bKeys.length; j++) {
        const k = bKeys[j];
        if (!(k in (afterObj || {}))) {
          removed.push(k);
        }
      }
      return { added: added, removed: removed, changed: changed, hasDiff: added.length + removed.length + changed.length > 0 };
    }

    // Module: Breadcrumb Path Resolver
    function buildBreadcrumbTrail(routeSegments, labelMap) {
      const trail = [{ label: labelMap["/"] || "Home", href: "/" }];
      let currentPath = "";
      for (let i = 0; i < routeSegments.length; i++) {
        const seg = routeSegments[i];
        if (!seg) continue;
        currentPath += "/" + seg;
        const label = labelMap[currentPath] || (seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " "));
        trail.push({ label: label, href: currentPath });
      }
      return trail;
    }

    // Module: Print / Document Layout Margin Solver
    function computeDocumentPageBox(pageFormat, orientation, marginMm) {
      const sizes = {
        A4: { width: 210, height: 297 },
        LETTER: { width: 215.9, height: 279.4 },
        LEGAL: { width: 215.9, height: 355.6 }
      };
      const base = sizes[pageFormat] || sizes.A4;
      const w = orientation === "landscape" ? base.height : base.width;
      const h = orientation === "landscape" ? base.width : base.height;
      const m = Math.max(0, marginMm || 12);
      return {
        outerWidthMm: w,
        outerHeightMm: h,
        printableWidthMm: Math.max(10, w - m * 2),
        printableHeightMm: Math.max(10, h - m * 2),
        aspectRatio: Number((w / h).toFixed(4))
      };
    }

    // Module: Retry Jitter Schedule Planner
    function generateRetrySchedule(attempts, baseMs, maxMs, factor) {
      const schedule = [];
      let delay = baseMs;
      for (let i = 0; i < attempts; i++) {
        const capped = Math.min(maxMs, Math.round(delay));
        const jitter = (capped * ((i * 37) % 19)) / 100;
        schedule.push(Math.round(capped + jitter));
        delay *= (factor || 2);
      }
      return schedule;
    }

    // Module: Tag & Facet Filter Engine
    function filterCatalogByFacets(items, activeFacets) {
      const facetKeys = Object.keys(activeFacets || {});
      const matched = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let ok = true;
        for (let f = 0; f < facetKeys.length; f++) {
          const fk = facetKeys[f];
          const allowedValues = activeFacets[fk];
          if (Array.isArray(allowedValues) && allowedValues.length > 0) {
            if (!allowedValues.includes(item[fk])) {
              ok = false;
              break;
            }
          }
        }
        if (ok) matched.push(item);
      }
      return matched;
    }

    // Module: Pagination Cursor Helper
    function computePaginationWindow(totalItems, pageSize, currentPage, maxButtons) {
      const size = Math.max(1, pageSize || 20);
      const totalPages = Math.max(1, Math.ceil(totalItems / size));
      const page = Math.min(totalPages, Math.max(1, currentPage || 1));
      const half = Math.floor((maxButtons || 5) / 2);
      let startPage = Math.max(1, page - half);
      let endPage = Math.min(totalPages, startPage + (maxButtons || 5) - 1);
      if (endPage - startPage + 1 < (maxButtons || 5)) {
        startPage = Math.max(1, endPage - (maxButtons || 5) + 1);
      }
      const pages = [];
      for (let p = startPage; p <= endPage; p++) pages.push(p);
      return { page: page, totalPages: totalPages, offset: (page - 1) * size, limit: size, pages: pages };
    }

    // Module: Markdown Heading Extractor
    function extractDocumentOutline(markdownLines) {
      const outline = [];
      for (let i = 0; i < markdownLines.length; i++) {
        const line = String(markdownLines[i] || "").trim();
        let level = 0;
        while (level < line.length && level < 6 && line[level] === "#") level++;
        if (level > 0 && line[level] === " ") {
          const title = line.slice(level + 1).trim();
          const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          outline.push({ level: level, title: title, slug: slug, line: i + 1 });
        }
      }
      return outline;
    }

    // Module: Webhook Signature Replay Window
    function verifyReplayWindowTolerance(headerTimestampSec, currentTimestampSec, toleranceSec) {
      const delta = Math.abs((currentTimestampSec | 0) - (headerTimestampSec | 0));
      const maxAllowed = toleranceSec > 0 ? toleranceSec : 300;
      return { accepted: delta <= maxAllowed, skewSeconds: delta, maxTolerance: maxAllowed };
    }

    // Module: Client Diagnostic Snapshot
    function buildDiagnosticReportSnapshot(appVer, envName, featureFlags, activeRoute) {
      return {
        version: appVer || APP_CONFIG.appVersion,
        environment: envName || "production",
        region: APP_CONFIG.region,
        route: activeRoute || "/dashboard",
        flagsCount: Object.keys(featureFlags || {}).length,
        issuerHost: APP_CONFIG.issuer
      };
    }

    // Module: Quota Progress Bar Calculator
    function summarizeUsageQuotas(meters) {
      const rows = [];
      for (let i = 0; i < meters.length; i++) {
        const m = meters[i];
        const limit = Math.max(1, m.limit || 1);
        const pct = Math.min(100, Math.round(((m.used || 0) / limit) * 100));
        const level = pct >= 90 ? "critical" : pct >= 75 ? "warning" : "normal";
        rows.push({ metric: m.name, used: m.used || 0, limit: limit, percent: pct, status: level });
      }
      return rows;
    }

    // Module: Table Sort Comparator
    function sortTableRowsByColumn(rows, columnKey, direction) {
      const dir = direction === "desc" ? -1 : 1;
      return rows.slice().sort((a, b) => {
        const av = a[columnKey];
        const bv = b[columnKey];
        if (av === bv) return 0;
        if (av === undefined || av === null) return 1;
        if (bv === undefined || bv === null) return -1;
        return av < bv ? -dir : dir;
      });
    }

    // Module: Session Idle Timeout Tracker
    function evaluateSessionIdleDeadline(lastActivityMs, nowMs, idleTimeoutMs, warnLeadMs) {
      const elapsed = Math.max(0, nowMs - lastActivityMs);
      const remaining = Math.max(0, idleTimeoutMs - elapsed);
      return {
        expired: remaining === 0,
        shouldWarn: remaining > 0 && remaining <= (warnLeadMs || 60000),
        remainingMs: remaining
      };
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

    export function exerciseExtendedClientModules(userId, tenantKey) {
      const rbac = evaluateRbacPermission({ admin: ["billing:*"] }, ["admin"], "billing", "read");
      const qTok = tokenizeSearchQuery("enterprise billing audit", { the: true });
      const sch = validatePayloadSchema({ email: userId }, { email: { required: true, type: "string", minLen: 3 } });
      const signedUrl = buildSignedApiQuery(APP_CONFIG.apiBase + "/events", { tenant: tenantKey, v: 4 }, APP_CONFIG.signingPublicId);
      const merged = mergeDocumentRevisions({ plan: "pro" }, { seats: 10 }, 1, 2);
      const ntf = enqueueNotificationItem([], "security", "Session rotated", "info", 10);
      const inv = computeInvoiceLineTotals([{ unitPriceCents: 2500, quantity: 2 }], 18, "LAUNCH10");
      const rl = consumeRateLimitToken({ tokens: 5, lastRefillMs: 1000 }, 2000, 10, 2);
      const hist = createHistoryTimeline({ step: 1 }, 5);
      hist.commit({ step: 2 });
      const csv = serializeRecordsToCsv(["id", "plan"], [{ id: userId, plan: "pro" }]);
      const matched = matchRoutePattern("/org/:orgId/billing", "/org/" + tenantKey + "/billing");
      const flatTree = flattenNavigationTree([{ id: "root", label: "Home", children: [{ id: "sub", label: "Docs" }] }]);
      const lum = parseHexRgbAndLuminance("#6366f1");
      const batches = partitionBatchOperations(["op1", "op2", "op3"], 2);
      const evict = calculateCacheEvictionPlan([{ key: "k1", bytes: 400, lastAccessMs: 1 }], 300, 50);
      const nonce = deriveCriticalSessionNonce(tenantKey, 4, "prod");
      const msg = formatLocalizedMessage("en", "billing.invoiceReady", {});
      const money = formatCurrencyAmount(4990, "USD", 2);
      const wf = transitionWorkflowState("draft", "SUBMIT", { compliancePassed: true });
      const idle = evaluateSessionIdleDeadline(1000, 5000, 60000, 10000);
      return (
        (rbac.allowed ? 1 : 0) + qTok.count + (sch.valid ? 1 : 0) + signedUrl.length +
        merged.conflicts.length + ntf.depth + inv.totalCents + (rl.allowed ? 1 : 0) +
        hist.current().step + csv.length + (matched.matched ? 1 : 0) + flatTree.length +
        lum.r + batches.length + evict.evictedKeys.length + nonce.length +
        msg.length + money.length + (wf.transitioned ? 1 : 0) + idle.remainingMs +
        formatRelativeTimestamp(1731110000000, 1731110400000, true).length +
        computeLinearAxisTicks(0, 95, 5).ticks.length +
        normalizeEntityCollection([{ id: "u1", name: "Alice" }], "id").count +
        encodeSocketCommandFrame("telemetry", "PING", { ok: true }, 1).length +
        resolveGridPlacement([{ id: "c1", colSpan: 1, rowSpan: 2 }], 3, 80, 12).placements.length +
        evaluateWizardProgress([{ id: "s1" }, { id: "s2" }], { s1: true }, {}).percentComplete +
        normalizeShortcutBinding("Ctrl+Shift+K").canonical.length +
        aggregatePerformanceSpans([{ operation: "render", durationMs: 4, status: "ok" }]).render.count +
        assignExperimentVariant("checkout_v4", "usr_1", [{ name: "treatment", weightPct: 100 }]).variant.length +
        (computeObjectFieldDiff({ a: 1 }, { a: 2, b: 3 }).hasDiff ? 1 : 0) +
        buildBreadcrumbTrail(["dashboard", "security"], { "/dashboard": "Dashboard" }).length +
        computeDocumentPageBox("A4", "portrait", 15).printableWidthMm +
        generateRetrySchedule(3, 200, 5000, 2).length +
        filterCatalogByFacets([{ tier: "pro" }], { tier: ["pro"] }).length +
        computePaginationWindow(120, 20, 2, 5).pages.length +
        extractDocumentOutline(["# Overview", "## Security"]).length +
        (verifyReplayWindowTolerance(1731110350, 1731110400, 300).accepted ? 1 : 0) +
        buildDiagnosticReportSnapshot("4.0.0", "production", { mba: true }, "/settings").flagsCount +
        summarizeUsageQuotas([{ name: "api", used: 40, limit: 100 }]).length +
        sortTableRowsByColumn([{ score: 2 }, { score: 1 }], "score", "asc").length
      );
    }

    export function computeHotRenderMetrics(items) {
      return computeHotVirtualListWindow(items, 120, 640) + computeHotCanvasParticles(items, 2);
    }
  `;
}

function createBenchmarkRunner(
  codeToRun: string,
  mode: 'hot' | 'mixed'
): (data: number[]) => number {
  const loopBody =
    mode === 'hot'
      ? 'for (let i = 0; i < 80000; i++) { s += computeHotRenderMetrics(sampleData); }'
      : 'for (let i = 0; i < 80000; i++) { s += computeHotRenderMetrics(sampleData); } for (let j = 0; j < 10; j++) { s += createClientSession("usr_101", "tnt_99"); }';
  const executableBody =
    codeToRun.replace(/export\s+function/g, 'function') +
    `\nreturn function(sampleData) { let s = 0; ${loopBody} return s; };`;
  const factory = new Function(executableBody);
  return factory();
}

function interquartileMean(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = Math.floor(sorted.length * 0.2);
  const hi = Math.ceil(sorted.length * 0.8);
  const middle = sorted.slice(lo, hi);
  return middle.reduce((acc, v) => acc + v, 0) / middle.length;
}

function measureInterleavedOverheadPct(
  runOriginal: (data: number[]) => number,
  runProtected: (data: number[]) => number,
  sampleData: number[]
): number {
  // Warmup V8 TurboFan JIT for both functions identically
  for (let w = 0; w < 25; w++) {
    runOriginal(sampleData);
    runProtected(sampleData);
  }

  const origTimes: number[] = [];
  const protTimes: number[] = [];

  for (let r = 0; r < 31; r++) {
    if (r % 2 === 0) {
      const s1 = performance.now();
      runOriginal(sampleData);
      origTimes.push(performance.now() - s1);

      const s2 = performance.now();
      runProtected(sampleData);
      protTimes.push(performance.now() - s2);
    } else {
      const s2 = performance.now();
      runProtected(sampleData);
      protTimes.push(performance.now() - s2);

      const s1 = performance.now();
      runOriginal(sampleData);
      origTimes.push(performance.now() - s1);
    }
  }

  const medOrig = interquartileMean(origTimes);
  const medProt = interquartileMean(protTimes);
  return Math.max(0, ((medProt - medOrig) / medOrig) * 100);
}

async function runBenchmark() {
  const realisticClientBundle = buildRealisticApplicationBundle();
  const sampleData = Array.from({ length: 500 }, (_, i) => (i % 40) + 16);
  const origBytes = Buffer.byteLength(realisticClientBundle, 'utf8');
  const origGzip = zlib.gzipSync(realisticClientBundle).byteLength;

  const tiers: Array<{
    name: string;
    options: Parameters<typeof transformJavaScript>[1];
    enforceCpuBudget: boolean;
    enforceGzipBudget: boolean;
  }> = [
    {
      name: 'Tier 1 (minimal: hot-path exempt, string vault, minLength:1 mangler, shield)',
      options: {
        seed: 0x7f3a91,
        minStringLength: 6,
        config: { coldFlow: false },
      },
      enforceCpuBudget: true,
      enforceGzipBudget: true,
    },
    {
      name: 'Tier 2 (recommended: >=4-var MBA + Rivest + S-Box + string vault + mangler + shield)',
      options: {
        seed: 0x7f3a91,
        minStringLength: 6,
      },
      enforceCpuBudget: true,
      enforceGzipBudget: true,
    },
    {
      name: 'Tier 3 (strict: @unpeek-critical Micro-VM v2 + host-coupled WASM KDF + salted vault)',
      options: {
        seed: 0x7f3a91,
        minStringLength: 6,
        aggressive: true,
        critical: { annotation: '@unpeek-critical', maxFunctionsPerChunk: 2 },
      },
      enforceCpuBudget: false,
      enforceGzipBudget: false,
    },
  ];

  console.log('==================================================');
  console.log('           UNPEEK v4 BENCHMARK REPORT             ');
  console.log('==================================================');
  console.log(`Baseline Bundle (Raw/Gz): ${origBytes} B / ${origGzip} B`);

  for (const tier of tiers) {
    const t0 = performance.now();
    const transformed = transformJavaScript(realisticClientBundle, tier.options);
    const shield = generateRuntimeShield({
      seed: 0x7f3a91,
      deterrentMode: 'gradual',
    });
    const buildTimeMs = performance.now() - t0;

    const finalProtectedCode = `${shield.preambleCode}\n${transformed.code}`;
    const protBytes = Buffer.byteLength(finalProtectedCode, 'utf8');
    const protGzip = zlib.gzipSync(finalProtectedCode).byteLength;
    const gzipDeltaPct = ((protGzip - origGzip) / origGzip) * 100;

    const hotCpuOverheadPct = measureInterleavedOverheadPct(
      createBenchmarkRunner(realisticClientBundle, 'hot'),
      createBenchmarkRunner(finalProtectedCode, 'hot'),
      sampleData
    );
    const cpuOverheadPct = measureInterleavedOverheadPct(
      createBenchmarkRunner(realisticClientBundle, 'mixed'),
      createBenchmarkRunner(finalProtectedCode, 'mixed'),
      sampleData
    );

    console.log('--------------------------------------------------');
    console.log(`Profile / Tier         : ${tier.name}`);
    console.log(`Build / Transform Time : ${buildTimeMs.toFixed(2)} ms (Target: < 3000 ms)`);
    console.log(`Protected Size (Raw/Gz): ${protBytes} B / ${protGzip} B`);
    console.log(`Gzip Size Delta        : ${gzipDeltaPct >= 0 ? '+' : ''}${gzipDeltaPct.toFixed(2)}%${tier.enforceGzipBudget ? ' (Budget: < 15.00%)' : ' (Informational Tier 3)'}`);
    console.log(`Hot-Path Skipped Fns   : ${transformed.hotPathReport.hotFunctionsSkipped.length}`);
    console.log(`Cold-Path Protected Fns: ${transformed.hotPathReport.coldFunctionsProtected.length}`);
    console.log(`Encrypted Strings      : ${transformed.encryptedStringsCount}`);
    console.log(`Mangled Local Symbols  : ${transformed.mangledSymbolsCount}`);
    console.log(`Virtualized Functions  : ${transformed.virtualizedFunctionsCount}`);
    console.log(`Hot-Loop CPU Overhead  : ${hotCpuOverheadPct.toFixed(2)}% (Budget: < 2.00%)`);
    console.log(`Runtime CPU Overhead   : ${cpuOverheadPct.toFixed(2)}%${tier.enforceCpuBudget ? ' (Budget: < 2.00%)' : ' (Informational Tier 3)'}`);

    if (buildTimeMs > 3000) {
      console.error(`FAIL [${tier.name}]: Build time exceeded 3000ms budget`);
      process.exit(1);
    }
    if (tier.enforceCpuBudget && hotCpuOverheadPct > 2.0) {
      console.error(`FAIL [${tier.name}]: Hot-loop CPU overhead ${hotCpuOverheadPct.toFixed(2)}% exceeded 2.00% budget`);
      process.exit(1);
    }
    if (tier.enforceCpuBudget && cpuOverheadPct > 2.0) {
      console.error(`FAIL [${tier.name}]: CPU overhead ${cpuOverheadPct.toFixed(2)}% exceeded 2.00% budget`);
      process.exit(1);
    }
    if (tier.enforceGzipBudget && gzipDeltaPct > 15.0) {
      console.error(`FAIL [${tier.name}]: Gzip delta +${gzipDeltaPct.toFixed(2)}% exceeded 15.00% budget`);
      process.exit(1);
    }
  }
  console.log('==================================================');
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
