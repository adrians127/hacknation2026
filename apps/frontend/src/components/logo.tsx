import iconUrl from "@/assets/subsurf-icon.png";
import logoUrl from "@/assets/subsurf-logo.png";

const SOURCES = { full: logoUrl, icon: iconUrl } as const;

export function Logo({
  variant,
  label,
  className,
}: {
  variant: keyof typeof SOURCES;
  label: string;
  className?: string;
}) {
  return <img src={SOURCES[variant]} alt={label} className={className} />;
}
