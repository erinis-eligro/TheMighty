import { expect, type Page } from '@playwright/test';

/** Unique per run so a reused database does not skew the record counters. */
export const uniqueNickname = (prefix: string) => `${prefix}-${Date.now().toString(36)}`;

export async function startGameFromLobby(page: Page, nickname: string) {
  await page.goto('/lobby');
  await page.getByLabel('닉네임').fill(nickname);
  const start = page.getByRole('button', { name: '게임 시작' });
  await expect(start).toBeEnabled(); // enabled once the socket is connected
  await start.click();
  await expect(page).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
}

/** The lobby's record line, e.g. "3전 1승 2패 (승률 33%)"; null while it cannot be loaded. */
export async function readRecord(page: Page): Promise<{ total: number; wins: number; losses: number }> {
  const record = page.getByLabel('전적');
  await expect(record).toContainText(/\d+전/);
  const text = (await record.innerText()).replace(/\s+/g, ' ');
  const m = /(\d+)전 (\d+)승 (\d+)패/.exec(text);
  if (!m) throw new Error(`cannot parse record: ${text}`);
  return { total: Number(m[1]), wins: Number(m[2]), losses: Number(m[3]) };
}
