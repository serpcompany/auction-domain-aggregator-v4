CREATE TABLE `domain_seo_metrics` (
	`domain_name` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`majestic_tf` integer,
	`majestic_cf` integer,
	`majestic_backlinks` integer,
	`majestic_ref_domains` integer,
	`semrush_as` integer,
	`semrush_ref_domains` integer,
	`semrush_backlinks` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`domain_name`) REFERENCES `domains`(`name`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "domain_seo_metrics_majestic_tf_range" CHECK("domain_seo_metrics"."majestic_tf" is null or "domain_seo_metrics"."majestic_tf" between 0 and 100),
	CONSTRAINT "domain_seo_metrics_majestic_cf_range" CHECK("domain_seo_metrics"."majestic_cf" is null or "domain_seo_metrics"."majestic_cf" between 0 and 100),
	CONSTRAINT "domain_seo_metrics_majestic_backlinks_nonnegative" CHECK("domain_seo_metrics"."majestic_backlinks" is null or "domain_seo_metrics"."majestic_backlinks" >= 0),
	CONSTRAINT "domain_seo_metrics_majestic_ref_domains_nonnegative" CHECK("domain_seo_metrics"."majestic_ref_domains" is null or "domain_seo_metrics"."majestic_ref_domains" >= 0),
	CONSTRAINT "domain_seo_metrics_semrush_as_range" CHECK("domain_seo_metrics"."semrush_as" is null or "domain_seo_metrics"."semrush_as" between 0 and 100),
	CONSTRAINT "domain_seo_metrics_semrush_ref_domains_nonnegative" CHECK("domain_seo_metrics"."semrush_ref_domains" is null or "domain_seo_metrics"."semrush_ref_domains" >= 0),
	CONSTRAINT "domain_seo_metrics_semrush_backlinks_nonnegative" CHECK("domain_seo_metrics"."semrush_backlinks" is null or "domain_seo_metrics"."semrush_backlinks" >= 0)
);
--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_majestic_tf_idx` ON `domain_seo_metrics` (`majestic_tf`);--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_majestic_cf_idx` ON `domain_seo_metrics` (`majestic_cf`);--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_majestic_ref_domains_idx` ON `domain_seo_metrics` (`majestic_ref_domains`);--> statement-breakpoint
CREATE INDEX `domain_seo_metrics_semrush_as_idx` ON `domain_seo_metrics` (`semrush_as`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_auction_listings` (
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`domain_name` text NOT NULL,
	`auction_url` text NOT NULL,
	`auction_type` text NOT NULL,
	`currency` text NOT NULL,
	`current_bid_cents` integer NOT NULL,
	`bid_count` integer DEFAULT 0 NOT NULL,
	`bidder_count` integer,
	`starts_at` integer,
	`ends_at` integer NOT NULL,
	`age_years` integer,
	`inbound_links` integer,
	`visitors` integer,
	`appraisal_cents` integer,
	`renewal_price_cents` integer,
	`status` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `external_id`),
	FOREIGN KEY (`domain_name`) REFERENCES `domains`(`name`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auction_listings_status_check" CHECK("__new_auction_listings"."status" in ('active', 'inactive')),
	CONSTRAINT "auction_listings_current_bid_cents_nonnegative" CHECK("__new_auction_listings"."current_bid_cents" >= 0),
	CONSTRAINT "auction_listings_bid_count_nonnegative" CHECK("__new_auction_listings"."bid_count" >= 0),
	CONSTRAINT "auction_listings_bidder_count_nonnegative" CHECK("__new_auction_listings"."bidder_count" is null or "__new_auction_listings"."bidder_count" >= 0),
	CONSTRAINT "auction_listings_age_years_nonnegative" CHECK("__new_auction_listings"."age_years" is null or "__new_auction_listings"."age_years" >= 0),
	CONSTRAINT "auction_listings_inbound_links_nonnegative" CHECK("__new_auction_listings"."inbound_links" is null or "__new_auction_listings"."inbound_links" >= 0),
	CONSTRAINT "auction_listings_visitors_nonnegative" CHECK("__new_auction_listings"."visitors" is null or "__new_auction_listings"."visitors" >= 0),
	CONSTRAINT "auction_listings_dynadot_appraisal_cents_nonnegative" CHECK("__new_auction_listings"."appraisal_cents" is null or "__new_auction_listings"."appraisal_cents" >= 0),
	CONSTRAINT "auction_listings_renewal_price_cents_nonnegative" CHECK("__new_auction_listings"."renewal_price_cents" is null or "__new_auction_listings"."renewal_price_cents" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_auction_listings`("provider", "external_id", "domain_name", "auction_url", "auction_type", "currency", "current_bid_cents", "bid_count", "bidder_count", "starts_at", "ends_at", "age_years", "inbound_links", "visitors", "appraisal_cents", "renewal_price_cents", "status", "first_seen_at", "last_seen_at") SELECT "provider", "external_id", "domain_name", "auction_url", "auction_type", "currency", "current_bid_cents", "bid_count", "bidder_count", "starts_at", "ends_at", "age_years", "inbound_links", "visitors", "appraisal_cents", "renewal_price_cents", "status", "first_seen_at", "last_seen_at" FROM `auction_listings`;--> statement-breakpoint
DROP TABLE `auction_listings`;--> statement-breakpoint
ALTER TABLE `__new_auction_listings` RENAME TO `auction_listings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `auction_listings_status_provider_idx` ON `auction_listings` (`status`,`provider`);--> statement-breakpoint
CREATE INDEX `auction_listings_domain_name_idx` ON `auction_listings` (`domain_name`);--> statement-breakpoint
CREATE INDEX `auction_listings_ends_at_idx` ON `auction_listings` (`ends_at`);--> statement-breakpoint
CREATE INDEX `auction_listings_current_bid_cents_idx` ON `auction_listings` (`current_bid_cents`);--> statement-breakpoint
CREATE INDEX `auction_listings_bid_count_idx` ON `auction_listings` (`bid_count`);--> statement-breakpoint
CREATE INDEX `auction_listings_age_years_idx` ON `auction_listings` (`age_years`);