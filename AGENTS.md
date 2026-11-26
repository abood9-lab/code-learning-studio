<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Store edited workspace files in the existing owner-scoped projects/project_files tables, independently of chat artifacts, so manual edits survive reloads.
- Use shared workspace-tools for file path validation and browser ZIP downloads; never import credential files into generated workspaces.
- Keep starter projects as browser-native HTML/CSS/JS files compatible with the sandboxed iframe preview.
- Keep project secrets encrypted in a server-only table after checking project ownership; never include values in AI prompts, workspace files or previews.
- Keep signed Daytona toolbox capabilities server-only; commands run only in the caller's owned project sandbox.
- Parse streamed artifacts incrementally for the editor and commit only complete files to the preview, avoiding execution of unfinished JavaScript.
- Reach Daytona only through its connector gateway; run toolbox commands and uploads through a short-lived signed URL fetched per request, because the legacy toolbox API path no longer exists.
- Link each conversation to one project with the id `proj_<chatId>` so reopening a chat restores its saved files, keys and sandbox.
- Open generated apps in a sandboxed iframe everywhere (preview, full screen, new tab); never via a blob or same-origin URL, so generated scripts cannot read the signed-in session.
- Google sign-in uses the connected Supabase project's own OAuth provider, not the Lovable auth broker.
- Cloud Codzer stores every built app's tables as rows in the shared cloud_* tables of the connected Supabase (records are JSON), never as real per-app Postgres tables, so generated SQL can never touch platform data.
- Built apps reach Cloud Codzer only through the public `/api/public/cloud/$projectId` route, which checks the project key, the visitor session and the table's read/write rule before using the admin client; keep pure rules in `cloud-core.ts` so they stay testable.
- The preview's `codzer` client holds no credentials: it posts each call to the workbench page (`cloud-bridge.ts`), which adds the project key and visitor session, because the sandboxed frame has no origin or storage.
- The owner's Cloud panel uses the caller's own Supabase session (RLS on cloud_* tables), not the admin client, except for storage object removal after an ownership check.
- A project may use the owner's own Supabase instead; store only its URL and public key, refuse secret/service keys, and expose them to the app as `window.CODZER_SUPABASE`.
- Serve uploaded Cloud files with a sandbox CSP and as downloads unless they are media, so uploads cannot run as pages on this site's origin.
