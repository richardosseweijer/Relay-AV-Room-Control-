export function isSecretKey(key: string) {
  return /token|password|secret|key|username|(?:^|_)user$|pin/i.test(key);
}

export function redactAuth(auth?: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(auth ?? {}).map(([key, value]) => [key, isSecretKey(key) ? "" : value]),
  );
}
