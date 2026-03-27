/**
 * Returns a user-friendly error message.
 * Hides technical details like stack traces, SQL errors, and Supabase internals.
 */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (
    msg.length > 120 ||
    /traceback|exception|syntax error|duplicate key|violates|pgrst|postgrest|permission denied|relation|column/i.test(msg)
  ) {
    return "Something went wrong. Please try again.";
  }
  return msg;
}
