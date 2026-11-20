# Docs

| Guide                                        | What it covers                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [setup.md](setup.md)                         | Running the app locally, every environment variable, the database and migrations, and the tests              |
| [quality.md](quality.md)                     | Each gate in `bun run agent:check`, how to run it alone, and the honest ways to fix a failure                |
| [auth.md](auth.md)                           | How sign-up and sign-in work, cookies and cross-site rules, email, the first admin, recipes and pitfalls     |
| [client.md](client.md)                       | The API client's three failures, session-gated query state, and adding a protected query                     |
| [i18n.md](i18n.md)                           | Adding a string or a locale, error messages, and the email namespace                                         |
| [mobile-dev.md](mobile-dev.md)               | Variants, environment, simulator and phone builds, testing over a private network, and mobile passkeys       |
| [mobile-first-boot.md](mobile-first-boot.md) | The owner's checklist for the first boot of the mobile app on a Mac                                          |
| [dependencies.md](dependencies.md)           | The 3-day rule, where each version lives, the hold list, overrides and the daily update pull request         |
| [deployment.md](deployment.md)               | The container image, every variable each command reads, database roles, migrating, health, proxies and email |
| [new-project.md](new-project.md)             | Starting a project from the template: the rename, what to keep, secrets, and the first deployment            |
| [adr/](adr/README.md)                        | Decision records: what was decided, why, and what would make us decide again                                 |

The rules for changing the repository are in [AGENTS.md](../AGENTS.md), the plans behind it in [plans/](../plans/README.md), and what changed when in [CHANGELOG.md](../CHANGELOG.md).
