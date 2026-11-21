"""Private thumbnail delivery and publication to Cloudflare R2."""
from functools import lru_cache
import logging
import os
import re

log = logging.getLogger(__name__)
THUMBNAIL_PREFIX = "thumbnails/v1/"
THUMBNAIL_TTL = 300


@lru_cache(maxsize=1)
def storage():
    bucket = os.environ.get("KINDRED_R2_BUCKET", "")
    if not bucket:
        return None

    import boto3
    from botocore.config import Config

    account = os.environ["KINDRED_R2_ACCOUNT_ID"]
    if not re.fullmatch(r"[0-9a-f]{32}", account):
        raise ValueError("Invalid Cloudflare account ID")
    client = boto3.client(
        "s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["KINDRED_R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["KINDRED_R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                      connect_timeout=2, read_timeout=3, retries={"total_max_attempts": 1}),
    )
    return client, bucket


def key_for(identity):
    from preview_delivery import thumbnail_identity

    identity = thumbnail_identity(identity)
    return f"{THUMBNAIL_PREFIX}{identity}.jpg" if identity else None


def preview_url(identities):
    """Only call after verifying that the requested photo is in the library."""
    if not os.environ.get("KINDRED_R2_BUCKET"):
        return None
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        client, bucket = storage()
        for key in dict.fromkeys(filter(None, map(key_for, identities))):
            try:
                client.head_object(Bucket=bucket, Key=key)
            except ClientError as exc:
                if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                    continue
                raise
            return client.generate_presigned_url(
                "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=THUMBNAIL_TTL,
            )
    except (BotoCoreError, ClientError, KeyError, ValueError):
        log.warning("R2 thumbnail lookup failed, falling back to local delivery")
    return None
