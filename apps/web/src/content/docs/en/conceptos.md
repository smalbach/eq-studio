# Concepts

The vocabulary of Endpoint Quality, from the most general to the most specific.

## Project

An API you want to verify. It holds its contract, its configuration (what to test and how) and its environments. It exports as a `.eq.json` file you can version in Git or import on another machine. See [.eq.json format](doc:formato).

## Contract and contract version

The API's **OpenAPI 3** document. Importing it stores a **version**: an immutable copy identified by its hash. Importing the same content twice gives the same version; importing a new one creates another and activates it. Runs always use the active version, never a document that changes halfway through.

From each operation of the contract the method, path, tag, **declared statuses** and **parameters** are taken. A declared status enables its cases: if your API answers 409 but the contract does not declare it, nobody tests it.

## Environment

Where the API runs: a **base URL** and what may be done there.

- **Seed** (`seeded`): the seed's ids (`1` exists, `999999` does not) are the environment's own. If not, they are discovered before each run.
- **Writes** (`writesAllowed`): whether POST, PUT, PATCH and DELETE may go out.
- **Budgets** (`enforceLatency`): whether latency decides the case or is only reported.
- **Authentication** (`authEnabled`): whether the API enforces credentials, and so whether the 401/403 cases make sense.

An environment never holds secrets.

## Credential

What is presented to authenticate in an environment: a **bearer** token, an **API key** in a header, a **Basic** username and password, or **OAuth2 client credentials** (the API fetches the token once per run). Each environment has up to three, by **role**:

| Role | For |
| --- | --- |
| `primary` | The normal cases. |
| `insufficient` | The 403 cases: a valid credential without enough permissions. |
| `alternate` | The cases of a credential the operation does not accept (an API key on a DELETE, for instance). |

They are stored encrypted and never come back to the browser: at most, their last four characters.

## Scenario (case)

One specific question to an operation, with its expected status: "unfiltered list → 200", "missing resource → 404", "no credential → 401". The engine **generates** them from the contract and the configuration; the whole set is the **matrix**. See [Functional verification](doc:funcional).

## Chained flow

A write case that cannot be checked with a single request. "Create and read" creates a resource, captures its id, reads it and compares field by field; at the end it **deletes** it, even if the case fails. So the matrix can be run twice in a row over the same data.

## Latency budget

How long an operation may take, as an **ordered** list of rules: the first one that matches wins. An operation with no rule gets no latency assertion: **a budget that does not exist is not a budget that passes**.

## Run

A saved execution: functional (the matrix or part of it) or load. It runs **on the server**: closing the browser does not stop it. Each case ends in one of these states:

| State | Means |
| --- | --- |
| `passed` | All its assertions passed. |
| `failed` | The API answered something other than expected. It is a finding. |
| `blocked` | The case was not sent: it is a write in an environment where writes are not allowed. Not a failure. |
| `skipped` | It never ran because the run was cancelled first. |

## Probe

A single case with the values you choose, saving nothing. It answers "does this work?" while you configure; runs are what is kept as evidence.

## Load profile

A load test: a **type** (load, stress, spike or soak), a **mix** of GET operations with relative weights, **stages** (rate in requests per second over time) and **thresholds**. See [Load and stress](doc:carga).
