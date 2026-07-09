# Testing Guide

## Running Tests

### Unit Tests
```bash
# Run all unit tests
bun test tests/unit

# Run specific test file
bun test tests/unit/state-manager.test.ts

# Run tests with coverage
bun test tests/unit --coverage
```

### Coverage Reports

#### Text Coverage Report
```bash
# Get coverage with text output
bun run test:coverage
```

#### Coverage Summary Only
```bash
# Get just the coverage summary
bun run test:coverage:summary
```

#### LCOV Coverage File
The `--coverage` flag writes coverage data to `coverage/lcov.info`.

## Coverage Configuration

Coverage is configured in `bunfig.toml`:

- **Coverage Directory**: `coverage/`
- **Coverage Threshold**: 80%
- **Included Files**: `src/**/*.{ts,tsx,js,jsx}`
- **Excluded Files**: Test files, TUI components, build artifacts

## Test Structure

```
tests/
├── unit/                    # Unit tests (Bun)
│   ├── state-manager.test.ts
│   ├── experience-tracker.test.ts
│   └── ...
├── integration/             # AI agent tests with mocked LLM
├── node/                    # Node.js build smoke tests
├── regression/              # End-to-end runs with real AI
└── mocks/                   # Test mocks
```

This page covers unit tests. The other suites: integration tests exercise AI agents against a mocked LLM via aimock — see [AI integration tests](./ai-integration-tests.md). Node smoke tests in `tests/node/` verify the compiled npm build and run in CI (`bun run test:node`). Regression tests run Explorbot with real AI against a local fixture app — see [regression tests](./regression-tests.md).

## Writing Tests

### Best Practices

1. **Happy path focus**: Test successful scenarios and core functionality.
2. **Test isolation**: Make each test independent and clean up after itself.
3. **Descriptive names**: Name tests for what they check.
4. **Mock external dependencies**: Use `MockAIProvider` for AI-related tests.
5. **Temp directories**: Use `/tmp/` paths for file system tests.

### Mock AI Provider

```typescript
import { MockAIProvider } from '../mocks/ai-provider.mock';

const mockAI = new MockAIProvider();
mockAI.setResponses([
  { text: 'Mock response 1' },
  { text: 'Mock response 2' }
]);

// Use mockAI.getModel() in your tests
```

## CI/CD Integration

Generate coverage reports for your CI pipeline:

```bash
# Generate coverage for CI
bun test tests/unit --coverage --coverage-reporter=lcov

# Check coverage threshold (exits with error if below 80%)
bun test tests/unit --coverage --coverage-reporter=text
```

Upload the LCOV file (`coverage/lcov.info`) to a coverage service like Codecov or Coveralls.