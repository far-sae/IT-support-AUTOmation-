# Relay on Kubernetes — raw manifests

Quickstart:

```bash
# 1. Build + push your images
docker build -t ghcr.io/your-org/relay-server:latest server/
docker build -t ghcr.io/your-org/relay-client:latest client/
docker push   ghcr.io/your-org/relay-server:latest
docker push   ghcr.io/your-org/relay-client:latest

# 2. Edit the manifests
# - deploy/k8s/server.yaml  → set the image tag
# - deploy/k8s/client.yaml  → set the image tag
# - deploy/k8s/ingress.yaml → set the hostname
# - deploy/k8s/secrets.example.yaml → COPY to secrets.yaml and fill in,
#   OR create the secret with `kubectl create secret generic relay-secrets ...`

# 3. Apply, in order
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secrets.yaml      # the one you filled in
kubectl apply -f deploy/k8s/postgres.yaml
kubectl apply -f deploy/k8s/server.yaml
kubectl apply -f deploy/k8s/client.yaml
kubectl apply -f deploy/k8s/ingress.yaml
kubectl apply -f deploy/k8s/networkpolicy.yaml   # optional but recommended
```

Optional add-ons that pair well:

| Component   | Where to point Relay's env                                              |
|-------------|-------------------------------------------------------------------------|
| OPA          | `OPA_URL=http://opa.opa.svc:8181` + bundle `deploy/opa/relay.rego`     |
| Prometheus   | the server's `prometheus.io/scrape` annotations are already set        |
| Grafana      | import `docker/grafana/dashboards/relay-autopilot.json`                |
| Elasticsearch | `ELASTICSEARCH_URL=http://elasticsearch.elastic.svc:9200`              |
| Kafka         | `KAFKA_BROKERS=kafka.kafka.svc:9092`                                   |

For a parameterised / multi-env install, use the Helm chart in
[`deploy/helm/relay`](../helm/relay/) instead of editing these YAMLs.
