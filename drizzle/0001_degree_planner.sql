CREATE TABLE `courses` (
	`code` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`units_min` integer NOT NULL,
	`units_max` integer NOT NULL,
	`offered` text NOT NULL,
	`transdisciplinary` integer NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pathway_choices` (
	`user_id` integer NOT NULL,
	`program_code` text NOT NULL,
	`node_id` text NOT NULL,
	`option_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `program_code`, `node_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_code`) REFERENCES `programs`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `plan_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`course_code` text NOT NULL,
	`status` text NOT NULL,
	`year` integer NOT NULL,
	`session` text NOT NULL,
	`units` integer NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plan_entries_user_course_term` ON `plan_entries` (`user_id`,`course_code`,`year`,`session`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`program_code` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_code`) REFERENCES `programs`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `programs` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`year` integer NOT NULL,
	`units` integer NOT NULL,
	`duration` text NOT NULL,
	`url` text NOT NULL,
	`summary` text NOT NULL,
	`requirements` text NOT NULL,
	`constraints` text NOT NULL,
	`untracked` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
