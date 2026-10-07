CREATE TABLE `ahrefs_requests` (
	`id` integer PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	`domain_count` integer NOT NULL,
	`outcome` text NOT NULL,
	`cool_down_until` integer,
	CONSTRAINT "ahrefs_requests_domain_count_positive" CHECK("ahrefs_requests"."domain_count" >= 1)
);
--> statement-breakpoint
CREATE INDEX `ahrefs_requests_cool_down_until_idx` ON `ahrefs_requests` (`cool_down_until`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_domain_metrics` (
	`domain_name` text NOT NULL,
	`metric` text NOT NULL,
	`status` text NOT NULL,
	`value` real,
	`fetched_at` integer NOT NULL,
	`retry_after` integer,
	PRIMARY KEY(`domain_name`, `metric`),
	FOREIGN KEY (`domain_name`) REFERENCES `domains`(`name`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "domain_metrics_metric_check" CHECK("__new_domain_metrics"."metric" in ('ahrefs_dr')),
	CONSTRAINT "domain_metrics_status_check" CHECK("__new_domain_metrics"."status" in ('ok', 'not_found', 'omitted', 'pending')),
	CONSTRAINT "domain_metrics_value_check" CHECK(("__new_domain_metrics"."status" = 'ok' and "__new_domain_metrics"."value" between 0 and 100) or ("__new_domain_metrics"."status" <> 'ok' and "__new_domain_metrics"."value" is null)),
	CONSTRAINT "domain_metrics_retry_after_check" CHECK(("__new_domain_metrics"."status" in ('ok', 'not_found')) = ("__new_domain_metrics"."retry_after" is null))
);
--> statement-breakpoint
-- Hand-edited: drizzle-kit 0.31 also copies the new `retry_after` column,
-- which the old table lacks. Existing rows are `ok` or `not_found`, so it
-- stays null.
INSERT INTO `__new_domain_metrics`("domain_name", "metric", "status", "value", "fetched_at") SELECT "domain_name", "metric", "status", "value", "fetched_at" FROM `domain_metrics`;--> statement-breakpoint
DROP TABLE `domain_metrics`;--> statement-breakpoint
ALTER TABLE `__new_domain_metrics` RENAME TO `domain_metrics`;--> statement-breakpoint
PRAGMA foreign_keys=ON;