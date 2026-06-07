import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Link as LinkIcon,
  X,
  AlertCircle,
  Shield,
  Subtitles,
  ArrowRight,
} from "lucide-react";
import VideoControls from "@/components/VideoControls";
import SubtitleOverlay from "@/components/SubtitleOverlay";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;
const SUBS_URL = "/subs/sk.vtt";

const isHls = (url) => /\.m3u8?(\?|$)/i.test(url);
const buildProxyUrl = (rawUrl) => `${API}/proxy?url=${encodeURIComponent(rawUrl)}`;
const freshStreamUrl = (rawUrl, viaProxy) => {
  const base = viaProxy ? buildProxyUrl(rawUrl) : rawUrl;
  return `${base}${base.includes("?") ? "&" : "?"}_t=${Date.now()}`;
};
const STREAM_REFRESH_MS = 5 * 60 * 1000;

function applySubtitles(video, enabled) {
  if (!video?.textTracks) return;
  for (let i = 0; i < video.textTracks.length; i++) {
    const track = video.textTracks[i];
    if (track.kind === "subtitles" || track.kind === "captions") {
      // hidden = load cues without native rendering (custom overlay draws them)
      track.mode = enabled ? "hidden" : "disabled";
    }
  }
}

const ease = [0.22, 1, 0.36, 1];

export default function VideoPreviewer() {
  const [input, setInput] = useState("");
  const [src, setSrc] = useState("");
  const [displaySrc, setDisplaySrc] = useState("");
  const [useProxy, setUseProxy] = useState(true);
  const [showSubs, setShowSubs] = useState(true);
  const [error, setError] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const containerRef = useRef(null);
  const displaySrcRef = useRef("");
  const useProxyRef = useRef(useProxy);
  const showSubsRef = useRef(showSubs);
  const networkRetriesRef = useRef(0);

  displaySrcRef.current = displaySrc;
  useProxyRef.current = useProxy;
  showSubsRef.current = showSubs;

  const refreshStream = (silent = true) => {
    const video = videoRef.current;
    const hls = hlsRef.current;
    const raw = displaySrcRef.current;
    if (!video || !raw) return;

    const pos = video.currentTime;
    const playing = !video.paused;
    const freshUrl = freshStreamUrl(raw, useProxyRef.current);

    if (hls) {
      networkRetriesRef.current = 0;
      hls.loadSource(freshUrl);
      const onParsed = () => {
        hls.off(Hls.Events.MANIFEST_PARSED, onParsed);
        if (Number.isFinite(pos) && pos > 1) {
          video.currentTime = pos;
        }
        applySubtitles(video, showSubsRef.current);
        if (playing) video.play().catch(() => {});
      };
      hls.on(Hls.Events.MANIFEST_PARSED, onParsed);
    } else if (isHls(raw) || useProxyRef.current) {
      setSrc(freshUrl);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    setError("");
    setIsLoading(true);

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    let loadTimeout;
    const clearLoading = () => {
      if (loadTimeout) clearTimeout(loadTimeout);
      setIsLoading(false);
    };

    const onReady = () => {
      clearLoading();
      networkRetriesRef.current = 0;
      applySubtitles(video, showSubsRef.current);
      video.play().catch(() => {});
    };

    const onVideoError = () => {
      clearLoading();
      setError("Nepodarilo sa načítať video. Skontroluj URL alebo zapni proxy.");
    };

    loadTimeout = setTimeout(() => {
      setIsLoading(false);
      setError(
        "Video sa nepodarilo načítať včas. Zdroj je nedostupný, expirovaný alebo server aether.bar neodpovedá.",
      );
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    }, 25000);

    if (isHls(src) || src.includes("/api/proxy")) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          fragLoadingMaxRetry: 4,
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 3,
        });
        hlsRef.current = hls;
        hls.loadSource(src);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, onReady);
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            if (data.fatal) {
              if (networkRetriesRef.current < 2) {
                networkRetriesRef.current += 1;
                hls.startLoad();
              } else if (displaySrcRef.current) {
                networkRetriesRef.current = 0;
                refreshStream(true);
              }
            }
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && data.fatal) {
            hls.recoverMediaError();
            return;
          }
          if (!data.fatal) return;

          clearLoading();
          const detail = data.details || data.type;
          if (
            detail === "manifestParsingError" ||
            detail === "manifestLoadError"
          ) {
            if (displaySrcRef.current) {
              refreshStream(true);
            } else {
              setError(
                "Zdroj vrátil neplatný stream. Tento odkaz môže byť expirovaný alebo aether.bar ho momentálne nevie načítať.",
              );
            }
          } else {
            setError(
              `Chyba prehrávania: ${detail}. ${
                useProxy
                  ? "Zdroj môže byť nedostupný alebo expirovaný."
                  : "Skús zapnúť proxy režim."
              }`,
            );
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        video.addEventListener("loadedmetadata", onReady, { once: true });
        video.addEventListener("error", onVideoError, { once: true });
      } else {
        clearLoading();
        setError("HLS nie je podporované v tomto prehliadači.");
      }
    } else {
      video.src = src;
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onVideoError, { once: true });
    }

    return () => {
      if (loadTimeout) clearTimeout(loadTimeout);
      video.removeEventListener("error", onVideoError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, useProxy]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const sync = () => applySubtitles(video, showSubs);
    sync();

    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("addtrack", sync);
    const retry = setInterval(sync, 400);
    const stopRetry = setTimeout(() => clearInterval(retry), 4000);

    return () => {
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("addtrack", sync);
      clearInterval(retry);
      clearTimeout(stopRetry);
    };
  }, [showSubs, src]);

  useEffect(() => {
    if (!displaySrc || !src) return;
    const id = setInterval(() => refreshStream(true), STREAM_REFRESH_MS);
    return () => clearInterval(id);
  }, [displaySrc, src]);

  const handlePlay = (e) => {
    e?.preventDefault?.();
    const url = input.trim();
    if (!url) {
      setError("Vlož URL videa.");
      return;
    }
    try {
      new URL(url);
    } catch {
      setError("Neplatná URL adresa.");
      return;
    }
    setError("");
    setIsLoading(true);
    setIsLaunching(true);
    setDisplaySrc(url);
    setSrc(useProxy ? buildProxyUrl(url) : url);

    setTimeout(() => {
      setIsExpanded(true);
      setIsLaunching(false);
    }, 120);
  };

  const handleClear = () => {
    setIsExpanded(false);
    setIsLaunching(false);
    setIsLoading(false);
    setTimeout(() => {
      setInput("");
      setSrc("");
      setDisplaySrc("");
      setError("");
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.removeAttribute("src");
        videoRef.current.load();
      }
    }, 450);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setInput(text.trim());
    } catch {
      setError("Schránka nie je dostupná. Vlož URL ručne.");
    }
  };

  const chipClass = (on) =>
    `inline-flex items-center gap-1.5 text-sm font-medium rounded-xl px-3.5 py-2 transition-all duration-200 ${
      on
        ? "bg-zinc-800/80 text-zinc-100 ring-1 ring-zinc-700/50"
        : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50"
    }`;

  return (
    <div
      data-testid="video-viewer-page"
      className="min-h-screen w-full text-zinc-100 flex flex-col relative overflow-hidden bg-[#0e0e10]"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[700px] h-[420px] rounded-full bg-violet-600/[0.06] blur-[100px]" />
      </div>

      <header className="relative z-20 px-6 sm:px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-zinc-100 text-zinc-900 flex items-center justify-center">
            <Play className="h-3.5 w-3.5 fill-current" />
          </div>
          <span className="font-semibold text-[15px] text-zinc-200 tracking-tight">
            videjoo
          </span>
        </div>
        <div className="text-xs text-zinc-600 hidden sm:flex gap-3">
          <span>hls</span>
          <span>mp4</span>
          <span>webm</span>
        </div>
      </header>

      <main
        className={`relative flex-1 flex flex-col items-center z-10 px-5 sm:px-8 transition-all duration-500 ${
          isExpanded ? "pt-2 pb-10" : "justify-center pb-16"
        }`}
      >
        <div
          className={`w-full transition-all duration-500 ${
            isExpanded ? "max-w-5xl" : "max-w-xl"
          }`}
        >
          <AnimatePresence>
            {!isExpanded && (
              <motion.div
                key="hero"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.45, ease }}
                className="text-center mb-10"
              >
                <h1
                  className="font-display font-extrabold text-zinc-50 select-none tracking-[-0.02em]"
                  style={{ fontSize: "clamp(3.25rem, 10vw, 5rem)", lineHeight: 1 }}
                >
                  VIDEJOO
                </h1>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.div layout transition={{ duration: 0.45, ease }} className={isExpanded ? "mb-5" : ""}>
            <form onSubmit={handlePlay}>
              <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-zinc-900/70 ring-1 ring-zinc-800/80 focus-within:ring-zinc-700/80 transition-shadow shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)]">
                <LinkIcon className="h-4 w-4 text-zinc-600 flex-shrink-0 ml-3" />
                <input
                  data-testid="video-url-input"
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="URL videa"
                  className="flex-1 bg-transparent outline-none text-zinc-100 placeholder:text-zinc-600 text-[15px] py-3 min-w-0"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  data-testid="paste-button"
                  type="button"
                  onClick={handlePaste}
                  className="text-sm text-zinc-500 hover:text-zinc-200 px-3 py-2 rounded-xl hover:bg-zinc-800/60 transition-colors font-medium shrink-0"
                >
                  Vložiť
                </button>
                <button
                  data-testid="play-button"
                  type="submit"
                  disabled={isLaunching}
                  className="bg-zinc-100 text-zinc-900 hover:bg-white disabled:opacity-60 rounded-xl pl-4 pr-3.5 py-2.5 text-sm font-semibold inline-flex items-center gap-2 transition-colors shrink-0"
                >
                  Prehrať
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </form>

            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
              <button
                data-testid="toggle-proxy"
                type="button"
                onClick={() => setUseProxy((v) => !v)}
                className={chipClass(useProxy)}
              >
                <Shield className="h-3.5 w-3.5" />
                Proxy
              </button>
              <button
                data-testid="toggle-subs"
                type="button"
                onClick={() => setShowSubs((v) => !v)}
                className={chipClass(showSubs)}
              >
                <Subtitles className="h-3.5 w-3.5" />
                Titulky
              </button>
              {displaySrc && (
                <button
                  data-testid="clear-button"
                  type="button"
                  onClick={handleClear}
                  className={chipClass(false)}
                >
                  <X className="h-3.5 w-3.5" />
                  Vymazať
                </button>
              )}
            </div>
          </motion.div>

          <AnimatePresence>
            {error && (
              <motion.div
                data-testid="error-message"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="mt-4 flex items-start gap-2.5 text-sm text-rose-200/90 bg-rose-950/25 ring-1 ring-rose-900/30 rounded-xl px-4 py-3"
              >
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0 text-rose-400/80" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {src && (
              <motion.div
                key="player-section"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 16 }}
                transition={{ duration: 0.45, ease }}
                className="mt-7"
              >
                <div
                  ref={containerRef}
                  data-testid="video-container"
                  className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden ring-1 ring-zinc-800/80 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.8)]"
                >
                  <video
                    data-testid="video-player"
                    ref={videoRef}
                    playsInline
                    crossOrigin="anonymous"
                    className="w-full h-full bg-black object-contain cursor-pointer"
                  >
                    {showSubs && (
                      <track
                        data-testid="subtitle-track"
                        kind="subtitles"
                        srcLang="sk"
                        label="Slovenčina"
                        src={SUBS_URL}
                        default
                      />
                    )}
                  </video>
                  <SubtitleOverlay videoRef={videoRef} enabled={showSubs} />
                  <VideoControls
                    videoRef={videoRef}
                    containerRef={containerRef}
                    isLoading={isLoading}
                  />
                </div>

                {displaySrc && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-3 text-xs text-zinc-600 truncate"
                  >
                    <span className="text-zinc-500 mr-1.5">Zdroj</span>
                    <span data-testid="current-source" className="text-zinc-500">
                      {displaySrc}
                    </span>
                  </motion.p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
