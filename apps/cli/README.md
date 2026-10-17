# endpoint-quality

Verify any HTTP API against its OpenAPI contract — functional cases (status, schema, auth,
persistence, chained flows that clean up after themselves) and load, stress, spike and soak tests —
from a web app, an API or the `eq` command line. It runs on your machine with no account; a team
can also deploy it in the cloud and sync local installations with it.

Requires Node 22.13 or newer. The single-file binaries need nothing installed: download
`eq-macos-arm64`, `eq-macos-x64`, `eq-linux-x64`, `eq-linux-arm64` or `eq-windows-x64.exe` from a
release and use it in place of `npx endpoint-quality` below.

```bash
npx endpoint-quality serve --open     # the web app and the API on http://127.0.0.1:4400
npx endpoint-quality mock             # the example API (Mock Store) on :4010, and with auth on :4011
```

In CI, with no server, from a project file (**Export** in the app, or `npx endpoint-quality export
<project> -o project.eq.json`):

```bash
npx endpoint-quality run --file project.eq.json --env staging \
  --base-url "$STAGING_URL" --token "$STAGING_TOKEN" --junit report.xml
npx endpoint-quality load --file project.eq.json --env staging --type load --rps 20 --duration 60 --p95 500
```

`--html report.html` and `--sarif report.sarif` add a self-contained HTML report and a SARIF file
for GitHub code scanning; `report` renders them again from a stored run. `diff` compares two
contracts and exits 1 when the new one breaks clients:

```bash
npx endpoint-quality report run.json --format html -o report.html
npx endpoint-quality diff https://api.example.com/openapi.json openapi.yaml
```

The same projects on several machines, through a cloud workspace (deployed with the
`docker/compose.yml` of the repository):

```bash
npx endpoint-quality login https://eq.example.com   # approve the code in the browser; or EQ_SYNC_TOKEN=eqt_… for CI
npx endpoint-quality sync                           # pull, then push; also every 5 minutes while `serve` runs
```

`npx endpoint-quality --help` lists every command and flag. Exit codes: 0 passed, 1 cases failed,
2 wrong command, project or environment, 3 could not run.

Data lives in `~/.endpoint-quality` (`EQ_DATA_DIR` to change it). `serve` only listens on your
machine: with `--host 0.0.0.0` anyone on your network reaches an API with no accounts. The full
documentation is inside the app (Documentation).
