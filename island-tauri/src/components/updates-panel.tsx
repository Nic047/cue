import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowDownToLine, Check, RefreshCw } from "lucide-react";
import { Markdown } from "./ui/markdown";
import "./updates-panel.css";

type Info = { currentVersion: string; version: string | null; notes: string | null };
export default function UpdatesPanel() {
  const [info, setInfo] = useState<Info | null>(null);
  const [state, setState] = useState<"checking" | "ready" | "installing" | "error">("checking");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const check = useCallback(async () => {
    setState("checking"); setError("");
    try { setInfo(await invoke<Info>("check_update")); setState("ready"); }
    catch { setError("Couldn’t check for updates. Check your connection and try again."); setState("error"); }
  }, []);
  useEffect(() => { void check(); }, [check]);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<{downloaded: number; total: number | null}>("update-progress", ({payload}) => {
      if (!disposed) setProgress(payload.total ? Math.min(100, Math.round(payload.downloaded / payload.total * 100)) : null);
    }).then(fn => { if (disposed) fn(); else stop = fn; });
    return () => { disposed = true; stop?.(); };
  }, []);
  async function install() {
    if (!info?.version) return;
    setState("installing"); setError("");
    try { await invoke("install_update", {version: info.version}); }
    catch (e) { setError(String(e)); setState("error"); }
  }
  const busy = state === "checking" || state === "installing";
  return <main className="updates-panel">
    <span className="updates-brand">cue.</span>
    <div className="updates-symbol">{info?.version ? <ArrowDownToLine size={22} /> : <Check size={22} />}</div>
    <h1>{state === "checking" ? "Checking for updates…" : state === "installing" ? "Getting your update." : info?.version ? "A little better, every release." : state === "error" ? "Let’s try that again." : "You’re up to date."}</h1>
    <p className="updates-description">{state === "installing" ? `cue will restart when it’s ready.${progress === null ? "" : ` ${progress}%`}` : info?.version ? `Version ${info.version} is ready. You’re using ${info.currentVersion}.` : info ? `You’re using cue ${info.currentVersion}.` : "Finding the latest version of cue."}</p>
    {info?.notes && <div className="updates-notes"><Markdown text={info.notes} /></div>}
    {error && <p className="updates-error" role="alert">{error}</p>}
    <button disabled={busy} onClick={() => void (info?.version && state !== "error" ? install() : check())}>
      <RefreshCw size={14} className={busy ? "updates-spinning" : ""} />{state === "installing" ? "Installing…" : state === "checking" ? "Checking…" : info?.version && state !== "error" ? "Update & restart" : "Check again"}
    </button>
  </main>;
}
