import { Trash2 } from "lucide-react";
import type { RecentChat } from "../lib/agent-state";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";

export function RecentChatsDialog({
  items,
  notchHeight,
  onOpen,
  onDelete,
  onClose,
}: {
  items: RecentChat[];
  notchHeight: number;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <main
      className="recent-chats-dialog"
      style={{
        width: "100%",
        height: "100%",
        padding: 0,
        background: "#101010",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <section
        aria-label="Recent chats"
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: `${18 + notchHeight}px 16px 12px`,
          background: "#101010",
          color: "#eee",
          fontFamily: "Geist, sans-serif",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <header
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600 }}>Recent chats</span>
          <button
            aria-label="Close recent chats"
            onClick={onClose}
            style={{
              border: 0,
              background: "transparent",
              color: "#888",
              fontSize: 18,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>
        {items.length ? (
          <div
            style={{
              display: "grid",
              gap: 3,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              alignContent: "start",
              overscrollBehavior: "contain",
            }}
          >
            {items.map((chat) => (
              <ContextMenu key={chat.id}>
                <ContextMenuTrigger asChild>
                  <button
                    onClick={() => {
                      onOpen(chat.id);
                    }}
                    className="recent-chat-item"
                    style={{
                      width: "100%",
                      border: 0,
                      borderRadius: 12,
                      padding: "10px 11px",
                      color: "inherit",
                      textAlign: "left",
                      cursor: "pointer",
                      display: "grid",
                      gap: 3,
                    }}
                  >
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      {chat.title}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        color: "#888",
                      }}
                    >
                      {chat.transcript || chat.answer}
                    </span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="recent-context-menu">
                  <ContextMenuItem
                    variant="destructive"
                    onSelect={() => {
                      onDelete(chat.id);
                    }}
                  >
                    <Trash2 size={14} />
                    Delete chat
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: "28px 8px",
              color: "#888",
              textAlign: "center",
              fontSize: 12,
            }}
          >
            No recent chats yet
          </div>
        )}
      </section>
    </main>
  );
}
