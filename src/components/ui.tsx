import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatLength, parseLength, toDisplay, unitLabel } from "../../shared/units.ts";
import type { ImageRecord } from "../../shared/types.ts";
import { api } from "../lib/api.ts";
import { toastError, useApp } from "../lib/store.ts";

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <div className="spacer" />
          <button className="btn ghost icon" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** Drop zone + file picker that uploads images and returns their records. */
export function ImageDrop({
  onUploaded,
  multiple = true,
  label = "Drop photos here or click to choose",
  compact,
}: {
  onUploaded: (images: ImageRecord[]) => void;
  multiple?: boolean;
  label?: string;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setBusy(true);
    try {
      onUploaded(await api.uploadImages(multiple ? images : images.slice(0, 1)));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`drop ${over ? "over" : ""}`}
      style={compact ? { padding: 10 } : undefined}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        upload([...e.dataTransfer.files]);
      }}
    >
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple={multiple}
        hidden
        onChange={(e) => {
          upload([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      {busy ? (
        <span className="row" style={{ justifyContent: "center" }}>
          <Spinner /> Uploading…
        </span>
      ) : (
        label
      )}
    </div>
  );
}

/** Numeric length input in the user's units, storing centimeters. Accepts "8'6\"", "2.4m" etc. */
export function LengthInput({
  value,
  onChange,
  placeholder,
  className = "input",
}: {
  value: number | undefined;
  onChange: (cm: number | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const units = useApp((s) => s.units);
  const shown = value === undefined ? "" : String(toDisplay(value, units));
  const [text, setText] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(shown);
  }, [shown, focused]);
  return (
    <div style={{ position: "relative" }}>
      <input
        className={className}
        value={text}
        placeholder={placeholder}
        inputMode="decimal"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const cm = parseLength(text, units);
          onChange(cm === null ? undefined : cm);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onChange={(e) => setText(e.target.value)}
        style={{ paddingRight: 30 }}
      />
      <span className="muted small" style={{ position: "absolute", right: 9, top: "50%", transform: "translateY(-50%)" }}>
        {unitLabel(units)}
      </span>
    </div>
  );
}

export function Len({ cm, precise }: { cm: number; precise?: boolean }) {
  const units = useApp((s) => s.units);
  return <>{formatLength(cm, units, { precise })}</>;
}

export function useLen() {
  const units = useApp((s) => s.units);
  return (cm: number, precise?: boolean) => formatLength(cm, units, { precise });
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} role="radio" aria-checked={o.value === value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function useInterval(fn: () => void, ms: number | null) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export function useDebouncedEffect(fn: () => void, deps: unknown[], ms: number) {
  useEffect(() => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const ICONS: Record<string, string> = {
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-4",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 000 10h4",
  rotate: "M20 12a8 8 0 11-2.3-5.6M20 4v5h-5",
  copy: "M9 9h11v11H9zM5 15V4h11",
  tray: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6l2-8z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  check: "M5 12l5 5L20 7",
  arrow: "M5 12h14M13 6l6 6-6 6",
  back: "M19 12H5M11 6l-6 6 6 6",
  refresh: "M20 11a8 8 0 00-14.9-3M4 4v4h4M4 13a8 8 0 0014.9 3M20 20v-4h-4",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  cube: "M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  plan: "M4 4h16v16H4zM4 12h7M11 4v16M15 12h5",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1 1 0 100-.01",
  menu: "M4 7h16M4 12h16M4 17h16",
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ICONS.plus} />
    </svg>
  );
}

export function categoryLabel(c: string) {
  return c.replace(/-/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}
