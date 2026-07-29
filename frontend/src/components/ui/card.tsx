"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { LIFT } from "@/lib/motion";

function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Adds the hover lift. Only for cards that are themselves clickable. */
  interactive?: boolean;
}) {
  const classes = cn(
    "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
    interactive &&
      "cursor-pointer transition-shadow hover:shadow-md hover:border-brand-border",
    className,
  );

  if (!interactive) {
    return <div data-slot="card" className={classes} {...props} />;
  }

  return (
    <motion.div
      data-slot="card"
      className={classes}
      {...LIFT}
      {...(props as React.ComponentProps<typeof motion.div>)}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-1.5 px-6", className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("font-medium tracking-tight leading-none", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6", className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
};
