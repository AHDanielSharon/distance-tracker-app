# Deployment-Ready Setup

## Environments
- **dev**: single-region docker compose for service integration.
- **stage**: multi-zone Kubernetes with synthetic traffic replay.
- **prod**: active-active multi-region Kubernetes clusters + global edge.

## CI/CD
1. Build and scan each service image.
2. Contract tests (OpenAPI/AsyncAPI compatibility).
3. Progressive delivery with canary + automated rollback.
4. Post-deploy SLO gate (latency, error, moderation SLA).

## Scalability Controls
- HPA/KEDA on CPU + queue depth + websocket sessions.
- Global traffic manager for geo-latency and failover.
- CDN cache policy for media segments, map tiles, static UI.

## Fault Tolerance
- Circuit breakers + retries + idempotent handlers.
- Dead-letter topics for poison messages.
- Regional isolation to contain blast radius.

## Security Hardening
- mTLS via service mesh.
- Secrets from Vault/KMS; no plaintext in manifests.
- Audit logging for all admin and moderation actions.
