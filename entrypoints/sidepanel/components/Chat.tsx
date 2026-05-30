import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { ChatMessage } from "../types";
import type { Language } from "../i18n";
import { t } from "../i18n";
import {
  buildAttachmentDisplayText,
  classifyAttachmentFile,
  MAX_ATTACHMENT_COUNT,
  truncateAttachmentText,
  type ChatAttachment,
} from "../attachments";
import {
  getSummarizeAndSavePrompt,
  getSummarizePrompt,
} from "../pending-action";

type QuickAction = {
  icon: string;
  label: string;
  prompt: string;
};

// Collapse tool execution logs into compact markdown blocks
function collapseToolLogs(content: string): string {
  // Remove download markers (already processed by App.tsx)
  let cleaned = content.replace(
    /__DOWNLOAD_FILE__:[^:]+:[A-Za-z0-9+/=]+:__END_DOWNLOAD__/g,
    "",
  );

  // Pattern: 🔧 ツール実行|Tool Execution: {name}\n📋 結果|Result: {result}
  cleaned = cleaned.replace(
    /\n*🔧 (?:ツール実行|Tool Execution): ([^\n]+)\n📋 (?:結果|Result): ([^\n]*(?:\n(?!🔧|\[Agent|##|\n\n)[^\n]*)*)\n*/g,
    (_, toolName, result) => {
      const escapedResult = result
        .trim()
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `\n#### 🔧 ${toolName.trim()}\n\n\`\`\`\n${escapedResult}\n\`\`\`\n\n`;
    },
  );

  return cleaned;
}

export function getQuickActions(lang: Language): QuickAction[] {
  return lang === "ja"
    ? [
        {
          icon: "➡️",
          label: "続けて",
          prompt:
            "直前の回答を、同じ前提・同じ出力形式のまま続けてください。新しいブラウザ操作やページ遷移はしないでください。",
        },
        {
          icon: "🔑",
          label: "要点",
          prompt:
            "抽出済み本文だけを根拠に、重要な要点を5件まで箇条書きで整理してください。各項目は1文で、根拠になる本文の表現を短く含めてください。新しいブラウザ操作やページ遷移はしないでください。",
        },
        {
          icon: "✅",
          label: "次どうする？",
          prompt:
            "このページ内容を踏まえ、次に取るべき行動を3つ提案してください。各提案は「目的」「理由」「最初の一手」を1行ずつで簡潔に書いてください。新しいブラウザ操作やページ遷移はしないでください。",
        },
        {
          icon: "💾",
          label: "MD保存",
          prompt:
            "直前の回答をMarkdownとして保存してください。見出し、箇条書き、出典URLが分かる形に整え、本文を新たに作り直さないでください。新しいブラウザ操作やページ遷移はしないでください。",
        },
      ]
    : [
        {
          icon: "➡️",
          label: "Continue",
          prompt:
            "Continue the previous answer with the same assumptions and output format. Do not navigate, click, or perform new browser actions.",
        },
        {
          icon: "🔑",
          label: "Key points",
          prompt:
            "Using only the extracted page text, list up to five key points. Keep each point to one sentence and include a short phrase from the source text when useful. Do not navigate, click, or perform new browser actions.",
        },
        {
          icon: "✅",
          label: "Next steps",
          prompt:
            "Based on this page, suggest three next steps. For each step, include the goal, why it matters, and the first action. Do not navigate, click, or perform new browser actions.",
        },
        {
          icon: "💾",
          label: "Save as MD",
          prompt:
            "Save the previous answer as Markdown. Preserve the substance, add clear headings and bullets, and include the source URL when available. Do not navigate, click, or perform new browser actions.",
        },
      ];
}

interface ChatProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (message: string, attachments?: ChatAttachment[]) => void;
  onClearMessages: () => void;
  onStopGeneration: () => void;
  language: Language;
  onSaveMarkdown: () => void;
  onSaveBlogDraft: () => void;
}

export function Chat({
  messages,
  isLoading,
  onSendMessage,
  onClearMessages,
  onStopGeneration,
  language,
  onSaveMarkdown,
  onSaveBlogDraft,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachment[]
  >([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const readFileAsText = async (file: File): Promise<string> => {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  };

  const readFileAsDataUrl = async (file: File): Promise<string> => {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  const addFiles = async (files: FileList | File[]) => {
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) {
      return;
    }

    if (pendingAttachments.length + nextFiles.length > MAX_ATTACHMENT_COUNT) {
      window.alert(
        t("attachmentLimitReached", language).replace(
          "{count}",
          String(MAX_ATTACHMENT_COUNT),
        ),
      );
      return;
    }

    const loadedAttachments: ChatAttachment[] = [];

    for (const file of nextFiles) {
      const classified = classifyAttachmentFile(file);
      if (!classified.ok) {
        window.alert(
          classified.reason === "too-large"
            ? t("attachmentTooLarge", language)
            : t("attachmentUnsupported", language),
        );
        continue;
      }

      if (classified.kind === "text") {
        const textContent = truncateAttachmentText(await readFileAsText(file));
        loadedAttachments.push({
          id: `${file.name}-${file.size}-${Date.now()}-${loadedAttachments.length}`,
          name: file.name,
          kind: "text",
          mimeType: file.type || "text/plain",
          size: file.size,
          textContent,
        });
        continue;
      }

      if (classified.kind === "image") {
        const dataUrl = await readFileAsDataUrl(file);
        loadedAttachments.push({
          id: `${file.name}-${file.size}-${Date.now()}-${loadedAttachments.length}`,
          name: file.name,
          kind: "image",
          mimeType: file.type || "image/png",
          size: file.size,
          dataUrl,
        });
        continue;
      }

      loadedAttachments.push({
        id: `${file.name}-${file.size}-${Date.now()}-${loadedAttachments.length}`,
        name: file.name,
        kind: "pdf",
        mimeType: file.type || "application/pdf",
        size: file.size,
        note: t("pdfAttachmentFallback", language),
      });
    }

    setPendingAttachments((prev) => [...prev, ...loadedAttachments]);
  };

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedIndex(null);
        copiedTimerRef.current = null;
      }, 2000);
    } catch (error) {
      console.error("Failed to copy message", error);
    }
  };

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input, pendingAttachments);
      setInput("");
      setPendingAttachments([]);
      inputRef.current?.focus();
    }
  };

  const handleClear = () => {
    onClearMessages();
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleMarkdownLinkClick = async (href: string) => {
    if (href.startsWith("download-show:")) {
      const idStr = href.slice("download-show:".length);
      const downloadId = Number.parseInt(idStr, 10);
      if (!Number.isFinite(downloadId)) return;
      chrome.runtime.sendMessage({ type: "show-download", downloadId });
      return;
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Messages Header with Clear Button */}
      {messages.length > 0 && (
        <div className="flex justify-end px-4 pt-2">
          <button
            onClick={handleClear}
            className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1"
            title={t("clear", language)}
          >
            {t("clear", language)}
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="mt-6 px-2">
            <p className="text-2xl text-center mb-1">
              {t("welcome", language)}
            </p>
            <p className="text-center text-gray-500 text-sm mb-4">
              {t("welcomeMessage", language)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(language === "ja"
                ? [
                    {
                      icon: "📝",
                      label: "要約して",
                      prompt: getSummarizePrompt("ja"),
                    },
                    {
                      icon: "🔑",
                      label: "要点を抽出",
                      prompt:
                        "抽出済み本文だけを根拠に、このページの要点を5件まで箇条書きで整理してください。各項目は1文で、重要な人物・組織・数値があれば含めてください。ブラウザ操作やページ遷移はしないでください。",
                    },
                    {
                      icon: "🌐",
                      label: "英語に翻訳",
                      prompt:
                        "抽出済み本文だけを根拠に、このページの主要内容を自然な英語に翻訳してください。広告・ナビゲーション・重複文は省き、見出しと箇条書きで読みやすくしてください。",
                    },
                    {
                      icon: "🔗",
                      label: "リンク一覧",
                      prompt:
                        "抽出済みページ情報からリンク一覧を作ってください。リンク先タイトルまたは周辺テキスト、URL、用途の推定を表で整理し、不明なものは不明と書いてください。新しいページへ遷移しないでください。",
                    },
                    {
                      icon: "❓",
                      label: "Q&A作成",
                      prompt:
                        "抽出済み本文だけを根拠に、理解確認用のQ&Aを5件作ってください。各Q&Aは「質問」「回答」「根拠になる本文の要約」を含め、推測で断定しないでください。",
                    },
                    {
                      icon: "💾",
                      label: "MDで保存",
                      prompt: getSummarizeAndSavePrompt("ja"),
                    },
                  ]
                : [
                    {
                      icon: "📝",
                      label: "Summarize",
                      prompt: getSummarizePrompt("en"),
                    },
                    {
                      icon: "🔑",
                      label: "Key Points",
                      prompt:
                        "Using only the extracted page text, list up to five key points. Keep each point to one sentence and include important people, organizations, or numbers when present. Do not navigate or click.",
                    },
                    {
                      icon: "🌐",
                      label: "Translate to JP",
                      prompt:
                        "Translate the main content of the extracted page text into natural Japanese. Omit ads, navigation, and repeated boilerplate. Use headings and bullets for readability.",
                    },
                    {
                      icon: "🔗",
                      label: "Extract Links",
                      prompt:
                        "Extract a link list from the page context. For each link, include nearby title/text, URL, and likely purpose in a table. Do not navigate to new pages.",
                    },
                    {
                      icon: "❓",
                      label: "Generate Q&A",
                      prompt:
                        "Create five comprehension Q&A pairs using only the extracted page text. Include Question, Answer, and a short evidence summary. Do not assert unsupported facts.",
                    },
                    {
                      icon: "💾",
                      label: "Save as MD",
                      prompt: getSummarizeAndSavePrompt("en"),
                    },
                  ]
              ).map((card) => (
                <button
                  key={card.label}
                  onClick={() => onSendMessage(card.prompt)}
                  className="flex items-center gap-2 p-3 rounded-lg border border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-300 transition-all text-left text-sm shadow-sm"
                >
                  <span className="text-lg">{card.icon}</span>
                  <span className="text-gray-700 font-medium">
                    {card.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] p-3 rounded-lg relative group ${
                message.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-white border shadow-sm"
              }`}
            >
              {message.role === "assistant" && (
                <button
                  onClick={() => handleCopy(message.content, index)}
                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600"
                  title={t("copy", language)}
                  aria-label={t("copy", language)}
                >
                  {copiedIndex === index ? "✓" : "📋"}
                </button>
              )}
              <div
                className={`break-words ${message.role === "user" ? "whitespace-pre-wrap" : "markdown-body"}`}
              >
                {message.role === "assistant" ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeSanitize]}
                    components={{
                      a: ({ href, children, ...props }) => {
                        const safeHref = href || "";
                        if (safeHref.startsWith("download-show:")) {
                          return (
                            <a
                              href={safeHref}
                              {...props}
                              onClick={(e) => {
                                e.preventDefault();
                                handleMarkdownLinkClick(safeHref);
                              }}
                            >
                              {children}
                            </a>
                          );
                        }
                        return (
                          <a
                            href={safeHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            {...props}
                          >
                            {children}
                          </a>
                        );
                      },
                    }}
                  >
                    {collapseToolLogs(message.content)}
                  </ReactMarkdown>
                ) : (
                  message.content
                )}
                {isLoading &&
                  index === messages.length - 1 &&
                  message.role === "assistant" && (
                    <span className="inline-block w-2 h-4 ml-1 bg-gray-400 animate-pulse" />
                  )}

                {/* Quick actions at end of latest assistant message */}
                {!isLoading &&
                  message.role === "assistant" &&
                  index === messages.length - 1 && (
                    <div className="mt-3 pt-2 border-t border-gray-200 flex flex-wrap gap-2">
                      {getQuickActions(language).map((action) => (
                        <button
                          key={action.label}
                          onClick={() => onSendMessage(action.prompt)}
                          className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                        >
                          <span className="mr-1">{action.icon}</span>
                          {action.label}
                        </button>
                      ))}
                      <button
                        onClick={onSaveMarkdown}
                        className="text-xs px-2 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-800"
                      >
                        💾 {t("saveMarkdownAction", language)}
                      </button>
                      <button
                        onClick={onSaveBlogDraft}
                        className="text-xs px-2 py-1 rounded bg-amber-100 hover:bg-amber-200 text-amber-800"
                      >
                        📝 {t("saveBlogDraftAction", language)}
                      </button>
                    </div>
                  )}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
        className="p-4 bg-white border-t"
      >
        {pendingAttachments.length > 0 && (
          <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3">
            <div className="mb-2 text-xs font-medium text-gray-600">
              {t("attachedFiles", language)}
            </div>
            <div className="flex flex-wrap gap-2">
              {pendingAttachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded bg-white px-2 py-1 text-xs text-gray-700 shadow-sm"
                >
                  <span>
                    {attachment.kind === "image"
                      ? "🖼️"
                      : attachment.kind === "pdf"
                        ? "📄"
                        : "📎"}
                  </span>
                  <span>{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAttachments((prev) =>
                        prev.filter((item) => item.id !== attachment.id),
                      )
                    }
                    className="text-gray-400 hover:text-red-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-gray-500">
              {buildAttachmentDisplayText(pendingAttachments, {
                heading: t("attachedFiles", language),
                pdfNote: t("pdfAttachmentFallback", language),
                textLabel: t("attachmentTextLabel", language),
                imageLabel: t("attachmentImageLabel", language),
              }).replace(/^\n\n/, "")}
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => {
            if (e.target.files) {
              void addFiles(e.target.files);
              e.target.value = "";
            }
          }}
          className="hidden"
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-2 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            title={t("dropFilesHere", language)}
          >
            {t("attachFiles", language)}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("inputPlaceholder", language)}
            aria-label={t("inputPlaceholder", language)}
            rows={1}
            className="flex-1 p-2 border rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={onStopGeneration}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              {t("stop", language)}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {t("send", language)}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
