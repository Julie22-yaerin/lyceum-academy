/**
 * BookCallButton — opens the Cal.com scheduling popup for The Lyceum.
 * Any element carrying the data-cal-* attributes opens the month-view
 * booking modal. See src/lib/calEmbed.ts for the shared script loader.
 */
import { useEffect, type ReactNode } from 'react';
import { CAL_LINK, CAL_NAMESPACE, ensureCalLoaded } from '../lib/calEmbed';

interface Props {
  label?: string;
  className?: string;
  children?: ReactNode;
}

export default function BookCallButton({ label = 'Book a call', className = '', children }: Props) {
  useEffect(() => { ensureCalLoaded(); }, []);

  return (
    <button
      type="button"
      data-cal-link={CAL_LINK}
      data-cal-namespace={CAL_NAMESPACE}
      data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
      className={className || 'text-sm font-medium text-slate-300 hover:text-white transition-colors'}
    >
      {children ?? label}
    </button>
  );
}
