import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_NAME } from '@shared/app-identity';

/**
 * Nothing the user reads may say "Switchdash" (CHOO-2344).
 *
 * `app.name` is the name announced to the OS and is frozen at the old one on
 * purpose — `safeStorage` keys its encryption off it, so renaming it orphans
 * every saved sign-in. The macOS app menu was built from it anyway, which is
 * why "About Switchdash" / "Hide Switchdash" / "Quit Switchdash" sat under a
 * menu bar reading "Switch Console".
 */

const OS_NAME = 'Switchdash';

const setApplicationMenu = vi.fn();
const buildFromTemplate = vi.fn((template: unknown) => template);
const setAboutPanelOptions = vi.fn();

vi.mock('electron', () => ({
  app: {
    get name() {
      return OS_NAME;
    },
    getVersion: () => '1.2.3',
    showAboutPanel: vi.fn(),
    quit: vi.fn(),
    setAboutPanelOptions,
  },
  clipboard: { writeText: vi.fn() },
  Menu: { buildFromTemplate, setApplicationMenu },
  shell: { openExternal: vi.fn() },
}));
vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('./window', () => ({ getMainWindow: () => null }));

const originalPlatform = process.platform;

function setPlatform(value: string) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

/** Every label in the template, however deeply nested. */
function labels(template: unknown): string[] {
  const found: string[] = [];
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue;
      const entry = item as { label?: unknown; submenu?: unknown };
      if (typeof entry.label === 'string') found.push(entry.label);
      walk(entry.submenu);
    }
  };
  walk(template);
  return found;
}

describe('application menu naming', () => {
  beforeEach(() => {
    vi.resetModules();
    buildFromTemplate.mockClear();
    setAboutPanelOptions.mockClear();
    setPlatform('darwin');
  });

  afterAll(() => setPlatform(originalPlatform));

  async function build() {
    const { setupApplicationMenu } = await import('./menu');
    setupApplicationMenu();
    return buildFromTemplate.mock.calls[0][0];
  }

  it('never shows the OS-level app name', async () => {
    expect(labels(await build()).filter((label) => label.includes(OS_NAME))).toEqual([]);
  });

  it('names the product in About, Hide and Quit', async () => {
    const found = labels(await build());
    expect(found).toContain(`About ${PRODUCT_NAME}`);
    expect(found).toContain(`Hide ${PRODUCT_NAME}`);
    expect(found).toContain(`Quit ${PRODUCT_NAME}`);
  });

  it('titles the app menu with the product name', async () => {
    expect(labels(await build())[0]).toBe(PRODUCT_NAME);
  });

  it('makes the About panel say the product name too', async () => {
    await build();
    expect(setAboutPanelOptions).toHaveBeenCalledWith({ applicationName: PRODUCT_NAME });
  });
});
