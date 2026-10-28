-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'FRIEND', 'OPPOSER');

-- CreateEnum
CREATE TYPE "Giruda" AS ENUM ('SPADE', 'DIAMOND', 'HEART', 'CLUB', 'NO_GIRUDA');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "username" VARCHAR(50) NOT NULL,
    "total_games" INTEGER NOT NULL DEFAULT 0,
    "win_count" INTEGER NOT NULL DEFAULT 0,
    "lose_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameHistory" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "is_win" BOOLEAN NOT NULL,
    "bid_score" INTEGER NOT NULL,
    "team_points" INTEGER NOT NULL DEFAULT 0,
    "giruda" "Giruda" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "GameHistory_user_id_idx" ON "GameHistory"("user_id");

-- CreateIndex
CREATE INDEX "GameHistory_created_at_idx" ON "GameHistory"("created_at");

-- AddForeignKey
ALTER TABLE "GameHistory" ADD CONSTRAINT "GameHistory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

