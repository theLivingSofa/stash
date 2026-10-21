import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 22): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const IconBookmark = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(size)} {...p}>
    <path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1Z" fill={filled ? "currentColor" : "none"} />
  </svg>
);
export const IconShare = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
);
export const IconMore = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(size)} {...p}>
    <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10Z" fill={filled ? "currentColor" : "none"} />
  </svg>
);
export const IconLess = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="8.5" fill={filled ? "currentColor" : "none"} />
    <path d="M8.5 12h7" stroke={filled ? "var(--surface)" : "currentColor"} />
  </svg>
);
export const IconSpeak = ({ size, active, ...p }: P & { active?: boolean }) => (
  <svg {...base(size)} {...p}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
    {active ? <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" /> : <path d="M16 10l4 4M20 10l-4 4" />}
  </svg>
);
export const IconDetails = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h16M4 12h10M4 17h7" />
  </svg>
);
export const IconBack = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M14.5 6 8.5 12l6 6" />
  </svg>
);
export const IconExternal = ({ size = 15, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M13.5 5.5h5v5M18.5 5.5 11 13M16 14v4.5a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1H11" />
  </svg>
);
export const IconFeed = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <rect x="5" y="3.5" width="14" height="17" rx="3" />
    <path d="M9 9h6M9 12.5h6M9 16h3.5" />
  </svg>
);
export const IconExplore = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m14.8 9.2-1.6 4-4 1.6 1.6-4 4-1.6Z" />
  </svg>
);
export const IconLibrary = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M5 4v16M9 4v16M13.5 4.5l5 15.2" />
  </svg>
);
export const IconSettings = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </svg>
);
export const IconFlame = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M12 21c3.6 0 6-2.4 6-5.8 0-3.7-3-5.6-3.6-9.2-2 1.3-3 3.2-3.1 5.1C10.4 10 9.6 8.9 9.4 7.4 7.3 9.2 6 11.6 6 15.2 6 18.6 8.4 21 12 21Z" />
  </svg>
);
export const IconSearch = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
);
export const IconClose = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
