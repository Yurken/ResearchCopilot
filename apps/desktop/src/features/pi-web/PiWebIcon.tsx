// Official Pi Web icon from the pinned vendor source
// (vendor/pi-web/public/icons/icon-192.png，仅提供 PNG 格式）。
import iconUrl from "./pi-web-icon.png";

export default function PiWebIcon({ className }: { className?: string }) {
  return (
    <img
      src={iconUrl}
      alt=""
      aria-hidden="true"
      className={`pi-web-icon rounded-[3px] ${className ?? ""}`.trim()}
      draggable={false}
    />
  );
}
