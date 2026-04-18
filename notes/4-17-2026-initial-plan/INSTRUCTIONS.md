# Put It Out There

This is a library for performing automated releases in Github repositories. A commit produces a new patch version.

A user first defines patterns (globs) that are watched to trigger new builds. For example, `**/*.py` will watch for python changes and trigger a python build. Typescript, Python, and Rust are supported. (A package can also watch other packages.)

Runs are triggered automatically (on merge to main) as well as manually via a workflow trigger.

On manual runs, variables define versioning. Variables also can override path globs, so that a user can choose the packages to rebuild and re-version.

On automatic runs, variables are extracted from trailers in commits, and path globs define what gets picked up to build.
