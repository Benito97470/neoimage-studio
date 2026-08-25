import { NextResponse } from "next/server";
import { getChatGPTUser } from "../../chatgpt-auth";
import { saveHistoryForEmail } from "../../../db/history";

export const runtime = "edge";

type Provider = "openai" | "google";
type AspectRatio = "1:1" | "4:3" | "3:2" | "16:9" | "21:9" | "9:16" | "3:4" | "2:3" | "4:5" | "5:4";
type Resolution = "1K" | "2K" | "4K";
type Quality = "low" | "medium" | "high";

type GenerateBody = {
  provider?: Provider;
  model?: string;
  apiKey?: string;
  prompt?: string;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  quality?: Quality;
};

const OPENAI_MODELS = new Set([
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
]);

const GOOGLE_MODELS = new Set([
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "gemini-3.1-flash-lite-image",
  "gemini-2.5-flash-image",
]);

const MODEL_NAMES: Record<string, string> = {
  "gpt-image-2": "GPT Image 2",
  "gpt-image-1.5": "GPT Image 1.5",
  "gpt-image-1": "GPT Image 1",
  "gpt-image-1-mini": "GPT Image 1 mini",
  "gemini-3.1-flash-image": "Nano Banana 2",
  "gemini-3-pro-image": "Nano Banana Pro",
  "gemini-3.1-flash-lite-image": "Nano Banana 2 Lite",
  "gemini-2.5-flash-image": "Nano Banana",
};

const ASPECT_RATIOS = new Set<AspectRatio>([
  "1:1", "4:3", "3:2", "16:9", "21:9", "9:16", "3:4", "2:3", "4:5", "5:4",
]);

const OPENAI_LEGACY_SIZES: Partial<Record<AspectRatio, string>> = {
  "1:1": "1024x1024",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

const OPENAI_SIZES: Record<Resolution, Record<AspectRatio, string>> = {
  "1K": {
    "1:1": "1024x1024",
    "4:3": "1024x768",
    "3:2": "1152x768",
    "16:9": "1280x720",
    "21:9": "1344x576",
    "9:16": "720x1280",
    "3:4": "768x1024",
    "2:3": "768x1152",
    "4:5": "832x1040",
    "5:4": "1040x832",
  },
  "2K": {
    "1:1": "2048x2048",
    "4:3": "2048x1536",
    "3:2": "2016x1344",
    "16:9": "2048x1152",
    "21:9": "2016x864",
    "9:16": "1152x2048",
    "3:4": "1536x2048",
    "2:3": "1344x2016",
    "4:5": "1664x2080",
    "5:4": "2080x1664",
  },
  "4K": {
    "1:1": "2880x2880",
    "4:3": "3264x2448",
    "3:2": "3456x2304",
    "16:9": "3840x2160",
    "21:9": "3808x1632",
    "9:16": "2160x3840",
    "3:4": "2448x3264",
    "2:3": "2304x3456",
    "4:5": "2560x3200",
    "5:4": "3200x2560",
  },
};

type ProviderErrorCode = "PROVIDER_SAFETY_BLOCK";

function errorResponse(message: string, status = 400, code?: ProviderErrorCode) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function providerMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const value = payload as Record<string, unknown>;
  const error = value.error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return typeof value.message === "string" ? value.message : fallback;
}

function providerFailure(payload: unknown, fallback: string): { message: string; code?: ProviderErrorCode } {
  let serialized = "";
  try {
    serialized = JSON.stringify(payload).toLowerCase();
  } catch {
    // The provider payload is not expected to be cyclic, but the fallback remains safe if it is.
  }

  const safetyBlocked = [
    "safety_violations",
    "content_policy_violation",
    "prohibited_content",
    "blocked_reason",
  ].some((marker) => serialized.includes(marker));

  if (safetyBlocked) {
    const category = serialized.includes("sexual") ? " comme contenu potentiellement sexuel" : " pour contenu potentiellement sensible";
    return {
      code: "PROVIDER_SAFETY_BLOCK",
      message: `Le fournisseur a bloqué cette génération${category}. Ce classement est automatique et peut parfois être imprécis. Reformulez le prompt en termes non explicites ou essayez un autre fournisseur.`,
    };
  }

  return { message: providerMessage(payload, fallback) };
}

function findGoogleImage(value: unknown): { data: string; mimeType: string } | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findGoogleImage(item);
      if (found) return found;
    }
    return null;
  }

  const node = value as Record<string, unknown>;
  const data = node.data;
  const mimeType = node.mime_type ?? node.mimeType;
  if (
    typeof data === "string" &&
    (node.type === "image" || (typeof mimeType === "string" && mimeType.startsWith("image/")))
  ) {
    return { data, mimeType: typeof mimeType === "string" ? mimeType : "image/png" };
  }

  for (const child of Object.values(node)) {
    const found = findGoogleImage(child);
    if (found) return found;
  }
  return null;
}

function supportsResolution(provider: Provider, model: string, resolution: Resolution) {
  if (resolution === "1K") return true;
  if (provider === "openai") return model === "gpt-image-2";
  return model === "gemini-3.1-flash-image" || model === "gemini-3-pro-image";
}

function decodeBase64(base64: string) {
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function saveSyncedHistory(
  bytes: Uint8Array,
  mimeType: string,
  details: {
    provider: Provider;
    model: string;
    prompt: string;
    aspectRatio: AspectRatio;
    resolution: Resolution;
    quality: Quality;
  },
) {
  try {
    const identity = await getChatGPTUser();
    if (!identity) return {};
    const historyItem = await saveHistoryForEmail(identity.email, {
      ...details,
      modelName: MODEL_NAMES[details.model] || details.model,
      mimeType,
      bytes,
    });
    return historyItem ? { historyItem } : {};
  } catch {
    return { historyWarning: "Image créée, mais la synchronisation de l’historique a échoué." };
  }
}

export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = await request.json() as GenerateBody;
  } catch {
    return errorResponse("Requête invalide.");
  }

  const provider = body.provider;
  const apiKey = body.apiKey?.trim();
  const prompt = body.prompt?.trim();
  const aspectRatio = body.aspectRatio ?? "1:1";
  const resolution = body.resolution ?? "1K";
  const quality = body.quality ?? "medium";
  const model = body.model ?? (provider === "google" ? "gemini-3.1-flash-image" : "gpt-image-2");

  if (provider !== "openai" && provider !== "google") return errorResponse("Choisissez OpenAI ou Google.");
  if (provider === "openai" && !OPENAI_MODELS.has(model)) return errorResponse("Modèle OpenAI non pris en charge.");
  if (provider === "google" && !GOOGLE_MODELS.has(model)) return errorResponse("Modèle Google non pris en charge.");
  if (!apiKey) return errorResponse(`Ajoutez votre clé API ${provider === "openai" ? "OpenAI" : "Google"}.`);
  if (!prompt) return errorResponse("Décrivez l’image à créer.");
  if (prompt.length > 4000) return errorResponse("Le prompt doit contenir au maximum 4 000 caractères.");
  if (!ASPECT_RATIOS.has(aspectRatio)) return errorResponse("Format non pris en charge.");
  if (!["1K", "2K", "4K"].includes(resolution)) return errorResponse("Résolution non prise en charge.");
  if (!["low", "medium", "high"].includes(quality)) return errorResponse("Finition non prise en charge.");
  if (!supportsResolution(provider, model, resolution)) {
    return errorResponse(`${model} est limité au 1K. Choisissez 1K ou un autre modèle.`);
  }
  if (provider === "openai" && model !== "gpt-image-2" && !OPENAI_LEGACY_SIZES[aspectRatio]) {
    return errorResponse(`${model} accepte uniquement les formats 1:1, 3:2 et 2:3.`);
  }

  try {
    if (provider === "openai") {
      const size = model === "gpt-image-2"
        ? OPENAI_SIZES[resolution][aspectRatio]
        : OPENAI_LEGACY_SIZES[aspectRatio];

      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality, output_format: "png" }),
      });
      const payload = await response.json() as { data?: Array<{ b64_json?: string }>; error?: unknown };
      if (!response.ok) {
        const failure = providerFailure(payload, "OpenAI a refusé la requête.");
        return errorResponse(failure.message, response.status, failure.code);
      }
      const base64 = payload.data?.[0]?.b64_json;
      if (!base64) return errorResponse("OpenAI n’a renvoyé aucune image.", 502);
      const history = await saveSyncedHistory(decodeBase64(base64), "image/png", {
        provider,
        model,
        prompt,
        aspectRatio,
        resolution,
        quality,
      });
      return NextResponse.json(
        { image: `data:image/png;base64,${base64}`, model, provider, aspectRatio, resolution, ...history },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const responseFormat: Record<string, string> = {
      type: "image",
      mime_type: "image/png",
      aspect_ratio: aspectRatio,
    };
    if (model !== "gemini-2.5-flash-image") responseFormat.image_size = resolution;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{ type: "text", text: prompt }],
        response_format: responseFormat,
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      const failure = providerFailure(payload, "Google a refusé la requête.");
      return errorResponse(failure.message, response.status, failure.code);
    }
    const image = findGoogleImage(payload);
    if (!image) return errorResponse("Google n’a renvoyé aucune image.", 502);
    const history = await saveSyncedHistory(decodeBase64(image.data), image.mimeType, {
      provider,
      model,
      prompt,
      aspectRatio,
      resolution,
      quality,
    });
    return NextResponse.json(
      { image: `data:${image.mimeType};base64,${image.data}`, model, provider, aspectRatio, resolution, ...history },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return errorResponse("Le service d’images est momentanément indisponible. Réessayez dans un instant.", 502);
  }
}
