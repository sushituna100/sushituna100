import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from wyckoff_bot import indicators as ind  # noqa: E402


class TestIndicators(unittest.TestCase):
    def test_sma(self):
        self.assertEqual(ind.sma([1, 2, 3, 4], 2), [None, 1.5, 2.5, 3.5])

    def test_ema_seed_and_recursion(self):
        # seed = SMA of first 2 = 3; k = 2/3
        self.assertEqual(ind.ema([2, 4, 6, 8], 2), [None, 3.0, 5.0, 7.0])

    def test_rsi_all_gains_is_100(self):
        closes = list(range(1, 21))  # strictly increasing
        r = ind.rsi(closes, 14)
        self.assertIsNone(r[13])
        self.assertEqual(r[14], 100.0)
        self.assertEqual(r[-1], 100.0)

    def test_rsi_midrange(self):
        # alternating up/down of equal size -> RSI hovers near 50
        closes = [10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11, 10, 11]
        r = ind.rsi(closes, 14)
        self.assertIsNotNone(r[-1])
        self.assertTrue(40 <= r[-1] <= 60)

    def test_atr_constant_range(self):
        highs = [12, 12, 12]
        lows = [10, 10, 10]
        closes = [11, 11, 11]
        a = ind.atr(highs, lows, closes, 2)
        self.assertEqual(a, [None, 2.0, 2.0])

    def test_obv(self):
        closes = [1, 2, 1, 2]
        vols = [10, 20, 30, 40]
        self.assertEqual(ind.obv(closes, vols), [0.0, 20.0, -10.0, 30.0])

    def test_mfi_bounds(self):
        highs = [i + 1 for i in range(20)]
        lows = [i for i in range(20)]
        closes = [i + 0.5 for i in range(20)]
        vols = [1000] * 20
        m = ind.mfi(highs, lows, closes, vols, 14)
        self.assertTrue(all(v is None or 0.0 <= v <= 100.0 for v in m))
        # strictly rising typical price -> money flow all positive -> MFI 100
        self.assertEqual(m[-1], 100.0)

    def test_rolling_max_min(self):
        vals = [1, 3, 2, 5, 4]
        self.assertEqual(ind.rolling_max(vals, 2), [None, 3, 3, 5, 5])
        self.assertEqual(ind.rolling_min(vals, 2), [None, 1, 2, 2, 4])

    def test_relative_volume(self):
        vols = [10, 10, 10, 10, 10, 30]
        rv = ind.relative_volume(vols, 5)
        self.assertIsNone(rv[3])
        self.assertGreater(rv[5], 1.0)  # 30 vs a ~14 average

    def test_slope_direction(self):
        self.assertGreater(ind.slope([1, 2, 3, 4, 5], 5), 0)
        self.assertLess(ind.slope([5, 4, 3, 2, 1], 5), 0)

    def test_adx_runs_and_bounds(self):
        # rising series: +DI should dominate, ADX within [0,100]
        highs = [i + 1.0 for i in range(60)]
        lows = [i for i in range(60)]
        closes = [i + 0.5 for i in range(60)]
        pdi, mdi, adx = ind.adx(highs, lows, closes, 14)
        self.assertIsNotNone(adx[-1])
        self.assertTrue(0 <= adx[-1] <= 100)
        self.assertGreaterEqual(pdi[-1], mdi[-1])


if __name__ == "__main__":
    unittest.main()
