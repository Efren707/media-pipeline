-- Phase 7: user accounts. The id is the {userId} in every S3 key, so it never changes.
CREATE TABLE users (
    id            uuid         PRIMARY KEY,
    username      varchar(32)  NOT NULL,
    password_hash varchar(100) NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT users_username_key UNIQUE (username),
    -- Stored lowercase so "Alice" and "alice" can't both sign up.
    CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_]{3,32}$')
);
