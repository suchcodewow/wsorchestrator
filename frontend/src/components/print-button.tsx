"use client";

import { Printer } from "lucide-react";

/** Opens the browser's print dialog; left off the printed page. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-100 print:hidden"
    >
      <Printer className="size-4" />
      Print
    </button>
  );
}
