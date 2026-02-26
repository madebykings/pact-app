export async function initOneSignal() {
  if (typeof window === "undefined") return null;

  const appId = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
  if (!appId) {
    console.log("No OneSignal App ID found");
    return null;
  }

  window.OneSignal = window.OneSignal || [];

  await new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.defer = true;
    script.onload = resolve;
    document.head.appendChild(script);
  });

  await window.OneSignal.push(async function () {
    await window.OneSignal.init({
      appId,
      notifyButton: { enable: false },
    });
  });

  try {
    const subscription = await window.OneSignal.User.PushSubscription.getId();
    return subscription;
  } catch (e) {
    console.log("Push subscription error", e);
    return null;
  }
}
