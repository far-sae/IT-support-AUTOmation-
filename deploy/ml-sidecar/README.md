# Relay ML sidecar — sklearn / FastAPI

Optional Python service that trains + serves sklearn models for the
remediation classifier. The Node.js server falls back to its in-process
pure-TS GBT when this sidecar isn't reachable.

## Run

```bash
# Local
docker build -t relay-ml-sidecar .
docker run -p 8000:8000 -v $(pwd)/data:/data relay-ml-sidecar

# Then in the Node server:
export ML_SIDECAR_URL=http://localhost:8000
```

## Endpoints

- `GET /healthz` → `{"ok":"true"}`
- `POST /train` → trains an sklearn `HistGradientBoostingClassifier`, returns `model_id` + metrics
- `POST /predict` → returns `P(success)`

The feature contract is set by the Node side (`server/src/ml/features.ts`).
The sidecar accepts the names as a parallel array; this lets the Node side
add new features without re-deploying the sidecar.

## When to use this

Use the sidecar when:
- You have > 100k labelled remediation attempts (in-process TS GBT gets slow)
- You want to leverage sklearn-specific features (calibration, monotonic
  constraints, missing-value handling)
- You need to validate the in-process model against a known-good sklearn baseline

For small deployments the in-process GBT in `server/src/ml/gbt.ts` is fine
and avoids the operational footprint of a Python service.
