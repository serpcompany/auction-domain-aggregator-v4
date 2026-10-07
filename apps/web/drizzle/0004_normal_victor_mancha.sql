CREATE TABLE `domain_metrics` (
	`domain_name` text NOT NULL,
	`metric` text NOT NULL,
	`status` text NOT NULL,
	`value` real,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`domain_name`, `metric`),
	FOREIGN KEY (`domain_name`) REFERENCES `domains`(`name`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "domain_metrics_metric_check" CHECK("domain_metrics"."metric" in ('ahrefs_dr')),
	CONSTRAINT "domain_metrics_status_check" CHECK("domain_metrics"."status" in ('ok', 'not_found')),
	CONSTRAINT "domain_metrics_value_check" CHECK(("domain_metrics"."status" = 'ok' and "domain_metrics"."value" between 0 and 100) or ("domain_metrics"."status" = 'not_found' and "domain_metrics"."value" is null))
);
