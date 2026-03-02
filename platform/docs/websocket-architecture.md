# WebSocket + Realtime Collaboration Architecture

## Gateway Topology
1. Client connects through Anycast edge to nearest regional Realtime ingress.
2. API Gateway performs token verification and issues short-lived WS session ticket.
3. Realtime Service upgrades connection and binds to shard by `(tenantId,userId)`.

## Channels
- `presence.global` - online/offline + activity hints.
- `chat.channel.{id}` - encrypted envelope relay + read receipts.
- `collab.doc.{id}` - CRDT deltas for live co-editing.
- `stream.room.{id}` - control plane for SFU media sessions.
- `alerts.safety.{id}` - community alerts and geofenced warnings.

## Reliability
- Sticky-less reconnect via Redis-backed session state.
- Ordered delivery per channel partition key.
- Backpressure strategy: drop non-critical typing indicators before durable messages.
- Graceful downgrade to SSE for constrained networks.
