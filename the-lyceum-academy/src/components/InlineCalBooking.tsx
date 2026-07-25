/**
 * InlineCalBooking — the actual Cal.com scheduler embedded directly on the
 * page (not a popup) — used right after someone finishes the application
 * form, so booking a call is the obvious next step with zero extra clicks.
 */
import { useEffect, useId, useRef } from 'react';
import { CAL_LINK, CAL_NAMESPACE, ensureCalLoaded } from '../lib/calEmbed';

export default function InlineCalBooking({ className = '' }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rawId = useId();
  const elementId = `lyceum-cal-inline-${rawId.replace(/:/g, '')}`;

  useEffect(() => {
    ensureCalLoaded();
    const Cal = (window as any).Cal;
    if (!Cal?.ns?.[CAL_NAMESPACE]) return;
    Cal.ns[CAL_NAMESPACE]('inline', {
      elementOrSelector: `#${elementId}`,
      calLink: CAL_LINK,
      config: { layout: 'month_view' },
    });
  }, [elementId]);

  return (
    <div
      ref={containerRef}
      id={elementId}
      className={className}
      style={{ width: '100%', minHeight: '600px' }}
    />
  );
}
