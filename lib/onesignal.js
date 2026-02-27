// lib/onesignal.js
// OneSignal Web SDK v16 helper (prompt must be user-gesture driven)

let _sdkLoaded = false;
let _initPromise = null;

function loadSdkOnce() {
  if (typeof window === "undefined") return Promise.resolve(false);
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
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initSdk() {
  if (typeof window === "undefined") return null;

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  if (!appId) return null;

  await loadSdkOnce();

  window.OneSignal = window.OneSignal || [];
  if (_initPromise) return _initPromise;

  _initPromise = new Promise((resolve) => {
    window.OneSignal.push(async () => {
      try {
        await window.OneSignal.init({
          appId,
          notifyButton: { enable: false },
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
    return (await window.OneSignal?.User?.PushSubscription?.getId?.()) || null;
  } catch {
    return null;
  }
}

// Call this from a button click for best browser compatibility.
export async function promptForPush() {
  const os = await initSdk();
  if (!os) return null;

  try {
    const permission =
      window.OneSignal?.Notifications?.permission ||
      Notification?.permission ||
      "default";

    if (permission === "denied") return null;

    if (permission === "default") {
      await window.OneSignal.Notifications.requestPermission();
    }

    await window.OneSignal.User.PushSubscription.optIn();

    return await getSubscriptionIdSafe();
  } catch (e) {
    console.log("push opt-in error", e);
    return null;
  }
}

// Safe init that does NOT prompt
export async function initOneSignal() {
  await initSdk();
  return await getSubscriptionIdSafe();
}
