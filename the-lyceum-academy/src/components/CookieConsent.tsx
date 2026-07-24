/**
 * CookieConsent — a first-visit banner asking permission to use cookies.
 * Self-contained (no context/provider needed): it stores the choice in
 * localStorage and hides once a decision is made. "Decline" keeps only the
 * strictly-necessary storage the app needs to function; "Accept" records
 * consent for analytics/preference cookies.
 *
 * Other code can read the decision via `cookieConsentGranted()`.
 */
import { useEffect, useState } from 'react';

const KEY = 'lyceum_cookie_consent_v1';

export function cookieConsentGranted(): boolean {
  try { return localStorage.getItem(KEY) === 'accepted'; } catch { return false; }
}

export default function CookieConsent() {
  const [decided, setDecided] = useState(true); // assume decided until we check

  useEffect(() => {
    try { setDecided(localStorage.getItem(KEY) !== null); } catch { setDecided(true); }
  }, []);

  function choose(v: 'accepted' | 'declined') {
    try { localStorage.setItem(KEY, v); } catch { /* ignore */ }
    setDecided(true);
  }

  if (decided) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[300] p-4 flex justify-center pointer-events-none">
      <div className="pointer-events-auto glass-card rounded-2xl max-w-2xl w-full p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <p className="text-xs text-white/70 leading-relaxed flex-1">
          Chúng tôi dùng cookie để giữ bạn đăng nhập và cải thiện trải nghiệm.
          Bạn có thể từ chối cookie không bắt buộc. Xem{' '}
          <a href="/privacy" className="underline hover:text-white/90">Chính sách quyền riêng tư</a>.
        </p>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => choose('declined')}
            className="rounded-xl px-4 py-2 text-[11px] uppercase tracking-[2px] bg-white/10 text-white/60 hover:bg-white/20 transition-colors"
          >
            Từ chối
          </button>
          <button
            onClick={() => choose('accepted')}
            className="rounded-xl px-4 py-2 text-[11px] uppercase tracking-[2px] bg-white/85 text-black hover:bg-white transition-colors"
          >
            Đồng ý
          </button>
        </div>
      </div>
    </div>
  );
}
