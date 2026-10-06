// App.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query";
import "./index.css";

const queryClient = new QueryClient();

const WS_URL = "wss://arcanumchat-ankorn.amvera.io/ws"

interface Message {
  id: string
  role: "user" | "assistant";
  content: string;
}

function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function ChatApp() {
  const [input, setInput] = useState("");

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);


  const messages: Message[] = []

  // keep the newest turn in view
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []); // messages, mutation.isPending

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // send(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      // send(input);
    }
  };


  const isEmpty = true
  const isPending = false
  const failureCount = 0


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
        </header>

        <div className="chat-log" ref={logRef}>
          {messages.map((message) => (
            <article
              key={message.id}
              className={`chat-msg ${message.role}`}
            >
              <div className="chat-bubble">
                {message.content}
              </div>
            </article>
          ))}

          {isPending && (
            <article className="chat-msg assistant">
              <div className="chat-bubble chat-typing">
                <span className="chat-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="chat-typing-text">
                  {failureCount > 0
                    ? "retrying…"
                    : "searching the archives…"}
                </span>
              </div>
            </article>
          )}
        </div>

        <form className="chat-composer" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="ask about quests, stats, patches, mods…"
            className="chat-input"
            aria-label="message"
          />
          <button
            type="submit"
            disabled={isPending || !input.trim()}
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
      </footer>
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChatApp />
    </QueryClientProvider>
  );
}