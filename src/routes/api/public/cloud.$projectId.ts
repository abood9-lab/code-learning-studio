import { createFileRoute } from "@tanstack/react-router";

// Built apps run in a sandboxed frame without an origin, so the API must answer any origin; the project key is the credential.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Codzer-Key, X-Codzer-Session",
  "Access-Control-Max-Age": "86400",
};

export const Route = createFileRoute("/api/public/cloud/$projectId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request, params }) => {
        const path = new URL(request.url).searchParams.get("file") ?? "";
        const { cloudFilePath } = await import("@/lib/cloud-core");
        if (!cloudFilePath.safeParse(path).success)
          return new Response("Not found", { status: 404, headers: CORS });
        const { serveCloudFile } = await import("@/lib/cloud.server");
        return serveCloudFile(params.projectId, path);
      },
      POST: async ({ request, params }) => {
        const json = (body: unknown, status: number) =>
          Response.json(body, { status, headers: { ...CORS, "Cache-Control": "no-store" } });
        const text = await request.text();
        if (text.length > 8_000_000) return json({ error: "Request is too large" }, 413);
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return json({ error: "Body must be JSON" }, 400);
        }
        try {
          const { handleCloudRequest } = await import("@/lib/cloud.server");
          const reply = await handleCloudRequest(
            params.projectId,
            request.headers.get("x-codzer-key") ?? "",
            request.headers.get("x-codzer-session") ?? "",
            body,
            new URL(request.url).origin,
          );
          return json(reply.body, reply.status);
        } catch (error) {
          console.error("[cloud]", error);
          return json({ error: "Cloud request failed" }, 500);
        }
      },
    },
  },
});
