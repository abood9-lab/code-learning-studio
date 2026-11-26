import { describe, expect, it } from "vitest";
import {
  cloudRequestSchema,
  extractCloudSchema,
  isPublicSupabaseKey,
  matchesFilters,
  rowScope,
  sortRecords,
  stripSystemFields,
} from "@/lib/cloud-core";
import { buildPreviewHtml } from "@/lib/artifact-parser";
import { visibleAssistantText } from "@/lib/workspace-protocol";

const jwt = (role: string) => `x.${btoa(JSON.stringify({ role }))}.y`;

describe("Cloud Codzer access rules", () => {
  it("lets anyone use a public table", () => {
    expect(rowScope("public", null)).toBe("all");
  });
  it("blocks visitors who are not signed in from signed-in-only tables", () => {
    expect(rowScope("authenticated", null)).toBe("denied");
    expect(rowScope("authenticated", "u1")).toBe("all");
  });
  it("limits creator-only tables to the visitor's own records", () => {
    expect(rowScope("owner", "u1")).toBe("own");
    expect(rowScope("owner", null)).toBe("denied");
  });
  it("never lets an app forge a record's id, creator or dates", () => {
    expect(
      stripSystemFields({
        title: "a",
        id: "x",
        user_id: "someone",
        created_at: "t",
        updated_at: "t",
      }),
    ).toEqual({ title: "a" });
  });
  it("refuses to update or delete without a filter", () => {
    expect(
      cloudRequestSchema.safeParse({ op: "delete", table: "todos", filters: [] }).success,
    ).toBe(false);
    expect(
      cloudRequestSchema.safeParse({ op: "update", table: "todos", filters: [], values: {} })
        .success,
    ).toBe(false);
  });
  it("requires passwords of at least 6 characters", () => {
    const signUp = (password: string) =>
      cloudRequestSchema.safeParse({ op: "auth.signUp", email: "a@b.co", password }).success;
    expect(signUp("12345")).toBe(false);
    expect(signUp("123456")).toBe(true);
  });
  it("rejects file paths that climb out of the project folder", () => {
    expect(
      cloudRequestSchema.safeParse({ op: "storage.url", path: "../other/a.png" }).success,
    ).toBe(false);
  });
});

describe("Cloud Codzer queries", () => {
  const rows = [
    { id: "1", title: "Milk", price: 2, done: false },
    { id: "2", title: "Bread", price: 10, done: true },
  ];
  it("filters records", () => {
    const find = (column: string, op: "eq" | "gt" | "like" | "in", value: unknown) =>
      rows.filter((row) => matchesFilters(row, [{ column, op, value }])).map((row) => row.id);
    expect(find("done", "eq", true)).toEqual(["2"]);
    expect(find("price", "gt", 5)).toEqual(["2"]);
    expect(find("title", "like", "%mil%")).toEqual(["1"]);
    expect(find("id", "in", ["1", "2"])).toEqual(["1", "2"]);
  });
  it("sorts numbers by value, not as text", () => {
    expect(sortRecords(rows, "price", false).map((row) => row.id)).toEqual(["2", "1"]);
  });
});

describe("Cloud Codzer and the AI", () => {
  const reply =
    'Done <cloudSchema>{"tables":[{"name":"todos","columns":[{"name":"title","type":"text"}],"read":"owner","write":"owner"}]}</cloudSchema>';
  it("reads the tables the AI asks for, with their access rules", () => {
    expect(extractCloudSchema(reply)).toEqual([
      { name: "todos", columns: [{ name: "title", type: "text" }], read: "owner", write: "owner" },
    ]);
  });
  it("ignores tables with unsafe names", () => {
    expect(
      extractCloudSchema('<cloudSchema>{"tables":[{"name":"Drop Table"}]}</cloudSchema>'),
    ).toEqual([]);
  });
  it("hides the table block from the chat text", () => {
    expect(visibleAssistantText(reply).trim()).toBe("Done");
  });
  it("gives every previewed app the codzer client", () => {
    const html = buildPreviewHtml({
      "index.html": {
        path: "index.html",
        language: "html",
        content: "<html><head></head><body></body></html>",
      },
    });
    expect(html).toContain("window.codzer=");
  });
});

describe("Connecting your own Supabase", () => {
  it("accepts public keys only", () => {
    expect(isPublicSupabaseKey("sb_publishable_abc")).toBe(true);
    expect(isPublicSupabaseKey(jwt("anon"))).toBe(true);
    expect(isPublicSupabaseKey("sb_secret_abc")).toBe(false);
    expect(isPublicSupabaseKey(jwt("service_role"))).toBe(false);
  });
});
