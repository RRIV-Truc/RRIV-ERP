-- Vai trò Thư ký trong phiên họp
DO $$ BEGIN
  ALTER TYPE meeting_participant_role ADD VALUE 'secretary';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
