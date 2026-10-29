import { expect, test, type Page } from '@playwright/test';
import { readRecord, startGameFromLobby, uniqueNickname } from './helpers';

/** Plays whichever playable card is first until the result dialog shows up. */
async function playUntilResult(page: Page) {
  const hand = page.getByTestId('user-hand');
  const result = page.getByRole('dialog', { name: '게임 결과' });
  const jokerSuit = page.getByRole('dialog', { name: '조커 무늬 선택' });
  const jokerCall = page.getByRole('dialog', { name: '조커콜 선언' });

  for (let plays = 0; plays < 10; plays++) {
    // The next card of mine that the server marks as playable (my turn): enabled + aria-disabled=false.
    const playable = hand.locator('button[aria-disabled="false"]').first();
    await expect(playable).toBeVisible({ timeout: 30_000 });
    const before = await hand.locator('button').count();
    await playable.click();
    // Leading with the joker / the joker-call card asks one more question first.
    if (await jokerSuit.isVisible()) await jokerSuit.getByRole('button').first().click();
    else if (await jokerCall.isVisible()) await jokerCall.getByRole('button', { name: '그냥 내기' }).click();
    // The server accepted the card: it left my hand.
    await expect(hand.locator('button')).toHaveCount(before - 1);
  }
  await expect(result).toBeVisible({ timeout: 30_000 });
}

test('lobby → bid as president → kitty → friend → 10 tricks → result → record grows', async ({ page }) => {
  const nickname = uniqueNickname('e2e-desktop');

  // a new nickname starts at 0 games
  await page.goto('/lobby');
  await page.getByLabel('닉네임').fill(nickname);
  expect(await readRecord(page)).toEqual({ total: 0, wins: 0, losses: 0 });

  await startGameFromLobby(page, nickname);

  // bidding: the human bids first. 20 no-giruda ends the bidding and makes the human president.
  const bidding = page.getByRole('region', { name: '비딩' });
  await expect(bidding).toBeVisible();
  await bidding.getByRole('button', { name: '노기루다' }).click();
  await bidding.getByRole('button', { name: '20', exact: true }).click();
  await bidding.getByRole('button', { name: /20점.*비딩/ }).click();

  // kitty exchange: pick 3 cards to discard
  const kitty = page.getByRole('dialog', { name: '바닥패 교환' });
  await expect(kitty).toBeVisible();
  const cards = kitty.locator('button[aria-disabled="false"]');
  await expect(cards).toHaveCount(13);
  for (let i = 0; i < 3; i++) await cards.nth(i).click();
  await kitty.getByRole('button', { name: /3장 버리기/ }).click();

  // friend declaration
  const friend = page.getByRole('dialog', { name: '프렌드 선택' });
  await expect(friend).toBeVisible();
  await friend.getByRole('button', { name: '마이티 프렌드 선언' }).click();
  await expect(friend).toBeHidden();

  // card play, each card is validated by the server
  await playUntilResult(page);
  const result = page.getByRole('dialog', { name: '게임 결과' });
  await expect(result).toContainText(/승리|패배/);
  await expect(result).toContainText('비딩 점수');
  await expect(result).toContainText('20점');

  // back to the lobby: the finished game is in the record
  await result.getByRole('button', { name: '로비로' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
  await expect(async () => {
    const record = await readRecord(page);
    expect(record.total).toBe(1);
    expect(record.wins + record.losses).toBe(1);
  }).toPass({ timeout: 15_000 });
  await expect(page.getByLabel('최근 게임')).toBeVisible();
});

test('a reload during the game takes the seat back and the game continues', async ({ page }) => {
  await startGameFromLobby(page, uniqueNickname('e2e-reload'));
  const bidding = page.getByRole('region', { name: '비딩' });
  await expect(bidding).toBeVisible();
  await bidding.getByRole('button', { name: '노기루다' }).click();
  await bidding.getByRole('button', { name: '20', exact: true }).click();
  await bidding.getByRole('button', { name: /20점.*비딩/ }).click();
  await expect(page.getByRole('dialog', { name: '바닥패 교환' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('dialog', { name: '바닥패 교환' })).toBeVisible();
  await expect(page).toHaveURL(/\/game\//);
});
