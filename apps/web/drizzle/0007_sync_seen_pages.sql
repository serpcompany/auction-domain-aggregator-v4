CREATE TABLE `ingestion_run_seen_pages` (
	`id` integer PRIMARY KEY NOT NULL,
	`run_id` integer NOT NULL,
	`external_ids` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `ingestion_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ingestion_run_seen_pages_run_id_idx` ON `ingestion_run_seen_pages` (`run_id`);