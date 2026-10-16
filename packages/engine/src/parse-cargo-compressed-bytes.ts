/**
 * Pull the compressed `.crate` size out of `cargo package`'s summary
 * line, which cargo writes to stderr:
 *   `    Packaged 7 files, 24.0KiB (8.9KiB compressed)`
 */
export function parseCargoCompressedBytes(cargoStderr: string): number | null {
  const unitBytes: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  };
  const m = /Packaged\b[^\n]*?\(([\d.]+)([A-Za-z]+) compressed\)/.exec(cargoStderr);
  if (m === null) {return null;}
  const [, rawValue, rawUnit] = m as unknown as [string, string, string];
  const unit = unitBytes[rawUnit];
  if (unit === undefined) {return null;}
  return Math.round(Number.parseFloat(rawValue) * unit);
}
