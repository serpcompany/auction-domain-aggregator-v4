DROP INDEX `auction_listings_status_provider_idx`;--> statement-breakpoint
DROP INDEX `auction_listings_ends_at_idx`;--> statement-breakpoint
CREATE INDEX `auction_listings_provider_status_idx` ON `auction_listings` (`provider`,`status`);--> statement-breakpoint
CREATE INDEX `auction_listings_open_ends_at_idx` ON `auction_listings` (`ends_at`,`domain_name`,`provider`,`auction_type`,`current_bid_cents`) WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX `auction_listings_open_domain_name_idx` ON `auction_listings` (`domain_name`,`ends_at`) WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX `domain_metrics_metric_value_domain_name_idx` ON `domain_metrics` (`metric`,`value`,`domain_name`);