import type { SVGProps } from "react";

export type IconName =
  | "activity"
  | "check"
  | "chevron"
  | "diagnostic"
  | "download"
  | "launch"
  | "moon"
  | "pause"
  | "refresh"
  | "restore"
  | "sparkle"
  | "sun"
  | "trash"
  | "warning";

const paths: Record<IconName, React.ReactNode> = {
  activity: <><path d="M4 12h3l2-5 4 10 2-5h5" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  chevron: <><path d="m9 18 6-6-6-6" /></>,
  diagnostic: <><path d="M12 3v3M5.64 5.64l2.12 2.12M3 12h3m-.36 6.36 2.12-2.12M12 18v3m6.36-2.64-2.12-2.12M18 12h3m-2.64-6.36-2.12 2.12" /><circle cx="12" cy="12" r="3" /></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></>,
  launch: <><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></>,
  moon: <><path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" /></>,
  pause: <><path d="M9 5v14M15 5v14" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-3M4 4v5h5M4 13a8 8 0 0 0 14.9 3M20 20v-5h-5" /></>,
  restore: <><path d="M4 8v5h5M5.3 16a8 8 0 1 0 .2-8.3L4 9" /></>,
  sparkle: <><path d="m12 3 1.1 3.2L16 8l-2.9 1.8L12 13l-1.1-3.2L8 8l2.9-1.8L12 3ZM5.5 14l.7 2.3L8.5 17l-2.3.7L5.5 20l-.7-2.3-2.3-.7 2.3-.7.7-2.3ZM18.5 13l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></>,
  sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></>,
  warning: <><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 9v4m0 3h.01" /></>,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {paths[name]}
    </svg>
  );
}
