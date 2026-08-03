import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { NoticeMessage } from "./types";

export function formatBytes(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
}

export function shortHash(value: string | null | undefined) {
  if (!value) return "N/A";
  return value.replace(/^sha256:/, "").slice(0, 12);
}

export function Notices({
  notices,
  dismiss,
}: {
  notices: NoticeMessage[];
  dismiss(id: string): void;
}) {
  return (
    <div className="notices" aria-live="polite">
      {notices.map((notice) => (
        <div className={`notice is-${notice.kind}`} key={notice.id}>
          <span>{notice.message}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            title="Dismiss"
            onClick={() => dismiss(notice.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  width = 620,
}: {
  title: string;
  children: ReactNode;
  onClose(): void;
  width?: number;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | undefined>(undefined);
  const [position, setPosition] = useState<{ left: number; top: number }>();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="overlay" onPointerDown={onClose}>
      <section
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          width: `min(${width}px, calc(100vw - 32px))`,
          ...(position ? {
            position: "fixed",
            left: position.left,
            top: position.top,
            transform: "none",
          } : {}),
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header
          className="dialog-header"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button")) return;
            const rect = dialogRef.current?.getBoundingClientRect();
            if (!rect) return;
            dragRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: rect.left,
              top: rect.top,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            const node = dialogRef.current;
            if (!drag || !node || drag.pointerId !== event.pointerId) return;
            const rect = node.getBoundingClientRect();
            const left = Math.max(8, Math.min(
              window.innerWidth - rect.width - 8,
              drag.left + event.clientX - drag.x,
            ));
            const top = Math.max(8, Math.min(
              window.innerHeight - rect.height - 8,
              drag.top + event.clientY - drag.y,
            ));
            setPosition({ left, top });
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId === event.pointerId) {
              dragRef.current = undefined;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          <strong>{title}</strong>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  detail: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Modal title={title} onClose={pending ? () => undefined : onClose}>
      <p className="confirm-message">{message}</p>
      <p className="muted">{detail}</p>
      <div className="dialog-actions">
        <button type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="button" className="danger" disabled={pending} onClick={onConfirm}>
          {pending ? "Working..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function EntryForm({
  initial,
  pending,
  onSubmit,
  onClose,
}: {
  initial?: { key: string; value: string; description: string };
  pending: boolean;
  onSubmit(value: { key: string; value: string; description: string }): void;
  onClose(): void;
}) {
  const [key, setKey] = useState(initial?.key ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim() || !value.trim()) return;
    onSubmit({ key: key.trim(), value: value.trim(), description: description.trim() });
  };
  return (
    <form className="form-stack" onSubmit={submit}>
      <label>
        <span>Key</span>
        <input
          autoFocus
          required
          maxLength={128}
          value={key}
          placeholder="service.api"
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <label>
        <span>Value</span>
        <textarea
          required
          maxLength={2048}
          rows={4}
          value={value}
          placeholder="https://service.internal/api"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <label>
        <span>Description</span>
        <textarea
          maxLength={500}
          rows={3}
          value={description}
          placeholder="How this value is used"
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <p className="hint">Secrets are prohibited. Store only a secret://... reference.</p>
      <div className="dialog-actions">
        <button type="button" disabled={pending} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={pending || !key.trim() || !value.trim()}>
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
