import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CornerDownLeft,
  ExternalLink,
  Loader2,
  Mic,
  Minus,
  SlidersHorizontal,
  KeyRound,
  Keyboard,
  ShieldCheck,
  X,
} from "lucide-react";
import { IslandShape } from "./components/ui/island-shape";
import { DotmSquare11 } from "./components/ui/dotm-square-11";
import { usePrefersReducedMotion } from "./lib/dotmatrix-hooks";
import { DotmSquare8 } from "./components/ui/dotm-square-8";
import {
  providers, agentModels, keyNames, shortcutText, shortcutBadges, HOLD_TO_PEEK_MS,
  type Provider, type RecordedShortcut,
} from "./lib/setup-options";
import "./onboarding.css";

type Status = {
  complete: boolean;
  microphone: string;
  selectedMicrophone?: string | null;
  accessibility: boolean;
  hotkeyReady: boolean;
  solari: boolean;
  llm: boolean;
  groq: boolean;
};
type Snapshot = {
  phase: string;
  error: string | null;
  answer: string | null;
  detailOpen: boolean;
  tasks: { status: string }[];
  transcript: string;
  question: { text: string } | null;
};
type KeyState = {
  value: string;
  state: "empty" | "checking" | "valid" | "error";
  error?: string;
};
function ModelBars({ model }: { model: (typeof agentModels)[number] }) {
  const descriptors = {
    intelligence: ["", "Basic", "Everyday", "Capable", "High", "Very high"],
    speed: ["", "Measured", "Steady", "Fast", "Very fast", "Very fast"],
    price: ["", "Very low", "Low", "Moderate", "High", "Premium"],
  };
  return (
    <span className="ob-model-bars">
      {(["intelligence", "speed", "price"] as const).map((metric) => (
        <span className="ob-model-metric" key={metric}>
          <span className="ob-model-metric-label">
            {metric === "intelligence"
              ? "Intelligence"
              : metric === "speed"
                ? "Speed"
                : "Price"}
            <small>{descriptors[metric][model[metric]]}</small>
          </span>
          <span
            className="ob-model-track"
            role="meter"
            aria-label={metric}
            aria-valuemin={1}
            aria-valuemax={5}
            aria-valuenow={model[metric]}
            aria-valuetext={descriptors[metric][model[metric]]}
          >
            <i style={{ width: `${(model[metric] / 5) * 100}%` }} />
          </span>
        </span>
      ))}
    </span>
  );
}
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
  const [settingsMode, setSettingsMode] = useState(new URLSearchParams(location.search).has("settings"));
  const presentationRevision = useRef(0);
  const presentationPaused = useRef(false);
  const settingsWindow = useRef(new URLSearchParams(location.search).has("settings"));
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
  const [modelOpen, setModelOpen] = useState(false);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const chosenModel = agentModels.find((model) => model.id === agentModel);
  const [openRevision, setOpenRevision] = useState(0);
  const [draftShortcut, setDraftShortcut] = useState<RecordedShortcut | null>(
    null,
  );
  const [shortcutReady, setShortcutReady] = useState(false);
  const draftRef = useRef<RecordedShortcut | null>(null);
  const readyRef = useRef(false);
  const recorderRef = useRef<HTMLDivElement>(null);
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
  }, [recordingShortcut]);
  useEffect(() => {
    setRecordingShortcut(false);
    setModelOpen(false);
    setSaved(false);
  }, [step, paused]);
  useEffect(() => { setSaved(false); }, [shortcut, agentModel]);
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
      .catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
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
      if (!modelPickerRef.current?.contains(event.target as Node))
        setModelOpen(false);
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
    const focused = listen("setup-focus", () => { void poll(); });
    const refreshOnFocus = () => { void poll(); };
    window.addEventListener("focus", refreshOnFocus);
    // Poll only while a user can grant permissions outside this window.
    const timer = step === 1 ? window.setInterval(poll, 1500) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", refreshOnFocus);
      void focused.then(unlisten => unlisten());
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
          if (!live || settingsWindow.current || presentationPaused.current) return;
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
      setModelOpen(false);
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
      if (event.key === "Escape" && !recordingShortcut && !micOpen && !modelOpen && !event.defaultPrevented) void dismiss();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [settingsMode, recordingShortcut, micOpen, modelOpen, status.complete]);

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
      animate={settingsMode
        ? { opacity: 1, filter: "blur(0px)", transform: "translateY(0px)" }
        : windowAnimation}
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
        <div className="ob-drag" title="Drag to move" onPointerDown={(event) => {
          if (preview || event.button !== 0) return;
          void getCurrentWindow().startDragging().catch((e) => setError(String(e)));
        }} />
        <button
          className="ob-close ob-minimize"
          aria-label="Minimize setup"
          title="Minimize · return from the Dock"
          onClick={() => {
            if (preview) return;
            void getCurrentWindow().minimize().catch((e) => setError(String(e)));
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
              <SlidersHorizontal size={16} /><span>Settings</span>
            </div>
            {[
              { step: 4, title: "General", icon: Keyboard, detail: "Shortcut & model" },
              { step: 2, title: "Voice", icon: Mic, detail: "Microphone & input" },
              { step: 3, title: "Connections", icon: KeyRound, detail: "Your API keys" },
              { step: 1, title: "Permissions", icon: ShieldCheck, detail: "Access on this Mac" },
            ].map(({ step: target, title, icon: Icon, detail }) => (
              <button key={target} aria-current={step === target ? "page" : undefined}
                onClick={() => { setStep(target); setError(""); setSaved(false); }}>
                <Icon size={16} strokeWidth={1.5} />
                <span>{title}<small>{detail}</small></span>
              </button>
            ))}
            <p>Made for your flow.<br /><span>Cue · on this Mac</span></p>
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
                <>
                  <div
                    className="ob-welcome-art ob-welcome-reveal"
                    aria-hidden="true"
                  >
                    <div className="ob-demo-pill">
                      <IslandShape
                        className="ob-demo-shape"
                        variant="pill"
                        pillWidth={248}
                      />
                      {label < 3 ? (
                        <DotmSquare11
                          size={22}
                          dotSize={2.6}
                          cellPadding={1.2}
                          muted
                          bloom
                          speed={1.1}
                          color="#ddd"
                        />
                      ) : (
                        <DotmSquare8
                          size={22}
                          dotSize={2.6}
                          cellPadding={1.2}
                          muted
                          bloom
                          speed={label === 3 ? 0.8 : 1.1}
                          color="#ddd"
                        />
                      )}
                      <span className="ob-demo-copy">
                        <AnimatePresence initial={false} mode="wait">
                          <motion.span
                            key={label}
                            initial={reducedMotion ? false : { opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={reducedMotion ? undefined : { opacity: 0 }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.22,
                              ease: [0.23, 1, 0.32, 1],
                            }}
                          >
                            {
                              [
                                "Listening…",
                                "Transcribing…",
                                "2 running · 13s",
                                "Results ready",
                              ][label]
                            }
                          </motion.span>
                        </AnimatePresence>
                      </span>
                    </div>
                    <div className="ob-orbit" />
                  </div>
                  <p
                    className="ob-eyebrow ob-welcome-reveal"
                    style={{ animationDelay: "120ms" }}
                  >
                    WELCOME
                  </p>
                  <h1
                    id="ob-title"
                    className="ob-welcome-reveal"
                    style={{ animationDelay: "220ms" }}
                  >
                    Say what you want done.
                    <br />
                    Keep working.
                  </h1>
                  <p
                    className="ob-lead ob-welcome-reveal"
                    style={{ animationDelay: "340ms" }}
                  >
                    Only takes two minutes.
                  </p>
                </>
              )}
              {step === 1 && (
                <>
                  <p className="ob-eyebrow">LET CUE HEAR YOU</p>
                  <h1 id="ob-title">Two small permissions.</h1>
                  <p className="ob-lead">
                    Voice in. One key to bring it all together.
                  </p>
                  {[
                    {
                      id: "microphone",
                      title: "Microphone",
                      reason: "For your voice. Only records when you ask.",
                      granted: status.microphone === "granted",
                      icon: Mic,
                    },
                    {
                      id: "accessibility",
                      title: "Accessibility",
                      reason:
                        "For the right Option shortcut, wherever you work.",
                      granted: status.accessibility,
                      icon: ShieldCheck,
                    },
                  ].map((p) => (
                    <div className="ob-permission" key={p.id}>
                      <p.icon size={21} strokeWidth={1.5} />
                      <div>
                        <h2>{p.title}</h2>
                        <p>{p.reason}</p>
                        {p.id === "microphone" &&
                          ["denied", "restricted"].includes(
                            status.microphone,
                          ) && (
                            <small>
                              Voice input is unavailable until you allow
                              microphone access.
                            </small>
                          )}
                        {p.id === "accessibility" &&
                          status.accessibility &&
                          !status.hotkeyReady && (
                            <small>
                              Accessibility is allowed. Connecting the shortcut…
                              If this stays here, quit and reopen Cue.
                            </small>
                          )}
                      </div>
                      {p.granted ? (
                        <span className="ob-granted">
                          <Check size={15} className="ob-check" />
                          Allowed
                        </span>
                      ) : (
                        <button
                          className="ob-secondary"
                          onClick={() => void request(p.id)}
                        >
                          {p.id === "microphone" &&
                          status.microphone === "not-determined"
                            ? "Allow"
                            : "Open Settings"}
                          <ExternalLink size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                  {!status.hotkeyReady && (
                    <div className="ob-permission">
                      <div>
                        <p>Already enabled Accessibility? macOS may need Cue to restart.</p>
                      </div>
                      <button className="ob-secondary" onClick={() => {
                        if (preview) return;
                        void invoke("restart_for_permissions").catch((e) => setError(String(e)));
                      }}>Restart Cue</button>
                    </div>
                  )}
                  <p className="ob-footnote">
                    If Cue is already enabled but still shows as blocked, remove
                    the old Cue entry with “−”, add Cue from Applications again,
                    and enable it. Reopen Cue if macOS asks you to quit.
                  </p>
                </>
              )}
              {step === 2 && (
                <>
                  <p className="ob-eyebrow">A QUICK SOUND CHECK</p>
                  <h1 id="ob-title">{settingsMode ? "Your voice." : "Say something."}</h1>
                  <p className="ob-lead">
                    Let's make sure we're listening to the right microphone.
                  </p>
                  <div
                    className="ob-meter"
                    role="meter"
                    aria-label="Microphone level"
                    aria-valuenow={Math.round(level * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    {Array.from({ length: 36 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          transform: `scaleY(${0.2 + 0.8 * Math.max(0, Math.min(1, level * 36 - i))})`,
                          opacity:
                            0.18 +
                            0.82 * Math.max(0, Math.min(1, level * 36 - i)),
                        }}
                      />
                    ))}
                  </div>
                  <p className="ob-meter-caption" aria-live="polite">
                    {heard ? (
                      <>
                        <Check size={15} className="ob-check" /> Sounds good. We
                        can hear you.
                      </>
                    ) : (
                      "Listening for your voice…"
                    )}
                  </p>
                  <div className="ob-device">
                    <span id="ob-device-label">Microphone</span>
                    <div
                      ref={micPickerRef}
                      className="ob-device-picker"
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                          setMicOpen(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setMicOpen(false);
                          micPickerRef.current
                            ?.querySelector<HTMLButtonElement>(
                              ".ob-device-trigger",
                            )
                            ?.focus();
                          event.stopPropagation();
                        } else if (
                          micOpen &&
                          (event.key === "ArrowDown" || event.key === "ArrowUp")
                        ) {
                          const options = Array.from(
                            micPickerRef.current!.querySelectorAll<HTMLButtonElement>(
                              ".ob-device-options button",
                            ),
                          );
                          const current = options.indexOf(
                            document.activeElement as HTMLButtonElement,
                          );
                          const next =
                            current < 0
                              ? event.key === "ArrowDown"
                                ? 0
                                : options.length - 1
                              : (current +
                                  (event.key === "ArrowDown" ? 1 : -1) +
                                  options.length) %
                                options.length;
                          options[next]?.focus();
                          event.preventDefault();
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="ob-device-trigger"
                        aria-expanded={micOpen}
                        aria-haspopup="listbox"
                        onClick={() => setMicOpen(!micOpen)}
                      >
                        <span>{selected || "System default"}</span>
                        <ChevronDown size={15} strokeWidth={1.6} />
                      </button>
                      <AnimatePresence>
                        {micOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: 4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 4, scale: 0.98 }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.22,
                              ease: [0.23, 1, 0.32, 1],
                            }}
                            className="ob-device-options"
                            role="listbox"
                            aria-label="Microphone input"
                          >
                            {["", ...devices].map((device) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={selected === device}
                                key={device || "default"}
                                onClick={() => void chooseMicrophone(device)}
                              >
                                <span>{device || "System default"}</span>
                                {selected === device && (
                                  <Check size={14} strokeWidth={1.7} />
                                )}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                  {!heard && flat && (
                    <div className="ob-hint">
                      No sound yet? Bluetooth headsets sometimes use the wrong
                      input.
                      <button onClick={() => void request("sound")}>
                        Check System Settings → Sound → Input{" "}
                        <ExternalLink size={12} />
                      </button>
                    </div>
                  )}
                  {preview && (
                    <button
                      className="ob-text-button"
                      onClick={() => {
                        setHeard(true);
                        setLevel(0.5);
                      }}
                    >
                      Preview: simulate sound
                    </button>
                  )}
                </>
              )}
              {step === 3 && (
                <>
                  <p className="ob-eyebrow">YOUR TOOLS, CONNECTED</p>
                  <h1 id="ob-title">{settingsMode ? "Connections." : "Bring your keys."}</h1>
                  <p className="ob-lead">
                    Paste once. Stored securely in your Mac's Keychain.
                  </p>
                  <div className="ob-keys">
                    {providers.map((p) => (
                      <div className="ob-key" key={p.id}>
                        <div className="ob-key-label">
                          <label htmlFor={`key-${p.id}`}>{p.name}</label>
                          <button
                            onClick={() => {
                              if (!preview)
                                void openUrl(p.url).catch((e) =>
                                  setError(String(e)),
                                );
                            }}
                          >
                            Get a key <ExternalLink size={11} />
                          </button>
                        </div>
                        <div
                          className={`ob-input ${keys[p.id].state === "error" ? "invalid" : ""}`}
                        >
                          <input
                            id={`key-${p.id}`}
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            value={keys[p.id].value}
                            placeholder={
                              keys[p.id].state === "valid"
                                ? "Saved in Keychain"
                                : "Paste your API key"
                            }
                            onChange={(e) => changeKey(p.id, e.target.value)}
                            aria-invalid={keys[p.id].state === "error"}
                            aria-describedby={
                              keys[p.id].state === "error"
                                ? `hint-${p.id}`
                                : undefined
                            }
                          />
                          <span className="ob-input-status" aria-hidden="true">
                            {keys[p.id].state === "checking" && (
                              <Loader2 size={15} className="ob-spinner" />
                            )}
                            {keys[p.id].state === "valid" && (
                              <Check size={16} className="ob-check" />
                            )}
                          </span>
                          <span className="ob-sr-only" role="status">
                            {keys[p.id].state === "checking"
                              ? `Checking ${p.name} key`
                              : keys[p.id].state === "valid"
                                ? `${p.name} key verified and saved`
                                : ""}
                          </span>
                        </div>
                        {keys[p.id].state === "error" && (
                          <p
                            id={`hint-${p.id}`}
                            className={
                              keys[p.id].state === "error"
                                ? "ob-field-error"
                                : ""
                            }
                          >
                            {keys[p.id].error}
                            {keys[p.id].state === "error" && (
                              <button
                                onClick={() =>
                                  void validate(
                                    p.id,
                                    keys[p.id].value || undefined,
                                  )
                                }
                              >
                                Retry
                              </button>
                            )}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="ob-privacy">
                    <ShieldCheck size={14} />
                    <span>
                      <span>
                        Audio goes to Groq. Requests and task context go to
                        Solari and Vercel AI Gateway.
                      </span>
                      <span>
                        Keys are stored in Keychain and sent to their providers
                        to authenticate. Usage may incur charges.
                      </span>
                    </span>
                  </p>
                </>
              )}
              {step === 4 && (
                <>
                  <p className="ob-eyebrow">MAKE IT YOURS</p>
                  <h1 id="ob-title">{settingsMode ? "Make it yours." : "Your way to cue."}</h1>
                  <p className="ob-lead">
                    Choose your shortcut and the model that does the thinking.
                  </p>
                  <div className="ob-customize">
                    <label htmlFor="ob-shortcut-record">Shortcut</label>
                    <button
                      id="ob-shortcut-record"
                      className="ob-shortcut-record"
                      aria-pressed={recordingShortcut}
                      onClick={() => setRecordingShortcut(!recordingShortcut)}
                    >
                      <span>
                        {recordingShortcut ? (
                          "Press your shortcut…"
                        ) : (
                          <kbd>{shortcutLabel}</kbd>
                        )}
                      </span>
                      <span>
                        {recordingShortcut
                          ? "Esc to cancel"
                          : "Click to record"}
                      </span>
                    </button>
                    <p className="ob-customize-hint">
                      Use a key combination or a single modifier. Tap to talk;
                      hold {HOLD_TO_PEEK_MS / 1000} seconds to peek.
                    </p>
                    <label id="ob-model-label">Agent model</label>
                    <div
                      className="ob-model-picker"
                      ref={modelPickerRef}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                          setModelOpen(false);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setModelOpen(false);
                          event.stopPropagation();
                          modelPickerRef.current
                            ?.querySelector<HTMLButtonElement>(
                              ".ob-model-trigger",
                            )
                            ?.focus();
                        }
                        if (
                          modelOpen &&
                          ["ArrowDown", "ArrowUp"].includes(event.key)
                        ) {
                          const options = Array.from(
                            event.currentTarget.querySelectorAll<HTMLButtonElement>(
                              "[role=option]",
                            ),
                          );
                          const current = options.indexOf(
                            document.activeElement as HTMLButtonElement,
                          );
                          options[
                            current < 0
                              ? event.key === "ArrowDown"
                                ? 0
                                : options.length - 1
                              : (current +
                                  (event.key === "ArrowDown" ? 1 : -1) +
                                  options.length) %
                                options.length
                          ]?.focus();
                          event.preventDefault();
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="ob-model-trigger"
                        aria-haspopup="listbox"
                        aria-expanded={modelOpen}
                        aria-labelledby="ob-model-label ob-model-name"
                        onClick={() => setModelOpen(!modelOpen)}
                      >
                        <span className="ob-model-summary">
                          <span id="ob-model-name">
                            {chosenModel?.name || agentModel}
                          </span>
                          <small>
                            {chosenModel?.hint || "Previously selected model"}
                          </small>
                        </span>
                        <ChevronDown size={15} />
                      </button>
                      <AnimatePresence>
                        {modelOpen && (
                          <motion.div
                            className="ob-model-options"
                            role="listbox"
                            aria-label="Agent model"
                            initial={{
                              opacity: 0,
                              transform: "translateY(3px) scale(.995)",
                            }}
                            animate={{
                              opacity: 1,
                              transform: "translateY(0px) scale(1)",
                            }}
                            exit={{
                              opacity: 0,
                              transform: "translateY(3px) scale(.995)",
                            }}
                            transition={{
                              duration: reducedMotion ? 0 : 0.22,
                              ease: [0.23, 1, 0.32, 1],
                            }}
                          >
                            {agentModels.map((model) => (
                              <button
                                type="button"
                                key={model.id}
                                role="option"
                                aria-selected={agentModel === model.id}
                                onClick={() => {
                                  setAgentModel(model.id);
                                  setModelOpen(false);
                                  modelPickerRef.current
                                    ?.querySelector<HTMLButtonElement>(
                                      ".ob-model-trigger",
                                    )
                                    ?.focus();
                                }}
                              >
                                <span className="ob-model-name">
                                  {model.name}
                                  {agentModel === model.id && (
                                    <Check size={13} />
                                  )}
                                </span>
                                <small>{model.hint}</small>
                                <ModelBars model={model} />
                                <small className="ob-model-rate">
                                  ${model.input} in · ${model.output} out / 1M
                                  tokens{model.note ? " · Promo" : ""}
                                </small>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    <p className="ob-customize-hint ob-model-disclaimer">
                      Intelligence and speed are estimates. A longer price bar
                      means higher cost.
                    </p>
                    {chosenModel && (
                      <p className="ob-model-pricing">
                        From ${chosenModel.input} input · ${chosenModel.output}{" "}
                        output / 1M tokens.{" "}
                        {chosenModel.note && `${chosenModel.note}. `}
                        <button
                          className="ob-text-button"
                          onClick={() =>
                            void openUrl(
                              `https://vercel.com/ai-gateway/models/${chosenModel.slug}`,
                            ).catch((e) => setError(String(e)))
                          }
                        >
                          Rates <ExternalLink size={11} />
                        </button>
                      </p>
                    )}
                  </div>
                </>
              )}
              {step === 5 && (
                <>
                  <p className="ob-eyebrow">LET'S DO SOMETHING REAL</p>
                  <h1 id="ob-title">Your first handoff.</h1>
                  <p className="ob-lead">Try Cue with a real task.</p>
                  <div
                    className={`ob-lesson ${lesson === 1 ? "active" : tapped ? "complete" : ""}`}
                  >
                    <span className="ob-lesson-number">
                      {tapped ? <Check size={13} className="ob-check" /> : "1"}
                    </span>
                    <div>
                      <h2>
                        Tap <kbd>{shortcutLabel}</kbd> and say
                      </h2>
                      <blockquote>{firstTask}</blockquote>
                      <p>Tap again when you're done speaking.</p>
                    </div>
                  </div>
                  <div
                    className={`ob-lesson ${lesson === 2 && !peeked ? "active" : peeked ? "complete" : ""}`}
                  >
                    <span className="ob-lesson-number">
                      {peeked ? <Check size={13} className="ob-check" /> : "2"}
                    </span>
                    <div>
                      <h2>
                        Keep working. Hold{" "}
                        <kbd
                          className={
                            lesson === 2 && !peeked ? "ob-key-cue" : undefined
                          }
                        >
                          {shortcutLabel}
                        </kbd>{" "}
                        to peek.
                      </h2>
                      <p>
                        Hold for {HOLD_TO_PEEK_MS / 1000} seconds while agents
                        run. Release to hide.
                      </p>
                      {snapshot?.phase === "working" && (
                        <span className="ob-live">
                          <Loader2 size={13} className="ob-spinner" />
                          {snapshot.tasks.some((t) => t.status === "running")
                            ? `${snapshot.tasks.filter((t) => t.status === "running").length} running`
                            : "Planning"}{" "}
                          — try the hold now.
                        </span>
                      )}
                      {peeked && (
                        <span className="ob-completed">Peek learned.</span>
                      )}
                    </div>
                  </div>
                  <div className={`ob-lesson ${lesson === 3 ? "active" : ""}`}>
                    <span className="ob-lesson-number">3</span>
                    <div>
                      <h2>See what got done.</h2>
                      <p>
                        Double-tap <kbd>{shortcutLabel}</kbd> to open your result
                        when the pill says “Results ready”. You can also click
                        the pill once. Press Esc to come back.
                      </p>
                      {done && !peeked && (
                        <button
                          className="ob-text-button"
                          onClick={() => void run(firstTask)}
                        >
                          Run again to practice the hold{" "}
                          <ArrowRight size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div aria-live="polite">
                    {snapshot?.phase === "listening" && (
                      <p className="ob-live">
                        Listening… Tap {shortcutLabel} to send.
                      </p>
                    )}
                    {snapshot?.phase === "transcribing" && (
                      <p className="ob-live">Turning your voice into text…</p>
                    )}
                    {runError && (
                      <div className="ob-hint">
                        {runError}
                      </div>
                    )}
                  </div>
                </>
              )}
              {step === 6 && (
                <>
                  <div
                    className={`ob-finish-icon${completing ? " is-celebrating" : ""}`}
                  >
                    <Check size={32} strokeWidth={1.4} />
                  </div>
                  <p className="ob-eyebrow">YOU'RE ALL SET</p>
                  <h1 id="ob-title">Back to your flow.</h1>
                  <p className="ob-lead">
                    Cue is there whenever you need a hand.
                  </p>
                  <div className="ob-reminders">
                    <p>
                      <kbd>{shortcutLabel}</kbd>
                      <span>Tap to talk. Hold 1.5 seconds to peek.</span>
                    </p>
                    <p>
                      <kbd>esc</kbd>
                      <span>Once hides. Twice cancels the task.</span>
                    </p>
                  </div>
                  <p className="ob-menu-detail">
                    Change keys, open recent chats, or quit Cue from the menu
                    bar.
                  </p>
                </>
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
            <span role="status">{saved ? "Changes saved" : step === 4
              ? "Choose what works for you." : "Changes are saved on this Mac."}</span>
            <div>
              {step === 4 && (
                <button className="ob-primary" disabled={saving || recordingShortcut}
                  onClick={() => void saveCustomization()}>
                  {saving ? "Saving…" : saved ? "Saved" : "Save changes"}<Check size={14} />
                </button>
              )}
              <button className="ob-back" onClick={() => void dismiss()}>Done</button>
            </div>
          </footer>
        ) : <footer className="ob-footer">
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
        </footer>}
      </div>
      <AnimatePresence>
        {recordingShortcut && (
          <motion.div
            className="ob-recorder"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ob-recorder-title"
            tabIndex={-1}
            ref={recorderRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
          >
            <button
              className="ob-close"
              aria-label="Cancel recording"
              onClick={() => setRecordingShortcut(false)}
            >
              <X size={16} />
            </button>
            <motion.div
              className="ob-recorder-center"
              initial={
                reducedMotion
                  ? false
                  : {
                      opacity: 0,
                      filter: "blur(6px)",
                      transform: "translateY(8px)",
                    }
              }
              animate={{
                opacity: 1,
                filter: "blur(0px)",
                transform: "translateY(0px)",
              }}
              transition={{
                duration: reducedMotion ? 0 : 0.3,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <p className="ob-eyebrow">MAKE IT A GESTURE</p>
              <h1 id="ob-recorder-title">Record your shortcut.</h1>
              <p className="ob-recorder-hint">Press your keys together.</p>
              <div className="ob-recorded-keys" aria-live="polite">
                <AnimatePresence initial={false}>
                  {draftShortcut ? (
                    shortcutBadges(draftShortcut).map((key) => (
                      <motion.kbd
                        key={key}
                        initial={{
                          opacity: 0,
                          transform: "translateY(6px) scale(.98)",
                        }}
                        animate={{
                          opacity: 1,
                          transform: "translateY(0px) scale(1)",
                        }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: reducedMotion ? 0 : 0.2 }}
                      >
                        {key}
                      </motion.kbd>
                    ))
                  ) : (
                    <span className="ob-key-placeholder">
                      Waiting for your keys
                    </span>
                  )}
                </AnimatePresence>
              </div>
              <div className="ob-recorder-confirm" data-ready={shortcutReady}>
                <span>Press</span>
                <kbd aria-label="Enter">
                  <CornerDownLeft size={18} />
                </kbd>
                <span>to continue</span>
              </div>
              <p className="ob-recorder-cancel">Esc to cancel</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.main>
  );
}
