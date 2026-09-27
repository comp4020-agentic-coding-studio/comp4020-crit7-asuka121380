-- Before accounts existed, every visitor shared one anonymous "Demo student"
-- (users.id = 1). Its rows can't be attributed to any real person, and they
-- include duplicate enrolments and a code that isn't an ANU course, which the
-- constraints added next would reject. This prototype-only data is cleared
-- rather than migrated; reference data (courses, programs) is untouched and is
-- re-seeded at boot.
DELETE FROM `pathway_choices`;--> statement-breakpoint
DELETE FROM `plan_entries`;--> statement-breakpoint
DELETE FROM `profiles`;--> statement-breakpoint
DELETE FROM `users`;
