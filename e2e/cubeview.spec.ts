import fs from 'node:fs';
import path from 'node:path';
import { test, expect, Page } from '@playwright/test';

const STEP_FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  'node_modules',
  'occt-import-js',
  'test',
  'testfiles',
  'simple-basic-cube',
  'cube.stp',
);

// VIEW_ANGLES from CubeView.ts (beta, alpha)
const VIEWS = {
  front: { beta: Math.PI * 0.5, alpha: Math.PI * 0.5 },
  top: { beta: 0, alpha: 0 },
  right: { beta: Math.PI * 0.5, alpha: 0 },
  home: { beta: Math.PI * 0.25, alpha: Math.PI * 0.25 },
};

async function waitForRender(page: Page) {
  await page.waitForTimeout(600);
}

async function navigateTo(page: Page, view: keyof typeof VIEWS) {
  const { alpha, beta } = VIEWS[view];
  await page.evaluate(
    ([a, b]) => (window as any).cubeView.setOrientation({ alpha: a, beta: b }),
    [alpha, beta],
  );
  await waitForRender(page);
}

function getMajorTickValues(minValue: number, maxValue: number, stepValue: number) {
  const values: number[] = [];
  const epsilon = 1e-6;
  const start = Math.ceil((minValue - epsilon) / stepValue) * stepValue;
  const end = Math.floor((maxValue + epsilon) / stepValue) * stepValue;

  for (let value = start; value <= end + epsilon; value += stepValue) {
    const snappedValue = Math.abs(value) < epsilon ? 0 : Number(value.toFixed(6));
    if (snappedValue >= minValue - epsilon && snappedValue <= maxValue + epsilon) {
      values.push(snappedValue);
    }
  }

  return values;
}

function extractAxisLabelValues(names: string[], axis: 'right' | 'bottom') {
  const prefix = `grid_${axis}_`;
  return names
    .filter((name) => name.startsWith(prefix))
    .map((name) => {
      const value = Number(name.slice(name.lastIndexOf('_') + 1));
      return Math.abs(value) < 1e-6 ? 0 : Number(value.toFixed(6));
    })
    .sort((a, b) => a - b);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).cubeView !== undefined);
  await page.waitForFunction(() => (window as any).rendererDemo !== undefined);
  await waitForRender(page);
});

test('default isometric view', async ({ page }) => {
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('isometric.png');
});

test('starts with SSAO disabled', async ({ page }) => {
  const ssaoToggle = page.locator('#ssaoToggle');
  const ssaoToggleLabel = page.locator('#ssaoToggleLabel');
  const summary = await page.evaluate(() => (window as any).rendererDemo.getSsaoSummary());

  expect(summary.enabled).toBe(false);
  await expect(ssaoToggle).not.toBeChecked();

  if (summary.supported) {
    await expect(ssaoToggle).toBeEnabled();
    await ssaoToggleLabel.click();
    await waitForRender(page);
    await expect(ssaoToggle).toBeChecked();
    expect(await page.evaluate(() => (window as any).rendererDemo.getSsaoSummary().enabled)).toBe(true);

    await ssaoToggleLabel.click();
    await waitForRender(page);
    await expect(ssaoToggle).not.toBeChecked();
    expect(await page.evaluate(() => (window as any).rendererDemo.getSsaoSummary().enabled)).toBe(false);
  } else {
    await expect(ssaoToggle).toBeDisabled();
  }
});

test('steel material uses a reflective textured PBR finish', async ({ page }) => {
  await page.evaluate(() => (window as any).rendererDemo.setMaterialMode('steel'));
  await waitForRender(page);

  const summary = await page.evaluate(() => (window as any).rendererDemo.getMaterialSummary());
  expect(summary.mode).toBe('steel');
  expect(summary.className).toBe('PBRMaterial');
  expect(summary.hasAlbedoTexture).toBe(true);
  expect(summary.hasBumpTexture).toBe(true);
  expect(summary.hasMetallicTexture).toBe(true);
  expect(summary.hasSceneEnvironmentTexture).toBe(true);
  expect(summary.metallic).toBeGreaterThan(0.6);
  expect(summary.roughness).toBeGreaterThan(0.25);
  expect(summary.roughness).toBeLessThan(0.4);
  expect(summary.environmentIntensity).toBeGreaterThan(0.75);
  expect(summary.specularIntensity).toBeGreaterThan(0.75);
  expect(summary.clearCoatEnabled).toBe(true);
  expect(summary.anisotropyEnabled).toBe(true);
  expect(summary.anisotropyIntensity).toBeGreaterThan(0.4);

  const ssao = await page.evaluate(() => (window as any).rendererDemo.getSsaoSummary());
  if (ssao.supported) {
    expect(ssao.enabled).toBe(true);
    expect(ssao.totalStrength).toBeGreaterThan(0.45);
    expect(ssao.totalStrength).toBeLessThan(0.6);
  }
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

test('right-click shows context menu with correct labels', async ({ page }) => {
  const canvas = page.locator('#cubeViewCanvas');
  await canvas.click({ button: 'right' });

  const menu = page.locator('[data-mode]');
  await expect(menu).toHaveCount(2);
  await expect(menu.nth(0)).toContainText('Perspective');
  await expect(menu.nth(1)).toContainText('Orthographic');
});

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
  await page.click('#langBtn');
  await page.click('#langBtn');
  await waitForRender(page);
  const cube = page.locator('#cubeViewWrapper');
  await expect(cube).toHaveScreenshot('isometric.png');
});

test('loads a STEP file into the scene', async ({ page }) => {
  test.setTimeout(120_000);

  const defaultGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());
  await page.locator('#stepFileInput').setInputFiles(STEP_FIXTURE_PATH);
  await expect(page.locator('#ioStatus')).toContainText('Loaded cube.stp', { timeout: 120_000 });

  const summary = await page.evaluate(() => (window as any).rendererDemo.getModelSummary());
  const gridSummary = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());
  expect(summary).toEqual({
    name: 'cube.stp',
    meshCount: 1,
    triangleCount: 12,
  });
  expect(gridSummary.halfRangeValue).toBeGreaterThan(defaultGrid.halfRangeValue);
});

test('switches project units and converts grid values', async ({ page }) => {
  const unitOptions = await page.locator('#unitSelect option').evaluateAll((options) => (
    options.map((option) => (option as HTMLOptionElement).value)
  ));
  const defaultGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());
  const defaultBounds = await page.evaluate(() => (window as any).rendererDemo.getModelBounds());
  const defaultWidth = defaultBounds.max.x - defaultBounds.min.x;
  expect(unitOptions).toEqual(['millimeter', 'centimeter']);
  expect(defaultGrid.unitLabel).toBe('mm');
  expect(defaultGrid.coordinateScale).toBe(25);

  await page.selectOption('#unitSelect', 'centimeter');
  await waitForRender(page);

  const centimeterUnit = await page.evaluate(() => (window as any).rendererDemo.getUnit());
  const centimeterGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());
  const centimeterBounds = await page.evaluate(() => (window as any).rendererDemo.getModelBounds());
  const centimeterWidth = centimeterBounds.max.x - centimeterBounds.min.x;
  expect(centimeterUnit.key).toBe('centimeter');
  expect(centimeterGrid.unitLabel).toBe('cm');
  expect(centimeterGrid.coordinateScale).toBeCloseTo(2.5);
  expect(centimeterWidth).toBeCloseTo(defaultWidth);
  expect(centimeterGrid.widthWorld).toBeCloseTo(defaultGrid.widthWorld);
  expect(centimeterGrid.widthValue).toBeCloseTo(defaultGrid.widthValue / 10);

  await page.selectOption('#unitSelect', 'millimeter');
  await waitForRender(page);

  const restoredGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());
  const restoredBounds = await page.evaluate(() => (window as any).rendererDemo.getModelBounds());
  const restoredWidth = restoredBounds.max.x - restoredBounds.min.x;
  expect(restoredGrid.unitLabel).toBe('mm');
  expect(restoredGrid.coordinateScale).toBeCloseTo(25);
  expect(restoredWidth).toBeCloseTo(defaultWidth);
  expect(restoredGrid.widthWorld).toBeCloseTo(defaultGrid.widthWorld);
  expect(restoredGrid.widthValue).toBeCloseTo(defaultGrid.widthValue);
});

test('shows a scale bar that follows the selected unit', async ({ page }) => {
  const scaleBar = page.locator('#scaleBar');
  await expect(scaleBar).toBeVisible();

  const millimeterScale = await page.evaluate(() => (window as any).rendererDemo.getScaleBarSummary());
  expect(millimeterScale.visible).toBe(true);
  expect(millimeterScale.unitLabel).toBe('mm');
  expect(millimeterScale.label).toMatch(/mm$/);
  expect(millimeterScale.pixelWidth).toBeGreaterThan(48);
  expect(millimeterScale.pixelWidth).toBeLessThan(160);

  await page.selectOption('#unitSelect', 'centimeter');
  await waitForRender(page);

  const centimeterScale = await page.evaluate(() => (window as any).rendererDemo.getScaleBarSummary());
  expect(centimeterScale.visible).toBe(true);
  expect(centimeterScale.unitLabel).toBe('cm');
  expect(centimeterScale.label).toMatch(/cm$/);
  expect(centimeterScale.value).toBeCloseTo(millimeterScale.value / 10);
  expect(centimeterScale.pixelWidth).toBeCloseTo(millimeterScale.pixelWidth);
});

test('generates a simple facing toolpath and exports G-code', async ({ page }) => {
  await expect(page.locator('#gcodeExportBtn')).toBeDisabled();

  await page.evaluate(() => (window as any).rendererDemo.setMaterialMode('steel'));
  await page.click('#toolpathGenerateBtn');
  await expect(page.locator('#ioStatus')).toContainText('Toolpath generated');

  const summary = await page.evaluate(() => (window as any).rendererDemo.getToolpathSummary());
  expect(summary.strategy).toBe('facing-raster');
  expect(summary.unitLabel).toBe('mm');
  expect(summary.toolDiameter).toBeCloseTo(6);
  expect(summary.stepoverRatio).toBeCloseTo(0.6);
  expect(summary.rowCount).toBeGreaterThan(1);
  expect(summary.cutPointCount).toBe(summary.rowCount * 2);
  expect(summary.rapidSegmentCount).toBe(2);
  expect(summary.cutLength).toBeGreaterThan(0);
  expect(summary.meshNames).toEqual(expect.arrayContaining(['toolpathCutLine', 'toolpathRapidLine']));

  await expect(page.locator('#gcodeExportBtn')).toBeEnabled();
  await expect(page.locator('#simulationSpeedInput')).toBeEnabled();
  await expect(page.locator('#simulationPlayBtn')).toBeEnabled();
  await expect(page.locator('#simulationResetBtn')).toBeEnabled();

  const initialSimulation = await page.evaluate(() => (
    (window as any).rendererDemo.getToolpathSimulationSummary()
  ));
  expect(initialSimulation.enabled).toBe(true);
  expect(initialSimulation.progress).toBe(0);
  expect(initialSimulation.moveCount).toBeGreaterThan(1);
  expect(initialSimulation.toolPosition).not.toBeNull();
  expect(initialSimulation.toolMeshNames).toEqual(expect.arrayContaining([
    'toolpathSimulationCutter',
    'toolpathSimulationTip',
  ]));

  await page.fill('#simulationSpeedInput', '500');
  await page.click('#simulationPlayBtn');
  await page.waitForFunction(() => (
    (window as any).rendererDemo.getToolpathSimulationSummary().progress > 0.02
  ));

  const runningSimulation = await page.evaluate(() => (
    (window as any).rendererDemo.getToolpathSimulationSummary()
  ));
  expect(runningSimulation.currentDistance).toBeGreaterThan(0);
  expect(runningSimulation.progress).toBeGreaterThan(0.02);
  expect(runningSimulation.chipCount).toBeGreaterThan(0);
  expect(runningSimulation.chipMeshNames[0]).toMatch(/^toolpathChip_/);
  expect(runningSimulation.chipMaterial.mode).toBe('steel');
  expect(runningSimulation.chipMaterial.className).toBe('PBRMaterial');
  expect(runningSimulation.chipMaterial.hasAlbedoTexture).toBe(true);
  expect(runningSimulation.chipMaterial.hasBumpTexture).toBe(true);
  expect(runningSimulation.chipMaterial.hasMetallicTexture).toBe(true);
  expect(runningSimulation.chipMaterial.metallic).toBeGreaterThan(0.6);
  expect(runningSimulation.chipMaterial.roughness).toBeGreaterThan(0.25);
  expect(runningSimulation.chipMaterial.roughness).toBeLessThan(0.4);
  expect(runningSimulation.chipMaterial.environmentIntensity).toBeGreaterThan(0.75);
  expect(runningSimulation.chipMaterial.clearCoatEnabled).toBe(true);
  expect(runningSimulation.chipMaterial.anisotropyEnabled).toBe(true);

  const runningShadow = await page.evaluate(() => (window as any).rendererDemo.getShadowSummary());
  expect(runningShadow.casterNames.some((name: string) => name.startsWith('toolpathChip_'))).toBe(true);

  await page.click('#simulationResetBtn');
  const resetSimulation = await page.evaluate(() => (
    (window as any).rendererDemo.getToolpathSimulationSummary()
  ));
  expect(resetSimulation.isPlaying).toBe(false);
  expect(resetSimulation.progress).toBe(0);
  expect(resetSimulation.chipCount).toBe(0);

  const resetShadow = await page.evaluate(() => (window as any).rendererDemo.getShadowSummary());
  expect(resetShadow.casterNames.some((name: string) => name.startsWith('toolpathChip_'))).toBe(false);

  const gcode = await page.evaluate(() => (window as any).rendererDemo.getToolpathGcode());
  expect(gcode).toContain('(Strategy: simple facing raster)');
  expect(gcode).toContain('G21');
  expect(gcode).toContain('G1 Z');
  expect(gcode).toContain('M30');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#gcodeExportBtn'),
  ]);

  expect(download.suggestedFilename()).toBe('default-cube-facing.nc');
  await expect(download.failure()).resolves.toBeNull();

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(fs.readFileSync(downloadPath!, 'utf8')).toBe(gcode);
});

test('biases the grid range toward an offset model', async ({ page }) => {
  const defaultGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());

  await page.evaluate(() => {
    (window as any).rendererDemo.offsetModel({ x: 12, y: 0, z: 0 });
  });
  await waitForRender(page);

  const offsetGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());
  expect(offsetGrid.minXValue).toBeGreaterThan(defaultGrid.minXValue);
  expect(offsetGrid.maxXValue).toBeGreaterThan(defaultGrid.maxXValue);
  expect(offsetGrid.minXValue).toBeLessThanOrEqual(0);
  expect(offsetGrid.maxXValue).toBeGreaterThan(Math.abs(offsetGrid.minXValue));
  expect(offsetGrid.widthValue).toBe(offsetGrid.heightValue);
  expect(offsetGrid.widthValue).toBeGreaterThan(700);
});

test('keeps grid edges stable while camera zoom changes', async ({ page }) => {
  const initialGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());

  await page.evaluate(() => {
    (window as any).rendererDemo.setCameraRadius(8);
  });
  await waitForRender(page);

  const zoomedInGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());

  await page.evaluate(() => {
    (window as any).rendererDemo.setCameraRadius(24);
  });
  await waitForRender(page);

  const zoomedOutGrid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());

  expect(zoomedInGrid.minXValue).toBe(initialGrid.minXValue);
  expect(zoomedInGrid.maxXValue).toBe(initialGrid.maxXValue);
  expect(zoomedInGrid.minYValue).toBe(initialGrid.minYValue);
  expect(zoomedInGrid.maxYValue).toBe(initialGrid.maxYValue);

  expect(zoomedOutGrid.minXValue).toBe(initialGrid.minXValue);
  expect(zoomedOutGrid.maxXValue).toBe(initialGrid.maxXValue);
  expect(zoomedOutGrid.minYValue).toBe(initialGrid.minYValue);
  expect(zoomedOutGrid.maxYValue).toBe(initialGrid.maxYValue);

  expect(zoomedInGrid.majorValueStep).not.toBe(zoomedOutGrid.majorValueStep);
});

test('grid labels only show major ticks, not boundary values', async ({ page }) => {
  await page.evaluate(() => {
    (window as any).rendererDemo.offsetModel({ x: 12, y: 0, z: 0 });
  });
  await waitForRender(page);

  const grid = await page.evaluate(() => (window as any).rendererDemo.getGridSummary());
  const labelNames = await page.evaluate(() => (window as any).rendererDemo.getGridLabelNames());

  const rightValues = extractAxisLabelValues(labelNames, 'right');
  const bottomValues = extractAxisLabelValues(labelNames, 'bottom');
  const expectedRightValues = getMajorTickValues(grid.minXValue, grid.maxXValue, grid.majorValueStep);
  const expectedBottomValues = getMajorTickValues(grid.minYValue, grid.maxYValue, grid.majorValueStep);

  expect(rightValues).toEqual(expectedRightValues);
  expect(bottomValues).toEqual(expectedBottomValues);
});

test('exports the active model as STEP', async ({ page }) => {
  test.setTimeout(120_000);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.click('#stepExportBtn'),
  ]);

  expect(download.suggestedFilename()).toBe('default-cube.step');
  await expect(download.failure()).resolves.toBeNull();

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  const stat = fs.statSync(downloadPath!);
  expect(stat.size).toBeGreaterThan(0);
  const importedName = path.basename(downloadPath!);

  await page.locator('#stepFileInput').setInputFiles(downloadPath!);
  await expect(page.locator('#ioStatus')).toContainText(`Loaded ${importedName}`, { timeout: 120_000 });

  const summary = await page.evaluate(() => (window as any).rendererDemo.getModelSummary());
  expect(summary).toEqual({
    name: importedName,
    meshCount: 1,
    triangleCount: 12,
  });
});

test('exports STEP with selected project unit metadata', async ({ page }) => {
  test.setTimeout(120_000);

  await page.selectOption('#unitSelect', 'centimeter');
  await waitForRender(page);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120_000 }),
    page.click('#stepExportBtn'),
  ]);

  await expect(download.failure()).resolves.toBeNull();

  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  const stepText = fs.readFileSync(downloadPath!, 'utf8');
  expect(stepText).toContain('SI_UNIT(.CENTI.,.METRE.)');
});
