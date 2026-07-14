/**
 * TrialPaywall — shown when the 3-day trial expires and no paid subscription.
 * Blocks access to the app until the user subscribes.
 */

import { useState } from 'react';
import { createCheckoutSession } from '../lib/subscriptionApi';

interface Props {
  daysRemaining: number;
  onSubscribe: (tier: string) => void;
}

const PLANS = [
  { id: 'compass', name: 'Compass', price: 5, emoji: '🌱', color: '#4A7C59',
    features: ['Study roadmap', 'Neural Map', 'Progress tracking'] },
  { id: 'scholar', name: 'Scholar', price: 8, emoji: '🎓', color: '#C5A059',
    features: ['AI grading', 'Full Neural Map', 'AI discussion', 'Roadmap'], flagship: true },
  { id: 'focus', name: 'Focus', price: 12, emoji: '🎯', color: '#7C3AED',
    features: ['Everything in Scholar', 'Advanced knowledge graph', 'Priority support'] },
];

export default function TrialPaywall({ daysRemaining, onSubscribe }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleSelect(planId: string) {
    setError(''); setBusyId(planId);
    try {
      const { checkout_url } = await createCheckoutSession(planId, window.location.href, window.location.href);
      window.location.href = checkout_url;
    } catch (e: any) {
      setError(e?.message || 'Could not start checkout.');
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className="glass-card rounded-3xl p-8 max-w-lg w-full mx-4 text-center">
        <div className="text-5xl mb-4">⏰</div>
        <h2 className="font-serif text-2xl text-white mb-2">Your free trial has ended</h2>
        <p className="text-sm text-white/50 mb-1">
          {daysRemaining <= 0
            ? 'Your 3-day trial has expired.'
            : `You have ${Math.max(0, Math.ceil(daysRemaining))} days left.`}
        </p>
        <p className="text-xs text-white/40 mb-6">Choose a plan to continue learning with The Lyceum.</p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {PLANS.map(p => (
            <button
              key={p.id}
              onClick={() => handleSelect(p.id)}
              disabled={busyId !== null}
              className={`glass rounded-2xl p-4 flex flex-col items-center gap-2 border transition-all hover:scale-[1.03] ${
                p.flagship ? 'border-amber-400/40 shadow-lg shadow-amber-500/10' : 'border-white/10'
              } ${busyId === p.id ? 'opacity-50' : ''}`}
            >
              <span className="text-3xl">{p.emoji}</span>
              <span className="text-sm font-medium text-white">{p.name}</span>
              <span className="text-lg font-bold text-white">${p.price}<span className="text-xs text-white/40">/mo</span></span>
              {p.flagship && (
                <span className="text-[8px] uppercase tracking-widest text-amber-300 bg-amber-400/10 rounded-full px-2 py-0.5">Popular</span>
              )}
              <ul className="text-[10px] text-white/40 text-left space-y-1 mt-1">
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <span className="text-purple-300 mt-0.5">·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-300/80 mb-3">{error}</p>}

        <p className="text-[10px] text-white/25">Secure checkout via Stripe · Cancel anytime</p>
      </div>
    </div>
  );
}
