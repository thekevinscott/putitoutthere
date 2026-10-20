/**
 * `abi3` or `abi3-py<minor>`, either as a bare Cargo feature on the pyo3
 * dependency or as the tail of a `pyo3/abi3…` entry in
 * `[tool.maturin].features`.
 */
export function featuresEnableAbi3(features: unknown): boolean {
  return (
    Array.isArray(features) &&
    features.some((f) => typeof f === 'string' && /(?:^|\/)abi3(?:-py\d+)?$/.test(f))
  );
}
