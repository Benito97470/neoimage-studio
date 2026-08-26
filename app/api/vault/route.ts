import { chatGPTSignInPath, getChatGPTUser } from "../../chatgpt-auth";
import { getProfileByEmail } from "../../../db/history";
import { deleteApiVault, getApiVault, saveApiVault } from "../../../db/vault";

export const runtime = "edge";

type VaultPayload = {
  ciphertext?: string;
  salt?: string;
  iv?: string;
  kdfIterations?: number;
  version?: number;
};

function noStore(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function isBase64(value: unknown, minimum: number, maximum: number) {
  return typeof value === "string"
    && value.length >= minimum
    && value.length <= maximum
    && value.length % 4 === 0
    && /^[a-zA-Z0-9+/]+={0,2}$/.test(value);
}

async function authenticatedProfile() {
  const identity = await getChatGPTUser();
  if (!identity) return { error: noStore({
    error: "Connectez-vous pour accéder au coffre synchronisé.",
    signInUrl: chatGPTSignInPath("/"),
  }, 401) };
  const profile = await getProfileByEmail(identity.email);
  if (!profile) return { error: noStore({ error: "Créez votre compte NeoImage pour activer le coffre." }, 403) };
  return { profile };
}

export async function GET() {
  try {
    const access = await authenticatedProfile();
    if ("error" in access) return access.error;
    return noStore({ vault: await getApiVault(access.profile.id) });
  } catch {
    return noStore({ error: "Impossible de charger le coffre chiffré." }, 500);
  }
}

export async function PUT(request: Request) {
  const access = await authenticatedProfile();
  if ("error" in access) return access.error;

  let payload: VaultPayload;
  try {
    payload = await request.json() as VaultPayload;
  } catch {
    return noStore({ error: "Coffre chiffré invalide." }, 400);
  }

  if (
    !isBase64(payload.ciphertext, 24, 24_000)
    || !isBase64(payload.salt, 20, 128)
    || !isBase64(payload.iv, 16, 64)
    || !Number.isInteger(payload.kdfIterations)
    || (payload.kdfIterations ?? 0) < 100_000
    || (payload.kdfIterations ?? 0) > 1_000_000
    || payload.version !== 1
  ) {
    return noStore({ error: "Paramètres de chiffrement invalides." }, 400);
  }

  try {
    const vault = await saveApiVault(access.profile.id, {
      ciphertext: payload.ciphertext as string,
      salt: payload.salt as string,
      iv: payload.iv as string,
      kdfIterations: payload.kdfIterations as number,
      version: 1,
    });
    return noStore({ vault });
  } catch {
    return noStore({ error: "Impossible d’enregistrer le coffre chiffré." }, 500);
  }
}

export async function DELETE() {
  try {
    const access = await authenticatedProfile();
    if ("error" in access) return access.error;
    await deleteApiVault(access.profile.id);
    return noStore({ deleted: true });
  } catch {
    return noStore({ error: "Impossible de réinitialiser le coffre." }, 500);
  }
}
