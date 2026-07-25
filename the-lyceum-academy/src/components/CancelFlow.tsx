/**
 * CancelFlow — what a subscriber sees when they ask to cancel. Three layers,
 * each declinable, in order:
 *   1. 65% off for staying
 *   2. book a call with the founder for +200 Quanta
 *   3. the actual cancellation
 *
 * On visual hierarchy: "stay / continue" is the primary button and the save
 * offers get the visual weight — that is ordinary, legitimate emphasis. What
 * this deliberately does NOT do is camouflage the cancel option (white-on-
 * white, near-invisible text, fake-disabled styling). Every step keeps a
 * clearly readable way out, because a cancel control the user cannot find is
 * a deceptive pattern — it breaks FTC "click to cancel" and EU consumer
 * rules, and the students this product targets (ADHD / attention difficulty)
 * are exactly the people such tricks harm most. Secondary, yes. Hidden, no.
 */
import { useEffect, useState } from 'react';
import { BadgePercent, CalendarClock, X } from 'lucide-react';
import {
  recordCancelIntent, acceptRetentionDiscount, acceptRetentionCallBonus, recordCancellation,
  createPortalSession,
} from '../lib/subscriptionApi';
import BookCallButton from './BookCallButton';

type Step = 'discount' | 'call' | 'confirm' | 'saved';

export default function CancelFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('discount');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => { recordCancelIntent().catch(() => {}); }, []);

  async function takeDiscount() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await acceptRetentionDiscount();
      setNotice(r.message || 'Đã áp dụng ưu đãi.');
      setStep('saved');
    } catch {
      setNotice('Không áp dụng được lúc này — chúng tôi sẽ liên hệ để xử lý thủ công.');
      setStep('saved');
    } finally { setBusy(false); }
  }

  async function takeCallBonus() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await acceptRetentionCallBonus();
      setNotice(r.message || 'Đã cộng Quanta.');
      setStep('saved');
    } catch {
      setNotice('Không cộng được Quanta lúc này — nhắc chúng tôi trong buổi gọi.');
      setStep('saved');
    } finally { setBusy(false); }
  }

  async function confirmCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await recordCancellation(reason).catch(() => {});
      // Stripe owns the actual cancellation — send them to the portal, which
      // is also where they can restart later.
      const { portal_url } = await createPortalSession();
      window.location.href = portal_url;
    } catch {
      setNotice('Không mở được trang quản lý thanh toán. Thử lại, hoặc email cho chúng tôi.');
      setBusy(false);
    }
  }

  const shell = 'fixed inset-0 z-[200] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4';
  const card = 'glass-card rounded-3xl p-8 w-full max-w-md flex flex-col gap-5';
  // Secondary actions: quieter than the primary button, but full-contrast text
  // that is unambiguously readable and obviously clickable.
  const secondary = 'text-sm text-slate-300 hover:text-white underline underline-offset-4 transition-colors';

  if (step === 'saved') {
    return (
      <div className={shell}>
        <div className={`${card} text-center`}>
          <p className="text-3xl">✦</p>
          <h2 className="font-serif text-2xl text-white">Xong</h2>
          <p className="text-sm text-slate-400 leading-relaxed">{notice}</p>
          <button
            onClick={onClose}
            className="mt-2 rounded-xl px-6 py-3 text-[11px] uppercase tracking-[2px] bg-purple-400/15 text-purple-200 hover:bg-purple-400/25 transition-colors"
          >
            Về workspace
          </button>
        </div>
      </div>
    );
  }

  if (step === 'discount') {
    return (
      <div className={shell}>
        <div className={card}>
          <div className="flex items-start justify-between">
            <BadgePercent className="w-8 h-8 text-amber-300" strokeWidth={1.4} />
            <button onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div>
            <h2 className="font-serif text-2xl text-white mb-2">Trước khi bạn đi — giảm 65%?</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Nếu vấn đề là giá, chúng tôi hạ 65% cho kỳ tiếp theo. Cùng workspace,
              cùng Faculty, không giới hạn nào bị cắt.
            </p>
          </div>
          <button
            onClick={takeDiscount}
            disabled={busy}
            className="w-full rounded-xl px-6 py-3.5 text-sm font-semibold bg-white text-black hover:bg-white/90 disabled:opacity-40 transition-colors"
          >
            {busy ? 'Đang áp dụng…' : 'Nhận giảm 65% và tiếp tục'}
          </button>
          <button onClick={() => setStep('call')} className={secondary}>
            Không, tôi vẫn muốn huỷ
          </button>
        </div>
      </div>
    );
  }

  if (step === 'call') {
    return (
      <div className={shell}>
        <div className={card}>
          <div className="flex items-start justify-between">
            <CalendarClock className="w-8 h-8 text-cyan-300" strokeWidth={1.4} />
            <button onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div>
            <h2 className="font-serif text-2xl text-white mb-2">Nói chuyện 15 phút, nhận 200 Quanta</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Đặt lịch gọi trực tiếp để chúng tôi hiểu chỗ nào chưa dùng được.
              Đặt lịch xong, 200 Quanta vào ví bạn ngay — kể cả khi sau đó bạn vẫn huỷ.
            </p>
          </div>
          <BookCallButton
            label="Đặt lịch gọi"
            className="w-full rounded-xl px-6 py-3.5 text-sm font-semibold bg-white text-black hover:bg-white/90 transition-colors text-center"
          />
          <button onClick={takeCallBonus} disabled={busy} className={secondary}>
            {busy ? 'Đang cộng Quanta…' : 'Tôi đã đặt lịch — cộng Quanta cho tôi'}
          </button>
          <button onClick={() => setStep('confirm')} className={secondary}>
            Không, tôi vẫn muốn huỷ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className={card}>
        <div className="flex items-start justify-between">
          <h2 className="font-serif text-2xl text-white">Xác nhận huỷ</h2>
          <button onClick={onClose} aria-label="Đóng" className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed">
          Bạn giữ quyền truy cập tới hết kỳ đã trả. Cho chúng tôi biết lý do nếu bạn muốn —
          không bắt buộc.
        </p>
        <textarea
          value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="Lý do (không bắt buộc)…"
          className="w-full bg-white/5 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none border border-white/10 focus:border-white/25 resize-y"
        />
        {notice && <p className="text-xs text-red-300/80">{notice}</p>}
        <button
          onClick={confirmCancel}
          disabled={busy}
          className="w-full rounded-xl px-6 py-3.5 text-sm font-semibold bg-red-500/15 text-red-200 border border-red-400/30 hover:bg-red-500/25 disabled:opacity-40 transition-colors"
        >
          {busy ? 'Đang mở trang quản lý…' : 'Huỷ đăng ký'}
        </button>
        <button onClick={onClose} className={secondary}>
          Quay lại, tôi không huỷ nữa
        </button>
      </div>
    </div>
  );
}
