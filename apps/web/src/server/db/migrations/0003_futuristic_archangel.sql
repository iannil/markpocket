CREATE TABLE "base" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "cell" (
	"id" text PRIMARY KEY NOT NULL,
	"record_id" text NOT NULL,
	"field_id" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cell_history" (
	"id" text PRIMARY KEY NOT NULL,
	"cell_id" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "table" (
	"id" text PRIMARY KEY NOT NULL,
	"base_id" text NOT NULL,
	"name" text NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "base" ADD CONSTRAINT "base_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell" ADD CONSTRAINT "cell_record_id_record_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."record"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cell" ADD CONSTRAINT "cell_field_id_field_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field" ADD CONSTRAINT "field_table_id_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record" ADD CONSTRAINT "record_table_id_table_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."table"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table" ADD CONSTRAINT "table_base_id_base_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."base"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cell_record_field_uq" ON "cell" USING btree ("record_id","field_id");--> statement-breakpoint
CREATE INDEX "cell_field_id_idx" ON "cell" USING btree ("field_id");--> statement-breakpoint
CREATE INDEX "cell_record_id_idx" ON "cell" USING btree ("record_id");