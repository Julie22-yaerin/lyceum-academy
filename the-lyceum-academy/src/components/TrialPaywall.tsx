/**
 * TrialPaywall — shown when the 3-day trial expires and no paid subscription.
 * Offers Compass/Scholar/STEM Focus at 40% off for 14 days, or a heavily
 * limited Free tier as a no-payment fallback.
 */

import { useEffect, useState } from 'react';
import { createCheckoutSession, getSubscriptionPlans, type SubscriptionPlan } from '../lib/subscriptionApi';

interface Props {
  daysRemaining: number;
  onSubscribe: (tier: string) => void;
  onChooseFree: () => void;
}

const PROMO_DISCOUNT = 0.4;
const PROMO_DAYS = 14;
const PROMO_END_KEY = 'lyceum_promo_end';

function getPromoEnd(): number {
  const stored = localStorage.getItem(PROMO_END_KEY);
  if (stored) return Number(stored);
  const end = Date.now() + PROMO_DAYS * 24 * 60 * 60 * 1000;
  localStorage.setItem(PROMO_END_KEY, String(end));
  return end;
}

function useCountdown(endMs: number) {
  const [remaining, setRemaining] = useState(() => Math.max(0, endMs - Date.now()));
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, endMs - Date.now())), 1000);
    return () => clearInterval(id);
  }, [endMs]);
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return { days, hours, minutes, seconds, expired: remaining <= 0 };
}

const TIER_META: Record<string, { name: string; emoji: string; color: string; flagship?: boolean; features: string[] }> = {
  free: {
    name: 'Free',
    emoji: '🌾',
    color: '#6B7280',
    features: [
      '2 tool calls a day',
      'Access to every tool',
      '1 reverse-building hint',
      'Upload up to 2 documents a day',
    ],
  },
  compass: {
    name: 'Compass',
    emoji: '🧭',
    color: '#4A7C59',
    features: [
      '10 tool calls a day',
      '3 reverse-building hints per PDF',
      'Upload up to 3 documents a day',
    ],
  },
  scholar: {
    name: 'Scholar',
    emoji: '🎓',
    color: '#C5A059',
    flagship: true,
    features: [
      '2x Compass\'s daily tool calls (20/day)',
      '6 reverse-building hints per PDF',
      'Upload up to 5 documents a day',
      'Higher priority than Compass in the AI response queue',
    ],
  },
  mentor: {
    name: 'STEM Focus',
    emoji: '🎯',
    color: '#7C3AED',
    features: [
      '30 tool calls a day',
      'Upload up to 10 documents a day',
      'Higher priority than Scholar in the AI response queue',
      'Unlocks Ari voice assistant (5 calls a day)',
    ],
  },
};

const TIER_ORDER = ['free', 'compass', 'scholar', 'mentor'];

export default function TrialPaywall({ daysRemaining, onChooseFree }: Props) {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const countdown = useCountdown(getPromoEnd());

  useEffect(() => {
    getSubscriptionPlans()
      .then(all => setPlans(all.filter(p => p.billing_cycle === 'monthly' && TIER_ORDER.includes(p.tier))))
      .catch(() => setError('Could not load plans — please refresh.'))
      .finally(() => setLoading(false));
  }, []);

  const ordered = TIER_ORDER
    .map(tier => plans.find(p => p.tier === tier))
    .filter((p): p is SubscriptionPlan => !!p);

  async function handleSelect(plan: SubscriptionPlan) {
    if (plan.tier === 'free') {
      onChooseFree();
      return;
    }
    setError(''); setBusyId(plan.id);
    try {
      const { checkout_url } = await createCheckoutSession(plan.id, window.location.href, window.location.href);
      window.location.href = checkout_url;
    } catch (e: any) {
      setError(e?.message || 'Could not start checkout.');
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="glass-card rounded-3xl p-8 max-w-3xl w-full my-8 text-center">
        <div className="text-5xl mb-4">⏰</div>
        <h2 className="font-serif text-2xl text-white mb-2">Your free trial has ended</h2>
        <p className="text-sm text-white/50 mb-1">
          {daysRemaining <= 0
            ? 'Your 3-day trial has expired.'
            : `You have ${Math.max(0, Math.ceil(daysRemaining))} days left.`}
        </p>
        <p className="text-xs text-white/40 mb-4">Choose a plan to continue learning with The Lyceum — or stay on Free with reduced limits.</p>

        {!countdown.expired && (
          <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-2 mb-6 border border-amber-400/30">
            <span className="text-amber-300 text-xs font-semibold uppercase tracking-wider">40% off ends in</span>
            <span className="text-white text-sm font-mono tabular-nums">
              {countdown.days}d {String(countdown.hours).padStart(2, '0')}h {String(countdown.minutes).padStart(2, '0')}m {String(countdown.seconds).padStart(2, '0')}s
            </span>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-white/40 text-sm">Loading plans…</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {ordered.map(plan => {
              const meta = TIER_META[plan.tier];
              const isFree = plan.tier === 'free';
              const discounted = isFree || countdown.expired ? plan.price_usd : plan.price_usd * (1 - PROMO_DISCOUNT);

              return (
                <button
                  key={plan.id}
                  onClick={() => handleSelect(plan)}
                  disabled={busyId !== null}
                  className={`glass rounded-2xl p-4 flex flex-col items-center gap-2 border transition-all hover:scale-[1.03] ${
                    meta.flagship ? 'border-amber-400/40 shadow-lg shadow-amber-500/10' : 'border-white/10'
                  } ${busyId === plan.id ? 'opacity-50' : ''}`}
                >
                  <span className="text-3xl">{meta.emoji}</span>
                  <span className="text-sm font-medium text-white">{meta.name}</span>

                  {isFree ? (
                    <span className="text-lg font-bold text-white">Free</span>
                  ) : (
                    <div className="flex flex-col items-center">
                      {!countdown.expired && (
                        <span className="text-xs text-white/35 line-through">${plan.price_usd.toFixed(2)}/mo</span>
                      )}
                      <span className="text-lg font-bold text-white">
                        ${discounted.toFixed(2)}<span className="text-xs text-white/40">/mo</span>
                      </span>
                    </div>
                  )}

                  {meta.flagship && (
                    <span className="text-[8px] uppercase tracking-widest text-amber-300 bg-amber-400/10 rounded-full px-2 py-0.5">Popular</span>
                  )}
                  {!isFree && !countdown.expired && (
                    <span className="text-[8px] uppercase tracking-widest text-emerald-300 bg-emerald-400/10 rounded-full px-2 py-0.5">40% off</span>
                  )}

                  <ul className="text-[10px] text-white/40 text-left space-y-1 mt-1">
                    {meta.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-purple-300 mt-0.5">·</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {isFree && (
                    <span className="text-[9px] text-white/30 mt-1 uppercase tracking-wider">Continue with Free</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && <p className="text-xs text-red-300/80 mb-3">{error}</p>}

        <p className="text-[10px] text-white/25">Secure checkout via Stripe · Cancel anytime</p>
      </div>
    </div>
  );
}
