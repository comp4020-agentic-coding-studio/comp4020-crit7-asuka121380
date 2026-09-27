PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plan_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`course_code` text NOT NULL,
	`status` text NOT NULL,
	`year` integer NOT NULL,
	`session` text NOT NULL,
	`units` integer NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_code`) REFERENCES `courses`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_plan_entries`("id", "user_id", "course_code", "status", "year", "session", "units", "updated_at") SELECT "id", "user_id", "course_code", "status", "year", "session", "units", "updated_at" FROM `plan_entries`;--> statement-breakpoint
DROP TABLE `plan_entries`;--> statement-breakpoint
ALTER TABLE `__new_plan_entries` RENAME TO `plan_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `plan_entries_user_course` ON `plan_entries` (`user_id`,`course_code`);--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `name`;