DROP INDEX `domain_seo_metrics_majestic_tf_idx`;--> statement-breakpoint
DROP INDEX `domain_seo_metrics_majestic_cf_idx`;--> statement-breakpoint
DROP INDEX `domain_seo_metrics_majestic_ref_domains_idx`;--> statement-breakpoint
DROP INDEX `domain_seo_metrics_semrush_as_idx`;--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_majestic_tf_domain_name_idx` ON `domain_seo_metrics` (`majestic_tf`,`domain_name`);--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_majestic_cf_domain_name_idx` ON `domain_seo_metrics` (`majestic_cf`,`domain_name`);--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_majestic_ref_domains_domain_name_idx` ON `domain_seo_metrics` (`majestic_ref_domains`,`domain_name`);--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_semrush_as_domain_name_idx` ON `domain_seo_metrics` (`semrush_as`,`domain_name`);