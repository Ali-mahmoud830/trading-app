-- ============================================================
-- Migration: Add metadata columns to system_settings
-- Date: 2026-11-03
-- ============================================================

-- Add optional metadata columns used by contact, testimonials, milestones routes
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
