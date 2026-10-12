const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const PlusIcon = () => (
  <svg {...base}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);
export const TrashIcon = () => (
  <svg {...base}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" />
  </svg>
);
export const NoteIcon = () => (
  <svg {...base}>
    <path d="M3 3.5h10M3 7h10M3 10.5h6" />
  </svg>
);
export const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg {...base} style={{ transform: open ? "rotate(180deg)" : undefined }}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);
export const CheckGlyph = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
    <path className="tick-mark" d="M5.5 10.5l3 3 6-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
