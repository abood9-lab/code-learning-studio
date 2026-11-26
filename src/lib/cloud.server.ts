import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CLOUD_FILE_LIMIT_BYTES,
  cloudRequestSchema,
  matchesFilters,
  rowScope,
  sortRecords,
  stripSystemFields,
  type CloudAccess,
  type CloudRecord,
} from "@/lib/cloud-core";
import type { Json } from "@/integrations/supabase/types";

export const CLOUD_BUCKET = "codzer-cloud";
const SESSION_DAYS = 30;
const MAX_SCAN = 5000;
const MAX_FILES = 500;
const encoder = new TextEncoder();
const toBase64 = (bytes: Uint8Array) => {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(text);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
};

async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 },
    key,
    256,
  );
  return `pbkdf2$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}
async function verifyPassword(password: string, stored: string) {
  const salt = stored.split("$")[1];
  if (!salt) return false;
  return safeEqual(await hashPassword(password, fromBase64(salt)), stored);
}

async function sign(payload: string) {
  const secret = process.env["PROJECT_SECRET_ENCRYPTION_KEY"];
  if (!secret) throw new Error("Cloud sessions are not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`cloud-session:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}
async function createSession(projectId: string, userId: string) {
  const payload = `${projectId}|${userId}|${Date.now() + SESSION_DAYS * 86400000}`;
  return `${btoa(payload)}.${await sign(payload)}`;
}
async function readSession(projectId: string, token: string) {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  let payload = "";
  try {
    payload = atob(encoded);
  } catch {
    return null;
  }
  if (!safeEqual(await sign(payload), signature)) return null;
  const [project, userId, expires] = payload.split("|");
  if (project !== projectId || !userId || Number(expires) < Date.now()) return null;
  const { data } = await supabaseAdmin
    .from("cloud_users")
    .select("id,email")
    .eq("project_id", projectId)
    .eq("id", userId)
    .maybeSingle();
  return data;
}

interface StoredRow {
  id: string;
  data: Json;
  app_user_id: string | null;
  created_at: string;
  updated_at: string;
}
const toRecord = (row: StoredRow): CloudRecord => ({
  ...(row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}),
  id: row.id,
  user_id: row.app_user_id,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

async function loadRecords(projectId: string, table: string, ownerUserId: string | null) {
  const records: CloudRecord[] = [];
  for (let from = 0; from < MAX_SCAN; from += 1000) {
    let query = supabaseAdmin
      .from("cloud_rows")
      .select("id,data,app_user_id,created_at,updated_at")
      .eq("project_id", projectId)
      .eq("table_name", table);
    if (ownerUserId) query = query.eq("app_user_id", ownerUserId);
    const { data, error } = await query
      .order("created_at")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error("Could not read records");
    records.push(...data.map(toRecord));
    if (data.length < 1000) break;
  }
  return records;
}

export type CloudReply = { status: number; body: { data: unknown } | { error: string } };
const ok = (data: unknown): CloudReply => ({ status: 200, body: { data } });
const fail = (status: number, error: string): CloudReply => ({ status, body: { error } });

async function findProject(projectId: string, apiKey: string) {
  const { data } = await supabaseAdmin
    .from("cloud_projects")
    .select("project_id,owner_id,api_key,backend")
    .eq("project_id", projectId)
    .maybeSingle();
  return data && apiKey && safeEqual(data.api_key, apiKey) ? data : null;
}

export function cloudFileUrl(origin: string, projectId: string, path: string) {
  return `${origin}/api/public/cloud/${encodeURIComponent(projectId)}?file=${encodeURIComponent(path)}`;
}

/** Handles one request from a built app. The caller is identified by the project key and an optional visitor session. */
export async function handleCloudRequest(
  projectId: string,
  apiKey: string,
  sessionToken: string,
  raw: unknown,
  origin: string,
): Promise<CloudReply> {
  const project = await findProject(projectId, apiKey);
  if (!project) return fail(401, "Invalid project key");
  if (project.backend !== "codzer") return fail(409, "This project uses its own Supabase");
  const parsed = cloudRequestSchema.safeParse(raw);
  if (!parsed.success)
    return fail(400, `Invalid request: ${parsed.error.issues[0]?.message ?? "bad input"}`);
  const request = parsed.data;
  const user = sessionToken ? await readSession(projectId, sessionToken) : null;
  const userId = user?.id ?? null;
  const base = { project_id: projectId, owner_id: project.owner_id };

  if (request.op === "auth.user") return ok({ user });
  if (request.op === "auth.signUp") {
    const { data, error } = await supabaseAdmin
      .from("cloud_users")
      .insert({
        ...base,
        email: request.email,
        password_hash: await hashPassword(request.password),
      })
      .select("id,email")
      .single();
    if (error)
      return error.code === "23505"
        ? fail(409, "This email is already registered")
        : fail(500, "Could not create the account");
    return ok({ user: data, session: await createSession(projectId, data.id) });
  }
  if (request.op === "auth.signIn") {
    const { data } = await supabaseAdmin
      .from("cloud_users")
      .select("id,email,password_hash")
      .eq("project_id", projectId)
      .eq("email", request.email)
      .maybeSingle();
    if (!data || !(await verifyPassword(request.password, data.password_hash)))
      return fail(401, "Wrong email or password");
    return ok({
      user: { id: data.id, email: data.email },
      session: await createSession(projectId, data.id),
    });
  }

  if (request.op === "storage.list") {
    const { data, error } = await supabaseAdmin
      .from("cloud_files")
      .select("path,mime_type,size_bytes,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(MAX_FILES);
    if (error) return fail(500, "Could not list files");
    return ok(
      data.map((file) => ({
        path: file.path,
        contentType: file.mime_type,
        size: file.size_bytes,
        created_at: file.created_at,
        url: cloudFileUrl(origin, projectId, file.path),
      })),
    );
  }
  if (request.op === "storage.upload") {
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(request.data.replace(/^data:[^,]*,/, ""));
    } catch {
      return fail(400, "File data must be base64");
    }
    if (bytes.byteLength > CLOUD_FILE_LIMIT_BYTES) return fail(413, "Files can be at most 5 MB");
    const { count } = await supabaseAdmin
      .from("cloud_files")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    if ((count ?? 0) >= MAX_FILES) return fail(507, `A project can hold ${MAX_FILES} files`);
    const { error } = await supabaseAdmin.storage
      .from(CLOUD_BUCKET)
      .upload(`${projectId}/${request.path}`, bytes, {
        contentType: request.contentType,
        upsert: true,
      });
    if (error) return fail(500, "Could not store the file");
    const { error: recordError } = await supabaseAdmin.from("cloud_files").upsert(
      {
        ...base,
        path: request.path,
        mime_type: request.contentType,
        size_bytes: bytes.byteLength,
        app_user_id: userId,
      },
      { onConflict: "project_id,path" },
    );
    if (recordError) return fail(500, "Could not record the file");
    return ok({ path: request.path, url: cloudFileUrl(origin, projectId, request.path) });
  }
  if (request.op === "storage.url" || request.op === "storage.remove") {
    const { data: file } = await supabaseAdmin
      .from("cloud_files")
      .select("id,mime_type,app_user_id")
      .eq("project_id", projectId)
      .eq("path", request.path)
      .maybeSingle();
    if (!file) return fail(404, "File not found");
    const key = `${projectId}/${request.path}`;
    if (request.op === "storage.remove") {
      if (file.app_user_id && file.app_user_id !== userId)
        return fail(403, "Only the uploader can remove this file");
      await supabaseAdmin.storage.from(CLOUD_BUCKET).remove([key]);
      await supabaseAdmin.from("cloud_files").delete().eq("id", file.id);
      return ok({ path: request.path });
    }
    const { data: blob } = await supabaseAdmin.storage.from(CLOUD_BUCKET).download(key);
    if (!blob) return fail(404, "File not found");
    return ok({
      path: request.path,
      publicUrl: cloudFileUrl(origin, projectId, request.path),
      url: `data:${file.mime_type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`,
    });
  }

  const { data: table } = await supabaseAdmin
    .from("cloud_tables")
    .select("name,read_access,write_access")
    .eq("project_id", projectId)
    .eq("name", request.table)
    .maybeSingle();
  if (!table) return fail(404, `Table "${request.table}" does not exist`);
  const scope = rowScope(
    (request.op === "select" ? table.read_access : table.write_access) as CloudAccess,
    userId,
  );
  if (scope === "denied") return fail(401, "Sign in to use this table");
  const ownOnly = scope === "own" ? userId : null;

  if (request.op === "select") {
    let records = (await loadRecords(projectId, table.name, ownOnly)).filter((row) =>
      matchesFilters(row, request.filters),
    );
    if (request.order)
      records = sortRecords(records, request.order.column, request.order.ascending);
    return ok(records.slice(request.offset, request.offset + request.limit));
  }
  if (request.op === "insert") {
    const { data, error } = await supabaseAdmin
      .from("cloud_rows")
      .insert(
        request.rows.map((row) => ({
          ...base,
          table_name: table.name,
          app_user_id: userId,
          data: stripSystemFields(row) as Json,
        })),
      )
      .select("id,data,app_user_id,created_at,updated_at");
    if (error) return fail(400, "Could not save the record (it may be too large)");
    return ok(data.map(toRecord));
  }

  const targets = (await loadRecords(projectId, table.name, ownOnly))
    .filter((row) => matchesFilters(row, request.filters))
    .slice(0, 500);
  const ids = targets.map((row) => String(row["id"]));
  if (request.op === "delete") {
    for (let index = 0; index < ids.length; index += 100) {
      const { error } = await supabaseAdmin
        .from("cloud_rows")
        .delete()
        .eq("project_id", projectId)
        .in("id", ids.slice(index, index + 100));
      if (error) return fail(500, "Could not delete records");
    }
    return ok(targets);
  }
  const values = stripSystemFields(request.values);
  const updated: CloudRecord[] = [];
  for (let index = 0; index < targets.length; index += 20) {
    const results = await Promise.all(
      targets.slice(index, index + 20).map((row) =>
        supabaseAdmin
          .from("cloud_rows")
          .update({ data: { ...stripSystemFields(row), ...values } as Json })
          .eq("project_id", projectId)
          .eq("id", String(row["id"]))
          .select("id,data,app_user_id,created_at,updated_at")
          .single(),
      ),
    );
    for (const result of results) {
      if (result.error) return fail(400, "Could not update records");
      updated.push(toRecord(result.data));
    }
  }
  return ok(updated);
}

const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif)|video\/|audio\/|application\/pdf$)/;

/** Serves an uploaded file. Anything that could run as a page is sent as a download so it never executes on this site. */
export async function serveCloudFile(projectId: string, path: string): Promise<Response> {
  const { data: file } = await supabaseAdmin
    .from("cloud_files")
    .select("mime_type")
    .eq("project_id", projectId)
    .eq("path", path)
    .maybeSingle();
  const { data: blob } = file
    ? await supabaseAdmin.storage.from(CLOUD_BUCKET).download(`${projectId}/${path}`)
    : { data: null };
  if (!file || !blob) return new Response("Not found", { status: 404 });
  const inline = INLINE_TYPES.test(file.mime_type);
  return new Response(blob, {
    headers: {
      "Content-Type": inline ? file.mime_type : "application/octet-stream",
      "Content-Disposition": inline ? "inline" : "attachment",
      "Content-Security-Policy": "sandbox; default-src 'none'",
      "X-Content-Type-Options": "nosniff",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Cache-Control": "public, max-age=300",
    },
  });
}

/** Removes a file on behalf of the project owner, whose ownership the caller has already verified. */
export async function removeCloudFile(projectId: string, fileId: string, path: string) {
  await supabaseAdmin.storage.from(CLOUD_BUCKET).remove([`${projectId}/${path}`]);
  const { error } = await supabaseAdmin
    .from("cloud_files")
    .delete()
    .eq("project_id", projectId)
    .eq("id", fileId);
  if (error) throw new Error("Could not remove the file");
}
