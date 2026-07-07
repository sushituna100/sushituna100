import { prisma } from "./db";

// Simulated payment processor with a Stripe-shaped interface.
// Swap the body of `chargeCard` for a real Stripe PaymentIntent call
// (stripe.paymentIntents.create) when going to production.

export type CardDetails = {
  number: string;
  expMonth: string;
  expYear: string;
  cvc: string;
  name: string;
};

export type ChargeResult =
  | { ok: true; last4: string }
  | { ok: false; error: string };

export function validateCard(card: CardDetails): ChargeResult {
  const digits = card.number.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return { ok: false, error: "Card number looks invalid" };
  if (!luhn(digits)) return { ok: false, error: "Card number failed verification" };
  const month = Number(card.expMonth);
  const year = Number(card.expYear.length === 2 ? `20${card.expYear}` : card.expYear);
  if (!(month >= 1 && month <= 12)) return { ok: false, error: "Invalid expiry month" };
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) {
    return { ok: false, error: "Card is expired" };
  }
  if (!/^\d{3,4}$/.test(card.cvc)) return { ok: false, error: "Invalid CVC" };
  if (!card.name.trim()) return { ok: false, error: "Name on card is required" };
  return { ok: true, last4: digits.slice(-4) };
}

function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export async function chargeCard(opts: {
  userId: string;
  reservationId: string;
  amountCents: number;
  card: CardDetails;
}): Promise<ChargeResult> {
  const valid = validateCard(opts.card);
  if (!valid.ok) return valid;

  await prisma.$transaction([
    prisma.payment.create({
      data: {
        userId: opts.userId,
        reservationId: opts.reservationId,
        amountCents: opts.amountCents,
        cardLast4: valid.last4,
        status: "succeeded",
      },
    }),
    prisma.reservation.update({
      where: { id: opts.reservationId },
      data: { status: "confirmed" },
    }),
  ]);

  return { ok: true, last4: valid.last4 };
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
