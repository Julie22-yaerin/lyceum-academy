# SOC-6 Deployment Checklist
## Lyceum Billing & Feature Gating Implementation

**Issue**: SOC-6 — Xây billing + feature gating theo gói Lyceum  
**Date**: 2026-07-08  
**Status**: ✅ Implementation Complete — Ready for Deployment

---

## 📋 Implementation Summary

Complete billing infrastructure for 4-tier subscription model:
- **Compass**: $9.99/mo, $99.99/yr — 15 min voice/month
- **Scholar**: $19.99/mo, $199.99/yr — 60 min voice/month  
- **Mentor**: $29.99/mo, $299.99/yr — 180 min voice/month
- **Researcher**: $49.99/mo, $499.99/yr — unlimited voice (600 min soft cap)

### ✅ Completed Components

#### Backend (Python/FastAPI)
- [x] Database models (`backend/app/models/entities.py`)
  - SubscriptionPlan, UserSubscription, VoiceUsageRecord, FeatureUsageLog
  - All enums: SubscriptionTierEnum, BillingCycleEnum, SubscriptionStatusEnum
- [x] Migration schema (`backend/migrations/002_billing_subscriptions.sql`)
  - 4 tables + indexes + seed data for 8 plans (4 tiers × 2 cycles)
- [x] API endpoints (`backend/app/routers/subscriptions.py`)
  - GET /subscriptions/plans — list all plans
  - POST /subscriptions/checkout — create Stripe session
  - GET /subscriptions/current — user's active subscription
  - GET /subscriptions/usage — billing period usage stats
  - POST /subscriptions/portal — Stripe customer portal
  - POST /subscriptions/voice/start — start voice session tracking
  - POST /subscriptions/voice/end — end session, calculate duration
  - POST /subscriptions/feature-log — log roadmap regen, etc.
  - POST /webhooks/stripe — Stripe webhook handler
- [x] Router registration in main.py (lines 155, 200-201)

#### Frontend (React/TypeScript)
- [x] API client (`src/lib/subscriptionApi.ts`)
  - All 8 API endpoints wrapped with auth
  - Feature gate helpers (canUseVoice, canUseMindMap, etc.)
- [x] React hooks (`src/lib/useSubscription.ts`)
  - useSubscription() — subscription state + usage
  - useVoiceGate() — voice ARI limits
  - useMindMapGate() — Scholar+ only
  - useReferenceLibraryGate() — 20/100/∞ items
  - useRoadmapRegenGate() — 1/3/∞ daily regens
- [x] Upgrade modal (`src/components/UpgradePrompt.tsx`)
  - 4 feature variants (voice/mindmap/reference/roadmap)
  - Redirects to /pricing
- [x] Pricing view (`src/views/PricingView.tsx`)

---

## 🚀 Deployment Steps

### 1. Database Migration

Run the SQL migration to create subscription tables:

```bash
# Connect to your PostgreSQL database
psql -U <user> -d <database> -f backend/migrations/002_billing_subscriptions.sql
```

**Verification:**
```sql
-- Should return 8 rows (4 tiers × 2 billing cycles)
SELECT tier, billing_cycle, price_usd_cents FROM subscription_plans ORDER BY price_usd_cents;
```

### 2. Stripe Configuration

**Required Environment Variables:**
```bash
# Backend .env
STRIPE_SECRET_KEY=sk_live_...  # or sk_test_... for testing
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=https://lyceum-academy.vercel.app  # for checkout redirect
```

**Stripe Dashboard Setup:**

1. **Create Products** (one per tier):
   - Compass
   - Scholar
   - Mentor  
   - Researcher

2. **Create Prices** (2 per product = 8 total):
   - Compass Monthly: $9.99/month → get price_id (e.g. `price_1ABC...`)
   - Compass Annual: $99.99/year → get price_id
   - Scholar Monthly: $19.99/month → get price_id
   - Scholar Annual: $199.99/year → get price_id
   - Mentor Monthly: $29.99/month → get price_id
   - Mentor Annual: $299.99/year → get price_id
   - Researcher Monthly: $49.99/month → get price_id
   - Researcher Annual: $499.99/year → get price_id

3. **Update Database with Stripe Price IDs:**
   ```sql
   UPDATE subscription_plans 
   SET stripe_price_id = 'price_1ABC...' 
   WHERE tier = 'compass' AND billing_cycle = 'monthly';
   
   -- Repeat for all 8 plans
   ```

4. **Configure Webhook Endpoint:**
   - URL: `https://your-backend.railway.app/webhooks/stripe`
   - Events to listen for:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
   - Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

### 3. Backend Deployment

**Environment Variables Checklist:**
- [x] `STRIPE_SECRET_KEY`
- [x] `STRIPE_WEBHOOK_SECRET`
- [x] `FRONTEND_URL`
- [x] `DATABASE_URL` (existing)
- [x] `GOOGLE_API_KEY` (existing)

**Deploy:**
```bash
cd backend
# Railway/Heroku will auto-deploy on git push
# OR manual:
git push railway main
```

**Post-deploy verification:**
```bash
# Test plans endpoint (no auth required)
curl https://your-backend.railway.app/subscriptions/plans

# Should return 8 plans
```

### 4. Frontend Deployment

**Environment Variables:**
```bash
# Vite .env
VITE_API_URL=https://your-backend.railway.app
VITE_SUPABASE_URL=...  # existing
VITE_SUPABASE_ANON_KEY=...  # existing
```

**Deploy:**
```bash
cd the-lyceum-academy
npm run build
# Vercel auto-deploys on git push
```

### 5. End-to-End Testing

#### Test Checkout Flow
1. Navigate to `/pricing`
2. Click "Upgrade" on any plan
3. Should redirect to Stripe Checkout
4. Complete test payment (use test card `4242 4242 4242 4242`)
5. Should redirect back to success URL
6. Verify subscription created: `GET /subscriptions/current`

#### Test Voice ARI Tracking
1. Start voice session in app (VoiceOrb component)
2. Backend calls `POST /subscriptions/voice/start` → returns session_id
3. Use voice for N seconds
4. Backend calls `POST /subscriptions/voice/end` with session_id
5. Check usage: `GET /subscriptions/usage` → voice_minutes_used should increase

#### Test Feature Gates
1. **Mind Map** (Compass user):
   - Navigate to mind map tool
   - Should see lock icon + upgrade prompt
2. **Reference Library** (Scholar user with 20 saved items):
   - Try to add 21st item
   - Should see "Reference Library Full" modal
3. **Roadmap Regen** (Scholar user, 3 regens used today):
   - Try to regenerate roadmap 4th time
   - Should see "Daily Roadmap Limit Reached" modal
4. **Voice ARI** (Compass user, 15 min used):
   - Try to start voice session
   - Should see "Voice ARI Limit Reached" modal

#### Test Stripe Webhooks
1. Trigger a test webhook from Stripe Dashboard
2. Check backend logs for webhook processing
3. Verify subscription status updated in database

### 6. Production Rollout

**Phased Rollout Plan:**

1. **Week 1: Beta Testing** (10 users)
   - Invite 10 users to test checkout flow
   - Monitor Stripe dashboard + backend logs
   - Fix any critical bugs

2. **Week 2: Soft Launch** (all users)
   - Enable pricing page for all users
   - Show banner: "New subscription plans available!"
   - Monitor conversion + support tickets

3. **Week 3: Full Launch**
   - Remove free tier / enforce gates
   - Marketing push

---

## 📊 Monitoring & Metrics

### Key Metrics to Track

1. **Conversion Rate**: Free → Paid
2. **MRR** (Monthly Recurring Revenue)
3. **Churn Rate**: Canceled subscriptions / Active subscriptions
4. **Feature Adoption**:
   - % of users hitting voice limits
   - % of users using mind maps
   - Roadmap regen frequency

### Dashboards to Set Up

1. **Stripe Dashboard**: Revenue, active subscriptions, failed payments
2. **Backend Analytics** (add to `subscriptions.py`):
   ```python
   # Log subscription events
   POST /subscriptions/checkout → log "checkout_started"
   Webhook subscription.created → log "subscription_activated"
   ```
3. **Frontend Analytics** (add to components):
   ```typescript
   // Track upgrade prompt impressions
   logEvent('upgrade_prompt_shown', { feature: 'voice', tier: 'compass' })
   ```

---

## 🐛 Known Issues & Limitations

### Current Limitations
1. **No trial period** — users charged immediately (add `trial_period_days` to Stripe if needed)
2. **No promo codes** — add Stripe Coupons if needed
3. **No seat-based billing** — only per-user subscriptions
4. **Fair-use cap** for Researcher tier (600 min) is soft — not enforced in code

### Future Enhancements (out of scope for SOC-6)
- [ ] Usage-based billing for voice minutes (Stripe metered billing)
- [ ] Team/organization subscriptions
- [ ] Annual discount auto-apply (currently manual)
- [ ] Downgrade flow (currently requires customer portal)

---

## 📚 Architecture Reference

### Database Schema
```
subscription_plans (8 rows, seeded)
  ├─ tier: enum(compass, scholar, mentor, researcher)
  ├─ billing_cycle: enum(monthly, annual)
  └─ limits: voice_minutes_monthly, reference_library_limit, roadmap_regen_daily_limit

user_subscriptions (1:1 with users)
  ├─ plan_id → subscription_plans
  ├─ stripe_customer_id, stripe_subscription_id
  └─ current_period_start, current_period_end

voice_usage_records (many per user)
  ├─ user_id, billing_period_start
  └─ duration_seconds (summed for usage)

feature_usage_logs (many per user)
  ├─ user_id, feature_name
  └─ created_at (counted for daily/monthly limits)
```

### API Flow: Checkout
```
Frontend                Backend                 Stripe
   |                       |                       |
   |-- POST /checkout ---->|                       |
   |   {plan_id}           |-- Create Customer -->|
   |                       |<-- customer_id ------|
   |                       |                       |
   |                       |-- Create Session --->|
   |                       |<-- checkout_url -----|
   |<-- {checkout_url} ----|                       |
   |                       |                       |
   |--------------- Redirect to Stripe ----------->|
   |                       |                       |
   |<-- Payment Complete (Stripe redirects) ------|
   |                       |                       |
   |                       |<-- Webhook: ----------|
   |                       |    subscription.created
   |                       |                       |
   |                       |-- Update DB --------->|
```

### Feature Gate Flow
```
Component (e.g. VoiceOrb)
   |
   |-- useVoiceGate() ------> useSubscription()
   |                             |
   |                             |-- GET /subscriptions/usage
   |                             |
   |<-- { canUse, remaining } ---|
   |
   |-- if (!canUse) -------> <UpgradePrompt feature="voice" />
   |                             |
   |                             |-- navigate('/pricing')
```

---

## ✅ Final Checklist

Before marking SOC-6 as **done**:

- [x] All database models defined
- [x] Migration script ready
- [x] All API endpoints implemented
- [x] Stripe integration code complete
- [x] Frontend hooks + UI components built
- [ ] Migration run in production DB
- [ ] Stripe products/prices configured
- [ ] Environment variables set
- [ ] End-to-end checkout flow tested
- [ ] All 4 feature gates tested
- [ ] Webhook endpoint verified
- [ ] Monitoring dashboards set up

---

## 🎯 Success Criteria (from SOC-6)

1. ✅ Subscription tiers (Compass/Scholar/Mentor/Researcher) with correct pricing
2. ✅ Billing cycle support (monthly + annual)
3. ✅ Voice ARI usage tracking (S2S sessions counted in minutes)
4. ✅ Feature gates:
   - Voice ARI: 15/60/180/∞ min per tier
   - Mind Map: disabled for Compass, enabled for Scholar+
   - Reference Library: 20/100/∞ items
   - Roadmap Regen: 1/3/∞ daily regenerations
5. ✅ No limits on chat/exercise/mistake bank/notes (free for all tiers)
6. ✅ UI labels changed from "STEM" → "Mentor"

---

## 📞 Support & Troubleshooting

### Common Issues

**"Failed to create checkout session"**
- Check `STRIPE_SECRET_KEY` is set
- Verify `stripe_price_id` is populated in database
- Check backend logs for Stripe API errors

**"No active subscription" error**
- Webhook may have failed — check Stripe webhook logs
- Manually verify subscription in Stripe Dashboard
- Check `user_subscriptions` table for user's record

**Feature gate not working**
- Verify usage tracking is logging correctly: `SELECT * FROM voice_usage_records`
- Check `GET /subscriptions/usage` returns correct counts
- Ensure frontend is calling `logFeatureUsage()` on each action

---

## 📝 Deployment Sign-off

- [ ] Backend deployed and healthy
- [ ] Frontend deployed and healthy
- [ ] Database migration successful
- [ ] Stripe configured and tested
- [ ] Feature gates verified
- [ ] Monitoring enabled
- [ ] Ready for user traffic

**Deployed by**: _____________  
**Date**: _____________  
**Signed off by**: _____________  
