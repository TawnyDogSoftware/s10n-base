# AWS Signature Version 4 test suite

The `v4` cases of the AWS signing test suite, used as fixtures by `../sigv4.test.ts`. Each
directory is one case: `context.json` (credentials, region, service, time and options),
`request.txt` (the request), and the expected canonical request, string to sign, signature and
signed request for header-based signing. Query-string signing (presigned URLs) is not used by
this repo, so those files were not copied.

- **Source:** <https://github.com/awslabs/aws-c-auth/tree/f556deacd6e6d9dbf540ff00a9bf383688076874/tests/aws-signing-test-suite/v4>,
  the AWS-maintained home of the suite. AWS's documentation used to offer the same suite as
  `aws-sig-v4-test-suite.zip`; that download now answers 404, and the IAM user guide's
  Signature Version 4 pages point to `awslabs/aws-c-auth` instead.
- **Fetched:** 2026-11-19, at commit `f556deacd6e6d9dbf540ff00a9bf383688076874`.
- **Licence:** Apache-2.0. `LICENSE` and `NOTICE` are copied from that repository unchanged.
- **Changes:** none. The files are byte-for-byte as published, which is why this directory is
  excluded from the formatter.
