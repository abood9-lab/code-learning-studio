CREATE INDEX IF NOT EXISTS idx_cloud_rows_app_user ON public.cloud_rows (app_user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_files_app_user ON public.cloud_files (app_user_id);