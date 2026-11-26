export interface CloudConnection {
  projectId: string;
  apiKey: string;
}

const sessionKey = (projectId: string) => `codzer_cloud_session:${projectId}`;

/**
 * Answers Cloud calls from a sandboxed app frame. The frame never sees the project key or the visitor session;
 * this page keeps them and makes the request on the app's behalf.
 */
export async function answerCloudCall(
  frame: Window,
  connection: CloudConnection | null,
  call: unknown,
): Promise<void> {
  if (!call || typeof call !== "object" || !("id" in call) || !("body" in call)) return;
  const reply = (payload: { data?: unknown; error?: string }) =>
    frame.postMessage({ source: "codzer-cloud", id: call.id, ...payload }, "*");
  if (!connection?.apiKey)
    return reply({
      error: "Cloud Codzer is off for this project. Open the Cloud tab to turn it on.",
    });
  const body = call.body as { op?: string } | null;
  const key = sessionKey(connection.projectId);
  if (body?.op === "auth.signOut") {
    sessionStorage.removeItem(key);
    return reply({ data: {} });
  }
  try {
    const response = await fetch(`/api/public/cloud/${encodeURIComponent(connection.projectId)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Codzer-Key": connection.apiKey,
        "X-Codzer-Session": sessionStorage.getItem(key) ?? "",
      },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as { data?: unknown; error?: string };
    if (result.error) return reply({ error: result.error });
    const data = result.data;
    if (data && typeof data === "object" && "session" in data && typeof data.session === "string") {
      sessionStorage.setItem(key, data.session);
      const { session: _session, ...rest } = data;
      return reply({ data: rest });
    }
    reply({ data });
  } catch {
    reply({ error: "Cloud Codzer could not be reached" });
  }
}
