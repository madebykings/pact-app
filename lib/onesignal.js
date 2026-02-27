// lib/onesignal.js
// OneSignal Web SDK v16 helper.
// IMPORTANT: permission prompt MUST be triggered by a user gesture (button click).

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
  const iPadOS = ua.includes("Mac") && "ontouchend" in document;
  return iOS || iPadOS;
}

function isStandalonePWA() {
  if (!isBrowser()) return false;
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

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getSubscriptionIdSafe(os) {
  try {
    return (await os?.User?.PushSubscription?.getId?.()) || null;
  } catch {
    return null;
  }
}

function currentPermission(os) {
  return (
    os?.Notifications?.permission ||
    (typeof Notification !== "undefined" ? Notification.permission : "default")
  );
}

/**
 * Returns { ok, id, reason }
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
    let perm = currentPermission(os);

    if (perm === "denied") {
      return { ok: false, id: null, reason: "Push blocked/denied in browser settings." };
    }

    // Request permission if not yet granted.
    if (perm === "default") {
      // Must be called from a user gesture.
      await os.Notifications.requestPermission();
      perm = currentPermission(os);
    }

    if (perm !== "granted") {
      // default (dismissed) or denied
      return { ok: false, id: null, reason: "Push not enabled (permission not granted)." };
    }

    // Ensure opted-in at OneSignal level
    await os.User.PushSubscription.optIn();

    // Subscription id can lag right after opt-in
    let id = await getSubscriptionIdSafe(os);
    if (!id) {
      await sleep(350);
      id = await getSubscriptionIdSafe(os);
    }
    if (!id) {
      await sleep(650);
      id = await getSubscriptionIdSafe(os);
    }

    if (!id) {
      return { ok: false, id: null, reason: "Push enabled, but no subscription id returned yet. Try again." };
    }

    return { ok: true, id, reason: "Push enabled." };
  } catch (e) {
    console.warn("enablePush error:", e);
    return { ok: false, id: null, reason: e?.message || "Push enable failed." };
  }
}

export async function initOneSignal() {
  const os = await initSdk();
  return await getSubscriptionIdSafe(os);
}

export function onesignalHints() {
  return {
    isIOS: isIOS(),
    isStandalone: isStandalonePWA(),
  };
}
