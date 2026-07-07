import Link from "next/link";
import { formatPrice } from "@/lib/payments";

export function formatEventDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function formatEventTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function EventCard({
  event,
  badge,
}: {
  event: {
    id: string;
    title: string;
    emoji: string;
    venue: string;
    city: string;
    startsAt: Date;
    priceCents: number;
    type: string;
  };
  badge?: string;
}) {
  return (
    <Link href={`/mixers/${event.id}`} className="card flex items-center gap-4 transition hover:border-brand-200 hover:shadow-md">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-3xl">
        {event.emoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold">{event.title}</h3>
          {badge && (
            <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
              {badge}
            </span>
          )}
        </div>
        <p className="truncate text-sm text-neutral-500">
          {formatEventDate(event.startsAt)} · {event.venue}
        </p>
        <p className="mt-0.5 text-sm font-semibold text-brand-600">
          {formatPrice(event.priceCents)}
          <span className="font-normal text-neutral-400"> · groups of 6</span>
        </p>
      </div>
      <span className="text-neutral-300">›</span>
    </Link>
  );
}
