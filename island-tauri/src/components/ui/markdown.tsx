import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Markdown-Anzeige fuer Results (Summary + Detail): GFM-Tabellen,
 * Listen, Code — kein rohes HTML (react-markdown rendert keins, XSS-safe).
 * Links oeffnen sicher in der Standard-App statt in der WebView.
 * Look kommt aus `.md-results` in index.css (Dark-Theme).
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md-results">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                if (!href) return;
                try {
                  const url = new URL(href);
                  if (["http:", "https:", "mailto:"].includes(url.protocol)) {
                    void openUrl(url.href).catch(() => {});
                  }
                } catch {
                  // Invalid or relative URLs are not opened externally.
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
