import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cloudTableSchema, type CloudStatus, type CloudTableDef } from "@/lib/cloud-core";
import type { Json } from "@/integrations/supabase/types";

const input = z.object({
  projectId: z.string().min(1).max(150),
  action: z.enum([
    "status",
    "enable",
    "applySchema",
    "dropTable",
    "rows",
    "saveRow",
    "deleteRow",
    "users",
    "deleteUser",
    "files",
    "deleteFile",
    "connectSupabase",
    "useCodzer",
  ]),
  tables: z.array(cloudTableSchema).max(30).optional(),
  table: z.string().max(63).optional(),
  id: z.string().uuid().optional(),
  data: z.record(z.string().max(63), z.unknown()).optional(),
  supabaseUrl: z.string().max(200).optional(),
  supabaseKey: z.string().max(2000).optional(),
});

export type CloudAction = Omit<z.input<typeof input>, "projectId">;

export interface CloudRow {
  id: string;
  user_id: string | null;
  created_at: string;
  data: { [key: string]: Json | undefined };
}
export interface CloudResult {
  status: CloudStatus;
  rows?: CloudRow[];
  users?: Array<{ id: string; email: string; created_at: string }>;
  files?: Array<{
    id: string;
    path: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
  }>;
}

/** Project owner's control panel for Cloud Codzer. Every query runs as the signed-in owner, so access rules apply. */
export const cloudAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(input)
  .handler(async ({ data, context }): Promise<CloudResult> => {
    const db = context.supabase;
    const { data: project } = await db
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found or access denied");
    const base = { project_id: project.id, owner_id: context.userId };

    const ensureEnabled = async () => {
      const { data: existing } = await db
        .from("cloud_projects")
        .select("project_id")
        .eq("project_id", project.id)
        .maybeSingle();
      if (existing) return;
      const key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const { error } = await db.from("cloud_projects").insert({ ...base, api_key: `ck_${key}` });
      if (error) throw new Error("Could not turn on Cloud Codzer");
    };
    const requireTable = () => {
      if (!data.table) throw new Error("Table name is required");
      return data.table;
    };
    const result: Omit<CloudResult, "status"> = {};

    if (data.action === "enable") await ensureEnabled();
    else if (data.action === "applySchema") {
      if (!data.tables?.length) throw new Error("No tables to create");
      await ensureEnabled();
      const { error } = await db.from("cloud_tables").upsert(
        data.tables.map((table: CloudTableDef) => ({
          ...base,
          name: table.name,
          columns: table.columns,
          read_access: table.read,
          write_access: table.write,
        })),
        { onConflict: "project_id,name" },
      );
      if (error) throw new Error("Could not save tables");
    } else if (data.action === "dropTable") {
      const { error } = await db
        .from("cloud_tables")
        .delete()
        .eq("project_id", project.id)
        .eq("name", requireTable());
      if (error) throw new Error("Could not delete the table");
    } else if (data.action === "saveRow") {
      const table = requireTable();
      const { stripSystemFields } = await import("@/lib/cloud-core");
      const values = stripSystemFields(data.data ?? {}) as never;
      const { error } = data.id
        ? await db
            .from("cloud_rows")
            .update({ data: values })
            .eq("id", data.id)
            .eq("project_id", project.id)
        : await db.from("cloud_rows").insert({ ...base, table_name: table, data: values });
      if (error) throw new Error("Could not save the record");
    } else if (data.action === "deleteRow") {
      if (!data.id) throw new Error("Record id is required");
      const { error } = await db
        .from("cloud_rows")
        .delete()
        .eq("id", data.id)
        .eq("project_id", project.id);
      if (error) throw new Error("Could not delete the record");
    } else if (data.action === "deleteUser") {
      if (!data.id) throw new Error("User id is required");
      const { error } = await db
        .from("cloud_users")
        .delete()
        .eq("id", data.id)
        .eq("project_id", project.id);
      if (error) throw new Error("Could not remove the user");
    } else if (data.action === "deleteFile") {
      if (!data.id) throw new Error("File id is required");
      const { data: file } = await db
        .from("cloud_files")
        .select("id,path")
        .eq("id", data.id)
        .eq("project_id", project.id)
        .maybeSingle();
      if (!file) throw new Error("File not found");
      const { removeCloudFile } = await import("@/lib/cloud.server");
      await removeCloudFile(project.id, file.id, file.path);
    } else if (data.action === "connectSupabase") {
      const url = (data.supabaseUrl ?? "").trim().replace(/\/+$/, "");
      const key = (data.supabaseKey ?? "").trim();
      const { isPublicSupabaseKey } = await import("@/lib/cloud-core");
      if (!/^https:\/\/[a-z0-9]{10,40}\.supabase\.co$/.test(url))
        throw new Error("Enter your project URL, like https://abcdefgh.supabase.co");
      if (!isPublicSupabaseKey(key))
        throw new Error("Use the public (anon / publishable) key, never the secret key");
      const probe = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } }).catch(
        () => null,
      );
      if (!probe?.ok) throw new Error("Supabase did not accept this URL and key");
      await ensureEnabled();
      const { error } = await db
        .from("cloud_projects")
        .update({ backend: "supabase", supabase_url: url, supabase_key: key })
        .eq("project_id", project.id);
      if (error) throw new Error("Could not save the connection");
    } else if (data.action === "useCodzer") {
      await ensureEnabled();
      const { error } = await db
        .from("cloud_projects")
        .update({ backend: "codzer" })
        .eq("project_id", project.id);
      if (error) throw new Error("Could not switch to Cloud Codzer");
    }

    if (data.action === "rows" || data.action === "saveRow" || data.action === "deleteRow") {
      const { data: rows, error } = await db
        .from("cloud_rows")
        .select("id,data,app_user_id,created_at")
        .eq("project_id", project.id)
        .eq("table_name", requireTable())
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error("Could not read records");
      result.rows = rows.map((row) => ({
        id: row.id,
        user_id: row.app_user_id,
        created_at: row.created_at,
        data: row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {},
      }));
    }
    if (data.action === "users" || data.action === "deleteUser") {
      const { data: users } = await db
        .from("cloud_users")
        .select("id,email,created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(500);
      result.users = users ?? [];
    }
    if (data.action === "files" || data.action === "deleteFile") {
      const { data: files } = await db
        .from("cloud_files")
        .select("id,path,mime_type,size_bytes,created_at")
        .eq("project_id", project.id)
        .order("created_at", { ascending: false })
        .limit(500);
      result.files = files ?? [];
    }

    const count = async (table: "cloud_rows" | "cloud_users" | "cloud_files", name?: string) => {
      let query = db
        .from(table as "cloud_rows")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id);
      if (name) query = query.eq("table_name", name);
      return (await query).count ?? 0;
    };
    const { data: cloud } = await db
      .from("cloud_projects")
      .select("backend,api_key,supabase_url,supabase_key")
      .eq("project_id", project.id)
      .maybeSingle();
    const { data: tables } = cloud
      ? await db
          .from("cloud_tables")
          .select("name,columns,read_access,write_access")
          .eq("project_id", project.id)
          .order("name")
      : { data: [] };
    const status: CloudStatus = {
      enabled: Boolean(cloud),
      backend: cloud?.backend === "supabase" ? "supabase" : "codzer",
      apiKey: cloud?.api_key ?? "",
      supabaseUrl: cloud?.supabase_url ?? "",
      supabaseKey: cloud?.supabase_key ?? "",
      tables: await Promise.all(
        (tables ?? []).map(async (table) => ({
          name: table.name,
          columns: (Array.isArray(table.columns) ? table.columns : []) as CloudTableDef["columns"],
          read: table.read_access as CloudTableDef["read"],
          write: table.write_access as CloudTableDef["write"],
          rows: await count("cloud_rows", table.name),
        })),
      ),
      userCount: cloud ? await count("cloud_users") : 0,
      fileCount: cloud ? await count("cloud_files") : 0,
    };
    return { status, ...result };
  });
