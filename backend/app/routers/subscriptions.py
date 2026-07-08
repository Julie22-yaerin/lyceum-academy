"""
Subscription and billing endpoints for The Lyceum Academy.

GET    /subscriptions/plans         — List all available subscription plans
POST   /subscriptions/checkout      — Create Stripe checkout session
GET    /subscriptions/current       — Get user's active subscription
GET    /subscriptions/usage         — Get user's current billing period usage
POST   /subscriptions/portal        — Create Stripe customer portal session
POST   /webhooks/stripe             — Process Stripe webhook events
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Annotated

import stripe
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.entities import (
    SubscriptionPlan,
    UserSubscription,
    VoiceUsageRecord,
    FeatureUsageLog,
    UserProfile,
    SubscriptionTierEnum,
    BillingCycleEnum,
    SubscriptionStatusEnum,
)
from app.services.auth import get_current_user

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])
webhook_router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# Stripe configuration
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


# ============================================================================
# Request/Response Models
# ============================================================================


class PlanResponse(BaseModel):
    id: str
    tier: str
    billing_cycle: str
    price_usd: float
    voice_minutes_monthly: int | None
    mind_map_enabled: bool
    reference_library_limit: int | None
    roadmap_regen_daily_limit: int | None

    class Config:
        from_attributes = True


class CheckoutRequest(BaseModel):
    plan_id: str
    success_url: str | None = None
    cancel_url: str | None = None


class CheckoutResponse(BaseModel):
    checkout_url: str


class CurrentSubscriptionResponse(BaseModel):
    tier: str
    billing_cycle: str
    status: str
    current_period_end: datetime
    cancel_at_period_end: bool
    voice_minutes_used: float
    voice_minutes_limit: int | None


class UsageResponse(BaseModel):
    billing_period_start: datetime
    billing_period_end: datetime
    voice_minutes_used: float
    voice_minutes_limit: int | None
    roadmap_regens_today: int
    roadmap_regen_daily_limit: int | None
    reference_library_count: int
    reference_library_limit: int | None


class PortalResponse(BaseModel):
    portal_url: str


# ============================================================================
# Helper Functions
# ============================================================================


def get_user_subscription(
    db: Session, user_id: str
) -> tuple[UserSubscription | None, SubscriptionPlan | None]:
    """Get user's active subscription and plan."""
    result = db.execute(
        select(UserSubscription, SubscriptionPlan)
        .join(SubscriptionPlan, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(UserSubscription.user_id == user_id)
        .where(UserSubscription.status.in_(["active", "trialing"]))
    )
    row = result.first()
    if row:
        return row[0], row[1]
    return None, None


def get_voice_usage_minutes(
    db: Session, user_id: str, period_start: datetime
) -> float:
    """Calculate total voice minutes used in current billing period."""
    result = db.execute(
        select(func.sum(VoiceUsageRecord.duration_seconds))
        .where(VoiceUsageRecord.user_id == user_id)
        .where(VoiceUsageRecord.billing_period_start == period_start)
    )
    total_seconds = result.scalar() or 0
    return total_seconds / 60.0


def get_roadmap_regens_today(
    db: Session, user_id: str
) -> int:
    """Count roadmap regenerations today."""
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    result = db.execute(
        select(func.count(FeatureUsageLog.id))
        .where(FeatureUsageLog.user_id == user_id)
        .where(FeatureUsageLog.feature_name == "roadmap_regen")
        .where(FeatureUsageLog.created_at >= today_start)
    )
    return result.scalar() or 0


def get_reference_library_count(
    db: Session, user_id: str
) -> int:
    """Count saved reference library items."""
    result = db.execute(
        select(func.count(FeatureUsageLog.id))
        .where(FeatureUsageLog.user_id == user_id)
        .where(FeatureUsageLog.feature_name == "reference_library_item")
    )
    return result.scalar() or 0


# ============================================================================
# API Endpoints
# ============================================================================


@router.get("/plans", response_model=list[PlanResponse])
def list_plans(db: Session = Depends(get_db)):
    """List all available subscription plans."""
    result = db.execute(select(SubscriptionPlan).order_by(SubscriptionPlan.price_usd_cents))
    plans = result.scalars().all()

    return [
        PlanResponse(
            id=str(plan.id),
            tier=plan.tier.value,
            billing_cycle=plan.billing_cycle.value,
            price_usd=plan.price_usd_cents / 100.0,
            voice_minutes_monthly=plan.voice_minutes_monthly,
            mind_map_enabled=plan.mind_map_enabled,
            reference_library_limit=plan.reference_library_limit,
            roadmap_regen_daily_limit=plan.roadmap_regen_daily_limit,
        )
        for plan in plans
    ]


@router.post("/checkout", response_model=CheckoutResponse)
def create_checkout_session(
    body: CheckoutRequest,
    current_user: Annotated[UserProfile, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Create a Stripe checkout session for the specified plan."""
    # Get the plan
    result = db.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.id == body.plan_id)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    if not plan.stripe_price_id:
        raise HTTPException(status_code=400, detail="Plan not configured in Stripe")

    # Create or get Stripe customer
    subscription, _ = get_user_subscription(db, str(current_user.id))
    customer_id = subscription.stripe_customer_id if subscription else None

    if not customer_id:
        customer = stripe.Customer.create(
            email=current_user.email,
            metadata={"user_id": str(current_user.id)},
        )
        customer_id = customer.id

    # Create checkout session
    success_url = body.success_url or f"{FRONTEND_URL}/subscription/success"
    cancel_url = body.cancel_url or f"{FRONTEND_URL}/pricing"

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        payment_method_types=["card"],
        line_items=[
            {
                "price": plan.stripe_price_id,
                "quantity": 1,
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "user_id": str(current_user.id),
            "plan_id": str(plan.id),
        },
    )

    return CheckoutResponse(checkout_url=session.url)


@router.get("/current", response_model=CurrentSubscriptionResponse)
def get_current_subscription(
    current_user: Annotated[UserProfile, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Get user's current subscription and usage."""
    subscription, plan = get_user_subscription(db, str(current_user.id))

    if not subscription or not plan:
        raise HTTPException(status_code=404, detail="No active subscription")

    voice_minutes = get_voice_usage_minutes(
        db, str(current_user.id), subscription.current_period_start
    )

    return CurrentSubscriptionResponse(
        tier=plan.tier.value,
        billing_cycle=plan.billing_cycle.value,
        status=subscription.status.value,
        current_period_end=subscription.current_period_end,
        cancel_at_period_end=subscription.cancel_at_period_end,
        voice_minutes_used=voice_minutes,
        voice_minutes_limit=plan.voice_minutes_monthly,
    )


@router.get("/usage", response_model=UsageResponse)
def get_usage(
    current_user: Annotated[UserProfile, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Get detailed usage stats for current billing period."""
    subscription, plan = get_user_subscription(db, str(current_user.id))

    if not subscription or not plan:
        raise HTTPException(status_code=404, detail="No active subscription")

    voice_minutes = get_voice_usage_minutes(
        db, str(current_user.id), subscription.current_period_start
    )
    roadmap_regens = get_roadmap_regens_today(db, str(current_user.id))
    reference_count = get_reference_library_count(db, str(current_user.id))

    return UsageResponse(
        billing_period_start=subscription.current_period_start,
        billing_period_end=subscription.current_period_end,
        voice_minutes_used=voice_minutes,
        voice_minutes_limit=plan.voice_minutes_monthly,
        roadmap_regens_today=roadmap_regens,
        roadmap_regen_daily_limit=plan.roadmap_regen_daily_limit,
        reference_library_count=reference_count,
        reference_library_limit=plan.reference_library_limit,
    )


@router.post("/portal", response_model=PortalResponse)
def create_portal_session(
    current_user: Annotated[UserProfile, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Create a Stripe customer portal session for subscription management."""
    subscription, _ = get_user_subscription(db, str(current_user.id))

    if not subscription or not subscription.stripe_customer_id:
        raise HTTPException(status_code=404, detail="No Stripe customer found")

    session = stripe.billing_portal.Session.create(
        customer=subscription.stripe_customer_id,
        return_url=f"{FRONTEND_URL}/subscription",
    )

    return PortalResponse(portal_url=session.url)


# ============================================================================
# Webhook Handler
# ============================================================================


@webhook_router.post("/stripe")
async def stripe_webhook(
    request: Request,
    stripe_signature: Annotated[str | None, Header(alias="stripe-signature")] = None,
    db: Session = Depends(get_db),
):
    """Handle Stripe webhook events."""
    if not stripe_signature:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, STRIPE_WEBHOOK_SECRET
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    # Handle subscription events
    if event.type == "customer.subscription.created":
        handle_subscription_created(event.data.object, db)
    elif event.type == "customer.subscription.updated":
        handle_subscription_updated(event.data.object, db)
    elif event.type == "customer.subscription.deleted":
        handle_subscription_deleted(event.data.object, db)
    elif event.type == "invoice.payment_succeeded":
        handle_payment_succeeded(event.data.object, db)
    elif event.type == "invoice.payment_failed":
        handle_payment_failed(event.data.object, db)

    return {"status": "success"}


def handle_subscription_created(subscription_obj: dict, db: Session):
    """Handle new subscription creation."""
    customer_id = subscription_obj["customer"]
    subscription_id = subscription_obj["id"]
    status = subscription_obj["status"]

    # Find user by Stripe customer ID
    result = db.execute(
        select(UserSubscription).where(
            UserSubscription.stripe_customer_id == customer_id
        )
    )
    user_sub = result.scalar_one_or_none()

    if user_sub:
        user_sub.stripe_subscription_id = subscription_id
        user_sub.status = SubscriptionStatusEnum(status)
        user_sub.current_period_start = datetime.fromtimestamp(
            subscription_obj["current_period_start"]
        )
        user_sub.current_period_end = datetime.fromtimestamp(
            subscription_obj["current_period_end"]
        )
        user_sub.cancel_at_period_end = subscription_obj.get("cancel_at_period_end", False)
        db.commit()


def handle_subscription_updated(subscription_obj: dict, db: Session):
    """Handle subscription updates (plan changes, renewals)."""
    subscription_id = subscription_obj["id"]
    status = subscription_obj["status"]

    result = db.execute(
        select(UserSubscription).where(
            UserSubscription.stripe_subscription_id == subscription_id
        )
    )
    user_sub = result.scalar_one_or_none()

    if user_sub:
        user_sub.status = SubscriptionStatusEnum(status)
        user_sub.current_period_start = datetime.fromtimestamp(
            subscription_obj["current_period_start"]
        )
        user_sub.current_period_end = datetime.fromtimestamp(
            subscription_obj["current_period_end"]
        )
        user_sub.cancel_at_period_end = subscription_obj.get("cancel_at_period_end", False)
        db.commit()


def handle_subscription_deleted(subscription_obj: dict, db: Session):
    """Handle subscription cancellation."""
    subscription_id = subscription_obj["id"]

    result = db.execute(
        select(UserSubscription).where(
            UserSubscription.stripe_subscription_id == subscription_id
        )
    )
    user_sub = result.scalar_one_or_none()

    if user_sub:
        user_sub.status = SubscriptionStatusEnum.canceled
        db.commit()


def handle_payment_succeeded(invoice_obj: dict, db: Session):
    """Handle successful payment."""
    subscription_id = invoice_obj.get("subscription")
    if not subscription_id:
        return

    result = db.execute(
        select(UserSubscription).where(
            UserSubscription.stripe_subscription_id == subscription_id
        )
    )
    user_sub = result.scalar_one_or_none()

    if user_sub and user_sub.status == SubscriptionStatusEnum.past_due:
        user_sub.status = SubscriptionStatusEnum.active
        db.commit()


def handle_payment_failed(invoice_obj: dict, db: Session):
    """Handle failed payment."""
    subscription_id = invoice_obj.get("subscription")
    if not subscription_id:
        return

    result = db.execute(
        select(UserSubscription).where(
            UserSubscription.stripe_subscription_id == subscription_id
        )
    )
    user_sub = result.scalar_one_or_none()

    if user_sub:
        user_sub.status = SubscriptionStatusEnum.past_due
        db.commit()


# ============================================================================
# Voice Session Tracking
# ============================================================================


@router.post("/voice/start")
def start_voice_session(
    current_user: Annotated[UserProfile, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Start a voice usage session."""
    import uuid
    from datetime import datetime, timedelta

    subscription, plan = get_user_subscription(db, str(current_user.id))

    # Determine billing period start (subscription period or calendar month)
    if subscription:
        period_start = subscription.current_period_start
    else:
        # No subscription - use calendar month for trial/free tier
        today = datetime.utcnow()
        period_start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # Create voice usage record
    voice_record = VoiceUsageRecord(
        user_id=str(current_user.id),
        started_at=datetime.utcnow(),
        ended_at=None,
        duration_seconds=0,
        billing_period_start=period_start,
    )
    db.add(voice_record)
    db.commit()
    db.refresh(voice_record)

    return {"session_id": str(voice_record.id)}


@router.post("/voice/end")
def end_voice_session(
    body: dict,
    current_user: Annotated[UserProfile, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """End a voice usage session and calculate duration."""
    from datetime import datetime

    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")

    result = db.execute(
        select(VoiceUsageRecord).where(VoiceUsageRecord.id == session_id)
    )
    record = result.scalar_one_or_none()

    if not record:
        raise HTTPException(status_code=404, detail="Session not found")

    if str(record.user_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Not authorized")

    # Update duration
    now = datetime.utcnow()
    record.ended_at = now
    record.duration_seconds = int((now - record.started_at).total_seconds())
    db.commit()

    return {"status": "ok"}


@router.post("/feature-log")
def log_feature_usage(
    body: dict,
    current_user: Annotated[UserProfile, Depends(get_current_user)],
    db: Session = Depends(get_db),
):
    """Log feature usage (roadmap regen, etc)."""
    import uuid
    from datetime import datetime

    feature_type = body.get("feature_type")
    metadata = body.get("metadata", {})

    if not feature_type:
        raise HTTPException(status_code=400, detail="feature_type required")

    log_entry = FeatureUsageLog(
        id=str(uuid.uuid4()),
        user_id=str(current_user.id),
        feature_name=feature_type,
        metadata=metadata,
        created_at=datetime.utcnow(),
    )
    db.add(log_entry)
    db.commit()

    return {"status": "ok"}
