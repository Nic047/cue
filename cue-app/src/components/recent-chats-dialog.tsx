import { MessageSquare, Trash2, X } from "lucide-react";
import type { RecentChat } from "../lib/agent-state";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu";

export function RecentChatsDialog({ items, notchHeight, onOpen, onDelete, onClose }: {
  items: RecentChat[]; notchHeight: number; onOpen: (id: string) => void;
  onDelete: (id: string) => void; onClose: () => void;
}) {
  return <main className="recent-chats-dialog" style={{ paddingTop: 20 + notchHeight }}>
    <header className="recent-header">
      <div><span className="recent-eyebrow">YOUR WORKSPACE</span><h2>Recent chats</h2></div>
      <button className="recent-close" aria-label="Close recent chats" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="recent-list">
      {items.length ? items.map((chat) => <ContextMenu key={chat.id}>
        <ContextMenuTrigger asChild>
          <button className="recent-chat-item" onClick={() => onOpen(chat.id)}>
            <span className="recent-chat-icon"><MessageSquare size={15} strokeWidth={1.5} /></span>
            <span className="recent-chat-copy">
              <span className="recent-chat-title">{chat.title}</span>
              <span className="recent-chat-preview">{chat.transcript || chat.answer}</span>
            </span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="recent-context-menu">
          <ContextMenuItem variant="destructive" onSelect={() => onDelete(chat.id)}><Trash2 size={14} />Delete chat</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>) : <div className="recent-empty"><MessageSquare size={22} strokeWidth={1.3} /><p>Your next idea starts here.</p><span>Finished tasks will appear in this list.</span></div>}
    </div>
  </main>;
}
