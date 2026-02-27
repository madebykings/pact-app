// lib/onesignal.js
/**
 * OneSignal Web SDK v16 helper
 * - Loads SDK once
 * - Initializes
 * - Can prompt + opt-in (so the browser prompt actually appears)
 * - Returns push subscription id (player/subscription id)
 */

let _sdkLoaded = false;
let _initPromise = null;

function loadSdkOnce() {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (_sdkLoaded) return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    // If script already exists, resolve
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
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initSdk() {
  if (typeof window === "undefined") return null;

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  if (!appId) {
    console.log("No OneSignal App ID found");
    return null;
  }

  await loadSdkOnce();

  window.OneSignal = window.OneSignal || [];

  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve) => {
    window.OneSignal.push(async () => {
      try {
        await window.OneSignal.init({
          appId,
          notifyButton: { enable: false },
          // Leave service worker defaults — you’re serving:
          // /OneSignalSDKWorker.js and /OneSignalSDKUpdaterWorker.js
        });
      } catch (e) {
        console.log("OneSignal init error", e);
      } finally {
        resolve(true);
      }
    });
  });

  await _initPromise;
  return window.OneSignal;
}

async function getSubscriptionIdSafe() {
  try {
    const id = await window.OneSignal?.User?.PushSubscription?.getId?.();
    return id || null;
  } catch {
    return null;
  }
}

async function ensureOptIn({ forcePrompt = false } = {}) {
  // forcePrompt: if true, will request permission again (browser may still block if previously denied)
  const os = await initSdk();
  if (!os) return null;

  // If we already have a subscription id, we’re “subscribed”
  const existing = await getSubscriptionIdSafe();
  if (existing) return existing;

  try {
    const permission =
      window.OneSignal?.Notifications?.permission ||
      Notification?.permission ||
      "default";

    // Don’t spam prompts: store a simple flag
    const key = "pact_push_prompted_v1";
    const alreadyPrompted = localStorage.getItem(key) === "1";

    // If denied, do not repeatedly prompt (browser won’t show it anyway)
    if (permission === "denied") {
      return null;
    }

    // Request permission if needed.
    // If user never sees a prompt, it’s usually because:
    // - Not HTTPS (must be HTTPS) ✅ you are
    // - Not triggered by a user gesture (some browsers are strict)
    // So we call this from a button click in the UI.
    if (permission === "default" && (forcePrompt || !alreadyPrompted)) {
      localStorage.setItem(key, "1");
      await window.OneSignal.Notifications.requestPermission();
    }

    // Opt in subscription
    // v16: optIn() exists on PushSubscription
    await window.OneSignal.User.PushSubscription.optIn();

    // Fetch id after opt-in
    const id = await getSubscriptionIdSafe();
    return id || null;
  } catch (e) {
    console.log("OneSignal opt-in error", e);
    return null;
  }
}

/**
 * initOneSignal()
 * - Initializes the SDK
 * - Optionally prompts/opts-in (must be called from a user action for best results)
 * - Returns subscription id (or null)
 */
export async function initOneSignal({ prompt = false } = {}) {
  await initSdk();
  if (prompt) {
    return await ensureOptIn({ forcePrompt: true });
  }
  return await getSubscriptionIdSafe();
}

/**
 * Call from a button click to actually show the browser prompt.
 */
export async function promptForPush() {
  return await ensureOptIn({ forcePrompt: true });
}
