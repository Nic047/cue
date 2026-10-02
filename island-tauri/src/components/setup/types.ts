export type Status = {
  complete: boolean;
  microphone: string;
  selectedMicrophone?: string | null;
  accessibility: boolean;
  hotkeyReady: boolean;
  solari: boolean;
  llm: boolean;
  groq: boolean;
};
export type Snapshot = {
  phase: string;
  error: string | null;
  answer: string | null;
  detailOpen: boolean;
  tasks: { status: string }[];
  transcript: string;
  question: { text: string } | null;
};
export type KeyState = {
  value: string;
  state: "empty" | "checking" | "valid" | "error";
  error?: string;
};
