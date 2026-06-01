"use client";

/** A button that triggers the browser print dialog (Save as PDF). Hidden when printing. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded bg-accent hover:bg-accent-hover px-3 py-2 text-sm text-white print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
