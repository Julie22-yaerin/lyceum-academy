import { useState, useEffect, useRef } from 'react';
import { chatMessage } from '../lib/api';
import {
  loadMistakes,
  deleteMistake,
  clearMistakes,
  getSubjectIcon,
  getSortedMistakes,
  getAllSubjects,
  type MistakeEntry,
} from '../lib/mistakes';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

function MistakeCard({ entry, selected, onToggle, onDelete }: { entry: MistakeEntry; selected: boolean; onToggle?: () => void; onDelete: () => void }) {
  const date = new Date(entry.createdAt);
  const dateStr = date.toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('vi-VN', {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      className={`glass-strong rounded-2xl p-5 transition-all hover:bg-white/[0.03] ${selected ? 'ring-1 ring-rose-400/40 bg-rose-500/5' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {onToggle && (
            <button
              onClick={onToggle}
              className={`flex-shrink-0 w-5 h-5 mt-0.5 rounded border transition-all flex items-center justify-center ${
                selected ? 'bg-rose-500 border-rose-400 text-white' : 'border-white/20 hover:border-white/40'
              }`}
            >
              {selected && <span className="material-symbols-outlined text-[12px]">check</span>}
            </button>
          )}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{getSubjectIcon(entry.subject)}</span>
              <span className="font-sans text-[10px] uppercase tracking-[2px] text-white/50 px-2 py-0.5 bg-white/5 rounded">
                {entry.subject}
              </span>
            </div>
            <p className="font-serif text-sm text-white/85 leading-relaxed mb-2">{entry.mistake}</p>
            {entry.location && (
              <p className="font-sans text-[11px] text-white/40 mb-1">
                <span className="opacity-50">📍</span> {entry.location}
              </p>
            )}
            {entry.explanation && (
              <p className="font-sans text-[11px] text-amber-300/60 italic">{entry.explanation}</p>
            )}
          </div>
        </div>
        {!onToggle && (
          <button
            onClick={onDelete}
            className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-all"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        )}
      </div>
      <div className="mt-3 border-t border-white/5 pt-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-[10px] text-white/20">schedule</span>
        <span className="font-sans text-[10px] text-white/30">{dateStr} · {timeStr}</span>
      </div>
    </div>
  );
}

function ChatPanel({ selectedEntries, onClose }: { selectedEntries: MistakeEntry[]; onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const contextStr = selectedEntries.map((e, i) =>
    `${i + 1}. "${e.mistake}"${e.location ? ` (${e.location})` : ''} — ${e.subject}`
  ).join('\n');

  useEffect(() => {
    if (contextStr) {
      setMessages([{
        role: 'assistant',
        content: `I see these mistakes in your bank:\n${contextStr}\n\nTell me which one you'd like to work through and I'll help you understand it.`,
      }]);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    const userMsg: ChatMsg = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setThinking(true);
    try {
      const apiMessages = [
        {
          role: 'system',
          content: `You are Lyceum AI, a Socratic learning assistant. The student has these mistakes in their mistake bank:\n${contextStr}\n\nHelp them understand each mistake through guided questions. Use LaTeX for math. Be concise and constructive.`,
        },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ];
      const result = await chatMessage(apiMessages);
      setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: '⚠️ ' + (e.message || 'Connection error') }]);
    } finally {
      setThinking(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="h-full flex flex-col glass rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-rose-300/60">auto_awesome</span>
          <span className="font-sans text-xs font-medium text-white/70">AI Chat</span>
          <span className="font-sans text-[9px] text-white/30">· {selectedEntries.length} mistakes</span>
        </div>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/20 text-white/30 hover:text-white/70 transition-all">
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'glass-btn text-white/90'
                  : 'glass-strong text-white/80'
              }`}
            >
              <p className="font-sans text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {thinking && (
          <div className="flex justify-start">
            <div className="glass-strong rounded-2xl px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0s' }} />
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/10 p-4">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about a mistake..."
            rows={1}
            className="flex-1 glass-input rounded-xl px-4 py-2.5 text-xs resize-none leading-relaxed"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || thinking}
            className="glass-btn rounded-xl px-4 py-2.5 disabled:opacity-30 transition-all flex items-center"
          >
            <span className="material-symbols-outlined text-[16px]">send</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MistakeBankView() {
  const [entries, setEntries] = useState<MistakeEntry[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [filterSubject, setFilterSubject] = useState('');
  const [showClear, setShowClear] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chatEntries, setChatEntries] = useState<MistakeEntry[] | null>(null);

  function refresh() {
    setEntries(getSortedMistakes(filterSubject || undefined));
    setSubjects(getAllSubjects());
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => { refresh(); }, [filterSubject]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  }

  function openChat() {
    const selected = entries.filter(e => selectedIds.has(e.id));
    if (selected.length === 0) return;
    setChatEntries(selected);
    setSelectMode(false);
  }

  function handleDelete(id: string) {
    deleteMistake(id);
    refresh();
  }

  const totalMistakes = loadMistakes().length;

  const bankContent = (
    <>
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="material-symbols-outlined text-3xl text-rose-300/60">report</span>
        </div>
        <h1 className="font-serif text-3xl text-white mb-2 tracking-tight">Mistake Bank</h1>
        <p className="font-sans text-xs text-white/40 italic">
          "A mistake is a signal that you're learning something new."
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          {subjects.length > 0 && (
            <select
              value={filterSubject}
              onChange={e => setFilterSubject(e.target.value)}
              className="glass-input rounded-xl px-2 py-2 text-xs text-white/70 bg-transparent border border-white/10"
            >
              <option value="">All</option>
              {subjects.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          {entries.length > 0 && !selectMode && (
            <button
              onClick={() => { setSelectMode(true); setSelectedIds(new Set()); }}
              className="flex items-center gap-1.5 glass-btn rounded-xl px-3 py-2 text-xs font-medium transition-all"
            >
              <span className="material-symbols-outlined text-[15px]">checklist</span>Select
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-sans text-[10px] text-white/30">
            {totalMistakes} mistake{totalMistakes !== 1 ? 's' : ''}
          </span>
          {totalMistakes > 0 && !selectMode && (
            !showClear ? (
              <button onClick={() => setShowClear(true)}
                className="font-sans text-[10px] uppercase tracking-[2px] text-white/20 hover:text-white/50 transition-opacity flex items-center gap-1">
                <span className="material-symbols-outlined text-[12px]">delete</span>Clear
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button onClick={() => setShowClear(false)}
                  className="font-sans text-[9px] uppercase tracking-[2px] text-white/40 hover:text-white/80 transition-opacity">Cancel</button>
                <button onClick={() => { clearMistakes(); setShowClear(false); refresh(); }}
                  className="font-sans text-[9px] uppercase tracking-[2px] text-red-400 hover:text-red-300 transition-colors flex items-center gap-1">
                  <span className="material-symbols-outlined text-[11px]">warning</span>Confirm
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {/* Select mode bar */}
      {selectMode && (
        <div className="glass-strong rounded-2xl p-3 mb-4 flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-3">
            <button
              onClick={handleSelectAll}
              className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white/90 transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">
                {selectedIds.size === entries.length ? 'deselect' : 'select_all'}
              </span>
              {selectedIds.size === entries.length ? 'Deselect all' : 'Select all'}
            </button>
            <span className="font-sans text-[10px] text-white/40">{selectedIds.size} selected</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}
              className="font-sans text-[10px] uppercase tracking-[2px] text-white/40 hover:text-white/80 transition-opacity"
            >
              Cancel
            </button>
            <button
              onClick={openChat}
              disabled={selectedIds.size === 0}
              className="flex items-center gap-1.5 glass-btn rounded-xl px-4 py-2 text-xs font-medium disabled:opacity-30 transition-all"
            >
              <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
              Talk with AI
            </button>
          </div>
        </div>
      )}

      {/* List — populated automatically whenever AI grading marks an answer wrong in Problem Sets */}
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12">
          <span className="material-symbols-outlined text-4xl text-white/10 mb-3">check_circle</span>
          <p className="font-serif text-lg text-white/25 mb-1">No mistakes logged yet</p>
          <p className="font-sans text-xs text-white/20 text-center max-w-xs">
            Whenever AI grading marks an answer wrong in Problem Sets, it shows up here automatically.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[calc(100vh-320px)] pr-1">
          {entries.map(entry => (
            <MistakeCard
              key={entry.id}
              entry={entry}
              selected={selectedIds.has(entry.id)}
              onToggle={selectMode ? () => toggleSelect(entry.id) : undefined}
              onDelete={() => handleDelete(entry.id)}
            />
          ))}
        </div>
      )}
    </>
  );

  if (chatEntries) {
    return (
      <div className="flex-grow flex min-h-screen">
        <div className="w-1/2 py-8 pl-4 pr-3 overflow-y-auto">
          {bankContent}
        </div>
        <div className="w-1/2 py-8 pr-4 pl-3 flex flex-col">
          <ChatPanel selectedEntries={chatEntries} onClose={() => setChatEntries(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-grow flex flex-col items-center py-12 px-4 min-h-screen">
      <div className="w-full max-w-3xl">
        {bankContent}
      </div>
    </div>
  );
}
