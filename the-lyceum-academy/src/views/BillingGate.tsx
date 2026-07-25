/**
 * BillingGate — the paywall. A full page, not a modal: there is no overlay to
 * dismiss, no X, no "maybe later". A signed-in account without an active or
 * trialing subscription sees this instead of the workspace.
 *
 * Deliberately NOT a trap, though: signing out is always available and clearly
 * labelled. The gate withholds the product until the card is on file; it does
 * not hold the person's account hostage.
 *
 * Trial terms are stated plainly up front — length, that a card is required
 * now, and that the first charge lands when the trial ends. Burying any of
 * that would be the kind of surprise-billing pattern that gets a payment
 * processor to close your account.
 */
import { useEffect, useState } from 'react';
import { CreditCard, ShieldCheck } from 'lucide-react';
import { getSubscriptionPlans, createCheckoutSession, type SubscriptionPlan } from '../lib/subscriptionApi';
import { signOut, auth } from '../lib/firebase';
import { LiquidMetalButton } from '../../components/ui/liquid-metal-button';

const TRIAL_DAYS = 4;

export default function BillingGate() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSubscriptionPlans()
      .then(list => {
        const paid = list.filter(p => p.tier !== 'free' && p.billing_cycle === 'monthly');
        setPlans(paid);
        if (paid.length) setSelected(paid[0].id);
      })
      .catch(() => setError('Không tải được danh sách gói. Thử lại sau ít phút.'));
  }, []);

  async function startCheckout() {
    if (!selected || busy) return;
    setBusy(true); setError('');
    try {
      const { checkout_url } = await createCheckoutSession(selected);
      window.location.href = checkout_url;
    } catch {
      setError('Không mở được trang thanh toán. Thử lại sau ít phút.');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050508] text-slate-200 font-sans antialiased flex flex-col items-center px-4 py-14">
      <div className="w-full max-w-lg">
        <p className="font-serif text-xl tracking-[4px] uppercase text-slate-300 text-center mb-10">
          The Lyceum
        </p>

        <div className="glass-card rounded-3xl p-8 flex flex-col gap-6">
          <div className="text-center">
            <CreditCard className="w-8 h-8 text-purple-300 mx-auto mb-3" strokeWidth={1.4} />
            <h1 className="font-serif text-2xl text-white mb-2">
              Thêm thẻ để bắt đầu {TRIAL_DAYS} ngày dùng thử
            </h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              Bạn cần thêm thẻ ngay bây giờ, nhưng sẽ <span className="text-slate-200">không bị trừ tiền
              trong {TRIAL_DAYS} ngày đầu</span>. Hết {TRIAL_DAYS} ngày, gói bạn chọn bên dưới sẽ
              được tính phí lần đầu. Huỷ bất cứ lúc nào trước đó thì không mất gì.
            </p>
          </div>

          {plans.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs uppercase tracking-[2px] text-slate-400">Chọn gói</p>
              {plans.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm transition-colors ${
                    selected === p.id ? 'glass-pill-active' : 'glass-pill'
                  }`}
                >
                  <span className="capitalize">{p.tier}</span>
                  <span className="font-mono">${p.price_usd}/tháng</span>
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-red-300/80">{error}</p>}

          <div className="flex flex-col items-center gap-3">
            <LiquidMetalButton
              label={busy ? 'Đang mở thanh toán…' : `Thêm thẻ · dùng thử ${TRIAL_DAYS} ngày`}
              onClick={startCheckout}
            />
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Thanh toán xử lý bởi Stripe. Chúng tôi không lưu số thẻ.
            </p>
          </div>

          <div className="border-t border-white/10 pt-4 text-center">
            <p className="text-[11px] text-slate-500 mb-2">
              Chưa muốn thêm thẻ? Bạn có thể đăng xuất và quay lại sau — tài khoản vẫn còn.
            </p>
            <button
              onClick={() => signOut(auth)}
              className="text-xs text-slate-400 hover:text-slate-200 underline transition-colors"
            >
              Đăng xuất
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          <a href="/terms" className="hover:text-slate-400 underline">Điều khoản</a>
          {' · '}
          <a href="/privacy" className="hover:text-slate-400 underline">Quyền riêng tư</a>
        </p>
      </div>
    </div>
  );
}
