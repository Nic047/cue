export const providers = [
  {
    id: "solari",
    name: "Solari",
    url: "https://console.getsolari.com",
  },
  {
    id: "llm",
    name: "Vercel AI Gateway",
    url: "https://vercel.com/dashboard/ai-gateway",
  },
  {
    id: "groq",
    name: "Groq",
    url: "https://console.groq.com/keys",
  },
] as const;
export type Provider = (typeof providers)[number]["id"];
export type RecordedShortcut = {
  keyCode: number | null;
  modifiers: number;
  modifierMask: number;
  label: string;
};
export const keyNames: Record<number, string> = {
  0: "A",
  1: "S",
  2: "D",
  3: "F",
  4: "H",
  5: "G",
  6: "Z",
  7: "X",
  8: "C",
  9: "V",
  11: "B",
  12: "Q",
  13: "W",
  14: "E",
  15: "R",
  16: "Y",
  17: "T",
  18: "1",
  19: "2",
  20: "3",
  21: "4",
  22: "6",
  23: "5",
  24: "=",
  25: "9",
  26: "7",
  27: "−",
  28: "8",
  29: "0",
  30: "]",
  31: "O",
  32: "U",
  33: "[",
  34: "I",
  35: "P",
  36: "Return",
  37: "L",
  38: "J",
  39: "'",
  40: "K",
  41: ";",
  42: "\\",
  43: ",",
  44: "/",
  45: "N",
  46: "M",
  47: ".",
  48: "Tab",
  49: "Space",
  50: "`",
  51: "Delete",
  64: "F17",
  65: "Keypad .",
  67: "Keypad *",
  69: "Keypad +",
  71: "Clear",
  75: "Keypad /",
  76: "Enter",
  78: "Keypad −",
  79: "F18",
  80: "F19",
  81: "Keypad =",
  82: "Keypad 0",
  83: "Keypad 1",
  84: "Keypad 2",
  85: "Keypad 3",
  86: "Keypad 4",
  87: "Keypad 5",
  88: "Keypad 6",
  89: "Keypad 7",
  90: "F20",
  91: "Keypad 8",
  92: "Keypad 9",
  96: "F5",
  97: "F6",
  98: "F7",
  99: "F3",
  100: "F8",
  101: "F9",
  103: "F11",
  105: "F13",
  106: "F16",
  107: "F14",
  109: "F10",
  111: "F12",
  113: "F15",
  114: "Help",
  115: "Home",
  116: "Page Up",
  117: "Forward Delete",
  118: "F4",
  119: "End",
  120: "F2",
  121: "Page Down",
  122: "F1",
  123: "←",
  124: "→",
  125: "↓",
  126: "↑",
};
export function shortcutText(value: string) {
  if (value.startsWith("{")) {
    try {
      return (JSON.parse(value) as RecordedShortcut).label;
    } catch {
      return "right ⌥";
    }
  }
  return (
    {
      "right-option": "right ⌥",
      "right-control": "right ⌃",
      "right-shift": "right ⇧",
    }[value] || "right ⌥"
  );
}
// Prices checked against Vercel AI Gateway on 2026-10-01. Intelligence/speed are editorial estimates, not benchmark scores.
export const agentModels = [
  {
    id: "inception/mercury-2.5",
    name: "Mercury 2.5",
    hint: "Lowest cost · fast everyday tasks",
    intelligence: 3,
    speed: 5,
    price: 1,
    input: 0.04,
    output: 0.15,
    slug: "mercury-2.5",
    note: "Current promotional rates",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    hint: "Lightweight · high volume",
    intelligence: 2,
    speed: 5,
    price: 2,
    input: 0.25,
    output: 1.5,
    slug: "gemini-3.1-flash-lite",
  },
  {
    id: "openai/gpt-5.4-mini",
    name: "GPT-5.4 mini",
    hint: "Balanced · reasoning and browser tasks",
    intelligence: 4,
    speed: 3,
    price: 3,
    input: 0.75,
    output: 4.5,
    slug: "gpt-5.4-mini",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    hint: "Responsive · tool use and coding",
    intelligence: 4,
    speed: 4,
    price: 3,
    input: 1,
    output: 5,
    slug: "claude-haiku-4.5",
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    hint: "Most capable here · complex tasks",
    intelligence: 5,
    speed: 2,
    price: 5,
    input: 3,
    output: 15,
    slug: "claude-sonnet-4.6",
  },
];

export function shortcutBadges(value: RecordedShortcut) {
  if (value.keyCode === null)
    return value.label
      .split(" + ")
      .map((key) => key.replace(/^(left|right)\s+/, ""));
  return [
    ...(
      [
        [0x40000, "⌃"],
        [0x80000, "⌥"],
        [0x20000, "⇧"],
        [0x100000, "⌘"],
      ] as const
    )
      .filter(([mask]) => value.modifiers & mask)
      .map(([, symbol]) => symbol),
    value.label || keyNames[value.keyCode] || `Key ${value.keyCode}`,
  ];
}
