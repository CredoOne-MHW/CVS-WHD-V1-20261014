/**
 * The one way a logo is shown: inside a white circle, scaled to fit the circle's inscribed square, so any logo — wide,
 * tall or square — sits fully inside the circle and is never cropped. Used for the platform and for every company.
 */
const initials = (s = "") =>
  s
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "•";

export function LogoDisc({ src, name = "", size = 48, className = "", shadow = true, fill = 0.68 }: { src?: string; name?: string; size?: number | string; className?: string; shadow?: boolean; fill?: number }) {
  const px = typeof size === "number" ? `${size}px` : size;
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-white ring-1 ring-black/5 ${shadow ? "shadow-[0_6px_18px_-6px_rgba(16,24,40,.35)]" : ""} ${className}`}
      style={{ width: px, height: px }}
    >
      {src ? (
        <img src={src} alt={name} draggable={false} className="object-contain" style={{ width: `${fill * 100}%`, height: `${fill * 100}%` }} />
      ) : (
        <span className="font-extrabold leading-none text-hive-700" style={{ fontSize: `calc(${px} * 0.34)` }} aria-label={name}>
          {initials(name)}
        </span>
      )}
    </span>
  );
}
