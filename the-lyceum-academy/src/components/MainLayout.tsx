import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import FloatingDock from './FloatingDock';
import VoiceOrb from './VoiceOrb';
import { NavigationProps } from '../types';
import type { View } from '../types';
import StudyTimer from './StudyTimer';
import MiniTimer from './MiniTimer';
import { loadTaskConfig, loadTodayMinutes, saveTodayMinutes, loadBreakMinutes, saveBreakMinutes } from './TaskSetupModal';
import type { TaskConfig } from './TaskSetupModal';

interface MainLayoutProps extends NavigationProps {
  children: ReactNode;
}

function getTaskLabel(config: TaskConfig, view: View): string {
  for (const t of config.tasks) {
    if (t.view === view) return t.label;
  }
  return view;
}

export default function MainLayout({ currentView, onNavigate, children }: MainLayoutProps) {
  const [taskConfig, setTaskConfig] = useState<TaskConfig | null>(null);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [showTimePrompt, setShowTimePrompt] = useState(false);
  const [timeInput, setTimeInput] = useState('60');
  const [breakInput, setBreakInput] = useState('10');
  const [timerActive, setTimerActive] = useState(false);
  const [currentTaskView, setCurrentTaskView] = useState<View | null>(null);
  const [breakActive, setBreakActive] = useState(false);
  const [unlockedViews, setUnlockedViews] = useState<Set<View>>(new Set());
  const [lockDialog, setLockDialog] = useState<{ target: View; label: string } | null>(null);
  const initRef = useRef<string | null>(null);

  // Check for task config and today's time once per day
  useEffect(() => {
    const config = loadTaskConfig();
    setTaskConfig(config);
    const today = new Date().toDateString();
    if (initRef.current === today) return;
    initRef.current = today;

    if (config && config.tasks.length > 0) {
      const existing = loadTodayMinutes();
      if (existing === null) {
        setTimeInput('60');
        setBreakInput(String(loadBreakMinutes()));
        setShowTimePrompt(true);
      } else {
        setTotalMinutes(existing);
        setTimerActive(true);
      }
    }
  }, [currentView]);

  function handleTimeSubmit() {
    const mins = parseInt(timeInput, 10);
    if (isNaN(mins) || mins < 1) return;
    const breakMins = parseInt(breakInput, 10);
    const clampedBreak = isNaN(breakMins) || breakMins < 1 ? 10 : breakMins;
    saveBreakMinutes(clampedBreak);
    saveTodayMinutes(mins);
    setTotalMinutes(mins);
    setShowTimePrompt(false);
    setTimerActive(true);
  }

  function handleTimerComplete() {
    setTimerActive(false);
    setCurrentTaskView(null);
  }

  const handleCurrentTaskChange = useCallback((view: View | null) => {
    setCurrentTaskView(view);
  }, []);

  const handleBreakActive = useCallback((active: boolean) => {
    setBreakActive(active);
  }, []);

  // Intercept navigation for locked views
  const handleNavigate = useCallback((view: View) => {
    // During break: only Community allowed
    if (breakActive && view !== 'community') {
      setLockDialog({ target: view, label: 'Break Time' });
      return;
    }
    // No lock if: timer not running, no current task, view matches current task, or view is unlocked
    if (!timerActive || !currentTaskView || view === currentTaskView || unlockedViews.has(view)) {
      onNavigate(view);
      return;
    }
    const label = taskConfig ? getTaskLabel(taskConfig, view) : view;
    setLockDialog({ target: view, label });
  }, [breakActive, timerActive, currentTaskView, unlockedViews, onNavigate, taskConfig]);

  function handleLockOk() {
    if (!lockDialog) return;
    setLockDialog(null);
    onNavigate(currentTaskView!);
  }

  function handleLockAccess() {
    if (!lockDialog) return;
    setUnlockedViews(prev => new Set(prev).add(lockDialog.target));
    setLockDialog(null);
    onNavigate(lockDialog.target);
  }

  // Knowledge map needs its own full-bleed layout (contains its own toolbar, drawer, etc.)
  const isFullBleed = currentView === 'knowledge-map';

  return (
    <div className="bg-[#ADD8E6] text-white/90 min-h-screen flex flex-col">
      <FloatingDock currentView={currentView} onNavigate={handleNavigate} />
      <VoiceOrb currentView={currentView} />
      <main id="lyceum-workspace-content" className={`flex flex-1 w-full ${isFullBleed ? '' : 'max-w-7xl mx-auto px-6 pt-24 pb-32'}`}>
        <div className={`flex-1 ${isFullBleed ? '' : 'overflow-y-auto'}`}>
          {children}
        </div>
      </main>

      {/* Study timer */}
      {timerActive && totalMinutes > 0 && (
        taskConfig && taskConfig.tasks.length > 0 ? (
          <StudyTimer
            config={taskConfig}
            totalMinutes={totalMinutes}
            breakMinutes={loadBreakMinutes()}
            onComplete={handleTimerComplete}
            onCurrentTaskChange={handleCurrentTaskChange}
            onBreakActive={handleBreakActive}
          />
        ) : (
          <MiniTimer totalMinutes={totalMinutes} onComplete={handleTimerComplete} />
        )
      )}

      {showTimePrompt && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 180,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="glass-strong animate-scale-in" style={{
            padding: '28px 32px', maxWidth: 420, width: '90vw',
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, color: '#f0f0f5', margin: '0 0 4px' }}>
              Học hôm nay thế nào?
            </h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 18px' }}>
              Chọn thời gian tập trung. Tài liệu ngoài nhiệm vụ hiện tại sẽ được khoá.
            </p>

            {/* Time input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input
                type="number"
                min={1}
                max={600}
                value={timeInput}
                onChange={e => setTimeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleTimeSubmit(); }}
                autoFocus
                className="glass-input"
                style={{
                  flex: 1, padding: '12px 14px',
                  fontSize: 15, textAlign: 'center',
                }}
              />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>minutes</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <input
                type="number"
                min={1}
                max={60}
                value={breakInput}
                onChange={e => setBreakInput(e.target.value)}
                disabled={timerActive}
                onKeyDown={e => { if (e.key === 'Enter') handleTimeSubmit(); }}
                className="glass-input"
                style={{
                  flex: 1, padding: '12px 14px',
                  fontSize: 15, textAlign: 'center',
                  opacity: timerActive ? 0.5 : 1,
                }}
              />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>break min</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowTimePrompt(false)}
                style={{
                  padding: '9px 20px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer', fontSize: 10, letterSpacing: 2,
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)',
                }}>
                Skip
              </button>
              <button onClick={handleTimeSubmit}
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

      {lockDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 190,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div className="glass-strong animate-scale-in" style={{
            padding: '28px 32px',
            maxWidth: 380, width: '90vw', textAlign: 'center',
          }}>
            {breakActive ? (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 500, color: '#f0f0f5', margin: '0 0 8px' }}>
                  ☕ Break Time
                </h2>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 20px' }}>
                  You're on a break. Only Community is available during this time.
                </p>
                <button onClick={() => setLockDialog(null)}
                  className="glass-btn"
                  style={{
                    padding: '10px 24px', border: 'none',
                    cursor: 'pointer', fontSize: 10, letterSpacing: 2,
                    textTransform: 'uppercase', fontWeight: 600,
                  }}>
                  OK
                </button>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 500, color: '#f0f0f5', margin: '0 0 8px' }}>
                  Not your current task
                </h2>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, margin: '0 0 20px' }}>
                  You're currently scheduled for <strong>{currentTaskView && taskConfig ? getTaskLabel(taskConfig, currentTaskView) : 'study'}</strong>.
                  Would you like to go there now, or access <strong>{lockDialog.label}</strong> anyway?
                </p>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                  <button onClick={handleLockAccess}
                    style={{
                      padding: '10px 22px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                      cursor: 'pointer', fontSize: 10, letterSpacing: 2,
                      textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)',
                    }}>
                    Access
                  </button>
                  <button onClick={handleLockOk}
                    className="glass-btn"
                    style={{
                      padding: '10px 24px', border: 'none',
                      cursor: 'pointer', fontSize: 10, letterSpacing: 2,
                      textTransform: 'uppercase', fontWeight: 600,
                    }}>
                    OK
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
