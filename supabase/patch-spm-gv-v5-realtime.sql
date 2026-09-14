-- Optional: machines see new tasks/reports in 1-2s via Supabase Realtime.
-- App already polls every 20s if Realtime is off.

alter publication supabase_realtime add table spm_gv_tasks;
alter publication supabase_realtime add table spm_gv_reports;
alter publication supabase_realtime add table spm_gv_assignees;
