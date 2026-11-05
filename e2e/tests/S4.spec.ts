// T13 1: one e2e test per scenario of story S4 ("to review the design as swimlanes"), named
// after the scenario id. Each step title starts with its flow box, "<box>: <words>", so the
// Birdview playlist maps steps to boxes (`rehearse playlists`).

import { expect, test } from './serve.js';

test('S4-swimlanes', async ({ page, shopUrl }) => {
  await test.step('simulate/report: the server reads the record and validates it', async () => {
    await page.goto(shopUrl);
    await expect(page.getByTestId('epic-title')).toHaveText('Shop checkout');
  });
  await test.step('design-errors: no errors, so the design is shown', async () => {
    await expect(page.getByTestId('report-status')).toHaveText(/validate: OK/);
  });
  await test.step('review/swimlanes: one lane per role, each box in its lane', async () => {
    await page.getByTestId('nav-flow').click();
    await expect(page.getByTestId('lane-buyer')).toBeVisible();
    await expect(page.getByTestId('lane-shop')).toBeVisible();
    await expect(page.getByTestId('box-cart')).toHaveAttribute('data-lane', 'buyer');
    await expect(page.getByTestId('box-pay')).toHaveAttribute('data-lane', 'shop');
  });
});

test('S4-drill', async ({ page, shopUrl }) => {
  await test.step('review/swimlanes: the builder opens a box with children', async () => {
    await page.goto(shopUrl);
    await page.getByTestId('nav-flow').click();
    await page.getByTestId('box-ship').click();
    await expect(page.getByTestId('breadcrumb-root')).toBeVisible();
    await expect(page.getByTestId('breadcrumb-ship')).toBeVisible();
    await expect(page.getByTestId('box-ship/pack')).toBeVisible();
    await expect(page.getByTestId('box-ship/send')).toBeVisible();
  });
});

test('S4-browser', async ({ page, shopUrl }) => {
  await test.step('review/swimlanes: the served UI fills a browser tab', async () => {
    await page.goto(shopUrl);
    await expect(page.getByTestId('app')).toBeVisible();
    await expect(page.getByTestId('nav')).toBeVisible();
    const size = await page.getByTestId('app').boundingBox();
    expect(size?.width).toBeGreaterThan((page.viewportSize()?.width ?? 0) * 0.9);
  });
});

test('S4-big-picture', async ({ page, shopUrl }) => {
  await test.step('review/swimlanes: every role, and one line per story', async () => {
    await page.goto(shopUrl);
    await page.getByTestId('nav-bigpicture').click();
    await expect(page.getByTestId('big-picture')).toBeVisible();
    await expect(page.getByTestId('bp-role-buyer')).toBeVisible();
    await expect(page.getByTestId('bp-role-shop')).toBeVisible();
    await expect(page.getByTestId('bp-line-S1')).toBeVisible();
    await expect(page.getByTestId('bp-line-S2')).toBeVisible();
  });
});

test('S4-story-view', async ({ page, shopUrl }) => {
  await test.step('review/swimlanes: one story shows what, how and output', async () => {
    await page.goto(shopUrl);
    await page.getByTestId('nav-bigpicture').click();
    await page.getByTestId('bp-story-S1').click();
    await expect(page.getByTestId('story-what')).toContainText('to pay for my cart');
    await expect(page.getByTestId('story-how')).toBeVisible();
    await expect(page.getByTestId('story-output')).toBeVisible();
  });
  await test.step('review/swimlanes: the Tests tab lists the story scenarios', async () => {
    await page.getByTestId('story-tab-tests').click();
    await expect(page.getByTestId('story-tests')).toBeVisible();
    await expect(page.getByTestId('story-tests-summary')).not.toHaveText('Reading the player…');
  });
});
