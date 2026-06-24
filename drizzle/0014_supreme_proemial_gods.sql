CREATE TABLE "bot_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"system_prompt" text NOT NULL,
	"model" varchar(128) NOT NULL,
	"reasoning_effort" varchar(32),
	"verbosity" varchar(32),
	"reasoning_summary" varchar(32),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
