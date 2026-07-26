/**
 * SupportChatWidget — small floating button that opens a customer support chat.
 * Mounted on both the landing page and workspace (MainLayout).
 *
 * Uses nvidia/nemotron-mini-4b-instruct via backend /support/chat endpoint.
 * Automatically reports technical complaints to admin.
 */
import { useState, useRef, useEffect } from 'react';
import { getApiBaseUrl } from '../lib/apiBase';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

function generateSessionId(): string {
  return 'chat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function SupportChatWidget({ context = 'workspace' }: { context?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Xin chào bạn! Mình là tư vấn viên của Lyceum. Bạn cần mình giúp gì không? 😊',
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId] = useState(generateSessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { role: 'user', text, timestamp: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const API_BASE = getApiBaseUrl();
      const res = await fetch(`${API_BASE}/support/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, message: text }),
      });

      if (!res.ok) throw new Error(`Backend ${res.status}`);

      const data = await res.json();
      const reply: ChatMessage = {
        role: 'assistant',
        text: data.reply || 'Xin lỗi, mình gặp lỗi nhỏ. Thử lại nhé!',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, reply]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Xin lỗi bạn, hệ thống đang bận. Thử lại sau nhé!', timestamp: Date.now() },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    // Bottom-right is a shared stack with FloatingPodcast, ARI, and
    // StudyCycleTimer's idle button — each trigger sits at its own bottom
    // offset (see the comment on each) so they never overlap. Support's
    // trigger sits topmost since it's reached for least often, but the open
    // panel drops back to the natural bottom-6 corner — a 500px panel
    // anchored 17rem up would leave a dead gap underneath it.
    <div className={`fixed right-6 z-[200] font-sans ${open ? 'bottom-6' : 'bottom-[17rem]'}`}>
      {/* Floating button — blue/indigo on purpose: distinct from Podcast's
          purple, ARI's warm ring, and Timer's neutral glass, so the stack
          reads as separate controls at a glance. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-indigo-500/25 transition-all hover:shadow-xl hover:shadow-indigo-500/40 hover:scale-105 active:scale-95"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="hidden sm:inline">Hỗ trợ</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="flex flex-col w-[360px] h-[500px] rounded-2xl overflow-hidden border border-white/10 bg-[#1a1a2e]/95 backdrop-blur-xl shadow-2xl shadow-black/50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-sm font-bold text-white">
                L
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Lyceum Support</div>
                <div className="text-[10px] text-green-400">● Online</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="h-7 w-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-orange-500 text-white rounded-br-md'
                      : 'bg-white/10 text-white/90 rounded-bl-md'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-white/10 rounded-2xl rounded-bl-md px-3.5 py-2.5 flex gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-white/10 px-3 py-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Nhập tin nhắn..."
                className="flex-1 rounded-xl bg-white/10 px-3.5 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:ring-1 focus:ring-orange-500/50 transition-all"
                disabled={sending}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="h-10 w-10 rounded-xl bg-orange-500 flex items-center justify-center text-white transition-all hover:bg-orange-400 disabled:opacity-30 disabled:cursor-not-allowed active:scale-95"
              >
                <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
