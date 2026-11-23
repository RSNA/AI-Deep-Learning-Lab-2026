import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**', 'data/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-control-regex': 'off',
    },
  },
  {
    // Principle 5: the client imports protocol only (engineering spec, section 3).
    files: ['packages/client/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'no-restricted-imports': ['error', { patterns: [
        { group: ['@lab02/content-schema', '@lab02/content-schema/*', '@lab02/engine', '@lab02/engine/*', '@lab02/server', '@lab02/server/*'], message: 'The client imports @lab02/protocol only.' },
        { group: ['**/content-schema/**', '**/engine/**', '**/server/**'], message: 'The client imports @lab02/protocol only.' },
      ] }],
    },
  },
  {
    // Only the engine's project/ folder turns pack data into browser types. The protocol imports nothing of ours.
    files: ['packages/protocol/**/*.ts', 'packages/content-schema/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@lab02/*'], message: 'This package imports nothing of ours.' }] }] },
  },
)
