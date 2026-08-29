import type { SVGProps } from "react";

export default function OpenCodeIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      className={`opencode-icon ${className ?? ""}`.trim()}
      width={18}
      height={18}
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M716.8 819.2H307.2V409.6h409.6v409.6z" fill="#CFCECD" />
      <path d="M716.8 204.8H307.2v614.4h409.6V204.8z m204.8 819.2H102.4V0h819.2v1024z" fill="#211E1E" />
    </svg>
  );
}
