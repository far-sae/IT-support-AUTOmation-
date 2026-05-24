"""
Phase 20 — Optional Python ML sidecar.

A FastAPI service that trains + serves sklearn's HistGradientBoostingClassifier
(or any sklearn model) on the same feature shape as the Node.js trainer.

The Node.js server is the source of truth for features + labels. It POSTs
batches to /train and gets back a model_id; later requests POST to /predict
with the model_id + a feature vector and receive P(success).

Why a sidecar at all? The pure-TS GBT in Node is good for ~10-50k examples;
a sklearn model on the same data gives:
  • Much faster training (vectorised, multi-threaded)
  • Better split-finding for high-dim categorical features
  • Out-of-the-box calibration + early stopping

Run:
  pip install -r requirements.txt
  uvicorn app:app --host 0.0.0.0 --port 8000

In the Node server set ML_SIDECAR_URL=http://ml-sidecar:8000 to activate.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import accuracy_score, log_loss

# Persisted models live here — survives container restart if mounted.
MODEL_DIR = Path(os.environ.get("ML_SIDECAR_MODEL_DIR", "/data/models"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Relay ML sidecar", version="0.1.0")


class TrainExample(BaseModel):
    features: list[float]
    label: int  # 0 or 1


class TrainRequest(BaseModel):
    feature_names: list[str]
    examples: list[TrainExample]
    # Hyperparameters; defaults are sensible for our domain.
    max_iter: int = 100
    learning_rate: float = 0.1
    max_depth: int | None = None


class TrainResponse(BaseModel):
    model_id: str
    metrics: dict


class PredictRequest(BaseModel):
    model_id: str
    features: list[float]


class PredictResponse(BaseModel):
    probability: float


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"ok": "true"}


@app.post("/train", response_model=TrainResponse)
def train(req: TrainRequest) -> TrainResponse:
    if len(req.examples) < 6:
        raise HTTPException(400, "need at least 6 examples to train")
    X = np.array([e.features for e in req.examples], dtype=float)
    y = np.array([e.label for e in req.examples], dtype=int)
    pos = int(y.sum())
    neg = int(len(y) - pos)
    if pos < 3 or neg < 3:
        raise HTTPException(400, "need ≥3 positives and ≥3 negatives")

    clf = HistGradientBoostingClassifier(
        max_iter=req.max_iter,
        learning_rate=req.learning_rate,
        max_depth=req.max_depth,
    )
    clf.fit(X, y)
    preds = clf.predict(X)
    proba = clf.predict_proba(X)[:, 1]
    acc = float(accuracy_score(y, preds))
    ll = float(log_loss(y, proba, labels=[0, 1]))

    model_id = str(uuid.uuid4())
    artifact = {"model": clf, "feature_names": req.feature_names}
    joblib.dump(artifact, MODEL_DIR / f"{model_id}.joblib", compress=3)

    return TrainResponse(
        model_id=model_id,
        metrics={
            "sample_count": int(len(y)),
            "positive_count": pos,
            "negative_count": neg,
            "accuracy": acc,
            "log_loss": ll,
            "framework": "sklearn-hist-gbt",
        },
    )


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> PredictResponse:
    path = MODEL_DIR / f"{req.model_id}.joblib"
    if not path.exists():
        raise HTTPException(404, f"unknown model_id {req.model_id}")
    artifact = joblib.load(path)
    clf = artifact["model"]
    expected = len(artifact["feature_names"])
    if len(req.features) != expected:
        raise HTTPException(400, f"feature length {len(req.features)} != model {expected}")
    proba = clf.predict_proba(np.array([req.features]))[0, 1]
    return PredictResponse(probability=float(proba))
