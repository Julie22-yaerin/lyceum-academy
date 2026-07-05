import { ImgHTMLAttributes, useEffect, useState } from 'react';
import { proxiedImageUrl } from '../lib/api';

interface SmartImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError'> {
  src: string;
}

/**
 * External-image renderer with hotlink-block resilience:
 * 1. Try the direct URL with referrerPolicy="no-referrer" — defeats
 *    Referer-based hotlink protection with zero backend cost.
 * 2. On error, retry through the backend's /media/proxy (same-origin bytes,
 *    immune to opaque-response blocking and IP-based host blocks).
 * 3. If the proxy fails too, hide instead of showing a broken-image icon.
 */
export default function SmartImage({ src, ...rest }: SmartImageProps) {
  const [stage, setStage] = useState<'direct' | 'proxy' | 'hidden'>('direct');

  // New src (e.g. a recycled toast/card) restarts the fallback ladder.
  useEffect(() => { setStage('direct'); }, [src]);

  if (stage === 'hidden') return null;
  return (
    <img
      {...rest}
      src={stage === 'direct' ? src : proxiedImageUrl(src)}
      referrerPolicy="no-referrer"
      onError={() => setStage(s => (s === 'direct' ? 'proxy' : 'hidden'))}
    />
  );
}
