"use client";

import { useRef, useState } from "react";
import type { ProjectWithCounts } from "@/lib/repo";
import { PlusIcon } from "./icons";

interface Props {
  projects: ProjectWithCounts[];
  /** Fixed project in a project view; null in All projects, where a picker is shown. */
  projectId: string | null;
  defaultProjectId: string;
  onAdd: (projectId: string, title: string) => Promise<boolean>;
}

export function AddTask({ projects, projectId, defaultProjectId, onAdd }: Props) {
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState(defaultProjectId);
  const input = useRef<HTMLInputElement>(null);

  const target = projectId ?? (projects.some((p) => p.id === picked) ? picked : defaultProjectId);

  async function submit() {
    const value = title.replace(/\s+/g, " ").trim();
    if (!value || !target) return;
    setTitle("");
    const ok = await onAdd(target, value);
    if (!ok) setTitle(value); // give the text back so nothing typed is lost
    input.current?.focus();
  }

  return (
    <div className="flex items-center gap-1 border-b border-line2">
      <span className="-ml-3 grid size-11 shrink-0 place-items-center text-ink3" aria-hidden>
        <PlusIcon />
      </span>
      <input
        ref={input}
        value={title}
        maxLength={300}
        enterKeyHint="done"
        aria-label="Add a task"
        placeholder="Add a task, then press Enter"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink3"
      />
      {projectId === null && (
        <select
          aria-label="Project for the new task"
          value={target}
          onChange={(e) => setPicked(e.target.value)}
          className="h-9 max-w-[40%] shrink-0 truncate rounded-md border border-line bg-surface px-2 text-sm text-ink2 outline-none focus:border-accent"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
