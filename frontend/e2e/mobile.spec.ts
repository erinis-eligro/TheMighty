import { expect, test } from '@playwright/test';
import { startGameFromLobby, uniqueNickname } from './helpers';

test('mobile portrait: lobby and bidding fit the screen, the hand is reachable', async ({ page }) => {
  const noHorizontalScroll = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  await page.goto('/lobby');
  await expect(page.getByLabel('닉네임')).toBeVisible();
  expect(await noHorizontalScroll()).toBe(true);

  await startGameFromLobby(page, uniqueNickname('e2e-mobile'));

  const bidding = page.getByRole('region', { name: '비딩' });
  await expect(bidding).toBeVisible();
  await expect(bidding.getByRole('button', { name: '패스' })).toBeInViewport();
  // 4 AI seats on top, my 10 cards at the bottom
  await expect(page.getByTestId('user-hand').locator('button')).toHaveCount(10);
  expect(await noHorizontalScroll()).toBe(true);

  // the bidding works by touch: after passing, the human has nothing left to do in the bidding
  await bidding.getByRole('button', { name: '패스' }).tap();
  await expect(bidding.getByRole('button', { name: '패스' })).toBeHidden();
  // no server error toast (Next's own route announcer also has role=alert, so look for the close button)
  await expect(page.getByRole('button', { name: '닫기' })).toHaveCount(0);
});
