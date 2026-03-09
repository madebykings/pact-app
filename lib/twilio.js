// lib/twilio.js
// Server-side Twilio WhatsApp helper.
// Never import this file from client-side code — it reads secret env vars.
//
// Required env vars:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WHATSAPP_FROM  — e.g. "whatsapp:+14155238886" (sandbox) or "whatsapp:+44..." (production)
//   WHATSAPP_ENABLED      — "true" to enable; anything else disables silently

/**
 * Returns true if WhatsApp messaging is configured and enabled.
 */
export function isTwilioEnabled() {
  return (
    process.env.WHATSAPP_ENABLED === "true" &&
    Boolean(process.env.TWILIO_ACCOUNT_SID) &&
    Boolean(process.env.TWILIO_AUTH_TOKEN) &&
    Boolean(process.env.TWILIO_WHATSAPP_FROM)
  );
}

/**
 * Send a WhatsApp message via the Twilio REST API.
 * Uses fetch rather than the Twilio SDK to avoid adding a dependency.
 *
 * @param {string} to   - E.164 phone number, e.g. "+447700900123"
 * @param {string} body - Message text (freeform in sandbox; use approved template body in production)
 * @returns {Promise<{ ok: boolean, sid?: string, error?: string }>}
 */
export async function sendWhatsApp(to, body) {
  if (!isTwilioEnabled()) {
    console.warn("sendWhatsApp: WhatsApp not enabled or Twilio not configured — skipping.");
    return { ok: false, error: "WhatsApp not enabled" };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"

  // Normalise the destination to whatsapp: prefixed format
  const toFormatted = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams();
  params.append("From", from);
  params.append("To", toFormatted);
  params.append("Body", body);

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("sendWhatsApp: Twilio error", data);
      return { ok: false, error: data?.message || `HTTP ${res.status}` };
    }

    return { ok: true, sid: data.sid };
  } catch (e) {
    console.error("sendWhatsApp: fetch failed", e);
    return { ok: false, error: e?.message || "fetch failed" };
  }
}

/**
 * Get the current HH:MM time in a given IANA timezone.
 * Used by the reminder cron to match reminder_times against local time.
 *
 * @param {string} timezone - IANA name e.g. "Europe/London"
 * @param {Date}   [now]    - defaults to new Date()
 * @returns {string} "HH:MM"
 */
export function localHHMM(timezone, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);

    const hour = parts.find((p) => p.type === "hour")?.value?.padStart(2, "0") ?? "00";
    const minute = parts.find((p) => p.type === "minute")?.value?.padStart(2, "0") ?? "00";
    return `${hour}:${minute}`;
  } catch {
    // Unknown timezone — fall back to UTC
    const h = String(now.getUTCHours()).padStart(2, "0");
    const m = String(now.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

/**
 * Return the current local hour (0–23) for a given timezone.
 * Used for hour-bucket matching in the hourly cron.
 */
export function localHour(timezone, now = new Date()) {
  return Number(localHHMM(timezone, now).split(":")[0]);
}
