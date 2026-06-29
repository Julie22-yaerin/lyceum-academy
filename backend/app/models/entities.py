from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class FieldEnum(str, enum.Enum):
    mathematics = "mathematics"
    physics = "physics"
    computer_science = "computer_science"
    economics = "economics"


class DifficultyEnum(str, enum.Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"
    extreme = "extreme"


class CognitiveDepthEnum(str, enum.Enum):
    level_1 = "level_1"
    level_2 = "level_2"
    level_3 = "level_3"
    level_4 = "level_4"
    level_5 = "level_5"


class PsetStatusEnum(str, enum.Enum):
    uploaded = "uploaded"
    analyzing = "analyzing"
    ready = "ready"
    archived = "archived"


class JobStatusEnum(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class AttemptModeEnum(str, enum.Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"
    extreme = "extreme"


class ReportStatusEnum(str, enum.Enum):
    pending = "pending"
    ready = "ready"
    failed = "failed"


class AuthProviderEnum(str, enum.Enum):
    firebase = "firebase"
    supabase = "supabase"


class UserProfile(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # provider + subject là “identity key” thật (uid của Firebase hoặc user id của Supabase)
    auth_provider: Mapped[AuthProviderEnum] = mapped_column(
        Enum(AuthProviderEnum), default=AuthProviderEnum.firebase, nullable=False
    )
    auth_subject: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(255))
    university: Mapped[str | None] = mapped_column(String(255))
    headline: Mapped[str | None] = mapped_column(String(255))
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    community_profile: Mapped["CommunityProfile | None"] = relationship(
        back_populates="user", uselist=False
    )
    psets: Mapped[list["Pset"]] = relationship(back_populates="owner")

    __table_args__ = (UniqueConstraint("auth_provider", "auth_subject", name="uq_user_auth_identity"),)


class CommunityProfile(Base, TimestampMixin):
    __tablename__ = "community_profiles"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), unique=True, nullable=False
    )
    bio: Mapped[str | None] = mapped_column(Text)
    public_handle: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    study_consistency_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    concepts_mastered_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    psets_shared_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user: Mapped["UserProfile"] = relationship(back_populates="community_profile")


class StoredAsset(Base, TimestampMixin):
    __tablename__ = "stored_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    storage_bucket: Mapped[str] = mapped_column(String(128), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(128))


class Pset(Base, TimestampMixin):
    __tablename__ = "psets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("stored_assets.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    source_course: Mapped[str | None] = mapped_column(String(255))
    field: Mapped[FieldEnum] = mapped_column(Enum(FieldEnum), nullable=False)
    subfield: Mapped[str] = mapped_column(String(120), nullable=False)
    topic_weights: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    extracted_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    status: Mapped[PsetStatusEnum] = mapped_column(
        Enum(PsetStatusEnum), default=PsetStatusEnum.uploaded, nullable=False
    )

    owner: Mapped["UserProfile"] = relationship(back_populates="psets")
    problems: Mapped[list["Problem"]] = relationship(back_populates="pset", cascade="all, delete-orphan")
    reasoning_trees: Mapped[list["ReasoningTree"]] = relationship(back_populates="pset")
    reports: Mapped[list["PDFReport"]] = relationship(back_populates="pset")
    shares: Mapped[list["PsetShare"]] = relationship(back_populates="pset")


class Problem(Base, TimestampMixin):
    __tablename__ = "problems"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("psets.id"), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    cleaned_prompt: Mapped[str | None] = mapped_column(Text)
    irrelevant_information: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    prerequisites: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    required_skills: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    difficulty: Mapped[DifficultyEnum] = mapped_column(Enum(DifficultyEnum), nullable=False)
    cognitive_depth: Mapped[CognitiveDepthEnum] = mapped_column(
        Enum(CognitiveDepthEnum), nullable=False
    )

    pset: Mapped["Pset"] = relationship(back_populates="problems")
    concepts: Mapped[list["ProblemConcept"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan"
    )
    reasoning_tree: Mapped["ReasoningTree | None"] = relationship(
        back_populates="problem", uselist=False, cascade="all, delete-orphan"
    )
    attempts: Mapped[list["Attempt"]] = relationship(back_populates="problem")

    __table_args__ = (UniqueConstraint("pset_id", "ordinal", name="uq_problem_pset_ordinal"),)


class Concept(Base, TimestampMixin):
    __tablename__ = "concepts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    field: Mapped[FieldEnum] = mapped_column(Enum(FieldEnum), nullable=False)
    subfield: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    problems: Mapped[list["ProblemConcept"]] = relationship(back_populates="concept")
    mastery_records: Mapped[list["KnowledgeMastery"]] = relationship(back_populates="concept")


class ProblemConcept(Base, TimestampMixin):
    __tablename__ = "problem_concepts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    problem_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("problems.id"), nullable=False
    )
    concept_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.8, nullable=False)

    problem: Mapped["Problem"] = relationship(back_populates="concepts")
    concept: Mapped["Concept"] = relationship(back_populates="problems")

    __table_args__ = (UniqueConstraint("problem_id", "concept_id", name="uq_problem_concept"),)


class ReasoningTree(Base, TimestampMixin):
    __tablename__ = "reasoning_trees"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("psets.id"), nullable=False)
    problem_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("problems.id"), nullable=False, unique=True
    )
    overview: Mapped[str] = mapped_column(Text, nullable=False)

    pset: Mapped["Pset"] = relationship(back_populates="reasoning_trees")
    problem: Mapped["Problem"] = relationship(back_populates="reasoning_tree")
    nodes: Mapped[list["ReasoningNode"]] = relationship(
        back_populates="tree", cascade="all, delete-orphan"
    )


class ReasoningNode(Base, TimestampMixin):
    __tablename__ = "reasoning_nodes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tree_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reasoning_trees.id"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reasoning_nodes.id"), nullable=True
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    node_type: Mapped[str] = mapped_column(String(64), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    hint_text: Mapped[str | None] = mapped_column(Text)
    node_metadata: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)

    tree: Mapped["ReasoningTree"] = relationship(back_populates="nodes")


class Attempt(Base, TimestampMixin):
    __tablename__ = "attempts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    problem_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("problems.id"), nullable=False
    )
    mode: Mapped[AttemptModeEnum] = mapped_column(Enum(AttemptModeEnum), nullable=False)
    response_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    evaluation_payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    time_spent_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accuracy_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    problem: Mapped["Problem"] = relationship(back_populates="attempts")
    hints: Mapped[list["AttemptHint"]] = relationship(
        back_populates="attempt", cascade="all, delete-orphan"
    )


class AttemptHint(Base, TimestampMixin):
    __tablename__ = "attempt_hints"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("attempts.id"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    specificity_level: Mapped[int] = mapped_column(Integer, nullable=False)
    hint_text: Mapped[str] = mapped_column(Text, nullable=False)

    attempt: Mapped["Attempt"] = relationship(back_populates="hints")


class ProgressSnapshot(Base):
    __tablename__ = "progress"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    field: Mapped[FieldEnum] = mapped_column(Enum(FieldEnum), nullable=False)
    subfield: Mapped[str] = mapped_column(String(120), nullable=False)
    mastery_overview: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    solved_problems_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    study_hours_total: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (UniqueConstraint("user_id", "field", "subfield", name="uq_progress_scope"),)


class KnowledgeMastery(Base, TimestampMixin):
    __tablename__ = "knowledge_mastery"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    concept_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("concepts.id"), nullable=False
    )
    mastery_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    concept: Mapped["Concept"] = relationship(back_populates="mastery_records")

    __table_args__ = (UniqueConstraint("user_id", "concept_id", name="uq_user_concept_mastery"),)


class WeeklyLeaderboard(Base, TimestampMixin):
    __tablename__ = "leaderboards"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    week_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    field: Mapped[FieldEnum] = mapped_column(Enum(FieldEnum), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)

    entries: Mapped[list["WeeklyLeaderboardEntry"]] = relationship(
        back_populates="leaderboard", cascade="all, delete-orphan"
    )


class WeeklyLeaderboardEntry(Base, TimestampMixin):
    __tablename__ = "leaderboard_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    leaderboard_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("leaderboards.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    problems_completed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    concepts_mastered: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    study_consistency: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    leaderboard: Mapped["WeeklyLeaderboard"] = relationship(back_populates="entries")

    __table_args__ = (UniqueConstraint("leaderboard_id", "user_id", name="uq_leaderboard_user"),)


class PsetShare(Base, TimestampMixin):
    __tablename__ = "pset_shares"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("psets.id"), nullable=False)
    share_slug: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    visibility: Mapped[str] = mapped_column(String(32), default="public", nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)

    pset: Mapped["Pset"] = relationship(back_populates="shares")


class PDFReport(Base, TimestampMixin):
    __tablename__ = "pdf_reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("psets.id"), nullable=False)
    generated_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[ReportStatusEnum] = mapped_column(
        Enum(ReportStatusEnum), default=ReportStatusEnum.pending, nullable=False
    )
    file_url: Mapped[str | None] = mapped_column(String(512))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    pset: Mapped["Pset"] = relationship(back_populates="reports")


class AIAnalysisJob(Base, TimestampMixin):
    __tablename__ = "ai_analysis_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pset_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("psets.id"), nullable=False)
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    status: Mapped[JobStatusEnum] = mapped_column(
        Enum(JobStatusEnum), default=JobStatusEnum.queued, nullable=False
    )
    model_name: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False)
    input_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    output_snapshot: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
