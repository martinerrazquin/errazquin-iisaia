import pytest

from app.usernames import InvalidUsername, canonicalize_username


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("bgonzalez", "bgonzalez"), ("  BGonzalez \t", "bgonzalez"), ("a.b-c_9", "a.b-c_9"), ("x" * 64, "x" * 64)],
)
def test_canonicalizes(raw, expected):
    assert canonicalize_username(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "bgonzalez@example.com",  # email form is rejected, never stripped
        "bgonzalez@",
        "",
        "   ",
        "b gonzalez",
        ".bgonzalez",             # must start with a letter or digit
        "x" * 65,
        "ñandu",
        "bob\x00",
    ],
)
def test_rejects(raw):
    with pytest.raises(InvalidUsername):
        canonicalize_username(raw)
