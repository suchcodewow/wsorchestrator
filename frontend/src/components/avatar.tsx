/**
 * The signed-in account as a single glyph.
 *
 * Decorative on purpose: everywhere this appears, the account is already named
 * in text beside it or in the label of the menu it opens. Left readable it
 * would announce a stray letter before the name that follows it.
 *
 * [[UserMenu]] draws it on both of the triggers that show an account rather
 * than a page: the sidebar footer row, and that row's collapsed rail form.
 */
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
