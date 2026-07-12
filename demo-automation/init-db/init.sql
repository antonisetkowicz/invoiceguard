-- Runs automatically on first container start (mounted into /docker-entrypoint-initdb.d)
-- Creates a separate database for demo lead data, alongside the n8n database
-- that was already created via the POSTGRES_DB environment variable.

CREATE DATABASE demo_leads;

\connect demo_leads

CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    message TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'new',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ai_response TEXT,
    qualified_score INTEGER
);

INSERT INTO leads (name, email, company, message, status, ai_response, qualified_score) VALUES
    ('Jan Kowalski', 'jan.kowalski@example.com', 'Acme Sp. z o.o.', 'Interesuje nas automatyzacja obsługi faktur.', 'new', NULL, NULL),
    ('Anna Nowak', 'anna.nowak@example.com', 'Nowak Consulting', 'Chcielibyśmy wdrożyć asystenta AI do obsługi klienta.', 'new', NULL, NULL);
