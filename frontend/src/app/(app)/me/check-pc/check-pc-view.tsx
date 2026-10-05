"use client";

/**
 * Walks this computer through everything recording an assessment needs, so a
 * judge finds a blocked microphone or a full disk before the session rather
 * than during it: the browser, the site's microphone permission, which
 * microphone and whether it hears anything, a short recording saved to and
 * read back from this browser, and room to keep recordings.
 *
 * The test recording is kept in this browser, like any other, until the next
 * test replaces it. Its audio also goes to Deepgram, live while it records and
 * whole once it is saved, so the judge can see how well they are heard; every
 * request opts out of Deepgram keeping it (src/lib/recording/deepgram.ts).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Circle, Loader2, Mic, MicOff, ShieldCheck, XCircle } from "lucide-react";
import { LevelMeter, useAudioLevel } from "@/components/recording/level-meter";
import { RecordingList, useRecordings } from "@/components/recording/recording-list";
import { useLiveTranscript, type LiveTranscript } from "@/components/recording/use-live-transcript";
import { useRecorder } from "@/components/recording/use-recorder";
import { Button } from "@/components/ui/button";
import { riseChild, staggerParent } from "@/lib/motion";
import {
  MICROPHONE_PROBLEM_MESSAGES,
  formatBytes,
  formatDuration,
  pickMimeType,
} from "@/lib/recording/format";
import {
  canRecordHere,
  closeMicrophone,
  listMicrophones,
  microphonePermission,
  openMicrophone,
  saveMicrophone,
  savedMicrophone,
  type MicrophonePermission,
} from "@/lib/recording/microphone";
import {
  CHECK_PC_SUBJECT,
  deleteRecording,
  listRecordings,
  readRecording,
  recordingsSupported,
  requestPersistence,
  storageStatus,
  type StorageStatus,
} from "@/lib/recording/store";
import { cn } from "@/lib/utils";

type Status = "pass" | "warn" | "fail" | "pending";

/** The transcript of the whole saved test recording. */
type FullTranscript =
  | { status: "idle" | "working" | "unavailable" }
  | { status: "done"; text: string }
  | { status: "failed"; error: string };

const TEST_MS = 5_000;
/** A level the meter only reaches when someone speaks, not from fan noise. */
const HEARD_LEVEL = 0.35;
/** How long the microphone may hear nothing before that is worth saying. */
const SILENT_WARN_MS = 8_000;
/** Below this much room, an afternoon of assessments might not fit. */
const LOW_SPACE_BYTES = 500 * 1024 * 1024;

export function CheckPcView({ viewerId }: { viewerId: string }) {
  // ── 1. The browser ────────────────────────────────────────────────────────
  const [browser, setBrowser] = useState<{ ok: boolean; format: string | null; secure: boolean } | null>(null);
  useEffect(() => {
    const format = typeof MediaRecorder !== "undefined" ? pickMimeType((t) => MediaRecorder.isTypeSupported(t)) : null;
    // Read once on mount: these are facts about the browser, not state that changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrowser({ ok: canRecordHere() && recordingsSupported() && format !== null, format, secure: window.isSecureContext });
  }, []);

  // ── 2. Permission ─────────────────────────────────────────────────────────
  const [permission, setPermission] = useState<MicrophonePermission | null>(null);
  useEffect(() => {
    let unwatch = () => {};
    let live = true;
    void microphonePermission().then(({ state, watch }) => {
      if (!live) return;
      setPermission(state);
      unwatch = watch(setPermission);
    });
    return () => {
      live = false;
      unwatch();
    };
  }, []);

  // ── 3. The microphone itself ──────────────────────────────────────────────
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [micLabel, setMicLabel] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Whether this microphone has picked up speech since it was opened. */
  const [heard, setHeard] = useState(false);
  const [listeningSince, setListeningSince] = useState<number | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await listMicrophones());
    } catch {
      setDevices([]);
    }
  }, []);

  const listen = useCallback(
    async (id: string | null) => {
      setOpening(true);
      setMicError(null);
      closeMicrophone(streamRef.current);
      streamRef.current = null;
      setStream(null);
      setHeard(false);
      const mic = await openMicrophone(id);
      setOpening(false);
      if (!mic.ok) {
        setMicError(MICROPHONE_PROBLEM_MESSAGES[mic.problem]);
        if (mic.problem === "blocked" || mic.problem === "blocked_by_system") setPermission("denied");
        return;
      }
      streamRef.current = mic.stream;
      setStream(mic.stream);
      setListeningSince(Date.now());
      setMicLabel(mic.label);
      setDeviceId(mic.deviceId);
      saveMicrophone(mic.deviceId);
      setPermission((p) => (p === "unsupported" ? p : "granted"));
      await refreshDevices();
    },
    [refreshDevices],
  );

  const stopListening = useCallback(() => {
    closeMicrophone(streamRef.current);
    streamRef.current = null;
    setStream(null);
  }, []);

  useEffect(() => {
    listMicrophones().then(setDevices, () => setDevices([]));
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
      closeMicrophone(streamRef.current);
    };
  }, [refreshDevices]);

  const level = useAudioLevel(stream);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!stream) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [stream]);
  // Once heard, a microphone stays heard until another is opened.
  if (stream && !heard && level >= HEARD_LEVEL) setHeard(true);
  const silentTooLong = stream !== null && !heard && listeningSince !== null && now - listeningSince > SILENT_WARN_MS;

  // ── 4. A test recording ───────────────────────────────────────────────────
  const [version, setVersion] = useState(0);
  const [test, setTest] = useState<{ status: Status; message: string | null }>({ status: "pending", message: null });
  const { recordings } = useRecordings(viewerId, CHECK_PC_SUBJECT, version);
  const [full, setFull] = useState<FullTranscript>({ status: "idle" });

  const onSaved = useCallback(async (id: string) => {
    setVersion((v) => v + 1);
    let blob: Blob | null;
    try {
      blob = await readRecording(id);
    } catch (e) {
      setTest({ status: "fail", message: `The recording could not be read back: ${(e as Error)?.message ?? "unknown error"}.` });
      return;
    }
    if (!blob || blob.size === 0) {
      setTest({ status: "fail", message: "The recording came back empty." });
      return;
    }
    setTest({ status: "pass", message: `Saved and read back ${formatBytes(blob.size)}. Play it to hear how you sound.` });
    setFull({ status: "working" });
    setFull(await transcribeWhole(blob));
  }, []);

  const recorder = useRecorder({ ownerId: viewerId, subject: CHECK_PC_SUBJECT, label: "Check PC", onSaved });
  const live = useLiveTranscript(recorder.stream);

  useEffect(() => {
    if (recorder.state === "recording" && recorder.elapsedMs >= TEST_MS) void recorder.stop();
  }, [recorder]);

  async function runTest() {
    setTest({ status: "pending", message: null });
    setFull({ status: "idle" });
    live.begin();
    // One test recording at a time: the last run is the only one worth keeping.
    for (const old of await listRecordings(viewerId, CHECK_PC_SUBJECT).catch(() => [])) {
      await deleteRecording(old.id).catch(() => {});
    }
    setVersion((v) => v + 1);
    await recorder.start();
  }

  // ── 5. Room to keep recordings ────────────────────────────────────────────
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  useEffect(() => {
    void storageStatus().then(setStorage);
  }, [version]);
  const free = storage?.quota != null && storage.usage != null ? storage.quota - storage.usage : null;

  async function keepSafe() {
    await requestPersistence();
    setStorage(await storageStatus());
  }

  // ── The verdict ───────────────────────────────────────────────────────────
  const statuses = {
    browser: browser === null ? "pending" : browser.ok ? "pass" : "fail",
    permission:
      permission === "granted" ? "pass" : permission === "denied" ? "fail" : stream ? "pass" : "pending",
    microphone: micError ? "fail" : heard ? "pass" : silentTooLong ? "warn" : "pending",
    recording: recorder.error ? "fail" : test.status,
    storage: free === null ? "pending" : free < LOW_SPACE_BYTES ? "warn" : "pass",
  } satisfies Record<string, Status>;
  const all = Object.values(statuses) as Status[];
  const failing = all.filter((s) => s === "fail").length;
  const verdict: Status = failing > 0 ? "fail" : all.every((s) => s === "pass") ? "pass" : all.includes("warn") ? "warn" : "pending";

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="max-w-3xl space-y-4">
      <motion.div
        variants={riseChild}
        role="status"
        className={cn(
          "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
          verdict === "pass" && "border-emerald-500/40 bg-emerald-500/5",
          verdict === "fail" && "border-destructive/40 bg-destructive/5",
          verdict === "warn" && "border-amber-500/40 bg-amber-500/5",
        )}
      >
        <StatusIcon status={verdict} className="size-5" />
        <span className="font-medium">
          {verdict === "pass"
            ? "This computer is ready to record assessments."
            : verdict === "fail"
              ? `${failing} ${failing === 1 ? "check needs" : "checks need"} fixing before this computer can record.`
              : verdict === "warn"
                ? "This computer can record, but look at the warnings below."
                : `${all.filter((s) => s === "pass").length} of ${all.length} checks passed — work through the rest below.`}
        </span>
      </motion.div>

      <motion.div
        variants={staggerParent(0.04)}
        className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm"
      >
        <Step n={1} title="Browser" status={statuses.browser}>
          {browser &&
            (browser.ok ? (
              <p>Records {browser.format}.</p>
            ) : !browser.secure ? (
              <p>This page is not on a secure (HTTPS) address, so the browser will not offer the microphone.</p>
            ) : (
              <p>{MICROPHONE_PROBLEM_MESSAGES.unsupported}</p>
            ))}
        </Step>

        <Step n={2} title="Microphone access" status={statuses.permission}>
          {permission === "denied" ? (
            <div className="space-y-2">
              <p>{micError ?? MICROPHONE_PROBLEM_MESSAGES.blocked}</p>
              <p className="text-muted-foreground">
                On a Mac, if the site is already allowed, the block is in System Settings → Privacy &amp; Security →
                Microphone: turn your browser on there, then quit and reopen it.
              </p>
            </div>
          ) : permission === "granted" || stream ? (
            <p>Allowed for this site. The browser will not ask again.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="brand" size="sm" onClick={() => void listen(savedMicrophone())} disabled={opening || !browser?.ok}>
                {opening ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                Allow microphone
              </Button>
              <span className="text-muted-foreground">
                {permission === "unsupported"
                  ? "This browser asks each time; allow it when it does."
                  : "Your browser will ask. Choose Allow, and on a Mac allow your computer's prompt too."}
              </span>
            </div>
          )}
        </Step>

        <Step n={3} title="Microphone" status={statuses.microphone}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              {devices.length > 0 && (
                <select
                  aria-label="Microphone"
                  value={deviceId ?? ""}
                  onChange={(e) => void listen(e.target.value || null)}
                  className="h-8 max-w-full rounded-md border border-input bg-field px-2 text-sm"
                >
                  {deviceId === null && <option value="">Default microphone</option>}
                  {devices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              {stream ? (
                <Button variant="outline" size="sm" onClick={stopListening}>
                  <MicOff />
                  Stop listening
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void listen(deviceId ?? savedMicrophone())}
                  disabled={opening || !browser?.ok || permission === "denied"}
                >
                  {opening ? <Loader2 className="animate-spin" /> : <Mic />}
                  Listen
                </Button>
              )}
            </div>
            {stream && (
              <div className="space-y-1.5">
                <LevelMeter level={level} />
                <p className={cn(silentTooLong ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>
                  {heard
                    ? `Hearing you on ${micLabel || "this microphone"}. Assessments record from it.`
                    : silentTooLong
                      ? "Nothing heard yet. Speak up, check for a mute switch, or pick another microphone."
                      : "Say something — the bar should move."}
                </p>
              </div>
            )}
            {micError && permission !== "denied" && (
              <p role="alert" className="text-destructive">
                {micError}
              </p>
            )}
          </div>
        </Step>

        <Step n={4} title="Test recording" status={statuses.recording}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runTest()}
                disabled={recorder.state !== "idle" || !browser?.ok || permission === "denied"}
              >
                {recorder.recording ? <Loader2 className="animate-spin" /> : <Mic />}
                {recorder.recording
                  ? `Recording… ${formatDuration(Math.max(0, TEST_MS - recorder.elapsedMs))}`
                  : `Record ${TEST_MS / 1000} seconds`}
              </Button>
              {(recorder.error ?? test.message) && (
                <span className={cn(statuses.recording === "fail" ? "text-destructive" : "text-muted-foreground")}>
                  {recorder.error ?? test.message}
                </span>
              )}
            </div>
            {!recorder.recording && recordings && (
              <RecordingList
                recordings={recordings.filter((r) => r.status !== "recording")}
                onDeleted={() => {
                  setVersion((v) => v + 1);
                  setTest({ status: "pending", message: null });
                  setFull({ status: "idle" });
                  live.clear();
                }}
              />
            )}
            <Transcripts live={live} full={full} recording={recorder.recording} />
          </div>
        </Step>

        <Step n={5} title="Room for recordings" status={statuses.storage}>
          {storage && (
            <div className="space-y-2">
              <p>
                {free === null
                  ? "This browser does not say how much room it has."
                  : `${formatBytes(free)} free for this site — about ${Math.floor(free / (14 * 1024 * 1024))} hours of audio.`}
                {storage.usage != null && ` Using ${formatBytes(storage.usage)}.`}
              </p>
              {storage.persisted ? (
                <p className="text-muted-foreground">The browser will not clear recordings to make room.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => void keepSafe()}>
                    <ShieldCheck />
                    Keep recordings when space runs low
                  </Button>
                  {storage.persisted === false && (
                    <span className="text-muted-foreground">
                      The browser decides; it often says yes once you use a site regularly.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </Step>
      </motion.div>
    </motion.div>
  );
}

async function transcribeWhole(blob: Blob): Promise<FullTranscript> {
  const form = new FormData();
  form.append("audio", blob, "check-pc");
  const res = await fetch("/api/transcription/transcribe", { method: "POST", body: form }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { transcript?: string; error?: string } | null;
  if (res?.ok && typeof body?.transcript === "string") return { status: "done", text: body.transcript };
  if (body?.error === "unconfigured") return { status: "unavailable" };
  return { status: "failed", error: "The full recording could not be transcribed." };
}

/**
 * What Deepgram made of the test: live while it records, then beside it the
 * transcript of the whole saved file — the one a scored assessment would get.
 */
function Transcripts({ live, full, recording }: { live: LiveTranscript; full: FullTranscript; recording: boolean }) {
  if (live.status === "idle" && full.status === "idle") return null;
  if (live.status === "unavailable" || full.status === "unavailable") {
    return <p className="text-muted-foreground">Transcription is not set up on this deployment.</p>;
  }
  const liveText = live.finals.join(" ");
  const showFull = !recording && full.status !== "idle";
  return (
    <div className="grid divide-y overflow-hidden rounded-lg border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
      <TranscriptPane title="Live" busy={live.status === "connecting" || live.status === "finishing"}>
        {live.error ? (
          <span className="text-destructive">{live.error}</span>
        ) : liveText || live.interim ? (
          <>
            {liveText}
            {live.interim && <span className="text-muted-foreground"> {live.interim}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">
            {live.status === "connecting" ? "Connecting…" : live.status === "live" ? "Listening — say something." : "Nothing heard."}
          </span>
        )}
      </TranscriptPane>
      <TranscriptPane title="Full recording" busy={full.status === "working" || (!showFull && !recording)}>
        {!showFull ? (
          <span className="text-muted-foreground">{recording ? "After the recording stops." : "Transcribing…"}</span>
        ) : full.status === "done" ? (
          full.text || <span className="text-muted-foreground">Nothing heard.</span>
        ) : full.status === "failed" ? (
          <span className="text-destructive">{full.error}</span>
        ) : (
          <span className="text-muted-foreground">Transcribing…</span>
        )}
      </TranscriptPane>
    </div>
  );
}

function TranscriptPane({ title, busy, children }: { title: string; busy: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {title}
        {busy && <Loader2 className="size-3 animate-spin" />}
      </p>
      <p className="min-h-10 leading-relaxed">{children}</p>
    </div>
  );
}

function Step({ n, title, status, children }: { n: number; title: string; status: Status; children: ReactNode }) {
  return (
    <motion.section variants={riseChild} className="space-y-3 px-5 py-4">
      <h3 className="flex items-center gap-2 text-base font-medium">
        <StatusIcon status={status} />
        {n}. {title}
      </h3>
      {children}
    </motion.section>
  );
}

function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const classes = cn("size-4 shrink-0", className);
  switch (status) {
    case "pass":
      return <CheckCircle2 className={cn(classes, "text-emerald-600 dark:text-emerald-500")} aria-label="Passed" />;
    case "fail":
      return <XCircle className={cn(classes, "text-destructive")} aria-label="Needs fixing" />;
    case "warn":
      return <AlertTriangle className={cn(classes, "text-amber-600 dark:text-amber-500")} aria-label="Warning" />;
    case "pending":
      return <Circle className={cn(classes, "text-muted-foreground")} aria-label="Not checked yet" />;
  }
}
