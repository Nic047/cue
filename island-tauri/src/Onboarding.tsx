import { ShortcutRecorder } from "./components/setup/shortcut-recorder";
import { useShortcutRecorder } from "./lib/use-shortcut-recorder";
import type { Status, Snapshot, KeyState } from "./components/setup/types";
import { FinishStep } from "./components/setup/finish-step";
import { DemoStep } from "./components/setup/demo-step";
import { CustomizeStep } from "./components/setup/customize-step";
import { KeysStep } from "./components/setup/keys-step";
import { MicrophoneStep } from "./components/setup/microphone-step";
import { PermissionsStep } from "./components/setup/permissions-step";
import { WelcomeStep } from "./components/setup/welcome-step";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import {
  ArrowRight,
  Check,
  Mic,
  Minus,
  SlidersHorizontal,
  KeyRound,
  Keyboard,
  ShieldCheck,
  X,
} from "lucide-react";
import { usePrefersReducedMotion } from "./lib/dotmatrix-hooks";
import { providers, shortcutText, type Provider } from "./lib/setup-options";
import "./onboarding.css";

const firstTask =
  "Find today’s top five products on Product Hunt, with a short description and a link for each. In parallel, run a Python script to calculate the sum of the numbers from 1 to 100.";
const preview =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).has("onboarding-preview");
const initial: Status = {
  complete: false,
  microphone: "not-determined",
  accessibility: false,
  hotkeyReady: false,
  solari: false,
  llm: false,
  groq: false,
};
const blank: KeyState = { value: "", state: "empty" };

export default function Onboarding() {
  const [settingsMode, setSettingsMode] = useState(
    new URLSearchParams(location.search).has("settings"),
  );
  const presentationRevision = useRef(0);
  const presentationPaused = useRef(false);
  const settingsWindow = useRef(
    new URLSearchParams(location.search).has("settings"),
  );
  const [saved, setSaved] = useState(false);
  const [keysOnly, setKeysOnly] = useState(
    new URLSearchParams(location.search).has("keys"),
  );
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(settingsMode ? 4 : keysOnly ? 3 : 0);
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState("");
  const [label, setLabel] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const [devices, setDevices] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const micPickerRef = useRef<HTMLDivElement>(null);
  const [micOpen, setMicOpen] = useState(false);
  const [shortcut, setShortcut] = useState("right-option");
  const [agentModel, setAgentModel] = useState("inception/mercury-2.5");
  const shortcutLabel = shortcutText(shortcut);
  const [recordingShortcut, setRecordingShortcut] = useState(false);
  const [openRevision, setOpenRevision] = useState(0);
  const { draftShortcut, shortcutReady, recorderRef } = useShortcutRecorder({
    recordingShortcut,
    setRecordingShortcut,
    setShortcut,
    setError,
    preview,
  });
  const [completing, setCompleting] = useState(false);
  const windowAnimation = useAnimationControls();
  useEffect(() => {
    windowAnimation.set(
      reducedMotion
        ? { opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" }
        : { opacity: 0, filter: "blur(10px)", transform: "translateY(18px)" },
    );
    void windowAnimation.start({
      opacity: 1,
      filter: "blur(0px)",
      transform: "translateY(0px)",
      transition: {
        duration: reducedMotion ? 0 : 0.65,
        ease: [0.23, 1, 0.32, 1],
      },
    });
  }, [openRevision, reducedMotion, windowAnimation]);
  useEffect(() => {
    setRecordingShortcut(false);
    setSaved(false);
  }, [step, paused]);
  useEffect(() => {
    setSaved(false);
  }, [shortcut, agentModel]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (preview || paused) return;
    let live = true;
    void invoke<{ shortcut: string; agentModel: string }>("get_customization")
      .then((value) => {
        if (!live) return;
        setShortcut(value.shortcut);
        setAgentModel(value.agentModel);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [paused, openRevision]);
  async function saveCustomization() {
    setSaving(true);
    setError("");
    try {
      if (!preview)
        await invoke("save_customization", { shortcut, agentModel });
      if (settingsMode) setSaved(true);
      else next();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState(false);
  const [flat, setFlat] = useState(false);
  const [keys, setKeys] = useState<Record<Provider, KeyState>>({
    solari: blank,
    llm: blank,
    groq: blank,
  });
  const revisions = useRef({ solari: 0, llm: 0, groq: 0 });
  const timers = useRef<Partial<Record<Provider, number>>>({});
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [peeked, setPeeked] = useState(false);
  const [tapped, setTapped] = useState(false);

  const [runError, setRunError] = useState("");
  const [starting, setStarting] = useState(false);
  const inspected = useRef(false);
  const hydratedMic = useRef(false);
  const lastPhase = useRef("");
  const [micRevision, setMicRevision] = useState(0);
  const wasBusy = useRef(false);
  const wasWorking = useRef(false);
  const done =
    snapshot?.phase === "done" &&
    !!snapshot.answer &&
    snapshot.tasks.some((t) => t.status === "done");
  const busy =
    starting ||
    ["arming", "listening", "transcribing", "working"].includes(
      snapshot?.phase ?? "",
    );
  const validKeys = providers.every((p) => keys[p.id].state === "valid");
  const lesson = done ? 3 : snapshot?.phase === "working" ? 2 : 1;

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!micPickerRef.current?.contains(event.target as Node)) {
        setMicOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  useEffect(() => {
    if (preview || paused) return;
    let live = true;
    const poll = () =>
      invoke<Status>("onboarding_status")
        .then((value) => {
          if (live) {
            setStatus(value);
            if (!hydratedMic.current) {
              hydratedMic.current = true;
              setSelected(value.selectedMicrophone ?? "");
            }
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    void poll();
    const focused = listen("setup-focus", () => {
      void poll();
    });
    const refreshOnFocus = () => {
      void poll();
    };
    window.addEventListener("focus", refreshOnFocus);
    // Poll only while a user can grant permissions outside this window.
    const timer = step === 1 ? window.setInterval(poll, 1500) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      void focused.then((unlisten) => unlisten());
    };
  }, [paused, step, openRevision]);

  useEffect(() => {
    if (paused || step !== 0 || reducedMotion) return;
    const timer = window.setInterval(
      () => setLabel((value) => (value + 1) % 4),
      2200,
    );
    return () => clearInterval(timer);
  }, [step, reducedMotion, paused]);

  useEffect(() => {
    if (paused || step !== 2 || preview) return;
    let live = true;
    const started = Date.now();
    setHeard(false);
    setLevel(0);
    setFlat(false);
    setError("");
    const poll = async () => {
      try {
        const meter = await invoke<{
          level: number;
          device: string;
          error: string | null;
        }>("microphone_level");
        if (!live) return;
        setLevel((previous) =>
          Math.max(Math.min(1, meter.level * 6), previous * 0.72),
        );
        if (meter.level >= 0.01) setHeard(true);
        if (meter.error) setError(meter.error);
        if (Date.now() - started > 3500) setFlat(true);
      } catch (e) {
        if (live) setError(String(e));
      }
    };
    void invoke<string[]>("audio_inputs")
      .then((value) => {
        if (live) setDevices(value);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    void invoke("start_mic_check")
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (!live) void invoke("stop_mic_check");
      });
    const timer = window.setInterval(poll, 100);
    return () => {
      live = false;
      clearInterval(timer);
      void invoke("stop_mic_check");
    };
  }, [step, selected, micRevision, paused]);

  async function validate(
    provider: Provider,
    value?: string,
    revision = revisions.current[provider],
  ) {
    setKeys((old) => ({
      ...old,
      [provider]: { ...old[provider], state: "checking", error: undefined },
    }));
    try {
      if (!preview) {
        await invoke("validate_credential", { provider, key: value ?? null });
        if (revision !== revisions.current[provider]) return;
        if (value) await invoke("save_credential", { provider, key: value });
      }
      if (revision === revisions.current[provider])
        setKeys((old) => ({
          ...old,
          [provider]: { value: "", state: "valid" },
        }));
    } catch (e) {
      if (revision === revisions.current[provider])
        setKeys((old) => ({
          ...old,
          [provider]: { ...old[provider], state: "error", error: String(e) },
        }));
    }
  }

  useEffect(() => {
    if (step !== 3) return;
    for (const provider of providers)
      if (status[provider.id] && keys[provider.id].state === "empty")
        void validate(provider.id);
    // Stored credentials are validated once on entry; typing has its own debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, status.solari, status.llm, status.groq]);

  useEffect(
    () => () => {
      Object.values(timers.current).forEach(clearTimeout);
    },
    [],
  );

  useEffect(() => {
    if (settingsMode || paused || step !== 5 || preview) return;
    let live = true;
    const unsubscribers: (() => void)[] = [];
    void (async () => {
      const unstate = await listen<Snapshot>(
        "onboarding-state",
        ({ payload }) => {
          if (!live || settingsWindow.current || presentationPaused.current)
            return;
          setSnapshot(payload);
          setStarting(false);
          if (["arming", "listening"].includes(payload.phase)) setTapped(true);
          if (
            payload.phase !== lastPhase.current &&
            ["arming", "working"].includes(payload.phase)
          )
            setRunError("");
          lastPhase.current = payload.phase;
          if (
            ["arming", "listening", "transcribing", "working"].includes(
              payload.phase,
            )
          )
            wasBusy.current = true;
          if (payload.phase === "working") wasWorking.current = true;
          if (payload.error)
            setRunError((previous) => previous || payload.error!);
          if (
            payload.phase === "done" &&
            !payload.tasks.some((t) => t.status === "done")
          )
            setRunError(
              "The first run didn't succeed. A site may have blocked the agent. Try again.",
            );
          if (payload.phase === "idle" && wasBusy.current)
            setRunError(
              (previous) =>
                previous ||
                (wasWorking.current
                  ? "The run stopped without a result. Try again."
                  : `Recording ended without a task. Tap ${shortcutLabel} to try again.`),
            );
          if (payload.question)
            setRunError(
              `Your agent needs an answer. Open the pill with ${shortcutLabel} to respond.`,
            );
          if (payload.detailOpen) {
            inspected.current = true;
            void getCurrentWindow().hide();
          }
          if (inspected.current && !payload.detailOpen) {
            inspected.current = false;
            void getCurrentWindow()
              .show()
              .then(() => getCurrentWindow().setFocus());
            setStep(6);
          }
        },
      );
      if (!live) {
        unstate();
        return;
      }
      unsubscribers.push(unstate);
      const unpeek = await listen("onboarding-peek", () => {
        if (live) setPeeked(true);
      });
      if (!live) {
        unpeek();
        return;
      }
      unsubscribers.push(unpeek);
      const unfailure = await listen<string>(
        "onboarding-failure",
        ({ payload }) => {
          if (live) setRunError(payload);
        },
      );
      if (!live) {
        unfailure();
        return;
      }
      unsubscribers.push(unfailure);
      if (!live || presentationPaused.current) return;
      await emitTo("main", "onboarding-watch", true);
      if (!live || presentationPaused.current) return;
      await invoke("set_onboarding_ready", { ready: true });
    })().catch((e) => {
      if (live) setError(String(e));
    });
    return () => {
      live = false;
      unsubscribers.forEach((fn) => fn());
    };
  }, [step, paused, shortcutLabel, settingsMode]);

  useEffect(() => {
    if (snapshot?.phase !== "working") return;
    const timer = window.setTimeout(() => {
      setRunError(
        "This is taking longer than expected. Hold your shortcut to check progress.",
      );
    }, 90_000);
    return () => clearTimeout(timer);
  }, [snapshot?.phase]);

  async function request(permission: string) {
    setError("");
    try {
      if (preview)
        setStatus((old) => ({
          ...old,
          microphone: "granted",
          accessibility: true,
          hotkeyReady: true,
        }));
      else await invoke("request_onboarding_permission", { permission });
    } catch (e) {
      setError(String(e));
    }
  }

  async function chooseMicrophone(name: string) {
    try {
      if (!preview) await invoke("select_audio_input", { name: name || null });
      setSelected(name);
      setMicOpen(false);
    } catch (e) {
      setError(String(e));
    }
  }
  function changeKey(provider: Provider, value: string) {
    const revision = ++revisions.current[provider];
    clearTimeout(timers.current[provider]);
    setKeys((old) => ({
      ...old,
      [provider]: { value, state: value.trim() ? "checking" : "empty" },
    }));
    if (value.trim())
      timers.current[provider] = window.setTimeout(
        () => void validate(provider, value.trim(), revision),
        450,
      );
  }
  async function run(task: string, retry = false) {
    setError("");
    setRunError("");
    setSnapshot(null);
    setStarting(true);
    wasBusy.current = false;
    wasWorking.current = false;
    try {
      await emitTo(
        "main",
        retry ? "onboarding-retry-task" : "onboarding-run-task",
        task,
      );
    } catch (e) {
      setStarting(false);
      setRunError(String(e));
    }
  }
  useEffect(() => {
    if (preview) return;
    const resetPresentation = () => {
      presentationRevision.current += 1;
      presentationPaused.current = false;
      windowAnimation.stop();
      setCompleting(false);
      setRecordingShortcut(false);
      setMicOpen(false);
      inspected.current = false;
    };
    const suspended = listen("onboarding-suspended", () => {
      resetPresentation();
      presentationPaused.current = true;
      setPaused(true);
    });
    const resumed = listen("onboarding-resumed", () => {
      resetPresentation();
      setPaused(false);
      setOpenRevision((old) => old + 1);
    });
    const keysOpened = listen("keys-open", () => {
      resetPresentation();
      setSettingsMode(false);
      setKeysOnly(true);
      setPaused(false);
      setStep(3);
      setOpenRevision((old) => old + 1);
    });
    const settings = listen("settings-open", () => {
      resetPresentation();
      setSettingsMode(true);
      setPaused(false);
      setStep(4);
      setError("");
      setOpenRevision((old) => old + 1);
    });
    const restarted = listen("onboarding-start-over", () => {
      resetPresentation();
      setSettingsMode(false);
      setKeysOnly(false);
      setPaused(false);
      setStep(0);
      setError("");
      setRunError("");
      setSnapshot(null);
      setPeeked(false);
      setTapped(false);
      inspected.current = false;
      wasBusy.current = false;
      wasWorking.current = false;
    });
    return () => {
      void suspended.then((fn) => fn());
      void keysOpened.then((fn) => fn());
      void settings.then((fn) => fn());
      void resumed.then((fn) => fn());
      void restarted.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!settingsMode) return;
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !recordingShortcut &&
        !micOpen &&
        !event.defaultPrevented
      )
        void dismiss();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [settingsMode, recordingShortcut, micOpen, status.complete]);

  async function dismiss() {
    if (preview) return;
    const revision = ++presentationRevision.current;
    setError("");
    try {
      setPaused(true);
      if (!settingsMode) {
        await emitTo("main", "onboarding-watch", false);
        if (revision !== presentationRevision.current) return;
        if (!status.complete) {
          await emitTo("main", "onboarding-closed", {});
          if (revision !== presentationRevision.current) return;
          await invoke("set_onboarding_ready", { ready: false });
        }
      }
      if (revision !== presentationRevision.current) return;
      await invoke("dismiss_setup");
    } catch (e) {
      if (revision !== presentationRevision.current) return;
      setPaused(false);
      setError(String(e));
    }
  }

  async function finish() {
    if (completing) return;
    const revision = ++presentationRevision.current;
    setError("");
    setCompleting(true);
    try {
      if (!preview && !keysOnly) await invoke("finish_onboarding");
      if (revision !== presentationRevision.current) return;
      if (!preview) await emitTo("main", "onboarding-watch", false);
      if (revision !== presentationRevision.current) return;
      await windowAnimation.start({
        opacity: 0,
        filter: reducedMotion ? "blur(0px)" : "blur(8px)",
        transform: reducedMotion
          ? "translateY(0px)"
          : "translateY(-12px) scale(.995)",
        transition: {
          delay: reducedMotion || keysOnly ? 0 : 0.5,
          duration: reducedMotion ? 0 : 0.35,
          ease: [0.23, 1, 0.32, 1],
        },
      });
      if (revision !== presentationRevision.current) return;
      if (preview) {
        setCompleting(false);
        setStep(0);
        setOpenRevision((old) => old + 1);
      } else await getCurrentWindow().close();
    } catch (e) {
      if (revision !== presentationRevision.current) return;
      setCompleting(false);
      await windowAnimation.start({
        opacity: 1,
        filter: "blur(0px)",
        transform: "translateY(0px)",
      });
      setError(String(e));
    }
  }
  function next() {
    setError("");
    setStep((old) => old + 1);
  }

  return (
    <motion.main
      className={`onboarding${settingsMode ? " cue-settings" : ""}`}
      initial={
        reducedMotion
          ? false
          : { opacity: 0, filter: "blur(10px)", transform: "translateY(18px)" }
      }
      animate={
        settingsMode
          ? { opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" }
          : windowAnimation
      }
      transition={{
        duration: reducedMotion ? 0 : 0.65,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <div
        className={`ob-content${recordingShortcut ? " is-recording" : ""}${completing ? " is-completing" : ""}`}
        inert={recordingShortcut || completing}
        aria-hidden={recordingShortcut || completing}
      >
        <div
          className="ob-drag"
          title="Drag to move"
          onPointerDown={(event) => {
            if (preview || event.button !== 0) return;
            void getCurrentWindow()
              .startDragging()
              .catch((e) => setError(String(e)));
          }}
        />
        <button
          className="ob-close ob-minimize"
          aria-label="Minimize setup"
          title="Minimize · return from the Dock"
          onClick={() => {
            if (preview) return;
            void getCurrentWindow()
              .minimize()
              .catch((e) => setError(String(e)));
          }}
        >
          <Minus size={14} strokeWidth={1.5} />
        </button>
        <button
          className="ob-close"
          aria-label="Close setup"
          title="Close · resume from the menu bar"
          onClick={() => void dismiss()}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
        <header className="ob-header">
          <span className="ob-wordmark">
            cue<span>.</span>
          </span>
        </header>
        {settingsMode && (
          <nav className="settings-nav" aria-label="Settings sections">
            <div className="settings-nav-title">
              <SlidersHorizontal size={16} />
              <span>Settings</span>
            </div>
            {[
              {
                step: 4,
                title: "General",
                icon: Keyboard,
                detail: "Shortcut & model",
              },
              {
                step: 2,
                title: "Voice",
                icon: Mic,
                detail: "Microphone & input",
              },
              {
                step: 3,
                title: "Connections",
                icon: KeyRound,
                detail: "Your API keys",
              },
              {
                step: 1,
                title: "Permissions",
                icon: ShieldCheck,
                detail: "Access on this Mac",
              },
            ].map(({ step: target, title, icon: Icon, detail }) => (
              <button
                key={target}
                aria-current={step === target ? "page" : undefined}
                onClick={() => {
                  setStep(target);
                  setError("");
                  setSaved(false);
                }}
              >
                <Icon size={16} strokeWidth={1.5} />
                <span>
                  {title}
                  <small>{detail}</small>
                </span>
              </button>
            ))}
            <p>
              Made for your flow.
              <br />
              <span>Cue · on this Mac</span>
            </p>
          </nav>
        )}
        <div className="ob-pages">
          <AnimatePresence initial={false} mode="wait">
            <motion.section
              className={`ob-screen ob-screen-${step}`}
              key={step}
              aria-labelledby="ob-title"
              initial={
                reducedMotion
                  ? false
                  : {
                      opacity: 0,
                      filter: "blur(5px)",
                      transform: "translateY(12px)",
                    }
              }
              animate={{
                opacity: 1,
                filter: "blur(0px)",
                transform: "translateY(0px)",
              }}
              exit={
                reducedMotion
                  ? undefined
                  : {
                      opacity: 0,
                      filter: "blur(4px)",
                      transform: "translateY(-8px)",
                    }
              }
              transition={{
                duration: reducedMotion ? 0 : 0.28,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              {step === 0 && (
                <WelcomeStep label={label} reducedMotion={reducedMotion} />
              )}
              {step === 1 && (
                <PermissionsStep
                  status={status}
                  request={request}
                  preview={preview}
                  setError={setError}
                />
              )}
              {step === 2 && (
                <MicrophoneStep
                  settingsMode={settingsMode}
                  level={level}
                  heard={heard}
                  selected={selected}
                  micOpen={micOpen}
                  micPickerRef={micPickerRef}
                  setMicOpen={setMicOpen}
                  devices={devices}
                  reducedMotion={reducedMotion}
                  chooseMicrophone={chooseMicrophone}
                  flat={flat}
                  request={request}
                  preview={preview}
                  setHeard={setHeard}
                  setLevel={setLevel}
                />
              )}
              {step === 3 && (
                <KeysStep
                  settingsMode={settingsMode}
                  keys={keys}
                  preview={preview}
                  setError={setError}
                  changeKey={changeKey}
                  validate={validate}
                />
              )}
              {step === 4 && (
                <CustomizeStep
                  settingsMode={settingsMode}
                  recordingShortcut={recordingShortcut}
                  setRecordingShortcut={setRecordingShortcut}
                  shortcutLabel={shortcutLabel}
                  agentModel={agentModel}
                  setAgentModel={setAgentModel}
                  setError={setError}
                  reducedMotion={reducedMotion}
                  paused={paused}
                  openRevision={openRevision}
                />
              )}
              {step === 5 && (
                <DemoStep
                  lesson={lesson}
                  tapped={tapped}
                  shortcutLabel={shortcutLabel}
                  firstTask={firstTask}
                  peeked={peeked}
                  snapshot={snapshot}
                  done={done}
                  run={run}
                  runError={runError}
                />
              )}
              {step === 6 && (
                <FinishStep
                  completing={completing}
                  shortcutLabel={shortcutLabel}
                />
              )}
              {error && (
                <p className="ob-error" role="alert">
                  {error}
                  {step === 2 && (
                    <button
                      className="ob-text-button"
                      onClick={() => setMicRevision((old) => old + 1)}
                    >
                      Retry microphone check
                    </button>
                  )}
                </p>
              )}
            </motion.section>
          </AnimatePresence>
        </div>
        {settingsMode ? (
          <footer className="ob-footer settings-footer">
            <span role="status">
              {saved
                ? "Changes saved"
                : step === 4
                  ? "Choose what works for you."
                  : "Changes are saved on this Mac."}
            </span>
            <div>
              {step === 4 && (
                <button
                  className="ob-primary"
                  disabled={saving || recordingShortcut}
                  onClick={() => void saveCustomization()}
                >
                  {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
                  <Check size={14} />
                </button>
              )}
              <button className="ob-back" onClick={() => void dismiss()}>
                Done
              </button>
            </div>
          </footer>
        ) : (
          <footer className="ob-footer">
            <span className="ob-footer-caption">
              {keysOnly
                ? "STORED IN KEYCHAIN"
                : step === 6
                  ? "READY WHEN YOU ARE"
                  : `0${step + 1} / 06`}
            </span>
            <div>
              {step > 0 && step < 6 && !keysOnly && (
                <button
                  className="ob-back"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setStep((old) => old - 1);
                  }}
                >
                  Back
                </button>
              )}
              {step === 0 && (
                <button
                  className="ob-primary ob-welcome-reveal"
                  style={{ animationDelay: "440ms" }}
                  onClick={next}
                >
                  Get started <ArrowRight size={15} />
                </button>
              )}
              {step === 1 && (
                <button
                  className="ob-primary"
                  disabled={
                    status.microphone !== "granted" ||
                    !status.hotkeyReady ||
                    !status.accessibility
                  }
                  onClick={next}
                >
                  Continue <ArrowRight size={15} />
                </button>
              )}
              {step === 2 && (
                <button
                  className="ob-primary"
                  disabled={!heard || !!error}
                  onClick={next}
                >
                  Sounds good <ArrowRight size={15} />
                </button>
              )}
              {step === 3 && (
                <button
                  className="ob-primary"
                  disabled={!validKeys}
                  onClick={keysOnly ? () => void finish() : next}
                >
                  {keysOnly ? "Done" : "Continue"}
                  <ArrowRight size={15} />
                </button>
              )}
              {step === 4 && (
                <button
                  className="ob-primary"
                  disabled={saving || recordingShortcut || !agentModel.trim()}
                  onClick={() => void saveCustomization()}
                >
                  {saving ? "Saving…" : "Try it"} <ArrowRight size={15} />
                </button>
              )}
              {step === 5 && (
                <button
                  className="ob-back"
                  disabled={busy}
                  onClick={() => setStep(6)}
                >
                  Skip for now
                </button>
              )}
              {step === 6 && (
                <button
                  className="ob-primary"
                  disabled={completing}
                  onClick={() => void finish()}
                >
                  {completing ? "You're ready" : "Let's go"}{" "}
                  <ArrowRight size={15} />
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
      <AnimatePresence>
        {recordingShortcut && (
          <ShortcutRecorder
            recorderRef={recorderRef}
            reducedMotion={reducedMotion}
            draftShortcut={draftShortcut}
            shortcutReady={shortcutReady}
            onCancel={() => setRecordingShortcut(false)}
          />
        )}
      </AnimatePresence>
    </motion.main>
  );
}
