let audioContext: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();

export function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  return audioContext;
}

let gesturePrimed = false;

/** Unlock the AudioContext through a real window gesture; global shortcuts do not satisfy autoplay policies. */
export function primeAudioOnGesture() {
  if (gesturePrimed) return;
  gesturePrimed = true;
  const wake = () => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("pointerdown", wake, { passive: true });
  window.addEventListener("keydown", wake);
}

export async function decodeAudioData(dataUri: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(dataUri);
  if (cached) return cached;

  const ctx = getAudioContext();
  const base64 = dataUri.split(",")[1];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const audioBuffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  bufferCache.set(dataUri, audioBuffer);
  return audioBuffer;
}

export interface PlaySoundOptions {
  volume?: number;
  playbackRate?: number;
  onEnd?: () => void;
}

export interface SoundPlayback {
  stop: () => void;
}

export async function playSound(
  dataUri: string,
  options: PlaySoundOptions = {}
): Promise<SoundPlayback> {
  const { volume = 1, playbackRate = 1, onEnd } = options;
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* The state check below reports failure. */
    }
  }
  // Report suspended audio rather than silently pretending playback succeeded.
  if (ctx.state !== "running") {
    throw new Error(
      `Sound blocked (AudioContext: ${ctx.state}). Click the window and try again.`,
    );
  }

  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudioData(dataUri);
  } catch (err) {
    throw new Error(`Sound decoding failed: ${err}`);
  }
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();

  source.buffer = buffer;
  source.playbackRate.value = playbackRate;
  gain.gain.value = volume;

  source.connect(gain);
  gain.connect(ctx.destination);

  source.onended = () => {
    onEnd?.();
  };

  source.start(0);

  return {
    stop: () => {
      try {
        source.stop();
      } catch {
        // No-op if already stopped.
      }
    },
  };
}
