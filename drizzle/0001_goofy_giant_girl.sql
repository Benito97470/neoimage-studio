CREATE TABLE `neoimage_history` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`prompt` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`model_name` text NOT NULL,
	`aspect_ratio` text NOT NULL,
	`resolution` text NOT NULL,
	`quality` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `neoimage_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `neoimage_history_profile_created_idx` ON `neoimage_history` (`profile_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `neoimage_history_object_key_unique` ON `neoimage_history` (`object_key`);