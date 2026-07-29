"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { motion } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { INTERACTIVE } from "@/lib/motion";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        brand:
          "bg-brand text-brand-foreground shadow-xs hover:bg-brand/90 focus-visible:ring-brand/40",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Opt out of the hover lift where it would fight the surrounding layout. */
    animate?: boolean;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  animate = true,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }));

  // `asChild` hands rendering to whatever element is passed in, which Framer
  // cannot drive — so those render as a plain Slot and skip the interaction.
  if (asChild) {
    return <Slot data-slot="button" className={classes} {...props} />;
  }

  if (!animate || props.disabled) {
    return <button data-slot="button" className={classes} {...props} />;
  }

  return (
    <motion.button
      data-slot="button"
      className={classes}
      {...INTERACTIVE}
      // Framer and React's DOM props disagree on these three event signatures;
      // the button never animates on them, so they are simply not forwarded.
      {...(props as React.ComponentProps<typeof motion.button>)}
    />
  );
}

export { Button, buttonVariants };
