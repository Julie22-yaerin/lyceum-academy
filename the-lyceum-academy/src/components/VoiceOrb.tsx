import { useCallback, useEffect, useState } from 'react';
import S2SVoiceOverlay from './S2SVoiceOverlay';
import UpgradePrompt from './UpgradePrompt';
import { buildAssistantContext } from '../lib/assistantContext';
import { canUseVoice, getUsageStats, type UsageStats } from '../lib/subscriptionApi';
import { ARI_COPY, buildAriSystemInstruction, detectLocale, saveLocale, setDocumentLocale, type AppLocale } from '../lib/locale';
import type { View } from '../types';

const LISTEN_MODE_KEY = 'ari-listen-mode';
type ListenMode = 'always' | 'push';

function getSavedMode(): ListenMode | null {
  try { return (localStorage.getItem(LISTEN_MODE_KEY) as ListenMode) || null; } catch { return null; }
}
function saveMode(mode: ListenMode) {
  try { localStorage.setItem(LISTEN_MODE_KEY, mode); } catch { /* ignore */ }
}

interface VoiceOrbProps {
  currentView: View;
  tourActive?: boolean;
}

/**
 * ARI runs as an always-on background voice session the moment you're in the
 * workspace — no click, no wake word. First visit asks once whether the mic
 * should stay open (always-listen) or wait for a manual mic tap (push-to-talk);
 * after that it just connects. The actual orb + mic/pause controls live in
 * S2SVoiceOverlay now (rendered as a small persistent HUD, not a takeover).
 */
export default function VoiceOrb({ currentView, tourActive }: VoiceOrbProps) {
  const [locale] = useState<AppLocale>(() => detectLocale());
  const [showPrefDialog, setShowPrefDialog] = useState(false);
  const [ready, setReady] = useState(false);
  const [listenMode, setListenMode] = useState<ListenMode>(() => getSavedMode() ?? 'always');
  const [systemInstruction, setSystemInstruction] = useState(() => buildAriSystemInstruction(locale));
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    setDocumentLocale(locale);
    saveLocale(locale);
  }, [locale]);

  // Decide immediately on mount — this is the only gate, and only ever once.
  // `ready` (which mounts S2SVoiceOverlay, starting the Gemini Live
  // connection) waits for the context fetch too — otherwise ARI could
  // connect with the bare BASE_INSTRUCTION on the fast path (mode already
  // chosen) before the async personalization/screen-context load resolves,
  // since systemInstruction is only read once at S2SVoiceOverlay mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Check voice usage limit before connecting
        const stats = await getUsageStats();
        if (!active) return;
        setUsage(stats);

        if (!canUseVoice(stats)) {
          setShowUpgradePrompt(true);
          return;
        }

        const context = await buildAssistantContext(currentView);
        if (!active) return;
        setSystemInstruction(buildAriSystemInstruction(locale, context));
        if (getSavedMode() !== null) setReady(true);
      } catch (err) {
        console.error('Failed to check voice usage:', err);
        // Continue anyway if backend is unavailable
        const context = await buildAssistantContext(currentView);
        if (!active) return;
        setSystemInstruction(buildAriSystemInstruction(locale, context));
        if (getSavedMode() !== null) setReady(true);
      }
    })();
    // Deferred while the first-login product tour is active — it's a
    // separate full-screen overlay, two modals at once would collide.
    // The effect below picks this back up once the tour finishes.
    if (getSavedMode() === null && !tourActive) setShowPrefDialog(true);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tour just finished and the mic mode is still undecided — ask now.
  useEffect(() => {
    if (!tourActive && getSavedMode() === null && !ready) setShowPrefDialog(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourActive]);

  const handleChoose = useCallback((mode: ListenMode) => {
    saveMode(mode);
    setListenMode(mode);
    setShowPrefDialog(false);
    setReady(true);
  }, []);

  return (
    <>
      {/* Upgrade prompt for voice limit */}
      {showUpgradePrompt && (
        <UpgradePrompt
          feature="voice"
          onClose={() => setShowUpgradePrompt(false)}
        />
      )}

      {/* First-time preference dialog — only decision ARI ever asks for */}
      {showPrefDialog && !tourActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div
          className="glass-strong rounded-2xl p-8 max-w-sm w-full mx-4 flex flex-col gap-6"
          style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
        >
          <div className="text-center">
            <div className="text-2xl mb-2">🎙</div>
            <h2 className="font-serif text-white text-lg font-semibold mb-1">{ARI_COPY[locale].settingsTitle}</h2>
            <p className="text-white/50 text-sm font-sans">{ARI_COPY[locale].settingsPrompt}</p>
          </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleChoose('always')}
                className="glass rounded-xl p-4 text-left hover:bg-white/10 transition-colors border border-white/10 group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🔊</span>
                  <div>
                    <div className="text-white font-sans font-medium text-sm">{ARI_COPY[locale].alwaysListeningTitle}</div>
                    <div className="text-white/40 text-xs mt-0.5">{ARI_COPY[locale].alwaysListeningBody}</div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleChoose('push')}
                className="glass rounded-xl p-4 text-left hover:bg-white/10 transition-colors border border-white/10 group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">👆</span>
                  <div>
                    <div className="text-white font-sans font-medium text-sm">{ARI_COPY[locale].pushToTalkTitle}</div>
                    <div className="text-white/40 text-xs mt-0.5">{ARI_COPY[locale].pushToTalkBody}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {ready && (
        <S2SVoiceOverlay
          onNewMessage={() => {}}
          systemInstruction={systemInstruction}
          enableAutoSave
          startMuted={listenMode === 'push'}
          locale={locale}
        />
      )}
    </>
  );
}
