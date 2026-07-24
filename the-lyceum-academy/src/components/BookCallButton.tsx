/**
 * BookCallButton — opens the Cal.com scheduling popup for The Lyceum.
 * Loads the Cal embed script once (element-click embed), then any element
 * carrying the data-cal-* attributes opens the month-view booking modal.
 *
 * Cal link: nhu-y-pham-aliana-afiwbr/thelyceum.site (namespace "thelyceum.site").
 */
import { useEffect } from 'react';

const CAL_NAMESPACE = 'thelyceum.site';
const CAL_LINK = 'nhu-y-pham-aliana-afiwbr/thelyceum.site';

// Load + initialise the Cal embed exactly once per page.
function ensureCalLoaded() {
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

interface Props {
  label?: string;
  className?: string;
}

export default function BookCallButton({ label = 'Book a call', className = '' }: Props) {
  useEffect(() => { ensureCalLoaded(); }, []);

  return (
    <button
      type="button"
      data-cal-link={CAL_LINK}
      data-cal-namespace={CAL_NAMESPACE}
      data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
      className={className || 'text-sm font-medium text-slate-300 hover:text-white transition-colors'}
    >
      {label}
    </button>
  );
}
