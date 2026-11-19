-- SAMURAI Messenger initial relational model.
-- PostgreSQL 15+. Apply only to a dedicated messenger database.
-- No plaintext message body is stored by this schema: payload_ciphertext is
-- client-encrypted application data. This schema alone does NOT constitute a
-- reviewed end-to-end encryption implementation.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS messenger_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CHECK (length(username) BETWEEN 3 AND 32),
    CHECK (length(display_name) BETWEEN 1 AND 80),
    CHECK (length(password_hash) >= 20)
);

CREATE TABLE IF NOT EXISTS messenger_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    device_label TEXT NOT NULL,
    push_token_hash BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messenger_devices_user_active
    ON messenger_devices(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS messenger_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    device_id UUID REFERENCES messenger_devices(id) ON DELETE SET NULL,
    refresh_token_hash BYTEA NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS messenger_sessions_user_active
    ON messenger_sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS messenger_user_privacy (
    user_id UUID PRIMARY KEY REFERENCES messenger_users(id) ON DELETE CASCADE,
    share_presence BOOLEAN NOT NULL DEFAULT false,
    send_read_receipts BOOLEAN NOT NULL DEFAULT true,
    send_delivery_receipts BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messenger_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind TEXT NOT NULL CHECK (kind IN ('direct', 'group', 'saved')),
    title TEXT,
    created_by UUID REFERENCES messenger_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS messenger_memberships (
    conversation_id UUID NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS messenger_memberships_user_active
    ON messenger_memberships(user_id, conversation_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS messenger_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE RESTRICT,
    client_message_id UUID NOT NULL,
    payload_ciphertext BYTEA NOT NULL,
    payload_nonce BYTEA NOT NULL,
    protocol_version SMALLINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edited_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    UNIQUE (sender_id, client_message_id),
    CHECK (octet_length(payload_ciphertext) BETWEEN 1 AND 1048576),
    CHECK (octet_length(payload_nonce) BETWEEN 12 AND 32),
    CHECK (protocol_version > 0)
);
CREATE INDEX IF NOT EXISTS messenger_messages_conversation_cursor
    ON messenger_messages(conversation_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS messenger_delivery_receipts (
    message_id UUID NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES messenger_devices(id) ON DELETE CASCADE,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, device_id)
);

CREATE TABLE IF NOT EXISTS messenger_read_receipts (
    message_id UUID NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS messenger_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800),
    sha256 BYTEA NOT NULL CHECK (octet_length(sha256) = 32),
    view_once BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messenger_attachment_opens (
    attachment_id UUID NOT NULL REFERENCES messenger_attachments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (attachment_id, user_id)
);

CREATE TABLE IF NOT EXISTS messenger_blocks (
    blocker_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS messenger_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    reported_user_id UUID NOT NULL REFERENCES messenger_users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES messenger_conversations(id) ON DELETE SET NULL,
    reason_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (reporter_id <> reported_user_id)
);

COMMIT;
