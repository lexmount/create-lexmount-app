import type { Locator, Page } from 'playwright';
import type { LocatorRule } from './config.js';

type Role = Parameters<Page['getByRole']>[0];

type LocatorRoot = Pick<
  Page | Locator,
  'locator' | 'getByRole' | 'getByLabel' | 'getByText'
>;

export function locatorFor(root: LocatorRoot, rule: LocatorRule): Locator {
  if (rule.by === 'role') {
    return root.getByRole(rule.role as Role, {
      name: rule.name,
      exact: rule.exact,
    });
  }
  if (rule.by === 'label') {
    return root.getByLabel(rule.value, { exact: rule.exact });
  }
  if (rule.by === 'text') {
    return root.getByText(rule.value, { exact: rule.exact });
  }
  return root.locator(rule.value);
}
