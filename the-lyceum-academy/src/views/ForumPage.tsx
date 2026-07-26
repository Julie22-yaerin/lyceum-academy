/**
 * ForumPage — thelyceum.site/forum. A community gated on an active paid
 * plan (checked server-side against the real Stripe subscription, see
 * backend/app/services/forum.py's has_paid_plan) with two roles: founders
 * (join stage/industry groups, AI-classified) and visitors (people looking
 * for a product — no groups, but eligible for AI-suggested customer
 * connections). Reachable only from the top-right link inside a signed-in
 * student's own workspace (MainLayout) — not a public/invite-code funnel,
 * so there's no referral capture or share-link mechanic here.
 */
import { useEffect, useState } from 'react';
import { Lightbulb, Hammer, Rocket, TrendingUp, Landmark, type LucideIcon } from 'lucide-react';
import {
  listForumGroups, applyToForum, dmThreadId,
  type ForumGroup, type ForumMember, type ForumRole,
} from '../lib/forum';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';
import SuggestedConnections from './SuggestedConnections';
import ForumChat from './ForumChat';

const STAGES: { icon: LucideIcon; name: string }[] = [
  { icon: Lightbulb, name: 'Idea Validation' },
  { icon: Hammer, name: 'MVP' },
  { icon: Rocket, name: 'Launch' },
  { icon: TrendingUp, name: 'Growth' },
  { icon: Landmark, name: 'Scale' },
];

const INDUSTRIES = ['SaaS', 'Fintech', 'E-commerce', 'Hardware', 'Marketplace', 'Other'];

const LINKEDIN_RE = /^https?:\/\/([\w.-]+\.)?linkedin\.com\/.+/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function IntakeForm({ onJoined }: { onJoined: (m: ForumMember) => void }) {
  const [role, setRole] = useState<ForumRole>('founder');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [stage, setStage] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [lookingForCustomers, setLookingForCustomers] = useState(false);
  const [targetCustomerDescription, setTargetCustomerDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const valid = role === 'founder'
    ? name.trim() && EMAIL_RE.test(email.trim()) && LINKEDIN_RE.test(linkedinUrl.trim()) && stage
    : name.trim() && EMAIL_RE.test(email.trim()) && LINKEDIN_RE.test(linkedinUrl.trim());

  async function submit() {
    if (!valid || busy) return;
    setBusy(true); setError('');
    try {
      const res = await applyToForum({
        name: name.trim(), email: email.trim().toLowerCase(),
        linkedin_url: linkedinUrl.trim(), role,
        business_email: businessEmail.trim(), business_name: businessName.trim(),
        industry, stage, photo_url: photoUrl.trim(),
        looking_for_customers: role === 'founder' ? lookingForCustomers : false,
        target_customer_description: targetCustomerDescription.trim(),
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

      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => setRole('founder')}
          className={`flex-1 px-3 py-2.5 rounded-xl text-xs ${role === 'founder' ? 'glass-pill-active' : 'glass-pill'}`}>
          I'm a founder
        </button>
        <button type="button" onClick={() => setRole('visitor')}
          className={`flex-1 px-3 py-2.5 rounded-xl text-xs ${role === 'visitor' ? 'glass-pill-active' : 'glass-pill'}`}>
          I'm looking for a product
        </button>
      </div>

      <div className="flex flex-col gap-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name *" className={inputCls} />
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Personal email *" type="email" className={inputCls} />

        {role === 'founder' && (
          <>
            <input value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} placeholder="Business email (if any)" type="email" className={inputCls} />
            <input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business name (if any)" className={inputCls} />

            <div>
              <p className="text-[10px] uppercase tracking-[2px] text-slate-500 mb-2">Industry</p>
              <div className="flex flex-wrap gap-2">
                {INDUSTRIES.map(i => (
                  <button key={i} type="button" onClick={() => setIndustry(i)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] ${industry === i ? 'glass-pill-active' : 'glass-pill'}`}>
                    {i}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-[2px] text-slate-500 mb-2">Stage *</p>
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {STAGES.map((s, idx) => {
                  const Icon = s.icon;
                  const active = stage === s.name;
                  return (
                    <div key={s.name} className="flex items-center shrink-0">
                      <button type="button" onClick={() => setStage(s.name)}
                        className={`flex flex-col items-center gap-1.5 rounded-2xl px-3 py-2.5 transition-colors ${active ? 'bg-purple-400/15 border border-purple-400/40' : 'border border-white/10 hover:border-white/25'}`}>
                        <Icon className={`w-4 h-4 ${active ? 'text-purple-300' : 'text-slate-400'}`} />
                        <span className={`text-[10px] whitespace-nowrap ${active ? 'text-purple-200' : 'text-slate-400'}`}>{s.name}</span>
                      </button>
                      {idx < STAGES.length - 1 && <div className="w-4 h-px bg-white/10 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <input value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="LinkedIn profile URL *" className={inputCls} />
        <input value={photoUrl} onChange={e => setPhotoUrl(e.target.value)} placeholder="Photo URL (optional)" className={inputCls} />

        {role === 'founder' ? (
          <div>
            <button type="button" onClick={() => setLookingForCustomers(v => !v)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-xs mb-2 ${lookingForCustomers ? 'glass-pill-active' : 'glass-pill'}`}>
              {lookingForCustomers ? '✓ ' : ''}Looking for customers / customer connections?
            </button>
            {lookingForCustomers && (
              <textarea value={targetCustomerDescription} onChange={e => setTargetCustomerDescription(e.target.value)} rows={3}
                placeholder="Describe exactly who your target customer is…" className={`${inputCls} resize-y`} />
            )}
          </div>
        ) : (
          <textarea value={targetCustomerDescription} onChange={e => setTargetCustomerDescription(e.target.value)} rows={3}
            placeholder="What are you looking for?" className={`${inputCls} resize-y`} />
        )}

        {error && <p className="text-xs text-red-300/80">{error}</p>}

        <div className="flex justify-end mt-2">
          <LiquidMetalButton label={busy ? 'Submitting…' : 'Join'} onClick={submit} />
        </div>
        {!valid && <p className="text-[11px] text-slate-500">Name, personal email{role === 'founder' ? ', stage,' : ''} and a valid LinkedIn URL are required.</p>}
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
          <h1 className="font-garamond text-3xl md:text-5xl text-metallic mb-4">The community for founders who take this seriously</h1>
          <p className="text-slate-400 text-sm max-w-lg mx-auto">
            Grouped by stage and industry, matched by an AI reviewer — not a feed, a room full of people
            solving the same problem you are, right now.
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
