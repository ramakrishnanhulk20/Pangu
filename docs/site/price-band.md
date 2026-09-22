---
title: The price ceiling
description: How the optional price ceiling works, what the market clock means, and where the real stock price comes from.
---

## How the ceiling works

A banded sale (one with the price ceiling turned on) compares two numbers on every single buy: the curve's own price in dollars per token after that buy would happen, and the real stock's price read from a live Pyth price feed. If the curve's price would sit more than a set percentage above the real stock's price, the buy is refused with the program's own `PriceOutsideBand` error before it ever happens. A buy at or below the real price is never refused, because those are exactly the buys that pull an underpriced sale back toward a fair number. A sell is never refused by this rule, ever, no matter what the price is doing.

This only makes sense, and only gets turned on, for a sale of a token tied to a real listed stock. An issuer of a token with no real-world price to compare against would leave the ceiling off entirely.

## The market clock

Pyth only publishes a fresh price for a stock while that stock's real market is actually open for trading. Outside those hours, the price account simply stops moving, and it ages past the freshness window a sale sets for itself. When that happens, Pangu treats it exactly like any other price problem: it refuses buys with `PriceStale` and does nothing to sells. In practice this means a banded sale pauses buying overnight and on weekends, the same way the real stock market does, and starts accepting buys again once the market opens and a fresh price lands. This is not a bug or a workaround. It is the market clock doing its job: no honest price to check against, no buy allowed.

## The Pyth access caveat

Since 26 August 2026, every fresh read of a Pyth price has needed an API key. the team's account was given access to every feed, including stock feeds, through 5 October 2026, which covers the whole of judging. A real issuer running Pangu after this submission would need to get their own Pyth key the same way, through Pyth's own developer program. Nothing about the program or the rules changes based on whose key is refreshing the price; the key only controls who is allowed to fetch a signed update from Pyth's Hermes service and write it on chain, and it never leaves the server side of the demo scripts.

## The history, in two lines

The price ceiling first shipped reading Switchboard On-Demand, a different price oracle, because Pyth had initially refused stock-price access. Switchboard supplied the real stock price for one day of testing, and then, once Pyth granted access and Switchboard announced it was shutting down on 25 September 2026, the ceiling was rebuilt to read Pyth instead, and every mention of Switchboard was removed from the live program.
