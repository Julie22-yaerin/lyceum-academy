import { ReactNode, useEffect, useRef, useState } from 'react';
import FloatingDock from './FloatingDock';
import VoiceOrb from './VoiceOrb';
import { NavigationProps } from '../types';
import { SUBJECT_META, loadTodayStudySubject, saveTodayStudySubject } from '../lib/persist';
import { recordSubjectActivity } from '../lib/profile';

interface MainLayoutProps extends NavigationProps {
  children: ReactNode;
}

export default function MainLayout({ currentView, onNavigate, children }: MainLayoutProps) {
  const [showSubjectPrompt, setShowSubjectPrompt] = useState(false);
  const [subjectInput, setSubjectInput] = useState('');
  const initRef = useRef<string | null>(null);

  // Once-a-day check-in: which subject is today's focus. Feeds the
  // personalization profile's love/fear bars (lib/profile.ts) — kept
  // deliberately lightweight after the Pomodoro timer/task-chain system
  // (StudyTimer/MiniTimer/TaskSetupModal, view-locking, break-locking) was
  // removed; this is just the subject signal, not a timer.
  useEffect(() => {
    const today = new Date().toDateString();
    if (initRef.current === today) return;
    initRef.current = today;

    if (!loadTodayStudySubject()) {
      setSubjectInput('');
      setShowSubjectPrompt(true);
    }
  }, [currentView]);

  function handleSubjectSubmit() {
    if (subjectInput) {
      saveTodayStudySubject(subjectInput);
      recordSubjectActivity(subjectInput);
    }
    setShowSubjectPrompt(false);
  }

  // Knowledge map needs its own full-bleed layout (contains its own toolbar, drawer, etc.)
  const isFullBleed = currentView === 'knowledge-map';

  return (
    <div className="bg-[#050508] text-white/90 min-h-screen flex flex-col">
      <FloatingDock currentView={currentView} onNavigate={onNavigate} />
      <VoiceOrb currentView={currentView} />
      <main id="lyceum-workspace-content" className={`flex flex-1 w-full ${isFullBleed ? '' : 'max-w-7xl mx-auto px-6 pt-24 pb-32'}`}>
        <div className={`flex-1 ${isFullBleed ? '' : 'overflow-y-auto'}`}>
          {children}
        </div>
      </main>

      {showSubjectPrompt && (
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
                  {meta.icon} {meta.label}
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
