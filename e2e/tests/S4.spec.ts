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
    await page.getByTestId('nav-bigpicture').click();
    await expect(page.getByTestId('bp-role-buyer')).toBeVisible();
    await expect(page.getByTestId('bp-role-shop')).toBeVisible();
    // A box opens in the drawer over the Big picture, with its lane.
    await page.getByTestId('bp-process-cart').click();
    await expect(page.getByTestId('box-drawer')).toHaveAttribute('data-box', 'cart');
    await expect(page.getByTestId('drawer-lane')).toContainText(/buyer/i);
    await page.getByTestId('box-drawer-close').click();
    await page.getByTestId('bp-process-pay').click();
    await expect(page.getByTestId('drawer-lane')).toContainText(/shop/i);
  });
});

test('S4-drill', async ({ page, shopUrl }) => {
  await test.step('review/drill: the builder opens a box with children in the drawer', async () => {
    await page.goto(shopUrl);
    await page.getByTestId('nav-bigpicture').click();
    await page.getByTestId('bp-process-ship').click();
    await expect(page.getByTestId('box-drawer')).toHaveAttribute('data-box', 'ship');
    await expect(page.getByTestId('lane-shop')).toBeVisible();
    await expect(page.getByTestId('box-ship/pack')).toHaveAttribute('data-lane', 'shop');
    await expect(page.getByTestId('box-ship/send')).toBeVisible();
  });
  await test.step('review/drill: a step opens in the same drawer, and the breadcrumb goes back up', async () => {
    await page.getByTestId('drawer-child-ship/pack').click();
    await expect(page.getByTestId('box-drawer')).toHaveAttribute('data-box', 'ship/pack');
    await expect(page).toHaveURL(/\?box=ship\/pack$/);
    await page.getByTestId('drawer-crumb-ship').click();
    await expect(page.getByTestId('box-drawer')).toHaveAttribute('data-box', 'ship');
    await page.goBack();
    await expect(page.getByTestId('box-drawer')).toHaveAttribute('data-box', 'ship/pack');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('box-drawer')).toHaveCount(0);
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
    await expect(page.getByRole('heading', { level: 1 })).toContainText('to pay for my cart'); // the story sentence is the page title (T18)
    await expect(page.getByTestId('story-what')).toBeVisible();
    await expect(page.getByTestId('story-how')).toBeVisible();
    await expect(page.getByTestId('story-output')).toBeVisible();
  });
  await test.step('review/swimlanes: the Tests tab lists the story scenarios', async () => {
    await page.getByTestId('story-tab-tests').click();
    await expect(page.getByTestId('story-tests')).toBeVisible();
    await expect(page.getByTestId('story-tests-summary')).not.toHaveText('Reading the player…');
  });
});
