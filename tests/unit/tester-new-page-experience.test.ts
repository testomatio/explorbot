import { describe, expect, it } from 'bun:test';
import { Tester } from '../../src/ai/tester.ts';

function buildTester(experienceToc: string) {
  const requestedFor: string[] = [];

  const tester = Object.assign(Object.create(Tester.prototype), {
    previousUrl: '/defects',
    seenUiMapUrls: new Set<string>(['/login']),
    stateManager: {
      otherTabs: [],
      getExperienceTracker: () => ({
        renderExperienceTocFor: (state: any) => {
          requestedFor.push(state.url);
          return experienceToc;
        },
      }),
    },
    interactiveAriaWithRefs: async () => 'aria',
  }) as any;

  return { tester, requestedFor };
}

const newPage = {
  url: '/login',
  hash: 'login-hash',
  title: 'Sign in',
  ariaSnapshot: '',
  isInsideIframe: false,
  focusedElement: null,
};

describe('Tester context on a new page', () => {
  it('injects the experience of the page it just landed on', async () => {
    const { tester, requestedFor } = buildTester('<experience>\nA.1 ## FLOW: sign in as the owner\n</experience>');

    const context = await tester.reinjectContextIfNeeded(3, newPage);

    expect(requestedFor).toEqual(['/login']);
    expect(context).toContain('## FLOW: sign in as the owner');
  });

  it('adds nothing when the page has no experience', async () => {
    const { tester } = buildTester('');

    const context = await tester.reinjectContextIfNeeded(3, newPage);

    expect(context).toContain('CURRENT URL: /login');
    expect(context).not.toContain('<experience>');
  });
});
