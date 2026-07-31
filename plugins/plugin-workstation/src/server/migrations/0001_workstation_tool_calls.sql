CREATE TABLE "workstation_tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"workstation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"tool" text NOT NULL,
	"summary" text NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"duration_ms" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workstation_tool_calls_ws_created_idx" ON "workstation_tool_calls" USING btree ("workstation_id","created_at");