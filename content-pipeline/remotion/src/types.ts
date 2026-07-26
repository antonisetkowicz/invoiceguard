export type VisualKind =
  | "footage"
  | "text"
  | "gradient"
  | "shapes"
  | "counter"
  | "list"
  | "quote"
  | "image";

export type Scene = {
  text: string;
  duration_s: number;
  visual: {
    kind: VisualKind;
    /** Krótki tekst na ekranie — jeśli pusty, bierzemy `text` sceny. */
    headline?: string;
    /** Dla kind="list" */
    items?: string[];
    /** Dla kind="counter" */
    from?: number;
    to?: number;
    suffix?: string;
    /** Dla kind="image" — nazwa pliku w remotion/public/ (staticFile). */
    src?: string;
    /**
     * Dla kind="footage" — nazwa pobranego klipu w remotion/public/
     * (ujęcie stockowe z ludźmi, Pexels/Pixabay). Pusty = degradacja do gradientu.
     */
    clip?: string;
    /**
     * Długość pobranego klipu w sekundach. Gdy klip jest krótszy niż scena,
     * render zapętla go zamiast pokazywać czarne klatki.
     */
    clipDurationS?: number;
    /** Zapytanie do banku wideo — używane przez krok 4, nie przez render. */
    query?: string;
    /** Przyciemnienie ujęcia pod tekst, 0–1 (domyślnie 0.45). */
    dim?: number;
    /** Nadpisanie palety dla tej sceny. */
    colors?: [string, string];
  };
};

export type Theme = {
  palette: [string, string][];
  accent: string;
  textColor: string;
  fontFamily: string;
};

export type ReelProps = {
  scenes: Scene[];
  fps: number;
  /** Rzeczywista długość lektora — wideo dopasowuje się do audio, nie odwrotnie. */
  audioDurationS: number;
  theme: Theme;
  /** Znak wodny/handle wyświetlany na dole (opcjonalny). */
  handle?: string;
};

export type ThumbnailProps = {
  hook: string;
  subline?: string;
  theme: Theme;
  imageSrc?: string;
};

export const DEFAULT_THEME: Theme = {
  palette: [
    ["#0f172a", "#3b0764"],
    ["#111827", "#065f46"],
    ["#1e1b4b", "#831843"],
    ["#0c4a6e", "#0f172a"],
    ["#18181b", "#7c2d12"],
  ],
  accent: "#fbbf24",
  textColor: "#ffffff",
  fontFamily:
    '"Inter", "Helvetica Neue", "Segoe UI", "DejaVu Sans", system-ui, sans-serif',
};
