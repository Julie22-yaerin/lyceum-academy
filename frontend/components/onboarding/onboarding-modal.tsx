"use client";

/**
 * OnboardingModal — shown once per account after first sign-in.
 *
 * Step 1 · Profile   — major, university, year
 * Step 2 · Materials — Psets (required), Syllabus, Rubric (both optional)
 * Step 3 · Done
 *
 * Files are uploaded to the backend RAG (/admin/rag/upload) using the
 * user's Firebase ID token so the AI can reference them in hints.
 */

import { useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  Upload,
  X,
  Sparkles,
  AlertTriangle,
} from "lucide-react";

import { useFirebaseAuth } from "@/components/providers/firebase-auth";

// ── Constants ──────────────────────────────────────────────────────────────────

export const ONBOARDING_DONE_KEY = "pclick:onboarding:done";
export const PROFILE_KEY         = "pclick:profile";
const API = "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

type Step = "profile" | "materials" | "done";

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

// ── File pill ─────────────────────────────────────────────────────────────────

function FilePill({
  slot,
  onClear,
}: {
  slot: UploadSlot;
  onClear: () => void;
}) {
  if (!slot.file) return null;

  const statusIcon =
    slot.status === "uploading" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" />
    ) : slot.status === "done" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
    ) : slot.status === "error" ? (
      <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
    ) : (
      <FileText className="h-3.5 w-3.5 text-zinc-400" />
    );

  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-xs">
      {statusIcon}
      <span className="flex-1 truncate text-zinc-300">{slot.file.name}</span>
      {slot.status === "done" && slot.chunks != null && (
        <span className="text-zinc-500">{slot.chunks} chunks</span>
      )}
      {slot.status !== "uploading" && slot.status !== "done" && (
        <button
          type="button"
          onClick={onClear}
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Upload row ─────────────────────────────────────────────────────────────────

function UploadRow({
  label,
  required,
  hint,
  accept,
  slot,
  inputRef,
  onFile,
  onClear,
}: {
  label:    string;
  required: boolean;
  hint:     string;
  accept:   string;
  slot:     UploadSlot;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFile:   (f: File) => void;
  onClear:  () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white">{label}</span>
            {required ? (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                Bắt buộc
              </span>
            ) : (
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-zinc-500">
                Tuỳ chọn
              </span>
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
          <Upload className="h-3.5 w-3.5" />
          Chọn file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <FilePill slot={slot} onClear={onClear} />

      {slot.status === "error" && (
        <p className="mt-1.5 text-xs text-rose-400">{slot.error}</p>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function OnboardingModal({ onComplete }: { onComplete: () => void }) {
  const { user } = useFirebaseAuth();
  const [step, setStep] = useState<Step>("profile");

  // ── Step 1 state
  const [profile, setProfile] = useState<Profile>({
    major: "",
    university: "",
    year: "",
  });
  const [profileError, setProfileError] = useState("");

  // ── Step 2 state
  const [psets,    setPsets]    = useState<UploadSlot>({ file: null, status: "idle" });
  const [syllabus, setSyllabus] = useState<UploadSlot>({ file: null, status: "idle" });
  const [rubric,   setRubric]   = useState<UploadSlot>({ file: null, status: "idle" });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const psetRef     = useRef<HTMLInputElement>(null);
  const syllabusRef = useRef<HTMLInputElement>(null);
  const rubricRef   = useRef<HTMLInputElement>(null);

  // ── Helpers
  async function getToken(): Promise<string> {
    try {
      return (await user?.getIdToken()) ?? "";
    } catch {
      return "";
    }
  }

  async function uploadSlot(
    slot:     UploadSlot,
    setSlot:  (s: UploadSlot) => void,
    subject:  string,
    label:    string,
  ): Promise<boolean> {
    if (!slot.file || slot.status === "done") return true;
    setSlot({ ...slot, status: "uploading" });
    const token = await getToken();
    const fd    = new FormData();
    fd.append("file",    slot.file);
    fd.append("title",   `${label} — ${profile.university} ${profile.year}`.trim());
    fd.append("subject", subject);
    try {
      const r = await fetch(`${API}/admin/rag/upload`, {
        method:  "POST",
        headers: { "X-Admin-Token": token },
        body:    fd,
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

  // ── Step 1 → 2
  function handleProfileNext() {
    if (!profile.major.trim() || !profile.university.trim() || !profile.year.trim()) {
      setProfileError("Vui lòng điền đầy đủ thông tin.");
      return;
    }
    setProfileError("");
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    setStep("materials");
  }

  // ── Step 2 → 3 (finish)
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

    // Fail if psets upload failed
    if (results[0] === false) {
      setUploadError("Upload Psets thất bại. Kiểm tra backend và thử lại.");
      return;
    }

    localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    setStep("done");
  }

  // ── Step 2: skip all uploads
  function handleSkip() {
    localStorage.setItem(ONBOARDING_DONE_KEY, "1");
    onComplete();
  }

  // ── Render
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4"
         style={{ background: "rgba(5,8,22,0.85)", backdropFilter: "blur(6px)" }}>

      <div className="relative w-full max-w-lg rounded-[28px] border border-white/10 bg-[#090f1e] shadow-2xl">

        {/* Progress bar */}
        <div className="absolute top-0 left-0 h-0.5 rounded-t-[28px] bg-emerald-500/20 overflow-hidden w-full">
          <div
            className="h-full bg-emerald-400 transition-all duration-500"
            style={{ width: step === "profile" ? "33%" : step === "materials" ? "66%" : "100%" }}
          />
        </div>

        <div className="p-7 pt-8">

          {/* ───── Step 1: Profile ───── */}
          {step === "profile" && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                  Bước 1 / 2
                </p>
                <h2 className="mt-1 text-2xl font-bold text-white">Thông tin học tập</h2>
                <p className="mt-1.5 text-sm text-zinc-400">
                  Giúp chúng tôi cá nhân hoá lộ trình học tập cho bạn.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-medium text-zinc-400">Ngành học</span>
                  <input
                    autoFocus
                    type="text"
                    placeholder="VD: Khoa học máy tính, Toán ứng dụng…"
                    value={profile.major}
                    onChange={(e) => setProfile((p) => ({ ...p, major: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleProfileNext()}
                    className="mt-1.5 w-full rounded-2xl border border-white/10 bg-[#0b1225] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/40"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-zinc-400">Trường đại học</span>
                  <input
                    type="text"
                    placeholder="VD: ĐH Bách Khoa HCM, VNU-HCM…"
                    value={profile.university}
                    onChange={(e) => setProfile((p) => ({ ...p, university: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleProfileNext()}
                    className="mt-1.5 w-full rounded-2xl border border-white/10 bg-[#0b1225] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/40"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-medium text-zinc-400">Khoá / Năm học</span>
                  <input
                    type="text"
                    placeholder="VD: K65, 2022, Năm 3…"
                    value={profile.year}
                    onChange={(e) => setProfile((p) => ({ ...p, year: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && handleProfileNext()}
                    className="mt-1.5 w-full rounded-2xl border border-white/10 bg-[#0b1225] px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-emerald-500/40"
                  />
                </label>
              </div>

              {profileError && (
                <p className="text-xs text-rose-400">{profileError}</p>
              )}

              <button
                type="button"
                onClick={handleProfileNext}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20"
              >
                Tiếp tục
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ───── Step 2: Materials ───── */}
          {step === "materials" && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                  Bước 2 / 2
                </p>
                <h2 className="mt-1 text-2xl font-bold text-white">Tài liệu học phần</h2>
              </div>

              {/* Note banner */}
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <p className="text-sm text-emerald-200/80">
                  Những gì bạn cung cấp sẽ cho chúng tôi có thể phân tích{" "}
                  <strong className="text-emerald-300">chính xác hơn</strong> nội dung môn học,
                  từ đó đưa ra gợi ý và phân tích phù hợp với chương trình của bạn.
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
                      Hoàn tất
                      <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ───── Step 3: Done ───── */}
          {step === "done" && (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/20 bg-emerald-500/10">
                  <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-white">Sẵn sàng rồi!</h2>
                <p className="mt-2 text-sm text-zinc-400">
                  Tài liệu đã được lập chỉ mục. AI của bạn đã hiểu ngữ cảnh môn học.
                </p>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/3 px-5 py-4 text-left space-y-2">
                <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Hồ sơ</p>
                <div className="text-sm text-zinc-200 space-y-1">
                  <div className="flex gap-2">
                    <span className="text-zinc-500 w-24 shrink-0">Ngành</span>
                    <span>{profile.major}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-zinc-500 w-24 shrink-0">Trường</span>
                    <span>{profile.university}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-zinc-500 w-24 shrink-0">Khoá</span>
                    <span>{profile.year}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onComplete}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-3 text-sm font-medium text-emerald-100 transition-colors hover:bg-emerald-500/20"
              >
                Bắt đầu học →
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
