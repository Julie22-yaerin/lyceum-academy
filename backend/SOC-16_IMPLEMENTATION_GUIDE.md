# SOC-16 Implementation Guide

**Security Initiative:** Data Protection & AI Access Control  
**Status:** Implementation Complete  
**Date:** July 10, 2026

---

## What Was Implemented

### 1. Two-Way Encryption System
✅ **File:** `app/services/encryption.py`

**Features:**
- Symmetric encryption using Fernet (AES-128-CBC + HMAC)
- Support for key rotation (multiple keys, automatic try-all on decrypt)
- Encrypt/decrypt text, JSON, and binary data
- Zero keys in code — all read from environment variables

**Usage:**
```python
from app.services.encryption import encrypt, decrypt, encrypt_dict, decrypt_dict

# Encrypt sensitive data before DB write
encrypted_email = encrypt("student@example.com")

# Decrypt on read
original_email = decrypt(encrypted_email)

# Encrypt structured data
encrypted_payload = encrypt_dict({"answer": "solution", "score": 95})

# Decrypt back to dict
original_payload = decrypt_dict(encrypted_payload)
```

**Key Generation:**
```bash
python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
# Add to .env as ENCRYPTION_KEY_PRIMARY
```

---

### 2. AI Data Access Control
✅ **File:** `app/services/data_access_control.py`

**Features:**
- Role-based access control for AI models
- Data category permissions (problem content, student work, learning history, PII)
- Access logging for transparency and audit
- Data filtering (remove unauthorized fields before sending to AI)

**AI Roles & Permissions:**

| Role | Can Access | Cannot Access |
|------|-----------|---------------|
| `GRADING` | Problem prompts, student answers | Learning history, personal info |
| `HINT_GENERATION` | Problem prompts ONLY | Student answers, PII |
| `PERSONALIZATION` | Learning history, behavioral data | Raw answers, PII |
| `CONTENT_SAFETY` | All content (for moderation) | N/A |
| `RESEARCH` | Anonymized aggregated stats only | Any PII without consent |

**Usage:**
```python
from app.services.data_access_control import (
    AIRole, DataCategory, AccessPurpose,
    check_access, filter_for_ai, log_ai_access
)

# Check if role can access category
if check_access(AIRole.GRADING, DataCategory.STUDENT_WORK):
    # Allowed — proceed
    pass

# Filter data dict to only allowed fields
raw_data = {"problem": "...", "answer": "...", "email": "...", "name": "..."}
safe_data = filter_for_ai(AIRole.HINT_GENERATION, raw_data)
# Result: {"problem": "..."} — answer, email, name removed

# Log access for audit trail
log_ai_access(
    user_id="user_123",
    role=AIRole.GRADING,
    category=DataCategory.STUDENT_WORK,
    purpose=AccessPurpose.IMMEDIATE_FEEDBACK
)
```

---

### 3. Data Usage Commitment
✅ **File:** `DATA_USAGE_COMMITMENT.md`

**Purpose:** Student-facing transparency document

**Contents:**
- What data we collect and why
- How AI models access student data
- Security & encryption measures
- Data retention periods
- Student rights (access, delete, export)
- Third-party AI provider data handling
- Research participation (opt-in)
- GDPR, FERPA, COPPA compliance

**Key Promises:**
- ✅ Never sell student data
- ✅ Never use for advertising
- ✅ Students can delete data anytime
- ✅ All AI access is logged and transparent
- ✅ Encryption at rest and in transit

---

### 4. Data Retention Policy
✅ **File:** `DATA_RETENTION_POLICY.md`

**Purpose:** Technical policy for engineering team

**Contents:**
- Data retention schedule by data type
- Deletion triggers (user request, auto-purge, legal hold)
- Anonymization procedures
- Backup purge timelines
- Export & portability process
- Compliance requirements (GDPR, FERPA)
- Automated deletion jobs (cron schedule)

**Key Rules:**
- Active problem sets: kept while account active
- Archived problem sets: auto-delete after 2 years
- AI interaction logs: rolling 90-day window
- Deleted accounts: anonymized immediately, backups purged in 30 days
- Research data: anonymized aggregates only, kept indefinitely

---

## Integration Points

### Where to Apply Encryption

#### 1. User Profile (Sensitive PII)
```python
# app/models/entities.py — UserProfile
# Encrypt: email, full_name, university

from app.services.encryption import encrypt, decrypt

# On create/update
user.email_encrypted = encrypt(user.email)
user.full_name_encrypted = encrypt(user.full_name) if user.full_name else None

# On read
user.email = decrypt(user.email_encrypted)
user.full_name = decrypt(user.full_name_encrypted) if user.full_name_encrypted else None
```

#### 2. Student Work (High Sensitivity)
```python
# app/models/entities.py — Attempt
# Encrypt: response_payload (student's answer/solution)

attempt.response_payload_encrypted = encrypt_dict(response_payload)

# On read
response_payload = decrypt_dict(attempt.response_payload_encrypted)
```

#### 3. AI Interactions (Medium Sensitivity)
```python
# Already logged in activity_log.py
# Add encryption for sensitive prompts:

if contains_pii(prompt):
    encrypted_prompt = encrypt(prompt)
    # Store encrypted version in metadata
```

---

### Where to Apply Access Control

#### 1. Grading Endpoint
```python
# app/main.py — @app.post("/ai/grade-all")

from app.services.data_access_control import (
    AIRole, DataCategory, AccessPurpose, filter_for_ai, log_ai_access
)

@app.post("/ai/grade-all")
async def ai_grade_all(req: GradeAllRequest, auth: dict = Depends(require_auth)):
    uid = _uid(auth)
    
    # Filter data for AI role
    for q in req.questions:
        safe_data = filter_for_ai(AIRole.GRADING, {
            "prompt": q.prompt,
            "answer": q.answer,
            # Do not send PII
        })
        
        # Log access
        log_ai_access(
            uid, AIRole.GRADING, DataCategory.STUDENT_WORK,
            AccessPurpose.IMMEDIATE_FEEDBACK
        )
    
    # Send safe_data to AI provider
    result = await ai_svc.grade_all(...)
    return result
```

#### 2. Hint Generation
```python
# app/main.py — @app.post("/ai/hint")

@app.post("/ai/hint")
async def ai_hint(req: HintRequest, auth: dict = Depends(require_auth)):
    uid = _uid(auth)
    
    # Hints should NOT see student's work (Socratic method)
    safe_data = filter_for_ai(AIRole.HINT_GENERATION, {
        "problem": req.problem,
        # Explicitly do NOT send student's answer
    })
    
    log_ai_access(
        uid, AIRole.HINT_GENERATION, DataCategory.PROBLEM_CONTENT,
        AccessPurpose.IMMEDIATE_FEEDBACK
    )
    
    hint = await ai_svc.get_hint(safe_data["problem"], req.level)
    return {"hint": hint}
```

#### 3. Personalization
```python
# app/main.py — @app.post("/ai/roadmap")

@app.post("/ai/roadmap")
async def ai_roadmap(req: RoadmapRequest, auth: dict = Depends(require_auth)):
    uid = _uid(auth)
    
    # Roadmap AI can see learning history, not raw answers
    profile = mastery_profile_svc.get_full_profile(uid)
    safe_data = filter_for_ai(AIRole.PERSONALIZATION, {
        "learning_history": profile["needs_attention"],
        "mastery_data": profile["by_subject"],
        # Do NOT send raw problem answers
    })
    
    log_ai_access(
        uid, AIRole.PERSONALIZATION, DataCategory.LEARNING_HISTORY,
        AccessPurpose.PERSONALIZATION
    )
    
    roadmap = await ai_svc.generate_roadmap(req.topic, safe_data)
    return roadmap
```

---

## Environment Variables

Add to `.env`:

```bash
# ── Encryption Keys (SOC-16) ──────────────────────────────────────────────────
# Generate with: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'

# Primary key (current) — used for new encryptions
ENCRYPTION_KEY_PRIMARY="<generate-new-key>"

# Secondary keys (for rotation) — comma-separated, used only for decryption
# When rotating keys:
#   1. Generate new key
#   2. Set it as ENCRYPTION_KEY_PRIMARY
#   3. Move old primary to ENCRYPTION_KEYS_SECONDARY
#   4. Gradually re-encrypt data with new key
ENCRYPTION_KEYS_SECONDARY=""
```

---

## Database Migrations

### Add Encrypted Fields

```sql
-- Migration: Add encrypted columns to users table
ALTER TABLE users
ADD COLUMN email_encrypted TEXT,
ADD COLUMN full_name_encrypted TEXT,
ADD COLUMN university_encrypted TEXT;

-- Migration: Add encrypted column to attempts table
ALTER TABLE attempts
ADD COLUMN response_payload_encrypted TEXT;

-- Migration: Create data access audit log
CREATE TABLE ai_data_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    ai_role VARCHAR(64) NOT NULL,
    data_category VARCHAR(64) NOT NULL,
    access_purpose VARCHAR(64) NOT NULL,
    record_count INTEGER DEFAULT 1,
    accessed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_access_log_user ON ai_data_access_log(user_id);
CREATE INDEX idx_access_log_timestamp ON ai_data_access_log(accessed_at);
```

### Migrate Existing Data (One-Time)

```python
# scripts/migrate_encrypt_existing_data.py

from app.db.session import SessionLocal
from app.models.entities import UserProfile, Attempt
from app.services.encryption import encrypt, encrypt_dict

def encrypt_existing_users():
    db = SessionLocal()
    users = db.query(UserProfile).all()
    
    for user in users:
        # Encrypt PII
        if user.email and not user.email_encrypted:
            user.email_encrypted = encrypt(user.email)
        
        if user.full_name and not user.full_name_encrypted:
            user.full_name_encrypted = encrypt(user.full_name)
        
        if user.university and not user.university_encrypted:
            user.university_encrypted = encrypt(user.university)
    
    db.commit()
    print(f"Encrypted {len(users)} user profiles")

def encrypt_existing_attempts():
    db = SessionLocal()
    attempts = db.query(Attempt).filter(
        Attempt.response_payload_encrypted.is_(None)
    ).all()
    
    for attempt in attempts:
        if attempt.response_payload:
            attempt.response_payload_encrypted = encrypt_dict(
                attempt.response_payload
            )
    
    db.commit()
    print(f"Encrypted {len(attempts)} attempt responses")

if __name__ == "__main__":
    encrypt_existing_users()
    encrypt_existing_attempts()
```

---

## Testing

### Unit Tests

```python
# tests/test_encryption.py

from app.services.encryption import encrypt, decrypt, encrypt_dict, decrypt_dict

def test_text_encryption():
    original = "sensitive data"
    encrypted = encrypt(original)
    assert encrypted != original
    assert decrypt(encrypted) == original

def test_json_encryption():
    original = {"answer": "solution", "score": 95}
    encrypted = encrypt_dict(original)
    assert encrypted != str(original)
    decrypted = decrypt_dict(encrypted)
    assert decrypted == original

def test_empty_encryption():
    assert encrypt("") == ""
    assert decrypt("") == ""
```

```python
# tests/test_access_control.py

from app.services.data_access_control import (
    AIRole, DataCategory, check_access, filter_for_ai
)

def test_grading_permissions():
    assert check_access(AIRole.GRADING, DataCategory.STUDENT_WORK)
    assert not check_access(AIRole.GRADING, DataCategory.PERSONAL_INFO)

def test_hint_permissions():
    assert check_access(AIRole.HINT_GENERATION, DataCategory.PROBLEM_CONTENT)
    assert not check_access(AIRole.HINT_GENERATION, DataCategory.STUDENT_WORK)

def test_data_filtering():
    raw = {"problem": "q1", "answer": "a1", "email": "s@ex.com"}
    
    # Grading AI: sees problem + answer, not email
    grading_data = filter_for_ai(AIRole.GRADING, raw)
    assert "problem" in grading_data
    assert "answer" in grading_data
    assert "email" not in grading_data
    
    # Hint AI: sees problem only
    hint_data = filter_for_ai(AIRole.HINT_GENERATION, raw)
    assert "problem" in hint_data
    assert "answer" not in hint_data
    assert "email" not in hint_data
```

---

## Deployment Checklist

### Pre-Deployment

- [ ] Generate encryption keys and add to .env
- [ ] Run database migrations to add encrypted columns
- [ ] Test encryption/decryption in staging environment
- [ ] Verify access control filters work for all AI endpoints
- [ ] Review DATA_USAGE_COMMITMENT.md with legal team
- [ ] Set up automated deletion cron jobs

### Deployment

- [ ] Deploy code changes
- [ ] Run one-time data encryption migration
- [ ] Verify encryption keys are set in production environment
- [ ] Test user data export functionality
- [ ] Test account deletion flow end-to-end
- [ ] Verify AI access logs are being written

### Post-Deployment

- [ ] Monitor encryption/decryption performance
- [ ] Check AI access audit logs for anomalies
- [ ] Update frontend to link to DATA_USAGE_COMMITMENT.md
- [ ] Add Privacy Settings page (view/delete data)
- [ ] Send email to users about new privacy features
- [ ] Schedule first data retention policy review (6 months)

---

## Monitoring & Maintenance

### Metrics to Track

```python
# app/services/monitoring.py (to be created)

# Encryption performance
- encryption_time_ms (p50, p95, p99)
- decryption_time_ms
- encryption_errors (alert if > 0)

# Access control
- ai_access_denied_count (by role, category)
- ai_access_log_writes_per_day
- filtered_fields_count (what's being hidden from AI)

# Data retention
- deletion_requests_per_month
- avg_deletion_completion_time
- backup_purge_success_rate
- export_requests_per_month
```

### Alerts

```
- If encryption key missing → page on-call immediately
- If decryption fails → alert within 5 minutes
- If AI accesses unauthorized category → log + alert
- If deletion job fails → retry + alert
- If export takes >7 days → notify user + escalate
```

---

## Next Steps (Future Enhancements)

### Phase 2: Field-Level Encryption
- Transparent encryption/decryption via SQLAlchemy event listeners
- No manual encrypt/decrypt calls needed in application code

### Phase 3: User Privacy Dashboard
- Frontend: Settings → Privacy
- View all AI models that accessed your data (with timestamps)
- Download your data (JSON export)
- Delete specific problem sets or entire account
- Manage research consent

### Phase 4: Zero-Knowledge Architecture
- End-to-end encryption (data encrypted client-side)
- Server never sees plaintext sensitive data
- Client holds decryption key

### Phase 5: Differential Privacy
- Add noise to aggregated statistics
- Prevent de-anonymization attacks
- Formal privacy guarantees (ε-differential privacy)

---

## Support & Questions

**Security Issues:** security@pclick.app  
**Privacy Questions:** privacy@pclick.app  
**Implementation Help:** engineering@pclick.app

**Internal Docs:**
- `app/services/encryption.py` — encryption implementation
- `app/services/data_access_control.py` — access control implementation
- `DATA_USAGE_COMMITMENT.md` — student-facing commitment
- `DATA_RETENTION_POLICY.md` — engineering policy

---

*SOC-16 Implementation Complete — July 10, 2026*
