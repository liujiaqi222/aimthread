import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * Dependency direction rules per M1 spec D1:
 *   shared  -> imports nothing from src
 *   service -> imports only shared; MUST NOT import 'electron'
 *   ui      -> imports only shared; MUST NOT import service/main
 *   main    -> imports shared; MUST NOT import service internals
 *
 * Enforced via eslint-plugin-import 'no-restricted-imports' so a violation
 * fails `pnpm lint` regardless of convention.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'out/**', 'release/**', 'node_modules/**', 'coverage/**', 'test-results/**', '.scratch/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 通用规则：下划线前缀的参数/变量视为有意保留（接口占位实现等）。
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ]
    }
  },
  {
    files: ['src/shared/**/*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    },
    plugins: { import: importPlugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main/*', '@service/*', '@ui/*', '../main/**', '../service/**', '../ui/**'],
              message: 'shared/ must not import from main, service, or ui.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/service/**/*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    },
    plugins: { import: importPlugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: "service/ must not import 'electron'. Use host.ts interface instead (ADR 0001)."
            }
          ],
          patterns: [
            {
              group: ['@main/*', '@ui/*', '../main/**', '../ui/**'],
              message: 'service/ may only import from shared.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['src/ui/**/*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser }
    },
    plugins: { import: importPlugin, react, 'react-hooks': reactHooks },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main/*', '@service/*', '../main/**', '../service/**', 'electron'],
              message: 'ui/ may only import from shared.'
            }
          ]
        }
      ],
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules
    },
    settings: { react: { version: '19' } }
  },
  {
    files: ['src/main/**/*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    },
    plugins: { import: importPlugin },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@service/goals/**', '@service/timer/**', '@service/records/**', '@service/footprint/**', '@service/settings/**', '@service/db/**', '@service/rpc/**'],
              message: 'main/ must not import service internals; reference the service entry path only.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['scripts/**/*', 'test/**/*'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node }
    }
  }
)
