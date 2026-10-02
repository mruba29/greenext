/**
 * GreenNext Centralized Analytics & Behavioral Tracking Utility
 *
 * Sends user interaction telemetry directly to the designated Google Apps Script Web App endpoint.
 * Schema matches the 10 fixed Google Sheets tabs exactly:
 *
 * 1. Navigation:      Timestamp | Event | Page | Destination | Session ID
 * 2. Regions:         Timestamp | Event | Region | Page | Session ID
 * 3. Infrastructure:  Timestamp | Event | Capability | Page | Session ID
 * 4. Energy:          Timestamp | Event | Topic | Page | Session ID
 * 5. Automation:      Timestamp | Event | Feature | Page | Session ID
 * 6. Solutions:       Timestamp | Event | Solution | Page | Session ID
 * 7. Industries:      Timestamp | Event | Industry | Page | Session ID
 * 8. Locations:       Timestamp | Event | Location | Page | Session ID
 * 9. AI Assistant:    Timestamp | Event | Input / Selection | Page | Session ID
 * 10. CTA Interactions: Timestamp | Event | CTA | Page | Session ID
 */

const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbw45SbxX8E30Dm7sh51nyPKMjJfc9uWYbNYmZreKCYnFeCH7BxrAlZGFRKB2AfgKZrv/exec";

export const ANALYTICS_ENDPOINT: string =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env["VITE_ANALYTICS_ENDPOINT"]) ||
  DEFAULT_APPS_SCRIPT_URL;

export type AnalyticsTab =
  | "Navigation"
  | "Regions"
  | "Infrastructure"
  | "Energy"
  | "Automation"
  | "Solutions"
  | "Industries"
  | "Locations"
  | "AI Assistant"
  | "CTA Interactions";

export interface AnalyticsPayload {
  tab: AnalyticsTab;
  event: string;
  value: string;
  page?: string;
}

const SESSION_KEY = "gn_analytics_session_id";
const SESSION_SEEN_KEY = "gn_analytics_session_seen";
const SESSION_KIND_KEY = "gn_analytics_session_kind";
let lastPageViewKey = "";
let lastPageViewAt = 0;
let lastFormOpenKey = "";
let lastFormOpenAt = 0;

export type SessionKind = "new_session" | "returning_session";
export type TrafficChannel =
  "Direct" | "Organic Search" | "Paid" | "Referral" | "Social" | "Campaign";

export interface TrafficAttribution {
  landingPage: string;
  trafficSource: string;
  trafficMedium: string;
  trafficChannel: TrafficChannel;
  referrer: string;
  referrerDomain: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string;
  utmContent: string;
  isOrganic: boolean;
  isPaid: boolean;
}

/**
 * Retrieves or initializes an anonymous persistent session ID for the current browser session.
 */
export function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = "gn_s_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  } catch {
    return "session_fallback";
  }
}

/** Returns an anonymous browser-local session classification without identifying a person. */
export function getSessionKind(): SessionKind {
  if (typeof window === "undefined") return "new_session";
  try {
    const currentSessionId = getSessionId();
    const existingKind = sessionStorage.getItem(SESSION_KIND_KEY);
    if (existingKind === "new_session" || existingKind === "returning_session") {
      return existingKind;
    }
    const kind: SessionKind = localStorage.getItem(SESSION_SEEN_KEY)
      ? "returning_session"
      : "new_session";
    localStorage.setItem(SESSION_SEEN_KEY, currentSessionId);
    sessionStorage.setItem(SESSION_KIND_KEY, kind);
    return kind;
  } catch {
    return "new_session";
  }
}

/**
 * Returns current route pathname safely.
 */
export function getCurrentPage(): string {
  if (typeof window === "undefined") return "/";
  try {
    return window.location.pathname || "/";
  } catch {
    return "/";
  }
}

const SEARCH_DOMAINS = [
  "bing.com",
  "duckduckgo.com",
  "baidu.com",
  "yandex.com",
  "yandex.ru",
  "ecosia.org",
];
const SOCIAL_DOMAINS = [
  "linkedin.com",
  "instagram.com",
  "facebook.com",
  "youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
];
const PAID_MEDIUMS = [
  "cpc",
  "ppc",
  "paid",
  "paid_search",
  "paid_social",
  "display",
  "cpm",
  "cpv",
  "sem",
  "ads",
  "advertising",
];
const UTM_FIELDS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

function readUtmParams(search: string): Record<(typeof UTM_FIELDS)[number], string> {
  const params = new URLSearchParams(search);
  const result = {} as Record<(typeof UTM_FIELDS)[number], string>;
  UTM_FIELDS.forEach((key) => {
    result[key] = (params.get(key) || "").trim().slice(0, 200);
  });
  return result;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isSearchReferrer(host: string): boolean {
  return (
    /(^|\.)google\.[a-z.]+$/.test(host) ||
    /(^|\.)yahoo\.[a-z.]+$/.test(host) ||
    SEARCH_DOMAINS.some((domain) => hostMatches(host, domain))
  );
}

function buildTrafficAttribution(
  landingPage: string,
  search: string,
  rawReferrer: string,
): TrafficAttribution {
  const utm = readUtmParams(search);
  let referrer = "";
  let referrerDomain = "";
  try {
    const parsed = rawReferrer ? new URL(rawReferrer) : null;
    const currentHost = typeof window === "undefined" ? "" : window.location.hostname.toLowerCase();
    if (parsed && parsed.hostname.toLowerCase() !== currentHost) {
      referrerDomain = parsed.hostname.toLowerCase().replace(/^www\./, "");
      // Keep only the external origin; discard path, query, and fragment.
      referrer = parsed.origin;
    }
  } catch {
    /* An unavailable or malformed referrer is treated as direct. */
  }

  const host = referrerDomain;
  const isSearch = isSearchReferrer(host);
  const isSocial = SOCIAL_DOMAINS.some((domain) => hostMatches(host, domain));
  const paidTokens = [utm.utm_medium, utm.utm_source].map((value) => value.toLowerCase());
  const isPaid = paidTokens.some(
    (value) => PAID_MEDIUMS.includes(value) || /paid|cpc|ppc|(^|[_-])ads?($|[_-])/.test(value),
  );
  const isOrganic = isSearch && !isPaid;
  let trafficChannel: TrafficChannel;
  if (isPaid) trafficChannel = "Paid";
  else if (isOrganic) trafficChannel = "Organic Search";
  else if (
    isSocial ||
    ["social", "social_media", "organic_social"].includes(utm.utm_medium.toLowerCase())
  )
    trafficChannel = "Social";
  else if (utm.utm_campaign) trafficChannel = "Campaign";
  else if (host) trafficChannel = "Referral";
  else trafficChannel = "Direct";

  const trafficSource = utm.utm_source || host || "Direct";
  const trafficMedium =
    utm.utm_medium ||
    (isPaid ? "paid" : isOrganic ? "organic" : isSocial ? "social" : host ? "referral" : "direct");
  return {
    landingPage: landingPage || "/",
    trafficSource,
    trafficMedium,
    trafficChannel,
    referrer,
    referrerDomain,
    utmSource: utm.utm_source,
    utmMedium: utm.utm_medium,
    utmCampaign: utm.utm_campaign,
    utmTerm: utm.utm_term,
    utmContent: utm.utm_content,
    isOrganic,
    isPaid,
  };
}

function getCurrentTrafficAttribution(landingPage = getCurrentPage()): TrafficAttribution {
  if (typeof window === "undefined") return buildTrafficAttribution(landingPage, "", "");
  return buildTrafficAttribution(landingPage, window.location.search, document.referrer);
}

/**
 * Sanitizes chat messages to concise behavioral topics/intents without storing private raw text.
 */
export function sanitizeChatTopic(rawMessage: string): string {
  const q = rawMessage.toLowerCase().trim();
  if (!q) return "general_inquiry";

  if (q.includes("madurai") || q.includes("mdu")) return "region:madurai";
  if (q.includes("coimbatore") || q.includes("cjb")) return "region:coimbatore";
  if (q.includes("trichy") || q.includes("trz") || q.includes("tiruchirappalli"))
    return "region:trichy";
  if (q.includes("mangalore") || q.includes("ixe") || q.includes("mangaluru"))
    return "region:mangalore";
  if (q.includes("region") || q.includes("location") || q.includes("south india"))
    return "topic:regional_network";
  if (q.includes("ai") || q.includes("compute") || q.includes("gpu") || q.includes("density"))
    return "topic:ai_compute_infrastructure";
  if (q.includes("power") || q.includes("energy") || q.includes("cooling") || q.includes("thermal"))
    return "topic:energy_and_cooling";
  if (
    q.includes("automation") ||
    q.includes("workflow") ||
    q.includes("anomaly") ||
    q.includes("alert")
  )
    return "topic:intelligent_automation";
  if (q.includes("contact") || q.includes("talk") || q.includes("phone") || q.includes("email"))
    return "intent:contact_inquiry";
  if (q.includes("what is") || q.includes("about") || q.includes("greennext"))
    return "topic:about_greennext";

  // Truncate to maximum 40 alphanumeric characters to avoid sensitive data leakage
  return (
    "query:" +
    q
      .replace(/[^a-z0-9\s_-]/gi, "")
      .substring(0, 40)
      .trim()
  );
}

/**
 * Central event tracking dispatcher.
 * Maps the target tab and entity value to the exact column headers expected by the Google Sheet.
 */
export function trackEvent({ tab, event, value, page }: AnalyticsPayload): void {
  if (typeof window === "undefined") return;

  const pagePath = page || getCurrentPage();
  const sessionId = getSessionId();

  // Keep the payload flat so it can be handled directly by the Apps Script web app.
  const payload: Record<string, string> = {
    sheet: tab,
    event,
    page: pagePath,
    sessionId,
    sessionKind: getSessionKind(),
    timestamp: new Date().toISOString(),
  };

  switch (tab) {
    case "Navigation":
      payload["destination"] = value;
      break;
    case "Regions":
      payload["region"] = value;
      break;
    case "Infrastructure":
      payload["capability"] = value;
      break;
    case "Energy":
      payload["topic"] = value;
      break;
    case "Automation":
      payload["feature"] = value;
      break;
    case "Solutions":
      payload["solution"] = value;
      break;
    case "Industries":
      payload["industry"] = value;
      break;
    case "Locations":
      payload["location"] = value;
      break;
    case "AI Assistant":
      payload["inputSelection"] = value;
      break;
    case "CTA Interactions":
      payload["cta"] = value;
      break;
  }

  try {
    const body = JSON.stringify(payload);

    // Prefer navigator.sendBeacon for fast, non-blocking telemetry
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      const sent = navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
      if (sent) return;
    }

    // Use a simple request to avoid a CORS preflight on the Apps Script endpoint.
    fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      body,
    }).catch(() => {
      // Graceful silence: analytics should never break user interactions
    });
  } catch {
    // Graceful error suppression
  }
}

/** PII-free page-view signal. One call should be made per actual route visit. */
export function trackPageView(page = getCurrentPage()): void {
  const now = Date.now();
  if (lastPageViewKey === page && now - lastPageViewAt < 500) return;
  lastPageViewKey = page;
  lastPageViewAt = now;
  trackEvent({ tab: "CTA Interactions", event: "page_view", value: page, page });

  // Session Intelligence: record page view in navigation path
  if (typeof window !== "undefined") {
    recordSessionPageNavigation(page);
  }
}

export function trackScrollDepth(depth: 25 | 50 | 75 | 90 | 100, page = getCurrentPage()): void {
  trackEvent({ tab: "CTA Interactions", event: `scroll_${depth}`, value: `${depth}%`, page });
}

export function trackEngagement(seconds: 30 | 60 | 120, page = getCurrentPage()): void {
  trackEvent({
    tab: "CTA Interactions",
    event: `engagement_${seconds}s`,
    value: `${seconds}s`,
    page,
  });
}

export function trackFormOpen(formType: string, page = getCurrentPage()): void {
  const key = `${page}|${formType}`;
  const now = Date.now();
  if (lastFormOpenKey === key && now - lastFormOpenAt < 500) return;
  lastFormOpenKey = key;
  lastFormOpenAt = now;
  trackEvent({ tab: "CTA Interactions", event: "form_open", value: formType, page });
}

export function trackFormStart(formType: string, page = getCurrentPage()): void {
  trackEvent({ tab: "CTA Interactions", event: "form_start", value: formType, page });
}

export function trackDocumentSelected(formType: string, page = getCurrentPage()): void {
  trackEvent({ tab: "CTA Interactions", event: "document_selected", value: formType, page });
}

export function trackFormAbandon(formType: string, page = getCurrentPage()): void {
  trackEvent({ tab: "CTA Interactions", event: "form_abandon", value: formType, page });
}

// ─── SESSION INTELLIGENCE ────────────────────────────────────────────────────

export interface SessionIntelligenceState {
  sessionId: string;
  sessionKind: SessionKind;
  startedAt: number;
  lastActivityAt: number;
  entryPage: string;
  traffic: TrafficAttribution;
  exitPage: string;
  navigationPath: string[];
  pageCount: number;
  activeDurationMs: number;
  isSent: boolean;
}

const SESSION_INTELLIGENCE_KEY = "gn_session_intel_state";

export function getSessionIntelligenceState(): SessionIntelligenceState {
  if (typeof window === "undefined") {
    return {
      sessionId: "server",
      sessionKind: "new_session",
      startedAt: 0,
      lastActivityAt: 0,
      entryPage: "",
      traffic: buildTrafficAttribution("", "", ""),
      exitPage: "",
      navigationPath: [],
      pageCount: 0,
      activeDurationMs: 0,
      isSent: false,
    };
  }
  try {
    const stored = sessionStorage.getItem(SESSION_INTELLIGENCE_KEY);
    if (stored) {
      const state = JSON.parse(stored) as SessionIntelligenceState;
      if (!state.traffic) {
        state.traffic = getCurrentTrafficAttribution(state.entryPage || getCurrentPage());
        saveSessionIntelligenceState(state);
      }
      return state;
    }
  } catch {
    // Recover with a fresh in-memory session state if storage is unavailable or invalid.
  }

  const newState: SessionIntelligenceState = {
    sessionId: getSessionId(),
    sessionKind: getSessionKind(),
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    entryPage: getCurrentPage(),
    traffic: getCurrentTrafficAttribution(getCurrentPage()),
    exitPage: getCurrentPage(),
    navigationPath: [getCurrentPage()],
    pageCount: 1,
    activeDurationMs: 0,
    isSent: false,
  };
  saveSessionIntelligenceState(newState);
  return newState;
}

function saveSessionIntelligenceState(state: SessionIntelligenceState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_INTELLIGENCE_KEY, JSON.stringify(state));
  } catch {
    // Session persistence is best-effort and must never block the site.
  }
}

export function recordSessionPageNavigation(page: string) {
  const state = getSessionIntelligenceState();
  if (state.isSent) return;

  if (state.navigationPath[state.navigationPath.length - 1] !== page) {
    state.navigationPath.push(page);
    state.pageCount = state.navigationPath.length;
  }
  state.exitPage = page;
  state.lastActivityAt = Date.now();
  saveSessionIntelligenceState(state);
}

let _isSessionIntelInitialized = false;

// Module-level guard that survives React Strict Mode double-mount.
// Also backed by sessionStorage so it persists across fast re-renders.
const SESSION_END_KEY = "gn_session_end_sent";

function isSessionEndAlreadySent(sessionId: string): boolean {
  try {
    return sessionStorage.getItem(`${SESSION_END_KEY}_${sessionId}`) === "1";
  } catch {
    return false;
  }
}

function markSessionEndSent(sessionId: string): void {
  try {
    sessionStorage.setItem(`${SESSION_END_KEY}_${sessionId}`, "1");
  } catch {
    // Best-effort
  }
}

export function initSessionIntelligence() {
  if (typeof window === "undefined" || _isSessionIntelInitialized) return;
  _isSessionIntelInitialized = true;

  // lastActiveTick tracks when we last accumulated active time.
  // Resets to now on any activity event or visibility-visible transition.
  let lastActiveTick = Date.now();
  let isTabVisible = document.visibilityState === "visible";

  const handleActivity = () => {
    const now = Date.now();
    if (isTabVisible) {
      const delta = now - lastActiveTick;
      // Cap at 30 s to avoid counting idle time when user was AFK
      if (delta > 0 && delta < 30000) {
        const state = getSessionIntelligenceState();
        if (!state.isSent) {
          state.activeDurationMs += delta;
          state.lastActivityAt = now;
          saveSessionIntelligenceState(state);
        }
      }
    }
    lastActiveTick = now;
  };

  let throttleTimer: ReturnType<typeof window.setTimeout> | null = null;
  const throttledActivity = () => {
    if (!throttleTimer) {
      handleActivity();
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
      }, 2000);
    }
  };

  window.addEventListener("mousemove", throttledActivity, { passive: true });
  window.addEventListener("keydown", throttledActivity, { passive: true });
  window.addEventListener("scroll", throttledActivity, { passive: true });
  window.addEventListener("touchstart", throttledActivity, { passive: true });
  window.addEventListener("click", throttledActivity, { passive: true });

  document.addEventListener("visibilitychange", () => {
    const now = Date.now();
    if (document.visibilityState === "hidden") {
      // Tab hidden: accumulate active time up to this moment, then pause.
      if (isTabVisible) {
        const delta = now - lastActiveTick;
        if (delta > 0 && delta < 30000) {
          const state = getSessionIntelligenceState();
          if (!state.isSent) {
            state.activeDurationMs += delta;
            state.lastActivityAt = now;
            saveSessionIntelligenceState(state);
          }
        }
      }
      isTabVisible = false;
      lastActiveTick = now;
      // Send an interim snapshot (not a session-end) so data is not lost
      // if the browser crashes or the user never returns.
      // The backend will upsert — not duplicate — this row.
      sendSessionSnapshot("visibility_hidden");
    } else {
      // Tab visible again: resume active-time tracking.
      isTabVisible = true;
      lastActiveTick = now;
    }
  });

  // beforeunload and pagehide are the authoritative session-end signals.
  const handleUnload = () => {
    // Accumulate any remaining active time before the session ends.
    if (isTabVisible) {
      const now = Date.now();
      const delta = now - lastActiveTick;
      if (delta > 0 && delta < 30000) {
        const state = getSessionIntelligenceState();
        if (!state.isSent) {
          state.activeDurationMs += delta;
          state.lastActivityAt = now;
          saveSessionIntelligenceState(state);
        }
      }
    }
    sendSessionEndEvent("page_exit");
  };

  window.addEventListener("beforeunload", handleUnload);
  window.addEventListener("pagehide", handleUnload);
}

/**
 * Sends a non-final session snapshot (e.g., when tab goes hidden).
 * Does NOT set isSent=true, so the session can continue accumulating data.
 * The backend upserts by session ID, so no duplicate rows are created.
 */
function sendSessionSnapshot(reason: string): void {
  if (typeof window === "undefined") return;
  const state = getSessionIntelligenceState();
  if (state.isSent) return; // Already ended; don't send stale data.

  const payload = {
    sheet: "Session Intelligence",
    event: "session_snapshot",
    sessionId: state.sessionId,
    sessionKind: state.sessionKind,
    startedAt: new Date(state.startedAt).toISOString(),
    lastActivityAt: new Date(state.lastActivityAt).toISOString(),
    endedAt: "",
    entryPage: state.entryPage,
    exitPage: state.exitPage,
    navigationPath: state.navigationPath.join(" -> "),
    pageCount: state.pageCount,
    activeDurationMs: state.activeDurationMs,
    bounce: "",
    sessionEndReason: reason,
  };

  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
    } else {
      fetch(ANALYTICS_ENDPOINT, { method: "POST", mode: "no-cors", body }).catch(() => {});
    }
  } catch {
    // Telemetry must never break the user experience.
  }
}

/** Sends the session's initial record once when a new/returning session starts. */
let _trafficAttributionSent = false;
export function trackTrafficAttribution(): void {
  if (typeof window === "undefined" || _trafficAttributionSent) return;
  _trafficAttributionSent = true;
  const state = getSessionIntelligenceState();
  // Idempotency: skip if this session's start event was already sent.
  try {
    const sentKey = `gn_session_start_${state.sessionId}`;
    if (sessionStorage.getItem(sentKey)) return;
    sessionStorage.setItem(sentKey, "1");
  } catch {
    /* Continue with in-memory deduplication when storage is unavailable. */
  }

  const payload = {
    sheet: "Session Intelligence",
    event: "session_start",
    sessionId: state.sessionId,
    sessionKind: state.sessionKind,
    startedAt: new Date(state.startedAt).toISOString(),
    lastActivityAt: new Date(state.lastActivityAt).toISOString(),
    endedAt: "",
    entryPage: state.entryPage,
    exitPage: state.exitPage,
    navigationPath: state.navigationPath.join(" -> "),
    pageCount: state.pageCount,
    activeDurationMs: state.activeDurationMs,
    bounce: "",
    sessionEndReason: "",
  };

  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      if (navigator.sendBeacon(ANALYTICS_ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" })))
        return;
    }
    fetch(ANALYTICS_ENDPOINT, { method: "POST", mode: "no-cors", body }).catch(() => {});
  } catch {
    /* Session start collection must never interfere with the website. */
  }
}

export function sendSessionEndEvent(reason: string) {
  if (typeof window === "undefined") return;
  const state = getSessionIntelligenceState();

  // Dual-layer deduplication:
  // 1. isSent flag in sessionStorage (survives re-renders within the same tab)
  // 2. SESSION_END_KEY in sessionStorage (explicit idempotency guard)
  if (state.isSent) return;
  if (isSessionEndAlreadySent(state.sessionId)) return;

  // Mark sent immediately (before the async network call) to prevent
  // React Strict Mode double-invocations from sending a duplicate.
  state.isSent = true;
  saveSessionIntelligenceState(state);
  markSessionEndSent(state.sessionId);

  const bounce = state.pageCount === 1 && state.activeDurationMs < 10000 ? "Yes" : "No";

  const payload = {
    sheet: "Session Intelligence",
    event: "session_end",
    sessionId: state.sessionId,
    sessionKind: state.sessionKind,
    startedAt: new Date(state.startedAt).toISOString(),
    lastActivityAt: new Date(state.lastActivityAt).toISOString(),
    endedAt: new Date().toISOString(),
    entryPage: state.entryPage,
    exitPage: state.exitPage,
    navigationPath: state.navigationPath.join(" -> "),
    pageCount: state.pageCount,
    activeDurationMs: state.activeDurationMs,
    bounce: bounce,
    sessionEndReason: reason,
  };

  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        ANALYTICS_ENDPOINT,
        new Blob([body], { type: "text/plain;charset=UTF-8" }),
      );
    } else {
      fetch(ANALYTICS_ENDPOINT, { method: "POST", mode: "no-cors", body, keepalive: true }).catch(
        () => {},
      );
    }
  } catch {
    // Session telemetry is best-effort and must not interfere with page navigation.
  }
}
