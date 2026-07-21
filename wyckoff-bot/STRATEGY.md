# The Wyckoff Strategy — Research & Design Notes

This document is the "due diligence" behind the bot: what the Wyckoff method
actually is, why it works on the psychology you intuited ("market sentiment and
mob mentality"), how we make it *safer* with independent confirming indicators
and hard risk rules, and — the question you were stuck on — **what to trade.**

> Bottom line up front on the target question: Wyckoff is **not** a
> commodity-picking system. It is a *market-structure* method that works on **any
> liquid, institution-driven instrument.** On Robinhood you cannot trade raw
> commodity futures, so the practical universe is **liquid ETFs and large-cap
> stocks** — including *commodity ETFs* (GLD, SLV, USO, UNG) if you specifically
> want commodity exposure. A concrete starter universe is at the end.

---

## 1. What Wyckoff is, and why your intuition is correct

Richard D. Wyckoff (1873–1934) noticed that price trends are driven mainly by
large operators — institutions, "smart money" — who accumulate a position
quietly, then mark price up and distribute it to an excited public, then mark it
down. He compressed this into a teaching device called the **Composite
Operator** (or Composite Man): analyze every chart *as if* one well-capitalized
operator is deliberately engineering the moves to buy low from a fearful crowd
and sell high to a greedy one.

That is exactly the "mob mentality" you described. The whole edge of the method
is reading **where the crowd is trapped** — panic-selling into a bottom, or
euphorically buying a top — and positioning *with* the operator and *against* the
crowd. The tools are just **price** and **volume**; everything else is
interpretation.

Sources: [Wyckoff Analytics — The Wyckoff Method](https://www.wyckoffanalytics.com/wyckoff-method/),
[FTMO — Wyckoff theory](https://ftmo.com/en/blog/the-wyckoff-theory-and-its-application-in-trading/),
[Capital.com — Understanding the Wyckoff Method](https://capital.com/en-int/learn/technical-analysis/the-wyckoff-method).

## 2. The three laws (these are what the code encodes)

1. **Supply and Demand.** Price rises when demand > supply and falls otherwise.
   You *see* this in the bar: a wide up-bar closing on its high on heavy volume =
   demand; a wide down-bar closing on its low on heavy volume = supply.
2. **Cause and Effect.** The time price spends building a range (the "cause")
   sets up the size of the subsequent move (the "effect"). Wider/longer bases →
   bigger moves. We use the *range height* as a measured-move target — that is
   the second target the bot outputs.
3. **Effort vs. Result.** Compare volume (effort) to the price change (result).
   When they agree, the move is real; when they diverge (huge volume, tiny
   progress), the move is being *absorbed* — a reversal tell. This is why the bot
   confirms every signal with **volume** indicators (OBV, MFI, relative volume),
   not just price.

Sources: [LiteFinance — Wyckoff Method](https://www.litefinance.org/blog/for-professionals/wyckoff-method/),
[PriceActionNinja — Wyckoff's 3 Laws](https://priceactionninja.com/wyckoffs-3-laws-the-foundation-of-smart-money-trading/),
[StockCharts ChartSchool — The Wyckoff Method](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial).

## 3. The market cycle

**Accumulation → Markup → Distribution → Markdown**, repeating. We trade the two
*transitions* where the crowd is most wrong:

- End of **Accumulation** (a range after a decline) → go long. Primary trigger:
  the **Spring**.
- End of **Distribution** (a range after an advance) → exit / go short. Primary
  trigger: the **Upthrust / UTAD**.

## 4. The accumulation schematic (long side) — events the bot detects

| Event | Meaning | Volume signature |
|---|---|---|
| **PS** Preliminary Support | first buyers appear in the decline | rising |
| **SC** Selling Climax | panic low, wide down-bar | climactic (huge) |
| **AR** Automatic Rally | snap-back that sets the range **top** | strong |
| **ST** Secondary Test | retest of the SC low | **lighter** than SC |
| **Spring / Shakeout** | false break **below** support, then recovery (Phase C) | ideally **dries up**; or high-vol but *absorbed* (closes off the low) |
| **Test** | low-volume retest holding above the spring low | **very light** |
| **SOS** Sign of Strength | wide rally toward/through resistance (Phase D) | **expanding** |
| **LPS** Last Point of Support | higher-low pullback that holds | diminishing |

Phases: **A** stops the downtrend (PS, SC, AR, ST) · **B** builds the cause
(the range) · **C** is the spring/test (the trap) · **D** is the markup
(SOS, LPS) · **E** is the trend out of the range.

**Distribution is the mirror:** PSY, **BC** (Buying Climax), AR, ST, **UTAD**
(the false break *above* resistance), **SOW** (Sign of Weakness), LPSY.

Sources: [StockCharts ChartSchool tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial),
[TrendSpider — Wyckoff Accumulation](https://trendspider.com/learning-center/chart-patterns-wyckoff-accumulation/),
[BitMEX — Wyckoff Distribution](https://www.bitmex.com/blog/wyckoff-distribution).

## 5. The exact rules this bot encodes

Detection lives in `wyckoff.py`; everything is a tunable threshold in
`WyckoffConfig`. Measured in **relative** units so the same rules work on a $30
and a $600 instrument:

- **Trading range** = support/resistance over a lookback window, required to be a
  genuine consolidation (not too wide vs. price, at least a couple of ATRs tall,
  reasonably sideways).
- **Context** (accumulation vs. distribution) is decided by the trend *before*
  the range — a prior decline ≥ 8% → accumulation.
- **Spring** = a bar pokes below support by ≥ 0.1 ATR and closes back inside;
  graded by volume (dry-up = best; high-vol-but-absorbed = ok; high-vol-and-weak
  = poor).
- **SOS / SOW** = wide-spread break of the range on expanding volume.
- **Upthrust / UTAD** = a bar pokes above resistance and closes back inside.
- Each trigger gets a **structural quality** score (0–1) before any indicator is
  even consulted.

## 6. Making it safer — independent confirmation (the "other indicators")

A Wyckoff pattern alone is discretionary and prone to false signals (a
well-known drawback of the method — steep learning curve, subjective reads). So
no trigger becomes a trade until it survives cross-examination in `signals.py`.
Crucially, **the confirmations differ by setup type**, because the correct
confirmation depends on what the pattern claims:

- **Reversal triggers (Spring, Upthrust/UTAD)** fire at the moment of maximum
  apparent weakness/strength — so raw momentum is *meant* to look bad there. The
  right confirmation is:
  - **RSI divergence** — price makes a lower low, RSI makes a higher low (the
    crowd's fear is exhausted).
  - **OBV / volume divergence** — volume is not confirming the new low
    (absorption; effort ≠ result).
  - **Volume dry-up** — the spring happens on below-average volume (no real
    supply left).
  - **Close rejection** — the bar closes off its low (demand stepped in).
- **Continuation triggers (SOS, LPS, SOW)** fire *with* the move, so momentum
  alignment is correct: **OBV slope, RSI trend, price vs. EMAs, MFI, ADX/DI.**

Each check has a weight; passing raises confidence, failing lowers it. A signal
is only **actionable** if it clears a confidence floor **and** a minimum number
of independent confirmations **and** a minimum reward:risk. This layered
approach (Wyckoff structure + volume + momentum + trend) is the standard way
practitioners reduce Wyckoff's false-signal rate.

Sources: [FXOpen — Wyckoff trading method](https://fxopen.com/blog/en/the-wyckoff-trading-method/),
[TradeFundrr — Wyckoff accumulation + key indicators](https://tradefundrr.com/wyckoff-accumulation-phase-trading/),
[Capital.com](https://capital.com/en-int/learn/technical-analysis/the-wyckoff-method).

## 7. The *real* safety — risk management

Confirmation reduces bad entries; **risk management guarantees survival.** The
edge of a discretionary method is uncertain and signals *will* be wrong, so the
non-negotiables (in `risk.py`) are:

- **Fixed-fractional sizing:** every trade risks a small fixed fraction of equity
  to its stop (default **0.5%**). Position size is *derived from the stop*, never
  guessed.
- **Hard caps:** ≤ 20% of equity in one name; ≤ 5 concurrent positions; ≤ 2%
  total open risk across the book.
- **Protective stop on every entry** — below the spring low (longs) / above the
  upthrust high (shorts), plus an ATR cushion. Placed at entry time, always.
- **Daily-loss kill switch:** if realized losses hit 3% of equity in a day, no
  new entries.
- **Targets:** first = the range top (structural); second = a cause-and-effect
  **measured move** (range height projected).
- **Long-only by default** for equities (shorting needs margin and has unbounded
  risk); distribution signals are treated as *exit/avoid* unless you explicitly
  enable shorts.

## 8. What to trade — the answer to your sticking point

Wyckoff needs **liquidity and institutional participation** — that is what makes
the accumulation/distribution "story" legible in the volume. Illiquid or
news-driven microcaps do *not* obey it well. Wyckoff himself said the method
applies to any freely traded, institutionally-operated market: stocks,
commodities, bonds, currencies.

**On Robinhood specifically:** you can trade **stocks, ETFs, and options** — but
**not** commodity *futures*. So "what commodity to target" resolves to: pick the
most liquid instruments that best show crowd behavior, and if you want commodity
exposure, use **commodity ETFs**. Best fits, by why they work:

- **Broad-index ETFs — SPY, QQQ, IWM.** The deepest liquidity and the cleanest
  Wyckoff structures; whole-market sentiment is the ultimate "mob."
- **Commodity ETFs — GLD (gold), SLV (silver), USO (oil), UNG (natural gas).**
  Direct commodity exposure, highly liquid, and famously sentiment- and
  fear-driven — a natural home for springs/upthrusts. (GLD is a textbook Wyckoff
  swing vehicle.)
- **Sector ETFs — XLE, XLF, XLK, GDX.** Cleaner than single stocks, with clear
  rotation-driven accumulation/distribution.
- **Mega-cap, high-retail single names — AAPL, NVDA, TSLA, AMD.** Maximum
  "mob mentality," but noisier; keep size smaller.

**Timeframe:** Wyckoff reads cleanest on **daily and weekly** bars — that is
where institutional campaigns and crowd phases are visible and where false
signals are fewest. Trade daily; use weekly for context. Avoid intraday until
the daily process is proven.

**Recommended starter universe (in `config/config.example.yaml`):**
`SPY, QQQ, IWM, GLD, SLV, USO, GDX, XLE` — a mix of index and commodity ETFs,
all liquid, all crowd-driven, none dependent on single-company headline risk.
Start there in **paper/dry-run**, measure expectancy, then narrow to what works.

Sources: [Wyckoff Analytics — Swing Trading Using the Wyckoff Method](https://www.wyckoffanalytics.com/demand/swing-trading-using-the-wyckoff-method/),
[Nasdaq — ETF Liquidity](https://www.nasdaq.com/articles/etf-liquidity-what-actually-drives-trading-capacity),
[ETFdb — How to Swing Trade ETFs](https://etfdb.com/etf-trading-strategies/how-to-swing-trade-etfs/).

## 9. Honest limitations

- Pattern detection here is a **reproducible heuristic**, not a human expert.
  Tune thresholds per instrument; expect false positives. The layered
  confirmation + risk caps are what keep those survivable.
- Backtest results are **in-sample** on limited data and ignore slippage,
  commissions, gaps, and halts. Treat them as a sanity check, not a promise.
- This is **not financial advice** and past behavior does not predict returns.
  Run in paper/dry-run first, and never risk money you can't afford to lose.

## 10. How this maps to Robinhood agentic

The Python library does the deterministic detection; the **Robinhood MCP tools**
supply live data and execution. The bot never auto-trades: it proposes, a human
confirms, then the agent places a limit entry with a protective stop. Full
runbook and safety gates: [`agent/ROBINHOOD_AGENT.md`](agent/ROBINHOOD_AGENT.md).
