CREATE TABLE `crawl_targets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`baseUrl` text NOT NULL,
	`productListSelector` text NOT NULL,
	`productNameSelector` text NOT NULL,
	`productPriceSelector` text NOT NULL,
	`productOriginalPriceSelector` text,
	`productLinkSelector` text NOT NULL,
	`productImageSelector` text,
	`paginationParam` varchar(50) NOT NULL DEFAULT 'page',
	`maxPages` int NOT NULL DEFAULT 10,
	`isActive` boolean NOT NULL DEFAULT true,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `crawl_targets_id` PRIMARY KEY(`id`)
);
