const j = (...parts) => parts.join('');

export const SAMPLES = [
  { rule: 'private-key', text: j('-----BEGIN ', 'RSA', ' PRIVATE KEY-----') },
  { rule: 'jwt', text: j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk') },
  { rule: 'aws-access-key-id', text: j('AK', 'IA', 'IOSFODNN7EXAMPLE') },
  { rule: 'aws-secret-access-key', text: j('aws_secret_access_key', ' = "', 'w'.repeat(40), '"') },
  { rule: 'github-token', text: j('gh', 'p', '_', 'a'.repeat(36)) },
  { rule: 'github-token', text: j('github', '_pat_', 'b'.repeat(24)) },
  { rule: 'slack-token', text: j('xo', 'xb', '-', '1'.repeat(12), '-', 'c'.repeat(24)) },
  { rule: 'llm-api-key', text: j('s', 'k', '-ant-api03-', 'D'.repeat(28)) },
  { rule: 'google-api-key', text: j('AI', 'za', 'Sy', 'E'.repeat(33)) },
  { rule: 'npm-token', text: j('npm', '_', 'f'.repeat(36)) },
  { rule: 'bearer-token', text: j('Bearer', ' ', 'g'.repeat(32)) },
  { rule: 'authorization-header', text: j('"authorization"', ': "', 'Basic ', 'h'.repeat(24), '"') },
  { rule: 'assigned-credential', text: j('password', ' = "', 'hunter2hunter2', '"') },
  { rule: 'assigned-credential', text: j('client_secret', ': "', 'not-a-real-value', '"') },
  { rule: 'connection-string', text: j('postgres', 'ql://', 'appuser', ':', 'placeholder', '@', 'db.example:5432/appdb') },
  { rule: 'otel-headers', text: j('OTEL_EXPORTER_OTLP_HEADERS', '="', 'Authorization=Redacted', '"') },
  { rule: 'claude-credentials-file', text: j('"', 'accessToken', '": "value"') },
  { rule: 'email-address', text: j('someone', '@', 'example.com') },
  { rule: 'phone-number', text: '(555) 123-4567' },
  { rule: 'phone-number', text: '555-123-4567' },
  { rule: 'windows-user-path', text: j('C:', '\\Users\\', 'SomePerson', '\\Documents') },
  { rule: 'posix-user-path', text: j('/', 'home', '/', 'someperson', '/projects') },
  { rule: 'uuid', text: '123e4567-e89b-12d3-a456-426614174000' },
];

export const CORPUS = SAMPLES.map((s) => s.text).join('\n');
