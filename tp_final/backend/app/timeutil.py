from datetime import UTC, datetime


def to_utc(value: datetime) -> datetime:
    """Normalize DB timestamps so API responses serialize as `...Z`."""
    return value.astimezone(UTC)
