# Plan: Card-Based Exercises from Second Brain + Backend Rename

## Overview
Two changes to the Lyceum platform:
1. **Replace the static ExerciseView** with dynamic card-based exercises AI-generated from the second brain vault
2. **Rename backend models** from Pset/Problem/PsetShare → Playground/Exercise/PlaygroundShare

---

## Part 1: Card-Based Exercises from Second Brain

### What
The current `ExerciseView.tsx` (89 lines) is a static placeholder showing a hardcoded philosophy question. Replace it with a fully functional exercise card system where:
- AI generates exercise cards on-the-fly from second brain notes when a student selects a topic/subject
- Each card has a question, student answers, then a scorer grades each answer (using existing `gradeDual`/`gradeAll` APIs)
- Keep existing features: tool map validation, reverse-build rescue mode, variant/bonus questions
- Cards are presented in a swipeable/tappable card stack UI

### Backend: New Endpoint
**File: `backend/app/main.py`**
- Add `POST /ai/generate-exercises` endpoint
  - Input: `{ subject: string, topic?: string, count?: number }`
  - Uses RAG to pull relevant second brain notes for the subject/topic
  - AI generates `count` (default 10) exercise cards with questions, difficulty, concepts
  - Returns `{ cards: [{ id, question, difficulty, concepts, subject, topic }] }`
  - Uses existing `ai_svc` + `rag_svc.context_for()` to ground generation in real curriculum content

**File: `backend/app/services/ai.py`**
- Add `generate_exercises(subject, topic, count, rag_context)` function
  - Prompt template: "Based on the following curriculum content, generate {count} exercise questions..."
  - Each card gets: question text, difficulty level, associated concepts, source topic

### Frontend: New ExerciseView
**File: `the-lyceum-academy/src/views/ExerciseView.tsx`** (complete rewrite)

Core components:
1. **CardStack** - Displays current card with flip/swipe animation
2. **AnswerArea** - Textarea + scholarly symbols grid (kept from current)
3. **ScorerBar** - Per-question grading feedback using `gradeDual` API
4. **ToolMapPanel** - Tool map validation (ported from ProblemSetsView)
5. **ReverseBuildOverlay** - Reverse-build rescue mode (ported from ProblemSetsView)
6. **ProgressBar** - Card progress indicator (e.g., "4 of 12")
7. **BonusRound** - Variant questions after all cards graded (using `generateVariants` API)

Card interaction flow:
1. Student selects subject → AI generates cards from second brain
2. Student reads question, types answer, submits
3. Scorer grades the answer immediately (per-sentence scoring via `gradeDual`)
4. If wrong: option to Request Hint, use Tool Map, or trigger Reverse Build
5. If rescued via Reverse Build: card is queued for bonus variant round
6. After all cards graded: offer bonus round of AI-generated variants
7. Final summary: score, concepts mastered, areas to review

### i18n Updates
**File: `the-lyceum-academy/src/i18n/translations.ts`**
- Replace static `exercise.*` keys with dynamic ones:
  - `exercise.cardOf` → `{{current}} of {{total}}`
  - `exercise Generating...` → `Generating exercises...`
  - `exercise.answerPlaceholder` → `Type your answer here...`
  - `exercise.scored` → `Scored`
  - `exercise.correct` → `Correct`
  - `exercise.incorrect` → `Incorrect`
  - `exercise.hint` → `Request Hint`
  - `exercise.reverseBuild` → `Reverse Build`
  - `exercise.toolMap` → `Tool Map`
  - `exercise.bonusRound` → `Bonus Round`
  - `exercise.summary` → `Summary`
  - `exercise.masteryGained` → `Mastery Gained`
  - `exercise.reviewNeeded` → `Review Needed`
  - Keep existing keys that are still relevant, update all 13 languages

### API Client Updates
**File: `the-lyceum-academy/src/lib/api.ts`**
- Add `generateExercises(subject, topic?, count?)` function
- Existing `gradeDual`, `gradeAll`, `generateVariants`, `reverseBuildEval` are already available

### Persistence Updates
**File: `the-lyceum-academy/src/lib/persist.ts`**
- Add `SavedExerciseCard` interface and localStorage persistence (similar to SavedPSet)
- Store current card session with 24h TTL

---

## Part 2: Backend Model Rename

### Database Models
**File: `backend/app/models/entities.py`**

| Old Name | New Name | Table Old | Table New |
|----------|----------|-----------|-----------|
| `Pset` | `Playground` | `psets` | `playgrounds` |
| `Problem` | `Exercise` | `problems` | `exercises` |
| `PsetShare` | `PlaygroundShare` | `pset_shares` | `playground_shares` |
| `PsetStatusEnum` | `PlaygroundStatusEnum` | — | — |
| `ProblemConcept` | `ExerciseConcept` | `problem_concepts` | `exercise_concepts` |

Field renames:
- `Problem.pset_id` → `Exercise.playground_id`
- `PsetShare.pset_id` → `PlaygroundShare.playground_id`
- `PDFReport.pset_id` → `PDFReport.playground_id`
- `UserProfile.psets` relationship → `UserProfile.playgrounds`
- `Pset.problems` → `Playground.exercises`
- `Pset.shares` → `Playground.shares`
- `Pset.reports` → `Playground.reports`
- `Problem.pset` → `Exercise.playground`
- `ProblemConcept.problem` → `ExerciseConcept.exercise`
- `PsetShare.pset` → `PlaygroundShare.playground`
- `PDFReport.pset` → `PDFReport.playground`

### Migration
**File: `backend/migrations/` (new migration file)**
- `ALTER TABLE psets RENAME TO playgrounds`
- `ALTER TABLE problems RENAME TO exercises`
- `ALTER TABLE pset_shares RENAME TO playground_shares`
- `ALTER TABLE problem_concepts RENAME TO exercise_concepts`
- Rename all foreign key columns
- Rename enum types
- Update indexes

### API Router Updates
**File: `backend/app/main.py`**
- Update all references from `Pset` → `Playground`, `Problem` → `Exercise`
- Update `_record_grade_results` and other helper functions
- Update request/response models that reference pset/problem

### Service Updates
All files in `backend/app/services/` that reference Pset/Problem:
- `ai.py` (57 references)
- `data_retention.py` (15 references)
- `personas.py` (4 references)
- `mastery_profile.py` (2 references)
- `ux_metrics.py` (7 references)
- `activity_log.py` (3 references)
- `encryption.py` (1 reference)
- `pii_filter.py` (5 references)

### Migration Strategy
1. Create Alembic migration that renames tables and columns
2. Use `batch_alter_table` for SQLite compatibility
3. Update all Python imports and references
4. Test with existing data

---

## Execution Order

### Phase 1: Backend Rename (do first to avoid conflicts)
1. Rename models in `entities.py`
2. Create database migration
3. Update all service files
4. Update `main.py` routes and request models
5. Verify backend starts without errors

### Phase 2: Exercise Card System
1. Add `POST /ai/generate-exercises` endpoint in `main.py`
2. Add `generate_exercises()` in `ai.py`
3. Rewrite `ExerciseView.tsx` with card-based UI
4. Add `generateExercises()` to `api.ts`
5. Add exercise persistence to `persist.ts`
6. Update i18n translations
7. Update navigation references in `App.tsx`, `FloatingDock.tsx`, `MainLayout.tsx`

### Phase 3: Verification
1. Run backend: `cd backend && python -m uvicorn app.main:app`
2. Run frontend: `cd the-lyceum-academy && npm run dev`
3. Test exercise generation and card interaction
4. Verify all views still navigate correctly

---

## Files Modified (estimated)

### Backend (rename + new endpoint)
- `backend/app/models/entities.py` — model renames
- `backend/app/main.py` — route updates + new endpoint
- `backend/app/services/ai.py` — new generate_exercises function
- `backend/app/services/data_retention.py` — reference updates
- `backend/app/services/personas.py` — reference updates
- `backend/app/services/mastery_profile.py` — reference updates
- `backend/app/services/ux_metrics.py` — reference updates
- `backend/app/services/activity_log.py` — reference updates
- `backend/app/services/encryption.py` — reference updates
- `backend/app/services/pii_filter.py` — reference updates
- `backend/migrations/` — new migration

### Frontend (new ExerciseView + i18n)
- `the-lyceum-academy/src/views/ExerciseView.tsx` — complete rewrite
- `the-lyceum-academy/src/lib/api.ts` — new generateExercises function
- `the-lyceum-academy/src/lib/persist.ts` — exercise persistence
- `the-lyceum-academy/src/i18n/translations.ts` — updated exercise keys
- `the-lyceum-academy/src/App.tsx` — update ExerciseView import
- `the-lyceum-academy/src/components/FloatingDock.tsx` — update nav label
- `the-lyceum-academy/src/components/MainLayout.tsx` — update view references
