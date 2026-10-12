"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectWithCounts } from "@/lib/repo";
import { PlusIcon } from "./icons";

interface Props {
  projects: ProjectWithCounts[];
  view: string;
  totalOpen: number;
  onSelect: (view: string) => void;
  onAddProject: (name: string) => Promise<boolean>;
  onSignOut: () => void;
}

export function Wordmark() {
  return (
    <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <span aria-hidden className="grid size-5 place-items-center rounded-[5px] bg-accent text-accent-ink">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.2l2.4 2.4 4.6-4.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      TaskHub
    </span>
  );
}

function NavItem({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onClick}
        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-[15px] transition-colors md:min-h-9 ${
          active ? "bg-hover font-medium text-ink" : "text-ink2 hover:bg-hover/70 hover:text-ink"
        }`}
      >
        <span className="truncate">{label}</span>
        {count > 0 && <span className="font-mono text-xs tabular-nums text-ink3">{count}</span>}
      </button>
    </li>
  );
}

/** Project list shared by the desktop sidebar and the mobile sheet. */
export function ProjectNav({ projects, view, totalOpen, onSelect, onAddProject }: Omit<Props, "onSignOut">) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);

  async function submit() {
    const value = name.replace(/\s+/g, " ").trim();
    if (!value || busy) return;
    setBusy(true);
    const ok = await onAddProject(value);
    setBusy(false);
    if (ok) {
      setName("");
      setAdding(false);
    }
  }

  return (
    <nav aria-label="Projects" className="flex flex-col gap-4">
      <ul className="flex flex-col gap-0.5">
        <NavItem label="All projects" count={totalOpen} active={view === "all"} onClick={() => onSelect("all")} />
      </ul>

      <div>
        <h2 className="px-3 pb-1.5 font-mono text-[11px] tracking-[0.08em] text-ink3 uppercase">Projects</h2>
        <ul className="flex flex-col gap-0.5">
          {projects.map((p) => (
            <NavItem key={p.id} label={p.name} count={p.open_count} active={view === p.id} onClick={() => onSelect(p.id)} />
          ))}
        </ul>

        {adding ? (
          <form
            className="mt-1.5 px-1"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              ref={input}
              value={name}
              maxLength={120}
              disabled={busy}
              placeholder="Project name"
              aria-label="New project name"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => !name.trim() && setAdding(false)}
              onKeyDown={(e) => e.key === "Escape" && (setName(""), setAdding(false))}
              className="h-11 w-full rounded-md border border-line2 bg-surface px-3 text-[15px] outline-none placeholder:text-ink3 focus:border-accent md:h-9"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-[15px] text-ink3 transition-colors hover:bg-hover/70 hover:text-ink md:min-h-9"
          >
            <PlusIcon /> Add project
          </button>
        )}
      </div>
    </nav>
  );
}

export function Sidebar(props: Props) {
  return (
    <aside className="hidden border-r border-line bg-side md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:justify-between md:overflow-y-auto md:px-3 md:py-6">
      <div className="flex flex-col gap-8">
        <div className="px-3">
          <Wordmark />
        </div>
        <ProjectNav {...props} />
      </div>
      <button
        type="button"
        onClick={props.onSignOut}
        className="mt-8 min-h-9 rounded-md px-3 text-left text-sm text-ink3 transition-colors hover:bg-hover/70 hover:text-ink"
      >
        Sign out
      </button>
    </aside>
  );
}
