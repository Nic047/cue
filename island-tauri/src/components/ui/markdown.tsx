import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { invoke } from "@tauri-apps/api/core";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";

/** GFM result rendering without raw HTML. Validated links open outside the WebView. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md-results">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => /^cue-file:[a-zA-Z0-9._-]+$/.test(url) ? url : defaultUrlTransform(url)}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                if (!href) return;
                if (href.startsWith("cue-file:")) {
                  void invoke("open_export", { id: href.slice(9) }).catch(() => {});
                  return;
                }
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
