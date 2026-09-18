/**
 * Translate a non-2xx fetch response into a user-facing message.
 *
 * The role/not-found wording differs slightly between editors, so those cases
 * are parameterized; the zod `issues` and `error` body handling is shared.
 */
export interface FetchErrorOptions {
  unauthorized?: string;
  forbidden?: string;
  notFound?: string;
  fallback?: string;
}

export async function describeFetchError(
  response: Response,
  options: FetchErrorOptions = {}
): Promise<string> {
  const {
    unauthorized = "Your session has expired. Sign in again.",
    forbidden = "Your role does not allow editing.",
    notFound = "Record no longer exists.",
    fallback = "Something went wrong. Please try again.",
  } = options;

  if (response.status === 401) return unauthorized;
  if (response.status === 403) return forbidden;
  if (response.status === 404) return notFound;

  try {
    const data = await response.json();
    if (Array.isArray(data?.issues) && data.issues.length > 0) {
      return data.issues
        .map((issue: { message?: string }) => issue.message)
        .filter(Boolean)
        .join(" ");
    }
    if (typeof data?.error === "string") return data.error;
  } catch {
    // Non-JSON body; fall through to the generic message.
  }

  return fallback;
}