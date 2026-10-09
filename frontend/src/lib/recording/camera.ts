/**
 * Getting at the camera and the screen for an async recording. The
 * microphone is opened with the camera, as one stream, so the camera's file
 * carries the voice; which microphone is picked is shared with
 * `microphone.ts`, so one chosen on Check PC is the one used here.
 */

import { savedMicrophone, saveMicrophone } from "./microphone";
import { cameraProblem, screenProblem, type CameraProblem } from "./video";

const CAMERA_KEY = "recording-camera";

export { savedMicrophone, saveMicrophone };

export function canRecordVideoHere(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof MediaRecorder !== "undefined" &&
    typeof indexedDB !== "undefined"
  );
}

export function savedCamera(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}

export function saveCamera(deviceId: string | null): void {
  try {
    if (deviceId) localStorage.setItem(CAMERA_KEY, deviceId);
    else localStorage.removeItem(CAMERA_KEY);
  } catch {
    // Private windows and blocked storage: the default camera it is.
  }
}

const CONTRIBUTOR_KEY = "recording-contributor";

/** The name typed on the last recording page, so a second link does not ask again. */
export function savedContributor(): string | null {
  try {
    return localStorage.getItem(CONTRIBUTOR_KEY);
  } catch {
    return null;
  }
}

export function saveContributor(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(CONTRIBUTOR_KEY, name.trim());
  } catch {
    // Private windows and blocked storage: they type it again next time.
  }
}

/** The cameras and microphones attached. Their labels are blank until the site has been allowed them. */
export async function listDevices(): Promise<{ cameras: MediaDeviceInfo[]; microphones: MediaDeviceInfo[] }> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === "videoinput" && d.deviceId !== ""),
    microphones: devices.filter((d) => d.kind === "audioinput" && d.deviceId !== ""),
  };
}

export type OpenedCamera =
  | { ok: true; stream: MediaStream; cameraId: string | null; microphoneId: string | null }
  | { ok: false; problem: CameraProblem; detail: string };

/**
 * Opens the camera at the best it offers up to 1080p and 30 frames a second
 * — never more, whatever the camera can do — and the microphone, as picked or saved. A
 * saved device that is gone falls back to the default rather than failing.
 * The microphone keeps the browser's echo cancellation and noise suppression:
 * the participant may be on speakers, and a clean voice matters more than a
 * flat one.
 */
export async function openCamera(
  cameraId: string | null = savedCamera(),
  microphoneId: string | null = savedMicrophone(),
): Promise<OpenedCamera> {
  const constraints = (cam: string | null, mic: string | null): MediaStreamConstraints => ({
    video: {
      ...(cam ? { deviceId: { exact: cam } } : {}),
      width: { ideal: 1920, max: 1920 },
      height: { ideal: 1080, max: 1080 },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: {
      ...(mic ? { deviceId: { exact: mic } } : {}),
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: { ideal: 48_000 },
    },
  });

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints(cameraId, microphoneId));
  } catch (error) {
    const problem = cameraProblem(error);
    if ((!cameraId && !microphoneId) || problem !== "device_gone") {
      return { ok: false, problem, detail: String((error as Error)?.message ?? "") };
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints(null, null));
    } catch (retry) {
      return { ok: false, problem: cameraProblem(retry), detail: String((retry as Error)?.message ?? "") };
    }
  }

  return {
    ok: true,
    stream,
    cameraId: stream.getVideoTracks()[0]?.getSettings().deviceId ?? null,
    microphoneId: stream.getAudioTracks()[0]?.getSettings().deviceId ?? null,
  };
}

export type OpenedScreen =
  | { ok: true; stream: MediaStream }
  | { ok: false; problem: ReturnType<typeof screenProblem> };

/**
 * Asks to share a screen, window or tab, with its audio where the browser
 * offers it (Chrome does for a tab, and for the whole screen on Windows).
 * Native resolution up to 1440p, and up to 60 frames a second so scrolling
 * and animation in a demo stay smooth; a still screen costs little either way.
 */
export async function openScreen(): Promise<OpenedScreen> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { max: 2560 },
        height: { max: 1440 },
        frameRate: { ideal: 60, max: 60 },
      },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chrome: offer the whole screen first, and keep this tab out of the list.
      ...({ selfBrowserSurface: "exclude", monitorTypeSurfaces: "include", surfaceSwitching: "include" } as object),
    });
    return { ok: true, stream };
  } catch (error) {
    return { ok: false, problem: screenProblem(error) };
  }
}

export function closeStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
