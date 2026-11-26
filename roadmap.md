# Whiterchat upgrade
- [x] Import project from GitHub and create database tables on the connected Supabase.
- [x] Connect Daytona, generate the project-key encryption secret, delete old stopped sandboxes.
- [x] Daytona terminal wired into the workbench (verified against a real sandbox).
- [x] Live streamed code in the editor while the AI writes.
- [x] Plan mode: questions sheet rising from the prompt box, then a polished plan card.
- [x] Project API keys modal when the AI requests secrets.
- [x] Professional preview (browser frame, devices, console, new tab, full screen).
- [x] Restyle landing, auth and workspace.
- [x] Verify the signed-in flow in the browser (done with a temporary account, removed afterwards).
- [ ] Google sign-in — blocked: user must enable the Google provider in their Supabase dashboard.
- [ ] Import legacy records — blocked: waiting for Firestore/Auth exports from the user.

# Cloud Codzer
- [x] Cloud Codzer backend: per-project tables, rows, app users, file storage (inside the connected Supabase).
- [x] Cloud tab in the workbench (tables, rows, users, files, access rules).
- [x] `codzer` client available to generated apps in the preview; AI defines tables automatically.
- [x] Let a user connect their own Supabase to a project instead of Cloud Codzer.
- [ ] Cloud Codzer in downloaded ZIP apps (today the `codzer` client works inside the workbench preview only).
- [ ] Server-side functions for built apps (private API calls with project keys from the app itself).
