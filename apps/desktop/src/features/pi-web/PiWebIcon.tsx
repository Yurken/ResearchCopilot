import type { SVGProps } from "react";

export default function PiWebIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} className={`pi-web-icon ${props.className ?? ""}`.trim()} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 7.25h14M8.15 7.25v9.5M15.85 7.25v9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.25 16.75h4.9M13.85 16.75h4.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
