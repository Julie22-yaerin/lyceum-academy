import { useState, useRef, useEffect } from 'react';
import { SUBJECT_META } from '../lib/persist';
import { useWorkspace } from '../context/WorkspaceContext';

/**
 * Chrome-style subject tab strip. One tab per open subject; switching tabs
 * changes WorkspaceContext's activeTab, which the 7 subject-scoped views
 * (Dialogue, Notes, Problem Sets, Mistake Bank, Knowledge Map, Progress,
 * Reference Bank) read to filter/tag their data. Closing a tab never
 * deletes data — it only removes the subject from the open-tabs list.
 */
export default function SubjectTabBar() {
  const { openTabs, activeTab, openTab, closeTab, setActiveTab } = useWorkspace();
  const [showAdd, setShowAdd] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setShowAdd(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (openTabs.length === 0) return null;

  const addable = Object.entries(SUBJECT_META).filter(([key]) => key !== 'other' && !openTabs.includes(key));

  return (
    <div className="flex items-center gap-1.5 mb-4 overflow-x-auto pb-1">
      {openTabs.map(key => {
        const meta = SUBJECT_META[key];
        if (!meta) return null;
        const active = key === activeTab;
        return (
          <div
            key={key}
            onClick={() => setActiveTab(key)}
            className={`group flex items-center gap-1.5 px-3 py-2 rounded-t-lg cursor-pointer text-sm flex-shrink-0 transition-colors ${
              active ? 'bg-white/10 text-white' : 'bg-white/[0.02] text-white/45 hover:bg-white/[0.05] hover:text-white/70'
            }`}
            style={active ? { boxShadow: 'inset 0 2px 0 0 #a78bfa' } : undefined}
          >
            <span className="text-[13px]">{meta.icon}</span>
            <span className="whitespace-nowrap">{meta.label}</span>
            {openTabs.length > 1 && (
              <button
                onClick={e => { e.stopPropagation(); closeTab(key); }}
                className="ml-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                title="Close tab"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
              </button>
            )}
          </div>
        );
      })}

      {addable.length > 0 && (
        <div className="relative flex-shrink-0" ref={addRef}>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white/80 hover:bg-white/[0.05] transition-colors"
            title="Open a new subject tab"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
          </button>
          {showAdd && (
            <div className="absolute top-full left-0 mt-1 glass-strong rounded-xl overflow-hidden z-[200] w-44">
              {addable.map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => { openTab(key); setShowAdd(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors text-left"
                >
                  <span>{meta.icon}</span>
                  {meta.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
