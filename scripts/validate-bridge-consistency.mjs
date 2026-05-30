import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptFilePath);
const chromeDirectory = path.resolve(scriptDirectory, "..");
const bridgeDirectory = path.resolve(chromeDirectory, "..");
const vscodeDirectory = path.resolve(bridgeDirectory, "vscode-extension");

async function readTextFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

async function main() {
  const failures = [];

  const chromePackagePath = path.join(chromeDirectory, "package.json");
  const wxtConfigPath = path.join(chromeDirectory, "wxt.config.ts");
  const contentScriptPath = path.join(
    chromeDirectory,
    "entrypoints",
    "content.ts",
  );
  const vscodeServerPath = path.join(vscodeDirectory, "src", "server.ts");
  const vscodeRequestGuardsPath = path.join(
    vscodeDirectory,
    "src",
    "request-guards.ts",
  );

  const chromePackage = JSON.parse(await readTextFile(chromePackagePath));
  const wxtConfigSource = await readTextFile(wxtConfigPath);
  const contentScriptSource = await readTextFile(contentScriptPath);
  const vscodeServerSource = await readTextFile(vscodeServerPath);
  const vscodeRequestGuardsSource = await readTextFile(vscodeRequestGuardsPath);

  const expectedVersionFallback = `version: process.env.npm_package_version || "${chromePackage.version}"`;
  if (!wxtConfigSource.includes(expectedVersionFallback)) {
    failures.push(
      `wxt.config.ts fallback version must match chrome package.json version ${chromePackage.version}`,
    );
  }

  if (wxtConfigSource.includes('host_permissions: ["<all_urls>"]')) {
    failures.push(
      "wxt.config.ts must not request broad <all_urls> host permissions",
    );
  }

  if (!contentScriptSource.includes("slice(0, 50000)")) {
    failures.push(
      "content.ts must cap extracted page content at 50,000 characters",
    );
  }

  if (contentScriptSource.includes('matches: ["<all_urls>"]')) {
    failures.push(
      "content.ts must not register a static <all_urls> content script",
    );
  }

  if (
    !vscodeRequestGuardsSource.includes(
      "export const MAX_PAGE_CONTENT_LENGTH = 50_000;",
    )
  ) {
    failures.push(
      "request-guards.ts must declare MAX_PAGE_CONTENT_LENGTH = 50_000",
    );
  }

  if (
    !vscodeRequestGuardsSource.includes(
      "body.pageContent.length > maxPageContentLength",
    )
  ) {
    failures.push(
      "request-guards.ts must reject oversized pageContent requests",
    );
  }

  if (
    !vscodeServerSource.includes("return validateChatRequestBody(request);")
  ) {
    failures.push(
      "server.ts must delegate chat validation to request-guards.ts",
    );
  }

  // Regression guard: Chrome omits the Origin header when the extension fetches
  // a host it already has host_permissions for (the local bridge on localhost),
  // so the server must not hard-require an Origin header or the side panel
  // breaks with a 403. The trusted client header is the real authorization gate.
  if (vscodeServerSource.includes("Origin header is required")) {
    failures.push(
      "server.ts must not require an Origin header (Chrome omits it for host_permissions hosts); rely on the trusted client header instead",
    );
  }

  if (!vscodeServerSource.includes("evaluateBridgeRequestGate({")) {
    failures.push(
      "server.ts must authorize requests through evaluateBridgeRequestGate (trusted client header gate)",
    );
  }

  if (failures.length > 0) {
    console.error("validate:bridge failed");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("validate:bridge passed");
}

await main();
