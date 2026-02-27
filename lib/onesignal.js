// lib/onesignal.js
// OneSignal Web SDK v16 helper.
// IMPORTANT: The permission prompt MUST be triggered by a user gesture (button click).
//
// This file is intentionally "client-only" safe (no SSR usage).

let _sdkLoaded = false;
let _initPromise = null;
let _instance = null;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function isIOS() {
  if (!isBrowser()) return false;
  const ua = window.navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; detect touch + mac
  const iPadOS = ua.includes("Mac") && "ontouchend" in document;
  return iOS || iPadOS;
}

function isStandalonePWA() {
  if (!isBrowser()) return false;
  // iOS Safari: navigator.standalone
  // Other browsers: display-mode
  // NOTE: iOS push requires PWA installed.
  // eslint-disable-next-line no-undef
  return Boolean(window.navigator.standalone) || window.matchMedia?.("(display-mode: standalone)")?.matches;
}

function loadSdkOnce() {
  if (!isBrowser()) return Promise.resolve(false);
  if (_sdkLoaded) return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src*="OneSignalSDK.page.js"]')) {
      _sdkLoaded = true;
      resolve(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      _sdkLoaded = true;
      resolve(true);
    };
    script.onerror = () => reject(new Error("Failed to load OneSignal SDK"));
    document.head.appendChild(script);
  });
}

/**
 * v16 init:
 * window.OneSignalDeferred = window.OneSignalDeferred || [];
 * OneSignalDeferred.push(async (OneSignal) => { await OneSignal.init(...) })
 */
async function initSdk() {
  if (!isBrowser()) return null;

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  if (!appId) return null;

  if (_instance) return _instance;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    await loadSdkOnce();

    window.OneSignalDeferred = window.OneSignalDeferred || [];

    await new Promise((resolve) => {
      window.OneSignalDeferred.push(async (OneSignal) => {
        try {
          await OneSignal.init({
            appId,
            notifyButton: { enable: false },
          });
          _instance = OneSignal;
        } catch (e) {
          console.warn("OneSignal init error:", e);
          _instance = null;
        } finally {
          resolve(true);
        }
      });
    });

    return _instance;
  })();

  return _initPromise;
}

async function getSubscriptionIdSafe(os) {
  try {
    return (await os?.User?.PushSubscription?.getId?.()) || null;
  } catch {
    return null;
  }
}

/**
 * Returns { ok, id, reason }
 * - ok: boolean
 * - id: OneSignal subscription id (player id)
 * - reason: human readable string for UI
 */
export async function enablePush() {
  const os = await initSdk();
  if (!os) return { ok: false, id: null, reason: "Push not configured (missing OneSignal app id)." };

  // iOS requires installed PWA for web push
  if (isIOS() && !isStandalonePWA()) {
    return {
      ok: false,
      id: null,
      reason: "On iPhone/iPad you must 'Add to Home Screen' (PWA) before push can work.",
    };
  }

  try {
    const permission =
      os?.Notifications?.permission ||
      (typeof Notification !== "undefined" ? Notification.permission : "default");

    if (permission === "denied") {
      return { ok: false, id: null, reason: "Push blocked/denied in browser settings." };
    }

    if (permission === "default") {
      await os.Notifications.requestPermission();
    }

    // If the user dismissed, browser may still be default/denied
    const after =
      os?.Notifications?.permission ||
      (typeof Notification !== "undefined" ? Notification.permission : "default");
    if (after !== "granted") {
      return { ok: false, id: null, reason: "Push not enabled (permission not granted)." };
    }

    await os.User.PushSubscription.optIn();
    const id = await getSubscriptionIdSafe(os);
    if (!id) return { ok: false, id: null, reason: "Push enabled, but no subscription id returned yet. Try again." };

    return { ok: true, id, reason: "Push enabled." };
  } catch (e) {
    console.warn("enablePush error:", e);
    return { ok: false, id: null, reason: e?.message || "Push enable failed." };
  }
}

// Safe init that does NOT prompt; returns subscription id or null.
export async function initOneSignal() {
  const os = await initSdk();
  return await getSubscriptionIdSafe(os);
}

// Expose helpers for UI messaging
export function onesignalHints() {
  return {
    isIOS: isIOS(),
    isStandalone: isStandalonePWA(),
  };
}
