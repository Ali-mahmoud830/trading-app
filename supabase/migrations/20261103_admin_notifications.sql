-- Migration: Create admin_notifications table for audit logging
-- Safe execution: IF NOT EXISTS ensures no duplicate table errors

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS and grant service role full access
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'admin_notifications' 
    AND policyname = 'Service role full access on admin_notifications'
  ) THEN
    CREATE POLICY "Service role full access on admin_notifications"
      ON public.admin_notifications
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END
$$;
