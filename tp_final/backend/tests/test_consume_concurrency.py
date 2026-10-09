import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.exc import OperationalError

from app.consume import consume_grant
from app.errors import AppError
from app.models import RecipientGrant, Share, SharePayload
from app.shares import ValidatedShare, create_share
from app.tokens import hash_access_token


def seed_share(session_factory, recipients, shared_token=False):
    data = ValidatedShare(
        ciphertext=b"\x01" * 32,
        nonce=b"\x02" * 12,
        crypto_version=1,
        expires_in_minutes=60,
        recipients=recipients,
        shared_token=shared_token,
        label=None,
    )
    with session_factory() as session:
        created = create_share(session, creator="aperez", data=data)
    return created.share_id, dict(created.grants)


def attempt_consume(session_factory, token, recipient) -> str:
    with session_factory() as session:
        try:
            consume_grant(session, hash_access_token(token), recipient)
            return "ok"
        except AppError as exc:
            return exc.code


def test_same_grant_concurrent_consume_has_exactly_one_success(session_factory):
    _, tokens = seed_share(session_factory, ["bgonzalez"])
    workers = 8
    barrier = threading.Barrier(workers)

    def run(_):
        barrier.wait()
        return attempt_consume(session_factory, tokens["bgonzalez"], "bgonzalez")

    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(run, range(workers)))

    assert results.count("ok") == 1
    assert results.count("share_already_consumed") == workers - 1
    with session_factory() as session:
        consumed = session.scalars(select(RecipientGrant.consumed_at)).all()
    assert len(consumed) == 1 and consumed[0] is not None


def test_shared_token_grants_for_different_recipients_both_succeed_concurrently(session_factory):
    _, tokens = seed_share(session_factory, ["bgonzalez", "csaul"], shared_token=True)
    barrier = threading.Barrier(2)

    def run(recipient):
        barrier.wait()
        return attempt_consume(session_factory, tokens[recipient], recipient)

    with ThreadPoolExecutor(2) as pool:
        assert list(pool.map(run, ["bgonzalez", "csaul"])) == ["ok", "ok"]


def test_consume_locks_share_before_grant(session_factory):
    share_id, tokens = seed_share(session_factory, ["bgonzalez"])
    with session_factory() as session:
        grant_id = session.scalar(select(RecipientGrant.id))

    holder = session_factory()
    try:
        holder.begin()
        holder.execute(select(Share).where(Share.id == share_id).with_for_update()).scalar_one()
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(attempt_consume, session_factory, tokens["bgonzalez"], "bgonzalez")
            try:
                time.sleep(0.5)
                assert not future.done(), "consume must wait for the Share lock"
                # If consume had locked the grant before the Share, NOWAIT would raise LockNotAvailable.
                with session_factory() as probe, probe.begin():
                    try:
                        probe.execute(
                            text("SELECT id FROM recipient_grants WHERE id = :id FOR UPDATE NOWAIT"), {"id": grant_id}
                        )
                    except OperationalError:
                        pytest.fail("consume locked the RecipientGrant before the Share")
            finally:
                # Release the Share lock before the pool's shutdown(wait=True) joins the blocked consume thread;
                # otherwise any failure above would hang the test instead of failing it.
                holder.rollback()
            assert future.result(timeout=10) == "ok"
    finally:
        holder.close()

def simulated_cleanup(session_factory, share_id) -> str:
    """Future cleanup worker shape (base spec §12.3): Share lock, then grants, then delete payload."""
    with session_factory() as session, session.begin():
        session.execute(select(Share).where(Share.id == share_id).with_for_update()).scalar_one()
        session.execute(select(RecipientGrant).where(RecipientGrant.share_id == share_id).with_for_update()).all()
        time.sleep(0.05)
        session.execute(delete(SharePayload).where(SharePayload.share_id == share_id))
        session.execute(update(Share).where(Share.id == share_id).values(payload_deleted_at=func.clock_timestamp()))
    return "cleaned"


def test_concurrent_consume_and_cleanup_do_not_deadlock(session_factory):
    seeded = [seed_share(session_factory, ["bgonzalez", "csaul"]) for _ in range(10)]
    jobs = []
    for share_id, tokens in seeded:
        jobs.append(lambda t=tokens: attempt_consume(session_factory, t["bgonzalez"], "bgonzalez"))
        jobs.append(lambda s=share_id: simulated_cleanup(session_factory, s))
        jobs.append(lambda t=tokens: attempt_consume(session_factory, t["csaul"], "csaul"))

    with ThreadPoolExecutor(12) as pool:
        futures = [pool.submit(job) for job in jobs]
        results = [f.result(timeout=30) for f in futures]  # a deadlock raises from psycopg here

    assert results.count("cleaned") == 10
    assert set(results) <= {"cleaned", "ok", "share_payload_deleted"}
