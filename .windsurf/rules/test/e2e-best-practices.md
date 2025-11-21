---
trigger: always_on
description: Playwright end-to-end testing patterns and expectations
globs: tests/**/*.spec.ts,tests/**/*.ts
---
# Playwright E2E Tests

- **Use shared fixtures**
  - Import `test`/`expect` from `[fixtures.ts](mdc:tests/Dodo.KnowledgeBase.Ui/fixtures/fixtures.ts)` so page objects, API helpers, and auth utilities stay consistent.
  - Prefer the `storedCookies` fixture when a test needs an authenticated context to avoid duplicate login work.

- **Lean on helpers and page objects**
  - Reuse the page-object classes in `[pages/](mdc:tests/Dodo.KnowledgeBase.Ui/pages)` for interactions; add new methods there instead of ad-hoc selectors in specs.
  - Wrap navigation, assertions, and Allure metadata with `test.step` via `[utils/helpers.ts](mdc:tests/Dodo.KnowledgeBase.Ui/utils/helpers.ts)` for richer reporting.

- **Prefer resilient, accessible locators**
  - Target elements by role, label, or text when possible (e.g., `page.getByRole('button', { name: '...' })`) before falling back to CSS/XPath.
  - Mirror the app’s accessibility requirements—favor semantic selectors over brittle DOM structure hooks.

- **Keep tests focused and deterministic**
  - Scope each spec to a single feature/flow; move common setup into `test.beforeEach` blocks using helpers.

- **Leverage configuration**
  - Align new suites with existing Playwright projects defined in `[playwright.config.ts](mdc:playwright.config.ts)`; extend `testMatch` rather than spinning up new configs.
  - Respect shared `use` options (locale, screenshots, traces) to keep reports uniform.

- **AVOID using mocks unless it's necessary**
  - When writing tests prefer actual data instead of using mocks to test actual behavior.

- **Do not @allure.id to tests**
  - Adding @allure.id is handled on the user's side DO NOT add it yourself.

- **Document Allure hierarchy**
  - Call `Helpers.addAllureHierarchy` at suite setup (see `[auth-tests.spec.ts](mdc:tests/Dodo.KnowledgeBase.Ui/auth-tests.spec.ts)`) so new tests appear correctly in TestOps.

- **Running locally**
  - Follow the workflow in `[README.md](mdc:README.md#L51)` (`yarn --cwd src/frontend serve` + `yarn e2e:ui`) when validating new specs.
