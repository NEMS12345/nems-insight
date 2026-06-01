"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that shows a spinner and "working" text while its form's Server Action is
 * running, and disables itself to prevent double-submits. Must live inside a <form>.
 */
export function SubmitButton({
  children,
  pendingText = "Working…",
  className = "rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center gap-2 disabled:opacity-60 ${className}`}
    >
      {pending && (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
          <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" className="opacity-75" />
        </svg>
      )}
      {pending ? pendingText : children}
    </button>
  );
}
