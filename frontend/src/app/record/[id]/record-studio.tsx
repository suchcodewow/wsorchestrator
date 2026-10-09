"use client";

/**
 * Where someone records for the training team, from a link and with no
 * account: their camera and microphone, and their screen if they want to
 * show one, each as its own file, under the name they give.
 *
 * Everything is recorded here, in the browser, at full quality, and kept on
 * this computer as it records; the upload runs alongside and catches up on its
 * own, so a poor or dropping connection costs time, never quality or footage.
 * Closing the tab before it is done is safe too: opening the link again on
 * the same computer and browser picks the upload up where it stopped.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CloudOff,
  CloudUpload,
  Download,
  Loader2,
  Monitor,
  MonitorOff,
  Square,
  Video,
} from "lucide-react";
import { LevelMeter, useAudioLevel } from "@/components/recording/level-meter";
import { useTakeRecorder } from "@/components/recording/use-take-recorder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RECORDING_LIMITS } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import {
  canRecordVideoHere,
  closeStream,
  listDevices,
  openCamera,
  openScreen,
  saveCamera,
  saveContributor,
  saveMicrophone,
  savedCamera,
  savedContributor,
  savedMicrophone,
} from "@/lib/recording/camera";
import { formatBytes, formatDuration } from "@/lib/recording/format";
import { readRecording, storageStatus } from "@/lib/recording/store";
import { RecordingUploader, type StreamUpload, type UploadSnapshot } from "@/lib/recording/uploader";
import { CAMERA_PROBLEM_MESSAGES, SCREEN_PROBLEM_MESSAGES, pickVideoMimeType, videoExtensionFor } from "@/lib/recording/video";
import { cn } from "@/lib/utils";

/**
 * Less room than this and a long take may not fit: about 20 minutes of camera
 * and a busy screen at their highest rates. Chrome only lets a site use a share
 * of the free disk, so a higher bar would warn nearly everyone.
 */
const LOW_SPACE_BYTES = 4 * 1024 * 1024 * 1024;

const EMPTY: UploadSnapshot = { loaded: false, streams: [], retrying: null, online: true, gone: false };

/** The uploader for this link, running for as long as the page is open. */
function useUploads(linkId: string, ownerId: string) {
  const [snapshot, setSnapshot] = useState<UploadSnapshot>(EMPTY);
  const uploader = useRef<RecordingUploader | null>(null);

  useEffect(() => {
    if (!canRecordVideoHere()) return;
    const u = new RecordingUploader(linkId, ownerId, setSnapshot);
    uploader.current = u;
    const stop = u.start();
    return () => {
      stop();
      uploader.current = null;
    };
  }, [linkId, ownerId]);

  const poke = useCallback(() => uploader.current?.poke(), []);
  return { snapshot, poke };
}

export function RecordStudio({ linkId }: { linkId: string }) {
  const ownerId = `record:${linkId}`;
  const { snapshot, poke } = useUploads(linkId, ownerId);
  const take = useTakeRecorder({ linkId: linkId, ownerId, onChunk: poke });

  const [supported, setSupported] = useState<boolean | null>(null);
  const [lowSpace, setLowSpace] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [microphoneId, setMicrophoneId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [finishedTakes, setFinishedTakes] = useState(0);
  const level = useAudioLevel(camera);

  useEffect(() => {
    const ok = canRecordVideoHere() && pickVideoMimeType((t) => MediaRecorder.isTypeSupported(t), true) !== null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- what the browser supports, and what it remembers, is only known here
    setSupported(ok);
    setName(savedContributor() ?? "");
    if (!ok) return;
    void storageStatus().then((s) => {
      if (s.quota !== null && s.usage !== null && s.quota - s.usage < LOW_SPACE_BYTES) setLowSpace(s.quota - s.usage);
    });
  }, []);

  const turnOnCamera = useCallback(async (cam: string | null, mic: string | null) => {
    setOpening(true);
    setCameraError(null);
    const opened = await openCamera(cam, mic);
    setOpening(false);
    if (!opened.ok) {
      setCameraError(CAMERA_PROBLEM_MESSAGES[opened.problem]);
      return;
    }
    setCamera((previous) => {
      closeStream(previous);
      return opened.stream;
    });
    setCameraId(opened.cameraId);
    setMicrophoneId(opened.microphoneId);
    saveCamera(opened.cameraId);
    saveMicrophone(opened.microphoneId);
    const devices = await listDevices().catch(() => null);
    if (devices) {
      setCameras(devices.cameras);
      setMicrophones(devices.microphones);
    }
  }, []);

  async function shareScreen() {
    setScreenError(null);
    const opened = await openScreen();
    if (!opened.ok) {
      setScreenError(SCREEN_PROBLEM_MESSAGES[opened.problem]);
      return;
    }
    setScreen((previous) => {
      closeStream(previous);
      return opened.stream;
    });
    for (const track of opened.stream.getVideoTracks()) {
      // Ended from the browser's own "Stop sharing" bar: forget it.
      track.addEventListener("ended", () => setScreen((s) => (s === opened.stream ? null : s)));
    }
  }

  function stopSharing() {
    closeStream(screen);
    setScreen(null);
  }

  const trimmedName = name.trim();
  const ready = camera !== null && trimmedName !== "" && !snapshot.gone;

  async function record() {
    if (!camera || !trimmedName) return;
    saveContributor(trimmedName);
    await take.start(camera, screen, trimmedName);
  }

  // Takes this browser was still holding when the page opened: a tab closed before its upload finished.
  const [resumed, setResumed] = useState<Set<string> | null>(null);
  if (resumed === null && snapshot.loaded) setResumed(new Set(snapshot.streams.map((s) => s.takeId)));
  const resuming = resumed !== null && snapshot.streams.some((s) => resumed.has(s.takeId));
  const resumedDone = resumed !== null && resumed.size > 0 && !resuming ? resumed.size : 0;

  // Every take that ends, by Stop or by itself, counts as finished.
  const [wasRecording, setWasRecording] = useState(false);
  if (take.recording !== wasRecording) {
    setWasRecording(take.recording);
    if (wasRecording && !take.recording) setFinishedTakes((n) => n + 1);
  }

  // Release the devices on the way out.
  const streams = useRef({ camera, screen });
  useEffect(() => {
    streams.current = { camera, screen };
  }, [camera, screen]);
  useEffect(
    () => () => {
      closeStream(streams.current.camera);
      closeStream(streams.current.screen);
    },
    [],
  );

  const uploading = snapshot.streams.length > 0;
  useEffect(() => {
    if (!take.recording && !uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [take.recording, uploading]);

  if (supported === false) {
    return (
      <Page>
        <Banner tone="fail" icon={<AlertTriangle />}>
          This browser can&apos;t record here. Open this link in a current Chrome or Edge on a Mac or Windows computer.
        </Banner>
      </Page>
    );
  }

  const locked = take.recording || take.state === "starting";

  return (
    <Page>
      {snapshot.gone && (
        <Banner tone="fail" icon={<AlertTriangle />}>
          This recording link has been replaced, so it can&apos;t take new recordings. Ask whoever sent it for the new one.
        </Banner>
      )}
      {resuming && (
        <Banner tone="info" icon={<CloudUpload />}>
          <span className="font-medium">Finishing your earlier upload.</span> Your last recording was saved on this computer
          and is uploading now, so there&apos;s no need to record it again. Keep this window open until it&apos;s complete.
        </Banner>
      )}
      {lowSpace !== null && (
        <Banner tone="warn" icon={<AlertTriangle />}>
          This browser has about {formatBytes(lowSpace)} of space for recordings, enough for roughly{" "}
          {Math.max(1, Math.floor(lowSpace / (24_000_000 / 8) / 60))} minutes of camera and screen. Keep takes short, or
          free up disk space and reload this page.
        </Banner>
      )}

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        <div className="divide-y">
          <Section title="Your name">
            <Input
              aria-label="Your name"
              placeholder="First and last name"
              autoComplete="name"
              value={name}
              maxLength={RECORDING_LIMITS.contributor}
              disabled={locked}
              onChange={(e) => setName(e.target.value)}
              className="max-w-sm"
            />
          </Section>

          <Section title="Camera and microphone">
            <div className="grid gap-4 sm:grid-cols-2">
              <Preview stream={camera} mirrored placeholder={<Camera className="size-6" />} />
              <div className="flex flex-col gap-3">
                {camera ? (
                  <>
                    <DeviceSelect
                      label="Camera"
                      devices={cameras}
                      value={cameraId}
                      disabled={locked || opening}
                      onChange={(id) => void turnOnCamera(id, microphoneId)}
                    />
                    <DeviceSelect
                      label="Microphone"
                      devices={microphones}
                      value={microphoneId}
                      disabled={locked || opening}
                      onChange={(id) => void turnOnCamera(cameraId, id)}
                    />
                    <div className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Input level</span>
                      <LevelMeter level={level} />
                    </div>
                  </>
                ) : (
                  <>
                    <Button
                      variant="brand"
                      className="self-start"
                      disabled={opening || supported === null}
                      onClick={() => void turnOnCamera(savedCamera(), savedMicrophone())}
                    >
                      {opening ? <Loader2 className="animate-spin" /> : <Camera />}
                      Turn on camera
                    </Button>
                    <p className="text-muted-foreground">Your browser will ask to use your camera and microphone.</p>
                  </>
                )}
                {cameraError && (
                  <p role="alert" className="text-destructive">
                    {cameraError}
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section title="Screen" badge="Optional">
            <div className={cn("grid gap-4", screen && "sm:grid-cols-2")}>
              {screen && <Preview stream={screen} placeholder={<Monitor className="size-6" />} />}
              <div className="flex flex-col gap-3">
                <p className="text-muted-foreground">
                  {screen
                    ? `Sharing ${surfaceName(screen)}${screen.getAudioTracks().length > 0 ? ", with its sound" : ""}. It records as a separate file.`
                    : "Share your screen if you're presenting slides or a demo. It records as a separate file."}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={locked || supported === null} onClick={() => void shareScreen()}>
                    <Monitor />
                    {screen ? "Share something else" : "Share screen"}
                  </Button>
                  {screen && !locked && (
                    <Button variant="ghost" onClick={stopSharing}>
                      <MonitorOff />
                      Stop sharing
                    </Button>
                  )}
                </div>
                {screenError && (
                  <p role="alert" className="text-destructive">
                    {screenError}
                  </p>
                )}
              </div>
            </div>
          </Section>
        </div>

        <RecordBar
          take={take}
          ready={ready}
          hint={
            snapshot.gone
              ? null
              : !trimmedName && !camera
                ? "Enter your name and turn on your camera to start."
                : !trimmedName
                  ? "Enter your name to start."
                  : !camera
                    ? "Turn on your camera to start."
                    : screen
                      ? "Ready to record your camera and screen."
                      : "Ready to record your camera."
          }
          again={finishedTakes > 0}
          onRecord={() => void record()}
        />
      </motion.div>

      <UploadStatus snapshot={snapshot} recording={take.recording} finishedTakes={finishedTakes + resumedDone} />
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.h1 variants={riseChild} className="text-3xl font-medium tracking-tight">
        Harness Training Recorder
      </motion.h1>

      <motion.ul variants={riseChild} className="grid gap-2 rounded-2xl border bg-card px-5 py-4 text-sm shadow-sm">
        <Instruction n={1}>Enter your name and turn on your camera. Share your screen too if you&apos;re showing something.</Instruction>
        <Instruction n={2}>Press Start recording, and Stop when you&apos;re done. You can record more than one take.</Instruction>
        <Instruction n={3}>
          <span className="font-medium">Keep this window open until the upload says it&apos;s complete.</span> Your
          recording is saved on this computer as you go. If the window closes early, open this same link again in the same
          browser to finish the upload.
        </Instruction>
        <li className="pl-8 text-muted-foreground">Use Chrome or Edge on a computer, in a normal window rather than a private or incognito one.</li>
      </motion.ul>

      {children}
    </motion.div>
  );
}

function Instruction({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-medium text-brand tabular-nums">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function Section({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 px-5 py-4">
      <h2 className="flex items-center gap-2 text-base font-medium">
        {title}
        {badge && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {badge}
          </Badge>
        )}
      </h2>
      {children}
    </section>
  );
}

/** Start and Stop, with what a take will record or how long this one has run. */
function RecordBar({
  take,
  ready,
  hint,
  again,
  onRecord,
}: {
  take: ReturnType<typeof useTakeRecorder>;
  ready: boolean;
  hint: string | null;
  again: boolean;
  onRecord: () => void;
}) {
  const message = take.error ?? take.notice;
  return (
    <div className="space-y-2 border-t bg-muted/30 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {take.recording ? (
          <span className="flex items-center gap-2 font-medium" role="status">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
            </span>
            Recording {take.screenRecording ? "camera and screen" : "camera"}
            <span className="tabular-nums text-muted-foreground">{formatDuration(take.elapsedMs)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{hint}</span>
        )}
        {take.recording ? (
          <Button variant="outline" onClick={() => void take.stop()} disabled={take.state === "stopping"}>
            {take.state === "stopping" ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
            Stop recording
          </Button>
        ) : (
          <Button variant="brand" disabled={!ready || take.state === "starting"} onClick={onRecord}>
            {take.state === "starting" ? <Loader2 className="animate-spin" /> : <Video />}
            {again ? "Record another take" : "Start recording"}
          </Button>
        )}
      </div>
      {message && (
        <p role={take.error ? "alert" : "status"} className={cn(take.error && take.recording ? "text-destructive" : "text-muted-foreground")}>
          {message}
        </p>
      )}
    </div>
  );
}

/** Where the upload stands: what is still to send, whether the connection is holding, and when it is done. */
function UploadStatus({ snapshot, recording, finishedTakes }: { snapshot: UploadSnapshot; recording: boolean; finishedTakes: number }) {
  const { streams } = snapshot;
  if (streams.length === 0) {
    if (finishedTakes === 0 || recording) return null;
    return (
      <Banner tone="pass" icon={<CheckCircle2 />}>
        <span className="font-medium">Upload complete.</span>{" "}
        {finishedTakes === 1 ? "Your recording has" : `All ${finishedTakes} takes have`} been received. You can close this
        window, or record another take.
      </Banner>
    );
  }

  const offline = !snapshot.online;
  const sentBytes = streams.reduce((n, s) => n + (s.chunks ? (s.bytes * s.uploaded) / s.chunks : 0), 0);
  const totalBytes = streams.reduce((n, s) => n + s.bytes, 0);
  const joining = !recording && streams.every((s) => s.assembling);
  const paused = offline || snapshot.retrying !== null;

  return (
    <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
      <div className="flex items-start gap-3 px-5 py-4">
        <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", paused ? "text-amber-600 dark:text-amber-500" : "text-brand")}>
          {paused ? <CloudOff /> : joining ? <Loader2 className="animate-spin" /> : <CloudUpload />}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">
            {offline
              ? "You're offline"
              : snapshot.retrying
                ? "Upload paused"
                : joining
                  ? "Finishing up"
                  : recording
                    ? "Uploading as you record"
                    : "Uploading"}
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {formatBytes(sentBytes)} of {formatBytes(totalBytes)}
            </span>
          </p>
          <p className="text-muted-foreground">
            {paused
              ? "Your recording is safe on this computer. The upload will resume on its own when the connection is back."
              : recording
                ? "Anything not sent by the time you stop is sent afterwards."
                : "Don't close this window until the upload is complete."}
          </p>
        </div>
      </div>
      {streams.map((s) => (
        <StreamRow key={s.recordingId} stream={s} />
      ))}
    </motion.div>
  );
}

function StreamRow({ stream: s }: { stream: StreamUpload }) {
  const [saving, setSaving] = useState(false);
  const pct = s.chunks === 0 ? 0 : Math.round((s.uploaded / s.chunks) * 100);

  /** A copy straight from this browser's store, in case the upload never gets through. */
  async function saveCopy() {
    setSaving(true);
    try {
      const blob = await readRecording(s.recordingId);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${s.kind}.${videoExtensionFor(blob.type)}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <span className="flex w-20 items-center gap-2 font-medium">
        {s.kind === "camera" ? <Camera className="size-3.5" /> : <Monitor className="size-3.5" />}
        {s.kind === "camera" ? "Camera" : "Screen"}
      </span>
      <div
        className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${s.kind === "camera" ? "Camera" : "Screen"} upload`}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-28 text-right text-muted-foreground tabular-nums">
        {s.assembling ? "Finishing" : s.recording ? `${formatBytes(s.bytes)} so far` : `${pct}%`}
      </span>
      {!s.recording && (
        <Button
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={() => void saveCopy()}
          aria-label={`Save a copy of the ${s.kind} recording to this computer`}
        >
          {saving ? <Loader2 className="animate-spin" /> : <Download />}
          Save a copy
        </Button>
      )}
    </div>
  );
}

/** "your entire screen", "a window", "a browser tab". */
function surfaceName(stream: MediaStream): string {
  const surface = (stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface;
  if (surface === "monitor") return "your entire screen";
  if (surface === "window") return "a window";
  if (surface === "browser") return "a browser tab";
  return "your screen";
}

function Preview({ stream, mirrored = false, placeholder }: { stream: MediaStream | null; mirrored?: boolean; placeholder: ReactNode }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
      {stream ? (
        <video ref={ref} autoPlay muted playsInline className={cn("size-full object-contain", mirrored && "-scale-x-100")} />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">{placeholder}</div>
      )}
    </div>
  );
}

function DeviceSelect({
  label,
  devices,
  value,
  disabled,
  onChange,
}: {
  label: string;
  devices: MediaDeviceInfo[];
  value: string | null;
  disabled: boolean;
  onChange: (deviceId: string | null) => void;
}) {
  if (devices.length === 0) return null;
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        className="h-9 w-full max-w-full rounded-md border border-input bg-field px-2 text-sm"
      >
        {value === null && <option value="">Default {label.toLowerCase()}</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function Banner({ tone, icon, children }: { tone: "pass" | "info" | "warn" | "fail"; icon: ReactNode; children: ReactNode }) {
  return (
    <motion.div
      variants={riseChild}
      role={tone === "fail" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-2xl border bg-card px-5 py-4 text-sm shadow-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "pass" && "[&_svg]:text-emerald-600 dark:[&_svg]:text-emerald-500",
        tone === "info" && "[&_svg]:text-brand",
        tone === "warn" && "[&_svg]:text-amber-600 dark:[&_svg]:text-amber-500",
        tone === "fail" && "[&_svg]:text-destructive",
      )}
    >
      {icon}
      <span>{children}</span>
    </motion.div>
  );
}
