# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in a Reflex SDK package, please report
it privately so we can address it before public disclosure.

**Preferred channel:** GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability).
Navigate to the **Security** tab and click **Report a vulnerability**.

**Fallback:** email `support@runloop.ai` with "Security report" in the subject.
Please include:

- A description of the issue and its impact
- Steps to reproduce (a minimal proof-of-concept if possible)
- Affected package versions
- Any suggested mitigations

Please do not open a public issue, pull request, or discussion for an
undisclosed vulnerability.

## Scope

In scope:

- The published packages `@runloop/reflex-client`, `@runloop/reflex-chat-kit`
  and `@runloop/reflex-ui`
- The component templates under `sdk/chat-kit/registry/`
- The example applications under `sdk/examples/`

Vulnerabilities in the hosted Reflex service or its API are also in scope, but
report those through the same channels rather than as an SDK issue.

Out of scope:

- Vulnerabilities in third-party dependencies already tracked upstream. We
  accept reports for vulnerable versions we ship, but please also notify the
  upstream project.
- Findings that require a privileged network position between your application
  and a Reflex deployment you do not control.
- Social engineering of maintainers.

## Supported versions

Only the latest published version of each package receives security updates.
Packages are versioned independently, so check the version of the specific
package you depend on.
