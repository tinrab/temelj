export type Cookie = {
  name: string;
  value: string;
} & CookieAttributes;

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
