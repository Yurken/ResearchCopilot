import type { SVGProps } from "react";

export default function OpenCodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} className={`opencode-icon ${props.className ?? ""}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.25 6.75 3.5 12l4.75 5.25M15.75 6.75 20.5 12l-4.75 5.25M14 4l-4 16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
