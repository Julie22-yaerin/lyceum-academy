"use client";

/**
 * OnboardingModal — shown once per account after first sign-in.
 *
 * Step 1 · Profile        — major, university, year
 * Step 2 · Subjects       — add môn học → each becomes a workspace tag
 * Step 3 · Learning Style — 10 sliders (0→100) saved to pclick:learning-style
 * Step 4 · Materials      — Psets (required), Syllabus, Rubric (optional)
 * Step 5 · Done
 */

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  Upload,
  X,
  Sparkles,
  AlertTriangle,
  Plus,
  BookOpen,
  Brain,
  Zap,
} from "lucide-react";

import { useFirebaseAuth } from "@/components/providers/firebase-auth";

// ── Storage keys (exported so other components can read them) ─────────────────
export const ONBOARDING_DONE_KEY  = "pclick:onboarding:done";
export const PROFILE_KEY          = "pclick:profile";
export const SUBJECTS_KEY         = "pclick:subjects";      // string[]
export const LEARNING_STYLE_KEY   = "pclick:learning-style"; // LearningStyle
export const PERSONA_MATCHES_KEY  = "pclick:persona-matches"; // PersonaMatch[]
export const SEASON_KEY           = "pclick:season";          // SeasonMap

// ── Types ─────────────────────────────────────────────────────────────────────
type Step = "profile" | "subjects" | "learning" | "materials" | "done";

export interface PersonaMatch {
  persona_id:           string;
  name:                 string;
  field:                string;
  era:                  string;
  special_trait:        string;
  special_trait_value:  number;
  epistemological_style?: string;
  match_pct:            number;
}

export type SeasonMap = Record<string, { persona_id: string; name: string; match_pct: number; reasoning?: string; task_season?: string }>;

export interface LearningStyle {
  visual:       number; // 0=Văn bản  → 100=Hình ảnh & sơ đồ
  exploration:  number; // 0=Hướng dẫn từng bước → 100=Tự khám phá
  concrete:     number; // 0=Ví dụ thực tế → 100=Khái niệm trừu tượng
  pace:         number; // 0=Chậm, kỹ → 100=Nhanh, cô đọng
  challenge:    number; // 0=Dễ xây tự tin → 100=Khó để phát triển
  depth:        number; // 0=Ngắn gọn → 100=Phân tích sâu
  structure:    number; // 0=Linh hoạt → 100=Logic từng bước
  practice:     number; // 0=Học lý thuyết trước → 100=Làm bài trước
  ai_proactive: number; // 0=AI chủ động gợi ý → 100=AI chỉ khi được gọi
  critique:     number; // 0=Nhẹ nhàng → 100=Khó tính, chất vấn
}

interface Profile {
  major:      string;
  university: string;
  year:       string;
}

interface UploadSlot {
  file:    File | null;
  status:  "idle" | "uploading" | "done" | "error";
  chunks?: number;
  error?:  string;
}

const DEFAULT_LEARNING_STYLE: LearningStyle = {
  visual: 50, exploration: 50, concrete: 50, pace: 50, challenge: 50,
  depth: 50, structure: 50, practice: 50, ai_proactive: 50, critique: 50,
};

const API = "http://localhost:8000";

const STEP_ORDER: Step[] = ["profile", "subjects", "learning", "materials", "done"];

// Slider definitions for the learning style step
const SLIDERS: {
  key: keyof LearningStyle;
  left: string;
  right: string;
}[] = [
  { key: "visual",       left: "Văn bản",                  right: "Hình ảnh & sơ đồ" },
  { key: "exploration",  left: "Được hướng dẫn từng bước", right: "Tự khám phá bằng câu hỏi" },
  { key: "concrete",     left: "Ví dụ thực tế",            right: "Khái niệm trừu tượng" },
  { key: "pace",         left: "Chậm, kỹ",                 right: "Nhanh, cô đọng" },
  { key: "challenge",    left: "Dễ xây tự tin",            right: "Khó để phát triển" },
  { key: "depth",        left: "Ngắn gọn",                 right: "Phân tích sâu" },
  { key: "structure",    left: "Linh hoạt",                right: "Logic từng bước" },
  { key: "practice",     left: "Học lý thuyết trước",      right: "Làm bài trước rồi rút ra lý thuyết" },
  { key: "ai_proactive", left: "AI chủ động gợi ý nhiều",  right: "AI chỉ xuất hiện khi được gọi" },
  { key: "critique",     left: "Nhẹ nhàng",                right: "Khó tính, chất vấn liên tục" },
];

// ── PersonaMatchCard ──────────────────────────────────────────────────────────
const RANK_COLORS = [
  "from-amber-500/15 border-amber-500/20",
  "from-sky-500/15 border-sky-500/20",
  "from-violet-500/15 border-violet-500/20",
];
const RANK_BADGE = ["#1", "#2", "#3"];
const RANK_BADGE_COLOR = ["text-amber-400", "text-sky-400", "text-violet-400"];

function PersonaMatchCard({ match, rank }: { match: PersonaMatch; rank: number }) {
  const colorIdx = Math.min(rank - 1, 2);
  return (
    <div className={`relative rounded-2xl border bg-gradient-to-br ${RANK_COLORS[colorIdx]} to-transparent p-4`}>
      {/* Rank badge */}
      <span className={`absolute top-3 right-3 text-xs font-bold tabular-nums ${RANK_BADGE_COLOR[colorIdx]}`}>
        {RANK_BADGE[colorIdx]}
      </span>

      <div className="flex items-start gap-3 pr-6">
        {/* Avatar circle */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-lg">
          {match.name.charAt(0)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{match.name}</span>
            <span className="text-xs text-zinc-500">{match.era}</span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{match.field}</p>

          {/* Special trait pill */}
          {match.special_trait && (
            <span className="mt-1.5 inline-block rounded-full bg-white/8 border border-white/10 px-2 py-0.5 text-[10px] text-zinc-300">
              {match.special_trait} {match.special_trait_value ? `${match.special_trait_value}%` : ""}
            </span>
          )}
        </div>
      </div>

      {/* Match bar */}
      <div className="mt-3">
        <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
          <span>Độ phù hợp</span>
          <span className="font-medium text-zinc-300">{match.match_pct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-700"
            style={{ width: `${match.match_pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── FilePill ──────────────────────────────────────────────────────────────────
function FilePill({ slot, onClear }: { slot: UploadSlot; onClear: () => void }) {
  if (!slot.file) return null;
  const statusIcon =
    slot.status === "uploading" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" /> :
    slot.status === "done"      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> :
    slot.status === "error"     ? <AlertTriangle className="h-3.5 w-3.5 text-rose-400" /> :
                                  <FileText className="h-3.5 w-3.5 text-zinc-400" />;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-xs">
      {statusIcon}
      <span className="flex-1 truncate text-zinc-300">{slot.file.name}</span>
      {slot.status === "done" && slot.chunks != null && (
        <span className="text-zinc-500">{slot.chunks} chunks</span>
      )}
      {slot.status !== "uploading" && slot.status !== "done" && (
        <button type="button" onClick={onClear} className="text-zinc-600 hover:text-zinc-300 transition-colors">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── UploadRow ─────────────────────────────────────────────────────────────────
function UploadRow({
  label, required, hint, accept, slot, inputRef, onFile, onClear,
}: {
  label: string; required: boolean; hint: string; accept: string;
  slot: UploadSlot; inputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void; onClear: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white">{label}</span>
            {required ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Bắt buộc</span>
            ) : (
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-zinc-500">Tuỳ chọn</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={slot.status === "uploading" || slot.status === "done"}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
        >
          <Upload className="h-3.5 w-3.5" />Chọn file
        </button>
        <input ref={inputRef} type="file" accept={accept} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      </div>
      <FilePill slot={slot} onClear={onClear} />
      {slot.status === "error" && <p className="mt-1.5 text-xs text-rose-400">{slot.error}</p>}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export function OnboardingModal({ onComplete }: { onComplete: () => void }) {
  const { user } = useFirebaseAuth();
  const [step, setStep] = useState<Step>("profile");

  // Step 1 — profile
  const [profile, setProfile] = useState<Profile>({ major: "", university: "", year: "" });
  const [profileError, setProfileError] = useState("");

  // Step 2 — subjects
  const [subjects, setSubjects] = useState<string[]>([]);
  const [subjectInput, setSubjectInput] = useState("");
  const [subjectError, setSubjectError] = useState("");

  // Step 3 — learning style
  const [learningStyle, setLearningStyle] = useState<LearningStyle>({ ...DEFAULT_LEARNING_STYLE });

  // Step 4 — materials
  const [psets,    setPsets]    = useState<UploadSlot>({ file: null, status: "idle" });
  const [syllabus, setSyllabus] = useState<UploadSlot>({ file: null, status: "idle" });
  const [rubric,   setRubric]   = useState<UploadSlot>({ file: null, status: "idle" });
  const [uploading,    setUploading]    = useState(false);
  const [uploadError,  setUploadError]  = useState("");

  // Persona matching state (populated when entering "done" step)
  const [personaMatches,   setPersonaMatches]   = useState<PersonaMatch[]>([]);
  const [personaLoading,   setPersonaLoading]   = useState(false);

  const psetRef     = useRef<HTMLInputElement>(null);
  const syllabusRef = useRef<HTMLInputElement>(null);
  const rubricRef   = useRef<HTMLInputElement>(null);

  // Progress bar width
  const stepIndex  = STEP_ORDER.indexOf(step);
  const progressPct = Math.round(((stepIndex) / (STEP_ORDER.length - 1)) * 100);

  async function getToken(): Promise<string> {
    try { return (await user?.getIdToken()) ?? ""; } catch { return ""; }
  }

  async function uploadSlot(
    slot: UploadSlot, setSlot: (s: UploadSlot) => void, subject: string, label: string,
  ): Promise<boolean> {
    if (!slot.file || slot.status === "done") return true;
    setSlot({ ...slot, status: "uploading" });
    const token = await getToken();
    const fd = new FormData();
    fd.append("file",    slot.file);
    fd.append("title",   `${label} — ${profile.university} ${profile.year}`.trim());
    fd.append("subject", subject);
    try {
      const r = await fetch(`${API}/admin/rag/upload`, {
        method: "POST", headers: { "X-Admin-Token": token }, body: fd,
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => r.statusText);
        setSlot({ file: slot.file, status: "error", error: msg });
        return false;
      }
      const data = await r.json();
      setSlot({ file: slot.file, status: "done", chunks: data.chunks });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lỗi kết nối backend";
      setSlot({ file: slot.file, status: "error", error: msg });
      return false;
    }
  }

  // ── Step handlers ──────────────────────────────────────────────────────────
  function handleProfileNext() {
    if (!profile.major.trim() || !profile.university.trim() || !profile.year.trim()) {
      setProfileError("Vui lòng điền đầy đủ thông tin.");
      return;
    }
    setProfileError("");
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    setStep("subjects");
  }

  function addSubject() {
    const trimmed = subjectInput.trim();
    if (!trimmed) return;
    if (subjects.includes(trimmed)) { setSubjectInput(""); return; }
    setSubjects((prev) => [...prev, trimmed]);
    setSubjectInput("");
    setSubjectError("");
  }

  function removeSubject(name: string) {
    setSubjects((prev) => prev.filter((s) => s !== name));
  }

  function handleSubjectsNext() {
    if (subjects.length === 0) {
      setSubjectError("Thêm ít nhất một môn học để tiếp tục.");
      return;
    }
    localStorage.setItem(SUBJECTS_KEY, JSON.stringify(subjects));
    setStep("learning");
  }

  function handleLearningNext() {
    localStorage.setItem(LEARNING_STYLE_KEY, JSON.stringify(learningStyle));
    setStep("materials");
  }

  async function handleFinish() {
    if (!psets.file && psets.status !== "done") {
      setUploadError("Bạn cần tải lên ít nhất 1 file Psets để tiếp tục.");
      return;
    }
    setUploadError("");
    setUploading(true);
    const results = await Promise.all([
      uploadSlot(psets,    setPsets,    "pset",     "Problem Set"),
      uploadSlot(syllabus, setSyllabus, "syllabus", "Syllabus"),
      uploadSlot(rubric,   setRubric,   "rubric",   "Rubric"),
    ]);
    setUploading(false);
    if (results[0] === false) {
      setUploadError("Upload Psets thất bại. Kiểm tra backend và thử lại.");
      return;
    }
    localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    setStep("done");
  }

  function handleSkip() {
    localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    onComplete();
  }

  // ── Persona matching ────────────────────────────────────────────────────────
  async function fetchPersonaMatches() {
    setPersonaLoading(true);
    const token = await getToken();
    try {
      const res = await fetch(`${API}/personas/save-style`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ learning_style: learningStyle, subjects }),
      });
      if (res.ok) {
        const data = await res.json();
        const matches: PersonaMatch[] = data.top_matches ?? [];
        setPersonaMatches(matches);
        localStorage.setItem(PERSONA_MATCHES_KEY, JSON.stringify(matches));
        if (data.season) {
          localStorage.setItem(SEASON_KEY, JSON.stringify(data.season));
        }
      }
    } catch {
      // soft-fail — Done screen still shows without matches
    } finally {
      setPersonaLoading(false);
    }
  }

  // Trigger persona fetch whenever Done step becomes active
  useEffect(() => {
    if (step === "done" && personaMatches.length === 0) {
      fetchPersonaMatches();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: "rgba(5,8,22,0.85)", backdropFilter: "blur(6px)" }}>
      <div className="relative w-full max-w-lg rounded-[28px] border border-white/10 bg-[#090f1e] shadow-2xl">

        {/* Progress bar */}
        <div className="absolute top-0 left-0 h-0.5 rounded-t-[28px] bg-emerald-500/20 overflow-hidden w-full">
          <div className="h-full bg-emerald-400 transition-all duration-500"
               style={{ width: `${progressPct}%` }} />
        </div>

        <div className="p-7 pt-8 max-h-[90vh] overflow-y-auto">

          {/* ─── STEP 1: Profile ─── */}
          {step === "profile" && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Bước 1 / 4</p>
                <h2 className="mt-1 text-2xl font-bold text-white">Thông tin học tập</h2>
                <p className="mt-1.5 text-sm text-zinc-400">Giúp chúng tôi cá nhân hoá lộ trình học tập cho bạn.</p>
              </div>
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-medium text-zinc-400">Ngành học</span>
                  <input autoFocus type="text" placeholder="VD: Khoa học máy tính, Toán ứng dụng…"
                    value={profile.major}
                    onChange={(e) => setProfile((p) => ({ ...p, major: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleProfileNext()}
                    className="mt-1.5 w-full rounded-2xl border border-white/10 bg-[#0b1225] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/40" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-zinc-400">Trường đại học</span>
                  <input type="text" placeholder="VD: ĐH Bách Khoa HCM, VNU-HCM…"
                    value={profile.university}
                    onChange={(e) => setProfile((p) => ({ ...p, university: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleProfileNext()}
                    className="mt-1.5 w-full rounded-2xl border border-white/10 bg-[#0b1225] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/40" />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-zinc-400">Khoá / Năm học</span>
                  <input type="text" placeholder="VD: K65, 2022, Năm 3…"
                    value={profile.year}
                    onChange={(e) => setProfile((p) => ({ ...p, year: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleProfileNext()}
                    className="mt-1.5 w-full rounded-2xl border border-white/10 bg-[#0b1225] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/40" />
                </label>
              </div>
              {profileError && <p className="text-xs text-rose-400">{profileError}</p>}
              <button type="button" onClick={handleProfileNext}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20">
                Tiếp tục <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ─── STEP 2: Subjects ─── */}
          {step === "subjects" && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Bước 2 / 4</p>
                <h2 className="mt-1 text-2xl font-bold text-white">Môn học của bạn</h2>
                <p className="mt-1.5 text-sm text-zinc-400">
                  Mỗi môn học sẽ trở thành một workspace riêng. Bạn có thể thêm nhiều môn.
                </p>
              </div>

              {/* Input row */}
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="VD: Giải tích, CTDL & GT, Vật lý 1…"
                  value={subjectInput}
                  onChange={(e) => setSubjectInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSubject(); } }}
                  className="flex-1 rounded-2xl border border-white/10 bg-[#0b1225] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/40"
                />
                <button type="button" onClick={addSubject}
                  className="flex items-center gap-1.5 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20">
                  <Plus className="h-4 w-4" /> Thêm
                </button>
              </div>

              {/* Tags list */}
              {subjects.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {subjects.map((s) => (
                    <span key={s}
                      className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 pl-3 pr-2 py-1 text-sm text-emerald-200">
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      {s}
                      <button type="button" onClick={() => removeSubject(s)}
                        className="ml-0.5 text-emerald-500/60 hover:text-emerald-300 transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {subjectError && <p className="text-xs text-rose-400">{subjectError}</p>}

              <button type="button" onClick={handleSubjectsNext}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20">
                Tiếp tục <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ─── STEP 3: Learning Style ─── */}
          {step === "learning" && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Bước 3 / 4</p>
                <h2 className="mt-1 text-2xl font-bold text-white flex items-center gap-2">
                  <Brain className="h-6 w-6 text-emerald-400 shrink-0" />
                  What&apos;s your brain&apos;s fav?
                </h2>
                <p className="mt-1.5 text-sm text-zinc-400">
                  Kéo mỗi thanh về phía phong cách bạn thích. AI sẽ tìm ra nhà khoa học phù hợp nhất với cách não bạn hoạt động.
                </p>
              </div>

              <div className="space-y-4 max-h-[50vh] overflow-y-auto pr-1">
                {SLIDERS.map((slider) => (
                  <div key={slider.key} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span className="max-w-[42%] leading-tight">{slider.left}</span>
                      <span className="font-medium text-zinc-400 tabular-nums">
                        {learningStyle[slider.key]}
                      </span>
                      <span className="max-w-[42%] text-right leading-tight">{slider.right}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={learningStyle[slider.key]}
                      onChange={(e) =>
                        setLearningStyle((prev) => ({
                          ...prev,
                          [slider.key]: Number(e.target.value),
                        }))
                      }
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                  </div>
                ))}
              </div>

              <button type="button" onClick={handleLearningNext}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20">
                Tiếp tục <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ─── STEP 4: Materials ─── */}
          {step === "materials" && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Bước 4 / 4</p>
                <h2 className="mt-1 text-2xl font-bold text-white">Tài liệu học phần</h2>
              </div>

              <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <p className="text-sm text-emerald-200/80">
                  Những gì bạn cung cấp sẽ giúp AI phân tích{" "}
                  <strong className="text-emerald-300">chính xác hơn</strong> nội dung môn học,
                  từ đó đưa ra gợi ý phù hợp với chương trình của bạn.
                </p>
              </div>

              <div className="space-y-3">
                <UploadRow
                  label="Problem Sets (Psets)"
                  required
                  hint="Đề bài / bài tập của môn học — dùng để phân tích yêu cầu và gợi ý"
                  accept=".pdf,.txt,.md"
                  slot={psets}
                  inputRef={psetRef}
                  onFile={(f) => setPsets({ file: f, status: "idle" })}
                  onClear={() => setPsets({ file: null, status: "idle" })}
                />
                <UploadRow
                  label="Syllabus / Đề cương"
                  required={false}
                  hint="Nội dung chương trình — giúp AI hiểu ngữ cảnh từng chủ đề"
                  accept=".pdf,.txt,.md"
                  slot={syllabus}
                  inputRef={syllabusRef}
                  onFile={(f) => setSyllabus({ file: f, status: "idle" })}
                  onClear={() => setSyllabus({ file: null, status: "idle" })}
                />
                <UploadRow
                  label="Rubric / Thang điểm"
                  required={false}
                  hint="Tiêu chí chấm điểm — giúp AI nhận xét bài làm đúng chuẩn"
                  accept=".pdf,.txt,.md"
                  slot={rubric}
                  inputRef={rubricRef}
                  onFile={(f) => setRubric({ file: f, status: "idle" })}
                  onClear={() => setRubric({ file: null, status: "idle" })}
                />
              </div>

              {uploadError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  {uploadError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={uploading}
                  className="flex-1 rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm text-zinc-400 transition-colors hover:bg-white/8 hover:text-zinc-200 disabled:opacity-40"
                >
                  Bỏ qua
                </button>
                <button
                  type="button"
                  onClick={handleFinish}
                  disabled={uploading}
                  className="flex flex-[2] items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20 disabled:pointer-events-none disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Đang tải lên…
                    </>
                  ) : (
                    <>
                      Hoàn tất <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ─── STEP 5: Done ─── */}
          {step === "done" && (
            <div className="space-y-5">
              {/* Header */}
              <div className="text-center space-y-2">
                <div className="flex justify-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
                    <CheckCircle2 className="h-7 w-7 text-emerald-400" />
                  </div>
                </div>
                <h2 className="text-2xl font-bold text-white">Sẵn sàng rồi!</h2>
                <p className="text-sm text-zinc-400">
                  Hồ sơ, phong cách học và AI đồng hành đã được thiết lập.
                </p>
              </div>

              {/* Profile summary row */}
              <div className="rounded-2xl border border-white/8 bg-white/3 px-4 py-3 text-left">
                <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Hồ sơ</div>
                <div className="text-sm text-zinc-200 space-y-1">
                  <div className="flex gap-2">
                    <span className="text-zinc-500 w-16 shrink-0">Ngành</span>
                    <span className="truncate">{profile.major}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-zinc-500 w-16 shrink-0">Trường</span>
                    <span className="truncate">{profile.university}</span>
                  </div>
                </div>
                {subjects.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {subjects.map((s) => (
                      <span key={s}
                        className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-xs text-emerald-300">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Persona matches */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="h-4 w-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-white">AI đồng hành của bạn</span>
                  <span className="text-xs text-zinc-500">— top 3 phù hợp nhất</span>
                </div>

                {personaLoading ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-zinc-500 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
                    Đang phân tích phong cách học của bạn…
                  </div>
                ) : personaMatches.length > 0 ? (
                  <div className="space-y-2.5">
                    {personaMatches.map((p, i) => (
                      <PersonaMatchCard key={p.persona_id} match={p} rank={i + 1} />
                    ))}
                  </div>
                ) : (
                  /* Fallback if backend unreachable */
                  <div className="rounded-2xl border border-white/8 bg-white/3 px-4 py-3 text-xs text-zinc-500 text-center">
                    Không thể tải danh sách AI đồng hành — bạn có thể chọn sau trong phần Cài đặt.
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={onComplete}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20"
              >
                Bắt đầu học <Zap className="h-4 w-4" />
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
