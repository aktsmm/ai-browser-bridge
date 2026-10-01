import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptFilePath);
const chromeDirectory = path.resolve(scriptDirectory, "..");
const bridgeDirectory = path.resolve(chromeDirectory, "..");
const vscodeDirectory = path.resolve(bridgeDirectory, "vscode-extension");

async function readTextFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

export function readExportedNumericConstant(source, name) {
  const parsed = ts.createSourceFile(
    "limits.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  for (const statement of parsed.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const) ||
      !statement.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    )
      continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer &&
        ts.isNumericLiteral(declaration.initializer)
      )
        return Number(declaration.initializer.text.replace(/_/g, ""));
    }
  }
  return undefined;
}

async function main() {
  const failures = [];
  const probeName = "MAX_CHAT_MESSAGES";
  const parserChecks = [
    { source: "export const MAX_CHAT_MESSAGES = 2_00;", expected: 200 },
    { source: "// export const MAX_CHAT_MESSAGES = 200;", expected: undefined },
    { source: "const MAX_CHAT_MESSAGES = 200;", expected: undefined },
    { source: "export let MAX_CHAT_MESSAGES = 200;", expected: undefined },
    { source: "export const MAX_CHAT_MESSAGES = '200';", expected: undefined },
  ];
  if (
    parserChecks.some(
      (check) =>
        readExportedNumericConstant(check.source, probeName) !== check.expected,
    )
  )
    failures.push("Exported numeric contract parser self-check failed");

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
  const chromeTypesPath = path.join(
    chromeDirectory,
    "entrypoints",
    "sidepanel",
    "types.ts",
  );
  const chromeSettingsPath = path.join(
    chromeDirectory,
    "entrypoints",
    "sidepanel",
    "components",
    "Settings.tsx",
  );
  const chromeAutoProviderPath = path.join(
    chromeDirectory,
    "entrypoints",
    "sidepanel",
    "auto-provider.ts",
  );
  const vscodeLlmRouterPath = path.join(
    vscodeDirectory,
    "src",
    "llm-router.ts",
  );

  const chromePackage = JSON.parse(await readTextFile(chromePackagePath));
  const wxtConfigSource = await readTextFile(wxtConfigPath);
  const contentScriptSource = await readTextFile(contentScriptPath);
  const vscodeServerSource = await readTextFile(vscodeServerPath);
  const vscodeRequestGuardsSource = await readTextFile(vscodeRequestGuardsPath);
  const chromeTypesSource = await readTextFile(chromeTypesPath);
  const chromeSettingsSource = await readTextFile(chromeSettingsPath);
  const chromeAutoProviderSource = await readTextFile(chromeAutoProviderPath);
  const vscodeLlmRouterSource = await readTextFile(vscodeLlmRouterPath);
  const contextSource = await readTextFile(
    path.join(vscodeDirectory, "src", "chat-context.ts"),
  );
  const standaloneContextSource = await readTextFile(
    path.join(chromeDirectory, "standalone-bridge", "src", "chat-context.ts"),
  );
  if (
    !contextSource.trim() ||
    contextSource.replace(/\s+/g, "") !==
      standaloneContextSource.replace(/\s+/g, "")
  ) {
    failures.push(
      "VS Code and standalone chat-context contracts must stay identical",
    );
  }

  const expectedVersionFallback = `version: process.env.npm_package_version || "${chromePackage.version}"`;
  const standaloneServerSource = await readTextFile(
    path.join(chromeDirectory, "standalone-bridge", "src", "index.ts"),
  );
  for (const name of [
    "MAX_CHAT_MESSAGES",
    "MAX_CHAT_MESSAGE_LENGTH",
    "MAX_CHAT_HISTORY_LENGTH",
  ]) {
    const vscodeLimit = readExportedNumericConstant(
      vscodeRequestGuardsSource,
      name,
    );
    const standaloneLimit = readExportedNumericConstant(
      standaloneServerSource,
      name,
    );
    if (
      vscodeLimit === undefined ||
      standaloneLimit === undefined ||
      vscodeLimit !== standaloneLimit
    )
      failures.push(`VS Code and standalone must declare matching ${name}`);
  }
  if (!wxtConfigSource.includes(expectedVersionFallback)) {
    failures.push(
      `wxt.config.ts fallback version must match chrome package.json version ${chromePackage.version}`,
    );
  }

  if (
    wxtConfigSource.includes('"<all_urls>"') ||
    !wxtConfigSource.includes('"https://*/*"') ||
    !wxtConfigSource.includes('"http://*/*"')
  ) {
    failures.push(
      "wxt.config.ts must grant HTTP(S) page access without including protected schemes",
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

  const providerIds = [
    "auto",
    "copilot",
    "copilot-agent",
    "copilot-sdk",
    "copilot-cli",
    "lm-studio",
  ];
  for (const providerId of providerIds) {
    const literal = `"${providerId}"`;
    if (!chromeTypesSource.includes(literal)) {
      failures.push(`types.ts must include provider ${providerId}`);
    }
    if (!vscodeRequestGuardsSource.includes(literal)) {
      failures.push(`request-guards.ts must include provider ${providerId}`);
    }
  }

  const settingsProviders = ["auto", "copilot-agent", "lm-studio"];
  for (const providerId of settingsProviders) {
    if (!chromeSettingsSource.includes(`provider: "${providerId}"`)) {
      failures.push(`Settings.tsx must expose provider ${providerId}`);
    }
  }

  const textOrder = 'return ["vscode-lm", "copilot-cli"]';
  const agentOrder = textOrder;
  for (const [fileName, source] of [
    ["chrome auto-provider.ts", chromeAutoProviderSource],
    ["vscode llm-router.ts", vscodeLlmRouterSource],
  ]) {
    if (!source.includes(textOrder)) {
      failures.push(`${fileName} must keep Auto text order ${textOrder}`);
    }
    if (!source.includes(agentOrder)) {
      failures.push(`${fileName} must keep Auto agent order ${agentOrder}`);
    }
  }

  if (
    !vscodeLlmRouterSource.includes("userSelectable: false") ||
    !chromeSettingsSource.includes("SDK and CLI are shown in bridge status")
  ) {
    failures.push(
      "SDK/CLI must stay out of normal provider selection and remain diagnostics/fallback routes",
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
