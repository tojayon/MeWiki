import './AiMascot.css';
import mascotSvg from '/brand/mewiki-ai-mascot.svg?raw';

// Ship the shared source with the UI so a missing public file cannot break every avatar.
const mascotSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mascotSvg)}`;

/** Decorative brand mark; the containing button or message supplies its name. */
export default function AiMascot({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <img className={`mewiki-ai-mascot${className ? ` ${className}` : ''}`} src={mascotSrc}
    width={size} height={size} alt="" aria-hidden="true" draggable={false} decoding="async" />;
}
