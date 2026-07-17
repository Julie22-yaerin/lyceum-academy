import { useState } from 'react';
import { useTranslation, type AppLanguage } from '../i18n/I18nContext';
import { LANGUAGES } from '../i18n/translations';

interface LanguagePickerProps {
  /** Show as a full-page overlay (landing page) vs inline panel (settings) */
  mode?: 'fullpage' | 'inline';
  /** Called after the user confirms their selection (fullpage mode) */
  onConfirm?: () => void;
}

export default function LanguagePicker({ mode = 'inline', onConfirm }: LanguagePickerProps) {
  const { lang, setLang, t } = useTranslation();
  const [staged, setStaged] = useState<AppLanguage>(lang);
  const [showAll, setShowAll] = useState(false);

  const visibleLangs = showAll ? LANGUAGES : LANGUAGES.slice(0, 12);

  function handleConfirm() {
    setLang(staged);
    onConfirm?.();
  }

  if (mode === 'fullpage') {
    return (
      <div className="fixed inset-0 z-[9999] bg-[#050508] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-lg">
          <div className="text-center mb-10">
            <div className="font-serif text-3xl tracking-[4px] uppercase text-white mb-4">
              The Lyceum
            </div>
            <h2 className="font-serif text-2xl text-white/90 mb-3">
              {t('landing.langPickerTitle')}
            </h2>
            <p className="text-sm text-white/40 max-w-sm mx-auto">
              {t('landing.langPickerDesc')}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-8">
            {visibleLangs.map(l => (
              <button
                key={l.code}
                onClick={() => setStaged(l.code as AppLanguage)}
                className={`flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm transition-all ${
                  staged === l.code
                    ? 'bg-white/15 border border-white/30 shadow-lg shadow-purple-500/10'
                    : 'bg-white/5 border border-white/10 hover:bg-white/10'
                }`}
              >
                <span className="text-xl">{l.flag}</span>
                <div className="text-left min-w-0">
                  <div className="text-xs font-medium text-white/90 truncate">{l.label}</div>
                  <div className="text-[9px] text-white/30 uppercase">{l.code}</div>
                </div>
                {staged === l.code && (
                  <span className="ml-auto text-purple-300 text-sm">✓</span>
                )}
              </button>
            ))}
          </div>

          {LANGUAGES.length > 12 && (
            <button
              onClick={() => setShowAll(v => !v)}
              className="w-full text-center text-[10px] text-white/30 hover:text-white/60 transition-colors uppercase tracking-wider mb-6"
            >
              {showAll ? '← Show less' : `+ ${LANGUAGES.length - 12} more languages`}
            </button>
          )}

          <button
            onClick={handleConfirm}
            className="w-full bg-white text-[#050508] font-sans text-[11px] uppercase tracking-[2px] py-4 rounded-xl font-semibold hover:bg-white/90 transition-colors"
          >
            {t('landing.langPickerConfirm')}
          </button>
        </div>
      </div>
    );
  }

  // Inline mode (settings)
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

      {LANGUAGES.length > 12 && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-3 text-[10px] text-white/30 hover:text-white/60 transition-colors uppercase tracking-wider"
        >
          {showAll ? '← Show less' : `+ ${LANGUAGES.length - 12} more languages`}
        </button>
      )}
    </div>
  );
}
