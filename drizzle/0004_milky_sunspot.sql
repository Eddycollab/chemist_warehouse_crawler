CREATE TABLE `news_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int NOT NULL,
	`sourceName` varchar(200) NOT NULL,
	`title` varchar(500) NOT NULL,
	`url` text NOT NULL,
	`publishedAt` varchar(100),
	`excerpt` text,
	`imageUrl` text,
	`isRead` boolean NOT NULL DEFAULT false,
	`crawledAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `news_articles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `news_crawl_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sourceId` int,
	`sourceName` varchar(200),
	`jobType` enum('scheduled','manual') NOT NULL DEFAULT 'manual',
	`status` enum('pending','running','completed','failed','stopped') NOT NULL DEFAULT 'pending',
	`newArticles` int DEFAULT 0,
	`totalArticles` int DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `news_crawl_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `news_sources` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`url` text NOT NULL,
	`articleSelector` text NOT NULL DEFAULT ('article'),
	`titleSelector` text NOT NULL DEFAULT ('.entry-title a'),
	`dateSelector` text DEFAULT ('.entry-date'),
	`excerptSelector` text DEFAULT ('.entry-summary'),
	`imageSelector` text DEFAULT ('.wp-post-image'),
	`paginationSelector` text DEFAULT ('.pagination a.next'),
	`maxPages` int NOT NULL DEFAULT 5,
	`isActive` boolean NOT NULL DEFAULT true,
	`notes` text,
	`lastCrawledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `news_sources_id` PRIMARY KEY(`id`)
);
