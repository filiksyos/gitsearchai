import { cn } from "@/lib/utils";

export function DetectiveLogo({ className }: { className?: string }) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/inspectocat.png"
      alt="Inspectocat"
      className={cn(className)}
    />
  );
}
