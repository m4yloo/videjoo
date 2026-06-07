import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Loader2,
  Settings2,
} from "lucide-react";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function VideoControls({ videoRef, containerRef, isLoading = false }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverX, setHoverX] = useState(0);

  const hideTimer = useRef(null);
  const progressRef = useRef(null);
  const wasPlayingRef = useRef(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    if (!isPlaying) return;
    hideTimer.current = setTimeout(() => setShowControls(false), 2800);
  }, [clearHideTimer, isPlaying]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    scheduleHide();
  }, [scheduleHide]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPlay = () => {
      setIsPlaying(true);
      scheduleHide();
    };
    const onPause = () => {
      setIsPlaying(false);
      setShowControls(true);
      clearHideTimer();
    };
    const onTimeUpdate = () => {
      if (!isSeeking) setCurrentTime(v.currentTime);
    };
    const onDurationChange = () => setDuration(v.duration || 0);
    const onVolumeChange = () => {
      setVolume(v.volume);
      setIsMuted(v.muted);
    };
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onPlaying = () => setIsBuffering(false);
    const onProgress = () => {
      if (v.buffered.length > 0 && v.duration) {
        const end = v.buffered.end(v.buffered.length - 1);
        setBuffered((end / v.duration) * 100);
      }
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onDurationChange);
    v.addEventListener("volumechange", onVolumeChange);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("progress", onProgress);

    setVolume(v.volume);
    setIsMuted(v.muted);
    setIsPlaying(!v.paused);

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onDurationChange);
      v.removeEventListener("volumechange", onVolumeChange);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("progress", onProgress);
    };
  }, [videoRef, isSeeking, scheduleHide, clearHideTimer]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, [videoRef]);

  const seekTo = useCallback(
    (ratio) => {
      const v = videoRef.current;
      if (!v || !v.duration) return;
      v.currentTime = ratio * v.duration;
      setCurrentTime(v.currentTime);
    },
    [videoRef],
  );

  const handleProgressClick = (e) => {
    const bar = progressRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekTo(ratio);
  };

  const handleProgressMove = (e) => {
    const bar = progressRef.current;
    const v = videoRef.current;
    if (!bar || !v?.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverX(e.clientX - rect.left);
    setHoverTime(ratio * v.duration);
  };

  const handleSeekStart = () => {
    const v = videoRef.current;
    if (!v) return;
    wasPlayingRef.current = !v.paused;
    if (wasPlayingRef.current) v.pause();
    setIsSeeking(true);
    revealControls();
  };

  const handleSeekEnd = (e) => {
    handleProgressClick(e);
    setIsSeeking(false);
    if (wasPlayingRef.current) videoRef.current?.play().catch(() => {});
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  };

  const handleVolume = (val) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
  };

  const setSpeed = (rate) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
  };

  const toggleFullscreen = async () => {
    const target = containerRef.current;
    const v = videoRef.current;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (target?.requestFullscreen) {
        await target.requestFullscreen();
      } else if (v?.webkitEnterFullscreen) {
        v.webkitEnterFullscreen();
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onClick = () => togglePlay();
    const onDblClick = (e) => {
      e.preventDefault();
      toggleFullscreen();
    };
    v.addEventListener("click", onClick);
    v.addEventListener("dblclick", onDblClick);
    return () => {
      v.removeEventListener("click", onClick);
      v.removeEventListener("dblclick", onDblClick);
    };
  }, [videoRef, togglePlay, toggleFullscreen]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = () => revealControls();
    const onLeave = () => isPlaying && scheduleHide();
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [containerRef, revealControls, scheduleHide, isPlaying]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const v = videoRef.current;
      if (!v) return;

      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          toggleMute();
          break;
        case "ArrowLeft":
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
          break;
        default:
          break;
      }
      revealControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [videoRef, togglePlay, revealControls, containerRef]);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="absolute inset-0 z-10 pointer-events-none">
      {/* Center play / buffering — no overlay so native subtitles stay visible */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
          showControls && !isPlaying ? "opacity-100" : "opacity-0"
        }`}
      >
        {isLoading || isBuffering ? (
          <div className="h-16 w-16 rounded-full bg-black/50 backdrop-blur-md flex items-center justify-center">
            <Loader2 className="h-8 w-8 text-white animate-spin" />
          </div>
        ) : (
          !isPlaying && (
            <div className="h-16 w-16 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-2xl">
              <Play className="h-7 w-7 text-white fill-white ml-1" />
            </div>
          )
        )}
      </div>

      {/* Bottom controls */}
      <div
        className={`absolute inset-x-0 bottom-0 transition-all duration-300 ease-out ${
          showControls
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-3 pointer-events-none"
        }`}
      >
        <div className="px-3 sm:px-4 pb-3 pt-16 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
          {/* Seek bar */}
          <div
            ref={progressRef}
            className="group relative h-5 flex items-center cursor-pointer mb-2"
            onClick={handleProgressClick}
            onMouseMove={handleProgressMove}
            onMouseLeave={() => setHoverTime(null)}
            onMouseDown={handleSeekStart}
            onMouseUp={handleSeekEnd}
          >
            <div className="absolute inset-x-0 h-1 rounded-full bg-white/15 group-hover:h-1.5 transition-all">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                style={{ width: `${buffered}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div
              className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity scale-0 group-hover:scale-100"
              style={{ left: `calc(${progress}% - 7px)` }}
            />
            {hoverTime !== null && (
              <div
                className="absolute -top-8 px-2 py-0.5 rounded bg-black/80 text-[11px] text-white font-medium tabular-nums pointer-events-none"
                style={{ left: hoverX, transform: "translateX(-50%)" }}
              >
                {formatTime(hoverTime)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pozastaviť" : "Prehrať"}
              className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
            >
              {isPlaying ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="h-5 w-5 fill-current" />
              )}
            </button>

            <div className="flex items-center gap-1 group/vol">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={isMuted ? "Zapnúť zvuk" : "Stíšiť"}
                className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolume(parseFloat(e.target.value))}
                className="w-0 group-hover/vol:w-20 overflow-hidden transition-all duration-200 accent-white h-1 cursor-pointer"
                aria-label="Hlasitosť"
              />
            </div>

            <span className="text-xs text-white/80 tabular-nums font-medium min-w-[90px]">
              {formatTime(currentTime)}
              <span className="text-white/40"> / </span>
              {formatTime(duration)}
            </span>

            <div className="flex-1" />

            {isBuffering && (
              <Loader2 className="h-4 w-4 text-white/60 animate-spin" />
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSpeedMenu((v) => !v)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg hover:bg-white/10 text-white text-xs font-medium transition-colors"
                aria-label="Rýchlosť prehrávania"
              >
                <Settings2 className="h-4 w-4" />
                {playbackRate === 1 ? "1×" : `${playbackRate}×`}
              </button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 py-1 rounded-xl bg-zinc-900/95 backdrop-blur-md border border-white/10 shadow-xl min-w-[80px]">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSpeed(s)}
                      className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                        playbackRate === s
                          ? "text-white bg-white/10"
                          : "text-white/70 hover:text-white hover:bg-white/5"
                      }`}
                    >
                      {s === 1 ? "Normálna" : `${s}×`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Opustiť celú obrazovku" : "Celá obrazovka"}
              className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
            >
              {isFullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
