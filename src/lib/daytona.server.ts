const GATEWAY_URL = "https://connector-gateway.lovable.dev/udc_daytona";
const WORKSPACE_DIR = "/home/daytona/workspace";

const sandboxSchema = (value: unknown) => {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string") {
    throw new Error("Daytona returned an invalid sandbox");
  }
  return {
    id: value.id,
    state: "state" in value && typeof value.state === "string" ? value.state : "creating",
  };
};

export async function daytonaRequest(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const key = process.env["UDC_DAYTONA_API_KEY"];
  const gatewayKey = process.env["LOVABLE_API_KEY"];
  if (!key || !gatewayKey) throw new Error("Daytona is not connected to this app yet");
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${gatewayKey}`,
      "X-Connection-Api-Key": key,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Daytona request failed [${response.status}]: ${errorBody}`);
    if (/disk limit exceeded/i.test(errorBody)) {
      throw new Error(
        "Your Daytona account is out of storage. Delete or archive old sandboxes in Daytona, then connect again.",
      );
    }
    let message = errorBody.slice(0, 400);
    try {
      const parsed: unknown = JSON.parse(errorBody);
      if (
        parsed &&
        typeof parsed === "object" &&
        "message" in parsed &&
        typeof parsed.message === "string"
      )
        message = parsed.message;
    } catch {
      // keep raw text
    }
    throw new Error(`Daytona (${response.status}): ${message}`);
  }
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

export async function getSandbox(id: string) {
  return sandboxSchema(await daytonaRequest(`/sandbox/${encodeURIComponent(id)}`));
}

export async function createSandbox(projectId: string, userId: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return sandboxSchema(
    await daytonaRequest("/sandbox", "POST", {
      name: `whiterchat-${projectId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}-${suffix}`,
      public: false,
      autoStopInterval: 15,
      autoArchiveInterval: 60 * 24,
      labels: { "whiterchat-owner": userId, "whiterchat-project": projectId },
    }),
  );
}

// The signed toolbox URL is a short-lived server-only capability, never sent to the browser.
async function toolboxBase(id: string): Promise<URL> {
  const signed = await daytonaRequest(
    `/sandbox/${encodeURIComponent(id)}/ports/2280/signed-preview-url?expiresInSeconds=120`,
  );
  if (
    !signed ||
    typeof signed !== "object" ||
    !("url" in signed) ||
    typeof signed.url !== "string"
  ) {
    throw new Error("Daytona toolbox is unavailable");
  }
  const base = new URL(signed.url);
  if (
    base.protocol !== "https:" ||
    !/(?:^|\.)(?:daytona\.io|daytona\.works|daytonaproxy\d*\.net)$/.test(base.hostname)
  ) {
    throw new Error("Untrusted Daytona toolbox address");
  }
  return base;
}

async function toolboxPost(
  base: URL,
  path: string,
  body: BodyInit,
  contentType: string,
): Promise<unknown> {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "Content-Type": contentType, "X-Daytona-Skip-Preview-Warning": "true" },
    body,
  });
  if (!response.ok) {
    console.error(
      `Daytona toolbox failed [${response.status}]: ${(await response.text()).slice(0, 500)}`,
    );
    throw new Error(`Daytona toolbox (${response.status}) could not complete this operation`);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const toBase64 = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
const CWD_MARKER = "__WHITERCHAT_CWD__";

/** Runs one command in the sandbox and reports the directory it ended in, so `cd` persists between commands. */
export async function runCommand(
  id: string,
  command: string,
  cwd: string,
  envs: Record<string, string>,
) {
  const base = await toolboxBase(id);
  const script = [
    `mkdir -p ${shellQuote(WORKSPACE_DIR)}`,
    `cd ${shellQuote(cwd || WORKSPACE_DIR)} 2>/dev/null || cd ${shellQuote(WORKSPACE_DIR)}`,
    command,
    `__wc_status=$?`,
    `printf '\\n${CWD_MARKER}%s\\n' "$PWD"`,
    `exit $__wc_status`,
  ].join("\n");
  const raw = await toolboxPost(
    base,
    "/process/execute",
    JSON.stringify({
      command: `sh -c "echo ${toBase64(script)} | base64 -d | sh"`,
      envs,
      timeout: 50,
    }),
    "application/json",
  );
  if (!raw || typeof raw !== "object" || !("result" in raw) || typeof raw.result !== "string") {
    throw new Error("Daytona returned an unexpected command result");
  }
  const exitCode = "exitCode" in raw && typeof raw.exitCode === "number" ? raw.exitCode : 0;
  const markerAt = raw.result.lastIndexOf(`\n${CWD_MARKER}`);
  const output = markerAt >= 0 ? raw.result.slice(0, markerAt) : raw.result;
  const nextCwd = markerAt >= 0 ? raw.result.slice(markerAt + CWD_MARKER.length + 1).trim() : cwd;
  return { output, exitCode, cwd: nextCwd || WORKSPACE_DIR };
}

export async function uploadFiles(id: string, files: Array<{ path: string; content: string }>) {
  const base = await toolboxBase(id);
  for (const file of files) {
    await toolboxPost(
      base,
      `/files/upload-v2?path=${encodeURIComponent(`${WORKSPACE_DIR}/${file.path}`)}`,
      file.content,
      "application/octet-stream",
    );
  }
}

export { WORKSPACE_DIR };
