# video-pipeline

## Responsibility
TODO: Define domain APIs, SLIs, and error budgets.

## Runtime
- Containerized microservice (Kubernetes-ready)
- Stateless compute with Redis cache + Kafka event integration
- OTEL tracing + Prometheus metrics

## Contracts
- Sync APIs via platform/contracts/openapi/super-platform.yaml
- Async events via platform/contracts/asyncapi/event-bus.yaml
