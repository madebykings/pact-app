export async function initOneSignal() {
  if (typeof window === "undefined") return null;

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  if (!appId) return null;

  // Load OneSignal SDK
  if (!window.OneSignal) {
    await new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdn.onesignal.com/sdks/OneSignalSDK.js";
      s.async = true;
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  window.OneSignal = window.OneSignal || [];
  window.OneSignal.push(function () {
    window.OneSignal.init({
      appId,
      allowLocalhostAsSecureOrigin: true,
      notifyButton: { enable: false },
    });
  });

  const playerId = await new Promise((resolve) => {
    window.OneSignal.push(async function () {
      const perm = await window.OneSignal.getNotificationPermission();
      if (perm !== "granted") await window.OneSignal.showNativePrompt();
      const id = await window.OneSignal.getUserId();
      resolve(id);
    });
  });

  return playerId;
}