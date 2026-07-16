/**
 * Lemon Squeezy checkout links — overlay checkout (no page navigation) for
 * tiers/cycles that have been wired up manually. Tiers not listed here fall
 * back to the internal Stripe-based checkout flow.
 */

export const LEMON_CHECKOUT_URLS: Partial<Record<string, Partial<Record<'monthly' | 'annual', string>>>> = {
  compass: {
    monthly: 'https://lyceum.lemonsqueezy.com/checkout/buy/f0a185ac-07a1-4194-be96-3f049d6d5c61?embed=1',
    annual: 'https://lyceum.lemonsqueezy.com/checkout/buy/c6e4a4e2-2d06-40ad-a391-2742b42c5bc1?embed=1',
  },
};

export function getLemonCheckoutUrl(tier: string, billingCycle: 'monthly' | 'annual'): string | null {
  return LEMON_CHECKOUT_URLS[tier]?.[billingCycle] ?? null;
}
