// lib/onesignal.js
// OneSignal Web SDK v16 helper (prompt must be user-gesture driven)

let _sdkLoaded = false;
let _initPromise = null;
let _instance = null;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function loadSdkOnce() {
  if (!isBrowser()) return Promise.resolve(false);
  if (_sdkLoaded) return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    // already present
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

/**
 * v16 correct init:
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

    // Use the v16 queue
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

// Call this from a button click for best browser compatibility.
export async function promptForPush() {
  const os = await initSdk();
  if (!os) return null;

  try {
    // Permission can be "default" | "granted" | "denied"
    const permission =
      os?.Notifications?.permission ||
      (typeof Notification !== "undefined" ? Notification.permission : "default");

    if (permission === "denied") return null;

    if (permission === "default") {
      // v16 request permission
      await os.Notifications.requestPermission();
    }

    await os.User.PushSubscription.optIn();
    return await getSubscriptionIdSafe(os);
  } catch (e) {
    console.warn("push opt-in error:", e);
    return null;
  }
}

// Safe init that does NOT prompt
export async function initOneSignal() {
  const os = await initSdk();
  return await getSubscriptionIdSafe(os);
}
