export function looksLikePublishOverRace(stderr: string | undefined): boolean {
  if (!stderr) {return false;}
  return /cannot publish over the previously published versions/i.test(stderr);
}
