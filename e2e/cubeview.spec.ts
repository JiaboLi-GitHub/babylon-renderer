import { test, expect, Page } from '@playwright/test';

// VIEW_ANGLES from CubeView.ts (beta, alpha)
const VIEWS = {
  front:  { beta: Math.PI * 0.5, alpha: Math.PI * 0.5 },
  top:    { beta: 0,             alpha: 0 },
  right:  { beta: Math.PI * 0.5, alpha: 0 },
  home:   { beta: Math.PI * 0.25, alpha: Math.PI * 0.25 },
};

/** Wait for Babylon.js to settle after an orientation change. */
async function waitForRender(page: Page) {
  await page.waitForTimeout(600);
}

/** Navigate to a named view via the exposed cubeView API. */
async function navigateTo(page: Page, view: keyof typeof VIEWS) {
  const { alpha, beta } = VIEWS[view];
  await page.evaluate(
    ([a, b]) => (window as any).cubeView.setOrientation({ alpha: a, beta: b }),
    [alpha, beta],
  );
  await waitForRender(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Wait for Babylon.js engine + first render
  await page.waitForFunction(() => (window as any).cubeView !== undefined);
  await waitForRender(page);
});

// ─── Visual regression: standard views ───────────────────────────

test('default isometric view', async ({ page }) => {
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('isometric.png');
});

test('front view', async ({ page }) => {
  await navigateTo(page, 'front');
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('front.png');
});

test('top view', async ({ page }) => {
  await navigateTo(page, 'top');
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('top.png');
});

test('right view', async ({ page }) => {
  await navigateTo(page, 'right');
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('right.png');
});

test('home button returns to isometric', async ({ page }) => {
  await navigateTo(page, 'front');
  await page.evaluate(() => (window as any).cubeView.clickHome());
  await waitForRender(page);
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('isometric.png');
});

// ─── Context menu ────────────────────────────────────────────────

test('right-click shows context menu with correct labels', async ({ page }) => {
  const canvas = page.locator('#cubeViewCanvas');
  await canvas.click({ button: 'right' });

  const menu = page.locator('[data-mode]');
  await expect(menu).toHaveCount(2);
  await expect(menu.nth(0)).toContainText('Perspective');
  await expect(menu.nth(1)).toContainText('Orthographic');
});

// ─── Locale switching ────────────────────────────────────────────

test('switch to Chinese locale', async ({ page }) => {
  await page.click('#langBtn');
  await waitForRender(page);
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('isometric-zh.png');
});

test('Chinese context menu labels', async ({ page }) => {
  await page.click('#langBtn');
  const canvas = page.locator('#cubeViewCanvas');
  await canvas.click({ button: 'right' });

  const menu = page.locator('[data-mode]');
  await expect(menu.nth(0)).toContainText('透视');
  await expect(menu.nth(1)).toContainText('正交');
});

test('switch back to English locale', async ({ page }) => {
  await page.click('#langBtn'); // → zh
  await page.click('#langBtn'); // → en
  await waitForRender(page);
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('isometric.png');
});
