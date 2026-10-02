/**
 * GreetingPopups
 *
 * Two lightweight, non-blocking popups that appear once per browser session:
 *
 * 1. Entry Greeting  — shown ~1 s after the first page load.
 *    Displays a time-based greeting derived from the user's local browser clock.
 *
 * 2. Exit Intent     — shown when a desktop pointer leaves the viewport toward
 *    the browser chrome (top ~10 px of the screen).  Suppressed on touch
 *    devices to avoid unreliable mobile behaviour.
 *
 * Both use the existing sessionStorage naming convention (gn_* prefix) and
 * fire lightweight analytics events via the existing trackEvent() helper.
 * Neither popup creates a new session ID or a new analytics system.
 */

import { useEffect, useState } from "react";
import { trackEvent } from "../../lib/analytics";

// ─── Session-storage keys (follow existing gn_* convention) ─────────────────
const ENTRY_SHOWN_KEY = "gn_popup_entry_shown";
const EXIT_SHOWN_KEY = "gn_popup_exit_shown";

// ─── Module-level guard: survives React Strict Mode double-mount ─────────────
// These flags are set the instant a popup is scheduled/shown so that the
// second Strict Mode invocation sees them already set and does nothing.
let _entryScheduled = false;
let _exitListenerAttached = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sessionFlagGet(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function sessionFlagSet(key: string): void {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // Best-effort; popup still works even if storage is unavailable.
  }
}

/** Returns a time-based greeting string from the user's local browser clock. */
function getTimeGreeting(): { text: string; emoji: string } {
  const hour = new Date().getHours(); // 0-23, local browser time

  if (hour >= 5 && hour < 12) return { text: "Good Morning", emoji: "\u2600\ufe0f" };
  if (hour >= 12 && hour < 17) return { text: "Good Afternoon", emoji: "\ud83c\udf24\ufe0f" };
  if (hour >= 17 && hour < 21) return { text: "Good Evening", emoji: "\ud83c\udfd9\ufe0f" };
  return { text: "Good Night", emoji: "\ud83c\udf19" };
}

/** True when the primary input mechanism is coarse (touch), e.g. phones/tablets. */
function isTouchPrimaryDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface PopupCardProps {
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
}

function PopupCard({ onClose, children, testId }: PopupCardProps) {
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="false"
      aria-label="Site notification"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 9999,
        width: "260px",
        background: "linear-gradient(135deg, #121824 0%, #1a2234 100%)",
        border: "1px solid #1e293b",
        borderRadius: "12px",
        padding: "16px 20px",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(16,185,129,0.12)",
        animation: "gn-popup-in 0.28s cubic-bezier(0.22,1,0.36,1) both",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: "10px",
          right: "12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "#64748b",
          fontSize: "16px",
          lineHeight: 1,
          padding: "2px 4px",
          borderRadius: "4px",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#f8fafc";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#64748b";
        }}
      >
        &#x2715;
      </button>

      {/* Emerald accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "3px",
          height: "100%",
          background: "linear-gradient(180deg, #10b981 0%, #059669 100%)",
          borderRadius: "12px 0 0 12px",
        }}
      />

      <div style={{ paddingLeft: "4px" }}>{children}</div>
    </div>
  );
}

// ─── Entry Greeting ──────────────────────────────────────────────────────────

function EntryGreeting({ onClose }: { onClose: () => void }) {
  const { text, emoji } = getTimeGreeting();

  return (
    <PopupCard onClose={onClose} testId="entry-greeting-popup">
      <p
        style={{
          margin: "0 0 6px 0",
          fontSize: "14px",
          fontWeight: 600,
          color: "#f8fafc",
          letterSpacing: "-0.01em",
        }}
      >
        Welcome back! &#x1F44B;
      </p>
      <p
        style={{
          margin: 0,
          fontSize: "13px",
          color: "#34d399",
          fontWeight: 500,
        }}
      >
        {text} {emoji}
      </p>
    </PopupCard>
  );
}

// ─── Exit Intent ─────────────────────────────────────────────────────────────

function ExitIntentPopup({ onClose }: { onClose: () => void }) {
  return (
    <PopupCard onClose={onClose} testId="exit-intent-popup">
      <p
        style={{
          margin: "0 0 4px 0",
          fontSize: "14px",
          fontWeight: 600,
          color: "#f8fafc",
          letterSpacing: "-0.01em",
        }}
      >
        Wait! Before you go &#x1F44B;
      </p>
      <p
        style={{
          margin: 0,
          fontSize: "12px",
          color: "#94a3b8",
          lineHeight: 1.5,
        }}
      >
        Explore GreenNext&apos;s AI-driven infrastructure solutions for South India.
      </p>
    </PopupCard>
  );
}

// ─── Main orchestrator ───────────────────────────────────────────────────────

export function GreetingPopups() {
  const [showEntry, setShowEntry] = useState(false);
  const [showExit, setShowExit] = useState(false);

  // ── Entry greeting: show once per session, ~1 s after first mount ──────────
  useEffect(() => {
    // Guard 1: module-level flag (survives Strict Mode double-mount in dev)
    if (_entryScheduled) return;
    // Guard 2: sessionStorage flag (survives component remounts)
    if (sessionFlagGet(ENTRY_SHOWN_KEY)) return;

    _entryScheduled = true;
    sessionFlagSet(ENTRY_SHOWN_KEY); // set immediately before timer fires

    const timer = window.setTimeout(() => {
      setShowEntry(true);
      trackEvent({
        tab: "CTA Interactions",
        event: "entry_greeting_shown",
        value: getTimeGreeting().text,
      });
    }, 1000);

    return () => {
      window.clearTimeout(timer);
      // Note: _entryScheduled is intentionally NOT reset here so that
      // React Strict Mode's second mount does not re-schedule the popup.
    };
  }, []); // run exactly once at application root level

  // ── Exit intent: desktop only, once per session ───────────────────────────
  useEffect(() => {
    // Skip on touch-primary devices (unreliable on mobile)
    if (isTouchPrimaryDevice()) return;
    // Guard: module-level flag prevents double-attach in Strict Mode
    if (_exitListenerAttached) return;
    // Guard: sessionStorage flag prevents re-attach after remount
    if (sessionFlagGet(EXIT_SHOWN_KEY)) return;

    _exitListenerAttached = true;

    const handleMouseLeave = (e: MouseEvent) => {
      // Genuine exit intent: pointer leaves toward top (browser chrome).
      // clientY threshold: <= 10 px.
      if (e.clientY > 10) return;
      if (sessionFlagGet(EXIT_SHOWN_KEY)) return;

      sessionFlagSet(EXIT_SHOWN_KEY);
      setShowExit(true);
      trackEvent({
        tab: "CTA Interactions",
        event: "exit_intent_shown",
        value: "exit_intent",
      });
    };

    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      // Remove DOM listener on cleanup; module-level flag stays true so
      // Strict Mode's second mount does not re-attach.
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []); // run exactly once at application root level

  // ── Close handlers ────────────────────────────────────────────────────────
  const handleCloseEntry = () => setShowEntry(false);
  const handleCloseExit = () => setShowExit(false);

  return (
    <>
      {/* Keyframe injected once; scoped name avoids global collisions */}
      <style>{`
        @keyframes gn-popup-in {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
      `}</style>

      {showEntry && <EntryGreeting onClose={handleCloseEntry} />}
      {showExit && <ExitIntentPopup onClose={handleCloseExit} />}
    </>
  );
}
