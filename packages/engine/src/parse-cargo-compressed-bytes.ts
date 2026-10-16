const CARGO_SIZE_UNIT_BYTES: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

/**
 * Pull the compressed `.crate` size out of `cargo package`'s summary
 * line, which cargo writes to stderr:
 *   `    Packaged 7 files, 24.0KiB (8.9KiB compressed)`
 */
export function parseCargoCompressedBytes(cargoStderr: string): number | null {
  const m = /Packaged\b[^\n]*?\(\s*(\d+(?:\.\d+)?)\s*([A-Za-z]+)\s+compressed\s*\)/.exec(
    cargoStderr,
  );
  if (m === null) {return null;}
  const [, rawValue, rawUnit] = m as unknown as [string, string, string];
  const unit = CARGO_SIZE_UNIT_BYTES[rawUnit];
  if (unit === undefined) {return null;}
  return Math.round(Number.parseFloat(rawValue) * unit);
}
