import { eq, sql } from "drizzle-orm";
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { neoimageProfiles } from "../../../db/schema";

export const runtime = "edge";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function safeDisplayName(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.slice(0, 80) || fallback;
}

async function findProfile(email: string) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(neoimageProfiles)
    .where(eq(neoimageProfiles.email, email))
    .limit(1);
  return profile ?? null;
}

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) {
    return Response.json(
      { authenticated: false, signInUrl: chatGPTSignInPath("/?tab=history") },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const email = normalizeEmail(identity.email);
    const profile = await findProfile(email);
    return Response.json(
      {
        authenticated: true,
        identity: { email, displayName: identity.displayName },
        profile,
        signOutUrl: chatGPTSignOutPath("/"),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      return Response.json(
        { error: "Le service de compte est en cours d’initialisation." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: "Impossible de charger le compte NeoImage." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) {
    return Response.json(
      {
        error: "Connectez-vous avec ChatGPT pour créer votre compte NeoImage.",
        signInUrl: chatGPTSignInPath("/?tab=history"),
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let payload: { displayName?: string } = {};
  try {
    payload = await request.json() as { displayName?: string };
  } catch {
    // An empty body uses the authenticated display name.
  }

  try {
    const email = normalizeEmail(identity.email);
    const displayName = safeDisplayName(payload.displayName, identity.displayName);
    const db = await getDb();
    await db
      .insert(neoimageProfiles)
      .values({ id: crypto.randomUUID(), email, displayName })
      .onConflictDoUpdate({
        target: neoimageProfiles.email,
        set: { displayName, lastSeenAt: sql`CURRENT_TIMESTAMP` },
      });

    const profile = await findProfile(email);
    return Response.json(
      { authenticated: true, profile, signOutUrl: chatGPTSignOutPath("/") },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Impossible de créer le compte NeoImage pour le moment." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
