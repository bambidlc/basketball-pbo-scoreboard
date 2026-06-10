import type { ReactNode, SVGProps } from "react";

type CourtSvgProps = SVGProps<SVGSVGElement> & {
  children?: ReactNode;
};

function HalfCourt() {
  return (
    <>
      <path d="M42 75L144 79C328 82 328 358 144 361L42 365" />
      <path d="M42 154H194V286H42" />
      <path d="M194 154A66 66 0 0 1 194 286" />
      <path d="M194 154A66 66 0 0 0 194 286" strokeDasharray="12 13" />
      <line x1="82" x2="82" y1="190" y2="250" />
      <circle cx="108" cy="220" r="15" />
      <line x1="123" x2="123" y1="198" y2="242" />
      <path d="M108 184A36 36 0 0 1 108 256" strokeOpacity="0.72" />
      <line x1="86" x2="86" y1="154" y2="166" strokeOpacity="0.72" />
      <line x1="142" x2="142" y1="154" y2="166" strokeOpacity="0.72" />
      <line x1="86" x2="86" y1="274" y2="286" strokeOpacity="0.72" />
      <line x1="142" x2="142" y1="274" y2="286" strokeOpacity="0.72" />
    </>
  );
}

export function CourtSvg({ children, className, ...props }: CourtSvgProps) {
  return (
    <svg
      aria-label="Basketball court shot chart"
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      shapeRendering="geometricPrecision"
      viewBox="0 0 760 440"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect width="760" height="440" fill="#080a0d" />

      <g
        fill="none"
        stroke="#d4d4d4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.7"
        vectorEffect="non-scaling-stroke"
      >
        <rect x="42" y="42" width="676" height="356" />
        <line x1="380" x2="380" y1="42" y2="398" />
        <circle cx="380" cy="220" r="45" />

        <HalfCourt />
        <g transform="matrix(-1 0 0 1 760 0)">
          <HalfCourt />
        </g>
      </g>

      {children}
    </svg>
  );
}
