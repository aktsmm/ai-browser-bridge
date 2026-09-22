import { normalizeDownloadRelativePath } from "./save-path";
import { isAssistantAnswer, type ChatMessage } from "./types";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatDateStamp(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTimeStamp(date: Date): string {
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function slugifyArtifactSegment(input: string): string {
  const normalized = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized || "untitled";
}

export function buildArtifactRelativePath(
  basePath: string,
  title: string,
  kind: "summary" | "blog-draft",
  createdAt = new Date(),
  saveId = "",
): string {
  const slug = slugifyArtifactSegment(title).slice(0, 80).replace(/-+$/, "");
  const datePart = formatDateStamp(createdAt);
  const timePart = formatTimeStamp(createdAt);
  const suffix = saveId
    ? `-${slugifyArtifactSegment(saveId).slice(0, 36)}`
    : "";
  return normalizeDownloadRelativePath(
    `${basePath}/${datePart}-${slug}-${kind}-${timePart}${suffix}.md`,
  );
}

interface ArtifactContentInput {
  pageTitle: string;
  pageUrl: string;
  assistantContent: string;
  createdAt: Date;
  incomplete?: boolean;
}

export function getAnswerArtifactInput(
  message: ChatMessage,
  createdAt = new Date(),
): ArtifactContentInput | null {
  if (!isAssistantAnswer(message)) return null;
  return {
    pageTitle: message.source?.pageTitle || "Untitled Page",
    pageUrl: message.source?.pageUrl || "",
    assistantContent: message.content.trim(),
    incomplete: message.incomplete === true,
    createdAt,
  };
}

export function buildSavedMarkdownContent({
  pageTitle,
  pageUrl,
  assistantContent,
  createdAt,
  incomplete,
}: ArtifactContentInput): string {
  return [
    `# ${pageTitle || "Untitled Page"}`,
    "",
    `- Saved At: ${createdAt.toISOString()}`,
    ...(incomplete
      ? ["- Response status: Partial (generation interrupted)"]
      : []),
    `- Source URL: ${pageUrl || "(unknown)"}`,
    "",
    "## Summary",
    "",
    assistantContent.trim() || "(empty assistant response)",
    "",
    "## Primary Source",
    "",
    `- ${pageUrl || "(unknown)"}`,
  ].join("\n");
}

export function buildBlogDraftContent({
  pageTitle,
  pageUrl,
  assistantContent,
  createdAt,
  incomplete,
}: ArtifactContentInput): string {
  return [
    `# Blog Draft: ${pageTitle || "Untitled Page"}`,
    "",
    `- Drafted At: ${createdAt.toISOString()}`,
    ...(incomplete
      ? ["- Response status: Partial (generation interrupted)"]
      : []),
    `- Source URL: ${pageUrl || "(unknown)"}`,
    "",
    "## Angle",
    "",
    "- What is the strongest user-facing takeaway?",
    "- Why does it matter now?",
    "- What should the reader do next?",
    "",
    "## Draft Notes",
    "",
    assistantContent.trim() || "(empty assistant response)",
    "",
    "## Primary Sources",
    "",
    `- ${pageTitle || "Source page"}`,
    `- ${pageUrl || "(unknown)"}`,
  ].join("\n");
}
