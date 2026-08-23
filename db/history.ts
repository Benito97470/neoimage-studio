import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from ".";
import { neoimageHistory, neoimageProfiles } from "./schema";

const MAX_HISTORY_ITEMS = 100;

type BucketObject = {
  body: ReadableStream<Uint8Array>;
};

type HistoryBucket = {
  put: (
    key: string,
    value: ArrayBuffer | ArrayBufferView,
    options?: { httpMetadata?: { contentType?: string } },
  ) => Promise<unknown>;
  get: (key: string) => Promise<BucketObject | null>;
  delete: (keys: string | string[]) => Promise<unknown>;
};

export type HistoryInput = {
  id?: string;
  prompt: string;
  provider: string;
  model: string;
  modelName: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  mimeType: string;
  bytes: Uint8Array;
  createdAt?: string;
};

export type SyncedHistoryItem = {
  id: string;
  thumbnail: string;
  downloadUrl: string;
  prompt: string;
  provider: string;
  model: string;
  modelName: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  createdAt: string;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function safeHistoryId(value?: string) {
  return value && /^[a-zA-Z0-9-]{8,80}$/.test(value)
    ? value
    : crypto.randomUUID();
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function toHistoryItem(row: typeof neoimageHistory.$inferSelect): SyncedHistoryItem {
  const id = encodeURIComponent(row.id);
  return {
    id: row.id,
    thumbnail: `/api/history/${id}/image`,
    downloadUrl: `/api/history/${id}/image?download=1`,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    modelName: row.modelName,
    aspectRatio: row.aspectRatio,
    resolution: row.resolution,
    quality: row.quality,
    createdAt: row.createdAt,
  };
}

async function getBucket(): Promise<HistoryBucket> {
  const { env } = await import("cloudflare:workers");
  const bucket = (env as unknown as { BUCKET?: HistoryBucket }).BUCKET;
  if (!bucket) {
    throw new Error(
      "Cloudflare R2 binding `BUCKET` is unavailable. Set the `r2` field in .openai/hosting.json to `BUCKET`.",
    );
  }
  return bucket;
}

export async function getProfileByEmail(email: string) {
  const db = await getDb();
  const [profile] = await db
    .select()
    .from(neoimageProfiles)
    .where(eq(neoimageProfiles.email, normalizeEmail(email)))
    .limit(1);
  return profile ?? null;
}

async function pruneHistory(profileId: string) {
  const db = await getDb();
  const bucket = await getBucket();
  const rows = await db
    .select({ id: neoimageHistory.id, objectKey: neoimageHistory.objectKey })
    .from(neoimageHistory)
    .where(eq(neoimageHistory.profileId, profileId))
    .orderBy(desc(neoimageHistory.createdAt));
  const excess = rows.slice(MAX_HISTORY_ITEMS);
  if (excess.length === 0) return;

  await db.delete(neoimageHistory).where(inArray(neoimageHistory.id, excess.map((row) => row.id)));
  await bucket.delete(excess.map((row) => row.objectKey));
}

export async function saveHistoryForEmail(email: string, input: HistoryInput) {
  const profile = await getProfileByEmail(email);
  if (!profile) return null;

  const db = await getDb();
  let id = safeHistoryId(input.id);
  if (input.id) {
    const [existing] = await db
      .select()
      .from(neoimageHistory)
      .where(eq(neoimageHistory.id, id))
      .limit(1);
    if (existing?.profileId === profile.id) return toHistoryItem(existing);
    if (existing) id = crypto.randomUUID();
  }

  const mimeType = ["image/png", "image/jpeg", "image/webp"].includes(input.mimeType)
    ? input.mimeType
    : "image/png";
  const objectKey = `history/${profile.id}/${id}.${extensionForMimeType(mimeType)}`;
  const createdAt = input.createdAt && !Number.isNaN(Date.parse(input.createdAt))
    ? new Date(input.createdAt).toISOString()
    : new Date().toISOString();
  const values: typeof neoimageHistory.$inferInsert = {
    id,
    profileId: profile.id,
    prompt: input.prompt.slice(0, 4000),
    provider: input.provider,
    model: input.model,
    modelName: input.modelName.slice(0, 120),
    aspectRatio: input.aspectRatio,
    resolution: input.resolution,
    quality: input.quality,
    objectKey,
    mimeType,
    byteSize: input.bytes.byteLength,
    createdAt,
  };

  const bucket = await getBucket();
  await bucket.put(objectKey, input.bytes, { httpMetadata: { contentType: mimeType } });
  try {
    await db.insert(neoimageHistory).values(values);
  } catch (error) {
    await bucket.delete(objectKey);
    throw error;
  }

  await pruneHistory(profile.id);
  return toHistoryItem(values as typeof neoimageHistory.$inferSelect);
}

export async function listHistoryForEmail(email: string) {
  const profile = await getProfileByEmail(email);
  if (!profile) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(neoimageHistory)
    .where(eq(neoimageHistory.profileId, profile.id))
    .orderBy(desc(neoimageHistory.createdAt))
    .limit(MAX_HISTORY_ITEMS);
  return rows.map(toHistoryItem);
}

export async function deleteHistoryForEmail(email: string, id?: string) {
  const profile = await getProfileByEmail(email);
  if (!profile) return null;
  const db = await getDb();
  const bucket = await getBucket();

  if (!id) {
    const rows = await db
      .select({ objectKey: neoimageHistory.objectKey })
      .from(neoimageHistory)
      .where(eq(neoimageHistory.profileId, profile.id));
    await db.delete(neoimageHistory).where(eq(neoimageHistory.profileId, profile.id));
    if (rows.length > 0) await bucket.delete(rows.map((row) => row.objectKey));
    return true;
  }

  const [row] = await db
    .select()
    .from(neoimageHistory)
    .where(and(eq(neoimageHistory.id, id), eq(neoimageHistory.profileId, profile.id)))
    .limit(1);
  if (!row) return false;
  await db
    .delete(neoimageHistory)
    .where(and(eq(neoimageHistory.id, id), eq(neoimageHistory.profileId, profile.id)));
  await bucket.delete(row.objectKey);
  return true;
}

export async function getHistoryImageForEmail(email: string, id: string) {
  const profile = await getProfileByEmail(email);
  if (!profile) return null;
  const db = await getDb();
  const [row] = await db
    .select()
    .from(neoimageHistory)
    .where(and(eq(neoimageHistory.id, id), eq(neoimageHistory.profileId, profile.id)))
    .limit(1);
  if (!row) return null;
  const object = await (await getBucket()).get(row.objectKey);
  if (!object) return null;
  return { object, mimeType: row.mimeType, filename: `neoimage-${row.provider}-${row.id}.${extensionForMimeType(row.mimeType)}` };
}
