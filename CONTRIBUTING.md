# Contributing to Docustay

Thanks for helping. Small, focused changes are the easiest to review.

## Before you start

* For anything larger than a fix, open an issue first so we can agree on the shape of it.
* Security problems go to **security@docustay.app**, not to a public issue (see [SECURITY.md](SECURITY.md)).
* Be kind. The [code of conduct](CODE_OF_CONDUCT.md) applies everywhere in this project.

## Run it

You need Docker with Compose for the whole app: `git clone`, `cd docustay`, `sh quickstart.sh` (see the [README](README.md)).

## Run the tests

The unit tests need Node.js (the CI workflow in `.github/workflows/test.yml` runs Node 25 and is the reference; the app image runs Node 22) and need no database:

```sh
npm ci
node --test test/docustay_*.test.mjs
```

The SDKs have their own tests; run them inside each package folder, for example:

```sh
cd sdk/js && node --test test/*.test.mjs
cd sdk/python && python3 -m unittest discover -s tests
```

The pull-request template asks you to confirm that you ran the tests, added or updated a test for the change, and did not weaken a security check. A test that fails is fixed by fixing the code or the fixture, never by loosening the assertion.

## Sign off your commits

This project uses the [Developer Certificate of Origin](https://developercertificate.org/). By adding a `Signed-off-by` line you state that you wrote the change or have the right to submit it under this project's licence:

```sh
git commit -s -m "Short description of the change"
```

## Licences

Contributions to the server, worker, migrations and web app are accepted under the **AGPL-3.0-or-later**; contributions inside `sdk/` are accepted under the **MIT** licence of the package they change. Each package has its own `LICENSE`.
