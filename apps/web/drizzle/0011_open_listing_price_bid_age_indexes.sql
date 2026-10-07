DROP INDEX `auction_listings_current_bid_cents_idx`;--> statement-breakpoint
DROP INDEX `auction_listings_bid_count_idx`;--> statement-breakpoint
DROP INDEX `auction_listings_age_years_idx`;--> statement-breakpoint
CREATE INDEX `auction_listings_open_current_bid_cents_idx` ON `auction_listings` (`current_bid_cents`,`domain_name`,`ends_at`) WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX `auction_listings_open_bid_count_idx` ON `auction_listings` (`bid_count`,`domain_name`,`ends_at`) WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX `auction_listings_open_age_years_idx` ON `auction_listings` (`age_years`,`domain_name`,`ends_at`) WHERE "status" = 'active';