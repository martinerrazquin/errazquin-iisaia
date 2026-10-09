#!/bin/sh
# Creates the database used by host-run backend tests (see backend/tests/helpers.py).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE chismoso_test OWNER \"$POSTGRES_USER\";"
