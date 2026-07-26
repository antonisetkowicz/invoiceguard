import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
// Renderujemy tło pod lektora — dźwięk dokłada ffmpeg w kroku 6.
Config.setChromiumOpenGlRenderer("angle");
