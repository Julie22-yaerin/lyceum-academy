/**
 * Shared Cal.com embed loader for The Lyceum. Used by both BookCallButton
 * (popup, element-click embed) and InlineCalBooking (embedded calendar,
 * no click required) so the script/namespace init only happens once no
 * matter which one mounts first.
 *
 * Cal link: nhu-y-pham-aliana-afiwbr/thelyceum.site (namespace "thelyceum.site").
 */

export const CAL_NAMESPACE = 'thelyceum.site';
export const CAL_LINK = 'nhu-y-pham-aliana-afiwbr/thelyceum.site';

export function ensureCalLoaded(): void {
  const w = window as any;
  if (w.__lyceumCalInit) return;
  w.__lyceumCalInit = true;

  /* eslint-disable */
  (function (C: any, A: string, L: string) {
    const p = function (a: any, ar: any) { a.q.push(ar); };
    const d = C.document;
    C.Cal = C.Cal || function () {
      const cal = C.Cal; const ar = arguments;
      if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement('script')).src = A; cal.loaded = true; }
      if (ar[0] === L) {
        const api: any = function () { p(api, arguments); };
        const namespace = ar[1]; api.q = api.q || [];
        if (typeof namespace === 'string') { cal.ns[namespace] = cal.ns[namespace] || api; p(cal.ns[namespace], ar); p(cal, ['initNamespace', namespace]); }
        else p(cal, ar);
        return;
      }
      p(cal, ar);
    };
  })(window, 'https://app.cal.com/embed/embed.js', 'init');
  /* eslint-enable */

  const Cal = (window as any).Cal;
  Cal('init', CAL_NAMESPACE, { origin: 'https://app.cal.com' });
  Cal.config = Cal.config || {};
  Cal.config.forwardQueryParams = true;
  Cal.ns[CAL_NAMESPACE]('ui', { hideEventTypeDetails: false, layout: 'month_view' });
}
