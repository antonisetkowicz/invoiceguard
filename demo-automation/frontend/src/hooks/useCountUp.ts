import { useEffect, useRef, useState } from "react";

/** Smoothly animates a displayed number toward `target` whenever it changes. */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const start = value;
    const delta = target - start;
    if (delta === 0) return;

    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(start + delta * eased);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}
