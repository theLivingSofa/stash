# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Primary experience: the iPhone home-screen web app (installed from Safari, standalone display mode). Desktop browsers are secondary but must work.

## Users

- **Owner (primary):** reads on an iPhone, mostly at night in bed in a dark room, and in short breaks or on a commute (one-handed, often in bright light).
- **Invited friends:** sign in with Google once approved; same reading situations.
- **Possibly the public later:** the owner may open Stash to strangers in future, so it should be presentable to someone who has never seen it. No public landing page exists today.

## Product Purpose

Stash is an endless, never-repeating vertical feed of short ideas (≤100-word insights distilled from essays, articles and public-domain books), one card per screen. Each card flips in place to a deeper "back side" (concept, origin, the reasoning behind it, an example, related ideas). Success is a reader who learns something durable in a few seconds per card and keeps the ones worth keeping.

## Positioning

"Instagram for knowledge" without the junk: every card is one standalone insight with a researched back side, sourced from real writing (Aeon, Quanta, Stanford Encyclopedia of Philosophy, Wikipedia, Project Gutenberg and ~130 other sources), never repeated once seen, and saved cards live in a personal Library.

## Operating Context

- Swipe vertically, one card per screen (snap; free-scroll optional). Tap "Details" to flip; the feed is locked while the back is read.
- Actions on both sides: more/less like this, read aloud (on-device voice), share, save.
- Explore: topic grid (16 topics) and a "follow a concept or person" search that matches by meaning.
- Library: saved and liked ideas, full-text and meaning search, named collections.
- Settings: theme (dark default, light), text size, snap toggle, read-aloud voice/speed, refresh, account; owner-only "Behind the scenes" admin.
- Sign-in: Google (invite-only with request-access emails) or the owner's backup passcode.
- Offline: last ~50 cards readable without a connection.

## Capabilities and Constraints

- Next.js 16 (App Router) on Vercel Hobby, Supabase, GitHub Actions cron. Everything must stay on free tiers.
- Must stay smooth on a phone: 60 fps scrolling and flipping, no layout shift; only transform/opacity animate; the feed is virtualized. Heavy effects on scrolling elements are a known risk on iPhone.
- iOS standalone quirks are real constraints (status-bar area, the system-kept home-bar strip, Silent mode muting speech).
- Terminology in use: idea, card, front, back / deep dive, Details, Library, collection, Explore, topic, "Behind the scenes".

## Brand Commitments

- Name: **Stash**. App icon: a glowing neon "S" (gold to pink, Archivo 900) on the darkroom ground, with a hot-pink bookmark ribbon over the corner (since 2026-10-22; source: scripts/icon-source.svg).
- Existing product vocabulary and copy stay unless the owner approves changes.

## Evidence on Hand

- Real content: ~550+ generated ideas across 16 topics, each with a back side and source link.
- No testimonials, user counts, press or pricing exist; never fabricate them.

## Product Principles

1. The idea is the hero: reading comfort beats decoration.
2. Never interrupt reading: no ads, no jank, nothing that moves the feed while you read.
3. Calm at night, legible in daylight.
4. Private by default; sharing is invitation-only.
5. Honest content: sources are always shown; uncertainty is labeled.

## Accessibility & Inclusion

Adjustable text size, dark and light themes, reduced-motion support, real buttons with labels, and WCAG AA contrast (verified with Lighthouse accessibility 100).
