# Global Architecture (100M+ Concurrent Users)

## 1) Control Plane + Data Plane Split
- **Control Plane**: identity, policy, billing, feature flags, experimentation.
- **Data Plane**: low-latency media delivery, messaging fanout, map tiles, and inference results.

## 2) Core Services
- API Gateway: global edge entry, authn/z, adaptive rate limiting, request shaping.
- Auth Service: OAuth2/OIDC, JWT issuance, refresh token rotation, device trust.
- Media Service: upload manifests, asset metadata, lifecycle transitions.
- Realtime Service: WebSocket/SFU session coordinator for collaboration and live events.
- Messaging Service: E2EE envelope routing, channel fanout, delivery receipts.
- Video Pipeline: transcoding DAG, ABR packaging, chaptering, thumbnail experiments.
- AI Inference Service: model router, feature store adapters, online/offline inference.
- Recommendation Engine: multi-objective ranking + anti-addiction balancing.
- Location Intelligence: map matching, routing, traffic fusion, safety scoring.
- Notification Service: predictive send-time optimization, omnichannel dispatch.
- Monetization Service: wallet ledger, revenue-sharing, subscription lifecycle.
- Moderation Service: multimodal safety classifiers + policy decisioning.
- Analytics Service: streaming OLAP aggregates, creator insights, health telemetry.

## 3) Event Backbone
- Kafka/Pulsar topics partitioned by tenant-region and entity key.
- Exactly-once semantics for financial and moderation decisions; at-least-once elsewhere.
- CDC connectors stream relational updates into analytics lakehouse.

## 4) Storage Strategy (Polyglot)
- PostgreSQL/CockroachDB: identity, subscriptions, wallet ledger.
- Cassandra/Scylla: message timelines, realtime presence, feed cache.
- S3-compatible object store + CDN: media blobs, map tiles, model artifacts.
- Redis Cluster: hot cache, rate limiting, pub/sub fanout coordination.
- OpenSearch/Vector DB: semantic retrieval, multimodal search.
- Feature Store: low-latency embeddings and online features.

## 5) Global Reliability
- Active-active multi-region with locality-aware routing.
- Per-service SLO budgets and adaptive load shedding.
- Fallback profiles: disable non-critical AI enrichments before core functionality.
- Chaos engineering hooks and regional failover playbooks.

## 6) Security & Trust
- Zero-trust service mesh (mTLS + SPIFFE identities).
- Envelope encryption with KMS-managed data keys.
- RBAC + ABAC for admin tooling and moderation controls.
- Tamper-evident audit logs with immutable retention.

## 7) UX System Foundations
- AI-personalized shell layout and adaptive widgets.
- Dark neon/glassmorphism design tokens.
- 60fps constraints via GPU-safe animation primitives.
- Command palette + gesture-first interaction model.
