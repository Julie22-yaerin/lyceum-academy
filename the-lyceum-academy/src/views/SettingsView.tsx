import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/I18nContext';
import { useTheme, type AppTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import {
  auth, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from '../lib/firebase';
import {
  getPlanCatalog, getCurrentPlan, selectPlan, buyExtraCredits, getQuantaBalance,
  getReferralInfo, buildInviteLink, addSecondBrainNote, listSecondBrainCustom, redeemUnlimitedAccess,
  type LyceumPlan, type CurrentPlan, type QuantaBalance,
} from '../lib/lyceumApi';
import { loadSchedule, saveSchedule, syncScheduleToServer, type ScheduleBlock } from '../lib/schedule';
import { SUBJECT_META } from '../lib/persist';
import LanguagePicker from '../components/LanguagePicker';
import TeamSpace from '../components/TeamSpace';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

const THEME_OPTIONS: { value: AppTheme; label: string; icon: string }[] = [
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
  { value: 'light', label: 'Light', icon: 'light_mode' },
];

const AVATAR_KEY = 'lyceum_avatar_v1';

// ── Profile: avatar, display name, password, weekly schedule ───────────────

function ProfileSection() {
  const { user } = useAuth();
  const [avatar, setAvatar] = useState<string>(() => {
    try { return localStorage.getItem(AVATAR_KEY) || ''; } catch { return ''; }
  });
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function pickAvatar(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      // Downscale to a small square so it fits comfortably in localStorage.
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 128;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const min = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - min) / 2, (img.height - min) / 2, min, min, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
        setAvatar(dataUrl);
        try { localStorage.setItem(AVATAR_KEY, dataUrl); } catch { /* quota */ }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function saveName() {
    if (!auth.currentUser) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await updateProfile(auth.currentUser, { displayName: displayName.trim() });
      setMsg('Profile updated.');
    } catch (e: any) { setErr(e?.message || 'Could not update profile.'); }
    finally { setBusy(false); }
  }

  async function changePassword() {
    if (!auth.currentUser?.email) { setErr('Password change needs an email account.'); return; }
    if (newPw.length < 6) { setErr('New password must be at least 6 characters.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPw);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPw);
      setCurrentPw(''); setNewPw('');
      setMsg('Password changed.');
    } catch (e: any) {
      setErr(e?.code === 'auth/wrong-password' ? 'Current password is incorrect.' : (e?.message || 'Could not change password.'));
    } finally { setBusy(false); }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-4">Profile</p>

      <div className="flex items-center gap-4 mb-5">
        <button
          onClick={() => fileRef.current?.click()}
          className="w-16 h-16 rounded-full overflow-hidden bg-white/10 flex items-center justify-center hover:ring-2 ring-purple-300/50 transition-all shrink-0"
          title="Change avatar"
        >
          {avatar
            ? <img src={avatar} alt="avatar" className="w-full h-full object-cover" />
            : <span className="material-symbols-outlined text-white/40">add_a_photo</span>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => e.target.files?.[0] && pickAvatar(e.target.files[0])} />
        <div className="flex-1 min-w-0">
          <div className="flex gap-2">
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Display name"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-sm text-white/85 outline-none border border-white/10 focus:border-white/25"
            />
            <button onClick={saveName} disabled={busy}
              className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30">
              Save
            </button>
          </div>
          <p className="text-[10px] text-white/35 mt-1 truncate">{user?.email}</p>
        </div>
      </div>

      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Change password</p>
      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
          placeholder="Current password"
          className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25" />
        <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
          placeholder="New password"
          className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25" />
        <button onClick={changePassword} disabled={busy || !currentPw || !newPw}
          className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30">
          Update
        </button>
      </div>

      {msg && <p className="text-xs text-emerald-300/80 mt-2">{msg}</p>}
      {err && <p className="text-xs text-red-300/80 mt-2">{err}</p>}
    </div>
  );
}

// ── Weekly schedule editor ──────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function ScheduleSection() {
  const [blocks, setBlocks] = useState<ScheduleBlock[]>(() => loadSchedule());
  const [day, setDay] = useState(0);
  const [hour, setHour] = useState(18);
  const [subject, setSubject] = useState(Object.keys(SUBJECT_META)[0] || 'math');

  function persist(next: ScheduleBlock[]) {
    setBlocks(next);
    saveSchedule(next);
    void syncScheduleToServer(next);
  }

  function addBlock() {
    const startMinute = hour * 60;
    const next = blocks.filter(b => !(b.dayOfWeek === day && b.startMinute === startMinute));
    next.push({ id: `${day}-${startMinute}`, subjectKey: subject, dayOfWeek: day, startMinute, durationMinutes: 60 });
    persist(next);
  }

  const sorted = [...blocks].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute);

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Study schedule</p>
      <p className="text-xs text-white/30 mb-4">Your weekly focus blocks — the workspace opens (and gently locks to) the right subject when a block is live.</p>

      <div className="flex flex-wrap gap-2 mb-4">
        <select value={day} onChange={e => setDay(Number(e.target.value))}
          className="bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10">
          {DAY_LABELS.map((d, i) => <option key={d} value={i} className="bg-neutral-900">{d}</option>)}
        </select>
        <select value={hour} onChange={e => setHour(Number(e.target.value))}
          className="bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10">
          {Array.from({ length: 16 }, (_, i) => 6 + i).map(h =>
            <option key={h} value={h} className="bg-neutral-900">{h}:00</option>)}
        </select>
        <select value={subject} onChange={e => setSubject(e.target.value)}
          className="bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10">
          {Object.entries(SUBJECT_META).map(([key, meta]) =>
            <option key={key} value={key} className="bg-neutral-900">{meta.icon} {meta.label}</option>)}
        </select>
        <button onClick={addBlock} className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px]">
          Add block
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-xs text-white/30">No blocks yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {sorted.map(b => {
            const meta = SUBJECT_META[b.subjectKey];
            return (
              <div key={b.id} className="flex items-center justify-between glass-pill rounded-xl px-3 py-2">
                <span className="text-xs text-white/75">
                  {DAY_LABELS[b.dayOfWeek]} · {Math.floor(b.startMinute / 60)}:00 — {meta?.icon} {meta?.label || b.subjectKey}
                </span>
                <button onClick={() => persist(blocks.filter(x => x.id !== b.id))}
                  className="opacity-40 hover:opacity-90 transition-opacity">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Plans (Quanta catalog) + extra credits ──────────────────────────────────

function PlanSection() {
  const [plans, setPlans] = useState<LyceumPlan[]>([]);
  const [current, setCurrent] = useState<CurrentPlan | null>(null);
  const [balance, setBalance] = useState<QuantaBalance | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [busyId, setBusyId] = useState('');
  const [extra, setExtra] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    getPlanCatalog().then(c => setPlans(c.plans.filter(p => p.kind === 'personal'))).catch(() => {});
    getCurrentPlan().then(c => { setCurrent(c); if (c.cycle === 'annual') setCycle('annual'); }).catch(() => {});
    getQuantaBalance().then(setBalance).catch(() => {});
  }, []);

  async function choose(planId: string) {
    setErr(''); setMsg(''); setBusyId(planId);
    try {
      const next = await selectPlan(planId, cycle);
      setCurrent(next);
      setBalance(await getQuantaBalance());
      setMsg(`You're on ${next.plan.name} (${next.cycle}).`);
    } catch (e: any) { setErr(e?.message || 'Could not switch plan.'); }
    finally { setBusyId(''); }
  }

  async function topUp() {
    const amount = Math.floor(Number(extra));
    if (!amount || amount <= 0) { setErr('Enter a positive Quanta amount.'); return; }
    setErr(''); setMsg('');
    try {
      const result = await buyExtraCredits(amount);
      setBalance(result.balance);
      setExtra('');
      setMsg(`Added ${result.added_quanta.toLocaleString()} extra Quanta (= ${(result.added_quanta * (balance?.tokens_per_quanta || 5)).toLocaleString()} tokens).`);
    } catch (e: any) { setErr(e?.message || 'Top-up failed.'); }
  }

  const extraNum = Math.floor(Number(extra)) || 0;

  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-[2px] text-white/40">Plan</p>
        <div className="flex gap-1 rounded-full bg-white/5 p-0.5">
          {(['monthly', 'annual'] as const).map(c => (
            <button key={c} onClick={() => setCycle(c)}
              className={`px-3 py-1 rounded-full text-[10px] uppercase tracking-[1.5px] transition-colors ${cycle === c ? 'bg-white/15 text-white' : 'text-white/40'}`}>
              {c === 'monthly' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-white/30 mb-4">All allowances are in Quanta (1 Quanta = 5 tokens), refreshed every month.</p>

      {balance && (
        <div className="rounded-2xl bg-white/5 px-4 py-3 mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-white/85 font-semibold">{balance.plan_name} <span className="text-[10px] text-white/40 uppercase">{balance.cycle}</span></p>
            <p className="text-[10px] text-white/40">
              ⚡ {balance.standard_remaining.toLocaleString()} / {balance.standard_allowance.toLocaleString()} ·
              Coach {balance.coach_remaining.toLocaleString()} / {balance.coach_allowance.toLocaleString()}
            </p>
          </div>
          <span className="text-2xl">⚡</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
        {plans.map(p => {
          const isCurrent = current?.plan.id === p.id && current?.cycle === cycle && !current?.is_default;
          return (
            <div key={p.id} className={`rounded-2xl px-4 py-3 ${isCurrent ? 'glass-pill-active' : 'glass-pill'}`}>
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm text-white/85 font-semibold">{p.emoji} {p.name}</p>
                {isCurrent ? (
                  <span className="text-[9px] uppercase tracking-[2px] text-purple-300">Current</span>
                ) : (
                  <button onClick={() => choose(p.id)} disabled={busyId === p.id}
                    className="glass-btn rounded-lg px-3 py-1 text-[9px] uppercase tracking-[2px] disabled:opacity-30">
                    {busyId === p.id ? '…' : 'Select'}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-white/45">⚡ {p.standard_quanta.toLocaleString()} Quanta / mo</p>
              <p className="text-[10px] text-white/45">🧭 {p.coach_quanta.toLocaleString()} Coach Quanta / mo</p>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Extra credits</p>
      <div className="flex gap-2">
        <input
          type="number" min={1} value={extra} onChange={e => setExtra(e.target.value)}
          placeholder="Quanta amount"
          className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25"
        />
        <button onClick={topUp} disabled={extraNum <= 0}
          className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30">
          Add
        </button>
      </div>
      {extraNum > 0 && (
        <p className="text-[10px] text-white/35 mt-1">= {(extraNum * (balance?.tokens_per_quanta || 5)).toLocaleString()} tokens</p>
      )}

      {msg && <p className="text-xs text-emerald-300/80 mt-3">{msg}</p>}
      {err && <p className="text-xs text-red-300/80 mt-3">{err}</p>}
    </div>
  );
}

// ── Second Brain customization (the one remaining document door) ───────────

function SecondBrainSection() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [customNotes, setCustomNotes] = useState<{ id: string; title: string; subject: string }[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) listSecondBrainCustom().then(r => setCustomNotes(r.notes)).catch(() => {});
  }, [open]);

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setContent(String(reader.result || ''));
      if (!title) setTitle(file.name.replace(/\.(md|txt)$/i, ''));
    };
    reader.readAsText(file);
  }

  async function submit() {
    if (!content.trim()) { setErr('Add some material first.'); return; }
    setBusy(true); setErr(''); setMsg('');
    try {
      await addSecondBrainNote(title || 'Custom material', content, subject);
      setMsg('Added to your Second Brain — new exercises and notes can now draw on it.');
      setTitle(''); setSubject(''); setContent('');
      setCustomNotes((await listSecondBrainCustom()).notes);
    } catch (e: any) { setErr(e?.message || 'Upload failed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Second Brain</p>
          <p className="text-xs text-white/30">
            Exercises and notes are generated from the Lyceum's Second Brain. Add your own material here if it's missing something.
          </p>
        </div>
        <button onClick={() => setOpen(v => !v)}
          className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] shrink-0 ml-3">
          {open ? 'Close' : 'Customize'}
        </button>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex gap-2">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25" />
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject (optional)"
              className="w-40 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25" />
          </div>
          <textarea
            value={content} onChange={e => setContent(e.target.value)} rows={6}
            placeholder="Paste study material (markdown welcome)…"
            className="bg-white/5 rounded-xl px-3 py-2 text-xs text-white/85 outline-none border border-white/10 focus:border-white/25 resize-y"
          />
          <div className="flex items-center gap-2">
            <button onClick={() => fileRef.current?.click()}
              className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px]">
              Load .md / .txt
            </button>
            <input ref={fileRef} type="file" accept=".md,.txt,.markdown" className="hidden"
              onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} />
            <div className="flex-1" />
            <LiquidMetalButton label={busy ? 'Indexing…' : 'Add to Second Brain'} onClick={submit} />
          </div>

          {customNotes.length > 0 && (
            <div className="border-t border-white/10 pt-3 mt-1">
              <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-2">Your custom material</p>
              <div className="flex flex-col gap-1">
                {customNotes.map(n => (
                  <p key={n.id} className="text-xs text-white/60 truncate">📄 {n.title}{n.subject ? ` · ${n.subject}` : ''}</p>
                ))}
              </div>
            </div>
          )}
          {msg && <p className="text-xs text-emerald-300/80">{msg}</p>}
          {err && <p className="text-xs text-red-300/80">{err}</p>}
        </div>
      )}
    </div>
  );
}

// ── Invite friends ──────────────────────────────────────────────────────────

function InviteSection() {
  const [code, setCode] = useState('');
  const [invited, setInvited] = useState(0);
  const [earned, setEarned] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getReferralInfo().then(info => {
      setCode(info.code); setInvited(info.invited_count); setEarned(info.quanta_earned);
    }).catch(() => {});
  }, []);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(buildInviteLink(code));
      setCopied(true); setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Invite friends</p>
      <p className="text-xs text-white/30 mb-4">Every friend who joins with your link earns you <span className="text-amber-300/90">+5 Quanta</span>.</p>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-xs text-white/70 truncate border border-white/10">
          {code ? buildInviteLink(code) : 'Loading…'}
        </div>
        <button onClick={copy} disabled={!code}
          className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30">
          {copied ? 'Copied!' : 'Copy link'}
        </button>
      </div>
      <p className="text-[10px] text-white/35 mt-2">{invited} friends joined · {earned} Quanta earned</p>
    </div>
  );
}

// ── Appearance ──────────────────────────────────────────────────────────────

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">{t('settings.appearance')}</p>
      <p className="text-xs text-white/30 mb-5">{t('settings.appearanceDesc')}</p>
      <div className="flex gap-3">
        {THEME_OPTIONS.map(({ value, label, icon }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm transition-colors ${
              theme === value ? 'glass-pill-active' : 'glass-pill'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function UnlimitedAccessSection() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function redeem() {
    if (!code.trim() || busy) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      const result = await redeemUnlimitedAccess(code.trim());
      if (result.unlimited) setMsg('Unlimited test access granted — Quanta limits no longer apply to this account.');
      setCode('');
    } catch (e: any) {
      setErr(e?.message || 'Invalid code.');
    } finally { setBusy(false); }
  }

  return (
    <div className="glass-card rounded-3xl p-6">
      <p className="text-[10px] uppercase tracking-[2px] text-white/40 mb-1">Redeem a code</p>
      <p className="text-xs text-white/30 mb-4">Have an unlimited-test access code? Enter it here.</p>
      <div className="flex gap-2">
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="Access code"
          className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25" />
        <button onClick={redeem} disabled={busy || !code.trim()}
          className="glass-btn rounded-xl px-4 py-2 text-[10px] uppercase tracking-[2px] disabled:opacity-30">
          {busy ? '…' : 'Redeem'}
        </button>
      </div>
      {msg && <p className="text-xs text-emerald-300/80 mt-3">{msg}</p>}
      {err && <p className="text-xs text-red-300/80 mt-3">{err}</p>}
    </div>
  );
}

export default function SettingsView() {
  const { t } = useTranslation();

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 py-4">
      <div>
        <h1 className="font-serif text-3xl text-white mb-1">{t('settings.title')}</h1>
        <p className="text-sm text-white/40">{t('settings.subtitle')}</p>
      </div>
      <ProfileSection />
      <ScheduleSection />
      <AppearanceSection />
      <LanguagePicker mode="inline" />
      <PlanSection />
      <TeamSpace />
      <InviteSection />
      <UnlimitedAccessSection />
      <SecondBrainSection />
    </div>
  );
}
