-- Private consultations: apply only after review and a backup in the target
-- environment. This is additive: it changes no existing table or column.
BEGIN;

CREATE TABLE consultations (
  id uuid PRIMARY KEY,
  owner_user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(120) NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT consultations_title_length_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT consultations_owner_request_unique
    UNIQUE (owner_user_id, request_id)
);

CREATE INDEX consultations_owner_updated_id_idx
  ON consultations (owner_user_id, updated_at DESC, id DESC);

CREATE TABLE consultation_messages (
  id uuid PRIMARY KEY,
  consultation_id uuid NOT NULL
    REFERENCES consultations(id) ON DELETE CASCADE,
  content text NOT NULL,
  author_type text NOT NULL DEFAULT 'user',
  request_id uuid NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT consultation_messages_content_length_check
    CHECK (char_length(btrim(content)) BETWEEN 1 AND 10000),
  CONSTRAINT consultation_messages_author_type_check
    CHECK (author_type = 'user'),
  CONSTRAINT consultation_messages_consultation_request_unique
    UNIQUE (consultation_id, request_id)
);

CREATE INDEX consultation_messages_consultation_created_id_idx
  ON consultation_messages (consultation_id, created_at ASC, id ASC);

COMMIT;