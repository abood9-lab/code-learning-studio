import type { ParsedArtifact, WorkspaceFile } from "@/lib/types";
import { CLOUD_SDK } from "@/lib/cloud-sdk";

export function inferLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    html: "html",
    css: "css",
    scss: "scss",
    json: "json",
    md: "markdown",
    py: "python",
    sql: "sql",
    sh: "bash",
  };
  return map[ext] ?? "text";
}

export function parseArtifactsFromText(content: string): {
  cleanMarkdown: string;
  artifacts: ParsedArtifact[];
} {
  const artifacts: ParsedArtifact[] = [];
  const artifactRegex = /<boltArtifact\b([^>]*)>([\s\S]*?)(?:<\/boltArtifact>|$)/g;
  let cleanMarkdown = content;

  let match: RegExpExecArray | null;
  while ((match = artifactRegex.exec(content)) !== null) {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const idMatch = /id="([^"]+)"/.exec(attrs);
    const titleMatch = /title="([^"]+)"/.exec(attrs);

    const files: WorkspaceFile[] = [];
    const commands: string[] = [];

    const actionRegex = /<boltAction\b([^>]*)>([\s\S]*?)(?:<\/boltAction>|$)/g;
    let actionMatch: RegExpExecArray | null;
    while ((actionMatch = actionRegex.exec(body)) !== null) {
      const actionAttrs = actionMatch[1] ?? "";
      const actionBody = (actionMatch[2] ?? "").replace(/^\n/, "");
      const typeMatch = /type="([^"]+)"/.exec(actionAttrs);
      const pathMatch = /filePath="([^"]+)"/.exec(actionAttrs);

      if (typeMatch?.[1] === "file" && pathMatch?.[1]) {
        const filePath = pathMatch[1].replace(/^\/+/, "");
        files.push({
          path: filePath,
          content: actionBody,
          language: inferLanguage(filePath),
        });
      } else if (typeMatch?.[1] === "shell" && actionBody.trim()) {
        commands.push(actionBody.trim());
      }
    }

    artifacts.push({
      id: idMatch?.[1] ?? `artifact-${artifacts.length + 1}`,
      title: titleMatch?.[1] ?? "Generated Project",
      files,
      commands,
    });
  }

  cleanMarkdown = cleanMarkdown
    .replace(artifactRegex, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanMarkdown, artifacts };
}

// Forwards console output and runtime errors from the sandboxed preview to the workbench console.
const PREVIEW_BRIDGE = `<script>(function(){var send=function(level,args){try{parent.postMessage({source:"whiterchat-preview",level:level,text:Array.prototype.map.call(args,function(a){if(typeof a==="string")return a;if(a instanceof Error)return a.message;try{return JSON.stringify(a)}catch(e){return String(a)}}).join(" ")},"*")}catch(e){}};["log","info","warn","error"].forEach(function(l){var o=console[l];console[l]=function(){send(l,arguments);o.apply(console,arguments)}});window.addEventListener("error",function(e){send("error",[e.message+(e.lineno?" (line "+e.lineno+")":"")])});window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled promise rejection: "+((e.reason&&e.reason.message)||e.reason)])});document.addEventListener("click",function(e){var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;if(!a)return;var h=a.getAttribute("href")||"";if(/^(#|javascript:)/i.test(h))return;e.preventDefault();if(/\\.html?([?#].*)?$/i.test(h)&&!/^[a-z]+:/i.test(h))parent.postMessage({source:"whiterchat-preview",navigate:h},"*")},true);})();</script>`;

const localKey = (ref: string) =>
  ref
    .trim()
    .replace(/^\.?\//, "")
    .replace(/[?#].*$/, "")
    .toLowerCase();
const safeScript = (code: string) => code.replace(/<\/script/gi, "<\\/script");
const safeStyle = (code: string) => code.replace(/<\/style/gi, "<\\/style");
const isBrowserScript = (path: string) =>
  /\.m?js$/i.test(path) &&
  !/(^|\/)(server|index\.server|vite\.config|tailwind\.config|postcss\.config|eslint\.config)\.m?js$/i.test(
    path,
  ) &&
  !/config/i.test(path) &&
  !/(^|\/)(api|server|functions|scripts)\//i.test(path);

export function listPreviewPages(files: Record<string, WorkspaceFile>): string[] {
  const pages = Object.keys(files).filter((path) => /\.html?$/i.test(path));
  return pages.sort((a, b) =>
    a.toLowerCase() === "index.html"
      ? -1
      : b.toLowerCase() === "index.html"
        ? 1
        : a.localeCompare(b),
  );
}

/** `headExtra` is trusted markup placed before the app's own scripts, e.g. a connected Supabase config. */
export function buildPreviewHtml(
  files: Record<string, WorkspaceFile>,
  page?: string,
  headExtra = "",
): string {
  const bridge = PREVIEW_BRIDGE + CLOUD_SDK + headExtra;
  const fileList = Object.values(files);
  if (fileList.length === 0) {
    return `<!doctype html><html><body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#64748b;background:#f8fafc;"><div>Ask Whiterchat to build an app and its live preview will render here.</div></body></html>`;
  }

  const byKey = new Map(fileList.map((file) => [file.path.toLowerCase(), file]));
  const pages = listPreviewPages(files);
  const htmlFile =
    (page ? byKey.get(localKey(page)) : undefined) ?? (pages[0] ? files[pages[0]] : undefined);
  const used = new Set<string>();

  if (htmlFile) {
    let html = htmlFile.content;
    html = html.replace(/<link\b[^>]*>/gi, (tag) => {
      if (!/rel=["']?stylesheet/i.test(tag)) return tag;
      const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
      const file = href ? byKey.get(localKey(href)) : undefined;
      if (!file) return tag;
      used.add(file.path);
      return `<style data-file="${file.path}">${safeStyle(file.content)}</style>`;
    });
    html = html.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
      const src = /src=["']([^"']+)["']/i.exec(attrs)?.[1];
      const file = src ? byKey.get(localKey(src)) : undefined;
      if (!file) return tag;
      used.add(file.path);
      const type = /type=["']module["']/i.test(attrs) ? ' type="module"' : "";
      return `<script${type} data-file="${file.path}">${safeScript(file.content)}</script>`;
    });

    const looseCss = fileList.filter((file) => /\.css$/i.test(file.path) && !used.has(file.path));
    const looseJs = used.size ? [] : fileList.filter((file) => isBrowserScript(file.path));
    if (looseCss.length) {
      const block = `<style>${safeStyle(looseCss.map((file) => file.content).join("\n"))}</style>`;
      html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${block}</head>`) : block + html;
    }
    if (looseJs.length) {
      const block = `<script>${safeScript(looseJs.map((file) => file.content).join("\n"))}</script>`;
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${block}</body>`) : html + block;
    }
    if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (head) => head + bridge);
    return bridge + html;
  }

  const cssContent = fileList
    .filter((file) => /\.css$/i.test(file.path))
    .map((file) => file.content)
    .join("\n");
  const jsContent = fileList
    .filter((file) => isBrowserScript(file.path))
    .map((file) => file.content)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${bridge}
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #ffffff; color: #0f172a; }
    ${safeStyle(cssContent)}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>${safeScript(jsContent)}</script>
</body>
</html>`;
}
