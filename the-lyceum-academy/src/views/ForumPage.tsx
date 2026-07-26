/**
 * ForumPage — thelyceum.site/forum. A community gated on an active paid
 * plan (checked server-side against the real Stripe subscription, see
 * backend/app/services/forum.py's has_paid_plan). Reachable only from the
 * top-right link inside a signed-in student's own workspace (MainLayout) —
 * not a public/invite-code funnel.
 *
 * Deliberately NOT asking founder/business questions (role, business
 * email/name, industry, stage) — this is a study community for The Lyceum's
 * own paying students, not a startup-founder networking product. The
 * backend still accepts those fields (role defaults to a harmless value,
 * unused group-classification runs on empty strings and falls back to a
 * default group) so nothing there needed touching — this is a frontend-only
 * simplification of what's actually asked.
 */
import { useEffect, useState } from 'react';
import { listForumGroups, applyToForum, dmThreadId, type ForumGroup, type ForumMember } from '../lib/forum';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';
import SuggestedConnections from './SuggestedConnections';
import ForumChat from './ForumChat';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function IntakeForm({ onJoined }: { onJoined: (m: ForumMember) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [about, setAbout] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = name.trim() && EMAIL_RE.test(email.trim());

  async function submit() {
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {
      const res = await applyToForum({
        name: name.trim(), email: email.trim().toLowerCase(),
        linkedin_url: '', target_customer_description: about.trim(),
      });
      onJoined(res.member);
    } catch (e: any) {
      const msg = e?.message || '';
      setError(
        msg.includes('paid_plan_required')
          ? 'Forum chỉ dành cho tài khoản đang có gói trả phí — nâng cấp ở Settings rồi quay lại nhé.'
          : msg || 'Could not submit — try again.',
      );
    } finally { setBusy(false); }
  }

  const inputCls = 'w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-white/90 outline-none border border-white/10 focus:border-white/25';

  return (
    <div className="glass-card rounded-3xl p-6 md:p-8 max-w-xl mx-auto">
      <p className="text-xs uppercase tracking-[2px] text-purple-300 mb-1">Apply for admission</p>
      <h2 className="font-serif text-2xl text-white mb-6">Join the community</h2>

      <div className="flex flex-col gap-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name *" className={inputCls} />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email *" type="email" className={inputCls} />
        <textarea value={about} onChange={e => setAbout(e.target.value)} rows={3}
          placeholder="What are you hoping to get from this community? (optional)" className={`${inputCls} resize-y`} />

        {error && <p className="text-xs text-red-300/80">{error}</p>}

        <div className="flex justify-end mt-2">
          <LiquidMetalButton label={busy ? 'Submitting…' : 'Join'} onClick={submit} />
        </div>
        {!valid && <p className="text-[11px] text-slate-500">Name and a valid email are required.</p>}
      </div>
    </div>
  );
}

function WelcomeCard({ member, onOpenGroup }: { member: ForumMember; onOpenGroup: (groupId: string) => void }) {
  return (
    <div className="glass-card rounded-3xl p-6 md:p-8 max-w-xl mx-auto text-center">
      <p className="text-xs uppercase tracking-[2px] text-purple-300 mb-1">Welcome, {member.name}</p>
      <h2 className="font-serif text-2xl text-white mb-4">You're in.</h2>

      {member.groups.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-6">
          {member.groups.map(g => (
            <button key={g.id} onClick={() => onOpenGroup(g.id)} className="glass-pill rounded-full px-3 py-1.5 text-[11px] hover:bg-white/10">
              {g.name}
            </button>
          ))}
        </div>
      )}

      <p className="text-3xl font-serif text-metallic mb-1">{member.foundi_balance} Foundi</p>
      <p className="text-xs text-slate-500">100 for joining.</p>
    </div>
  );
}

export default function ForumPage() {
  const [groups, setGroups] = useState<ForumGroup[]>([]);
  const [member, setMember] = useState<ForumMember | null>(null);
  const [chatThreadId, setChatThreadId] = useState<string | null>(null);

  useEffect(() => {
    listForumGroups().then(r => setGroups(r.groups)).catch(() => {});
  }, []);

  return (
    <div className="relative bg-[#050508] text-slate-200 font-sans antialiased min-h-screen">
      <header className="max-w-4xl mx-auto px-4 pt-10 pb-6 flex items-center justify-between">
        <a href="/" className="font-serif text-lg tracking-[3px] uppercase text-slate-300">The Lyceum</a>
        <span className="text-xs uppercase tracking-[2px] text-purple-300">Forum</span>
      </header>

      <main className="max-w-4xl mx-auto px-4 pb-20">
        <div className="text-center mb-12">
          <p className="text-xs uppercase tracking-[2px] text-purple-300 mb-3">Dành cho tài khoản trả phí</p>
          <h1 className="font-garamond text-3xl md:text-5xl text-metallic mb-4">The community for students who take this seriously</h1>
          <p className="text-slate-400 text-sm max-w-lg mx-auto">
            Not a feed — a room full of people working through the same subjects you are, right now.
          </p>
        </div>

        {!member && groups.length > 0 && (
          <div className="mb-12">
            <p className="text-xs uppercase tracking-[2px] text-slate-500 mb-4 text-center">Active groups</p>
            <div className="flex flex-wrap justify-center gap-2">
              {groups.map(g => (
                <span key={g.id} className="glass rounded-full px-4 py-2 text-xs text-slate-300">
                  {g.name} <span className="text-slate-500">· {g.member_count}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {member ? (
          <>
            <WelcomeCard member={member} onOpenGroup={gid => setChatThreadId(`group:${gid}`)} />
            <div className="mt-12">
              <SuggestedConnections onConnect={email => setChatThreadId(dmThreadId(member.email, email))} />
            </div>
          </>
        ) : (
          <IntakeForm onJoined={setMember} />
        )}
      </main>

      {chatThreadId && member && (
        <ForumChat threadId={chatThreadId} selfEmail={member.email} onClose={() => setChatThreadId(null)} />
      )}
    </div>
  );
}
