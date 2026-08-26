import {
  isLocalRequestUrl,
  LOCAL_AUTH_COOKIE,
  safeRelativeReturnPath,
} from "../../chatgpt-auth";

export const runtime = "edge";

export async function GET(request: Request) {
  if (!isLocalRequestUrl(request.url)) {
    return Response.json({ error: "Cette route est réservée au développement local." }, { status: 404 });
  }

  const url = new URL(request.url);
  const returnTo = safeRelativeReturnPath(url.searchParams.get("return_to") ?? "/?tab=history");
  const signingOut = url.searchParams.get("action") === "signout";
  const cookie = signingOut
    ? `${LOCAL_AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
    : `${LOCAL_AUTH_COOKIE}=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`;

  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: new URL(returnTo, url.origin).toString(),
      "Set-Cookie": cookie,
    },
  });
}
