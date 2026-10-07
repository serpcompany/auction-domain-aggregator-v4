CREATE TABLE `listing_facets` (
	`facet` text NOT NULL,
	`value` text NOT NULL,
	`latest_ends_at` integer NOT NULL,
	PRIMARY KEY(`facet`, `value`),
	CONSTRAINT "listing_facets_facet_check" CHECK("listing_facets"."facet" in ('source', 'auction_type', 'tld'))
);
--> statement-breakpoint
ALTER TABLE `auction_listings` ADD `tld` text GENERATED ALWAYS AS (lower(substr("domain_name", length(rtrim("domain_name", replace("domain_name", '.', ''))) + 1))) VIRTUAL NOT NULL;--> statement-breakpoint
ALTER TABLE `auction_listings` ADD `domain_length` integer GENERATED ALWAYS AS (length("domain_name")) VIRTUAL NOT NULL;--> statement-breakpoint
CREATE INDEX `auction_listings_tld_status_ends_at_idx` ON `auction_listings` (`tld`,`status`,`ends_at`);--> statement-breakpoint
CREATE INDEX `auction_listings_domain_length_status_ends_at_idx` ON `auction_listings` (`domain_length`,`status`,`ends_at`);--> statement-breakpoint
-- Backfill the facet read model once; src/server/db/listing-facets.ts
-- rebuilds it with the same statement after every successful sync.
INSERT INTO `listing_facets` (`facet`, `value`, `latest_ends_at`)
SELECT 'source', `provider`, max(`ends_at`) FROM `auction_listings`
WHERE `status` = 'active' GROUP BY `provider`
UNION ALL
SELECT 'auction_type', lower(`auction_type`), max(`ends_at`) FROM `auction_listings`
WHERE `status` = 'active' GROUP BY lower(`auction_type`)
UNION ALL
SELECT 'tld', `tld`, max(`ends_at`) FROM `auction_listings`
WHERE `status` = 'active' GROUP BY `tld`;
