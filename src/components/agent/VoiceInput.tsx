"use client";

import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Voice is an input method, not a separate agent (docs/leave_agent.md §22): the browser's speech recognition turns
 * speech into text that is ADDED TO THE EDITABLE COMPOSER. Nothing is ever sent automatically and no audio reaches
 * this application. The microphone permission is asked only when the user presses the button; a visible indicator
 * and a stop button show while listening, and listening stops on its own after MAX_LISTEN_MS.
 */

const MAX_LISTEN_MS = 30_000;

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
  length: number;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

export function speechRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it in the browser to use voice.",
  "service-not-allowed": "Voice input is not allowed in this browser.",
  "no-speech": "No speech was heard. Try again.",
  "audio-capture": "No microphone was found.",
  network: "The browser's speech service could not be reached.",
};

export interface VoiceInputProps {
  /** Receives each final piece of transcript; the caller appends it to the editable composer text. */
  onTranscript: (text: string) => void;
  disabled?: boolean;
  lang?: string;
}

export function VoiceInput({ onTranscript, disabled = false, lang }: VoiceInputProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callback = useRef(onTranscript);
  callback.current = onTranscript;

  useEffect(() => setSupported(speechRecognitionCtor() !== null), []);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    recognition.current?.stop();
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    recognition.current?.abort();
  }, []);

  const start = () => {
    const Ctor = speechRecognitionCtor();
    if (!Ctor || listening) return;
    setError(null);
    setInterim("");
    const rec = new Ctor();
    rec.lang = lang || (typeof navigator !== "undefined" ? navigator.language : "") || "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let live = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? "";
        if (result.isFinal) {
          const text = piece.trim();
          if (text) callback.current(text);
        } else {
          live += piece;
        }
      }
      setInterim(live);
    };
    rec.onerror = (event) => setError(ERRORS[event.error ?? ""] ?? "Voice input stopped.");
    rec.onend = () => {
      setListening(false);
      setInterim("");
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    recognition.current = rec;
    try {
      rec.start(); // the browser asks for the microphone now, after the click
      setListening(true);
      timer.current = setTimeout(stop, MAX_LISTEN_MS);
    } catch {
      setError("Voice input could not start.");
    }
  };

  if (!supported) return null;

  return (
    <div className="flex items-center gap-2">
      {listening ? (
        <Button size="sm" variant="danger-ghost" onClick={stop} aria-label="Stop voice input">
          <Square className="h-3.5 w-3.5 fill-current" aria-hidden />
          Stop
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={start} disabled={disabled} aria-label="Speak your message" title="Speak your message">
          <Mic className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {listening && (
        <span className="flex items-center gap-1.5 text-xs text-danger" role="status" data-testid="agent-voice-listening">
          <span className="h-2 w-2 animate-pulse rounded-full bg-danger" aria-hidden />
          Listening… {interim && <span className="max-w-[16rem] truncate text-muted-foreground">{interim}</span>}
        </span>
      )}
      {error && !listening && <span className="text-xs text-danger" role="alert">{error}</span>}
    </div>
  );
}
