CREATE TABLE "workstations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"hostname" text NOT NULL,
	"platform" text NOT NULL,
	"tool_root" text,
	"status" text NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"connected_at" bigint,
	"last_seen_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workstations_identity_unique" ON "workstations" USING btree ("organization_id","user_id","hostname","name");