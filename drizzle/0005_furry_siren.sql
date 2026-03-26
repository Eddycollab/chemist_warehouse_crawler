CREATE TABLE `tender_crawl_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobType` enum('scheduled','manual') NOT NULL DEFAULT 'manual',
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`newTenders` int DEFAULT 0,
	`totalFetched` int DEFAULT 0,
	`scoredCount` int DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tender_crawl_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenders` (
	`id` varchar(36) NOT NULL,
	`source` varchar(20) NOT NULL DEFAULT 'acebidx',
	`projectNumber` varchar(50),
	`projectName` text NOT NULL,
	`orgId` varchar(50),
	`orgName` varchar(300),
	`budget` int,
	`catName` varchar(100),
	`typeofTender` varchar(200),
	`typeofAward` varchar(200),
	`isBudgetPublic` boolean DEFAULT true,
	`postDate` varchar(20),
	`submitDeadline` varchar(30),
	`queryDate` varchar(20),
	`aiScore` int,
	`aiPriority` varchar(10),
	`aiRecommend` boolean,
	`aiCategory` varchar(20),
	`aiBudgetFit` varchar(10),
	`aiReasons` json,
	`aiRisks` json,
	`scoredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tenders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `news_articles` MODIFY COLUMN `sourceId` int;--> statement-breakpoint
ALTER TABLE `news_articles` MODIFY COLUMN `sourceName` varchar(200);--> statement-breakpoint
ALTER TABLE `news_articles` MODIFY COLUMN `title` varchar(1000) NOT NULL;--> statement-breakpoint
ALTER TABLE `news_articles` MODIFY COLUMN `publishedAt` timestamp;--> statement-breakpoint
ALTER TABLE `news_articles` ADD `urlHash` varchar(64);--> statement-breakpoint
ALTER TABLE `news_articles` DROP COLUMN `createdAt`;