import type { SVGProps } from "react";

// Official OpenCode mark from the pinned vendor source
// (vendor/opencode-harness/packages/docs/favicon.svg)。
export default function OpenCodeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      className={`opencode-icon ${className ?? ""}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.06145 23.1079C5.26816 22.3769 -3.39077 20.6274 1.4173 5.06384C9.6344 6.09939 16.9728 14.0644 9.06145 23.1079Z" fill="url(#opencode-icon-a)" />
      <path d="M8.91928 23.0939C5.27642 21.2223 0.78371 4.20891 17.0071 0C20.7569 7.19341 19.6212 16.5452 8.91928 23.0939Z" fill="url(#opencode-icon-b)" />
      <path d="M8.91388 23.0788C8.73534 19.8817 10.1585 9.08525 23.5699 13.1107C23.1812 20.1229 18.984 26.4182 8.91388 23.0788Z" fill="url(#opencode-icon-c)" />
      <defs>
        <linearGradient id="opencode-icon-a" x1="3.77557" y1="5.91571" x2="5.23185" y2="21.5589" gradientUnits="userSpaceOnUse">
          <stop stopColor="#18E299" />
          <stop offset="1" stopColor="#15803D" />
        </linearGradient>
        <linearGradient id="opencode-icon-b" x1="12.1711" y1="-0.718425" x2="10.1897" y2="22.9832" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16A34A" />
          <stop offset="1" stopColor="#4ADE80" />
        </linearGradient>
        <linearGradient id="opencode-icon-c" x1="23.1327" y1="15.353" x2="9.33841" y2="18.5196" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4ADE80" />
          <stop offset="1" stopColor="#0D9373" />
        </linearGradient>
      </defs>
    </svg>
  );
}
