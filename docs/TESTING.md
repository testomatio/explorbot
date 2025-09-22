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
Coverage data is automatically generated in `coverage/lcov.info` when using the `--coverage` flag.

## Coverage Configuration

Coverage is configured in `bunfig.toml`:

- **Coverage Directory**: `coverage/`
- **Coverage Threshold**: 80%
- **Included Files**: `src/**/*.{ts,tsx,js,jsx}`
- **Excluded Files**: Test files, TUI components, build artifacts

## Current Coverage Status

As of the latest test run:

| Component | Functions | Lines | Status |
|-----------|-----------|-------|---------|
| **ExperienceTracker** | 100% | 100% | ✅ Complete |
| **StateManager** | 77.42% | 68.12% | ⚠️ Good |
| **ActionResult** | 38.89% | 36.93% | ❌ Needs tests |
| **Config** | 44.44% | 32.88% | ❌ Needs tests |
| **Logger** | 31.25% | 59.50% | ❌ Needs tests |

## Test Structure

```
tests/
├── unit/                    # Unit tests
│   ├── state-manager.test.ts
│   ├── experience-tracker.test.ts
│   └── ...
├── mocks/                   # Test mocks
│   └── ai-provider.mock.ts
└── fixtures/                # Test data
```

## Writing Tests

### Test Template
```typescript
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

describe('ComponentName', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  describe('method', () => {
    it('should do something', () => {
      // Test implementation
      expect(actual).toBe(expected);
    });
  });
});
```

### Best Practices

1. **Happy Path Focus**: Tests focus on successful scenarios and core functionality
2. **Test Isolation**: Each test should be independent and clean up after itself
3. **Descriptive Names**: Test names should clearly describe what is being tested
4. **Mock External Dependencies**: Use the MockAIProvider for AI-related tests
5. **Temp Directories**: Use `/tmp/` paths for file system tests

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

Coverage reports can be integrated with CI/CD pipelines:

```bash
# Generate coverage for CI
bun test tests/unit --coverage --coverage-reporter=lcov

# Check coverage threshold (exits with error if below 80%)
bun test tests/unit --coverage --coverage-reporter=text
```

The LCOV file (`coverage/lcov.info`) can be uploaded to coverage services like Codecov or Coveralls.