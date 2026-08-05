CREATE TABLE `remote_host_setup_plans` (
	`ssh_host` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'idle' NOT NULL,
	`steps` text NOT NULL,
	`current_step_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
