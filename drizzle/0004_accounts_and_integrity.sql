CREATE TABLE `requirement_selections` (
	`user_id` integer NOT NULL,
	`program_code` text NOT NULL,
	`node_id` text NOT NULL,
	`course_code` text NOT NULL,
	PRIMARY KEY(`user_id`, `program_code`, `node_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_code`) REFERENCES `programs`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_courses` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`units_min` integer NOT NULL,
	`units_max` integer NOT NULL,
	`offered` text NOT NULL,
	`semesters` integer DEFAULT 1 NOT NULL,
	`semester_note` text,
	`transdisciplinary` integer,
	`incompatible` text DEFAULT '[]' NOT NULL,
	`incompatible_note` text,
	`detailed` integer DEFAULT false NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_courses`("code", "title", "units_min", "units_max", "offered", "transdisciplinary", "url") SELECT "code", "title", "units_min", "units_max", "offered", "transdisciplinary", "url" FROM `courses`;--> statement-breakpoint
DROP TABLE `courses`;--> statement-breakpoint
ALTER TABLE `__new_courses` RENAME TO `courses`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
-- users was emptied by 0003, so there is nothing to copy across
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);