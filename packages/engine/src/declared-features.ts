export function declaredFeatures(cargoToml: Record<string, unknown>): Set<string> {
  const features = (cargoToml.features ?? {}) as Record<string, unknown>;
  return new Set(Object.keys(features));
}
