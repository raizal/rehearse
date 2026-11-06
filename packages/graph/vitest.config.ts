import { configDefaults, defineConfig } from 'vitest/config';

// The fixture repos have test files of their own; they are data here, not tests to run.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'test/fixtures/**'] },
});
