export function safeReturnPath(value: string | null | undefined): string {
  if (!value?.startsWith("/") || /[\\\u0000-\u0020\u007f]/.test(value))
    return "/today";
  try {
    const url = new URL(value, "https://aimthread.invalid");
    if (
      url.origin !== "https://aimthread.invalid" ||
      ![
        "/today",
        "/goals",
        "/history",
        "/settings",
        "/setup",
        "/onboarding",
      ].includes(url.pathname)
    )
      return "/today";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/today";
  }
}
