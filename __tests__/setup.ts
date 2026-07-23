import crypto from 'crypto';

// Global test setup
jest.setTimeout(30000);

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_jwt_secret_key_for_testing';
// Generado en tiempo de ejecución (no hardcodeado) para evitar falsos positivos de escaneo de secretos
process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
process.env.MONGO_URI = 'mongodb://localhost:27017/veronica_test';

// Global mocks for CI environment
if (process.env.CI) {
  // Mock external services in CI
  jest.mock('puppeteer', () => ({
    launch: jest.fn(() =>
      Promise.resolve({
        newPage: jest.fn(() =>
          Promise.resolve({
            setViewport: jest.fn(),
            setContent: jest.fn(),
            pdf: jest.fn(() => Promise.resolve(Buffer.from('mock pdf content'))),
          }),
        ),
        close: jest.fn(),
      }),
    ),
  }));
}

// Console override for cleaner test output
const originalLog = console.log;
const originalError = console.error;

beforeAll(() => {
  // Suppress console.log in tests unless DEBUG is set
  if (!process.env.DEBUG) {
    console.log = jest.fn();
  }

  // Keep error logs for debugging
  console.error = jest.fn((message) => {
    if (process.env.DEBUG) {
      originalError(message);
    }
  });
});

afterAll(() => {
  // Restore console methods
  console.log = originalLog;
  console.error = originalError;
});

// Global test cleanup
afterEach(() => {
  // Clear all mocks after each test
  jest.clearAllMocks();
});
