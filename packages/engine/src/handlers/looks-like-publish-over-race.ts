export function looksLikePublishOverRace(stderr: string | undefined): boolean {
  return stderr?.toLowerCase().includes('cannot publish over the previously published versions') === true;
}
