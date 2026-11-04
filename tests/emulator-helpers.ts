/** Shared helpers for tests that run against the Firestore emulator. */
export function emulatorHostPort(): { host: string; port: number } {
  const raw = process.env['FIRESTORE_EMULATOR_HOST'];
  if (!raw) {
    throw new Error('FIRESTORE_EMULATOR_HOST is not set. Run these tests with `npm run test:rules`, which starts the emulator.');
  }
  const [host, port] = raw.split(':');
  return { host: host!, port: Number(port) };
}

/** Wipes every document in the emulator's default database. */
export async function clearEmulator(projectId: string): Promise<void> {
  const { host, port } = emulatorHostPort();
  const res = await fetch(`http://${host}:${port}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Could not clear the emulator: ${res.status}`);
}
