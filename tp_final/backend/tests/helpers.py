import os

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://chismoso:chismoso@127.0.0.1:5433/chismoso_test"
)
