export async function waitForPageReadiness(page: any, options: PageReadinessOptions = {}): Promise<boolean> {
  if (!page) return false;

  const timeout = options.timeout ?? 6000;
  await page.waitForLoadState?.('domcontentloaded', { timeout })?.catch(() => {});

  await Promise.race([waitForNetworkIdle(page, timeout), waitForDomQuiet(page, timeout), waitForVisibleSpinnersHidden(page, options.spinnerSelectors || [], timeout), sleep(timeout)]).catch(() => {});
  return waitForPageBodyContent(page, timeout);
}

export function waitForDomChange(page: any, timeout: number): Promise<boolean> {
  if (!page?.evaluate) return Promise.resolve(false);

  return page
    .evaluate(
      (ms: number) =>
        new Promise<boolean>((resolve) => {
          const observer = new MutationObserver(() => {
            observer.disconnect();
            resolve(true);
          });
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
          setTimeout(() => {
            observer.disconnect();
            resolve(false);
          }, ms);
        }),
      timeout
    )
    .catch(() => true);
}

const DOM_QUIET_MS = 350;

function waitForDomQuiet(page: any, timeout: number): Promise<void> {
  if (!page?.waitForFunction) return new Promise(() => {});

  return page
    .waitForFunction(
      (quiet: number) => {
        const store = window as any;
        if (!store.__explorbotDomQuiet) {
          store.__explorbotDomQuiet = { last: Date.now() };
          new MutationObserver(() => {
            store.__explorbotDomQuiet.last = Date.now();
          }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        }
        return Date.now() - store.__explorbotDomQuiet.last >= quiet;
      },
      DOM_QUIET_MS,
      { timeout, polling: 100 }
    )
    .catch(() => {});
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

function waitForPageBodyContent(page: any, timeout: number): Promise<boolean> {
  if (!page?.waitForFunction) return Promise.resolve(true);

  return page
    .waitForFunction(
      () => {
        const body = document.body;
        if (!body) return false;
        if (body.innerText.trim().length > 0) return true;
        return !!body.querySelector('input, button, select, textarea, img, svg, canvas, iframe, video');
      },
      undefined,
      { timeout }
    )
    .then(
      () => true,
      () => false
    );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PageReadinessOptions {
  timeout?: number;
  spinnerSelectors?: string[];
}
