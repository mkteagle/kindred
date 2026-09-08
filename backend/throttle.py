#!/usr/bin/env python3
"""Adaptive pacing for the indexing workers, driven by kernel stall pressure.

A fixed CPU quota is the wrong instrument for a job that has to get through a
million and a half photos. It throttles the worker just as hard at three in the
morning, when the box is idle, as it does under load -- so the run takes the
worst case everywhere.

Pressure Stall Information is the signal worth pacing against. The kernel
reports, in `/proc/pressure/{io,memory,cpu}`, the share of the last ten seconds
in which work was stalled waiting for a resource. It measures the thing we
actually care about -- "is this box hurting" -- rather than a proxy like load
average, which cannot tell twelve busy cores from twelve blocked ones.

Two lines matter here:

  io.some      any task stalled on IO. On this NAS that is mostly swap thrash,
               and it is what makes the web app feel dead.
  memory.full  *every* runnable task stalled on memory at once. Non-zero means
               the host is paging, which is the failure that took it down.

The response is additive-increase/multiplicative-decrease, the control law TCP
uses for the same reason: back off fast when the signal says you are hurting,
recover slowly so you do not immediately re-saturate. Delay doubles under
pressure and decays gently once it clears, so an idle box converges to no delay
at all and a struggling one converges to whatever pace it can sustain.

Everything here is a pure function of numbers read from a file, so the control
law can be tested without a NAS under load.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# Above these, the box is stalling enough that a person notices.
IO_HIGH = 40.0
MEMORY_HIGH = 5.0
# Below these it has recovered and the worker may take more.
IO_LOW = 15.0
MEMORY_LOW = 1.0

# Seconds of pause per photo. The ceiling is a floor on throughput, not a
# stop: even a badly struggling box keeps making progress, roughly one photo
# every four seconds, rather than stalling the queue forever.
MAX_DELAY = 4.0
MIN_STEP = 0.05
DECAY = 0.85


@dataclass(frozen=True)
class Pressure:
    """The share of the last ten seconds spent stalled, per resource."""

    io_some: float = 0.0
    memory_full: float = 0.0
    cpu_some: float = 0.0

    @property
    def hurting(self) -> bool:
        return self.io_some >= IO_HIGH or self.memory_full >= MEMORY_HIGH

    @property
    def comfortable(self) -> bool:
        return self.io_some <= IO_LOW and self.memory_full <= MEMORY_LOW


def parse_pressure_file(text: str) -> dict[str, float]:
    """Pull the avg10 figures out of one /proc/pressure file.

    The format is two lines, `some` and `full`, each `key=value` pairs:

        some avg10=69.14 avg60=66.97 avg300=49.62 total=24315054087
        full avg10=42.09 avg60=42.71 avg300=29.90 total=14877752112

    `cpu` has no `full` line, so a caller must not assume both are present.
    """
    found: dict[str, float] = {}
    for line in text.splitlines():
        fields = line.split()
        if not fields:
            continue
        kind = fields[0]
        for field in fields[1:]:
            key, _, value = field.partition("=")
            if key == "avg10":
                try:
                    found[kind] = float(value)
                except ValueError:
                    pass
    return found


def read_pressure(root: str | Path = "/proc/pressure") -> Pressure | None:
    """Current stall pressure, or None where the kernel does not report it.

    PSI needs a 4.20 kernel with CONFIG_PSI, and the files are absent
    otherwise. Absent means unthrottled: a worker that cannot see the pressure
    should run at full speed rather than pace itself against a guess.
    """
    base = Path(root)
    try:
        io = parse_pressure_file((base / "io").read_text())
        memory = parse_pressure_file((base / "memory").read_text())
        cpu = parse_pressure_file((base / "cpu").read_text())
    except OSError:
        return None
    return Pressure(
        io_some=io.get("some", 0.0),
        memory_full=memory.get("full", 0.0),
        cpu_some=cpu.get("some", 0.0),
    )


def next_delay(delay: float, pressure: Pressure | None) -> float:
    """The pause to take before the next photo, given the last one's aftermath.

    Doubling on the way up and decaying on the way down means a box that has
    just started swapping is backed off within a few photos, while one that has
    recovered takes a couple of dozen to return to full speed -- slow enough
    not to set the thrash going again.
    """
    if pressure is None:
        return 0.0
    if pressure.hurting:
        return min(max(delay * 2.0, MIN_STEP), MAX_DELAY)
    if pressure.comfortable:
        relaxed = delay * DECAY
        return 0.0 if relaxed < MIN_STEP else relaxed
    return delay


def describe(delay: float, pressure: Pressure | None) -> str:
    """One line for the worker log, so a slow run explains itself."""
    if pressure is None:
        return "pressure unavailable; running unthrottled"
    return (
        f"io={pressure.io_some:.0f}% mem={pressure.memory_full:.0f}% "
        f"cpu={pressure.cpu_some:.0f}% delay={delay:.2f}s"
    )
