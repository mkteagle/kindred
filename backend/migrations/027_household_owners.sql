CREATE TABLE household_owners (
    user_id uuid PRIMARY KEY REFERENCES users(id)
);

INSERT INTO household_owners (user_id)
SELECT owner_id FROM household_lifecycle WHERE owner_id IS NOT NULL;

CREATE OR REPLACE FUNCTION kindred_assign_first_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE household_closed_at timestamptz;
BEGIN
    SELECT closed_at INTO household_closed_at FROM household_lifecycle WHERE singleton FOR UPDATE;
    IF household_closed_at IS NOT NULL THEN
        RAISE EXCEPTION 'This Kindred household has been deleted';
    END IF;
    IF NEW.role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM household_owners)
       AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND id <> NEW.id) THEN
        INSERT INTO household_owners (user_id) VALUES (NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE household_lifecycle DROP COLUMN owner_id;
