/**
 * A HTTP cookie.
 */
export type Cookie = {
  name: string;
  value: string;
} & CookieAttributes;

/**
 * Attributes of a cookie.
 */
export type CookieAttributes = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  priority?: "low" | "medium" | "high";
  sameSite?: true | false | "strict" | "lax" | "none";
  secure?: boolean;
};

/**
 * Extracts a single cookie from a cookie string.
 *
 * @param cookieString The cookie string to parse.
 * @param name The name of the cookie to parse.
 * @returns The value of the cookie, or `undefined` if the cookie was not found.
 */
export function parseCookie(
  cookieString: string,
  name: string,
): string | undefined {
  const cookies = cookieString.split(";");
  const cookie = cookies.find((c) => c.includes(name));
  if (!cookie) {
    return;
  }
  return cookie.split("=")[1] || undefined;
}
