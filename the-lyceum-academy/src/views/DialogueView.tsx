import { useState, useEffect, useRef, useCallback } from 'react';
import { chatMessage } from '../lib/api';
import { loadHistory, saveMessage } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { loadKaTeX, renderMath } from '../lib/math';
import { getCurrentLang, useTranslation } from '../i18n/I18nContext';
import { buildLanguageDirective } from '../lib/locale';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

// ── Math keyboard symbols ──────────────────────────────────────────────────
const MATH_SYMBOLS = [
  '÷','×','±','∓','√','∛','∜','∞','≈','≠','≤','≥',
  'α','β','γ','δ','ε','ζ','η','θ','ι','κ','λ','μ',
  'ν','ξ','π','ρ','σ','τ','υ','φ','χ','ψ','ω','Σ',
  'Δ','Γ','Λ','Π','Ω','∂','∇','∫','∬','∭','∮','∯',
  '⁰','¹','²','³','⁴','⁵','⁶','⁷','⁸','⁹','ⁿ','ˣ',
  '₀','₁','₂','₃','₄','₅','₆','₇','₈','₉','ₙ','ₓ',
  '∀','∃','∄','∈','∉','⊂','⊃','⊆','⊇','∩','∪','∅',
  '→','←','↔','⇒','⇐','⇔','↑','↓','⊕','⊗','⊙','∝',
];

// Use shared math renderer — re-export with paragraph wrapping for chat
function renderContent(text: string): string {
  let out = renderMath(text);
  // Headers
  out = out.replace(/^### (.+)$/gm, '<h3 class="font-serif text-lg mt-4 mb-2">$1</h3>');
  out = out.replace(/^## (.+)$/gm, '<h2 class="font-serif text-xl mt-4 mb-2">$1</h2>');
  // Lists
  out = out.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  out = out.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => `<ul class="space-y-1 my-2">${match}</ul>`);
  // Paragraphs
  out = out.replace(/\n\n/g, '</p><p class="font-sans text-sm leading-relaxed mb-4">');
  return `<p class="font-sans text-sm leading-relaxed mb-4">${out}</p>`;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
}

export default function DialogueView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [showMathKb, setShowMathKb] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { user, devMode } = useAuth();
  const { t } = useTranslation();

  const userId = user?.uid || (devMode ? 'dev' : 'anon');

  // Load KaTeX — re-render messages once available
  const [, setKatexTick] = useState(0);
  useEffect(() => { loadKaTeX(() => setKatexTick(t => t + 1)); }, []);

  // Load history from Supabase
  useEffect(() => {
    if (userId === 'anon') return;
    loadHistory(userId).then(rows => {
      if (rows.length > 0) {
        setMessages(rows.map(r => ({ role: r.role, content: r.content, model: r.model })));
      }
    });
  }, [userId]);

  // Pre-fill question from Problem Sets "Ask Lyceum AI" suggestion
  useEffect(() => {
    try {
      const prefill = sessionStorage.getItem('lyceum_dialogue_prefill');
      if (prefill) {
        setInput(prefill);
        sessionStorage.removeItem('lyceum_dialogue_prefill');
        setTimeout(() => textareaRef.current?.focus(), 100);
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  // Warn before the tab closes while a reply is still in flight — that
  // reply can't be saved yet because it doesn't exist, so the only way to
  // avoid losing it is to stop the student from leaving mid-answer.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (!thinking) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [thinking]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || thinking) return;
    setInput('');
    setError('');

    const userMsg: Message = { role: 'user', content: text };
    const history = [...messages, userMsg];
    setMessages(history);
    setThinking(true);

    // Save the user's message before starting the AI call — awaited so it's
    // actually persisted even if the student closes the tab right after.
    if (userId !== 'anon') {
      await saveMessage({ user_id: userId, role: 'user', content: text });
    }

    try {
      const lang = getCurrentLang();
      const apiMessages = [
        {
          role: 'system',
          content: 'You are Lyceum AI, a Socratic learning assistant. When the student asks something, do NOT answer it directly first — ask what THEY think or would guess, one short direct question, then build a real discussion from their answer (react to what they specifically said, push back, ask a follow-up). If they say they don\'t know: give the basic background info first, then gradually open up follow-up questions that lead back into discussion instead of just lecturing at them. Keep the discussion short by default — only go longer/deeper if the student explicitly asks for a longer discussion. Use LaTeX for math (wrap in $...$ or $$...$$). Be concise and insightful.' + buildLanguageDirective(lang),
        },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ];
      const result = await chatMessage(apiMessages, devMode);
      const aiMsg: Message = { role: 'assistant', content: result.reply, model: result.model };
      setMessages(prev => [...prev, aiMsg]);

      if (userId !== 'anon') {
        await saveMessage({ user_id: userId, role: 'assistant', content: result.reply, model: result.model });
      }
    } catch (e: any) {
      setError(e.message || t('dialogue.connectionError'));
    } finally {
      setThinking(false);
    }
  }, [input, messages, thinking, userId, devMode]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function insertSymbol(sym: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const newVal = input.slice(0, start) + sym + input.slice(end);
    setInput(newVal);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = start + sym.length;
      ta.focus();
    }, 0);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] bg-surface relative">
      {/* Header quote */}
      <div className="px-8 py-8 text-center border-b border-outline-variant/30 flex-shrink-0">
        <h1 className="font-serif text-2xl text-on-surface italic mb-2">
          {t('dialogue.quote')}
        </h1>
        <p className="font-sans text-xs text-on-surface opacity-50 uppercase tracking-[2px]">
          {t('dialogue.attribution')}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-8 md:p-12 space-y-10 pb-56">
        {messages.length === 0 && (
          <div className="flex gap-6 max-w-3xl">
            <div className="flex flex-col gap-3 flex-1">
              <span className="font-sans text-[10px] font-semibold text-on-surface uppercase tracking-[2px] opacity-50">{t('dialogue.hermes')}</span>
              <div className="p-8 bg-surface border border-outline-variant/30 shadow-sm">
                <p className="font-sans text-sm leading-relaxed">
                  {t('dialogue.welcome')}
                </p>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-6 max-w-3xl ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
          >
            <div className={`flex flex-col gap-3 flex-1 ${msg.role === 'user' ? 'items-end' : ''}`}>
              <span className={`font-sans text-[10px] font-semibold uppercase tracking-[2px] opacity-50 ${msg.role === 'user' ? 'text-secondary' : 'text-on-surface'}`}>
                {msg.role === 'user' ? t('dialogue.seeker') : t('dialogue.hermes')}
                {msg.model && <span className="ml-2 opacity-60 normal-case font-normal">· {msg.model}</span>}
              </span>
              {msg.role === 'assistant' ? (
                <div
                  className="p-8 bg-surface border border-outline-variant/30 shadow-sm prose-lyceum"
                  dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
                />
              ) : (
                <div className="p-6 bg-surface-container-lowest border border-outline-variant/30 shadow-sm text-right">
                  <p className="font-sans text-sm leading-relaxed">{msg.content}</p>
                </div>
              )}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex gap-6 max-w-3xl">
            <div className="flex flex-col gap-3 flex-1">
              <span className="font-sans text-[10px] font-semibold text-on-surface uppercase tracking-[2px] opacity-50">{t('dialogue.hermes')}</span>
              <div className="p-6 bg-surface border border-outline-variant/30 shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {[0, 1, 2].map(n => (
                      <div
                        key={n}
                        className="w-1.5 h-1.5 bg-on-surface rounded-full opacity-40 animate-bounce"
                        style={{ animationDelay: `${n * 0.15}s` }}
                      />
                    ))}
                  </div>
                  <span className="font-sans text-xs text-on-surface opacity-50">{t('dialogue.thinking2')}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="max-w-3xl mx-auto">
            <p className="font-sans text-xs text-red-600 border border-red-200 bg-red-50 px-4 py-2 text-center">
              {error}
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Math keyboard */}
      {showMathKb && (
        <div className="absolute bottom-[100px] left-0 right-0 bg-surface border-t border-outline-variant/30 p-4 z-20 shadow-lg">
          <div className="flex flex-wrap gap-1.5 max-w-4xl mx-auto">
            {MATH_SYMBOLS.map(sym => (
              <button
                key={sym}
                onClick={() => insertSymbol(sym)}
                className="w-9 h-9 border border-outline-variant/50 text-sm font-mono hover:bg-surface-container-highest transition-colors flex items-center justify-center"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input bar */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-surface via-surface/95 to-transparent pt-10">
        <div className="max-w-4xl mx-auto flex flex-col gap-3">
          <div className="flex items-end gap-3 bg-surface border border-outline-variant/50 p-4 shadow-sm">
            <textarea
              ref={textareaRef}
              className="flex-1 bg-transparent border-none focus:ring-0 resize-none font-sans text-sm min-h-[48px] max-h-32 outline-none p-2 placeholder:text-outline-variant/80"
              placeholder={t('dialogue.placeholder')}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => setShowMathKb(v => !v)}
                className={`p-2 transition-opacity ${showMathKb ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}
                title={t('dialogue.mathKeyboard')}
              >
                <span className="material-symbols-outlined text-[20px]">functions</span>
              </button>
              <LiquidMetalButton
                label={t('dialogue.send')}
                disabled={!input.trim() || thinking}
                onClick={sendMessage}
              />
            </div>
          </div>
          <div className="flex justify-center gap-8">
            <span className="text-[9px] text-on-surface opacity-30 uppercase tracking-[2px] font-sans">
              {t('dialogue.shiftHint')}
            </span>
            <span className="text-[9px] text-on-surface opacity-30 uppercase tracking-[2px] font-sans">
              {t('dialogue.latexHint')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
