import React, { useCallback, useEffect, useRef, useState } from "react";
import "./index.css";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const mdComponents: Components = {
  // open links in a new tab; keep the arcanum styling
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

function Markdown({ children }: { children: string }) {
  return (
    <div className="chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

const WS_URL = "wss://arcanumchat-ankorn.amvera.io/ws";

const EXAMPLES = [
  "How is weapon damage calculated?",
  "Where do I find the Vendigroth device?",
  "Best tech build for a gunslinger?",
  "What does the Unofficial Arcanum Patch fix?",
];

type Role = "user" | "assistant";

interface ToolNote {
  id: string;
  content: string;
}

interface Message {
  id: string;
  role: Role;
  content: string;
  toolMessages?: ToolNote[];
  retry?: { attempt: number; max: number };
  streaming?: boolean;
  failed?: boolean;
}

type ServerEvent =
  | { type: "start"; question: string; thread_id: string }
  | { type: "tool_message"; content: string }
  | { type: "token"; content: string }
  | { type: "retry"; attempt: number; max: number }
  | { type: "error"; error: string }
  | { type: "done" }
  | { type: string };

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function ChatApp() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [streaming, setStreaming] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamMsgIdRef = useRef<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  /** Mark the currently streaming assistant message as finished. */
  const finalizeStream = useCallback((opts: { error?: string } = {}) => {
    const id = streamMsgIdRef.current;
    if (id) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          if (opts.error) {
            const text = m.content ? `${m.content}\n\n_${opts.error}_` : opts.error;
            return { ...m, content: text, streaming: false, failed: true };
          }
          return { ...m, streaming: false, retry: undefined };
        }),
      );
      streamMsgIdRef.current = null;
    }
    setStreaming(false);
  }, []);

  /** Route every server frame to the right place in the transcript. */
  const handleServerEvent = useCallback(
    (data: ServerEvent) => {
      switch (data.type) {
        case "start": {
          const tid = (data as { thread_id: string }).thread_id;
          threadIdRef.current = tid;
          setThreadId(tid);
          break;
        }

        case "tool_message": {
          const id = streamMsgIdRef.current;
          if (!id) break;
          const content = (data as { content: string }).content;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? {
                  ...m,
                  toolMessages: [
                    ...(m.toolMessages ?? []),
                    { id: uid(), content },
                  ],
                }
                : m,
            ),
          );
          break;
        }

        case "token": {
          const id = streamMsgIdRef.current;
          if (!id) break;
          const chunk = (data as { content: string }).content;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? { ...m, content: m.content + chunk, retry: undefined }
                : m,
            ),
          );
          break;
        }

        case "retry": {
          const id = streamMsgIdRef.current;
          if (!id) break;
          const { attempt, max } = data as { attempt: number; max: number };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, retry: { attempt, max } } : m,
            ),
          );
          break;
        }

        case "error": {
          const msg = (data as { error: string }).error;
          finalizeStream({ error: msg });
          break;
        }

        case "done": {
          finalizeStream();
          break;
        }

        default:
          // unknown event type — ignore
          break;
      }
    },
    [finalizeStream],
  );

  /** If the socket drops mid-stream, don't leave the bubble spinning. */
  const handleSocketClose = useCallback(() => {
    const id = streamMsgIdRef.current;
    if (id) {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const text = m.content || "connection lost — try again";
          return { ...m, content: text, streaming: false, failed: !m.content };
        }),
      );
      streamMsgIdRef.current = null;
    }
    setStreaming(false);
  }, []);

  // Connect once on mount, auto-reconnect on drop, clean up on unmount.
  useEffect(() => {
    let active = true;
    let reconnectTimer: number | null = null;
    let ws: WebSocket | null = null;

    const open = () => {
      if (!active) return;
      setStatus("connecting");
      ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (active) setStatus("open");
      };

      ws.onmessage = (event) => {
        if (!active) return;
        let data: ServerEvent;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        handleServerEvent(data);
      };

      ws.onclose = () => {
        if (!active) return;
        setStatus("closed");
        handleSocketClose();
        reconnectTimer = window.setTimeout(open, 2000);
      };

      // onerror is always followed by onclose, so nothing to do here.
      ws.onerror = () => { };
    };

    open();

    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      const socket = wsRef.current;
      if (socket) {
        socket.onclose = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.close();
      }
      wsRef.current = null;
    };
  }, [handleServerEvent, handleSocketClose]);

  const canSend =
    status === "open" && !streaming && input.trim().length > 0;

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming || status !== "open") return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const userMessage: Message = { id: uid(), role: "user", content: trimmed };
    const assistantId = uid();
    streamMsgIdRef.current = assistantId;

    setMessages((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        toolMessages: [],
        streaming: true,
      },
    ]);
    setStreaming(true);
    setInput("");

    // First turn: {"question": "..."}
    // Later turns: {"question": "...", "thread_id": "..."}
    const payload: Record<string, unknown> = { question: trimmed };
    if (threadIdRef.current) payload.thread_id = threadIdRef.current;

    ws.send(JSON.stringify(payload));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setThreadId(null);
    threadIdRef.current = null;
    streamMsgIdRef.current = null;
  };

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isEmpty = messages.length === 0;

  return (
    <>
      <div className="arcanum-container chat-shell">
        <header className="arcanum-header chat-header">
          <h1 className="arcanum-title">arcanumchat</h1>
          <p className="arcanum-desc">
            agent with cross-community search for{" "}
            <em>Arcanum: Of Steamworks and Magick Obscura</em>
          </p>
          <p className="arcanum-subdesc">
            quests, stats, patches, mods, bugs, formulas, calculators — answered
            with sources
          </p>
          <div className={`chat-conn ${status}`}>
            <span className="chat-conn-dot" aria-hidden="true" />
            <span>
              {status === "open"
                ? "connected"
                : status === "connecting"
                  ? "connecting…"
                  : "reconnecting…"}
            </span>
          </div>
        </header>

        <div className="chat-log" ref={logRef}>
          {isEmpty && (
            <div className="chat-empty">
              <p className="chat-empty-text">
                Ask anything about Arcanum. The agent searches wikis, forums and
                guides, then answers with the pages it used.
              </p>
              <div className="chat-examples">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="chat-chip"
                    onClick={() => send(example)}
                    disabled={status !== "open"}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <article
              key={message.id}
              className={`chat-msg ${message.role}${message.failed ? " failed" : ""
                }`}
            >
              <div className="chat-bubble">
                {message.toolMessages && message.toolMessages.length > 0 && (
                  <div className="chat-tools">
                    {message.toolMessages.map((tool) => (
                      <div key={tool.id} className="chat-tool">
                        <span className="chat-tool-mark" aria-hidden="true">
                          ✦
                        </span>
                        <span className="chat-tool-text" dangerouslySetInnerHTML={{ __html: tool.content }} />
                      </div>
                    ))}
                  </div>
                )}

                {message.content && (
                  <div className="chat-content">
                    {message.role === "assistant" ? (
                      <Markdown>{message.content}</Markdown>
                    ) : (
                      message.content
                    )}
                    {message.streaming && (
                      <span className="chat-cursor" aria-hidden="true" />
                    )}
                  </div>
                )}

                {!message.content && message.streaming && (
                  <div className="chat-typing">
                    <span className="chat-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="chat-typing-text">
                      {message.retry
                        ? `retrying… (${message.retry.attempt}/${message.retry.max})`
                        : message.toolMessages &&
                          message.toolMessages.length > 0
                          ? "thinking…"
                          : "searching…"}
                    </span>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              status === "open"
                ? "ask about quests, stats, patches, mods…"
                : "connecting…"
            }
            className="chat-input"
            aria-label="message"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="arcanum-button chat-send"
          >
            send
          </button>
        </form>
      </div>

      <footer className="arcanum-footer">
        <a
          href="https://github.com/ankorn/arcanumchat"
          target="_blank"
          rel="noopener noreferrer"
        >
          github
        </a>
        <span className="footer-sep">·</span>
        <a
          href="https://huggingface.co/pameydorke/arcanum-cross-platform-retriever"
          target="_blank"
          rel="noopener noreferrer"
        >
          huggingface
        </a>
        {messages.length > 0 && (
          <>
            <span className="footer-sep">·</span>
            <button
              type="button"
              className="chat-clear"
              onClick={clearChat}
            >
              clear chat
            </button>
          </>
        )}
      </footer>
    </>
  );
}

export default function App() {
  return <ChatApp />;
}