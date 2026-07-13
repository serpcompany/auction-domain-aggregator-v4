CREATE TABLE `auction_listings` (
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`domain_name` text NOT NULL,
	`auction_url` text NOT NULL,
	`auction_type` text NOT NULL,
	`currency` text NOT NULL,
	`current_bid_cents` integer NOT NULL,
	`bid_count` integer DEFAULT 0 NOT NULL,
	`bidder_count` integer DEFAULT 0 NOT NULL,
	`starts_at` integer,
	`ends_at` integer NOT NULL,
	`age_years` integer,
	`inbound_links` integer,
	`visitors` integer,
	`dynadot_appraisal_cents` integer,
	`renewal_price_cents` integer,
	`status` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`provider`, `external_id`),
	FOREIGN KEY (`domain_name`) REFERENCES `domains`(`name`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "auction_listings_status_check" CHECK("auction_listings"."status" in ('active', 'inactive')),
	CONSTRAINT "auction_listings_current_bid_cents_nonnegative" CHECK("auction_listings"."current_bid_cents" >= 0),
	CONSTRAINT "auction_listings_bid_count_nonnegative" CHECK("auction_listings"."bid_count" >= 0),
	CONSTRAINT "auction_listings_bidder_count_nonnegative" CHECK("auction_listings"."bidder_count" >= 0),
	CONSTRAINT "auction_listings_age_years_nonnegative" CHECK("auction_listings"."age_years" is null or "auction_listings"."age_years" >= 0),
	CONSTRAINT "auction_listings_inbound_links_nonnegative" CHECK("auction_listings"."inbound_links" is null or "auction_listings"."inbound_links" >= 0),
	CONSTRAINT "auction_listings_visitors_nonnegative" CHECK("auction_listings"."visitors" is null or "auction_listings"."visitors" >= 0),
	CONSTRAINT "auction_listings_dynadot_appraisal_cents_nonnegative" CHECK("auction_listings"."dynadot_appraisal_cents" is null or "auction_listings"."dynadot_appraisal_cents" >= 0),
	CONSTRAINT "auction_listings_renewal_price_cents_nonnegative" CHECK("auction_listings"."renewal_price_cents" is null or "auction_listings"."renewal_price_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX `auction_listings_status_provider_idx` ON `auction_listings` (`status`,`provider`);--> statement-breakpoint
CREATE INDEX `auction_listings_domain_name_idx` ON `auction_listings` (`domain_name`);--> statement-breakpoint
CREATE INDEX `auction_listings_ends_at_idx` ON `auction_listings` (`ends_at`);--> statement-breakpoint
CREATE INDEX `auction_listings_current_bid_cents_idx` ON `auction_listings` (`current_bid_cents`);--> statement-breakpoint
CREATE INDEX `auction_listings_bid_count_idx` ON `auction_listings` (`bid_count`);--> statement-breakpoint
CREATE INDEX `auction_listings_age_years_idx` ON `auction_listings` (`age_years`);--> statement-breakpoint
CREATE TABLE `domains` (
	`name` text PRIMARY KEY NOT NULL,
	`first_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ingestion_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`pages_fetched` integer DEFAULT 0 NOT NULL,
	`records_fetched` integer DEFAULT 0 NOT NULL,
	`records_upserted` integer DEFAULT 0 NOT NULL,
	`records_inactivated` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	CONSTRAINT "ingestion_runs_status_check" CHECK("ingestion_runs"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "ingestion_runs_pages_fetched_nonnegative" CHECK("ingestion_runs"."pages_fetched" >= 0),
	CONSTRAINT "ingestion_runs_records_fetched_nonnegative" CHECK("ingestion_runs"."records_fetched" >= 0),
	CONSTRAINT "ingestion_runs_records_upserted_nonnegative" CHECK("ingestion_runs"."records_upserted" >= 0),
	CONSTRAINT "ingestion_runs_records_inactivated_nonnegative" CHECK("ingestion_runs"."records_inactivated" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ingestion_runs_provider_started_at_idx` ON `ingestion_runs` (`provider`,`started_at`);