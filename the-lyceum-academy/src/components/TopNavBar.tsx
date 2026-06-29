import { useState, useEffect, useRef } from 'react';
import { View, NavigationProps } from '../types';
import { useAuth } from '../context/AuthContext';
import { auth, signOut } from '../lib/firebase';
import { getUsage, UsageData } from '../lib/api';

// ── Nav items (shared between desktop nav + mobile menu) ──────────────────
const NAV_ITEMS: { view: View; label: string }[] = [
  { view: 'dialogue',      label: 'Dialogue' },
  { view: 'knowledge-map', label: 'Knowledge Map' },
  { view: 'problem-sets',  label: 'Problem Sets' },
  { view: 'community',     label: 'Community' },
  { view: 'progress',      label: 'Progress' },
  { view: 'notes',         label: 'Notes' },
];

// ── Provider metadata ─────────────────────────────────────────────────────
const PROVIDERS: { key: string; label: string; color: string }[] = [
  { key: 'groq',       label: 'Groq / Llama',   color: '#FF6B35' },
  { key: 'google',     label: 'Google Gemini',  color: '#4285F4' },
  { key: 'nvidia',     label: 'NVIDIA NIM',     color: '#76B900' },
  { key: 'openrouter', label: 'OpenRouter',     color: '#7C3AED' },
  { key: 'ollama',     label: 'Ollama',         color: '#6B7280' },
];

// ── Usage panel ───────────────────────────────────────────────────────────
function UsagePanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getUsage().then(d => { setData(d); setLoading(false); });
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const totalReq = data?.total_calls ?? 0;
  const totalTok = data?.total_tokens ?? 0;

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-2 w-80 bg-surface border border-outline-variant/30 shadow-lg z-[200]"
      style={{ animation: 'fadeDown 0.18s ease-out' }}
    >
      <style>{`@keyframes fadeDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }`}</style>

      {/* Header */}
      <div className="px-5 py-4 border-b border-outline-variant/20 flex items-center justify-between">
        <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-50">AI Usage — This Session</span>
        <button onClick={onClose} className="opacity-30 hover:opacity-80 transition-opacity">
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-3 py-2">
            <div className="w-3 h-3 border border-on-surface/20 border-t-on-surface rounded-full animate-spin" />
            <span className="font-sans text-xs opacity-40">Loading…</span>
          </div>
        ) : totalReq === 0 ? (
          <p className="font-sans text-xs opacity-40 text-center py-2">No AI calls yet this session.</p>
        ) : (
          <>
            {/* Per-provider bars */}
            {PROVIDERS.map(({ key, label, color }) => {
              const p = data?.by_provider?.[key];
              if (!p || p.requests === 0) return null;
              const pctReq = totalReq > 0 ? (p.requests / totalReq) * 100 : 0;
              const tok = p.prompt + p.completion;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="font-sans text-[11px] text-on-surface opacity-80">{label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-sans text-[10px] opacity-40">{p.requests} calls</span>
                      <span className="font-sans text-[11px] font-semibold text-on-surface opacity-70"
                        style={{ minWidth: 36, textAlign: 'right' }}>
                        {pctReq.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  {/* Bar */}
                  <div className="h-1.5 w-full rounded-full bg-outline-variant/20 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pctReq}%`, background: color, opacity: 0.85 }} />
                  </div>
                  {tok > 0 && (
                    <p className="font-sans text-[9px] opacity-30 mt-0.5 text-right">
                      {tok.toLocaleString()} tokens
                    </p>
                  )}
                </div>
              );
            })}

            {/* Totals */}
            <div className="border-t border-outline-variant/15 pt-3 flex items-center justify-between">
              <span className="font-sans text-[10px] uppercase tracking-[1px] opacity-40">Total</span>
              <div className="flex items-center gap-4">
                <span className="font-sans text-[10px] opacity-50">{totalReq} calls</span>
                <span className="font-sans text-[10px] opacity-50">{totalTok.toLocaleString()} tokens</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── TopNavBar ─────────────────────────────────────────────────────────────
export default function TopNavBar({ currentView, onNavigate }: NavigationProps) {
  const { user, devMode } = useAuth();
  const [showStats, setShowStats] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    try { await signOut(auth); } catch {}
    onNavigate('auth');
  }

  return (
    <header className="w-full top-0 bg-surface z-50 border-b border-outline-variant/20">
      <div className="flex justify-between items-center w-full px-6 md:px-10 py-5 md:py-6 mx-auto">
        {/* Logo */}
        <div
          className="font-serif text-xl md:text-2xl tracking-[4px] uppercase text-on-surface cursor-pointer"
          onClick={() => { onNavigate('landing'); setMobileOpen(false); }}
        >
          The Lyceum
        </div>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-8">
          {NAV_ITEMS.map(({ view, label }) => (
            <a
              key={view}
              onClick={e => { e.preventDefault(); onNavigate(view); }}
              className={`editorial-nav-link cursor-pointer ${currentView === view ? 'active' : ''}`}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {/* AI Usage */}
          <div className="relative">
            <button
              onClick={() => setShowStats(v => !v)}
              className="w-8 h-8 flex items-center justify-center opacity-40 hover:opacity-90 transition-opacity"
              title="AI Usage"
            >
              <span className="material-symbols-outlined text-[18px]">analytics</span>
            </button>
            {showStats && <UsagePanel onClose={() => setShowStats(false)} />}
          </div>

          {/* Auth */}
          {user ? (
            <div className="hidden md:flex items-center gap-3">
              <span className="font-sans text-[10px] text-on-surface opacity-50 uppercase tracking-[1px] max-w-[140px] truncate">
                {user.displayName || user.email}
              </span>
              <button onClick={handleSignOut} className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity">
                Sign Out
              </button>
            </div>
          ) : devMode ? (
            <span className="font-sans text-[10px] uppercase tracking-[2px] opacity-30 hidden md:block">Dev Mode</span>
          ) : (
            <button onClick={() => onNavigate('auth')} className="font-sans text-[10px] uppercase tracking-[2px] opacity-50 hover:opacity-100 transition-opacity hidden md:block">
              Sign In
            </button>
          )}

          {/* Mobile hamburger */}
          <button
            className="md:hidden w-8 h-8 flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
            onClick={() => setMobileOpen(v => !v)}
          >
            <span className="material-symbols-outlined text-[20px]">{mobileOpen ? 'close' : 'menu'}</span>
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-outline-variant/20 bg-surface flex flex-col py-2">
          {NAV_ITEMS.map(({ view, label }) => (
            <button
              key={view}
              onClick={() => { onNavigate(view); setMobileOpen(false); }}
              className={`px-6 py-3.5 text-left font-sans text-[11px] uppercase tracking-[2px] transition-colors ${
                currentView === view
                  ? 'bg-on-surface text-surface'
                  : 'text-on-surface opacity-60 hover:opacity-100 hover:bg-surface-container-highest'
              }`}
            >
              {label}
            </button>
          ))}
          {user && (
            <button onClick={handleSignOut} className="px-6 py-3.5 text-left font-sans text-[11px] uppercase tracking-[2px] opacity-40 hover:opacity-70 transition-opacity border-t border-outline-variant/10 mt-2">
              Sign Out
            </button>
          )}
        </div>
      )}
    </header>
  );
}
