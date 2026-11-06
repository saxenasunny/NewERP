import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type FieldChrome = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
};

type FieldRenderProps = {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
};

const controlClasses =
  "w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted/50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 focus-visible:border-brand-500 disabled:cursor-not-allowed disabled:bg-surface-muted transition-all shadow-2xs";

function controlClassesFor(error?: string): string {
  return `${controlClasses} ${error ? "border-danger" : "border-border-strong"}`;
}

/**
 * Field chrome (label, hint, error) with a render prop so any control can
 * receive the generated ids. Use Input/Textarea/Select for the common cases.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: FieldChrome & { children: (field: FieldRenderProps) => ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ink text-sm font-medium">
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className="text-danger">
              {" "}
              *
            </span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="text-ink-muted text-sm">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-danger text-sm font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & FieldChrome;

export function Input({ id, label, hint, error, required, className, ...props }: InputProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {(field) => (
        <input
          {...props}
          id={field.id}
          required={required}
          aria-invalid={field.invalid || undefined}
          aria-describedby={field.describedBy}
          className={`${controlClassesFor(error)} ${className ?? ""}`}
        />
      )}
    </Field>
  );
}

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & FieldChrome;

export function Textarea({ id, label, hint, error, required, className, ...props }: TextareaProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {(field) => (
        <textarea
          {...props}
          id={field.id}
          required={required}
          aria-invalid={field.invalid || undefined}
          aria-describedby={field.describedBy}
          className={`${controlClassesFor(error)} min-h-24 ${className ?? ""}`}
        />
      )}
    </Field>
  );
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & FieldChrome;

export function Select({ id, label, hint, error, required, className, ...props }: SelectProps) {
  return (
    <Field id={id} label={label} hint={hint} error={error} required={required}>
      {(field) => (
        <select
          {...props}
          id={field.id}
          required={required}
          aria-invalid={field.invalid || undefined}
          aria-describedby={field.describedBy}
          className={`${controlClassesFor(error)} ${className ?? ""}`}
        />
      )}
    </Field>
  );
}
