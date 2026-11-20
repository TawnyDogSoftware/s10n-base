# 008: The example domain is an account profile and an admin user list

- **Status:** Accepted, 2026-11-18.

## Context

The scaffold shipped a demo domain of projects, notes and an activity feed. Every project built on it deleted that domain on its first day, so it taught nothing that survived. Yet a starter with no domain at all gives no worked example of the patterns a project needs: an RPC method with an auth level, a protected query that belongs to one user, a role check, pagination, and a screen on web and mobile that uses them.

## Decision

The only domain is the one every project keeps:

- **The account profile**, on web and mobile: read and change your own name (`profile.get`, `profile.update`, auth level `session`), with passkey management on the web.
- **An admin-only user list** (`admin.listUsers`, auth level `{ role: "admin" }`), with keyset pagination, which proves the role guard end to end.

## Consequences

- Nothing in the base has to be deleted before real work starts; the example methods and screens are the template for new ones.
- The patterns a project copies most (an auth level per method, user-keyed query state, keyset pagination with an opaque cursor, an admin page that refuses a non-admin) are shown working and tested.
- The base demonstrates no product data model, ownership column or multi-tenancy; projects design those themselves.

## Revisit when

- Projects keep needing the same piece of product structure (for example organizations) and each builds it the same way: then it belongs in the base or a recipe.
