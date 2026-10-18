import { test, expect, type Page } from '@playwright/test';

const ACCESS_CODE = 'e2e-access-code';

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('访问口令').fill(ACCESS_CODE);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('客户接待 · 会话列表')).toBeVisible();
}

test('登录门禁：错误口令提示，正确口令进入工作台', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('请输入演示访问口令')).toBeVisible();
  await page.getByLabel('访问口令').fill('wrong-code');
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('口令不正确，请重试')).toBeVisible();
  await expect(page.getByText('客户接待 · 会话列表')).toHaveCount(0);

  await page.getByLabel('访问口令').fill(ACCESS_CODE);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('客户接待 · 会话列表')).toBeVisible();
});

test('邀请链接：/enter?code= 直接登录并回到干净地址', async ({ page }) => {
  await page.goto(`/enter?code=${ACCESS_CODE}`);
  await expect(page.getByText('客户接待 · 会话列表')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('工作台：138 会话与 S00010 规则剖析、对账可用', async ({ page }) => {
  await login(page);
  await expect(page.getByText('138 个会话')).toBeVisible();
  await expect(page.getByText('不良反应/泛红刺痒').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '对账 · 对齐真实处理口径' })).toBeVisible();
  await expect(page.getByText('3/3 项与真实处理口径一致').first()).toBeVisible();
});

test('洞察页：留出集 92.9% 与 138/998 口径', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '数据洞察' }).click();
  await expect(page.getByText('留出集评估 × 数据标注')).toBeVisible();
  await expect(page.getByText('92.9%').first()).toBeVisible();
  await expect(page.getByText('39 / 42')).toBeVisible();
  await expect(page.getByText('998', { exact: true })).toBeVisible();
});

test('风险看板：26 条跨会话预警、状态跟踪与会话跳转', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: '风险看板' }).click();
  await expect(page.getByRole('heading', { name: '跨会话风险预警' })).toBeVisible();
  await expect(page.getByText('26 / 138')).toBeVisible();

  const card = page.getByTestId('risk-alert-S00024');
  await expect(card).toBeVisible();
  await expect(card.getByText('舆情投诉').first()).toBeVisible();
  await card.getByRole('button', { name: '展开处理' }).click();

  const pill = card.getByTestId('risk-status-S00024');
  const current = (await pill.textContent())?.trim();
  const target = current === '待处理' ? '跟进中' : '待处理';
  await card.getByRole('button', { name: `将 S00024 标记为${target}` }).click();
  await expect(pill).toHaveText(target);

  await card.getByRole('button', { name: '打开会话 S00024' }).click();
  await expect(page.getByText('客户接待 · 会话列表')).toBeVisible();
});

test('会话失效：清除 Cookie 后自动回登录页并提示', async ({ page, context }) => {
  await login(page);
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('登录状态已失效，请重新登录')).toBeVisible();
  await expect(page.getByLabel('访问口令')).toBeVisible();
});

test('CSRF：Cookie 会话跨站写 403，同源写放行', async ({ page, baseURL }) => {
  await login(page);
  const cross = await page.request.post('/api/try', {
    headers: { Origin: 'https://evil.example' },
    data: { text: 'e2e cross-site write' },
  });
  expect(cross.status()).toBe(403);
  expect((await cross.json()).code).toBe('ORIGIN_FORBIDDEN');

  const same = await page.request.post('/api/try', {
    headers: { Origin: baseURL! },
    data: { text: 'e2e same-origin write' },
  });
  expect(same.status()).toBe(200);
  const { id } = (await same.json()) as { id: string };
  const del = await page.request.delete(`/api/try/${encodeURIComponent(id)}`, { headers: { Origin: baseURL! } });
  expect(del.status()).toBe(200);
});
