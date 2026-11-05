"use client";

/**
 * Confirmations and notices as themed dialogs, in place of the browser's
 * `window.confirm` and `window.alert` (which ESLint refuses). `ConfirmHost`
 * sits once in the root layout; anywhere on the client,
 *
 *   if (!(await confirmDialog({ title: `Delete “${name}”?`, destructive: true }))) return;
 *
 * resolves true only when the person presses the confirm button, and false on
 * Cancel, Escape, the close button or a click on the backdrop.
 * `noticeDialog` shows a message with a single button and resolves once it is
 * dismissed. Asking while one is open queues the next behind it.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ConfirmOptions = {
  title: string;
  description?: React.ReactNode;
  /** The confirm button's label; "Confirm" by default, "OK" for a notice. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive, for deleting and removing. */
  destructive?: boolean;
};

type Request = ConfirmOptions & { notice: boolean; resolve: (ok: boolean) => void };

const queue: Request[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function ask(options: ConfirmOptions, notice: boolean) {
  return new Promise<boolean>((resolve) => {
    queue.push({ ...options, notice, resolve });
    emit();
  });
}

/** Asks before doing something; true when the person confirms. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return ask(options, false);
}

/** Tells the person something they must acknowledge; resolves once it is closed. */
export async function noticeDialog(options: Omit<ConfirmOptions, "cancelLabel" | "destructive">): Promise<void> {
  await ask(options, true);
}

function settle(ok: boolean) {
  const head = queue.shift();
  emit();
  head?.resolve(ok);
}

export function ConfirmHost() {
  const head = React.useSyncExternalStore(subscribe, () => queue[0] ?? null, () => null);
  // The last request stays rendered while the dialog animates out.
  const [shown, setShown] = React.useState(head);
  if (head && head !== shown) setShown(head);
  if (!shown) return null;

  const { title, description, notice, destructive } = shown;
  const confirmLabel = shown.confirmLabel ?? (notice ? "OK" : "Confirm");

  return (
    <Dialog open={head !== null} onOpenChange={(open) => !open && settle(notice)}>
      <DialogContent
        className="max-w-md"
        // A notice or a harmless confirm takes Enter; a destructive one starts on Cancel.
        onOpenAutoFocus={(e) => {
          if (destructive) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-confirm]")?.focus();
        }}
        {...(description ? {} : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle className="leading-snug">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          {!notice && (
            <Button variant="outline" onClick={() => settle(false)}>
              {shown.cancelLabel ?? "Cancel"}
            </Button>
          )}
          <Button data-confirm variant={destructive ? "destructive" : "default"} onClick={() => settle(true)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
