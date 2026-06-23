import { useState, useRef, useCallback, useEffect } from 'react';
import { Audio } from 'expo-av';

const MAX_DURATION_MS = 30_000;

interface RecorderState {
  isRecording: boolean;
  duration: number;
  metering: number[];
  uri: string | null;
  error: string | null;
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>({
    isRecording: false,
    duration: 0,
    metering: [],
    uri: null,
    error: null,
  });

  const recordingRef = useRef<Audio.Recording | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        setState(s => ({ ...s, error: 'Microphone permission required' }));
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
      startTimeRef.current = Date.now();

      setState({
        isRecording: true,
        duration: 0,
        metering: [],
        uri: null,
        error: null,
      });

      intervalRef.current = setInterval(async () => {
        if (!recordingRef.current) return;

        const elapsed = Date.now() - startTimeRef.current;
        const status = await recordingRef.current.getStatusAsync();

        setState(s => ({
          ...s,
          duration: Math.floor(elapsed / 1000),
          metering: [...s.metering.slice(-49), status.metering ?? -60],
        }));

        if (elapsed >= MAX_DURATION_MS) {
          await stopRecording();
        }
      }, 100);
    } catch (err) {
      setState(s => ({ ...s, error: 'Failed to start recording' }));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      const elapsed = Math.ceil((Date.now() - startTimeRef.current) / 1000);

      recordingRef.current = null;

      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      setState(s => ({
        ...s,
        isRecording: false,
        duration: Math.min(elapsed, 30),
        uri: uri || null,
      }));
    } catch (err) {
      setState(s => ({ ...s, isRecording: false, error: 'Failed to stop recording' }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      isRecording: false,
      duration: 0,
      metering: [],
      uri: null,
      error: null,
    });
  }, []);

  return { ...state, startRecording, stopRecording, reset };
}
