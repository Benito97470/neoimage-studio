CREATE TABLE `neoimage_api_vaults` (
	`profile_id` text PRIMARY KEY NOT NULL,
	`ciphertext` text NOT NULL,
	`salt` text NOT NULL,
	`iv` text NOT NULL,
	`kdf_iterations` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `neoimage_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
