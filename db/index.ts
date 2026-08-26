import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

export async function ensureLocalDevelopmentSchema() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");

  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS neoimage_profiles (
      id text PRIMARY KEY NOT NULL,
      email text NOT NULL,
      display_name text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      last_seen_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS neoimage_profiles_email_unique ON neoimage_profiles (email);
    CREATE TABLE IF NOT EXISTS neoimage_history (
      id text PRIMARY KEY NOT NULL,
      profile_id text NOT NULL,
      prompt text NOT NULL,
      provider text NOT NULL,
      model text NOT NULL,
      model_name text NOT NULL,
      aspect_ratio text NOT NULL,
      resolution text NOT NULL,
      quality text NOT NULL,
      object_key text NOT NULL,
      mime_type text NOT NULL,
      byte_size integer NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES neoimage_profiles(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS neoimage_history_profile_created_idx ON neoimage_history (profile_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS neoimage_history_object_key_unique ON neoimage_history (object_key);
    CREATE TABLE IF NOT EXISTS neoimage_api_vaults (
      profile_id text PRIMARY KEY NOT NULL,
      ciphertext text NOT NULL,
      salt text NOT NULL,
      iv text NOT NULL,
      kdf_iterations integer NOT NULL,
      version integer DEFAULT 1 NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (profile_id) REFERENCES neoimage_profiles(id) ON DELETE cascade
    );
  `);
}
