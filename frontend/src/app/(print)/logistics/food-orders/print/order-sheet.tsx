"use client";

/**
 * The printed food orders: each with who it is from, when it arrives, and
 * what is needed from it, a box beside every line to tick off as it is
 * unpacked. Drawn in the browser so the times are in the reader's zone.
 */

import { PrintButton } from "@/components/print-button";
import type { FoodOrderRow } from "@/lib/logistics/food-orders";
import { formatArrival } from "@/app/(app)/logistics/food-orders/format";

export function OrderSheet({ orders, single }: { orders: FoodOrderRow[]; single: boolean }) {
  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 scheme-light print:min-h-0 print:bg-white">
      <style>{"@page { size: letter portrait; margin: 0.6in; }"}</style>
      <div className="mx-auto max-w-[8.5in] space-y-6 px-4 py-6 print:max-w-none print:p-0">
        <header className="flex items-end justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-lg font-semibold">{single ? `Order from ${orders[0]?.vendor}` : "Food orders"}</h1>
            <p className="text-xs text-neutral-600">
              {orders.length} {orders.length === 1 ? "order" : "orders"}
            </p>
          </div>
          {orders.length > 0 && <PrintButton />}
        </header>

        {orders.length === 0 ? (
          <p className="text-sm text-neutral-600">No food orders to print.</p>
        ) : (
          <div className="space-y-4 print:space-y-6">
            {!single && <h1 className="hidden text-xl font-semibold print:block">Food orders</h1>}
            {orders.map((o) => {
              const lines = o.needs.split("\n").map((l) => l.trim()).filter(Boolean);
              return (
                <section
                  key={o.id}
                  className="break-inside-avoid rounded-lg border border-neutral-300 bg-white p-5 print:rounded-none print:border-x-0 print:border-b-0 print:px-0"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <h2 className="text-lg font-semibold">{o.vendor}</h2>
                    <p className="text-sm font-medium tabular-nums" suppressHydrationWarning>
                      Arrives {formatArrival(o.arrivesAt)}
                    </p>
                  </div>
                  {o.fileName && <p className="mt-0.5 text-xs text-neutral-600">PDF: {o.fileName}</p>}
                  <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-neutral-600">What we need</h3>
                  {lines.length === 0 ? (
                    <p className="mt-1 text-sm text-neutral-600">Nothing noted.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {lines.map((line, i) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm">
                          <span className="mt-0.5 size-3.5 shrink-0 rounded-sm border border-neutral-500" aria-hidden />
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
