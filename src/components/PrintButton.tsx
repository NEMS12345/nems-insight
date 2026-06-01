"use client";

/** A button that triggers the browser print dialog (Save as PDF). Hidden when printing. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded bg-foreground px-3 py-2 text-sm text-background print:hidden"
    >
      Print / Save as PDF
    </button>
  );
}
