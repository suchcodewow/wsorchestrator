"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-40 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1.5 text-sm font-medium", className)}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

const itemClasses =
  "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4";

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(itemClasses, className)}
      {...props}
    />
  );
}

/**
 * A radio item that reserves its indicator column whether or not it is
 * selected, so the labels stay on a single left edge instead of shifting as
 * the selection moves.
 */
function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(itemClasses, "pr-8", className)}
      {...props}
    >
      {children}
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.RadioItem>
  );
}

/**
 * An icon-only radio, for a segmented row where the glyphs carry the meaning
 * and three full-width rows would be three lines spent on one setting.
 *
 * Still a Radix radio item, so it keeps `role="menuitemradio"` and stays
 * reachable by the menu's arrow keys even though it no longer looks like a row.
 * The selected one is filled rather than ticked — in a row of three, "which is
 * lit" is legible at a glance in a way a tick beside a glyph is not.
 *
 * `aria-label` is required: with the text gone, nothing else names the option.
 */
function DropdownMenuRadioIconItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & {
  "aria-label": string;
}) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "flex size-6.5 cursor-pointer select-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
        // Radix moves real DOM focus onto the highlighted item, so `focus:` is
        // what keyboard navigation lands on. A ring rather than a background
        // fill, so it stays visible on the selected item too.
        "focus:text-foreground focus:ring-1 focus:ring-ring/50",
        "data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=checked]:shadow-xs",
        "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A menu row whose control is a switch rather than a tick.
 *
 * Still a Radix checkbox item underneath, so it keeps `role="menuitemcheckbox"`,
 * `aria-checked`, and keyboard activation. Only the indicator differs: a tick
 * appears once the row has already been chosen, which reads like the result of
 * navigating somewhere, while a track and thumb sit in both states and say the
 * row flips a setting in place.
 *
 * The track is driven by `data-state` on the item rather than by a prop, so
 * there is one source of truth for whether it is on.
 */
function DropdownMenuSwitchItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(itemClasses, "group pr-11", className)}
      {...props}
    >
      {children}
      {/* Decorative: the item itself already carries the checked state. */}
      <span
        aria-hidden
        className="absolute right-2 flex h-4 w-7 items-center rounded-full bg-input p-0.5 transition-colors group-data-[state=checked]:bg-brand"
      >
        <span className="size-3 rounded-full bg-background shadow-xs transition-transform duration-200 ease-out group-data-[state=checked]:translate-x-3" />
      </span>
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuSwitchItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRadioIconItem,
};
