/**
 * TrialPaywall — shown when the 3-day trial expires and no plan is selected.
 * Presents the Quanta-denominated plan catalog (E-Lite / Basic / Plus /
 * Intense, monthly or yearly). Choosing a plan records it server-side; no
 * USD price is computed here — billing is wired up separately.
 */

import { useEffect, useState } from 'react';
import { getPlanCatalog, selectPlan, type LyceumPlan } from '../lib/lyceumApi';
import { useTranslation } from '../i18n/I18nContext';

interface Props {
  daysRemaining: number;
  onSubscribe: (tier: string) => void;
  onChooseFree: () => void;
  /** Present only when opened voluntarily (e.g. from Settings, mid-trial) —
   * renders a close button instead of forcing a plan/Free decision. */
  onClose?: () => void;
}

const PLAN_EMOJI_FALLBACK = '✦';

export default function TrialPaywall({ daysRemaining, onSubscribe, onChooseFree, onClose }: Props) {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<LyceumPlan[]>([]);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPlanCatalog()
      .then(c => setPlans(c.plans.filter(p => p.kind === 'personal')))
      .catch(() => setError(t('paywall.couldNotLoad')))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelect(plan: LyceumPlan) {
    setError(''); setBusyId(plan.id);
    try {
      await selectPlan(plan.id, cycle);
      localStorage.setItem('lyceum_plan', plan.id);
      onSubscribe(plan.id);
      // Selecting any plan unblocks the workspace.
      onChooseFree();
    } catch (e: any) {
      setError(e?.message || t('paywall.couldNotCheckout'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="glass-card rounded-3xl p-8 max-w-3xl w-full my-8 text-center relative">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full glass-pill transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        )}
        <div className="text-5xl mb-4">{daysRemaining <= 0 ? '⏰' : '🚀'}</div>
        <h2 className="font-serif text-2xl text-white mb-2">
          {daysRemaining <= 0 ? t('paywall.trialEnded') : t('paywall.upgradePlan')}
        </h2>
        <p className="text-sm text-white/50 mb-1">
          {daysRemaining <= 0
            ? t('paywall.trialExpired')
            : t('paywall.trialRemaining', { n: Math.max(0, Math.ceil(daysRemaining)) })}
        </p>
        <p className="text-xs text-white/40 mb-6">{t('paywall.choosePlan')}</p>

        <div className="flex items-center justify-center gap-1 mb-6">
          <button
            onClick={() => setCycle('monthly')}
            className={`rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-all ${cycle === 'monthly' ? 'glass-pill-active' : 'glass-pill'}`}
          >
            {t('paywall.monthly')}
          </button>
          <button
            onClick={() => setCycle('annual')}
            className={`rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-wider transition-all ${cycle === 'annual' ? 'glass-pill-active' : 'glass-pill'}`}
          >
            {t('paywall.yearly')}
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-white/40 text-sm">{t('paywall.loadingPlans')}</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {plans.map(plan => {
              const flagship = plan.id === 'plus';
              return (
                <button
                  key={plan.id}
                  onClick={() => handleSelect(plan)}
                  disabled={busyId !== null}
                  className={`glass rounded-2xl p-4 flex flex-col items-center gap-2 border transition-all hover:scale-[1.03] ${
                    flagship ? 'border-amber-400/40 shadow-lg shadow-amber-500/10' : 'border-white/10'
                  } ${busyId === plan.id ? 'opacity-50' : ''}`}
                >
                  <span className="text-3xl">{plan.emoji || PLAN_EMOJI_FALLBACK}</span>
                  <span className="text-sm font-medium text-white">{plan.name}</span>
                  <span className="text-lg font-bold text-white">
                    ⚡ {plan.standard_quanta.toLocaleString()}
                    <span className="text-xs text-white/40">/mo</span>
                  </span>
                  {flagship && (
                    <span className="text-[8px] uppercase tracking-widest text-amber-300 bg-amber-400/10 rounded-full px-2 py-0.5">{t('paywall.popular')}</span>
                  )}
                  <ul className="text-[10px] text-white/40 text-left space-y-1 mt-1">
                    <li>· {plan.standard_quanta.toLocaleString()} Quanta for every tool</li>
                    <li>· {plan.coach_quanta.toLocaleString()} Coach Quanta</li>
                    <li>· 1 Quanta = 5 tokens</li>
                    <li>· Billed {cycle === 'annual' ? 'yearly' : 'monthly'}</li>
                  </ul>
                </button>
              );
            })}
          </div>
        )}

        <button
          onClick={onChooseFree}
          className="text-[10px] uppercase tracking-[2px] text-white/35 hover:text-white/70 transition-colors mb-3"
        >
          {t('paywall.continueFree')}
        </button>

        {error && <p className="text-xs text-red-300/80 mb-3">{error}</p>}

        <p className="text-[10px] text-white/25">Team plan (3 seats, shared workspace + chat) and extra Quanta credits are available in Settings.</p>
      </div>
    </div>
  );
}
