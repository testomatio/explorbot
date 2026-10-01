import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type Browser, chromium } from 'playwright';
import { captureHtmlForSnapshot, htmlCombinedSnapshot } from '../../src/utils/html.ts';

let browser: Browser;
let snapshot: string;

const PAGE = `
  <html><head><style>
    @media (min-width: 1px) { #content-mobile { display: none; } }
    .toggle input { display: none; }
    .contents { display: contents; }
  </style></head>
  <body>
    <div id="content-mobile">
      <form id="new_user"><input id="user_email" placeholder="Mobile email"><button>Mobile sign in</button></form>
    </div>
    <div id="content-desktop">
      <form id="new_user"><input id="user_email" placeholder="Desktop email"><button>Desktop sign in</button></form>
    </div>
    <label class="toggle"><input type="checkbox" name="remember">Remember me</label>
    <select name="role"><option>Admin</option><option>Viewer</option></select>
    <div class="contents"><button>Inside contents wrapper</button></div>
    <div style="display:none"><button>Script hidden</button></div>
  </body></html>
`;

beforeAll(async () => {
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(PAGE);
  snapshot = htmlCombinedSnapshot(await page.evaluate(captureHtmlForSnapshot));
});

afterAll(async () => {
  await browser?.close();
});

describe('hidden subtrees in captured HTML', () => {
  it('drops a container hidden by a media query', () => {
    expect(snapshot).toContain('Desktop email');
    expect(snapshot).not.toContain('Mobile email');
    expect(snapshot).not.toContain('Mobile sign in');
  });

  it('drops a container hidden by an inline style', () => {
    expect(snapshot).not.toContain('Script hidden');
  });

  it('keeps hidden native controls driven through their label', () => {
    expect(snapshot).toContain('name="remember"');
  });

  it('keeps options of a closed select', () => {
    expect(snapshot).toContain('Admin');
    expect(snapshot).toContain('Viewer');
  });

  it('keeps children of a display: contents wrapper', () => {
    expect(snapshot).toContain('Inside contents wrapper');
  });
});
