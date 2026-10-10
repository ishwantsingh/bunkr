"""Shared transport/UI event vocabulary. Events are local evidence, not wire frames."""
from dataclasses import dataclass
from enum import Enum


class EventType(str, Enum):
    REQUEST_QUEUED = 'request_queued'
    REQUEST_RECEIVED = 'request_received'
    CHUNK_TRANSMITTED = 'chunk_transmitted'
    CHUNK_RECEIVED = 'chunk_received'
    CHUNKS_MISSING = 'chunks_missing'
    RETRY = 'retry'
    HOP_OBSERVED = 'hop_observed'
    ROUTE_AVAILABLE = 'route_available'
    ROUTE_UNAVAILABLE = 'route_unavailable'
    VERIFIED_LOCALLY = 'verified_locally'
    SENDER_CONFIRMED = 'sender_confirmed'
    STALLED = 'stalled'
    FAILED = 'failed'


@dataclass(frozen=True)
class Event:
    type: EventType
    time_ms: float
    observer: str  # 'endpoint' or 'simulator'
    node_id: int | None = None
    image_id: str | None = None
    representation_id: str | None = None
    request_id: str | None = None
    chunk_index: int | None = None
    missing_indices: tuple[int, ...] = ()
    hop_from: int | None = None
    hop_to: int | None = None
    wire_bytes: int = 0
    airtime_ms: float | None = None  # Unknown until transport models airtime.
    reason: str | None = None
