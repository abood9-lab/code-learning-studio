CREATE TABLE public.cloud_projects (
  project_id TEXT PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  backend TEXT NOT NULL DEFAULT 'codzer' CHECK (backend IN ('codzer','supabase')),
  api_key TEXT NOT NULL UNIQUE,
  supabase_url TEXT,
  supabase_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloud_projects TO authenticated;
GRANT ALL ON public.cloud_projects TO service_role;
ALTER TABLE public.cloud_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their cloud project" ON public.cloud_projects FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.owner_id = auth.uid()));

CREATE TABLE public.cloud_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.cloud_projects(project_id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{0,62}$'),
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  read_access TEXT NOT NULL DEFAULT 'public' CHECK (read_access IN ('public','authenticated','owner')),
  write_access TEXT NOT NULL DEFAULT 'public' CHECK (write_access IN ('public','authenticated','owner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloud_tables TO authenticated;
GRANT ALL ON public.cloud_tables TO service_role;
ALTER TABLE public.cloud_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their cloud tables" ON public.cloud_tables FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.cloud_projects c WHERE c.project_id = cloud_tables.project_id AND c.owner_id = auth.uid()));

CREATE TABLE public.cloud_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.cloud_projects(project_id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, email)
);
GRANT SELECT (id, project_id, owner_id, email, created_at), DELETE ON public.cloud_users TO authenticated;
GRANT ALL ON public.cloud_users TO service_role;
ALTER TABLE public.cloud_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners view their app users" ON public.cloud_users FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owners remove their app users" ON public.cloud_users FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.cloud_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  owner_id UUID NOT NULL,
  app_user_id UUID REFERENCES public.cloud_users(id) ON DELETE SET NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, table_name) REFERENCES public.cloud_tables(project_id, name) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_cloud_rows_table ON public.cloud_rows (project_id, table_name, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cloud_rows TO authenticated;
GRANT ALL ON public.cloud_rows TO service_role;
ALTER TABLE public.cloud_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their cloud rows" ON public.cloud_rows FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid() AND EXISTS (SELECT 1 FROM public.cloud_projects c WHERE c.project_id = cloud_rows.project_id AND c.owner_id = auth.uid()));

CREATE TABLE public.cloud_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES public.cloud_projects(project_id) ON DELETE CASCADE,
  owner_id UUID NOT NULL,
  app_user_id UUID REFERENCES public.cloud_users(id) ON DELETE SET NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, path)
);
GRANT SELECT ON public.cloud_files TO authenticated;
GRANT ALL ON public.cloud_files TO service_role;
ALTER TABLE public.cloud_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners view their cloud files" ON public.cloud_files FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.cloud_touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER cloud_projects_touch BEFORE UPDATE ON public.cloud_projects FOR EACH ROW EXECUTE FUNCTION public.cloud_touch_updated_at();
CREATE TRIGGER cloud_tables_touch BEFORE UPDATE ON public.cloud_tables FOR EACH ROW EXECUTE FUNCTION public.cloud_touch_updated_at();
CREATE TRIGGER cloud_rows_touch BEFORE UPDATE ON public.cloud_rows FOR EACH ROW EXECUTE FUNCTION public.cloud_touch_updated_at();