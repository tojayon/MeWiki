import { useLocale } from "../i18n/react.ts";
import { t } from "../i18n/locale.ts";
import { localizeMediaError } from "../i18n/mediaError.ts";
import { mediaKindLabels } from "../domain/researchMediaFormats.ts";
import { useEffect, useRef, useState } from "react";
import { AudioLines, Film, Maximize2, Repeat } from "lucide-react";
import type { ResearchMediaBlock } from "../domain/researchMedia.ts";

function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export default function ResearchMediaPlayer({ kind, src, name, poster, playback, onPlaybackChange }: {
  kind: "audio" | "video"; src: string; name: string; poster?: string;
  playback?: ResearchMediaBlock["playback"]; onPlaybackChange?: (value: NonNullable<ResearchMediaBlock["playback"]>) => void;
}) {
  useLocale();
  const ref = useRef<HTMLMediaElement | null>(null);
  const [temporary, setTemporary] = useState<{ baseline: string; rate: number; loop: boolean }>();
  const baseline = JSON.stringify(playback ?? {});
  const rate = !onPlaybackChange && temporary?.baseline === baseline ? temporary.rate : playback?.rate ?? 1;
  const loop = !onPlaybackChange && temporary?.baseline === baseline ? temporary.loop : playback?.loop ?? false;
  const [duration, setDuration] = useState("");
  const [error, setError] = useState("");
  const sourceLabel = mediaKindLabels[kind];
  const label = t(sourceLabel);
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate, src]);
  useEffect(() => {
    const media = ref.current;
    return () => { media?.pause(); };
  }, []);
  const onMetadata = () => {
    setError("");
    if (ref.current) { setDuration(durationLabel(ref.current.duration)); ref.current.playbackRate = rate; }
  };
  const onError = () => setError(`${sourceLabel}无法播放，文件编码可能不受当前浏览器支持，或来源暂时不可用。可下载原件查看或替换。`);
  const speeds = [...new Set([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, rate])].sort((a, b) => a - b);
  const Icon = kind === "audio" ? AudioLines : Film;
  return <div className="research-media-player" data-player-kind={kind}>
    <div className="research-media-player-heading"><Icon size={17} aria-hidden="true" /><strong title={name}>{name}</strong>{duration && <time aria-label={t`${label}时长`}>{duration}</time>}</div>
    {kind === "audio"
      ? <audio ref={element => { ref.current = element; }} controls preload="metadata" src={src} loop={loop} aria-label={name} onLoadedMetadata={onMetadata} onDurationChange={() => ref.current && setDuration(durationLabel(ref.current.duration))} onError={onError} />
      : <video ref={element => { ref.current = element; }} controls preload="metadata" playsInline src={src} poster={poster} loop={loop} aria-label={name} onLoadedMetadata={onMetadata} onDurationChange={() => ref.current && setDuration(durationLabel(ref.current.duration))} onError={onError} />}
    <div className="research-media-playback">
      <select aria-label={t`${label}播放速度`} title={t("播放速度")} value={rate} onChange={event => { const next = Number(event.target.value); setTemporary({ baseline, rate: next, loop }); onPlaybackChange?.({ ...playback, rate: next, loop }); }}>
        {speeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
      </select>
      <button type="button" data-ui="icon-action" aria-label={t`循环播放${label}`} title={t("循环播放")} aria-pressed={loop} onClick={() => { setTemporary({ baseline, rate, loop: !loop }); onPlaybackChange?.({ ...playback, rate, loop: !loop }); }}><Repeat size={15} /></button>
      {kind === "video" && <button type="button" data-ui="icon-action" aria-label={t("全屏播放视频")} title={t("全屏播放")} onClick={() => { void ref.current?.requestFullscreen().catch(() => setError("无法进入全屏，可使用播放器中的全屏按钮。")); }}><Maximize2 size={15} /></button>}
    </div>
    {error && <p className="research-media-error" role="alert">{localizeMediaError(error)}</p>}
  </div>;
}
