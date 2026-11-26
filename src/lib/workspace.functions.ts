import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const projectInput = z.object({ projectId: z.string().min(1).max(150) });
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/);

export const sandboxAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    projectInput.extend({
      action: z.enum(["connect", "status", "stop", "execute", "sync"]),
      command: z.string().max(10000).optional(),
      cwd: z.string().max(1000).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("id,sandbox_id")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (error || !project) throw new Error("Project not found or access denied");

    const runtime = await import("@/lib/daytona.server");
    const cwd = data.cwd || runtime.WORKSPACE_DIR;
    const reply = (state: string, output = "", exitCode: number | null = null, nextCwd = cwd) => ({
      state,
      output,
      exitCode,
      cwd: nextCwd,
    });
    const saveState = (fields: { sandbox_id?: string | null; sandbox_status: string }) =>
      context.supabase
        .from("projects")
        .update(fields)
        .eq("id", project.id)
        .eq("owner_id", context.userId);

    let id = project.sandbox_id;
    let sandbox: { id: string; state: string } | null = null;

    if (id) {
      try {
        sandbox = await runtime.getSandbox(id);
      } catch (lookupError) {
        // The sandbox was deleted outside the app; forget it so a fresh one can be created.
        if (lookupError instanceof Error && /\(404\)/.test(lookupError.message)) {
          await saveState({ sandbox_id: null, sandbox_status: "none" });
          id = null;
        } else throw lookupError;
      }
    }

    if (data.action === "connect" && !id) {
      sandbox = await runtime.createSandbox(project.id, context.userId);
      id = sandbox.id;
      const { error: saveError } = await saveState({
        sandbox_id: id,
        sandbox_status: sandbox.state,
      });
      if (saveError) {
        await runtime.daytonaRequest(`/sandbox/${encodeURIComponent(id)}`, "DELETE");
        throw new Error("Could not attach sandbox to project");
      }
    }

    if (!id || !sandbox)
      return reply("none", data.action === "status" ? "" : "Connect a sandbox first");

    if (data.action === "connect" && ["stopped", "archived"].includes(sandbox.state)) {
      await runtime.daytonaRequest(`/sandbox/${encodeURIComponent(id)}/start`, "POST");
      sandbox = await runtime.getSandbox(id);
    }

    if (data.action === "stop") {
      await runtime.daytonaRequest(`/sandbox/${encodeURIComponent(id)}/stop`, "POST");
      await saveState({ sandbox_status: "stopping" });
      return reply("stopping", "Sandbox is stopping");
    }

    if (data.action === "sync" || data.action === "execute") {
      if (sandbox.state !== "started")
        throw new Error(`Sandbox is ${sandbox.state}; wait until it is ready`);

      if (data.action === "sync") {
        const { data: files, error: filesError } = await context.supabase
          .from("project_files")
          .select("relative_path,content")
          .eq("project_id", project.id)
          .eq("owner_id", context.userId);
        if (filesError) throw new Error("Could not read project files");
        const { normalizeFilePath } = await import("@/lib/workspace-tools");
        await runtime.uploadFiles(
          id,
          (files ?? []).map((file) => ({
            path: normalizeFilePath(file.relative_path),
            content: file.content,
          })),
        );
        return reply(
          sandbox.state,
          `Synced ${files?.length ?? 0} file(s) to ${runtime.WORKSPACE_DIR}`,
          0,
        );
      }

      if (!data.command?.trim()) throw new Error("Enter a command");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: secrets, error: secretError } = await supabaseAdmin
        .from("project_secrets")
        .select("name,encrypted_value")
        .eq("project_id", project.id)
        .eq("owner_id", context.userId);
      if (secretError) throw new Error("Could not load project keys");
      const { decryptProjectSecret } = await import("@/lib/project-secrets.server");
      const envs: Record<string, string> = {};
      for (const item of secrets ?? []) {
        envs[item.name] = await decryptProjectSecret(
          item.encrypted_value,
          `${context.userId}:${project.id}:${item.name}`,
        );
      }
      const result = await runtime.runCommand(id, data.command, cwd, envs);
      let output = result.output;
      for (const value of Object.values(envs))
        if (value.length >= 4) output = output.replaceAll(value, "[REDACTED]");
      return reply(sandbox.state, output.slice(0, 100000), result.exitCode, result.cwd);
    }

    await saveState({ sandbox_status: sandbox.state });
    return reply(sandbox.state);
  });

export const manageProjectSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    projectInput.extend({
      action: z.enum(["list", "save", "delete"]),
      name: secretName.optional(),
      value: z.string().min(1).max(16000).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: project } = await context.supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", context.userId)
      .maybeSingle();
    if (!project) throw new Error("Project not found or access denied");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.action === "save") {
      if (!data.name || !data.value) throw new Error("Key name and value are required");
      const { encryptProjectSecret } = await import("@/lib/project-secrets.server");
      const { error } = await supabaseAdmin.from("project_secrets").upsert({
        project_id: project.id,
        owner_id: context.userId,
        name: data.name,
        encrypted_value: await encryptProjectSecret(
          data.value,
          `${context.userId}:${project.id}:${data.name}`,
        ),
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error("Could not securely save key");
    } else if (data.action === "delete") {
      if (!data.name) throw new Error("Key name is required");
      const { error } = await supabaseAdmin
        .from("project_secrets")
        .delete()
        .eq("project_id", project.id)
        .eq("owner_id", context.userId)
        .eq("name", data.name);
      if (error) throw new Error("Could not remove key");
    }

    const { data: keys, error } = await supabaseAdmin
      .from("project_secrets")
      .select("name,updated_at")
      .eq("project_id", project.id)
      .eq("owner_id", context.userId)
      .order("name");
    if (error) throw new Error("Could not list project keys");
    return { keys: keys ?? [] };
  });
