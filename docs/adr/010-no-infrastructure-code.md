# 010: The base ships no infrastructure code; projects use Terraform

- **Status:** Accepted, 2026-11-18.

## Context

The projects built on this base do not share a host, so any infrastructure code in the base would fit at most one of them and mislead the rest. A project still needs its infrastructure written down as code. We evaluated Alchemy, a TypeScript infrastructure-as-code tool that would have kept everything in one language, and Terraform.

## Decision

- **The base stays hosting-neutral.** It ships one container image, a deployment guide that names no host, and nothing that provisions anything ([docs/deployment.md](../deployment.md)).
- **Projects that need infrastructure code use Terraform**, in their own repositories.
- **Alchemy is rejected for now:** at the time of the decision it was a beta rewrite with frequent breaking changes and no providers for the platforms our projects use.

## Consequences

- Anything that runs containers, reaches Postgres and sits behind a TLS-terminating proxy can run the image, and the base never has to be changed to suit one host.
- Each project writes its own Terraform; nothing is shared between projects through the base.
- Infrastructure is a second language next to TypeScript.

## Revisit when

- Alchemy, or another TypeScript tool, has a stable release, a record of non-breaking upgrades, and providers for the platforms our projects use.
- Several projects settle on the same host and their Terraform converges, so a shared module would pay for itself (in its own repository, not in the base).
