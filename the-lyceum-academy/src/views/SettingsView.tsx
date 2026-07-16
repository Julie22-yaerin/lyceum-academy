import { useEffect, useState } from 'react';
import { useTranslation, type AppLanguage } from '../i18n/I18nContext';
import { LANGUAGES } from '../i18n/translations';
import { useTheme, type AppTheme } from '../context/ThemeContext';
import {
  getCurrentSubscription, getSubscriptionPlans, createPortalSession, createCheckoutSession,
  type CurrentSubscription, type SubscriptionPlan,
} from '../lib/subscriptionApi';
import { getLemonCheckoutUrl } from '../lib/lemonsqueezy';

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  compass: 'Compass',
  scholar: 'Scholar',
  mentor: 'STEM Focus',
  researcher: 'Researcher',
};

function LanguageSection() {
  const { lang, setLang, t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  const visibleLangs = showAll ? LANGUAGES : LANGUAGES.slice(0, 8);

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">{t('settings.language')}</p>
      <p className="text-xs text-white/30 mb-5">{t('settings.languageDesc')}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {visibleLangs.map(l => (
          <button
            key={l.code}
            onClick={() => setLang(l.code as AppLanguage)}
            className={`flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm transition-all ${
              lang === l.code ? 'glass-pill-active shadow-lg shadow-purple-500/10' : 'glass-pill'
            }`}
          >
            <span className="text-lg">{l.flag}</span>
            <div className="text-left min-w-0">
              <div className="text-xs font-medium truncate">{l.label}</div>
              <div className="text-[9px] text-white/30 uppercase">{l.code}</div>
            </div>
            {lang === l.code && (
              <span className="ml-auto material-symbols-outlined text-[14px] text-purple-300">check</span>
            )}
          </button>
        ))}
      </div>

      {LANGUAGES.length > 8 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-3 text-[10px] text-white/30 hover:text-white/60 transition-colors uppercase tracking-wider"
        >
          {showAll ? '← Show less' : `+ ${LANGUAGES.length - 8} more languages`}
        </button>
      )}
    </div>
  );
}

const THEME_OPTIONS: { value: AppTheme; label: string; icon: string }[] = [
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
];

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">{t('settings.appearance')}</p>
      <p className="text-xs text-white/30 mb-5">{t('settings.appearanceDesc')}</p>
      <div className="flex gap-3">
        {THEME_OPTIONS.map(({ value, label, icon }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm transition-colors ${
              theme === value ? 'glass-pill-active' : 'glass-pill'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
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
  const { t } = useTranslation();

  useEffect(() => {
    (async () => {
      try {
        const [subResult, planList] = await Promise.allSettled([getCurrentSubscription(), getSubscriptionPlans()]);
        if (subResult.status === 'fulfilled') setSub(subResult.value);
        if (planList.status === 'fulfilled') {
          // Free (no-payment fallback tier) and Researcher (unreleased, hidden) don't belong in the upgrade list.
          setPlans(planList.value.filter(p => p.tier !== 'free' && p.tier !== 'researcher'));
        }
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
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">{t('settings.plan')}</p>

      {loading ? (
        <div className="flex items-center gap-3 py-4">
          <div className="w-3 h-3 border border-white/20 border-t-white rounded-full animate-spin" />
          <span className="text-xs text-white/40">{t('common.loading')}</span>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-lg font-semibold text-white">
                {sub ? (TIER_LABELS[sub.tier] || sub.tier) : 'Free'}
              </p>
              {sub && (
                <p className="text-[11px] text-white/40 mt-0.5">
                  {sub.status === 'active' ? t('settings.active') : sub.status}
                  {sub.current_period_end && ` · ${t('settings.renews')} ${new Date(sub.current_period_end).toLocaleDateString()}`}
                </p>
              )}
            </div>
            {sub && (
              <button
                onClick={handleManageBilling}
                className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px]"
              >
                {t('settings.manageBilling')}
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-300/80 mb-4">{error}</p>}

          {plans.length > 0 && (
            <div className="flex flex-col gap-2">
              {plans.map(p => {
                const isCurrent = sub?.tier === p.tier && sub?.billing_cycle === p.billing_cycle;
                const lemonUrl = getLemonCheckoutUrl(p.tier, p.billing_cycle);
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 ${
                      isCurrent ? 'glass-pill-active' : 'glass-pill'
                    }`}
                  >
                    <div>
                      <p className="text-sm text-white/85">{TIER_LABELS[p.tier] || p.tier}</p>
                      <p className="text-[10px] text-white/40">${p.price_usd}/{p.billing_cycle === 'annual' ? 'yr' : 'mo'}</p>
                    </div>
                    {isCurrent ? (
                      <span className="text-[10px] uppercase tracking-[2px] text-purple-300">{t('tier.current')}</span>
                    ) : lemonUrl ? (
                      <a
                        href={lemonUrl}
                        className="lemonsqueezy-button glass-btn rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[2px] inline-block"
                      >
                        {t('tier.select')}
                      </a>
                    ) : (
                      <button
                        onClick={() => handleUpgrade(p.id)}
                        disabled={busyPlanId === p.id}
                        className="glass-btn rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[2px] disabled:opacity-30"
                      >
                        {busyPlanId === p.id ? '…' : t('tier.select')}
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
  const { t } = useTranslation();

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 py-4">
      <div>
        <h1 className="font-serif text-3xl text-white mb-1">{t('settings.title')}</h1>
        <p className="text-sm text-white/40">{t('settings.subtitle')}</p>
      </div>
      <AppearanceSection />
      <LanguageSection />
      <PlanSection />
    </div>
  );
}
