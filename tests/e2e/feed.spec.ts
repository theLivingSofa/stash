import { expect, test, type Page } from "@playwright/test";

const PASSCODE = process.env.APP_PASSCODE ?? "";

async function login(page: Page) {
  const res = await page.request.post("/api/login", { data: { passcode: PASSCODE } });
  expect(res.ok(), "login with APP_PASSCODE").toBeTruthy();
  await page.goto("/");
  await expect(page.locator(".feed-item[data-index='0'] .face-front")).toBeVisible();
}

const feedTop = (page: Page) => page.getByTestId("feed-scroller").evaluate((el) => el.scrollTop);
const feedHeight = (page: Page) => page.getByTestId("feed-scroller").evaluate((el) => el.clientHeight);

/** Real touch scroll gesture (Chromium only), like a finger swipe. */
async function swipe(page: Page, x: number, y: number, dy: number, speed = 1600) {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.synthesizeScrollGesture", {
    x,
    y,
    yDistance: dy,
    gestureSourceType: "touch",
    speed,
    preventFling: false, // keep momentum, like a real flick
  });
  await page.waitForTimeout(700);
}

async function activeCard(page: Page) {
  const h = await feedHeight(page);
  const idx = Math.round((await feedTop(page)) / h);
  return page.locator(`.feed-item[data-index='${idx}']`);
}

test.describe("feed and card flip", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("one card per screen, no layout shift", async ({ page }) => {
    const h = await feedHeight(page);
    const itemH = await page.locator(".feed-item[data-index='0']").evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(itemH - h)).toBeLessThanOrEqual(1);
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) total += e.value;
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 1500);
        }),
    );
    expect(cls).toBeLessThan(0.05);
  });

  test("touch swipe snaps exactly one card", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "touch gesture synthesis needs Chromium");
    const h = await feedHeight(page);
    // A quick flick advances exactly one card (scroll-snap-stop: always).
    await swipe(page, 200, 500, -350);
    await expect.poll(() => feedTop(page)).toBe(h);
    // A short but very fast flick (lots of momentum) still only advances one card.
    await swipe(page, 200, 600, -450, 4000);
    await expect.poll(() => feedTop(page)).toBe(2 * h);
  });

  test("flip, read the back, the feed never moves; flip back restores", async ({ page, browserName }) => {
    const card = await activeCard(page);
    const top0 = await feedTop(page);
    // CSS locator: once flipped, the front is inert so role queries (rightly) skip it.
    const details = card.locator(".face-front button[aria-expanded]");
    await details.click();

    const back = card.locator(".face-back");
    await expect(back).toHaveAttribute("aria-hidden", "false");
    await expect(details).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("feed-scroller")).toHaveAttribute("data-locked", "true");
    await expect(card.locator(".face-front")).toHaveJSProperty("inert", true);
    await expect(back.getByRole("button", { name: /Back to idea/ })).toBeFocused();
    await expect(back.getByText("The thinking behind it")).toBeVisible();

    const scrollBox = back.getByTestId("back-scroll");
    const box = (await scrollBox.boundingBox())!;
    const backTop = () => scrollBox.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
    if (browserName === "chromium") {
      // Scroll the back to its end with real touch swipes, then keep pushing past it.
      for (let i = 0; i < 6; i++) await swipe(page, box.x + box.width / 2, box.y + box.height * 0.8, -500);
      const end = await backTop();
      expect(end.max <= 0 || end.top >= end.max - 2, "back scrolled to its end").toBeTruthy();
      expect(await feedTop(page)).toBe(top0);
      // Swipes on the header and the action bar must not reach the feed either.
      await swipe(page, box.x + box.width / 2, box.y - 30, -400);
      await swipe(page, box.x + box.width / 2, box.y + box.height + 20, -400);
      // And scrolling back up past the top must not pull the feed.
      for (let i = 0; i < 4; i++) await swipe(page, box.x + box.width / 2, box.y + box.height * 0.3, 600);
    } else {
      // Mobile WebKit can't synthesise touch scrolls here; scroll programmatically
      // and check the lock that keeps the feed still.
      await scrollBox.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
      await page.waitForTimeout(400);
      await expect(page.getByTestId("feed-scroller")).toHaveCSS("overflow-y", "hidden");
    }
    expect(await feedTop(page)).toBe(top0);
    await expect(back).toHaveAttribute("aria-hidden", "false"); // still flipped, not advanced

    await back.getByRole("button", { name: /Back to idea/ }).click();
    await expect(page.getByTestId("feed-scroller")).toHaveAttribute("data-locked", "false");
    await expect(details).toHaveAttribute("aria-expanded", "false");
    await expect(details).toBeFocused();
    expect(await feedTop(page)).toBe(top0);
  });

  test("related chip filters the feed and it keeps going", async ({ page }) => {
    const card = await activeCard(page);
    await card.getByRole("button", { name: "Details" }).click();
    const chip = card.locator(".face-back section").filter({ hasText: "Related" }).getByRole("button").first();
    const label = (await chip.textContent())!.trim();
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`concept=${encodeURIComponent(label).replace(/%20/g, "(%20|\\+)")}`));
    await expect(page.getByRole("link", { name: new RegExp(`Showing ${label}`) })).toBeVisible();
    await expect(page.locator(".feed-item[data-index='0'] .face-front")).toBeVisible({ timeout: 60_000 });
  });

  test("save from the back lands in the Library (front and back)", async ({ page }) => {
    const card = await activeCard(page);
    const title = (await card.locator(".face-front h2").first().textContent())?.trim();
    await card.getByRole("button", { name: "Details" }).click();
    const save = card.locator(".face-back").getByRole("button", { name: "Save to Library" });
    await save.click();
    await expect(card.locator(".face-back").getByRole("button", { name: "Remove from Library" })).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(1200);

    await page.goto("/library");
    const item = page.getByRole("link").filter({ hasText: title ?? "" }).first();
    await expect(item).toBeVisible();
    await item.click();
    await page.getByRole("button", { name: "Details" }).click();
    await expect(page.getByText("Where it comes from")).toBeVisible();
    // Clean up: unsave.
    await page.locator(".face-back").getByRole("button", { name: "Remove from Library" }).click();
    await page.waitForTimeout(1200);
  });

  test("offline: last cards stay readable, front and back", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "service worker offline emulation is reliable in Chromium");
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 20_000 });
    await page.reload();
    await expect(page.locator(".feed-item[data-index='0'] .face-front")).toBeVisible();
    await page.waitForTimeout(1500);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByText(/Offline\. Showing your last \d+ cards/)).toBeVisible({ timeout: 20_000 });
    const card = page.locator(".feed-item[data-index='0']");
    await card.getByRole("button", { name: "Details" }).click();
    await expect(card.getByText("Concept", { exact: true })).toBeVisible();
    await context.setOffline(false);
  });
});

test("login is required", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.request.get("/api/feed");
  expect(res.status()).toBe(401);
  await ctx.close();
});
