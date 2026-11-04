"use client";

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";

/**
 * Controlled dialog built on the native <dialog> element so focus trapping,
 * Escape handling, and inert background behaviour come from the browser.
 * The parent owns the open state; `onClose` is called for Escape, the close
 * button, and backdrop clicks.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={handleBackdropClick}
      className="rounded-card border-border bg-surface text-ink m-auto w-[min(32rem,calc(100vw-2rem))] border p-0 shadow-xl"
    >
      <div className="flex flex-col">
        <div className="border-border flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-ink text-lg font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="text-ink-muted text-sm">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="text-ink-muted hover:bg-surface-muted hover:text-ink focus-visible:outline-brand-700 rounded-lg p-1.5 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        {children ? <div className="text-ink px-5 py-4 text-sm">{children}</div> : null}
        {footer ? (
          <div className="border-border flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
