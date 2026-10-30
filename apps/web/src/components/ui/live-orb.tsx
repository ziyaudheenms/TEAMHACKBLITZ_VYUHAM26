"use client";

import {
  ConversationProvider,
  useConversationControls,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sessionStore } from "@/services/http";

const apiBaseUrl = () =>
  (typeof window !== "undefined" && localStorage.getItem("bizcontext_api_url")) ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001/api/v1";

const requestHeaders = () => {
  const session = sessionStore.get();
  return {
    "Content-Type": "application/json",
    ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    ...(session?.organisationId ? { "X-Organisation-Id": session.organisationId } : {}),
    ...(session?.user.id ? { "X-User-Id": session.user.id } : {}),
  };
};

/** The 23rd-style flat sphere: two capsule eyes follow the visitor's pointer. */
function OrbEyes() {
  const faceRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const followPointer = (event: PointerEvent) => {
      const face = faceRef.current;
      if (!face) return;
      const bounds = face.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2)));
      const y = Math.max(-1, Math.min(1, (event.clientY - (bounds.top + bounds.height / 2)) / (bounds.height / 2)));
      face.style.setProperty("--orb-gaze-x", `${x * 6}px`);
      face.style.setProperty("--orb-gaze-y", `${y * 5}px`);
    };
    window.addEventListener("pointermove", followPointer, { passive: true });
    return () => window.removeEventListener("pointermove", followPointer);
  }, []);

  return (
    <span ref={faceRef} className="live-orb__face" aria-hidden="true">
      <span className="live-orb__eye live-orb__eye--left" />
      <span className="live-orb__eye live-orb__eye--right" />
    </span>
  );
}

function OrbControl() {
  const { startSession, endSession } = useConversationControls();
  const { status, message } = useConversationStatus();
  const { isListening, isSpeaking } = useConversationMode();
  const [error, setError] = useState<string | null>(null);
  const [isPressed, setIsPressed] = useState(false);

  const label = useMemo(() => {
    if (status === "connecting") return "Connecting";
    if (status === "connected" && isSpeaking) return "Speaking";
    if (status === "connected" && isListening) return "Listening";
    if (status === "connected") return "Connected";
    return "Ask BizContext";
  }, [isListening, isSpeaking, status]);

  const toggleConversation = useCallback(async () => {
    setIsPressed(true);
    window.setTimeout(() => setIsPressed(false), 420);
    if (status === "connected" || status === "connecting") {
      endSession();
      return;
    }
    setError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const response = await fetch(`${apiBaseUrl()}/ai/live-orb/signed-url`, { headers: requestHeaders() });
      const body = (await response.json().catch(() => ({}))) as { signedUrl?: string; error?: string };
      if (!response.ok || !body.signedUrl) throw new Error(body.error || "Voice assistant is unavailable.");
      startSession({ signedUrl: body.signedUrl });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the voice assistant.");
    }
  }, [endSession, startSession, status]);

  const active = status === "connected" || status === "connecting";
  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-[70] flex flex-col items-end gap-1.5 sm:gap-2">
      {(error || (status === "error" && message)) && <p role="status" className="max-w-[80vw] sm:max-w-72 rounded-2xl bg-[#262626] px-3.5 py-2.5 sm:px-4 sm:py-3 text-xs sm:text-sm leading-relaxed text-white shadow-xl">{error || message}</p>}
      <button aria-label={active ? "End voice conversation" : "Start voice conversation"} aria-pressed={active} className={`live-orb group relative grid h-16 w-16 sm:h-24 sm:w-24 place-items-center rounded-full border border-white/20 shadow-[0_12px_35px_rgba(58,116,238,0.35)] transition-transform hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#74D96F]/50 ${active ? "live-orb--active" : ""} ${isPressed ? "live-orb--pressed" : ""}`} onClick={toggleConversation}>
        <span className="live-orb__glow" aria-hidden="true" />
        <span className="live-orb__ripple" aria-hidden="true" />
        <OrbEyes />
      </button>
      <span className="rounded-full bg-white/90 px-2 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-semibold uppercase tracking-[0.12em] text-[#555] shadow-sm backdrop-blur"><Sparkles className="mr-1 inline h-2.5 w-2.5 sm:h-3 sm:w-3 text-[#56BE51]" />{label}</span>
    </div>
  );
}

/** ElevenLabs handles real-time microphone and speaker audio; Gemini stays behind the API. */
export function LiveOrb() {
  const askGemini = useCallback(async ({ question }: { question: string }) => {
    const response = await fetch(`${apiBaseUrl()}/ai/live-orb`, { method: "POST", headers: requestHeaders(), body: JSON.stringify({ prompt: question }) });
    const body = (await response.json().catch(() => ({}))) as { response?: string; error?: string };
    if (!response.ok) throw new Error(body.error || "Gemini could not answer this request.");
    return body.response || "I could not find an answer.";
  }, []);

  return <ConversationProvider clientTools={{ askGemini }}><OrbControl /></ConversationProvider>;
}
