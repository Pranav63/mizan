import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Run } from '../src/types';

// Audit settled surfaces, rather than a transient crossfade or dialog entrance.
async function settleUI(page: Page) {
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter(animation => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)
        && target instanceof Element && !target.closest('details:not([open])') && target.getClientRects().length > 0;
    });
    await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
  });
}
async function audit(page: Page) {
  await settleUI(page);
  return new AxeBuilder({ page }).analyze();
}
async function navigate(page: Page, tab: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: tab, exact: true }).click();
  await expect(page.locator('main h1')).toHaveText(tab === 'Overview' ? /Compare meaning,\s*across languages\./ : tab);
  await settleUI(page);
}
async function selectDemo(page: Page) {
  await page.getByLabel('Selected benchmark run').selectOption('demo-starter');
  await expect(page.locator('.comparison-row').getByRole('heading', { name: 'Demo A', exact: true })).toBeVisible();
}

test('overview stays concise, then reveals predictions, Arabic inspection and an export', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Compare meaning,\s*across languages\./ })).toBeVisible();
  await selectDemo(page);
  await expect(page.getByText('Demo fixtures.', { exact: true })).toBeVisible();
  await expect(page.locator('.comparison-row')).toHaveCount(2);
  await expect(page.locator('.result-workspace')).toHaveCount(0);
  await expect(page.locator('.clause-table')).toHaveCount(0);
  await expect(page.locator('.matrix-table')).toHaveCount(0);
  await page.screenshot({ path: '../artifacts/dashboard-desktop.png' });
  expect((await audit(page)).violations).toEqual([]);
  await page.getByRole('button', { name: 'Explore results', exact: true }).click();
  await page.getByRole('button', { name: 'Predictions', exact: true }).click();
  await page.getByText('More filters', { exact: true }).click();
  await page.getByRole('checkbox', { name: 'Show misses' }).check();
  await expect(page.locator('.clause-table tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: 'Show 2 more clauses' }).click();
  await expect(page.locator('.clause-table tbody tr')).toHaveCount(8);
  await navigate(page, 'Dataset');
  await expect(page.locator('.clause-table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse all clauses', exact: true }).click();
  await page.getByLabel('Filter by language').selectOption('ar');
  await expect(page.locator('.clause-table tbody tr')).toHaveCount(6);
  await page.getByRole('button', { name: 'Inspect policy-01-ar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect((await audit(page)).violations).toEqual([]);
  await expect(dialog.locator('p[lang="ar"]')).toHaveAttribute('dir', 'auto');
  expect(await dialog.locator('p[lang="ar"]').evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await navigate(page, 'Runs');
  await page.getByRole('button', { name: 'Demo fixtures', exact: true }).click();
  while (!await page.getByRole('button', { name: 'Inspect run demo-starter', exact: true }).count()) {
    await page.getByRole('button', { name: /Show \d+ more runs/ }).click();
  }
  await expect(page.getByRole('region', { name: 'Selected run details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect run demo-starter', exact: true }).click();
  const details = page.getByRole('region', { name: 'Selected run details' });
  await expect(details).toBeVisible();
  const download = page.waitForEvent('download');
  await details.getByRole('link', { name: 'Export demo-starter as CSV' }).click();
  expect((await download).suggestedFilename()).toContain('mizan-demo-starter.csv');
  expect(errors).toEqual([]);
});

test('a demo run finishes with real backend progress and a labelled export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Dataset size').selectOption('5');
  await dialog.getByRole('button', { name: 'Run demo benchmark', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/30 classifications · fixture replay/)).toBeVisible({ timeout: 10000 });
  const href = await page.getByRole('link', { name: 'Export', exact: true }).getAttribute('href');
  const run = await (await page.request.get(href!)).json();
  expect(run.mode).toBe('demo');
  expect(run.status).toBe('completed');
  expect(run.results).toHaveLength(30);
  expect(run.demo_note).toContain('Illustrative');
});

test('results show one requested view at a time and close back to the comparison', async ({ page }) => {
  await page.goto('/');
  await selectDemo(page);
  const explore = page.locator('button[aria-controls="result-workspace"]');
  await explore.focus();
  await page.keyboard.press('Enter');
  await expect(explore).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.result-view')).toHaveCount(1);
  const language = page.getByRole('button', { name: 'Languages', exact: true });
  await expect(language).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.clause-table')).toHaveCount(0);
  await expect(page.locator('.matrix-table')).toHaveCount(0);
  for (const name of ['Predictions', 'Label errors', 'Run details', 'Languages']) {
    const view = page.getByRole('button', { name, exact: true });
    await view.focus();
    await page.keyboard.press('Enter');
    await expect(view).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.result-view')).toHaveCount(1);
    await expect(page.locator('.clause-table')).toHaveCount(name === 'Predictions' ? 1 : 0);
    await expect(page.locator('.matrix-table')).toHaveCount(name === 'Label errors' ? 1 : 0);
  }
  expect((await audit(page)).violations).toEqual([]);
  await page.getByRole('button', { name: 'Hide results', exact: true }).click();
  await expect(page.locator('.result-workspace')).toHaveCount(0);
  await expect(explore).toHaveAttribute('aria-expanded', 'false');
});

test('dataset previews change one language and class without opening the full corpus', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Dataset');
  await expect(page.locator('.dataset-browser-content')).toHaveCount(0);
  const languages = page.getByRole('group', { name: 'Preview language' });
  await languages.getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(page.locator('.dataset-specimen-text')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('.dataset-specimen-text')).toHaveAttribute('dir', 'rtl');
  expect(await page.locator('.dataset-specimen-text').evaluate(el => getComputedStyle(el).direction)).toBe('rtl');
  await languages.getByRole('button', { name: 'Mixed', exact: true }).click();
  await expect(languages.getByRole('button', { name: 'Mixed', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dataset-specimen-text')).toHaveCount(1);
  await page.getByRole('button', { name: 'Permission', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Permission', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.clause-table')).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse all clauses', exact: true }).click();
  await page.getByText('More filters', { exact: true }).click();
  await page.getByLabel('Filter by policy class').selectOption('permission');
  await expect(page.locator('.clause-table tbody tr')).toHaveCount(6);
  await expect(page.locator('.clause-table tbody td:nth-child(3) .tag.permission')).toHaveCount(6);
  await page.getByRole('button', { name: 'Show 6 more clauses' }).click();
  await expect(page.locator('.clause-table tbody tr')).toHaveCount(12);
  await page.getByLabel('Filter by language').selectOption('ar');
  await expect(page.locator('.clause-table tbody tr')).toHaveCount(4);
  expect((await audit(page)).violations).toEqual([]);
  await page.getByRole('button', { name: 'Close clause browser', exact: true }).click();
  await expect(page.locator('.clause-table')).toHaveCount(0);
});

test('method chapters and run conditions replace their reading pane rather than piling up', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Method');
  const chapters = page.getByRole('navigation', { name: 'Method chapters' });
  await expect(page.locator('.method-reading-pane')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: /A comparison you can inspect/ })).toBeVisible();
  await chapters.getByRole('button', { name: 'Rubric', exact: true }).click();
  await expect(page.locator('.rubric-list')).toBeVisible();
  await expect(page.locator('.method-reading-pane')).toHaveCount(1);
  await chapters.getByRole('button', { name: 'Models', exact: true }).click();
  await expect(page.locator('.rubric-list')).toHaveCount(0);
  await expect(page.locator('.method-reading-pane')).toContainText('Each');
  expect((await audit(page)).violations).toEqual([]);
  await navigate(page, 'Runs');
  await page.locator('.run-row').first().click();
  const details = page.getByRole('region', { name: 'Selected run details' });
  await expect(details).toHaveCount(1);
  await details.getByRole('button', { name: 'Conditions', exact: true }).click();
  await expect(details).toContainText('Dataset hash');
  await expect(details.locator('.run-provider-grid')).toHaveCount(0);
  await details.getByRole('button', { name: 'Results', exact: true }).click();
  await expect(details.locator('.run-provider-grid')).toBeVisible();
  expect((await audit(page)).violations).toEqual([]);
});

test('examples and model dialogs remain accessible and restore keyboard focus', async ({ page }) => {
  await page.goto('/');
  const example = page.getByRole('button', { name: 'What are we testing?', exact: true });
  await example.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'العربية', exact: true }).click();
  await expect(dialog.locator('p[lang="ar"]')).toBeVisible();
  expect((await audit(page)).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(example).toBeFocused();
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  expect((await audit(page)).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Model connections', exact: true }).click();
  expect((await audit(page)).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('live model setup selects keyless SemIf and hosted GPT without starting a live run', async ({ page }) => {
  let startedRun = false;
  await page.route('**/api/runs', async route => {
    if (route.request().method() === 'POST') {
      startedRun = true;
      await route.abort();
    } else await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New run', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: /Live models/ }).check();
  await expect(dialog.getByRole('checkbox', { name: /SemIf/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /GPT/ })).toBeChecked();
  await expect(dialog.getByText('Local · no key', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Run live benchmark', exact: true })).toBeEnabled();
  expect((await audit(page)).violations).toEqual([]);
  await page.keyboard.press('Escape');
  expect(startedRun).toBe(false);
});

for (const status of ['completed_with_errors', 'interrupted']) {
  test(`${status} stays prominent while its predictions remain inspectable`, async ({ page }) => {
    const response = await page.request.get('/api/runs/demo-starter');
    expect(response.ok()).toBe(true);
    const fixture: Run = await response.json();
    fixture.status = status;
    if (status === 'interrupted') {
      fixture.results = fixture.results!.slice(0, 6);
      fixture.completed = fixture.results.length;
      fixture.failure = 'Fixture stopped after six classifications.';
    } else {
      fixture.results![0].predicted = null;
      fixture.results![0].error = 'Fixture provider could not classify this clause.';
    }
    for (const provider of fixture.providers) {
      const results = fixture.results!.filter(result => result.provider === provider);
      const summary = fixture.summary[provider];
      summary.total = results.length;
      summary.correct = results.filter(result => !result.error && result.predicted === result.label).length;
      summary.error_count = results.filter(result => result.error).length;
      summary.accuracy = results.length ? summary.correct / results.length : 0;
    }
    await page.route('**/api/runs', route => route.fulfill({ json: [fixture] }));
    await page.route(`**/api/runs/${fixture.id}`, route => route.fulfill({ json: fixture }));
    await page.goto('/');
    const warning = page.locator('.error-banner');
    await expect(warning).toContainText(status === 'interrupted' ? 'partial results' : 'provider errors');
    await expect(warning).toBeVisible();
    await page.getByRole('button', { name: 'Explore results', exact: true }).click();
    await page.getByRole('button', { name: 'Predictions', exact: true }).click();
    await expect(page.locator('.clause-table tbody tr').first()).toBeVisible();
    if (status === 'completed_with_errors') {
      const failed = fixture.results!.find(result => result.error)!;
      await page.getByRole('button', { name: `Inspect ${failed.id}`, exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText(failed.error!);
      await page.keyboard.press('Escape');
    }
    expect((await audit(page)).violations).toEqual([]);
  });
}

test('a stopped run renders an unevaluated provider without inventing scores or pending work', async ({ page }) => {
  const response = await page.request.get('/api/runs/demo-starter');
  expect(response.ok()).toBe(true);
  const fixture: Run = await response.json();
  const failed = { ...fixture.results![0], provider: 'semif', predicted: null, error: 'Fixture scorer failed before the hosted provider was evaluated.' };
  Object.assign(fixture, {
    mode: 'live', status: 'failed', providers: ['semif', 'openai'], completed: 1,
    models: { semif: 'Fixture local model', openai: 'Fixture hosted model' },
    results: [failed],
    summary: { semif: { total: 1, correct: 0, accuracy: 0, error_count: 1 }, openai: {} },
    demo_note: null, cost_note: 'Synthetic stopped-run fixture; no live models were called.',
    failure: 'Fixture execution stopped after the first provider error.',
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/runs', route => route.fulfill({ json: [fixture] }));
  await page.route(`**/api/runs/${fixture.id}`, route => route.fulfill({ json: fixture }));
  await page.goto('/');
  await expect(page.locator('.error-banner')).toContainText('partial results');
  const unmeasured = page.locator('.comparison-row').filter({ hasText: 'GPT' });
  await expect(unmeasured).toContainText('Not evaluated');
  await expect(unmeasured.locator('.comparison-value strong')).toHaveText('—');
  await page.getByRole('button', { name: 'Explore results', exact: true }).click();
  const language = page.locator('.language-result').filter({ hasText: 'GPT' });
  await expect(language.locator('.bar-row strong')).toHaveText(['—', '—', '—']);
  await expect(language.locator('.language-measures dd')).toHaveText(['—', '—', '—']);
  await page.getByRole('button', { name: 'Run details', exact: true }).click();
  const conditions = page.locator('.run-detail-models article').filter({ hasText: 'GPT' });
  await expect(conditions.locator('.language-measures dd')).toHaveText(['—', '—', '—']);
  await page.getByRole('button', { name: 'Predictions', exact: true }).click();
  await expect(page.locator('.clause-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.clause-table tbody td:nth-child(5)')).toHaveText('Not evaluated');
  await expect(page.locator('.result-view')).not.toContainText('Pending');
  expect(errors).toEqual([]);
});

test('compact and expanded mobile surfaces remain accessible without document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await selectDemo(page);
  for (const tab of ['Overview', 'Dataset', 'Runs', 'Method']) {
    await navigate(page, tab);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await audit(page)).violations).toEqual([]);
    if (tab === 'Overview') {
      await page.screenshot({ path: '../artifacts/dashboard-mobile.png' });
      await page.getByRole('button', { name: 'Explore results', exact: true }).click();
      for (const name of ['Languages', 'Predictions', 'Label errors', 'Run details']) {
        await page.getByRole('button', { name, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
    } else if (tab === 'Dataset') await page.getByRole('button', { name: 'Browse all clauses', exact: true }).click();
    else if (tab === 'Runs') await page.locator('.run-row').first().click();
    else await page.getByRole('navigation', { name: 'Method chapters' }).getByRole('button', { name: 'Provenance', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await audit(page)).violations).toEqual([]);
  }
});

test('reduced motion and the pause control keep navigation usable at the narrowest supported width', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => {
    const state = window as typeof window & { mizanTransitionCalls: number };
    state.mizanTransitionCalls = 0;
    if (document.startViewTransition) {
      const original = document.startViewTransition.bind(document);
      document.startViewTransition = callback => {
        state.mizanTransitionCalls += 1;
        return original(callback);
      };
    }
  });
  await page.goto('/');
  for (const tab of ['Dataset', 'Runs', 'Method', 'Overview']) {
    await navigate(page, tab);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(await page.evaluate(() => (window as typeof window & { mizanTransitionCalls: number }).mizanTransitionCalls)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const pause = page.getByRole('button', { name: 'Pause decorative motion' });
  await pause.focus();
  await page.keyboard.press('Space');
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await navigate(page, 'Dataset');
  expect(await page.evaluate(() => (window as typeof window & { mizanTransitionCalls: number }).mizanTransitionCalls)).toBe(0);
});
