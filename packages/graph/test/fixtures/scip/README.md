# Recorded SCIP index

`shop-api.scip` is the index scip-python 0.6.8 wrote for `test/fixtures/shop/api/*.py`, with a venv
that has `requests` 2.31.0 (the fake venv of `test/resolve.test.ts`):

    scip-python index --cwd <mirror> --project-name rehearse-repo --project-version 0 \
      --environment env.json --output shop-api.scip --quiet

`test/resolve.test.ts` reads it to test the Python resolver's SCIP reading without running scip-python.
