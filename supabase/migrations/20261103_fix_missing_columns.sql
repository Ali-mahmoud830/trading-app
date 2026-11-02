-- ============================================================
-- Migration: Fix missing columns causing 500 errors
-- Date: 2026-11-03
-- ============================================================

-- 1. Add updated_at to deposits if missing
ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Add updated_at to user_profiles if missing
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Add network_id + user_id columns to deposits if they came from a newer schema
ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS network_id TEXT;

ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS user_id UUID;

-- 4. Ensure withdrawal_settings has all needed columns
ALTER TABLE public.withdrawal_settings
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT true;

-- 5. Add extra metadata columns to system_settings (used by contact, testimonials, milestones)
ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS category TEXT;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- 6. Auto-update trigger (shared function for all tables)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deposits_updated_at ON public.deposits;
CREATE TRIGGER trg_deposits_updated_at
  BEFORE UPDATE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_withdrawals_updated_at ON public.withdrawals;
CREATE TRIGGER trg_withdrawals_updated_at
  BEFORE UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Notify PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
