/**
 * ApplyView — registration is closed. "Get Started" leads here instead of
 * straight to sign-up: a short placement quiz + a 4-axis learning-style
 * slider dashboard, submitted as a waitlist application. An admin reviews
 * it in the "Xét duyệt người dùng" console (backend: app/routers/admin.py
 * applications_* — accept/decline); AuthPage's sign-up is gated on
 * status === 'accepted' for the applicant's email.
 *
 * The slider dashboard produces the "Vector Matrix" the Coach uses as a
 * personalization preset (which view renders first, hint-ladder style,
 * opening line) — see backend app/services/applications.py.
 */

import { useState } from 'react';
import { NavigationProps } from '../types';
import { submitApplication, type ApplicationAnswers, type LearningVector } from '../lib/lyceumApi';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

const GRADE_LEVELS = [
  { value: 'thcs', label: 'Trung học cơ sở (THCS)' },
  { value: 'thpt', label: 'Trung học phổ thông (THPT)' },
  { value: 'dai_hoc', label: 'Đại học' },
  { value: 'sau_dai_hoc', label: 'Sau đại học' },
  { value: 'di_lam', label: 'Đi làm / tự học' },
];

const RESEARCH_FREQUENCIES = [
  { value: 'chua_bao_gio', label: 'Chưa bao giờ' },
  { value: 'thinh_thoang', label: 'Thỉnh thoảng' },
  { value: 'thuong_xuyen', label: 'Thường xuyên' },
  { value: 'rat_thuong_xuyen', label: 'Rất thường xuyên' },
];

const SANDBOXES: { value: LearningVector['target_sandbox']; label: string }[] = [
  { value: 'stem', label: 'STEM (tổng quát)' },
  { value: 'physics', label: 'Vật lý' },
  { value: 'chemistry', label: 'Hoá học' },
  { value: 'math', label: 'Toán' },
  { value: 'general_research', label: 'Nghiên cứu tổng quát' },
];

interface SliderDef {
  key: keyof Pick<LearningVector, 'encoding_channel' | 'processing_structure' | 'engagement_mode'>;
  left: string; leftSub: string;
  right: string; rightSub: string;
}

const SLIDERS: SliderDef[] = [
  {
    key: 'encoding_channel',
    left: 'SPATIAL / VISUAL', leftSub: 'Sơ đồ, hình họa, 3D vector',
    right: 'VERBAL / NARRATIVE', rightSub: 'Văn bản, ẩn dụ, kể chuyện',
  },
  {
    key: 'processing_structure',
    left: 'GLOBAL / INTUITIVE', leftSub: 'Bức tranh toàn cảnh trước',
    right: 'SEQUENTIAL / PROCEDURAL', rightSub: 'Từng bước 1 → 2 → 3',
  },
  {
    key: 'engagement_mode',
    left: 'ACTIVE / DERIVATION', leftSub: 'Va chạm ngay, thử-sai',
    right: 'REFLECTIVE / CONCEPTUAL', rightSub: 'Trầm tư trước khi giải',
  },
];

const DEFAULT_VECTOR: LearningVector = {
  encoding_channel: 0.65,
  processing_structure: 0.5,
  engagement_mode: 0.5,
  target_sandbox: 'stem',
  cognitive_friction: 0.5,
};

type Phase = 'quiz' | 'vectors' | 'result';

export default function ApplyView({ onNavigate }: NavigationProps) {
  const [phase, setPhase] = useState<Phase>('quiz');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [gradeLevel, setGradeLevel] = useState('');
  const [doesResearch, setDoesResearch] = useState<'yes' | 'no' | ''>('');
  const [researchFrequency, setResearchFrequency] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [budget, setBudget] = useState('');

  const [vector, setVector] = useState<LearningVector>(DEFAULT_VECTOR);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [referralCode, setReferralCode] = useState('');

  const [resultPriority, setResultPriority] = useState(false);
  const [alreadyDecided, setAlreadyDecided] = useState<string | null>(null);

  const quizValid = gradeLevel && doesResearch && difficulty.trim().length >= 10 && budget.trim() !== '';

  function setSlider(key: SliderDef['key'], value: number) {
    setVector(v => ({ ...v, [key]: value }));
  }

  async function handleSubmit() {
    if (!email.includes('@') || busy) return;
    setBusy(true); setError('');
    try {
      const answers: ApplicationAnswers = {
        grade_level: gradeLevel,
        does_research: doesResearch as 'yes' | 'no',
        research_frequency: doesResearch === 'yes' ? researchFrequency : 'n/a',
        biggest_difficulty: difficulty.trim(),
        budget_usd: Number(budget) || 0,
      };
      const result = await submitApplication(email.trim(), name.trim(), answers, vector, referralCode.trim());
      if (result.already_decided) {
        setAlreadyDecided(result.status);
      } else {
        setResultPriority(result.priority);
      }
      setPhase('result');
    } catch (e: any) {
      setError(e?.message || 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative bg-[#050508] text-slate-200 font-sans antialiased min-h-screen flex flex-col items-center px-4 py-14">
      <div className="w-full max-w-xl">
        <div
          className="font-serif text-xl tracking-[4px] uppercase text-slate-300 cursor-pointer text-center mb-10"
          onClick={() => onNavigate('landing')}
        >
          The Lyceum
        </div>

        {/* Progress */}
        {phase !== 'result' && (
          <div className="h-[2px] bg-white/10 rounded-full mb-10">
            <div
              className="h-full bg-gradient-to-r from-purple-400 to-amber-300 rounded-full transition-all duration-500"
              style={{ width: phase === 'quiz' ? '35%' : '80%' }}
            />
          </div>
        )}

        {/* ── Phase 1: placement quiz ── */}
        {phase === 'quiz' && (
          <div className="glass-card rounded-3xl p-8 flex flex-col gap-6">
            <div className="text-center">
              <h1 className="font-serif text-2xl mb-1">Trước khi bắt đầu</h1>
              <p className="text-sm text-slate-400">Đăng ký hiện đóng — Lyceum xét duyệt từng hồ sơ. Vài câu hỏi ngắn để bắt đầu.</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Bạn đang học cấp nào?</p>
              <div className="flex flex-wrap gap-2">
                {GRADE_LEVELS.map(g => (
                  <button key={g.value} onClick={() => setGradeLevel(g.value)}
                    className={`px-3 py-2 rounded-xl text-xs transition-colors ${gradeLevel === g.value ? 'glass-pill-active' : 'glass-pill'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Bạn có làm nghiên cứu khoa học không?</p>
              <div className="flex gap-2 mb-3">
                {(['yes', 'no'] as const).map(v => (
                  <button key={v} onClick={() => setDoesResearch(v)}
                    className={`px-4 py-2 rounded-xl text-xs transition-colors ${doesResearch === v ? 'glass-pill-active' : 'glass-pill'}`}>
                    {v === 'yes' ? 'Có' : 'Không'}
                  </button>
                ))}
              </div>
              {doesResearch === 'yes' && (
                <div className="flex flex-wrap gap-2">
                  {RESEARCH_FREQUENCIES.map(f => (
                    <button key={f.value} onClick={() => setResearchFrequency(f.value)}
                      className={`px-3 py-1.5 rounded-xl text-[11px] transition-colors ${researchFrequency === f.value ? 'glass-pill-active' : 'glass-pill'}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Điều gì khiến bạn gặp khó khăn nhất trong học tập?</p>
              <textarea
                value={difficulty}
                onChange={e => setDifficulty(e.target.value)}
                rows={4}
                placeholder="Càng cụ thể càng tốt — điều này giúp Lyceum hiểu đúng vấn đề của bạn…"
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25 resize-y"
              />
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Ngân sách của bạn cho sản phẩm hỗ trợ học tập là bao nhiêu? ($/tháng)</p>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">$</span>
                <input
                  type="number" min={0} value={budget} onChange={e => setBudget(e.target.value)}
                  placeholder="0"
                  className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <LiquidMetalButton label="Tiếp tục" onClick={() => quizValid && setPhase('vectors')} />
            </div>
            {!quizValid && (
              <p className="text-[11px] text-slate-500 text-right -mt-4">Hoàn thành tất cả các mục để tiếp tục.</p>
            )}
          </div>
        )}

        {/* ── Phase 2: learning-style vector dashboard ── */}
        {phase === 'vectors' && (
          <div className="glass-card rounded-3xl p-8 flex flex-col gap-7">
            <div className="text-center">
              <h1 className="font-serif text-2xl mb-1">Bộ não của bạn vận hành thế nào?</h1>
              <p className="text-sm text-slate-400">Kéo các thanh trượt — không có câu trả lời đúng/sai, chỉ có cách phù hợp với bạn.</p>
            </div>

            {SLIDERS.map(s => (
              <div key={s.key}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-left">
                    <p className="text-[11px] font-semibold text-purple-300">{s.left}</p>
                    <p className="text-[10px] text-slate-500">{s.leftSub}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] font-semibold text-amber-300">{s.right}</p>
                    <p className="text-[10px] text-slate-500">{s.rightSub}</p>
                  </div>
                </div>
                <input
                  type="range" min={0} max={100} value={Math.round(vector[s.key] * 100)}
                  onChange={e => setSlider(s.key, Number(e.target.value) / 100)}
                  className="w-full accent-purple-400"
                  style={{
                    background: `linear-gradient(to right, rgba(196,164,255,0.6) 0%, rgba(196,164,255,0.6) ${vector[s.key] * 100}%, rgba(252,211,77,0.6) ${vector[s.key] * 100}%, rgba(252,211,77,0.6) 100%)`,
                    height: 4, borderRadius: 2, appearance: 'none', WebkitAppearance: 'none', outline: 'none', cursor: 'pointer',
                  }}
                />
              </div>
            ))}

            <div>
              <p className="text-[11px] uppercase tracking-[2px] text-slate-400 mb-2">Vùng kiến thức mục tiêu</p>
              <div className="flex flex-wrap gap-2">
                {SANDBOXES.map(sb => (
                  <button key={sb.value} onClick={() => setVector(v => ({ ...v, target_sandbox: sb.value }))}
                    className={`px-3 py-1.5 rounded-xl text-[11px] transition-colors ${vector.target_sandbox === sb.value ? 'glass-pill-active' : 'glass-pill'}`}>
                    {sb.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[11px] font-semibold text-emerald-300">LOW FRICTION</p>
                <p className="text-[11px] font-semibold text-red-300">HIGH — PURE LYCEUM MODE</p>
              </div>
              <input
                type="range" min={0} max={100} value={Math.round(vector.cognitive_friction * 100)}
                onChange={e => setVector(v => ({ ...v, cognitive_friction: Number(e.target.value) / 100 }))}
                className="w-full"
                style={{
                  background: `linear-gradient(to right, rgba(110,231,183,0.6) 0%, rgba(110,231,183,0.6) ${vector.cognitive_friction * 100}%, rgba(252,165,165,0.6) ${vector.cognitive_friction * 100}%, rgba(252,165,165,0.6) 100%)`,
                  height: 4, borderRadius: 2, appearance: 'none', WebkitAppearance: 'none', outline: 'none', cursor: 'pointer',
                }}
              />
              <p className="text-[10px] text-slate-500 mt-1">
                {vector.cognitive_friction < 0.5
                  ? 'AI sẽ gợi ý nhanh hơn khi bạn bị kẹt.'
                  : 'AI sẽ liên tục hỏi ngược, ép bạn tự vắt óc đến tận cùng — không đưa đáp án sẵn.'}
              </p>
            </div>

            <div className="border-t border-white/10 pt-6 flex flex-col gap-3">
              <input
                value={name} onChange={e => setName(e.target.value)} placeholder="Tên của bạn"
                className="bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
              />
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email"
                className="bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
              />
              <input
                value={referralCode} onChange={e => setReferralCode(e.target.value)} placeholder="Mã giới thiệu (nếu có) — được xét ưu tiên"
                className="bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
              />
            </div>

            {error && <p className="text-xs text-red-300/80">{error}</p>}

            <div className="flex items-center justify-between pt-1">
              <button onClick={() => setPhase('quiz')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                ← Quay lại
              </button>
              <LiquidMetalButton
                label={busy ? 'Đang gửi…' : 'Nộp đơn'}
                onClick={handleSubmit}
              />
            </div>
          </div>
        )}

        {/* ── Phase 3: result ── */}
        {phase === 'result' && (
          <div className="glass-card rounded-3xl p-10 text-center flex flex-col items-center gap-4">
            {alreadyDecided === 'accepted' ? (
              <>
                <span className="text-5xl">✦</span>
                <h1 className="font-serif text-2xl">Hồ sơ của bạn đã được duyệt</h1>
                <p className="text-sm text-slate-400 max-w-sm">Bạn có thể đăng ký tài khoản ngay bây giờ.</p>
                <LiquidMetalButton label="Đăng ký tài khoản" onClick={() => onNavigate('auth')} />
              </>
            ) : alreadyDecided === 'declined' ? (
              <>
                <span className="text-5xl">✦</span>
                <h1 className="font-serif text-2xl">Hồ sơ đã được xem xét</h1>
                <p className="text-sm text-slate-400 max-w-sm">Rất tiếc, hồ sơ này chưa phù hợp ở thời điểm hiện tại.</p>
              </>
            ) : (
              <>
                <span className="text-5xl">🕊️</span>
                <h1 className="font-serif text-2xl">Chúc mừng — bạn đã vào danh sách chờ!</h1>
                <p className="text-sm text-slate-400 max-w-sm">
                  Đội ngũ Lyceum sẽ xem xét hồ sơ của bạn sớm nhất có thể. Chúng tôi sẽ báo qua email khi bạn được duyệt.
                </p>
                {resultPriority && (
                  <span className="text-[10px] uppercase tracking-[2px] text-amber-300 bg-amber-400/10 rounded-full px-3 py-1">
                    ✓ Nhóm ưu tiên xét duyệt
                  </span>
                )}
              </>
            )}
            <button onClick={() => onNavigate('landing')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors mt-2">
              ← Về trang chủ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
