import type { ButtonHTMLAttributes, ReactNode } from "react";

type SvgProps = { className?: string };

function Svg({ children, className }: { children: ReactNode; className?: string }) {
 return (
 <svg
 xmlns="http://www.w3.org/2000/svg"
 viewBox="0 0 24 24"
 fill="none"
 stroke="currentColor"
 strokeWidth="2"
 strokeLinecap="round"
 strokeLinejoin="round"
 className={className || "w-4 h-4"}
 aria-hidden
 >
 {children}
 </svg>
 );
}

export function TrashIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M3 6h18" />
 <path d="M8 6V4h8v2" />
 <path d="M19 6l-1 14H6L5 6" />
 <path d="M10 11v6" />
 <path d="M14 11v6" />
 </Svg>
 );
}

export function PencilIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M12 20h9" />
 <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
 </Svg>
 );
}

export function EyeIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
 <circle cx="12" cy="12" r="3" />
 </Svg>
 );
}

export function DownloadIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M12 3v12" />
 <path d="m7 11 5 5 5-5" />
 <path d="M5 21h14" />
 </Svg>
 );
}

export function PrinterIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M6 9V3h12v6" />
 <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
 <path d="M6 14h12v7H6z" />
 </Svg>
 );
}

export function CloseIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M18 6 6 18" />
 <path d="m6 6 12 12" />
 </Svg>
 );
}

export function PlusIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M12 5v14" />
 <path d="M5 12h14" />
 </Svg>
 );
}

export function CopyIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <rect x="9" y="9" width="11" height="11" rx="2" />
 <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
 </Svg>
 );
}

export function RestoreIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M3 12a9 9 0 1 0 3-6.7" />
 <path d="M3 4v5h5" />
 </Svg>
 );
}

export function ChevronLeftIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="m15 6-6 6 6 6" />
 </Svg>
 );
}

export function ChevronRightIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="m9 6 6 6-6 6" />
 </Svg>
 );
}

export function LogoutIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
 <path d="m16 17 5-5-5-5" />
 <path d="M21 12H9" />
 </Svg>
 );
}

export function SunIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <circle cx="12" cy="12" r="4" />
 <path d="M12 2v2" />
 <path d="M12 20v2" />
 <path d="m4.9 4.9 1.4 1.4" />
 <path d="m17.7 17.7 1.4 1.4" />
 <path d="M2 12h2" />
 <path d="M20 12h2" />
 <path d="m4.9 19.1 1.4-1.4" />
 <path d="m17.7 6.3 1.4-1.4" />
 </Svg>
 );
}

export function MoonIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M21 14.3A9 9 0 1 1 9.7 3 7 7 0 0 0 21 14.3Z" />
 </Svg>
 );
}

export function GridIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <rect x="3" y="3" width="7" height="7" rx="1" />
 <rect x="14" y="3" width="7" height="7" rx="1" />
 <rect x="3" y="14" width="7" height="7" rx="1" />
 <rect x="14" y="14" width="7" height="7" rx="1" />
 </Svg>
 );
}

export function CalendarIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <rect x="3" y="4" width="18" height="18" rx="2" />
 <path d="M16 2v4" />
 <path d="M8 2v4" />
 <path d="M3 10h18" />
 </Svg>
 );
}

export function UserIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <circle cx="12" cy="8" r="4" />
 <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
 </Svg>
 );
}

export function UsersIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <circle cx="9" cy="8" r="3" />
 <path d="M3 19c.8-2.6 2.8-4 6-4s5.2 1.4 6 4" />
 <circle cx="17" cy="8" r="2.5" />
 <path d="M16 15c2.2.2 3.8 1.4 4.5 4" />
 </Svg>
 );
}

export function ChartIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M4 19V5" />
 <path d="M4 19h16" />
 <path d="M8 16v-5" />
 <path d="M12 16V8" />
 <path d="M16 16v-8" />
 </Svg>
 );
}

export function SlidersIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M4 21v-7" />
 <path d="M4 10V3" />
 <path d="M12 21v-9" />
 <path d="M12 8V3" />
 <path d="M20 21v-5" />
 <path d="M20 12V3" />
 <path d="M2 14h4" />
 <path d="M10 8h4" />
 <path d="M18 16h4" />
 </Svg>
 );
}

export function CheckIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <path d="M20 6 9 17l-5-5" />
 </Svg>
 );
}

export function MoreIcon({ className }: SvgProps) {
 return (
 <Svg className={className}>
 <circle cx="12" cy="5" r="1.2" fill="currentColor" />
 <circle cx="12" cy="12" r="1.2" fill="currentColor" />
 <circle cx="12" cy="19" r="1.2" fill="currentColor" />
 </Svg>
 );
}

export const icons = {
 trash: TrashIcon,
 edit: PencilIcon,
 view: EyeIcon,
 download: DownloadIcon,
 print: PrinterIcon,
 close: CloseIcon,
 plus: PlusIcon,
 copy: CopyIcon,
 restore: RestoreIcon,
 check: CheckIcon,
 more: MoreIcon,
 chevronLeft: ChevronLeftIcon,
 chevronRight: ChevronRightIcon,
 logout: LogoutIcon,
 sun: SunIcon,
 moon: MoonIcon,
 grid: GridIcon,
 calendar: CalendarIcon,
 user: UserIcon,
 users: UsersIcon,
 chart: ChartIcon,
 sliders: SlidersIcon,
};

export type ActionIcon = keyof typeof icons;

const variants = {
 ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
 danger: "text-red-600 hover:bg-red-50",
 bordered: "border border-slate-200 text-slate-600 hover:bg-slate-50",
 primary: "bg-indigo-600 text-white hover:bg-indigo-700",
 dangerSolid: "bg-red-500 text-white hover:bg-red-600",
};

type IconButtonProps = {
 icon: ActionIcon;
 label: string;
 variant?: keyof typeof variants;
 href?: string;
 target?: string;
 rel?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export function IconButton({
 icon,
 label,
 variant = "ghost",
 href,
 target,
 rel,
 className = "",
 type = "button",
 ...props
}: IconButtonProps) {
 const Icon = icons[icon];
 const cls = `inline-flex items-center justify-center w-8 h-8 rounded-lg ${variants[variant]} disabled:opacity-40 ${className}`;
 if (href) {
 return (
 <a href={href} target={target} rel={rel} aria-label={label} title={label} className={cls}>
 <Icon />
 </a>
 );
 }
 return (
 <button type={type} aria-label={label} title={label} className={cls} {...props}>
 <Icon />
 </button>
 );
}
