# 🥂 Mixer — meet 5 strangers, leave with a friend group

Mixer is a friend-group-making app in the spirit of [Timeleft](https://timeleft.com): you take a
short personality quiz, pick your interests, and pay a small reservation fee to get matched with
compatible strangers for a dinner or activity. Where Mixer goes further is what happens **after**
the event — tables can vote to become **lasting friend groups** with their own chat, and anyone
can browse **open friend groups** looking for new members.

## Features

- **Personality quiz + interests onboarding** — 5 personality dimensions (Timeleft-style sliders)
  plus interest tags used for matching.
- **Mixers feed** — upcoming dinners and activity mixers (trivia, hikes, bowling, paint nights).
- **Paid reservations** — a small fee (a few dollars) holds your seat and keeps people committed.
  Checkout is a simulated card flow with Luhn/expiry validation (`src/lib/payments.ts` is
  Stripe-shaped, so real Stripe drops in later).
- **Matching algorithm** — groups confirmed guests into tables of 6 by personality distance,
  shared-interest overlap, and age proximity (`src/lib/matching.ts`).
- **Table reveal + chat** — once matched, you see your tablemates and coordinate in a group chat.
- **Vote to stay friends** — after the mixer, the table votes; a majority "yes" turns it into a
  permanent friend group with its own chat.
- **Open friend groups** — browse groups accepting members (sorted by shared interests), send a
  join request, and existing members approve or decline.

## Tech stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · Prisma + SQLite · cookie-session auth (bcrypt).

## Getting started

```bash
npm install
npx prisma migrate dev   # creates prisma/dev.db
npm run db:seed          # 21 demo users, 6 events, 3 friend groups
npm run dev              # http://localhost:3000
```

## Demo walkthrough

Log in as **`demo@mixer.app` / `password123`** (all seeded users share the password), then:

1. **Home** — reserve a seat at *Thursday Dinner Mixer* and pay with test card
   `4242 4242 4242 4242` (any future expiry, any CVC).
2. On the event page, hit **✨ Run matching now (demo)** — in production this runs automatically
   when booking closes — and meet your table.
3. Open ***Last Thursday's Dinner*** under *Your mixers* — chat with your old table and **vote yes**
   to turn it into a friend group (two tablemates already voted; yours tips the majority).
4. **Groups tab** — chat with your *Trivia Titans*, and send a join request to
   *Weekend Trailblazers*. Log in as `noah@example.com` to approve it from the other side.
5. Or sign up fresh to experience the quiz + interests onboarding.

## Project layout

```
prisma/schema.prisma      # data model (users, events, reservations, match groups, friend groups…)
prisma/seed.ts            # demo data
src/lib/                  # auth, matching algorithm, payments, quiz definitions
src/app/api/              # route handlers (auth, reservations, payments, matching, chat, groups)
src/app/                  # pages: landing, onboarding, home, mixers, checkout, groups, profile
src/components/           # UI + client components (chat, vote panel, payment form…)
```

## Production notes

- Set `SESSION_SECRET` in the environment (falls back to a dev-only constant).
- Swap `chargeCard` in `src/lib/payments.ts` for a real Stripe PaymentIntent.
- Point `DATABASE_URL` at Postgres and change the Prisma provider for multi-instance deploys.
- Matching is triggered manually for the demo; wire `matchEvent` to a scheduled job that fires
  when booking closes.
