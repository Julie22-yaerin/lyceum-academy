"use client";

/**
 * WorkspaceTabs — Chrome-style tab bar for subject workspaces.
 *
 * Each subject from localStorage becomes a tab. Users can:
 * - Switch between subject workspaces
 * - Add new subjects via inline input
 * - Close tabs (keeping at least one)
 */

import { useState, useRef, useEffect } from "react";
import { Plus, X, BookOpen } from "lucide-react";
import { SUBJECTS_KEY } from "@/components/onboarding/onboarding-modal";

export interface WorkspaceTabsProps {
  activeSubject: string;
  onSubjectChange: (subject: string) => void;
}

export function WorkspaceTabs({ activeSubject, onSubjectChange }: WorkspaceTabsProps) {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Load subjects from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SUBJECTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSubjects(parsed);
          // If no active subject yet, select the first one
          if (!activeSubject && parsed.length > 0) {
            onSubjectChange(parsed[0]);
          }
        }
      }
    } catch {
      // soft-fail
    }
  }, []);

  // Persist subjects to localStorage whenever they change
  useEffect(() => {
    if (subjects.length > 0) {
      localStorage.setItem(SUBJECTS_KEY, JSON.stringify(subjects));
    }
  }, [subjects]);

  // Focus input when adding
  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  function addSubject() {
    const trimmed = newSubject.trim();
    if (!trimmed || subjects.includes(trimmed)) {
      setNewSubject("");
      setIsAdding(false);
      return;
    }
    const updated = [...subjects, trimmed];
    setSubjects(updated);
    setNewSubject("");
    setIsAdding(false);
    onSubjectChange(trimmed);
  }

  function removeSubject(name: string) {
    if (subjects.length <= 1) return; // keep at least one
    const updated = subjects.filter((s) => s !== name);
    setSubjects(updated);
    // If removing active tab, switch to first remaining
    if (activeSubject === name && updated.length > 0) {
      onSubjectChange(updated[0]);
    }
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide px-2 py-2">
      {subjects.map((subject) => (
        <button
          key={subject}
          type="button"
          onClick={() => onSubjectChange(subject)}
          className={`group flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
            activeSubject === subject
              ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
              : "border border-transparent bg-white/5 text-zinc-400 hover:bg-white/8 hover:text-zinc-200"
          }`}
        >
          <BookOpen className="h-3 w-3 shrink-0" />
          <span className="truncate max-w-[120px]">{subject}</span>
          {subjects.length > 1 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                removeSubject(subject);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  removeSubject(subject);
                }
              }}
              className="ml-0.5 text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-300 transition-all"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      ))}

      {/* Add new subject */}
      {isAdding ? (
        <div className="flex shrink-0 items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSubject();
              } else if (e.key === "Escape") {
                setIsAdding(false);
                setNewSubject("");
              }
            }}
            onBlur={() => {
              if (!newSubject.trim()) {
                setIsAdding(false);
              }
            }}
            placeholder="Tên môn học…"
            className="w-28 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-200 outline-none placeholder:text-emerald-500/50"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="flex shrink-0 items-center gap-1 rounded-xl border border-dashed border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-400"
        >
          <Plus className="h-3 w-3" />
          <span>Thêm môn</span>
        </button>
      )}
    </div>
  );
}
