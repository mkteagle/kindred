"""The indexer's pacing has to converge, in both directions.

A control loop that backs off but never recovers turns a temporary spike into a
permanently slow run -- across a million and a half photos that is the
difference between days and weeks. One that recovers too eagerly re-starts the
swap thrash it just escaped. These tests pin both ends.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import throttle
from throttle import Pressure, next_delay, parse_pressure_file, read_pressure

CALM = Pressure(io_some=2.0, memory_full=0.0, cpu_some=5.0)
STRUGGLING = Pressure(io_some=69.0, memory_full=42.0, cpu_some=25.0)
MIDDLING = Pressure(io_some=25.0, memory_full=2.0, cpu_some=15.0)


class ParsingTests(unittest.TestCase):
    def test_reads_the_ten_second_average_for_both_lines(self):
        text = ("some avg10=69.14 avg60=66.97 avg300=49.62 total=24315054087\n"
                "full avg10=42.09 avg60=42.71 avg300=29.90 total=14877752112\n")
        self.assertEqual(parse_pressure_file(text), {"some": 69.14, "full": 42.09})

    def test_cpu_has_no_full_line_and_that_is_not_an_error(self):
        self.assertEqual(
            parse_pressure_file("some avg10=16.47 avg60=13.21 total=1\n"),
            {"some": 16.47})

    def test_missing_files_mean_unthrottled_rather_than_zero_pressure(self):
        # Zero would read as "perfectly idle" and is the wrong default: a kernel
        # without PSI should run at full speed, not be paced against a guess.
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(read_pressure(directory))
        self.assertEqual(next_delay(1.0, None), 0.0)

    def test_reads_a_real_directory_layout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "io").write_text("some avg10=69.14 total=1\nfull avg10=42.09 total=2\n")
            (root / "memory").write_text("some avg10=25.03 total=1\nfull avg10=17.37 total=2\n")
            (root / "cpu").write_text("some avg10=16.47 total=1\n")
            pressure = read_pressure(root)
            self.assertEqual(
                (pressure.io_some, pressure.memory_full, pressure.cpu_some),
                (69.14, 17.37, 16.47))


class ControlLawTests(unittest.TestCase):
    def test_a_calm_box_is_never_throttled(self):
        self.assertEqual(next_delay(0.0, CALM), 0.0)

    def test_pressure_backs_off_within_a_handful_of_photos(self):
        delay = 0.0
        for _ in range(6):
            delay = next_delay(delay, STRUGGLING)
        self.assertGreaterEqual(delay, 1.0)

    def test_backoff_is_capped_so_the_queue_still_moves(self):
        delay = 0.0
        for _ in range(200):
            delay = next_delay(delay, STRUGGLING)
        self.assertLessEqual(delay, throttle.MAX_DELAY)

    def test_it_returns_to_full_speed_once_the_box_recovers(self):
        delay = throttle.MAX_DELAY
        for _ in range(200):
            delay = next_delay(delay, CALM)
        self.assertEqual(delay, 0.0)

    def test_recovery_is_slower_than_backoff(self):
        # Otherwise it re-saturates the moment the ten-second average dips.
        rising, steps_up = 0.0, 0
        while rising < 1.0:
            rising = next_delay(rising, STRUGGLING)
            steps_up += 1
        falling, steps_down = rising, 0
        while falling > 0.0:
            falling = next_delay(falling, CALM)
            steps_down += 1
        self.assertGreater(steps_down, steps_up)

    def test_the_band_between_the_watermarks_holds_steady(self):
        # Neither hurting nor comfortable: keep the pace that is working.
        self.assertEqual(next_delay(0.5, MIDDLING), 0.5)

    def test_memory_stall_alone_is_enough_to_back_off(self):
        # Swap thrash was the failure that took the box down; IO can look calm
        # in the same window that memory does not.
        swapping = Pressure(io_some=1.0, memory_full=40.0)
        self.assertGreater(next_delay(0.0, swapping), 0.0)

    def test_io_stall_alone_is_enough_to_back_off(self):
        self.assertGreater(next_delay(0.0, Pressure(io_some=80.0, memory_full=0.0)), 0.0)


if __name__ == "__main__":
    unittest.main()
