/**
 * Google reCAPTCHA v3 — loaded lazily and only if VITE_RECAPTCHA_SITE_KEY is
 * set, so the app doesn't pull in Google's script (or send any traffic to
 * Google) until bot protection is actually configured.
 */

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

const SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY as string | undefined;

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.grecaptcha) { resolve(); return; }
    const s = document.createElement('script');
    s.src = `https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load reCAPTCHA'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Returns a reCAPTCHA v3 token for the given action (e.g. 'login', 'signup'),
 * or null if reCAPTCHA isn't configured / fails to load — callers should
 * treat null as "send no token" rather than blocking the user.
 */
export async function getRecaptchaToken(action: string): Promise<string | null> {
  if (!SITE_KEY) return null;
  try {
    await loadScript();
    return await new Promise<string | null>((resolve) => {
      window.grecaptcha!.ready(() => {
        window.grecaptcha!.execute(SITE_KEY, { action }).then(resolve).catch(() => resolve(null));
      });
    });
  } catch {
    return null;
  }
}
