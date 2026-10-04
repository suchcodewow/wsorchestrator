/** Telling which constraint refused a write, from the error Postgres raised — directly, or as the cause Drizzle wraps it in. */

const pgCode = (err: unknown): unknown => {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(err) ?? code((err as { cause?: unknown } | null)?.cause);
};

export const isUniqueViolation = (err: unknown): boolean => pgCode(err) === "23505";

export const isForeignKeyViolation = (err: unknown): boolean => pgCode(err) === "23503";
