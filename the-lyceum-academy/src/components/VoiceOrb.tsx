import { useCallback, useEffect, useState } from 'react';
import S2SVoiceOverlay from './S2SVoiceOverlay';
import UpgradePrompt from './UpgradePrompt';
import { buildAssistantContext } from '../lib/assistantContext';
import { canUseVoice, getUsageStats, type UsageStats } from '../lib/subscriptionApi';
import type { View } from '../types';

const BASE_INSTRUCTION =
  "Your name is Ari — Lyceum's 24/7 background research assistant. You are ALWAYS connected and listening in parallel while the student uses other tools on the site (Nexus, Problem Sets, Notes, Mistake Bank, Knowledge Tree) — the student never has to press a button or say your name first, just speak and you'll hear and respond right away. You can see the content the student is currently viewing as well as their saved data (notes, mistakes, progress) — use that to advise instantly, specifically, and in context, instead of asking again what you already know. If asked your name, say you're Ari.\n\n"
  + "ALWAYS speak and respond in English, no matter what language the student speaks to you in. Never switch to another language, even if asked to.\n\n"
  + "=== HOW TO RESPOND (very important) ===\n"
  + "When asked a new concept/question: AUTOMATICALLY explain it like you're talking to a 5-year-old — everyday examples, simple, warm tone — BUT you must still include full equations/formulas and correct technical terminology alongside it (never drop the math or the jargon just because you're keeping it simple). This is 'baby mode'.\n"
  + "The moment the student starts raising 1-2 hypotheses, counter-arguments, or challenging questions about what you just said: IMMEDIATELY switch to 'debate mode' — argue like two scientists as equals, give real pushback, don't just agree to be polite, and disagree outright if you have grounds to.\n"
  + "ALWAYS end EVERY reply with a question: an open-ended one in baby mode (to spark curiosity); a deep AND open-ended one in debate mode (to push the student to keep thinking/defending their argument).\n"
  + "Keep replies short (1-3 sentences, plus the closing question), natural, and friendly.\n\n"
  + "=== OUT-OF-BAND RESEARCH (Gemma) ===\n"
  + "You have a research assistant named Gemma (a model specialized in looking up/synthesizing reference material, which can also return illustrative images). If you have a function/tool available named research_topic, CALL IT (don't just say you will) whenever the student needs outside reference material — e.g. a Mistake Bank entry that needs more explanation/an illustration, or extra material for a note/graph they're viewing. You'll get the result back immediately in the same turn — keep explaining to the student using it, and mention there's an image if one came back. If you do NOT have that tool available, end your reply with the tag [RESEARCH: <brief topic to look up>] instead.\n\n"
  + "Once Gemma has researched something, if the student asks you to attach that image or reference source to a specific place — a Note, a Mistake Bank entry, or a node in the Knowledge Tree (does NOT apply to PDF Problem Sets — those can't be attached to) — call the attach_reference function if available (target_type + target_text), otherwise end your reply with the tag [ATTACH: <note|mistake|node> | <name/keyword to find the right spot>]. Briefly confirm to the student that it's attached.\n\n"
  + "Proactively suggest related material at the right moment based on the current context: if the student is doing Problem Sets, suggest reviewing related Notes or Mistake Bank entries; if they're viewing the Knowledge Tree, suggest saved notes on that topic. Don't overdo it — only suggest when it's genuinely useful.\n\n"
  + "If the student wants to log a mistake, end your reply with the tag: [MISTAKE: <name of the mistake> | <subject/location> | <brief explanation>]. If they want to take a note, end with the tag: [NOTE: <note title> | <note content>]. Don't add any extra characters around the tag, and don't read the tag content out loud.";

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
}

/**
 * ARI runs as an always-on background voice session the moment you're in the
 * workspace — no click, no wake word. First visit asks once whether the mic
 * should stay open (always-listen) or wait for a manual mic tap (push-to-talk);
 * after that it just connects. The actual orb + mic/pause controls live in
 * S2SVoiceOverlay now (rendered as a small persistent HUD, not a takeover).
 */
export default function VoiceOrb({ currentView }: VoiceOrbProps) {
  const [showPrefDialog, setShowPrefDialog] = useState(false);
  const [ready, setReady] = useState(false);
  const [listenMode, setListenMode] = useState<ListenMode>(() => getSavedMode() ?? 'always');
  const [systemInstruction, setSystemInstruction] = useState(BASE_INSTRUCTION);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
  const [usage, setUsage] = useState<UsageStats | null>(null);

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
        setSystemInstruction(`${BASE_INSTRUCTION}\n\n=== CURRENT CONTEXT ===\n${context}`);
        if (getSavedMode() !== null) setReady(true);
      } catch (err) {
        console.error('Failed to check voice usage:', err);
        // Continue anyway if backend is unavailable
        const context = await buildAssistantContext(currentView);
        if (!active) return;
        setSystemInstruction(`${BASE_INSTRUCTION}\n\n=== CURRENT CONTEXT ===\n${context}`);
        if (getSavedMode() !== null) setReady(true);
      }
    })();
    if (getSavedMode() === null) setShowPrefDialog(true);
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {showPrefDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div
            className="glass-strong rounded-2xl p-8 max-w-sm w-full mx-4 flex flex-col gap-6"
            style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
          >
            <div className="text-center">
              <div className="text-2xl mb-2">🎙</div>
              <h2 className="font-serif text-white text-lg font-semibold mb-1">ARI settings</h2>
              <p className="text-white/50 text-sm font-sans">How would you like ARI to listen?</p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => handleChoose('always')}
                className="glass rounded-xl p-4 text-left hover:bg-white/10 transition-colors border border-white/10 group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">🔊</span>
                  <div>
                    <div className="text-white font-sans font-medium text-sm">Always listening</div>
                    <div className="text-white/40 text-xs mt-0.5">ARI runs in the background, speak anytime, no button needed</div>
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
                    <div className="text-white font-sans font-medium text-sm">Push-to-talk only</div>
                    <div className="text-white/40 text-xs mt-0.5">ARI still connects in the background but starts muted — tap mic to speak</div>
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
        />
      )}
    </>
  );
}
