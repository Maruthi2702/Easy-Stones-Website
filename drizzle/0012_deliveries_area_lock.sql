ALTER TABLE "mongo_copy_state" ADD COLUMN "locked_areas" text[] DEFAULT '{}'::text[] NOT NULL;
