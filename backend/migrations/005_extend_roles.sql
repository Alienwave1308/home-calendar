-- Migration 005: Extend family member roles
-- Add new roles: admin, child, guest
-- Previously only 'owner' and 'member' existed

-- No constraint change needed — role is stored as VARCHAR, not ENUM
-- We just need the application to support new values
-- This migration is a no-op for the DB schema, but documents the role expansion

-- Add a comment column to track when role was last changed
ALTER TABLE family_members ADD COLUMN IF NOT EXISTS role_changed_at TIMESTAMP;
