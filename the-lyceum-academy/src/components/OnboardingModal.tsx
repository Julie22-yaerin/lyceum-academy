/**
 * OnboardingModal — shown once after first login.
 * 8 questions → Meta Llama 3.1 70B analysis → pricing recommendation → PayPal sandbox.
 *
 * Persistence:
 *   localStorage 'lyceum_onboarding_done'  — boolean, hides modal on next visit
 *   localStorage 'lyceum_plan'             — chosen plan id
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { analyzeOnboarding } from '../lib/api';

// ── Question config ─────────────────────────────────────────────────────────

type QType = 'single' | 'multi' | 'text';
interface OQ { id: string; text: string; type: QType; options?: string[]; max?: number; hint?: string; }

const QUESTIONS: OQ[] = [
  {
    id: 'q1', type: 'single',
    text: 'Mục đích học chính của bạn là gì?',
    options: ['Qua môn', 'GPA cao', 'Nghiên cứu', 'Tự học ngoài chương trình'],
  },
  {
    id: 'q2', type: 'text',
    text: 'Bạn đang học ngành gì?',
    hint: 'Ví dụ: Computer Science, Y khoa, Kinh tế, Vật lý…',
  },
  {
    id: 'q3', type: 'single',
    text: 'Một tuần bạn học bao nhiêu giờ?',
    options: ['< 5 giờ', '5 – 10 giờ', '10 – 20 giờ', '20+ giờ'],
  },
  {
    id: 'q4', type: 'single',
    text: 'Bạn thường học bao nhiêu môn cùng lúc?',
    options: ['1–2 môn', '3–4 môn', '5+ môn'],
  },
  {
    id: 'q5', type: 'multi', max: 3,
    text: 'Vấn đề bạn đang đau đầu nhất? (chọn tối đa 3)',
    options: [
      'Không hiểu lecture/note/PDF sau khi đọc',
      'Quá nhiều tài liệu, không biết phân bổ thời gian',
      'Thiếu roadmap học tập',
      'Mơ hồ trong việc tự đánh giá tiến độ',
      'Không có người đồng hành / người để hỏi',
      'Hỏi AI nhưng bị ngợp hoặc không hiểu câu trả lời',
      'Nhiều môn, không biết phân bổ',
      'Deadline nhiều, không biết quản lý thời gian',
      'Khác',
    ],
  },
  {
    id: 'q6', type: 'multi', max: 3,
    text: 'Bạn thường upload tài liệu cỡ nào mỗi tuần? (chọn tối đa 3)',
    options: [
      '3+ môn/tuần',
      '1–3 môn/tuần',
      'Vài lecture YouTube ≤7 video/tuần',
      'Nhiều lecture YouTube >7 video/tuần',
      'Vài PDF/note — tổng dưới 10 trang',
      'Vài PDF/note — tổng khoảng/trên 10 trang',
    ],
  },
  {
    id: 'q7', type: 'multi', max: 3,
    text: 'Bạn thích học kiểu nào? (chọn tối đa 3)',
    options: [
      'Được khám phá (mở rộng, ứng dụng thực tế)',
      'Được dẫn dắt từng bước',
      'Được thử thách tư duy',
      'Được cho framework để lên điểm',
      'Được thảo luận và có góc nhìn đa chiều',
      'Khác',
    ],
  },
  {
    id: 'q8', type: 'multi', max: 3,
    text: 'Bạn dành phần lớn thời gian học cho việc gì? (chọn tối đa 3)',
    options: ['Đọc lý thuyết', 'Làm bài tập', 'Làm project', 'Đọc paper', 'Ôn thi'],
  },
];

// ── Pricing plans (client-side display config) ──────────────────────────────

interface Plan {
  id: string; name: string; price: number; emoji: string;
  tagline: string; color: string; features: string[]; flagship?: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'compass', name: 'Compass', price: 9.99, emoji: '🌱', color: '#4A7C59',
    tagline: '"Tôi bị lạc."',
    features: ['Roadmap học tập cá nhân hoá', 'Neural Map cơ bản', 'Progress tracking', 'Planner tuần'],
  },
  {
    id: 'scholar', name: 'Scholar', price: 19.99, emoji: '🎓', color: '#C5A059',
    tagline: 'Flagship — 80% users', flagship: true,
    features: ['Chấm bài AI (Meta + Gemma)', 'Neural Map đầy đủ', 'Roadmap', 'AI discussion', 'Reflection', 'Planner'],
  },
  {
    id: 'builder', name: 'Builder', price: 24.99, emoji: '🚀', color: '#2563EB',
    tagline: '"Học để làm."',
    features: ['Skill roadmap', 'Project roadmap', 'Learning dependency graph', 'AI mentor', '+ Tất cả Scholar'],
  },
  {
    id: 'polymath', name: 'Polymath', price: 34.99, emoji: '🧠', color: '#7C3AED',
    tagline: '"Bộ não thứ hai."',
    features: ['Cross-domain Neural Map', 'Long-term memory', 'Multi-subject planning', 'Knowledge graph nâng cao', '+ Tất cả Scholar'],
  },
  {
    id: 'research', name: 'Research', price: 39.99, emoji: '🔬', color: '#DC2626',
    tagline: '"Paper, thesis, nghiên cứu."',
    features: ['Paper analysis', 'Figure explanation', 'Citation map', 'Literature comparison', '+ Tất cả Scholar'],
  },
];

// ── PayPal loader ────────────────────────────────────────────────────────────

const PAYPAL_CLIENT_ID = (import.meta as any).env?.VITE_PAYPAL_CLIENT_ID || '';

function loadPayPalScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).paypal) { resolve(); return; }
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD&intent=capture&components=buttons`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('PayPal SDK failed to load'));
    document.head.appendChild(s);
  });
}

// ── Sub-components ───────────────────────────────────────────────────────────

function PayPalButtons({ plan, onSuccess }: { plan: Plan; onSuccess: (planId: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const rendered = useRef(false);

  useEffect(() => {
    if (!PAYPAL_CLIENT_ID || PAYPAL_CLIENT_ID === 'YOUR_PAYPAL_SANDBOX_CLIENT_ID') {
      setError('PayPal Client ID chưa được cấu hình. Thêm VITE_PAYPAL_CLIENT_ID vào .env');
      return;
    }
    loadPayPalScript()
      .then(() => setReady(true))
      .catch(() => setError('Không tải được PayPal SDK.'));
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || rendered.current) return;
    rendered.current = true;
    const pp = (window as any).paypal;
    pp.Buttons({
      style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay', height: 40 },
      createOrder: (_data: any, actions: any) => {
        return actions.order.create({
          purchase_units: [{ amount: { value: plan.price.toFixed(2) }, description: `Lyceum ${plan.name} — Monthly` }],
        });
      },
      onApprove: async (_data: any, actions: any) => {
        await actions.order.capture();
        onSuccess(plan.id);
      },
      onError: (err: any) => {
        console.error('PayPal error', err);
        setError('Thanh toán thất bại. Thử lại.');
      },
    }).render(containerRef.current);
  }, [ready]);

  if (error) return <p style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(220,38,38,0.8)', padding: '6px 0', lineHeight: 1.5 }}>{error}</p>;
  if (!ready) return <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>Loading…</span></div>;
  return <div ref={containerRef} />;
}

function PlanCard({
  plan, recommended, isAlt, onSelect, selected, onSuccess,
}: {
  plan: Plan; recommended: boolean; isAlt: boolean; onSelect: () => void;
  selected: boolean; onSuccess: (planId: string) => void;
}) {
  const dim = !recommended && !isAlt;
  return (
    <div
      onClick={onSelect}
      style={{
        border: `2px solid ${recommended ? plan.color : isAlt ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)'}`,
        borderRadius: 6,
        padding: '18px 20px',
        background: recommended ? `${plan.color}08` : 'white',
        opacity: dim ? 0.35 : 1,
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
        transform: recommended ? 'scale(1.02)' : 'scale(1)',
        boxShadow: recommended ? `0 4px 24px ${plan.color}28` : 'none',
        flex: '0 0 auto',
        width: 210,
        flexShrink: 0,
      }}
    >
      {recommended && (
        <div style={{
          position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
          background: plan.color, color: 'white', fontFamily: 'sans-serif',
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', padding: '2px 10px',
          borderRadius: 10, whiteSpace: 'nowrap',
        }}>✦ Phù hợp với bạn</div>
      )}
      {isAlt && !recommended && (
        <div style={{
          position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)', color: 'white', fontFamily: 'sans-serif',
          fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', padding: '2px 8px',
          borderRadius: 10, whiteSpace: 'nowrap',
        }}>Cũng phù hợp</div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 22 }}>{plan.emoji}</span>
        <span style={{ fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 400 }}>{plan.name}</span>
        {plan.flagship && (
          <span style={{ fontFamily: 'sans-serif', fontSize: 8, letterSpacing: 1, textTransform: 'uppercase', background: plan.color, color: 'white', padding: '1px 6px', borderRadius: 2 }}>★ Best</span>
        )}
      </div>

      <div style={{ fontFamily: 'Georgia, serif', fontSize: 22, fontWeight: 700, color: plan.color, marginBottom: 2 }}>
        ${plan.price}<span style={{ fontSize: 12, fontWeight: 400, color: 'rgba(0,0,0,0.4)' }}>/tháng</span>
      </div>
      <p style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.5)', margin: '0 0 12px 0', fontStyle: 'italic' }}>{plan.tagline}</p>

      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {plan.features.map(f => (
          <li key={f} style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-start', gap: 5 }}>
            <span style={{ color: plan.color, flexShrink: 0 }}>✓</span>{f}
          </li>
        ))}
      </ul>

      {selected && (
        <div style={{ marginTop: 4 }}>
          <PayPalButtons plan={plan} onSuccess={onSuccess} />
        </div>
      )}

      {!selected && (
        <div style={{
          width: '100%', padding: '8px 0', border: `1.5px solid ${plan.color}60`,
          borderRadius: 4, fontFamily: 'sans-serif', fontSize: 10,
          letterSpacing: 2, textTransform: 'uppercase', textAlign: 'center',
          color: plan.color, background: 'transparent',
        }}>
          Chọn gói này
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);         // 0-7 = questions, 8 = pricing
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [aiResult, setAiResult] = useState<{
    recommended_plan_id?: string;
    reasoning?: string;
    alternatives?: { plan_id: string; reason: string }[];
  } | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const [entering, setEntering] = useState(false);

  const q = QUESTIONS[step];

  // ── Answer helpers ──────────────────────────────────────────────────────────
  const isSingleDone = q?.type === 'single' && typeof answers[q.id] === 'string' && (answers[q.id] as string).length > 0;
  const isTextDone   = q?.type === 'text'   && typeof answers[q.id] === 'string' && (answers[q.id] as string).trim().length > 0;
  const isMultiDone  = q?.type === 'multi'  && Array.isArray(answers[q.id]) && (answers[q.id] as string[]).length > 0;
  const canAdvance = isSingleDone || isTextDone || isMultiDone;

  function toggleMulti(opt: string) {
    const cur = (answers[q.id] as string[] | undefined) || [];
    if (cur.includes(opt)) {
      setAnswers(a => ({ ...a, [q.id]: cur.filter(x => x !== opt) }));
    } else if (cur.length < (q.max ?? 99)) {
      setAnswers(a => ({ ...a, [q.id]: [...cur, opt] }));
    }
  }

  async function advance() {
    if (step < QUESTIONS.length - 1) {
      setEntering(true);
      setTimeout(() => { setStep(s => s + 1); setEntering(false); }, 120);
    } else {
      // Last question done → analyze
      setStep(QUESTIONS.length); // pricing screen
      setAnalyzing(true);
      try {
        const result = await analyzeOnboarding(answers);
        setAiResult(result);
        if (result.recommended_plan_id) setSelectedPlan(result.recommended_plan_id);
      } catch {
        setAiResult({});
      } finally {
        setAnalyzing(false);
      }
    }
  }

  function handlePaySuccess(planId: string) {
    localStorage.setItem('lyceum_onboarding_done', '1');
    localStorage.setItem('lyceum_plan', planId);
    setPaid(true);
    setTimeout(onClose, 2200);
  }

  function handleSkip() {
    localStorage.setItem('lyceum_onboarding_done', '1');
    onClose();
  }

  const recPlan = PLANS.find(p => p.id === aiResult?.recommended_plan_id);
  const altIds  = (aiResult?.alternatives || []).map(a => a.plan_id);

  const progress = step >= QUESTIONS.length ? 1 : step / QUESTIONS.length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Georgia, serif',
    }}>
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.96); } to { opacity:1; transform:scale(1); } }
        .ob-enter { animation: fadeSlideIn 0.22s ease-out; }
        .ob-scale { animation: scaleIn 0.28s cubic-bezier(0.23,1,0.32,1); }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #ccc; }
      `}</style>

      {/* Modal panel */}
      <div className="ob-scale" style={{
        background: '#FAFAF8', borderRadius: 8, width: '92vw', maxWidth: step >= QUESTIONS.length ? 1060 : 560,
        maxHeight: '88vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
        transition: 'max-width 0.4s cubic-bezier(0.23,1,0.32,1)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 28px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 4, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>
              {step < QUESTIONS.length ? `The Lyceum — Setup  ${step + 1} / ${QUESTIONS.length}` : 'The Lyceum — Gói phù hợp với bạn'}
            </span>
            <button onClick={handleSkip} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.28)' }}>
              Bỏ qua
            </button>
          </div>
          {/* Progress bar */}
          <div style={{ height: 2, background: 'rgba(0,0,0,0.08)', borderRadius: 2, marginBottom: 2 }}>
            <div style={{ height: '100%', background: '#C5A059', borderRadius: 2, width: `${progress * 100}%`, transition: 'width 0.4s ease' }} />
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px 28px' }}>
          {/* ── Success state ── */}
          {paid && (
            <div className="ob-enter" style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✦</div>
              <p style={{ fontSize: 22, marginBottom: 8 }}>Chào mừng đến với The Lyceum</p>
              <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.5)' }}>Đang khởi động không gian học tập…</p>
            </div>
          )}

          {/* ── Pricing screen ── */}
          {!paid && step >= QUESTIONS.length && (
            <div>
              {analyzing ? (
                <div style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ width: 32, height: 32, border: '2px solid rgba(0,0,0,0.12)', borderTop: '2px solid #C5A059', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  <p style={{ fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)' }}>Phân tích câu trả lời…</p>
                </div>
              ) : (
                <div className="ob-enter">
                  {aiResult?.reasoning && (
                    <div style={{ background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.35)', borderRadius: 6, padding: '14px 18px', marginBottom: 24 }}>
                      <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: '#C5A059', display: 'block', marginBottom: 6 }}>Đánh giá từ AI</span>
                      <p style={{ fontFamily: 'sans-serif', fontSize: 13, color: 'rgba(0,0,0,0.72)', margin: 0, lineHeight: 1.6 }}>{aiResult.reasoning}</p>
                    </div>
                  )}

                  <p style={{ fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.4)', marginBottom: 18 }}>
                    Chọn gói và thanh toán để bắt đầu
                  </p>

                  {/* Plan cards — horizontal scroll on small screens */}
                  <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 10, paddingTop: 14 }}>
                    {PLANS.map(plan => (
                      <PlanCard
                        key={plan.id}
                        plan={plan}
                        recommended={plan.id === aiResult?.recommended_plan_id}
                        isAlt={altIds.includes(plan.id) && plan.id !== aiResult?.recommended_plan_id}
                        selected={selectedPlan === plan.id}
                        onSelect={() => { setSelectedPlan(plan.id === selectedPlan ? null : plan.id); }}
                        onSuccess={handlePaySuccess}
                      />
                    ))}
                  </div>

                  {aiResult?.alternatives && aiResult.alternatives.length > 0 && (
                    <div style={{ marginTop: 16, borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 14 }}>
                      <span style={{ fontFamily: 'sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(0,0,0,0.35)' }}>Gói khác cũng phù hợp</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
                        {aiResult.alternatives.map(alt => {
                          const p = PLANS.find(x => x.id === alt.plan_id);
                          return p ? (
                            <div key={alt.plan_id} style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 4, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span>{p.emoji}</span>
                              <span style={{ fontFamily: 'sans-serif', fontSize: 11, fontWeight: 600 }}>{p.name}</span>
                              <span style={{ fontFamily: 'sans-serif', fontSize: 10, color: 'rgba(0,0,0,0.45)' }}>— {alt.reason}</span>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Question steps ── */}
          {!paid && step < QUESTIONS.length && (
            <div key={step} className="ob-enter" style={{ opacity: entering ? 0 : 1, transition: 'opacity 0.1s' }}>
              <h2 style={{ fontSize: 22, fontWeight: 400, lineHeight: 1.4, marginBottom: 28, color: 'rgba(0,0,0,0.85)' }}>
                {q.text}
              </h2>

              {/* Single choice */}
              {q.type === 'single' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {q.options!.map(opt => {
                    const active = answers[q.id] === opt;
                    return (
                      <button key={opt} onClick={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                        style={{
                          padding: '14px 20px', textAlign: 'left', border: `1.5px solid ${active ? '#C5A059' : 'rgba(0,0,0,0.14)'}`,
                          borderRadius: 5, background: active ? 'rgba(197,160,89,0.08)' : 'white',
                          cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 14, color: active ? '#8B6914' : 'rgba(0,0,0,0.75)',
                          transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 12,
                        }}>
                        <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${active ? '#C5A059' : 'rgba(0,0,0,0.2)'}`, background: active ? '#C5A059' : 'transparent', flexShrink: 0, transition: 'all 0.15s' }} />
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Free text */}
              {q.type === 'text' && (
                <input
                  type="text"
                  value={(answers[q.id] as string) || ''}
                  onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                  placeholder={q.hint}
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && canAdvance) advance(); }}
                  style={{
                    width: '100%', padding: '14px 18px', border: '1.5px solid rgba(0,0,0,0.2)',
                    borderRadius: 5, fontFamily: 'Georgia, serif', fontSize: 15, color: 'rgba(0,0,0,0.85)',
                    outline: 'none', background: 'white', boxSizing: 'border-box',
                  }}
                />
              )}

              {/* Multi choice */}
              {q.type === 'multi' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {q.options!.map(opt => {
                    const sel = ((answers[q.id] as string[] | undefined) || []).includes(opt);
                    const atMax = ((answers[q.id] as string[] | undefined) || []).length >= (q.max ?? 99);
                    return (
                      <button key={opt} onClick={() => toggleMulti(opt)}
                        disabled={!sel && atMax}
                        style={{
                          padding: '11px 18px', textAlign: 'left', border: `1.5px solid ${sel ? '#C5A059' : 'rgba(0,0,0,0.12)'}`,
                          borderRadius: 5, background: sel ? 'rgba(197,160,89,0.08)' : 'white',
                          cursor: (!sel && atMax) ? 'not-allowed' : 'pointer',
                          fontFamily: 'sans-serif', fontSize: 13,
                          color: sel ? '#8B6914' : (!sel && atMax) ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.72)',
                          transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 10,
                          opacity: (!sel && atMax) ? 0.5 : 1,
                        }}>
                        <span style={{
                          width: 16, height: 16, border: `2px solid ${sel ? '#C5A059' : 'rgba(0,0,0,0.2)'}`,
                          background: sel ? '#C5A059' : 'transparent', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.15s', borderRadius: 2,
                        }}>
                          {sel && <span style={{ color: 'white', fontSize: 9, fontWeight: 700 }}>✓</span>}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                  <p style={{ fontFamily: 'sans-serif', fontSize: 11, color: 'rgba(0,0,0,0.35)', margin: '4px 0 0 0' }}>
                    Đã chọn {((answers[q.id] as string[] | undefined) || []).length} / {q.max}
                  </p>
                </div>
              )}

              {/* Next button */}
              <button
                onClick={advance}
                disabled={!canAdvance}
                style={{
                  marginTop: 28, padding: '13px 36px', background: canAdvance ? '#C5A059' : 'rgba(0,0,0,0.08)',
                  border: 'none', borderRadius: 5, cursor: canAdvance ? 'pointer' : 'not-allowed',
                  fontFamily: 'sans-serif', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
                  color: canAdvance ? '#1a1a1a' : 'rgba(0,0,0,0.25)', fontWeight: 700, transition: 'all 0.15s',
                }}>
                {step === QUESTIONS.length - 1 ? 'Xem kết quả →' : 'Tiếp →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
