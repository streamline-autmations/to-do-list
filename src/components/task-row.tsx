"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ListedTask } from "@/lib/repo";
import { CheckGlyph, NoteIcon, TrashIcon } from "./icons";

export interface RowHandlers {
  onToggle: (task: ListedTask) => void;
  onTitle: (task: ListedTask, title: string) => void;
  onNotes: (task: ListedTask, notes: string | null) => void;
  onDelete: (task: ListedTask) => void;
}

interface Props extends RowHandlers {
  task: ListedTask;
}

const iconBtn =
  "grid size-9 place-items-center rounded-md text-ink3 transition-colors hover:bg-hover hover:text-ink";

export function TaskRow({ task, onToggle, onTitle, onNotes, onDelete }: Props) {
  const saving = task.id.startsWith("tmp-");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(task.notes ?? "");
  const [confirming, setConfirming] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const notesArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(task.title);
  }, [task.title, editing]);
  useEffect(() => {
    if (!notesOpen) setNotesDraft(task.notes ?? "");
  }, [task.notes, notesOpen]);
  useEffect(() => {
    if (editing) titleInput.current?.select();
  }, [editing]);
  useLayoutEffect(() => {
    const el = notesArea.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [notesOpen, notesDraft]);

  function commitTitle() {
    setEditing(false);
    const next = draft.replace(/\s+/g, " ").trim();
    if (next && next !== task.title) onTitle(task, next);
    else setDraft(task.title);
  }

  function commitNotes() {
    const next = notesDraft.trim();
    if (next !== (task.notes ?? "")) onNotes(task, next === "" ? null : next);
    setNotesOpen(false);
  }

  const hasNotes = Boolean(task.notes);

  return (
    <li className="group relative border-b border-line/70 last:border-b-0">
      <div className="flex items-start gap-1 py-0.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={task.completed}
          aria-label={`${task.completed ? "Reopen" : "Complete"}: ${task.title}`}
          disabled={saving}
          onClick={() => onToggle(task)}
          className="-ml-3 grid size-11 shrink-0 place-items-center"
        >
          <span
            className={`tick-box grid size-5 place-items-center rounded-[5px] border-[1.5px] ${
              task.completed ? "border-accent bg-accent text-accent-ink" : "border-line2 bg-surface text-transparent group-hover:border-ink3"
            }`}
          >
            <CheckGlyph />
          </span>
        </button>

        <div className="min-w-0 flex-1 py-2.5">
          {editing ? (
            <input
              ref={titleInput}
              value={draft}
              maxLength={300}
              aria-label="Task title"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") commitTitle();
                if (e.key === "Escape") {
                  setDraft(task.title);
                  setEditing(false);
                }
              }}
              className="-my-1 block w-full rounded-sm border-b border-accent bg-transparent py-1 text-base leading-snug outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => !saving && setEditing(true)}
              title="Click to edit"
              className="block w-full cursor-text rounded-sm text-left text-base leading-snug break-words"
            >
              <span className="strike" data-done={task.completed}>
                {task.title}
              </span>
            </button>
          )}

          {hasNotes && !notesOpen && (
            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              className="mt-0.5 block max-w-full truncate rounded-sm text-left text-sm text-ink3 hover:text-ink2"
            >
              {task.notes!.split(/\r?\n/)[0]}
            </button>
          )}

          {notesOpen && (
            <textarea
              ref={notesArea}
              autoFocus
              value={notesDraft}
              rows={2}
              maxLength={10000}
              placeholder="Notes"
              aria-label="Task notes"
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={commitNotes}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setNotesDraft(task.notes ?? "");
                  setNotesOpen(false);
                }
              }}
              className="mt-1.5 block w-full resize-none rounded-md border border-line2 bg-surface px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-ink3 focus:border-accent"
            />
          )}
        </div>

        <div
          className={`flex shrink-0 items-center pt-1 transition-opacity ${
            confirming ? "opacity-100" : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          }`}
        >
          {confirming ? (
            <div role="alertdialog" aria-label="Confirm delete" className="flex items-center gap-1 text-sm">
              <span className="mr-1 hidden text-ink2 sm:inline">Delete?</span>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  onDelete(task);
                }}
                className="h-9 rounded-md bg-danger/10 px-3 font-medium text-danger hover:bg-danger/20"
              >
                Delete
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(false)}
                onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}
                className="h-9 rounded-md px-3 text-ink2 hover:bg-hover"
              >
                Keep
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                aria-label={hasNotes ? "Edit notes" : "Add notes"}
                aria-expanded={notesOpen}
                onClick={() => setNotesOpen((v) => !v)}
                className={`${iconBtn} ${hasNotes ? "text-accent" : ""}`}
              >
                <NoteIcon />
              </button>
              <button type="button" aria-label={`Delete: ${task.title}`} onClick={() => setConfirming(true)} className={iconBtn}>
                <TrashIcon />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
