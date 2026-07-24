/**
 * ApplyView — registration is closed. "Get Started" leads here instead of
 * straight to sign-up: a short waitlist application. An admin reviews it in
 * the "Xét duyệt người dùng" console (backend: app/routers/admin.py
 * applications_* — accept/decline); AuthPage's sign-up is gated on
 * status === 'accepted' for the applicant's email.
 *
 * Scope: The Lyceum takes learners from grade 10 to first-year university,
 * in Math and Science only. The form collects who they are and what they
 * want to learn, and requires agreement to the Terms and Privacy Policy.
 */

import { useState } from 'react';
import { NavigationProps } from '../types';
import { submitApplication, type ApplicationAnswers, type LearningVector } from '../lib/lyceumApi';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

// Eligible levels only: grade 10 → first-year university.
const GRADE_LEVELS = [
  { value: 'lop_10', label: 'Lớp 10' },
  { value: 'lop_11', label: 'Lớp 11' },
  { value: 'lop_12', label: 'Lớp 12' },
  { value: 'nam_nhat', label: 'Năm nhất đại học' },
];

// Math and Science only.
const SUBJECT_OPTIONS = ['Toán', 'Vật lý', 'Hoá học', 'Sinh học'];

// Grades the "học chương trình quốc tế nào" question applies to — cấp 3.
const HIGH_SCHOOL_GRADES = new Set(['lop_10', 'lop_11', 'lop_12']);

// Matches the Second Brain vault's board field (backend/data/second_brain/
// 01 - IGCSE, 02 - GCSE, 03 - A-Level, 04 - IB, 05 - AP) so an answer here
// lines up directly with curriculum content already in the vault.
const INTERNATIONAL_PROGRAMS = ['Không / chương trình trong nước', 'IGCSE', 'GCSE', 'A-Level', 'IB', 'AP'];

// Submitted silently so the backend keeps its expected shape; no slider UI.
const DEFAULT_VECTOR: LearningVector = {
  encoding_channel: 0.5,
  processing_structure: 0.5,
  engagement_mode: 0.5,
  target_sandbox: 'stem',
  cognitive_friction: 0.5,
};

type Phase = 'start' | 'quiz' | 'result';

export default function ApplyView({ onNavigate }: NavigationProps) {
  const [phase, setPhase] = useState<Phase>('start');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [internationalProgram, setInternationalProgram] = useState('');
  const [subjectPicks, setSubjectPicks] = useState<string[]>([]);
  const [purpose, setPurpose] = useState('');
  const [learningGoal, setLearningGoal] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [budget, setBudget] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [agreed, setAgreed] = useState(false);

  const [resultPriority, setResultPriority] = useState(false);
  const [alreadyDecided, setAlreadyDecided] = useState<string | null>(null);

  const subjectsCombined = subjectPicks.join(', ');
  const isHighSchool = HIGH_SCHOOL_GRADES.has(gradeLevel);
  const quizValid = email.includes('@') && name.trim() !== '' && gradeLevel !== ''
    && subjectsCombined !== '' && purpose.trim() !== '' && learningGoal.trim() !== ''
    && difficulty.trim().length >= 10 && agreed
    && (!isHighSchool || internationalProgram !== '');

  function toggleSubject(s: string) {
    setSubjectPicks(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  async function handleSubmit() {
    if (!quizValid || busy) return;
    setBusy(true); setError('');
    try {
      const answers: ApplicationAnswers = {
        grade_level: gradeLevel,
        subjects: subjectsCombined,
        purpose: purpose.trim(),
        learning_goal: learningGoal.trim(),
        biggest_difficulty: difficulty.trim(),
        budget_usd: Number(budget) || 0,
        agreed_terms: true,
        international_program: isHighSchool ? internationalProgram : '',
      };
      const result = await submitApplication(email.trim(), name.trim(), answers, DEFAULT_VECTOR, referralCode.trim());
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
        {phase === 'quiz' && (
          <div className="h-[2px] bg-white/10 rounded-full mb-10">
            <div className="h-full bg-white/40 rounded-full transition-all duration-500" style={{ width: '60%' }} />
          </div>
        )}

        {/* ── Phase 0: start ── */}
        {phase === 'start' && (
          <div className="glass-card rounded-3xl p-10 text-center flex flex-col items-center gap-5">
            <span className="text-4xl">✦</span>
            <h1 className="font-serif text-3xl">Nộp đơn vào The Lyceum</h1>
            <p className="text-sm text-slate-400 max-w-sm leading-relaxed">
              Dành cho học sinh, sinh viên từ lớp 10 đến năm nhất đại học. Chỉ dạy Toán và Khoa học.
              Chúng tôi xét duyệt từng hồ sơ. Trả lời vài câu hỏi ngắn để bắt đầu.
            </p>
            <LiquidMetalButton label="Bắt đầu" onClick={() => setPhase('quiz')} />
          </div>
        )}

        {/* ── Phase 1: application ── */}
        {phase === 'quiz' && (
          <div className="glass-card rounded-3xl p-8 flex flex-col gap-6">
            <div className="text-center">
              <h1 className="font-serif text-2xl mb-1">Vài câu hỏi ngắn</h1>
              <p className="text-sm text-slate-400">Giúp chúng tôi hiểu bạn cần gì.</p>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Email</p>
                <input
                  type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                  className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
                />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Chúng tôi gọi bạn là gì?</p>
                <input
                  value={name} onChange={e => setName(e.target.value)} placeholder="Tên của bạn"
                  className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
                />
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Bạn đang học lớp nào?</p>
              <div className="flex flex-wrap gap-2">
                {GRADE_LEVELS.map(g => (
                  <button key={g.value} onClick={() => { setGradeLevel(g.value); if (!HIGH_SCHOOL_GRADES.has(g.value)) setInternationalProgram(''); }}
                    className={`px-3 py-2 rounded-xl text-xs transition-colors ${gradeLevel === g.value ? 'glass-pill-active' : 'glass-pill'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* High-school-only: which international program (if any) —
                lines the answer up with the Second Brain vault's curriculum
                content (IGCSE/GCSE/A-Level/IB/AP) ahead of the admin's
                onboarding meeting. */}
            {isHighSchool && (
              <div>
                <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Bạn có đang học hoặc dự định học chương trình quốc tế nào không?</p>
                <div className="flex flex-wrap gap-2">
                  {INTERNATIONAL_PROGRAMS.map(p => (
                    <button key={p} onClick={() => setInternationalProgram(p)}
                      className={`px-3 py-1.5 rounded-xl text-xs transition-colors ${internationalProgram === p ? 'glass-pill-active' : 'glass-pill'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Bạn cần học môn nào? <span className="normal-case tracking-normal text-slate-500">(chọn nhiều được)</span></p>
              <div className="flex flex-wrap gap-2">
                {SUBJECT_OPTIONS.map(s => (
                  <button key={s} onClick={() => toggleSubject(s)}
                    className={`px-3 py-1.5 rounded-xl text-xs transition-colors ${subjectPicks.includes(s) ? 'glass-pill-active' : 'glass-pill'}`}>
                    {subjectPicks.includes(s) ? '✓ ' : ''}{s}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Bạn học để làm gì?</p>
              <textarea
                value={purpose} onChange={e => setPurpose(e.target.value)} rows={2}
                placeholder="Ví dụ: thi học kỳ, thi đại học, thi Olympic, học chắc nền tảng…"
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25 resize-y"
              />
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Mục tiêu cụ thể của bạn?</p>
              <textarea
                value={learningGoal} onChange={e => setLearningGoal(e.target.value)} rows={2}
                placeholder="Ví dụ: nắm vững Giải tích trong 3 tháng, đạt 9+ môn Hoá…"
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25 resize-y"
              />
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Bạn thấy khó nhất ở đâu?</p>
              <textarea
                value={difficulty} onChange={e => setDifficulty(e.target.value)} rows={3}
                placeholder="Càng cụ thể càng tốt — giúp chúng tôi hiểu đúng vấn đề của bạn…"
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25 resize-y"
              />
            </div>

            <div>
              <p className="text-xs uppercase tracking-[2px] text-slate-400 mb-2">Ngân sách cho việc học ($/tháng) <span className="normal-case tracking-normal text-slate-500">(không bắt buộc)</span></p>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">$</span>
                <input
                  type="number" min={0} value={budget} onChange={e => setBudget(e.target.value)} placeholder="0"
                  className="flex-1 bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
                />
              </div>
            </div>

            <div>
              <input
                value={referralCode} onChange={e => setReferralCode(e.target.value)} placeholder="Mã giới thiệu (nếu có) — được xét ưu tiên"
                className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25"
              />
            </div>

            {/* Required Terms + Privacy agreement */}
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 shrink-0 accent-white"
              />
              <span className="text-xs text-slate-400 leading-relaxed">
                Tôi đồng ý với{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-slate-200 underline hover:text-white">Điều khoản dịch vụ</a>
                {' '}và{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-slate-200 underline hover:text-white">Chính sách quyền riêng tư</a>.
              </span>
            </label>

            {error && <p className="text-xs text-red-300/80">{error}</p>}

            <div className="flex items-center justify-between pt-1">
              <button onClick={() => setPhase('start')} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                ← Quay lại
              </button>
              <LiquidMetalButton label={busy ? 'Đang gửi…' : 'Nộp đơn'} onClick={handleSubmit} />
            </div>
            {!quizValid && (
              <p className="text-[11px] text-slate-500 text-right -mt-3">
                {agreed ? 'Hoàn thành các mục để nộp đơn.' : 'Cần đồng ý Điều khoản và Chính sách quyền riêng tư để tiếp tục.'}
              </p>
            )}
          </div>
        )}

        {/* ── Phase 2: result ── */}
        {phase === 'result' && (
          <div className="glass-card rounded-3xl p-10 text-center flex flex-col items-center gap-4">
            {alreadyDecided === 'accepted' ? (
              <>
                <span className="text-4xl">✦</span>
                <h1 className="font-serif text-2xl">Hồ sơ của bạn đã được duyệt</h1>
                <p className="text-sm text-slate-400 max-w-sm">Bạn có thể đăng ký tài khoản ngay bây giờ.</p>
                <LiquidMetalButton label="Đăng ký tài khoản" onClick={() => onNavigate('auth')} />
              </>
            ) : alreadyDecided === 'declined' ? (
              <>
                <span className="text-4xl">✦</span>
                <h1 className="font-serif text-2xl">Hồ sơ đã được xem xét</h1>
                <p className="text-sm text-slate-400 max-w-sm">Rất tiếc, hồ sơ này chưa phù hợp ở thời điểm hiện tại.</p>
              </>
            ) : (
              <>
                <span className="text-4xl">✦</span>
                <h1 className="font-serif text-2xl">Đã nhận hồ sơ của bạn</h1>
                <p className="text-sm text-slate-400 max-w-sm">
                  Chúng tôi sẽ xem xét và báo qua email khi bạn được duyệt.
                </p>
                {resultPriority && (
                  <span className="text-[10px] uppercase tracking-[2px] text-slate-300 bg-white/10 rounded-full px-3 py-1">
                    Nhóm ưu tiên xét duyệt
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
