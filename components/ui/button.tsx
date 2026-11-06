"use client";

import type { ButtonHTMLAttributes } from "react";
import { useFormStatus } from "react-dom";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 shadow-sm cursor-pointer select-none";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 bg-gradient-to-r from-brand-600 via-indigo-600 to-brand-700 text-white hover:from-brand-700 hover:to-indigo-800 shadow-brand-500/25 shadow-md hover:shadow-lg hover:shadow-brand-500/30",
  secondary:
    "border border-border-strong bg-surface text-ink hover:bg-surface-muted hover:border-brand-200 hover:text-brand-900 shadow-xs",
  ghost: "text-ink hover:bg-brand-50 hover:text-brand-700 shadow-none",
  danger:
    "bg-danger bg-gradient-to-r from-danger to-red-600 text-white hover:from-red-600 hover:to-red-700 shadow-danger/25 shadow-md hover:shadow-lg",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
};

export function buttonClasses(options: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  const { variant = "primary", size = "md", className } = options;
  return [baseClasses, variantClasses[variant], sizeClasses[size], className]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingText?: string;
};

export function Button({
  variant,
  size,
  className,
  type = "button",
  disabled,
  children,
  pendingText,
  ...props
}: ButtonProps) {
  const formStatus = useFormStatus();
  const isPending = type === "submit" && formStatus.pending;

  return (
    <button
      type={type}
      disabled={disabled || isPending}
      aria-busy={isPending}
      className={buttonClasses({
        variant,
        size,
        className: [className, isPending ? "opacity-75 cursor-wait" : ""].filter(Boolean).join(" "),
      })}
      {...props}
    >
      {isPending ? (
        <>
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current inline"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {pendingText || children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
