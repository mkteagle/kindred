CREATE TABLE household_lifecycle (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    owner_id uuid REFERENCES users(id),
    closed_at timestamptz
);

-- Adopt the only existing admin. On a multi-admin installation the server
-- operator claims ownership explicitly with bootstrap_owner.py.
INSERT INTO household_lifecycle (owner_id)
VALUES ((SELECT id FROM users WHERE role = 'admin'
         AND (SELECT count(*) FROM users WHERE role = 'admin') = 1));

ALTER TABLE sessions ADD COLUMN confirmed_at timestamptz;
ALTER TABLE user_identities ADD COLUMN apple_refresh_token bytea;

-- Claim ownership for the first admin, including installations bootstrapped
-- through the social login flow. Reject account creation on a closed server.
CREATE FUNCTION kindred_assign_first_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE household household_lifecycle%ROWTYPE;
BEGIN
    SELECT * INTO household FROM household_lifecycle WHERE singleton FOR UPDATE;
    IF household.closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'This Kindred household has been deleted';
    END IF;
    IF household.owner_id IS NULL AND NEW.role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND id <> NEW.id) THEN
        UPDATE household_lifecycle SET owner_id = NEW.id WHERE singleton;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER kindred_assign_first_owner
AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION kindred_assign_first_owner();

-- Installed on household tables only when an operator closes the household.
-- Scheduled indexers and any in-flight API requests cannot refill its catalog.
CREATE FUNCTION kindred_reject_closed_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'This Kindred household has been deleted';
END;
$$;
