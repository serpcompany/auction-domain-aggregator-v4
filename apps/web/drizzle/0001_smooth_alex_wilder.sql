PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ingestion_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`next_page` integer DEFAULT 1 NOT NULL,
	`records_fetched` integer DEFAULT 0 NOT NULL,
	`records_upserted` integer DEFAULT 0 NOT NULL,
	`records_inactivated` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	CONSTRAINT "ingestion_runs_status_check" CHECK("__new_ingestion_runs"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "ingestion_runs_pages_fetched_nonnegative" CHECK("__new_ingestion_runs"."pages_fetched" >= 0),
	CONSTRAINT "ingestion_runs_next_page_positive" CHECK("__new_ingestion_runs"."next_page" >= 1),
	CONSTRAINT "ingestion_runs_records_fetched_nonnegative" CHECK("__new_ingestion_runs"."records_fetched" >= 0),
	CONSTRAINT "ingestion_runs_records_upserted_nonnegative" CHECK("__new_ingestion_runs"."records_upserted" >= 0),
	CONSTRAINT "ingestion_runs_records_inactivated_nonnegative" CHECK("__new_ingestion_runs"."records_inactivated" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_ingestion_runs`("id", "provider", "status", "started_at", "completed_at", "pages_fetched", "next_page", "records_fetched", "records_upserted", "records_inactivated", "error_code") SELECT "id", "provider", "status", "started_at", "completed_at", "pages_fetched", 1, "records_fetched", "records_upserted", "records_inactivated", "error_code" FROM `ingestion_runs`;--> statement-breakpoint
DROP TABLE `ingestion_runs`;--> statement-breakpoint
ALTER TABLE `__new_ingestion_runs` RENAME TO `ingestion_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ingestion_runs_provider_started_at_idx` ON `ingestion_runs` (`provider`,`started_at`);
