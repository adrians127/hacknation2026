import { ChartNoAxesColumn, Radar, Server, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

const FEATURES = [
  { key: "discover", Icon: Radar },
  { key: "ports", Icon: Server },
  { key: "dojo", Icon: ShieldCheck },
  { key: "insights", Icon: ChartNoAxesColumn },
] as const;

export function FeatureStrip() {
  const { t } = useTranslation();

  return (
    <ul
      id="features"
      className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-y-8 px-6 md:grid-cols-4 md:gap-y-0"
    >
      {FEATURES.map(({ key, Icon }) => (
        <li
          key={key}
          className="flex flex-col items-center gap-3 text-center md:border-l md:border-foreground/15 md:first:border-l-0"
        >
          <Icon className="size-10 text-brand" strokeWidth={1.5} />
          <span className="max-w-32 text-foreground/90">{t(`landing.features.${key}`)}</span>
        </li>
      ))}
    </ul>
  );
}
