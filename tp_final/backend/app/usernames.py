import re

_USERNAME = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")


class InvalidUsername(ValueError):
    pass


def canonicalize_username(raw: str) -> str:
    """Trim, lowercase, then validate. Email-form input is rejected, never stripped of its domain."""
    value = raw.strip().lower()
    if "@" in value:
        raise InvalidUsername("email-form usernames are not accepted")
    if not _USERNAME.fullmatch(value):
        raise InvalidUsername("invalid username syntax")
    return value
