export function nodePlatformKey(triple: string): string {
  const napiPrefixes: readonly [string, string][] = [
    ['linux-x64', 'linux-x64'],
    ['linux-arm64', 'linux-arm64'],
    ['linux-arm-', 'linux-arm'],
    ['darwin-x64', 'darwin-x64'],
    ['darwin-arm64', 'darwin-arm64'],
    ['win32-x64', 'win32-x64'],
    ['win32-arm64', 'win32-arm64'],
  ];
  const rustTargetKeys: Record<string, string> = {
    'x86_64-unknown-linux-gnu': 'linux-x64',
    'x86_64-unknown-linux-musl': 'linux-x64',
    'aarch64-unknown-linux-gnu': 'linux-arm64',
    'aarch64-unknown-linux-musl': 'linux-arm64',
    'armv7-unknown-linux-gnueabihf': 'linux-arm',
    'armv7-unknown-linux-musleabihf': 'linux-arm',
    'x86_64-apple-darwin': 'darwin-x64',
    'aarch64-apple-darwin': 'darwin-arm64',
    'x86_64-pc-windows-msvc': 'win32-x64',
    'aarch64-pc-windows-msvc': 'win32-arm64',
  };
  const t = triple.toLowerCase();
  // napi-rs short form (`linux-x64-gnu`) already starts with the Node
  // platform + arch; lop off the libc suffix if present.
  for (const [prefix, key] of napiPrefixes) {
    if (t.startsWith(prefix)) {return key;}
  }
  const rust = rustTargetKeys[t];
  if (rust === undefined) {
    throw new Error(
      `write-launcher: target triple "${triple}" is not mapped to Node platform+arch`,
    );
  }
  return rust;
}
