import { useTranslation } from '../i18n/I18nContext';

/**
 * TermsModal — shown once per account, the very first time a user enters the
 * workspace. Blocks until "I agree" is clicked. Never shown again afterwards
 * (localStorage 'lyceum_terms_accepted').
 */
export default function TermsModal({ onAgree }: { onAgree: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        className="glass-strong rounded-2xl p-8 max-w-lg w-full flex flex-col gap-5"
        style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
      >
        <div>
          <h2 className="font-serif text-white text-xl font-semibold mb-1">{t('terms.heading')}</h2>
          <p className="text-white/40 text-xs font-sans uppercase tracking-[2px]">{t('terms.readBefore')}</p>
        </div>

        <div className="max-h-64 overflow-y-auto pr-2 flex flex-col gap-3 font-sans text-sm text-white/70 leading-relaxed">
          <p>
            {t('terms.body1')}
          </p>
          <p>
            {t('terms.body2')}
          </p>
          <p>
            {t('terms.body3')}
          </p>
          <p>
            {t('terms.body4')}
          </p>
        </div>

        <button
          onClick={onAgree}
          className="glass-btn rounded-xl py-3 font-sans text-xs uppercase tracking-[2px] font-semibold"
        >
          {t('terms.agreeContinue')}
        </button>
      </div>
    </div>
  );
}
