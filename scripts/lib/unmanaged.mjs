export const UNMANAGED = {
  skills: ['synced'],
};

export function isUnmanaged(dir, rel) {
  const normalised = String(rel).split('\\').join('/');
  return (UNMANAGED[dir] ?? []).some((prefix) => normalised === prefix || normalised.startsWith(`${prefix}/`));
}
