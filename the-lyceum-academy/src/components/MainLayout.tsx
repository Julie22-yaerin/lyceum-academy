import { ReactNode, useEffect, useRef, useState } from 'react';
import FloatingDock from './FloatingDock';
import VoiceOrb from './VoiceOrb';
import SubjectTabBar from './SubjectTabBar';
import { NavigationProps } from '../types';
import { SUBJECT_META, loadTodayStudySubject, saveTodayStudySubject } from '../lib/persist';
import { recordSubjectActivity } from '../lib/profile';
import { submitFeedback } from '../lib/api';
import { SubjectIcon } from '../lib/subjectIcons';

interface MainLayoutProps extends NavigationProps {
  children: ReactNode;
  tourActive?: boolean;
  showFeedback?: boolean;
  onFeedbackClose?: () => void;
}

function FeedbackBar({ onClose }: { onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSend() {
    if (rating < 1 || busy) return;
    setBusy(true);
    try {
      await submitFeedback(rating, '', 'workspace');
      setDone(true);
      setTimeout(onClose, 1200);
    } catch {
      // silently fail — don't block the user
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        marginBottom: 12,
        gap: 12,
        minHeight: 44,
      }}
    >
      {done ? (
        <span style={{ fontSize: 12, color: '#8b5cf6', letterSpacing: 1 }}>
          ✦ Thanks for the feedback
        </span>
      ) : (
        <>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontFamily: 'sans-serif', letterSpacing: '1.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
            How's it going?
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                  fontSize: 18, lineHeight: 1,
                  color: n <= (hover || rating) ? '#8b5cf6' : 'rgba(255,255,255,0.18)',
                  transition: 'color 0.1s',
                }}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
              >★</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button
              onClick={handleSend}
              disabled={rating < 1 || busy}
              style={{
                padding: '5px 14px', fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase',
                fontWeight: 600, cursor: rating < 1 ? 'not-allowed' : 'pointer',
                background: rating >= 1 ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${rating >= 1 ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.1)'}`,
                color: rating >= 1 ? '#8b5cf6' : 'rgba(255,255,255,0.3)',
                borderRadius: 8, transition: 'all 0.15s',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {busy ? '…' : 'Send'}
            </button>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'rgba(255,255,255,0.3)', fontSize: 16, lineHeight: 1, padding: '4px 6px',
              }}
              aria-label="Dismiss"
            >×</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function MainLayout({ currentView, onNavigate, children, tourActive, showFeedback, onFeedbackClose }: MainLayoutProps) {
  const [showSubjectPrompt, setShowSubjectPrompt] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const initRef = useRef<string | null>(null);

  // Once-a-day check-in: which subject is today's focus. Feeds the
  // personalization profile's love/fear bars (lib/profile.ts) — kept
  // deliberately lightweight after the Pomodoro timer/task-chain system
  // (StudyTimer/MiniTimer/TaskSetupModal, view-locking, break-locking) was
  // removed; this is just the subject signal, not a timer.
  // Deferred while the first-login product tour is active — it's a
  // separate full-screen overlay, two modals at once would collide.
  useEffect(() => {
    if (tourActive) return;
    const today = new Date().toDateString();
    if (initRef.current === today) return;
    initRef.current = today;

    if (!loadTodayStudySubject()) {
      setSubjectInput('');
      setShowSubjectPrompt(true);
    }
  }, [currentView, tourActive]);

  function handleSubjectSubmit() {
    if (subjectInput) {
      saveTodayStudySubject(subjectInput);
      recordSubjectActivity(subjectInput);
    }
    setShowSubjectPrompt(false);
  }

  // Knowledge map needs its own full-bleed layout (contains its own toolbar, drawer, etc.)
  const isFullBleed = currentView === 'knowledge-map';

  // Subject-scoped views get the workspace tab strip; Nexus/Settings stay
  // cross-subject overviews and don't show it.
  const SUBJECT_SCOPED_VIEWS = new Set(['dialogue', 'notes', 'problem-sets', 'mistake-bank', 'knowledge-map', 'progress', 'reference-bank']);
  const showTabBar = SUBJECT_SCOPED_VIEWS.has(currentView);

  return (
    <div className="bg-[#0a0a0f] text-white/90 min-h-screen flex flex-col">
      <FloatingDock currentView={currentView} onNavigate={onNavigate} />
      <VoiceOrb currentView={currentView} tourActive={tourActive} />
      <main id="lyceum-workspace-content" className={`flex flex-1 w-full ${isFullBleed ? '' : 'max-w-7xl mx-auto px-6 pt-24 pb-32'}`}>
        <div className={`flex-1 ${isFullBleed ? '' : 'overflow-y-auto'}`}>
          {showFeedback && !isFullBleed && onFeedbackClose && (
            <FeedbackBar onClose={onFeedbackClose} />
          )}
          {showTabBar && isFullBleed && <div className="px-6 pt-6"><SubjectTabBar /></div>}
          {showTabBar && !isFullBleed && <SubjectTabBar />}
          {children}
        </div>
      </main>

      {showSubjectPrompt && !tourActive && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 180,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="glass-strong animate-scale-in" style={{
            padding: '28px 32px', maxWidth: 420, width: '90vw',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: '#f0f0f5', margin: '0 0 4px' }}>
              What's today's focus?
            </h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 18px' }}>
              Pick the subject you're spending most of today on.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 22 }}>
              {Object.entries(SUBJECT_META).map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => setSubjectInput(key)}
                  style={{
                    padding: '6px 12px', fontSize: 11, cursor: 'pointer',
                    borderRadius: 999,
                    border: subjectInput === key ? '1px solid rgba(167,139,250,0.7)' : '1px solid rgba(255,255,255,0.12)',
                    background: subjectInput === key ? 'rgba(167,139,250,0.18)' : 'transparent',
                    color: subjectInput === key ? '#d8ccff' : 'rgba(255,255,255,0.55)',
                    transition: 'all 0.15s',
                  }}
                >
                  <SubjectIcon subject={key} className="w-3.5 h-3.5 inline-block align-[-2px] mr-1" /> {meta.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSubjectPrompt(false)}
                style={{
                  padding: '9px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer', fontSize: 10, letterSpacing: 2,
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)',
                }}>
                Skip
              </button>
              <button onClick={handleSubjectSubmit}
                className="glass-btn"
                style={{
                  padding: '9px 24px', border: 'none',
                  cursor: 'pointer', fontSize: 10, letterSpacing: 2,
                  textTransform: 'uppercase', fontWeight: 600,
                }}>
                Start
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
