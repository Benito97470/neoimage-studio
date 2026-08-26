import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const neoimageProfiles = sqliteTable(
  "neoimage_profiles",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("neoimage_profiles_email_unique").on(table.email),
  ],
);

export const neoimageApiVaults = sqliteTable("neoimage_api_vaults", {
  profileId: text("profile_id")
    .primaryKey()
    .references(() => neoimageProfiles.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  salt: text("salt").notNull(),
  iv: text("iv").notNull(),
  kdfIterations: integer("kdf_iterations").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const neoimageHistory = sqliteTable(
  "neoimage_history",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => neoimageProfiles.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelName: text("model_name").notNull(),
    aspectRatio: text("aspect_ratio").notNull(),
    resolution: text("resolution").notNull(),
    quality: text("quality").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("neoimage_history_profile_created_idx").on(table.profileId, table.createdAt),
    uniqueIndex("neoimage_history_object_key_unique").on(table.objectKey),
  ],
);
