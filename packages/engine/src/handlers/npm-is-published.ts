import { TransientError, type Ctx } from '../types.js';
import { execCapture } from '../utils/exec-capture.js';
import { ExecError } from '../utils/exec-error.js';
import { classifyNpmViewFailure } from './classify-npm-view-failure.js';
import { npmNameFor, type NpmPkg } from './npm-name-for.js';

export async function npmIsPublished(pkg: NpmPkg, version: string, ctx: Ctx): Promise<boolean> {
  const name = npmNameFor(pkg);
  try {
    // `--fetch-retries=0`: piot owns the retry decision, npm must not add
    // an error-blind budget of its own underneath it. npm defaults to two
    // retries with a 10s-then-60s backoff and applies them to *every*
    // failure, so a probe against a registry whose hostname does not
    // resolve — the hermetic `--network none` case — spent ~70s
    // re-attempting a DNS lookup that cannot start succeeding. Retries the
    // registry can actually satisfy are still made, one classification
    // below, where `withRetry` can tell a 503 from a dead name. #650.
    await execCapture('npm', ['view', `${name}@${version}`, 'version', '--fetch-retries=0'], {
      cwd: ctx.cwd,
    });
    return true;
  } catch (err) {
    if (!(err instanceof ExecError)) {
      // Nothing from the process seam to read npm's code line out of, so
      // there is nothing to classify — keep the historical reading.
      return false;
    }
    switch (classifyNpmViewFailure(err.stderr)) {
      case 'unreachable':
        // No registry was reached, so there is no answer to report. Saying
        // "not published" here is a guess that reads as fact: `plan` renders
        // it PUBLISH, promising a publish it never checked. Throwing lets
        // the read-only caller render UNKNOWN (and `unpublishedKinds` still
        // counts that as unpublished, so auth is unaffected — #622), and
        // stops a publish that has no registry to publish to. Not a
        // `TransientError`: a name that does not resolve will not resolve on
        // attempt two, so `withRetry` must let this through immediately.
        throw new Error(
          `npm view ${name}@${version} failed: the npm registry could not be reached\n${err.stderr.trim()}`,
          { cause: err },
        );
      case 'transient':
        // Reached and faltered (timeout, reset, 429, 5xx) — exactly what the
        // retry policy exists for. `withRetry` at the publish call sites
        // retries; `plan` renders UNKNOWN.
        throw new TransientError(
          `npm view ${name}@${version} failed: transient registry error\n${err.stderr.trim()}`,
        );
      case 'absent':
        // The registry answered and the version isn't there (`E404`), or the
        // failure is one we don't recognise — the historical reading.
        return false;
    }
  }
}
