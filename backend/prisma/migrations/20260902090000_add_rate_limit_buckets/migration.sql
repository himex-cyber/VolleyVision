-- Shared token buckets for the rate limiter (src/lib/postgresRateLimit.ts).
--
-- The limiter was in-memory, and production is one Netlify Function per
-- invocation: buckets started empty on every cold start and concurrent
-- invocations never shared a budget, so the limit had no effect. This table is
-- the shared place the buckets move to.
--
-- Safe on a live database: it creates a new table and touches nothing that
-- exists. Deploying the code before or after this migration is also safe — the
-- limiter falls back to in-memory buckets whenever the query fails.
--
-- "key" is the primary key rather than a surrogate id on purpose: two
-- invocations racing on a key's first use then collide on this index instead of
-- inserting two rows and each granting itself a full bucket.

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "full_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
-- Cleanup deletes every bucket that has refilled to capacity, which is
-- unobservable for the same reason the in-memory sweep is: a full bucket is
-- indistinguishable from one that never existed. This index is what makes that
-- an indexed range scan rather than a full table scan.
CREATE INDEX "rate_limit_buckets_full_at_idx" ON "rate_limit_buckets"("full_at");
