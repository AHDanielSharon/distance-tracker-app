# Service-by-Service Breakdown

| Service | Core Capabilities | Data Stores | Key Events |
|---|---|---|---|
| API Gateway | OAuth enforcement, quota, request routing | Redis | request.ratelimit.triggered |
| Auth Service | OAuth2/JWT, refresh rotation, device trust | PostgreSQL | auth.session.revoked |
| Media Service | ingest lifecycle, manifests, metadata | PostgreSQL + Object Store | media.asset.created |
| Realtime Service | WS session broker, SFU control, presence | Redis + Scylla | realtime.presence.updated |
| Messaging Service | E2EE envelope fanout, channel membership | Scylla + PostgreSQL | messaging.message.sent |
| Video Pipeline | transcoding, ABR packaging, chaptering | Object Store + Queue | media.processed.v1 |
| AI Inference Service | model routing, embedding generation, moderation inference | Vector DB + Feature Store | ai.inference.completed |
| Recommendation Service | feed ranking, anti-addiction balancing | Feature Store + Redis | recommendation.feed.generated |
| Location Intelligence | route optimization, traffic merge, geofencing | PostGIS + Redis | location.traffic.v1 |
| Notification Service | predictive timing, channel dispatch | Redis + PostgreSQL | notification.sent |
| Monetization Service | wallet ledger, payouts, tipping | PostgreSQL | monetization.transfer.posted |
| Moderation Service | multimodal scoring, policy decisions | OpenSearch + PostgreSQL | moderation.alert.v1 |
| Analytics Service | real-time OLAP, creator insights, heatmaps | ClickHouse + Data Lake | analytics.snapshot.ready |
