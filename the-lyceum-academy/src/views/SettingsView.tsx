import { useEffect, useState } from 'react';
import { detectLocale, saveLocale, setDocumentLocale, getSupportedLocales, getLocaleDisplayName, type AppLocale } from '../lib/locale';
import { useTheme, type AppTheme } from '../context/ThemeContext';
import {
  getCurrentSubscription, getSubscriptionPlans, createPortalSession, createCheckoutSession,
  type CurrentSubscription, type SubscriptionPlan,
} from '../lib/subscriptionApi';

const TIER_LABELS: Record<string, string> = {
  compass: 'Compass (Free)',
  scholar: 'Scholar',
  mentor: 'Mentor',
  researcher: 'Researcher',
};

function LanguageSection() {
  const [locale, setLocale] = useState<AppLocale>(() => detectLocale());

  function pick(next: AppLocale) {
    if (next === locale) return;
    saveLocale(next);
    setDocumentLocale(next);
    setLocale(next);
    // No app-wide i18n context exists yet — a reload is the honest way to
    // make every already-mounted component (ARI's voice session included)
    // pick up the new language consistently.
    window.location.reload();
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Language</p>
      <p className="text-xs text-white/30 mb-5">Applies to ARI's voice and the site chrome. Detected automatically from your device — switch anytime.</p>
      <div className="flex gap-3">
        {getSupportedLocales().map(l => (
          <button
            key={l}
            onClick={() => pick(l)}
            className={`flex-1 rounded-xl px-4 py-3 text-sm border transition-colors ${
              locale === l
                ? 'border-purple-400/60 bg-purple-400/10 text-white'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]'
            }`}
          >
            {getLocaleDisplayName(l)}
          </button>
        ))}
      </div>
    </div>
  );
}

const THEME_OPTIONS: { value: AppTheme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Appearance</p>
      <p className="text-xs text-white/30 mb-5">Applies everywhere — the landing page and the workspace.</p>
      <div className="flex gap-3">
        {THEME_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`flex-1 rounded-xl px-4 py-3 text-sm border transition-colors ${
              theme === value
                ? 'border-purple-400/60 bg-purple-400/10 text-white'
                : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.06]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanSection() {
  const [sub, setSub] = useState<CurrentSubscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [subResult, planList] = await Promise.allSettled([getCurrentSubscription(), getSubscriptionPlans()]);
        if (subResult.status === 'fulfilled') setSub(subResult.value);
        if (planList.status === 'fulfilled') setPlans(planList.value);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleManageBilling() {
    setError('');
    try {
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch (e: any) {
      setError(e?.message || 'Could not open billing portal.');
    }
  }

  async function handleUpgrade(planId: string) {
    setError(''); setBusyPlanId(planId);
    try {
      const { checkout_url } = await createCheckoutSession(planId, window.location.href, window.location.href);
      window.location.href = checkout_url;
    } catch (e: any) {
      setError(e?.message || 'Could not start checkout.');
      setBusyPlanId(null);
    }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Plan</p>

      {loading ? (
        <div className="flex items-center gap-3 py-4">
          <div className="w-3 h-3 border border-white/20 border-t-white rounded-full animate-spin" />
          <span className="text-xs text-white/40">Loading…</span>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-lg font-semibold text-white">
                {sub ? (TIER_LABELS[sub.tier] || sub.tier) : 'Compass (Free)'}
              </p>
              {sub && (
                <p className="text-[11px] text-white/40 mt-0.5">
                  {sub.status === 'active' ? 'Active' : sub.status}
                  {sub.current_period_end && ` · renews ${new Date(sub.current_period_end).toLocaleDateString()}`}
                </p>
              )}
            </div>
            {sub && (
              <button
                onClick={handleManageBilling}
                className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px]"
              >
                Manage billing
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-300/80 mb-4">{error}</p>}

          {plans.length > 0 && (
            <div className="flex flex-col gap-2">
              {plans.map(p => {
                const isCurrent = sub?.tier === p.tier && sub?.billing_cycle === p.billing_cycle;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 border ${
                      isCurrent ? 'border-purple-400/40 bg-purple-400/5' : 'border-white/10 bg-white/[0.03]'
                    }`}
                  >
                    <div>
                      <p className="text-sm text-white/85">{TIER_LABELS[p.tier] || p.tier}</p>
                      <p className="text-[10px] text-white/40">${p.price_usd}/{p.billing_cycle === 'annual' ? 'yr' : 'mo'}</p>
                    </div>
                    {isCurrent ? (
                      <span className="text-[10px] uppercase tracking-[2px] text-purple-300">Current</span>
                    ) : (
                      <button
                        onClick={() => handleUpgrade(p.id)}
                        disabled={busyPlanId === p.id}
                        className="glass-btn rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[2px] disabled:opacity-30"
                      >
                        {busyPlanId === p.id ? '…' : 'Select'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SettingsView() {
  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 py-4">
      <div>
        <h1 className="font-serif text-3xl text-white mb-1">Settings</h1>
        <p className="text-sm text-white/40">Appearance, language, and your Lyceum plan.</p>
      </div>
      <AppearanceSection />
      <LanguageSection />
      <PlanSection />
    </div>
  );
}
