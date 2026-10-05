/**
 * Getting at the microphone: whether the site may, which one this person
 * picked, and opening it.
 *
 * The picked microphone is remembered in localStorage, so the one chosen on
 * Check PC is the one the scoring form records from. It is a convenience: lost
 * or unreadable, the browser's default microphone is used instead.
 */

import { microphoneProblem, type MicrophoneProblem } from "./format";

const DEVICE_KEY = "recording-microphone";

/** `unsupported` when the browser cannot say without asking (older Safari, Firefox before 2024). */
export type MicrophonePermission = PermissionState | "unsupported";

export async function microphonePermission(): Promise<{
  state: MicrophonePermission;
  /** Calls back when the person changes it in the browser's settings; returns an unsubscribe. */
  watch: (onChange: (state: PermissionState) => void) => () => void;
}> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return {
      state: status.state,
      watch: (onChange) => {
        const listener = () => onChange(status.state);
        status.addEventListener("change", listener);
        return () => status.removeEventListener("change", listener);
      },
    };
  } catch {
    return { state: "unsupported", watch: () => () => {} };
  }
}

export function canRecordHere(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

export function savedMicrophone(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function saveMicrophone(deviceId: string | null): void {
  try {
    if (deviceId) localStorage.setItem(DEVICE_KEY, deviceId);
    else localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Private windows and blocked storage: the default microphone it is.
  }
}

/** The microphones attached. Their labels are blank until the site has been allowed one. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "");
}

export type OpenedMicrophone =
  | { ok: true; stream: MediaStream; deviceId: string | null; label: string }
  | { ok: false; problem: MicrophoneProblem; detail: string };

/**
 * Opens `deviceId`, or the saved microphone, or the default. A saved one that
 * is no longer plugged in falls back to the default rather than failing: a
 * judge who swapped headsets still records.
 */
export async function openMicrophone(deviceId: string | null = savedMicrophone()): Promise<OpenedMicrophone> {
  if (!canRecordHere()) return { ok: false, problem: "unsupported", detail: "" };

  const constraints = (id: string | null): MediaStreamConstraints => ({
    audio: {
      ...(id ? { deviceId: { exact: id } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  } catch (error) {
    const problem = microphoneProblem(error);
    if (!deviceId || problem !== "device_gone") {
      return { ok: false, problem, detail: String((error as Error)?.message ?? "") };
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(null));
    } catch (retry) {
      return { ok: false, problem: microphoneProblem(retry), detail: String((retry as Error)?.message ?? "") };
    }
  }

  const track = stream.getAudioTracks()[0];
  const settings = track?.getSettings();
  return { ok: true, stream, deviceId: settings?.deviceId ?? null, label: track?.label ?? "" };
}

export function closeMicrophone(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
