# Billing + Feature Gating Implementation Specification
**Project:** The Lyceum Academy  
**Issue:** SOC-6  
**Created:** 2026-07-08  
**Status:** Ready for development  

## Overview

Implement subscription billing and feature gating for The Lyceum Academy's 4-tier pricing model finalized in SOC-5. The product currently runs 100% free trial with no billing infrastructure.

## Finalized Pricing (from SOC-5 § 8)

| Tier | Monthly | Annual | Voice ARI/month |
|---|---|---|---|
| **Compass** | $9.99 | $99.99 | 15 min |
| **Scholar** | $19.99 | $199.99 | 60 min |
| **Mentor** | $29.99 | $299.99 | 180 min |
| **Researcher** | $49.99 | $499.99 | Unlimited (soft-cap 600 min) |

**Annual discount:** ~17% (equivalent to 2 months free)

## Architecture Overview

### Tech Stack
- **Backend:** FastAPI + SQLAlchemy + PostgreSQL (existing)
- **Auth:** Firebase/Supabase (existing, dual-provider via `UserProfile.auth_provider`)
- **Billing:** Stripe (new) — chosen for:
  - Native recurring subscription support
  - Webhook-driven state sync
  - Customer portal for self-service management
  - Competitive fees (~2.9% + $0.30, better than PayPal for subscriptions)
- **Frontend:** Vite + React (existing, at `/the-lyceum-academy/src`)

### Component Breakdown

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React)                                            │
├─────────────────────────────────────────────────────────────┤
│  • PricingPage (plan selection, monthly/annual toggle)      │
│  • SubscriptionSettings (current plan, usage stats)         │
│  • UpgradePrompt (when hitting limits)                      │
│  • FeatureGates (React components with plan checks)         │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend API (FastAPI)                                       │
├─────────────────────────────────────────────────────────────┤
│  /subscriptions/plans             → List available plans    │
│  /subscriptions/checkout          → Create Stripe session   │
│  /subscriptions/current           → User's active sub       │
│  /subscriptions/usage             → Voice/feature usage     │
│  /subscriptions/portal            → Stripe customer portal  │
│  /webhooks/stripe                 → Process subscription    │
│                                      events (new payment,   │
│                                      upgrade, cancel, etc)  │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Database (PostgreSQL via SQLAlchemy)                        │
├─────────────────────────────────────────────────────────────┤
│  subscription_plans               → Plan definitions        │
│  user_subscriptions               → Active subscriptions    │
│  voice_usage_records              → S2S minutes tracking    │
│  feature_usage_logs               → Roadmap regen, etc      │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ Stripe                                                      │
├─────────────────────────────────────────────────────────────┤
│  Products (4 tiers)                                         │
│  Prices (8 total: 4 monthly + 4 annual)                     │
│  Customers (linked to UserProfile.id)                       │
│  Subscriptions → Webhooks → Backend sync                    │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### New Tables (add to `backend/app/models/entities.py`)

```python
class SubscriptionTierEnum(str, enum.Enum):
    compass = "compass"
    scholar = "scholar"
    mentor = "mentor"
    researcher = "researcher"

class BillingCycleEnum(str, enum.Enum):
    monthly = "monthly"
    annual = "annual"

class SubscriptionStatusEnum(str, enum.Enum):
    active = "active"
    past_due = "past_due"
    canceled = "canceled"
    trialing = "trialing"

class SubscriptionPlan(Base, TimestampMixin):
    """Plan definitions (seeded data, not user-editable)"""
    __tablename__ = "subscription_plans"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tier: Mapped[SubscriptionTierEnum] = mapped_column(Enum(SubscriptionTierEnum), nullable=False)
    billing_cycle: Mapped[BillingCycleEnum] = mapped_column(Enum(BillingCycleEnum), nullable=False)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)  # $9.99 → 999
    stripe_price_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    
    # Entitlements (stored for quick reference, authoritative source is code)
    voice_minutes_monthly: Mapped[int | None] = mapped_column(Integer)  # NULL = unlimited
    reference_bank_limit: Mapped[int | None] = mapped_column(Integer)  # NULL = unlimited
    roadmap_regen_cooldown_hours: Mapped[int | None] = mapped_column(Integer)  # NULL = no limit
    
    __table_args__ = (UniqueConstraint("tier", "billing_cycle", name="uq_plan_tier_cycle"),)

class UserSubscription(Base, TimestampMixin):
    """User's active subscription"""
    __tablename__ = "user_subscriptions"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=False)
    plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("subscription_plans.id"), nullable=False)
    
    stripe_customer_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    stripe_subscription_id: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    
    status: Mapped[SubscriptionStatusEnum] = mapped_column(Enum(SubscriptionStatusEnum), nullable=False)
    current_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    current_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    
    plan: Mapped["SubscriptionPlan"] = relationship()

class VoiceUsageRecord(Base, TimestampMixin):
    """Track S2S voice minutes per billing period"""
    __tablename__ = "voice_usage_records"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False)  # client-generated
    
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    
    # Billing period snapshot (to survive plan changes mid-period)
    billing_period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    billing_period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

class FeatureUsageLog(Base, TimestampMixin):
    """Track rate-limited features (roadmap regen, etc.)"""
    __tablename__ = "feature_usage_logs"
    
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    feature_key: Mapped[str] = mapped_column(String(64), nullable=False)  # "roadmap_regen", "mind_map_create"
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    metadata: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    
    __table_args__ = (
        # Index for quick "last used" lookups
        Index("idx_feature_usage_user_feature", "user_id", "feature_key", "used_at"),
    )
```

### Migration Path

1. Create Alembic migration: `alembic revision -m "add_subscription_tables"`
2. Existing users remain on free trial (no retroactive subscription assignment)
3. Seed `subscription_plans` table with 8 plans (4 tiers × 2 cycles) after Stripe product/price IDs are created

## Stripe Integration

### Setup Steps

1. **Create Stripe account** (use production keys for Railway deployment, test keys for local dev)
2. **Create Products in Stripe Dashboard:**
   - Compass, Scholar, Mentor, Researcher (4 products)
3. **Create Prices for each product:**
   - Monthly: $9.99, $19.99, $29.99, $49.99
   - Annual: $99.99, $199.99, $299.99, $499.99
   - **Important:** Set `recurring: {interval: 'month'}` or `{interval: 'year'}`
4. **Configure Webhook endpoint:** `https://<backend-domain>/webhooks/stripe`
   - Events to listen for:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.payment_succeeded`
     - `invoice.payment_failed`
5. **Add to `.env`:**
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...  # for frontend
   ```

### Backend Implementation

**File:** `backend/app/services/billing.py`

```python
import stripe
from datetime import datetime
from app.core.config import settings

stripe.api_key = settings.STRIPE_SECRET_KEY

async def create_checkout_session(user_id: uuid.UUID, plan_id: uuid.UUID, success_url: str, cancel_url: str):
    """Create Stripe Checkout session for plan purchase"""
    db_plan = await get_plan_by_id(plan_id)
    user = await get_user_by_id(user_id)
    
    # Create or retrieve Stripe customer
    customer = stripe.Customer.create(
        email=user.email,
        metadata={"user_id": str(user_id)}
    )
    
    session = stripe.checkout.Session.create(
        customer=customer.id,
        mode="subscription",
        line_items=[{
            "price": db_plan.stripe_price_id,
            "quantity": 1,
        }],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"user_id": str(user_id), "plan_id": str(plan_id)}
    )
    
    return session.url

async def handle_subscription_created(stripe_subscription):
    """Webhook handler: new subscription created"""
    user_id = uuid.UUID(stripe_subscription.metadata["user_id"])
    plan = await get_plan_by_stripe_price_id(stripe_subscription.items.data[0].price.id)
    
    # Create UserSubscription record
    await create_user_subscription(
        user_id=user_id,
        plan_id=plan.id,
        stripe_customer_id=stripe_subscription.customer,
        stripe_subscription_id=stripe_subscription.id,
        status=stripe_subscription.status,
        current_period_start=datetime.fromtimestamp(stripe_subscription.current_period_start),
        current_period_end=datetime.fromtimestamp(stripe_subscription.current_period_end),
    )

async def handle_subscription_updated(stripe_subscription):
    """Webhook handler: subscription updated (upgrade/downgrade)"""
    # Update existing UserSubscription record
    pass

async def handle_subscription_deleted(stripe_subscription):
    """Webhook handler: subscription canceled"""
    # Mark UserSubscription as canceled
    pass
```

**File:** `backend/app/routers/subscriptions.py`

```python
from fastapi import APIRouter, Depends, HTTPException
from app.services.billing import create_checkout_session
from app.core.deps import get_current_user

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])

@router.get("/plans")
async def list_plans():
    """List all available subscription plans"""
    return await get_all_plans()

@router.post("/checkout")
async def create_checkout(plan_id: uuid.UUID, user=Depends(get_current_user)):
    """Create Stripe Checkout session"""
    success_url = f"{settings.FRONTEND_URL}/subscription/success"
    cancel_url = f"{settings.FRONTEND_URL}/pricing"
    session_url = await create_checkout_session(user.id, plan_id, success_url, cancel_url)
    return {"url": session_url}

@router.get("/current")
async def get_current_subscription(user=Depends(get_current_user)):
    """Get user's active subscription + usage stats"""
    subscription = await get_user_subscription(user.id)
    if not subscription:
        return {"status": "free_trial"}
    
    # Calculate voice usage for current billing period
    voice_used = await get_voice_minutes_used(user.id, subscription.current_period_start, subscription.current_period_end)
    voice_limit = subscription.plan.voice_minutes_monthly
    
    return {
        "plan": subscription.plan.tier,
        "billing_cycle": subscription.plan.billing_cycle,
        "status": subscription.status,
        "current_period_end": subscription.current_period_end,
        "cancel_at_period_end": subscription.cancel_at_period_end,
        "usage": {
            "voice_minutes_used": voice_used,
            "voice_minutes_limit": voice_limit,  # None = unlimited
        }
    }

@router.post("/portal")
async def create_portal_session(user=Depends(get_current_user)):
    """Create Stripe Customer Portal session for self-service management"""
    subscription = await get_user_subscription(user.id)
    if not subscription:
        raise HTTPException(400, "No active subscription")
    
    session = stripe.billing_portal.Session.create(
        customer=subscription.stripe_customer_id,
        return_url=f"{settings.FRONTEND_URL}/settings"
    )
    return {"url": session.url}
```

**File:** `backend/app/routers/webhooks.py`

```python
import stripe
from fastapi import APIRouter, Request, HTTPException

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

@router.post("/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")
    
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except ValueError:
        raise HTTPException(400, "Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Invalid signature")
    
    # Handle event types
    if event.type == "customer.subscription.created":
        await handle_subscription_created(event.data.object)
    elif event.type == "customer.subscription.updated":
        await handle_subscription_updated(event.data.object)
    elif event.type == "customer.subscription.deleted":
        await handle_subscription_deleted(event.data.object)
    elif event.type == "invoice.payment_failed":
        await handle_payment_failed(event.data.object)
    
    return {"status": "success"}
```

## Voice Usage Tracking

### Implementation

**File:** `backend/app/services/voice_usage.py`

```python
async def start_voice_session(user_id: uuid.UUID, session_id: str):
    """Called when user initiates S2S voice session"""
    subscription = await get_user_subscription(user_id)
    if not subscription:
        raise HTTPException(403, "No active subscription")
    
    # Check if user has minutes remaining
    minutes_used = await get_voice_minutes_used(
        user_id,
        subscription.current_period_start,
        subscription.current_period_end
    )
    limit = subscription.plan.voice_minutes_monthly
    
    if limit is not None and minutes_used >= limit:
        raise HTTPException(
            429,
            f"Voice limit exceeded. You've used {minutes_used}/{limit} minutes this billing period."
        )
    
    # Create usage record
    await create_voice_usage_record(
        user_id=user_id,
        session_id=session_id,
        started_at=datetime.utcnow(),
        billing_period_start=subscription.current_period_start,
        billing_period_end=subscription.current_period_end,
    )

async def end_voice_session(user_id: uuid.UUID, session_id: str):
    """Called when S2S voice session ends"""
    record = await get_voice_usage_record(session_id)
    duration = (datetime.utcnow() - record.started_at).total_seconds()
    
    await update_voice_usage_record(
        record.id,
        ended_at=datetime.utcnow(),
        duration_seconds=int(duration)
    )
    
    # Alert if Researcher user exceeds fair-use soft cap
    if record.plan.tier == "researcher" and await get_voice_minutes_used(...) > 600:
        await send_internal_alert(f"User {user_id} exceeded 600min fair-use cap")
```

**Hook into existing voice endpoints:**
- Modify `VoiceOrb` / `S2SVoiceOverlay` handlers to call `start_voice_session()` on connect
- Call `end_voice_session()` on disconnect or error

## Feature Gating

### Backend Decorator

**File:** `backend/app/core/feature_gates.py`

```python
from functools import wraps
from fastapi import HTTPException

def require_plan(min_tier: SubscriptionTierEnum):
    """Decorator to enforce minimum plan tier"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, user=None, **kwargs):
            subscription = await get_user_subscription(user.id)
            if not subscription:
                raise HTTPException(403, "This feature requires a paid subscription")
            
            tier_order = ["compass", "scholar", "mentor", "researcher"]
            user_tier_idx = tier_order.index(subscription.plan.tier.value)
            required_tier_idx = tier_order.index(min_tier.value)
            
            if user_tier_idx < required_tier_idx:
                raise HTTPException(
                    403,
                    f"This feature requires {min_tier.value.title()} plan or higher"
                )
            
            return await func(*args, user=user, **kwargs)
        return wrapper
    return decorator

async def check_roadmap_regen_allowed(user_id: uuid.UUID):
    """Check if user can regenerate roadmap based on plan cooldown"""
    subscription = await get_user_subscription(user_id)
    if not subscription:
        raise HTTPException(403, "Feature requires paid subscription")
    
    cooldown_hours = subscription.plan.roadmap_regen_cooldown_hours
    if cooldown_hours is None:
        return True  # Researcher: unlimited
    
    last_regen = await get_last_feature_usage(user_id, "roadmap_regen")
    if last_regen:
        hours_since = (datetime.utcnow() - last_regen.used_at).total_seconds() / 3600
        if hours_since < cooldown_hours:
            raise HTTPException(
                429,
                f"Roadmap regeneration available in {cooldown_hours - hours_since:.1f} hours"
            )
    
    return True
```

### Frontend Feature Gates

**File:** `the-lyceum-academy/src/lib/featureGates.ts`

```typescript
export enum PlanTier {
  Compass = "compass",
  Scholar = "scholar",
  Mentor = "mentor",
  Researcher = "researcher",
}

export const TIER_ORDER = [
  PlanTier.Compass,
  PlanTier.Scholar,
  PlanTier.Mentor,
  PlanTier.Researcher,
];

export function canAccessFeature(
  userTier: PlanTier | null,
  requiredTier: PlanTier
): boolean {
  if (!userTier) return false;
  return TIER_ORDER.indexOf(userTier) >= TIER_ORDER.indexOf(requiredTier);
}

export function getReferenceBankLimit(tier: PlanTier | null): number | null {
  if (!tier) return 0;
  switch (tier) {
    case PlanTier.Compass: return 20;
    case PlanTier.Scholar: return 100;
    case PlanTier.Mentor:
    case PlanTier.Researcher: return null; // unlimited
  }
}
```

**React Component Example:**

```tsx
import { canAccessFeature, PlanTier } from '@/lib/featureGates';

function MindMapButton({ userPlan }: { userPlan: PlanTier | null }) {
  const canAccess = canAccessFeature(userPlan, PlanTier.Scholar);
  
  if (!canAccess) {
    return (
      <button disabled>
        Mind Map (Scholar+)
        <UpgradeIcon />
      </button>
    );
  }
  
  return <button onClick={openMindMap}>Mind Map</button>;
}
```

## UI Changes

### 1. Rename "STEM" → "Mentor"

**Files to update:**
- Search all files in `the-lyceum-academy/src/` for "STEM" (case-insensitive)
- Replace with "Mentor" in UI strings, plan references
- **Do not** change any code variables/keys unless they're user-facing

### 2. Pricing Page

**File:** `the-lyceum-academy/src/views/PricingView.tsx` (new)

```tsx
const PLANS = [
  {
    tier: PlanTier.Compass,
    name: "Compass",
    monthlyPrice: 9.99,
    annualPrice: 99.99,
    features: [
      "Unlimited chat, exercises, notes",
      "15 min voice ARI/month",
      "20 reference docs",
      "Roadmap: 1x at onboarding",
    ],
  },
  {
    tier: PlanTier.Scholar,
    name: "Scholar",
    monthlyPrice: 19.99,
    annualPrice: 199.99,
    features: [
      "Everything in Compass",
      "60 min voice ARI/month",
      "100 reference docs",
      "Mind maps",
      "Roadmap: regen 1x/month",
    ],
  },
  // ... Mentor, Researcher
];

function PricingView() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  
  return (
    <div>
      <h1>Choose Your Plan</h1>
      <BillingToggle value={billingCycle} onChange={setBillingCycle} />
      
      <div className="pricing-grid">
        {PLANS.map(plan => (
          <PricingCard
            key={plan.tier}
            {...plan}
            price={billingCycle === 'monthly' ? plan.monthlyPrice : plan.annualPrice}
            onSelect={() => handleSelectPlan(plan.tier, billingCycle)}
          />
        ))}
      </div>
    </div>
  );
}

async function handleSelectPlan(tier: PlanTier, cycle: 'monthly' | 'annual') {
  const res = await fetch('/api/subscriptions/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier, billing_cycle: cycle }),
  });
  const { url } = await res.json();
  window.location.href = url; // Redirect to Stripe Checkout
}
```

### 3. Subscription Settings

**File:** `the-lyceum-academy/src/views/SubscriptionSettingsView.tsx` (new)

Display:
- Current plan & billing cycle
- Next billing date
- Voice usage bar (e.g., "45/60 minutes used this month")
- "Manage Subscription" button → Stripe Customer Portal
- Upgrade/downgrade options

### 4. Usage Indicators

Add to relevant views:
- **Voice usage** progress bar in settings or voice interface
- **Reference bank** count (e.g., "18/20 docs saved")
- **Roadmap regen** cooldown timer ("Next regen available in 23 hours")

## Feature Entitlement Matrix (Authoritative)

From SOC-5 § 4, reproduced here for implementation reference:

| Feature | Compass | Scholar | Mentor | Researcher |
|---|:---:|:---:|:---:|:---:|
| Chat (text, unlimited) | ✅ | ✅ | ✅ | ✅ |
| Exercises (unlimited) | ✅ | ✅ | ✅ | ✅ |
| Mistake bank | ✅ | ✅ | ✅ | ✅ |
| Notes | ✅ | ✅ | ✅ | ✅ |
| Progress tracking | ✅ | ✅ | ✅ | ✅ |
| Reference bank | 20 docs | 100 docs | Unlimited | Unlimited |
| Mind map | ❌ | ✅ | ✅ | ✅ |
| Voice ARI (S2S) | 15 min/mo | 60 min/mo | 180 min/mo | Unlimited* |
| AI Roadmap regen | 1x onboarding | 1x/month | 1x/week | Unlimited |
| Support | Email, 48h | Email, 24h | Email, 12h | Priority, same-day |

*Researcher "unlimited" voice has hidden fair-use cap of 600 min/month (soft limit, internal alert only).

## Testing Checklist

- [ ] Stripe test mode integration works (checkout → webhook → DB sync)
- [ ] All 4 tiers × 2 billing cycles create correct subscriptions
- [ ] Voice usage tracking increments correctly per session
- [ ] Voice limit enforcement blocks sessions when exceeded
- [ ] Feature gates block Scholar-only features (mind map) for Compass users
- [ ] Reference bank limits enforced (Compass: 20, Scholar: 100)
- [ ] Roadmap regen cooldowns enforced per plan
- [ ] Stripe Customer Portal allows plan upgrade/downgrade
- [ ] Subscription cancellation marks `cancel_at_period_end=true`
- [ ] Subscription status syncs on payment failure (→ `past_due`)
- [ ] Annual subscriptions charge correct discounted price
- [ ] All "STEM" UI references replaced with "Mentor"

## Deployment Steps

1. **Backend:**
   - Add Stripe env vars to Railway/production environment
   - Run migration: `alembic upgrade head`
   - Seed `subscription_plans` table with Stripe price IDs
   - Deploy webhook endpoint, verify Stripe can reach it

2. **Stripe Dashboard:**
   - Create 4 products + 8 prices (or use Stripe CLI for automation)
   - Configure webhook endpoint URL
   - Copy price IDs into plan seed script

3. **Frontend:**
   - Deploy pricing page
   - Add Stripe publishable key to frontend env

4. **Verification:**
   - Test full checkout flow in Stripe test mode
   - Verify webhook delivery in Stripe dashboard
   - Check DB records created correctly
   - Test feature gates in production

## Out of Scope

- **Free trial period:** Current spec assumes immediate payment. Free trial can be added later via Stripe `trial_period_days`.
- **Proration:** Stripe handles this automatically on plan changes.
- **Refunds:** Handled manually via Stripe dashboard initially.
- **Tax collection:** Stripe Tax integration is separate effort.
- **Grandfathered pricing:** Not needed for initial launch.

## Task Breakdown

See main issue SOC-6 for linked task list. Key tasks:
1. Database schema design
2. Stripe integration (products, prices, webhooks)
3. Voice usage tracking
4. Feature gating (backend + frontend)
5. UI updates (STEM → Mentor rename)
6. Subscription management UI (pricing page, settings)
7. Database migration
8. API endpoints
9. End-to-end testing

## Questions/Decisions

All founder questions from SOC-5 § 7 have been answered in SOC-5 § 8:
- ✅ Pricing: Use proposed ladder ($9.99/$19.99/$29.99/$49.99)
- ✅ STEM rename: "Mentor" (no subject restrictions)
- ✅ Voice minutes: Use proposed quotas (15/60/180/unlimited), measure post-launch
- ✅ Billing cycles: Monthly + annual with discount

## References

- **Pricing Analysis:** `the-lyceum-academy/pricing_tiers_and_entitlements.md` (SOC-5 deliverable)
- **Cost Model:** `the-lyceum-academy/api_cost_growth_model.md`
- **Parent Issue:** SOC-5 (pricing analysis, now in_review)
- **Current Issue:** SOC-6 (technical implementation, this spec)
