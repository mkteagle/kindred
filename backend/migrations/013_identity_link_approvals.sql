-- An owner can explicitly preapprove a verified provider email for an existing
-- account. This is not email matching against usernames or display names.
CREATE TABLE IF NOT EXISTS identity_link_approvals (
    provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
    email TEXT NOT NULL CHECK (email = lower(email)),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    linked_subject TEXT,
    linked_at TIMESTAMPTZ,
    PRIMARY KEY (provider, email)
);
