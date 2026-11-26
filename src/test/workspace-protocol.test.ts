import { describe, expect, it } from "vitest";
import { buildPreviewHtml } from "@/lib/artifact-parser";
import {
  extractSecretRequests,
  streamedFiles,
  visibleAssistantText,
} from "@/lib/workspace-protocol";

const half =
  '<boltArtifact id="a" title="T"><boltAction type="file" filePath="index.html"><h1>Hi</h1></boltAction><boltAction type="file" filePath="app.js">alert(1)</boltAc';

describe("Live code stream", () => {
  it("shows the unfinished file in the editor without its half-typed closing tag", () => {
    expect(streamedFiles(half)["app.js"]?.content).toBe("alert(1)");
  });
  it("sends only finished files to the preview", () => {
    expect(Object.keys(streamedFiles(half, true))).toEqual(["index.html"]);
  });
  it("never writes credential files from the AI into the workspace", () => {
    const text =
      '<boltArtifact id="a" title="T"><boltAction type="file" filePath=".env">KEY=1</boltAction></boltArtifact>';
    expect(streamedFiles(text)).toEqual({});
  });
});

describe("Project key requests", () => {
  const reply =
    'Done <secretRequest>{"secrets":[{"name":"STRIPE_SECRET_KEY","reason":"Payments"}]}</secretRequest>';
  it("reads the requested key names", () => {
    expect(extractSecretRequests(reply).map((secret) => secret.name)).toEqual([
      "STRIPE_SECRET_KEY",
    ]);
  });
  it("hides the request block from the chat text", () => {
    expect(visibleAssistantText(reply).trim()).toBe("Done");
  });
  it("rejects key names that are not environment-style", () => {
    expect(
      extractSecretRequests(
        '<secretRequest>{"secrets":[{"name":"my key","reason":"x"}]}</secretRequest>',
      ),
    ).toEqual([]);
  });
});

describe("Preview", () => {
  it("inlines linked files so the preview runs without a server", () => {
    const html = buildPreviewHtml({
      "index.html": {
        path: "index.html",
        language: "html",
        content:
          '<html><head><link rel="stylesheet" href="styles.css"></head><body><script src="./app.js"></script></body></html>',
      },
      "styles.css": { path: "styles.css", language: "css", content: "body{color:red}" },
      "app.js": { path: "app.js", language: "javascript", content: "window.ready=true" },
    });
    expect(html).toContain("body{color:red}");
    expect(html).toContain("window.ready=true");
    expect(html).not.toContain('src="./app.js"');
  });
});
