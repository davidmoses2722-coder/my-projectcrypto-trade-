---
name: Drawing chart coordinates
description: Coordinate rules for lightweight-charts drawing overlays.
---

Drawing overlays must use the chart time scale for X coordinates and the candle series price scale for Y coordinates directly. Placeholder coordinates such as time 0 or price 0 can return null and make otherwise valid horizontal, vertical, and Fibonacci drawings disappear.

**Why:** lightweight-charts only converts values inside the currently valid scale domains; an invalid anchor silently produces no drawable coordinate.

**How to apply:** Keep separate `toX(time)` and `toY(price)` helpers alongside any combined point converter, use pointer capture for drag-based drawing interactions, and size the overlay to the exact chart viewport rather than a larger flex parent.