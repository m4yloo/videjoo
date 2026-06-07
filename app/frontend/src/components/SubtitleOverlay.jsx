import { useEffect, useState } from "react";

export default function SubtitleOverlay({ videoRef, enabled }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled) {
      setLines([]);
      return;
    }

    const update = () => {
      const next = [];
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (
          (track.kind === "subtitles" || track.kind === "captions") &&
          track.mode === "hidden" &&
          track.activeCues?.length
        ) {
          for (const cue of track.activeCues) {
            if (cue.text) next.push(cue.text);
          }
        }
      }
      setLines(next);
    };

    update();
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].addEventListener("cuechange", update);
    }
    video.addEventListener("timeupdate", update);

    return () => {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].removeEventListener("cuechange", update);
      }
      video.removeEventListener("timeupdate", update);
    };
  }, [videoRef, enabled]);

  if (!enabled || lines.length === 0) return null;

  return (
    <div
      className="absolute inset-x-0 bottom-[15%] z-[5] flex flex-col items-center gap-1.5 px-6 sm:px-12 pointer-events-none"
      aria-live="polite"
    >
      {lines.map((line, i) => (
        <p
          key={`${i}-${line.slice(0, 12)}`}
          className="subtitle-line max-w-[88%] text-center text-[clamp(1rem,2.5vw,1.4rem)] font-medium leading-snug text-white px-4 py-2"
        >
          {line}
        </p>
      ))}
    </div>
  );
}
