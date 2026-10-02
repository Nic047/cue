import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  keyNames,
  shortcutBadges,
  type RecordedShortcut,
} from "./setup-options";

export function useShortcutRecorder({
  recordingShortcut,
  setRecordingShortcut,
  setShortcut,
  setError,
  preview,
}: {
  recordingShortcut: boolean;
  setRecordingShortcut: (recording: boolean) => void;
  setShortcut: (shortcut: string) => void;
  setError: (error: string) => void;
  preview: boolean;
}) {
  const [draftShortcut, setDraftShortcut] = useState<RecordedShortcut | null>(
    null,
  );
  const [shortcutReady, setShortcutReady] = useState(false);
  const draftRef = useRef<RecordedShortcut | null>(null);
  const readyRef = useRef(false);
  const recorderRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!recordingShortcut) return;
    let alive = true;
    let settle: number | undefined;
    draftRef.current = null;
    readyRef.current = false;
    setDraftShortcut(null);
    setShortcutReady(false);
    recorderRef.current?.focus();
    const update = (payload: RecordedShortcut | null) => {
      if (!alive) return;
      if (!payload) {
        setRecordingShortcut(false);
        return;
      }
      draftRef.current = payload;
      setDraftShortcut(payload);
      readyRef.current = false;
      setShortcutReady(false);
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        readyRef.current = true;
        setShortcutReady(true);
      }, 500);
    };
    const confirm = () => {
      if (!readyRef.current || !draftRef.current) return;
      const value = draftRef.current;
      setShortcut(
        JSON.stringify({
          ...value,
          label: shortcutBadges(value).join(
            value.keyCode === null ? " + " : "",
          ),
        }),
      );
      setRecordingShortcut(false);
    };
    const subscriptions: Promise<() => void>[] = [];
    if (!preview) {
      subscriptions.push(
        listen<RecordedShortcut | null>("shortcut-captured", ({ payload }) =>
          update(payload),
        ),
      );
      subscriptions.push(listen("shortcut-confirm", confirm));
      void Promise.all(subscriptions)
        .then(() => {
          if (alive) return invoke("capture_shortcut", { active: true });
        })
        .catch((e) => {
          setError(String(e));
          setRecordingShortcut(false);
        });
    }
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      if (!preview) return;
      if (event.key === "Escape") {
        setRecordingShortcut(false);
        return;
      }
      if (event.key === "Enter") {
        confirm();
        return;
      }
      if (event.repeat) return;
      const modifiers =
        (event.ctrlKey ? 0x40000 : 0) |
        (event.altKey ? 0x80000 : 0) |
        (event.shiftKey ? 0x20000 : 0) |
        (event.metaKey ? 0x100000 : 0);
      const names = (
        [
          [0x40000, "⌃"],
          [0x80000, "⌥"],
          [0x20000, "⇧"],
          [0x100000, "⌘"],
        ] as const
      )
        .filter(([mask]) => modifiers & mask)
        .map(([, label]) => label);
      if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) {
        update({
          keyCode: null,
          modifiers: 0,
          modifierMask:
            (event.ctrlKey ? 1 : 0) |
            (event.altKey ? 32 : 0) |
            (event.shiftKey ? 2 : 0) |
            (event.metaKey ? 8 : 0),
          label: names.join(" + "),
        });
      } else {
        const key = Object.entries(keyNames).find(
          ([, name]) => name === event.key.toUpperCase(),
        );
        if (key)
          update({
            keyCode: Number(key[0]),
            modifiers,
            modifierMask: 0,
            label: event.key.toUpperCase(),
          });
      }
    };
    window.addEventListener("keydown", onKey);
    const cancel = () => {
      if (!document.hasFocus()) setRecordingShortcut(false);
    };
    window.addEventListener("blur", cancel);
    return () => {
      alive = false;
      clearTimeout(settle);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", cancel);
      for (const subscription of subscriptions)
        void subscription.then((stop) => stop());
      if (!preview) void invoke("capture_shortcut", { active: false });
      document.getElementById("ob-shortcut-record")?.focus();
    };
  }, [recordingShortcut, preview, setRecordingShortcut, setShortcut, setError]);
  return { draftShortcut, shortcutReady, recorderRef };
}
