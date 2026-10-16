# Security policy

> **En español:** no publiques vulnerabilidades en issues. Repórtalas en privado desde
> **Security → Report a vulnerability** en GitHub; respondemos en español o en inglés.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub's security advisories:
[Report a vulnerability](https://github.com/smalbach/eq-studio/security/advisories/new)
(the **Security** tab → **Report a vulnerability**). Do not open a public issue, pull request or
discussion.

Include what is affected (CLI, API in local or cloud mode, web app, desktop app), the version or
commit, steps to reproduce and the impact you see. You should get an acknowledgement within a
week. We will keep you informed while we work on a fix, agree on a disclosure date with you, and
credit you in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release receives security fixes.

## Scope

Of particular interest: credential storage and encryption, authentication, roles and API tokens
in cloud mode, the SSRF guards, sync between installations (including end-to-end encrypted
secrets), and anything that lets a project file or an OpenAPI document execute code or reach
hosts it should not.

Endpoint Quality sends real requests, including writes and deletes, to the APIs you point it at.
That it does so against an API you configured is expected behaviour, not a vulnerability.
