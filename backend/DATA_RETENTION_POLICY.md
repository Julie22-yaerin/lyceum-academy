# Pclick — Data Retention & Deletion Policy

**Version:** 1.0  
**Effective:** July 10, 2026  
**Owner:** Engineering & Data Protection Team

---

## Purpose

This policy defines how long Pclick retains user data, why we keep it, and how we securely delete it when it's no longer needed.

**Core Principles:**
1. Keep data only as long as it serves the student
2. Delete data when retention purpose ends
3. Anonymize before deletion when aggregated insights are valuable
4. Automate deletion to prevent human error

---

## 1. Data Retention Schedule

### 1.1 Active User Data

| Data Type | Retention Period | Trigger for Deletion | Reason |
|-----------|-----------------|---------------------|--------|
| **User Profile** | While account active | Account deletion request | Core account data |
| **Problem Sets (active)** | While account active | User deletes or account closed | Learning reference |
| **Problem Sets (archived)** | 2 years from last view | Auto-purge after 2 years | Historical reference |
| **Learning Progress** | While account active | Account deletion | Personalization |
| **AI Interaction History** | 90 days | Rolling 90-day window | Quality improvement |
| **Subscription Data** | While active + 7 years | Legal requirement (tax) | Billing compliance |
| **Voice Usage Records** | Current billing period + 1 year | Auto-purge after period end | Usage tracking |
| **Feature Usage Logs** | 1 year | Rolling 1-year window | Product analytics |

### 1.2 Deleted Account Data

| Data Type | Retention After Deletion | Final Purge | Notes |
|-----------|-------------------------|-------------|-------|
| **Personal Info** | Anonymized immediately | N/A | Email → hash, name → removed |
| **Learning Data** | Anonymized immediately | N/A | User ID → random hash |
| **Database Backups** | 30 days | Day 31 | Full purge from backups |
| **AI Provider Logs** | 30 days | Provider-dependent | OpenAI/Groq/Google retention |
| **Audit Logs** | 1 year | Day 366 | Security/compliance requirement |

### 1.3 Research & Analytics

| Data Type | Retention Period | Anonymization | Notes |
|-----------|-----------------|---------------|-------|
| **Anonymized Learning Patterns** | Indefinite | Immediate on collection | No PII, cannot de-anonymize |
| **Aggregated Statistics** | Indefinite | N/A (already aggregate) | E.g., "avg time per problem type" |
| **Research Datasets** | Until study ends + 5 years | Before sharing | Academic standard |

---

## 2. Deletion Triggers

### 2.1 User-Initiated Deletion

**Account Deletion:**
```
User Action: Settings → Delete My Account
Timeline:
  - T+0:     Personal info anonymized
  - T+0:     Learning data anonymized
  - T+7:     Export link sent (optional)
  - T+30:    Database backups purged
  - T+30:    Third-party logs expire
```

**Problem Set Deletion:**
```
User Action: Delete specific problem set
Timeline:
  - T+0:     Soft delete (status = "deleted")
  - T+7:     Hard delete from database
  - T+30:    Purged from backups
```

### 2.2 Automatic Deletion

**Inactive Accounts:**
- After **3 years of no login**, send email: "Account will be deleted in 60 days"
- If no response → delete account per schedule above

**Old Problem Sets:**
- Problem sets not viewed in **2 years** → auto-archive
- Archived problem sets **+ 1 year** → auto-delete

**AI Logs:**
- Rolling 90-day window for interaction logs
- Older logs → anonymized and moved to analytics warehouse

---

## 3. Deletion Procedures

### 3.1 Personal Information

**What is deleted:**
- Email address
- Full name
- University/school
- Profile picture (if stored)
- Auth subject (Firebase/Supabase UID)

**How:**
```python
# Anonymization (not literal deletion to preserve referential integrity)
user.email = f"deleted_{uuid4()}@pclick.deleted"
user.full_name = None
user.university = None
user.auth_subject = hashlib.sha256(user.auth_subject.encode()).hexdigest()
```

### 3.2 Learning Data

**What is anonymized:**
- Problem set ownership → random UUID
- Attempt records → anonymized user hash
- Learning history → aggregated patterns only

**How:**
```python
# Replace user_id with irreversible hash
anon_id = hashlib.sha256(f"{user.id}:salt:{uuid4()}".encode()).hexdigest()
pset.owner_id = anon_id
attempt.user_id = anon_id
```

### 3.3 Database Backups

**Backup Schedule:**
- Daily backups retained for 30 days
- Weekly backups retained for 90 days

**Purge Process:**
1. User deletion request received
2. Data anonymized in primary database immediately
3. After 30 days, oldest daily backup expires (contains real data)
4. After 90 days, last weekly backup expires
5. Deletion complete — no recovery possible

---

## 4. Data Minimization

### 4.1 Collection Minimization

**We do NOT collect:**
- Social security numbers or government IDs
- Payment card details (Stripe handles, we store only customer ID)
- Precise geolocation
- Biometric data
- Health information
- Political/religious beliefs

**We collect only:**
- Email (for login)
- Name (optional, for profile)
- University (optional, for community)
- Learning activity (for personalization)
- Subscription status (for access control)

### 4.2 Processing Minimization

**AI models receive minimum necessary data:**
- Grading AI: problem + answer (not name, email, history)
- Hint AI: problem only (not answer, history)
- Personalization AI: mastery data (not raw answers)
- Research: anonymized patterns only

See `data_access_control.py` for enforcement.

---

## 5. Export & Portability

### 5.1 Data Export

**What you can export:**
- All your problem sets (JSON + original PDFs)
- Learning progress & mastery data (JSON)
- AI interaction history (last 90 days, JSON)
- Account info (JSON)

**How:**
1. Settings → Privacy → Download My Data
2. Export generated within 7 days
3. Download link sent via email
4. Link expires after 30 days

**Format:**
```json
{
  "export_version": "1.0",
  "generated_at": "2026-07-10T12:00:00Z",
  "user": {
    "email": "student@example.com",
    "name": "...",
    "created_at": "..."
  },
  "problem_sets": [...],
  "learning_progress": {...},
  "ai_interactions": [...]
}
```

---

## 6. Compliance & Auditing

### 6.1 Regulatory Compliance

**GDPR (EU):**
- ✅ Right to erasure ("right to be forgotten")
- ✅ Right to data portability
- ✅ Right to access
- ✅ Transparent retention periods (this document)

**FERPA (US Education):**
- ✅ Student controls their own education records (18+)
- ✅ No sharing with third parties without consent
- ✅ Retention aligns with educational purpose

**COPPA (Under 13):**
- ✅ Parental consent required for under-13 users
- ✅ Minimal data collection
- ✅ Immediate deletion on request

### 6.2 Audit Trail

All deletion actions are logged:

```
Deletion Log Entry:
  - user_id: <original ID>
  - initiated_by: "user" | "system" | "admin"
  - reason: "user_request" | "auto_purge" | "policy"
  - deleted_at: <timestamp>
  - data_types: ["profile", "problem_sets", "attempts"]
  - backup_purge_date: <30 days from now>
```

**Audit log retention:** 7 years (compliance requirement)

---

## 7. Exceptions & Special Cases

### 7.1 Legal Holds

**If required by law enforcement or court order:**
- Data retention freeze on affected accounts
- Legal team notified immediately
- User notified within 7 days (unless prohibited by law)
- Data preserved until hold lifted

### 7.2 Security Incidents

**If account involved in security incident:**
- Extended retention (up to 1 year) for investigation
- User notified of extended retention
- Data still deleted after investigation closes

### 7.3 Subscription Disputes

**If billing dispute or chargeback:**
- Transaction records retained for 7 years (tax law)
- Learning data still deleted on user request
- Billing data only (name, email, amount, date)

---

## 8. Implementation & Automation

### 8.1 Automated Deletion Jobs

**Daily Cron Jobs:**
```python
# backend/app/services/data_retention.py

@scheduled("0 2 * * *")  # 2 AM daily
def purge_expired_ai_logs():
    """Delete AI interaction logs older than 90 days."""
    cutoff = datetime.now(UTC) - timedelta(days=90)
    delete_ai_logs(before=cutoff)

@scheduled("0 3 * * 0")  # 3 AM Sunday
def archive_old_problem_sets():
    """Archive problem sets not viewed in 2 years."""
    cutoff = datetime.now(UTC) - timedelta(days=730)
    archive_psets(last_viewed_before=cutoff)

@scheduled("0 4 1 * *")  # 4 AM, 1st of month
def purge_deleted_accounts():
    """Hard delete accounts marked deleted >30 days ago."""
    cutoff = datetime.now(UTC) - timedelta(days=30)
    hard_delete_accounts(deleted_before=cutoff)
```

### 8.2 Monitoring & Alerts

**Metrics tracked:**
- Number of deletion requests (monthly)
- Average time to complete deletion
- Backup purge success rate
- Data export success rate

**Alerts:**
- If deletion job fails → page on-call engineer
- If backup purge doesn't run → alert within 24 hours
- If export takes >7 days → notify user + escalate

---

## 9. Policy Review & Updates

**Review Schedule:** Every 6 months  
**Next Review:** January 10, 2027

**Triggers for immediate review:**
- New data type added to Pclick
- New AI provider integrated
- Regulatory change (e.g., new privacy law)
- Security incident involving data retention

**Approval Required:**
- Data Protection Officer
- Engineering Lead
- Legal Counsel (if regulatory impact)

---

## 10. Definitions

**Active Account:** User has logged in within last 3 years  
**Anonymization:** Irreversible process that prevents re-identification  
**Deletion:** Permanent removal from all systems (including backups)  
**Soft Delete:** Mark as deleted but keep in database (reversible)  
**Hard Delete:** Physically remove from database (irreversible)  
**Aggregated Data:** Statistics that cannot identify individuals  
**PII:** Personally Identifiable Information (name, email, etc.)

---

## Questions?

**Engineering:** security@pclick.app  
**Privacy:** privacy@pclick.app  
**Legal:** legal@pclick.app

---

*This policy is enforced via `app/services/data_retention.py` and audited monthly.*
