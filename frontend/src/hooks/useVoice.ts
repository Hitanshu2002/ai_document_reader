// useVoice hook — Speech recognition (input) and speech synthesis (output)
import { useState, useCallback, useEffect, useRef } from 'react';
import type { VoiceLanguage, VoiceState } from '../types';

// SpeechRecognition type definitions
interface ISpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface ISpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: ISpeechRecognitionEvent) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: ISpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => ISpeechRecognition;
    webkitSpeechRecognition: new () => ISpeechRecognition;
  }
}

export function useVoice() {
  const [voiceState, setVoiceState] = useState<VoiceState>({
    isListening: false,
    isSpeaking: false,
    transcript: '',
    language: 'en-US',
    isSupported: false,
  });

  const recognitionRef = useRef<ISpeechRecognition | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  // Check support on mount
  useEffect(() => {
    const SpeechRecognitionAPI: (new () => ISpeechRecognition) | undefined =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const isRecognitionSupported = !!SpeechRecognitionAPI;
    const isSynthSupported = 'speechSynthesis' in window;

    setVoiceState((prev) => ({
      ...prev,
      isSupported: isRecognitionSupported && isSynthSupported,
    }));

    if (isSynthSupported) {
      synthRef.current = window.speechSynthesis;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  const startListening = useCallback(
    (onResult: (transcript: string) => void, onEnd?: () => void) => {
      const SpeechRecognitionAPI: (new () => ISpeechRecognition) | undefined =
      window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognitionAPI) {
        console.warn('Speech recognition not supported');
        return;
      }

      const recognition = new SpeechRecognitionAPI();
      recognition.lang = voiceState.language;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setVoiceState((prev) => ({ ...prev, isListening: true, transcript: '' }));
      };

      recognition.onresult = (event: ISpeechRecognitionEvent) => {
        const transcript = Array.from(event.results)
          .map((result) => result[0].transcript)
          .join('');
        setVoiceState((prev) => ({ ...prev, transcript }));

        if (event.results[event.results.length - 1].isFinal) {
          onResult(transcript);
        }
      };

      recognition.onerror = (event: ISpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        setVoiceState((prev) => ({
          ...prev,
          isListening: false,
          transcript: '',
        }));
      };

      recognition.onend = () => {
        setVoiceState((prev) => ({
          ...prev,
          isListening: false,
          transcript: '',
        }));
        onEnd?.();
      };

      recognitionRef.current = recognition;
      recognition.start();
    },
    [voiceState.language]
  );

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setVoiceState((prev) => ({ ...prev, isListening: false }));
  }, []);

  const speak = useCallback(
    (
      text: string,
      lang?: VoiceLanguage,
      onStart?: () => void,
      onEnd?: () => void
    ) => {
      if (!synthRef.current) return;

      // Cancel any ongoing speech
      synthRef.current.cancel();

      // Remove markdown and LaTeX for TTS
      const cleanText = text
        .replace(/\$\$[\s\S]*?\$\$/g, 'math expression')
        .replace(/\$[^$]*?\$/g, 'math expression')
        .replace(/#{1,6}\s/g, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[-*+]\s/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = lang || voiceState.language;
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.volume = 1;

      // Dynamically select the best voice matching target language
      const voices = window.speechSynthesis.getVoices();
      let selectedVoice = null;
      if (utterance.lang.startsWith('hi')) {
        selectedVoice =
          voices.find(
            (v) => v.lang.startsWith('hi') || v.lang.includes('Hindi')
          ) || null;
      } else {
        selectedVoice =
          voices.find(
            (v) => v.lang.startsWith('en') || v.lang.includes('English')
          ) || null;
      }

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => {
        setVoiceState((prev) => ({ ...prev, isSpeaking: true }));
        onStart?.();
      };

      utterance.onend = () => {
        setVoiceState((prev) => ({ ...prev, isSpeaking: false }));
        onEnd?.();
      };

      utterance.onerror = (e) => {
        console.error('Speech synthesis error:', e);
        setVoiceState((prev) => ({ ...prev, isSpeaking: false }));
        onEnd?.();
      };

      // Workaround for Chrome bug where speechSynthesis fails if called immediately after cancel
      setTimeout(() => {
        if (synthRef.current) {
          synthRef.current.speak(utterance);
        }
      }, 100);
    },
    [voiceState.language]
  );

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setVoiceState((prev) => ({ ...prev, isSpeaking: false }));
  }, []);

  const setLanguage = useCallback((language: VoiceLanguage) => {
    setVoiceState((prev) => ({ ...prev, language }));
  }, []);

  return {
    voiceState,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    setLanguage,
  };
}
