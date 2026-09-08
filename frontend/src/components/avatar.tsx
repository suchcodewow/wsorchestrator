/** The signed-in account as a single glyph. */

export function Avatar({
  name,
  email,
  className,
}: {
  name: string | null;
  email: string;
  className?: string;
}) {
  const initial = (name ?? email).trim().charAt(0).toUpperCase() || "?";

  return (
    <span
      aria-hidden
      className={
        className ??
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-medium text-brand"
      }
    >
      {initial}
    </span>
  );
}
