import { z } from "zod";

export const CLOUD_ACCESS = ["public", "authenticated", "owner"] as const;
export type CloudAccess = (typeof CLOUD_ACCESS)[number];
export const CLOUD_COLUMN_TYPES = ["text", "number", "boolean", "date", "json"] as const;
/** Fields every record carries; apps cannot overwrite them. */
export const CLOUD_SYSTEM_FIELDS = ["id", "user_id", "created_at", "updated_at"];
export const CLOUD_FILE_LIMIT_BYTES = 5 * 1024 * 1024;

const identifier = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
export const cloudTableSchema = z.object({
  name: identifier,
  columns: z
    .array(z.object({ name: identifier, type: z.enum(CLOUD_COLUMN_TYPES).default("text") }))
    .max(60)
    .default([]),
  read: z.enum(CLOUD_ACCESS).default("public"),
  write: z.enum(CLOUD_ACCESS).default("public"),
});
export type CloudTableDef = z.infer<typeof cloudTableSchema>;
const cloudSchemaSchema = z.object({ tables: z.array(cloudTableSchema).min(1).max(30) });

/** Reads the tables the AI asked for in a <cloudSchema> block. */
export function extractCloudSchema(text: string): CloudTableDef[] {
  const body = /<cloudSchema>([\s\S]*?)<\/cloudSchema>/.exec(text)?.[1];
  if (!body) return [];
  try {
    return cloudSchemaSchema.parse(JSON.parse(body)).tables;
  } catch {
    return [];
  }
}

const filterSchema = z.object({
  column: z.string().min(1).max(63),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "like", "in"]),
  value: z.unknown(),
});
export type CloudFilter = z.infer<typeof filterSchema>;
export type CloudRecord = Record<string, unknown>;

const filters = z.array(filterSchema).max(20);
const record = z.record(z.string().max(63), z.unknown());
const credentials = {
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(6).max(200),
};
export const cloudFilePath = z
  .string()
  .regex(/^[\w][\w.\-/ ]{0,200}$/)
  .refine((path) => !path.includes("..") && !path.includes("//"));

export const cloudRequestSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("select"),
    table: identifier,
    filters: filters.default([]),
    order: z
      .object({ column: z.string().max(63), ascending: z.boolean().default(true) })
      .optional(),
    limit: z.number().int().min(1).max(1000).default(1000),
    offset: z.number().int().min(0).max(100000).default(0),
  }),
  z.object({ op: z.literal("insert"), table: identifier, rows: z.array(record).min(1).max(100) }),
  z.object({ op: z.literal("update"), table: identifier, filters: filters.min(1), values: record }),
  z.object({ op: z.literal("delete"), table: identifier, filters: filters.min(1) }),
  z.object({ op: z.literal("auth.signUp"), ...credentials }),
  z.object({ op: z.literal("auth.signIn"), ...credentials }),
  z.object({ op: z.literal("auth.user") }),
  z.object({
    op: z.literal("storage.upload"),
    path: cloudFilePath,
    contentType: z.string().max(120).default("application/octet-stream"),
    data: z.string().max(Math.ceil(CLOUD_FILE_LIMIT_BYTES * 1.4)),
  }),
  z.object({ op: z.literal("storage.list") }),
  z.object({ op: z.literal("storage.url"), path: cloudFilePath }),
  z.object({ op: z.literal("storage.remove"), path: cloudFilePath }),
]);
export type CloudRequest = z.infer<typeof cloudRequestSchema>;

/** Which records a visitor may touch: all of them, only their own, or none. */
export function rowScope(access: CloudAccess, userId: string | null): "all" | "own" | "denied" {
  if (access === "public") return "all";
  if (!userId) return "denied";
  return access === "owner" ? "own" : "all";
}

const comparable = (value: unknown): number | string | null => {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") return value;
  return null;
};
function compare(a: unknown, b: unknown): number | null {
  const left = comparable(a);
  const right = comparable(b);
  if (left === null || right === null) return null;
  if (typeof left === "number" && typeof right === "number") return left - right;
  const [ln, rn] = [Number(left), Number(right)];
  if (left !== "" && right !== "" && !Number.isNaN(ln) && !Number.isNaN(rn)) return ln - rn;
  return String(left).localeCompare(String(right));
}
const same = (a: unknown, b: unknown) =>
  a === b || (a != null && b != null && typeof a !== "object" && String(a) === String(b));

export function matchesFilters(row: CloudRecord, list: CloudFilter[]): boolean {
  return list.every(({ column, op, value }) => {
    const actual = row[column] ?? null;
    if (op === "eq") return value == null ? actual == null : same(actual, value);
    if (op === "neq") return value == null ? actual != null : !same(actual, value);
    if (op === "in") return Array.isArray(value) && value.some((item) => same(actual, item));
    if (op === "like")
      return String(actual ?? "")
        .toLowerCase()
        .includes(
          String(value ?? "")
            .replace(/%/g, "")
            .toLowerCase(),
        );
    const result = compare(actual, value);
    if (result === null) return false;
    return op === "gt"
      ? result > 0
      : op === "gte"
        ? result >= 0
        : op === "lt"
          ? result < 0
          : result <= 0;
  });
}

export function sortRecords<T extends CloudRecord>(
  rows: T[],
  column: string,
  ascending: boolean,
): T[] {
  return [...rows].sort((a, b) => {
    const result =
      compare(a[column], b[column]) ?? (a[column] == null ? 1 : b[column] == null ? -1 : 0);
    return ascending ? result : -result;
  });
}

/** Drops the fields the platform manages so apps cannot forge ids, owners or dates. */
export function stripSystemFields(values: CloudRecord): CloudRecord {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !CLOUD_SYSTEM_FIELDS.includes(key)),
  );
}

/** A connected Supabase must use its public key; secret keys would leak into the built app. */
export function isPublicSupabaseKey(key: string): boolean {
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("sb_secret_")) return false;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      role?: string;
    };
    return claims.role === "anon";
  } catch {
    return false;
  }
}

export interface CloudStatus {
  enabled: boolean;
  backend: "codzer" | "supabase";
  apiKey: string;
  supabaseUrl: string;
  supabaseKey: string;
  tables: Array<CloudTableDef & { rows: number }>;
  userCount: number;
  fileCount: number;
}
