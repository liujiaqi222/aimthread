/** Provider names are optional, unbounded external input; manual edits stay strict. */
export function initialSocialName(name: string | null | undefined): string {
  return (
    (name ?? "")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .trim()
      .slice(0, 40)
      .trim() || "AimThread 用户"
  );
}
