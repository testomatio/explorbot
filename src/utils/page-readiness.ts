export async function waitForPageReadiness(page: any, options: PageReadinessOptions = {}): Promise<void> {
  if (!page) return;

  const timeout = options.timeout ?? 6000;
  await page.waitForLoadState?.('domcontentloaded', { timeout })?.catch(() => {});

  await Promise.race([waitForNetworkIdle(page, timeout), waitForVisibleSpinnersHidden(page, options.spinnerSelectors || [], timeout), sleep(timeout)]).catch(() => {});
  await waitForPageBodyContent(page, timeout);
}

function waitForNetworkIdle(page: any, timeout: number): Promise<void> {
  if (!page?.waitForLoadState) return Promise.resolve();
  return page.waitForLoadState('networkidle', { timeout }).catch(() => {});
}

async function waitForVisibleSpinnersHidden(page: any, selectors: string[], timeout: number): Promise<void> {
  if (!selectors.length) return new Promise(() => {});
  if (!page?.locator) return new Promise(() => {});

  const visibleSpinners = [];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const isVisible = await locator
      .first()
      .isVisible({ timeout: 100 })
      .catch(() => false);
    if (!isVisible) continue;
    visibleSpinners.push(locator);
  }

  if (visibleSpinners.length === 0) return new Promise(() => {});

  return Promise.all(visibleSpinners.map((locator) => locator.waitFor({ state: 'hidden', timeout }).catch(() => {}))).then(() => {});
}

function waitForPageBodyContent(page: any, timeout: number): Promise<void> {
  if (!page?.waitForFunction) return Promise.resolve();

  return page
    .waitForFunction(
      () => {
        const body = document.body;
        if (!body) return false;
        return body.children.length > 0 || body.textContent?.trim().length > 0;
      },
      undefined,
      { timeout }
    )
    .catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PageReadinessOptions {
  timeout?: number;
  spinnerSelectors?: string[];
}
