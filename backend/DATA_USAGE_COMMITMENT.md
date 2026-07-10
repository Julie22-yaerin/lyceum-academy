# Pclick — Data Usage Commitment for Educational AI

**Effective Date:** July 10, 2026  
**Last Updated:** July 10, 2026

---

## Our Commitment to Students

Pclick is an educational AI platform built to help students learn more effectively. We believe **your learning data belongs to you**, and we are committed to using it only to serve your educational goals.

This document explains exactly how we use your data, what protections are in place, and what rights you have.

---

## 1. What Data We Collect

### Educational Data
- **Problem Sets:** Problems you upload, work on, and solve
- **Learning Progress:** Your attempts, scores, mastery levels, and time spent
- **AI Interactions:** Questions you ask, hints you request, explanations you provide
- **Study Patterns:** What subjects you study, when, and how often

### Account Data
- **Profile Information:** Name, email, university (if provided)
- **Authentication:** Firebase/Supabase user ID (no passwords stored)
- **Subscription:** Plan tier, billing status (via Stripe)

### Technical Data
- **Usage Logs:** API calls, feature usage, error reports
- **Performance Metrics:** Response times, AI model usage

---

## 2. How We Use Your Data

### 🎯 **Primary Purpose: Your Education**

All AI features use your data to:
- ✅ Grade your work and provide immediate feedback
- ✅ Generate personalized hints using the Socratic method
- ✅ Adapt to your learning style and pace
- ✅ Build custom learning roadmaps
- ✅ Track your mastery and suggest next steps

**We NEVER:**
- ❌ Sell your data to third parties
- ❌ Use your data for advertising
- ❌ Train commercial AI models without explicit consent
- ❌ Share your work with other students or institutions

### 🔒 **Data Access Control**

Different AI models have different access levels:

| AI Role | Can Access | Cannot Access |
|---------|-----------|---------------|
| **Grading AI** | Problem prompts, your answers | Learning history, personal info |
| **Hint Generator** | Problem prompts only | Your answers, personal info |
| **Personalization AI** | Learning history, mastery data | Raw answers, personal info |
| **Content Safety** | All content (for moderation) | N/A (special role) |
| **Research** | Anonymized patterns only | Any personally identifiable data |

**All AI data access is logged** and available to you in your account settings.

---

## 3. Data Protection & Security

### Encryption
- **At Rest:** All sensitive data encrypted using AES-128 (Fernet)
- **In Transit:** HTTPS/TLS 1.3 for all API communication
- **Encryption Keys:** Stored securely, rotated regularly, never in code

### Access Control
- **Role-Based:** Each AI model has minimum necessary permissions
- **Purpose-Limited:** Data only used for the specific educational task
- **Audit Logged:** Every AI data access is recorded with timestamp, role, and purpose

### Infrastructure Security
- **Hosted:** Railway (SOC 2 Type II certified)
- **Database:** PostgreSQL with encrypted connections
- **Authentication:** Firebase Auth / Supabase (industry-standard OAuth)
- **API Security:** Rate limiting, input validation, CSP headers

---

## 4. Data Retention & Deletion

### How Long We Keep Your Data

| Data Type | Retention Period | Reason |
|-----------|-----------------|--------|
| **Active Learning Data** | While account active | Your progress & personalization |
| **Completed Problem Sets** | 2 years after last view | Reference & review |
| **AI Interaction Logs** | 90 days | Quality improvement |
| **Account Data** | While account active | Login & subscription |
| **Anonymized Analytics** | Indefinitely | Product improvement |

### Your Deletion Rights

You can request to:
- **Delete specific problem sets** (immediately)
- **Delete your entire account** (within 30 days)
- **Export your data** (JSON format, within 7 days)

**How to delete your data:**
1. Go to Settings → Privacy
2. Click "Delete My Account" or "Export My Data"
3. Confirm via email

**What happens when you delete:**
- All personal information is permanently removed
- Learning data is anonymized (cannot be linked back to you)
- Subscription is canceled immediately
- Backups are purged within 30 days

---

## 5. Research & Improvement

### How We Improve Pclick

We analyze **anonymized, aggregated data** to:
- Improve AI accuracy (e.g., better grading, more helpful hints)
- Identify common learning challenges
- Optimize the user experience

**Examples of anonymized insights:**
- "Students struggle most with limits in calculus"
- "Socratic hints are more effective than direct answers"
- "Mind map feature increases problem-solving success by 23%"

### Research Participation (Optional)

You may be invited to opt into educational research studies. **Participation is always optional.**

If you consent to research:
- ✅ Your anonymized data may be used in published studies
- ✅ You can withdraw consent at any time
- ✅ No personally identifiable information is ever published
- ❌ We will never contact you without permission

**Current consent status:** Check Settings → Privacy → Research Consent

---

## 6. Third-Party AI Models

Pclick uses several AI providers to power features:

| Provider | Purpose | Data Sent | Data Retention (Provider) |
|----------|---------|-----------|---------------------------|
| **OpenAI GPT-4** | Critique review (debate team) | Problem context, AI-generated drafts | 30 days (zero retention opt-out) |
| **Groq** | Fast grading, critique | Problem prompts, student answers | Not retained (ephemeral) |
| **Google Gemini** | Vision analysis, grading | Problem images, mind maps | 30 days |
| **Ollama Cloud** | Primary reasoning, hints | Problem prompts, student questions | Not retained |
| **NVIDIA NIM** | Node summaries, roadmaps | Topic names, learning history | Not retained |

**All providers:**
- Operate under strict data processing agreements (DPAs)
- Do not train their models on Pclick user data
- Are prohibited from using data for non-educational purposes

---

## 7. Student Privacy Protections

### FERPA Compliance (US Students)
- We treat all learning data as "education records"
- No data shared with schools/parents without student consent
- Students 18+ have full control over their data

### GDPR Compliance (EU Students)
- Right to access, rectify, delete, and export data
- Transparent data processing (this document)
- Lawful basis: Consent + Legitimate Interest (education)

### COPPA Compliance (Under 13)
- Pclick requires users to be 13+ (or with parental consent)
- Minimal data collection for younger users
- No behavioral advertising ever

---

## 8. Your Rights & Controls

### Data Access
- **View Your Data:** Settings → Privacy → Download My Data
- **See AI Access Logs:** Settings → Privacy → AI Activity Log
- **Manage Encryption:** Settings → Security (view encryption status)

### Privacy Controls
- **Consent Management:** Opt in/out of research, analytics
- **Profile Visibility:** Public/private toggle (for shared problem sets)
- **Data Retention:** Configure auto-delete for old problem sets

### Support & Complaints
- **Data Questions:** privacy@pclick.app
- **Security Issues:** security@pclick.app
- **GDPR Requests:** gdpr@pclick.app

**Response Time:** Within 7 days for data requests, 48 hours for security issues

---

## 9. Changes to This Commitment

We may update this commitment as Pclick evolves. **Major changes** (e.g., new data uses, third-party sharing) will:
- Be announced 30 days in advance via email
- Require re-consent for affected features
- Never apply retroactively to existing data

**Version History:** See git log of this file for all changes

---

## 10. Contact & Transparency

**Data Protection Officer:** [To be appointed]  
**Email:** privacy@pclick.app  
**Address:** [Company address]

**Open Source Commitment:**
- This data commitment is versioned in our public repo
- Security & privacy code is open for audit
- Community can propose improvements via GitHub

---

## Summary: Our Pledge

✅ **Your data serves your learning, and nothing else**  
✅ **We encrypt and protect your data rigorously**  
✅ **You can delete your data at any time**  
✅ **We are transparent about every AI model that sees your work**  
✅ **We never sell your data or use it for ads**

**Questions?** Read our full [Privacy Policy](PRIVACY_POLICY.md) or email privacy@pclick.app.

---

*This commitment is part of Pclick's Security Initiative SOC-16: Data Protection & AI Access Control.*
