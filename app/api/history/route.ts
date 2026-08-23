import { chatGPTSignInPath, getChatGPTUser } from "../../chatgpt-auth";
import {
  deleteHistoryForEmail,
  listHistoryForEmail,
  saveHistoryForEmail,
} from "../../../db/history";

export const runtime = "edge";

type LegacyHistoryItem = {
  id?: string;
  thumbnail?: string;
  prompt?: string;
  provider?: string;
  model?: string;
  modelName?: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  createdAt?: string;
};

function noStore(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function decodeDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/.exec(value);
  if (!match || match[2].length > 2_000_000) return null;
  try {
    const binary = atob(match[2]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { mimeType: match[1], bytes };
  } catch {
    return null;
  }
}

export async function GET() {
  const identity = await getChatGPTUser();
  if (!identity) {
    return noStore(
      { error: "Connectez-vous pour synchroniser l’historique.", signInUrl: chatGPTSignInPath("/?tab=history") },
      401,
    );
  }

  try {
    const history = await listHistoryForEmail(identity.email);
    if (!history) return noStore({ error: "Créez votre compte NeoImage pour activer la synchronisation." }, 403);
    return noStore({ history });
  } catch {
    return noStore({ error: "Impossible de synchroniser l’historique pour le moment." }, 500);
  }
}

export async function POST(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) {
    return noStore(
      { error: "Connectez-vous pour importer votre historique.", signInUrl: chatGPTSignInPath("/?tab=history") },
      401,
    );
  }

  let items: LegacyHistoryItem[] = [];
  try {
    const payload = await request.json() as { items?: LegacyHistoryItem[] };
    items = Array.isArray(payload.items) ? payload.items.slice(0, 30) : [];
  } catch {
    return noStore({ error: "Historique local invalide." }, 400);
  }

  let imported = 0;
  try {
    for (const item of items) {
      if (
        typeof item.thumbnail !== "string" ||
        typeof item.prompt !== "string" ||
        typeof item.provider !== "string" ||
        typeof item.model !== "string"
      ) continue;
      const image = decodeDataUrl(item.thumbnail);
      if (!image) continue;
      const saved = await saveHistoryForEmail(identity.email, {
        id: item.id,
        prompt: item.prompt,
        provider: item.provider,
        model: item.model,
        modelName: item.modelName || item.model,
        aspectRatio: item.aspectRatio || "1:1",
        resolution: item.resolution || "1K",
        quality: item.quality || "medium",
        mimeType: image.mimeType,
        bytes: image.bytes,
        createdAt: item.createdAt,
      });
      if (saved) imported += 1;
    }
    return noStore({ imported });
  } catch {
    return noStore({ error: "L’import de l’ancien historique local a échoué." }, 500);
  }
}

export async function DELETE(request: Request) {
  const identity = await getChatGPTUser();
  if (!identity) return noStore({ error: "Connexion requise." }, 401);

  let id: string | undefined;
  try {
    const payload = await request.json() as { id?: string; all?: boolean };
    if (!payload.all && typeof payload.id === "string") id = payload.id;
    if (!payload.all && !id) return noStore({ error: "Création introuvable." }, 400);
  } catch {
    return noStore({ error: "Requête invalide." }, 400);
  }

  try {
    const deleted = await deleteHistoryForEmail(identity.email, id);
    if (deleted === null) return noStore({ error: "Compte NeoImage requis." }, 403);
    if (!deleted) return noStore({ error: "Création introuvable." }, 404);
    return noStore({ deleted: true });
  } catch {
    return noStore({ error: "Impossible de modifier l’historique." }, 500);
  }
}
