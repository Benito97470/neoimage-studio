import { headers } from "next/headers";
import { redirect } from "next/navigation";

export type ChatGPTUser = {
  authSource: "chatgpt" | "local";
  displayName: string;
  email: string;
  fullName: string | null;
};

const USER_EMAIL_HEADER = "oai-authenticated-user-email";
const USER_FULL_NAME_HEADER = "oai-authenticated-user-full-name";
const USER_FULL_NAME_ENCODING_HEADER =
  "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SIGN_IN_PATH = "/signin-with-chatgpt";
const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";
const LOCAL_AUTH_PATH = "/api/local-auth";
export const LOCAL_AUTH_COOKIE = "neoimage_local_session";

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!email) {
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
    const hasLocalSession = requestHeaders
      .get("cookie")
      ?.split(";")
      .some((part) => part.trim() === `${LOCAL_AUTH_COOKIE}=1`);

    if (isLocalHostname(hostnameFromHostHeader(host)) && hasLocalSession) {
      return {
        authSource: "local",
        displayName: "Compte local NeoImage",
        email: "neoimage-local@localhost.invalid",
        fullName: "Compte local NeoImage",
      };
    }
    return null;
  }

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    authSource: "chatgpt",
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function authSignInPath(request: Request, returnTo: string): string {
  if (!isLocalRequestUrl(request.url)) return chatGPTSignInPath(returnTo);
  return `${LOCAL_AUTH_PATH}?return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function authSignOutPath(request: Request, returnTo = "/"): string {
  if (!isLocalRequestUrl(request.url)) return chatGPTSignOutPath(returnTo);
  return `${LOCAL_AUTH_PATH}?action=signout&return_to=${encodeURIComponent(safeRelativeReturnPath(returnTo))}`;
}

export function isLocalRequestUrl(value: string): boolean {
  try {
    return isLocalHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isLocalHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname.endsWith(".localhost");
}

function hostnameFromHostHeader(value: string): string {
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    return closingBracket > 0 ? value.slice(1, closingBracket) : value;
  }
  return value.split(":")[0];
}

export function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";

  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
