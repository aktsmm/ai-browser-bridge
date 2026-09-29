import React, { useState, useRef, useEffect } from "react";
import type { TaskOptions } from "../assistant-settings";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Options as RehypeSanitizeOptions } from "rehype-sanitize";
import type { ChatMessage } from "../types";
import { isAssistantAnswer } from "../types";
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
  type CustomPrompt,
  getPostPrompt,
  getSummarizeAndSavePrompt,
  getSummarizePrompt,
  type PostLength,
} from "../pending-action";
import { getDownloadShowId } from "../download-id";

type QuickAction = {
  kind?: "post";
  icon: string;
  label: string;
  prompt: string;
};

export function shouldSubmitChat(event: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

export const markdownSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), "download-show"],
  },
};

export function isAssistantAlertMessage(message: ChatMessage): boolean {
  return (
    message.role === "assistant" &&
    (message.kind === "error" || message.content.trim().startsWith("⚠️"))
  );
}

export function separateToolLogs(content: string): {
  answer: string;
  logs: string[];
} {
  const logs: string[] = [];
  const cleaned = content.replace(
    /__DOWNLOAD_FILE__:[^:]+:[A-Za-z0-9+/=]+:__END_DOWNLOAD__/g,
    "",
  );
  const answer = cleaned.replace(
    /\n*🔧 (?:ツール実行|Tool Execution): ([^\n]+)\n📋 (?:結果|Result): ([^\n]*(?:\n(?!🔧|\[Agent|##|\n\n)[^\n]*)*)\n*/g,
    (_, toolName, result) => {
      logs.push(`${toolName.trim()}: ${result.trim()}`);
      return "\n";
    },
  );
  return { answer: answer.trim(), logs };
}

export function getQuickActions(
  lang: Language,
  postLength: PostLength = "short",
): QuickAction[] {
  const lenLabel = postLength === "short" ? "140" : "500";
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
          icon: "🧹",
          label: "整える",
          prompt:
            "直前の回答を、内容は変えずに読みやすいMarkdownへ整えてください。見出し、箇条書き、出典URLが分かる形にし、保存や新しいブラウザ操作やページ遷移はしないでください。",
        },
        {
          icon: "🐦",
          label: `ポスト軽（${lenLabel}）`,
          kind: "post",
          prompt: getPostPrompt("ja", "casual", postLength),
        },
        {
          icon: "📝",
          label: `ポスト硬（${lenLabel}）`,
          kind: "post",
          prompt: getPostPrompt("ja", "formal", postLength),
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
          icon: "🧹",
          label: "Polish",
          prompt:
            "Polish the previous answer into readable Markdown without changing the substance. Add clear headings and bullets, and include the source URL when available. Do not save files. Do not navigate, click, or perform new browser actions.",
        },
        {
          icon: "🐦",
          label: `Post casual (${lenLabel})`,
          kind: "post",
          prompt: getPostPrompt("en", "casual", postLength),
        },
        {
          icon: "📝",
          label: `Post formal (${lenLabel})`,
          kind: "post",
          prompt: getPostPrompt("en", "formal", postLength),
        },
      ];
}

interface ChatProps {
  isSavingAnswer?: boolean;
  disabledReason?: string;
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (
    message: string,
    attachments?: ChatAttachment[],
    task?: TaskOptions,
  ) => void;
  postName?: string;
  onClearMessages: () => void;
  onStopGeneration: () => void;
  language: Language;
  customPrompts?: CustomPrompt[];
  onSaveMarkdown: (message: ChatMessage) => void | Promise<boolean>;
  onSaveBlogDraft: (message: ChatMessage) => void | Promise<boolean>;
}

export function appendPromptHistory(
  history: string[],
  prompt: string,
): string[] {
  const value = prompt.trim();
  return !value || history.at(-1) === value
    ? history
    : [...history, value].slice(-15);
}

export function stepPromptHistory(
  history: string[],
  index: number | null,
  draft: string,
  direction: "up" | "down",
): { index: number | null; value: string } | null {
  if (!history.length || (direction === "down" && index === null)) return null;
  const next =
    direction === "up"
      ? Math.max(0, (index ?? history.length) - 1)
      : index! + 1;
  return next === history.length
    ? { index: null, value: draft }
    : { index: next, value: history[next] };
}

export function isNearConversationEnd(metrics: {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= 48;
}

export function Chat({
  isSavingAnswer = false,
  disabledReason,
  messages,
  isLoading,
  onSendMessage,
  onClearMessages,
  onStopGeneration,
  language,
  customPrompts = [],
  postName = "Custom Post",
  onSaveMarkdown,
  onSaveBlogDraft,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [postLength, setPostLength] = useState<PostLength>("short");
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachment[]
  >([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const [readingAttachments, setReadingAttachments] = useState(false);
  const readingAttachmentsRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const [followingLatest, setFollowingLatest] = useState(true);
  const [saveFeedback, setSaveFeedback] = useState<{
    message: ChatMessage;
    success: boolean;
  } | null>(null);
  const saveInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const promptHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const draftBeforeHistoryRef = useRef("");
  const copiedTimerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);

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
    if (readingAttachmentsRef.current || isLoading) return;
    const nextFiles = Array.from(files);
    if (nextFiles.length === 0) {
      return;
    }

    if (pendingAttachments.length + nextFiles.length > MAX_ATTACHMENT_COUNT) {
      setAttachmentError(
        t("attachmentLimitReached", language).replace(
          "{count}",
          String(MAX_ATTACHMENT_COUNT),
        ),
      );
      return;
    }

    const loadedAttachments: ChatAttachment[] = [];
    const failures: string[] = [];
    readingAttachmentsRef.current = true;
    setReadingAttachments(true);
    setAttachmentError("");

    for (const file of nextFiles) {
      const classified = classifyAttachmentFile(file);
      if (!classified.ok) {
        failures.push(
          `${file.name}: ${
            classified.reason === "too-large"
              ? t("attachmentTooLarge", language)
              : t("attachmentUnsupported", language)
          }`,
        );
        continue;
      }

      try {
        if (classified.kind === "text") {
          const textContent = truncateAttachmentText(
            await readFileAsText(file),
          );
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
      } catch {
        failures.push(
          `${file.name}: ${language === "ja" ? "ファイルを読み込めませんでした" : "Could not read file"}`,
        );
      }
    }

    setPendingAttachments((prev) => [...prev, ...loadedAttachments]);
    setAttachmentError(failures.join("\n"));
    readingAttachmentsRef.current = false;
    setReadingAttachments(false);
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
    } catch {
      setAttachmentError(
        language === "ja"
          ? "コピーできませんでした。もう一度お試しください。"
          : "Copy failed. Please try again.",
      );
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
    if (
      messages.length === 0 ||
      messages[messages.length - 1].role === "user"
    ) {
      followLatestRef.current = true;
      setFollowingLatest(true);
    }
    const conversation = conversationRef.current;
    if (
      conversation &&
      conversation.clientHeight > 0 &&
      followLatestRef.current
    ) {
      conversation.scrollTop = conversation.scrollHeight;
    }
  }, [messages]);

  const followLatest = () => {
    followLatestRef.current = true;
    setFollowingLatest(true);
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  };

  const saveAnswer = async (
    message: ChatMessage,
    kind: "markdown" | "blog",
  ) => {
    if (saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setSaveFeedback(null);
    try {
      const result = await (kind === "markdown"
        ? onSaveMarkdown(message)
        : onSaveBlogDraft(message));
      if (typeof result === "boolean")
        setSaveFeedback({ message, success: result });
    } catch {
      setSaveFeedback({ message, success: false });
    } finally {
      saveInFlightRef.current = false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      input.trim() &&
      !isLoading &&
      !disabledReason &&
      !readingAttachmentsRef.current
    ) {
      followLatest();
      onSendMessage(input, pendingAttachments);
      promptHistoryRef.current = appendPromptHistory(
        promptHistoryRef.current,
        input,
      );
      historyIndexRef.current = null;
      draftBeforeHistoryRef.current = "";
      setInput("");
      setPendingAttachments([]);
      setAttachmentError("");
      inputRef.current?.focus();
    }
  };

  const handleClear = () => {
    followLatest();
    onClearMessages();
    promptHistoryRef.current = [];
    historyIndexRef.current = null;
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !e.nativeEvent.isComposing &&
      e.nativeEvent.keyCode !== 229 &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      if (
        e.key === "ArrowUp" &&
        historyIndexRef.current === null &&
        (e.currentTarget.selectionStart !== 0 ||
          e.currentTarget.selectionEnd !== 0 ||
          input.includes("\n"))
      )
        return;
      if (historyIndexRef.current === null)
        draftBeforeHistoryRef.current = input;
      const result = stepPromptHistory(
        promptHistoryRef.current,
        historyIndexRef.current,
        draftBeforeHistoryRef.current,
        e.key === "ArrowUp" ? "up" : "down",
      );
      if (result) {
        e.preventDefault();
        historyIndexRef.current = result.index;
        setInput(result.value);
        requestAnimationFrame(() =>
          inputRef.current?.setSelectionRange(
            result.index === null ? result.value.length : 0,
            result.index === null ? result.value.length : 0,
          ),
        );
        return;
      }
    }
    if (
      shouldSubmitChat({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
      })
    ) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleMarkdownLinkClick = async (href: string) => {
    const downloadId = getDownloadShowId(href);
    if (downloadId !== null) {
      chrome.runtime.sendMessage({ type: "show-download", downloadId });
      return;
    }
  };

  const hasDroppedFiles = (event: React.DragEvent) => {
    return Array.from(event.dataTransfer.types).includes("Files");
  };

  const handleDragEnter = (event: React.DragEvent) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!hasDroppedFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!hasDroppedFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    void addFiles(event.dataTransfer.files);
  };

  return (
    <div
      className="relative flex flex-col flex-1 min-h-0"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragActive && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/90 text-sm font-medium text-blue-900 shadow-inner">
          {t("dropFilesHere", language)}
        </div>
      )}
      {/* Messages Header with Clear Button */}
      {messages.length > 0 && (
        <div className="flex items-center justify-between px-4 pt-2 min-h-8 gap-2">
          <button
            type="button"
            onClick={followLatest}
            className={`text-xs text-blue-700 underline focus-visible:ring-2 focus-visible:ring-blue-500 ${followingLatest ? "invisible" : ""}`}
            tabIndex={followingLatest ? -1 : 0}
          >
            {language === "ja" ? "最新の応答へ" : "Jump to latest"}
          </button>
          <button
            onClick={handleClear}
            disabled={isLoading || isSavingAnswer}
            className="text-xs text-gray-500 hover:text-red-500 disabled:opacity-40 flex items-center gap-1"
            title={t("clear", language)}
            aria-label={t("clear", language)}
          >
            {t("clear", language)}
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={conversationRef}
        role="region"
        aria-label={language === "ja" ? "会話履歴" : "Conversation"}
        tabIndex={0}
        onScroll={(event) => {
          const nearEnd = isNearConversationEnd(event.currentTarget);
          followLatestRef.current = nearEnd;
          setFollowingLatest(nearEnd);
        }}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 focus-visible:outline-blue-500"
      >
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
                  disabled={Boolean(disabledReason)}
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

        {messages.map((message, index) => {
          const isAlertMessage = isAssistantAlertMessage(message);
          const { answer, logs } = separateToolLogs(message.content);
          const isExecutionResult =
            message.kind === "notice" &&
            /^🤖 \[Loop \d+\/\d+\]/.test(message.content);
          return (
            <div
              key={index}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                role={
                  isAlertMessage
                    ? "alert"
                    : message.kind === "notice"
                      ? "status"
                      : undefined
                }
                aria-live={
                  isAlertMessage || message.kind === "notice"
                    ? "polite"
                    : undefined
                }
                className={`max-w-[85%] p-3 rounded-lg relative group ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : message.kind === "error"
                      ? "bg-red-50 border border-red-200"
                      : message.kind === "notice"
                        ? "bg-amber-50 border border-amber-200"
                        : "bg-white border shadow-sm"
                }`}
              >
                {isAssistantAnswer(message) && (
                  <button
                    onClick={() => handleCopy(message.content, index)}
                    className="absolute top-1 right-1 opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500"
                    title={t("copy", language)}
                    aria-label={t("copy", language)}
                  >
                    {copiedIndex === index ? "✓" : "📋"}
                  </button>
                )}
                <div
                  className={`break-words ${isAssistantAnswer(message) ? "pt-5" : ""} ${message.role === "user" ? "whitespace-pre-wrap" : "markdown-body"}`}
                >
                  {message.incomplete && !isLoading && (
                    <div className="text-xs text-amber-800 mb-2">
                      {language === "ja"
                        ? "中断した部分回答"
                        : "Partial response"}
                    </div>
                  )}
                  {isExecutionResult ? (
                    <details>
                      <summary className="cursor-pointer">
                        {language === "ja" ? "操作の詳細" : "Action details"}
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-words">
                        {message.content}
                      </pre>
                    </details>
                  ) : message.role === "assistant" ? (
                    <>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[
                          [rehypeSanitize, markdownSanitizeSchema],
                        ]}
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
                                    e.stopPropagation();
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
                        {answer}
                      </ReactMarkdown>
                      {logs.length > 0 && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer">
                            {language === "ja" ? "実行ログ" : "Tool log"}
                          </summary>
                          <pre className="mt-1 whitespace-pre-wrap break-words">
                            {logs.join("\n\n")}
                          </pre>
                        </details>
                      )}
                    </>
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
                    isAssistantAnswer(message) &&
                    index === messages.length - 1 && (
                      <div className="mt-3 pt-2 border-t border-gray-200 flex flex-wrap gap-2">
                        <button
                          onClick={() =>
                            setPostLength((prev) =>
                              prev === "short" ? "long" : "short",
                            )
                          }
                          aria-pressed={postLength === "long"}
                          aria-label={
                            language === "ja"
                              ? `ポストの長さ: 現在${postLength === "short" ? "140字" : "500字"}。切り替え`
                              : `Post length: currently ${postLength === "short" ? "140" : "500"} chars. Toggle`
                          }
                          title={
                            language === "ja"
                              ? "ポストの長さを切り替え（140字 / 500字）"
                              : "Toggle post length (140 / 500 chars)"
                          }
                          className="text-xs px-2 py-1 rounded bg-blue-100 hover:bg-blue-200 text-blue-800"
                        >
                          <span className="mr-1">🔁</span>
                          {postLength === "short" ? "140" : "500"}
                        </button>
                        {getQuickActions(language, postLength).map((action) => (
                          <button
                            key={action.label}
                            disabled={Boolean(disabledReason)}
                            onClick={() =>
                              onSendMessage(
                                action.kind === "post"
                                  ? language === "ja"
                                    ? "現在のページについて投稿文を作成してください。"
                                    : "Draft a post about the current page."
                                  : action.prompt,
                                [],
                                action.kind
                                  ? {
                                      kind: action.kind,
                                      instructions: action.prompt,
                                    }
                                  : undefined,
                              )
                            }
                            className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
                          >
                            <span className="mr-1">{action.icon}</span>
                            {action.label}
                          </button>
                        ))}
                        {customPrompts
                          .filter(
                            (prompt) =>
                              prompt.name.trim() && prompt.body.trim(),
                          )
                          .map((prompt) => (
                            <button
                              key={prompt.id}
                              disabled={Boolean(disabledReason)}
                              onClick={() =>
                                onSendMessage(prompt.name, [], {
                                  kind: "custom",
                                  instructions: prompt.body,
                                })
                              }
                              className="text-xs px-2 py-1 rounded bg-purple-100 hover:bg-purple-200 text-purple-800"
                            >
                              <span className="mr-1">✨</span>
                              {prompt.name}
                            </button>
                          ))}
                      </div>
                    )}
                  {isAssistantAnswer(message) && (
                    <div
                      role="group"
                      aria-label={
                        language === "ja" ? "回答の保存" : "Save answer"
                      }
                      aria-busy={isSavingAnswer}
                      className="mt-2 pt-2 border-t flex flex-wrap gap-3 text-xs"
                    >
                      <button
                        type="button"
                        disabled={isLoading || isSavingAnswer}
                        onClick={() => void saveAnswer(message, "markdown")}
                        className="text-blue-700 underline disabled:opacity-40"
                      >
                        {t("saveMarkdownAction", language)}
                      </button>
                      <button
                        type="button"
                        disabled={isLoading || isSavingAnswer}
                        onClick={() => void saveAnswer(message, "blog")}
                        className="text-blue-700 underline disabled:opacity-40"
                      >
                        {t("saveBlogDraftAction", language)}
                      </button>
                    </div>
                  )}
                  {saveFeedback?.message === message && (
                    <div
                      role="status"
                      className={`mt-1 text-xs ${saveFeedback.success ? "text-green-700" : "text-red-700"}`}
                    >
                      {saveFeedback.success
                        ? language === "ja"
                          ? "保存しました"
                          : "Saved"
                        : language === "ja"
                          ? "保存できませんでした"
                          : "Save failed"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 bg-white border-t">
        {disabledReason && (
          <div role="status" className="mb-2 text-xs text-gray-600 break-words">
            {disabledReason}
          </div>
        )}
        {attachmentError && (
          <div
            role="alert"
            className="mb-2 text-sm text-red-700 whitespace-pre-wrap break-words"
          >
            {attachmentError}
          </div>
        )}
        {readingAttachments && (
          <div role="status" className="mb-2 text-xs text-gray-600">
            {language === "ja"
              ? "添付ファイルを読み込み中…"
              : "Reading attachments..."}
          </div>
        )}
        <button
          type="button"
          disabled={isLoading || Boolean(disabledReason) || readingAttachments}
          className="mb-2 text-sm text-blue-700 break-words disabled:opacity-40"
          onClick={() =>
            onSendMessage(
              language === "ja"
                ? "現在のページについて投稿文を作成してください。"
                : "Draft a post about the current page.",
              [],
              {
                kind: "post",
                instructions: getPostPrompt(language),
              },
            )
          }
        >
          {postName}
        </button>
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
                  <span className="min-w-0 break-all">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setPendingAttachments((prev) =>
                        prev.filter((item) => item.id !== attachment.id),
                      )
                    }
                    className="text-gray-400 hover:text-red-500"
                    aria-label={`${t("removeAttachment", language)}: ${attachment.name}`}
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
          aria-label={t("attachFiles", language)}
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
            disabled={isLoading || readingAttachments}
            className="px-3 py-2 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            title={t("dropFilesHere", language)}
            aria-label={t("attachFiles", language)}
          >
            {t("attachFiles", language)}
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              historyIndexRef.current = null;
              setInput(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t("inputPlaceholder", language)}
            aria-label={t("inputPlaceholder", language)}
            rows={1}
            className="flex-1 min-w-0 p-2 border rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={onStopGeneration}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
              title={t("stop", language)}
              aria-label={t("stop", language)}
            >
              {t("stop", language)}
            </button>
          ) : (
            <button
              type="submit"
              disabled={
                !input.trim() || Boolean(disabledReason) || readingAttachments
              }
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              title={
                disabledReason ||
                (!input.trim()
                  ? t("inputPlaceholder", language)
                  : t("send", language))
              }
              aria-label={t("send", language)}
            >
              {t("send", language)}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
