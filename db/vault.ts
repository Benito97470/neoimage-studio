import { eq, sql } from "drizzle-orm";
import { getDb } from ".";
import { neoimageApiVaults } from "./schema";

export type EncryptedApiVaultInput = {
  ciphertext: string;
  salt: string;
  iv: string;
  kdfIterations: number;
  version: number;
};

export async function getApiVault(profileId: string) {
  const db = await getDb();
  const [vault] = await db
    .select()
    .from(neoimageApiVaults)
    .where(eq(neoimageApiVaults.profileId, profileId))
    .limit(1);
  return vault ?? null;
}

export async function saveApiVault(profileId: string, input: EncryptedApiVaultInput) {
  const db = await getDb();
  await db
    .insert(neoimageApiVaults)
    .values({ profileId, ...input })
    .onConflictDoUpdate({
      target: neoimageApiVaults.profileId,
      set: { ...input, updatedAt: sql`CURRENT_TIMESTAMP` },
    });
  return getApiVault(profileId);
}

export async function deleteApiVault(profileId: string) {
  const db = await getDb();
  await db.delete(neoimageApiVaults).where(eq(neoimageApiVaults.profileId, profileId));
}
