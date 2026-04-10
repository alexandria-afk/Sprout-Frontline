"""
Shared Azure Blob Storage helper.

Wraps BlobServiceClient so route files don't need to manage connections.
Containers mirror the old Supabase bucket names.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    ContentSettings,
    generate_blob_sas,
)

from config import settings

# Lazy singleton — created on first use
_client: Optional[BlobServiceClient] = None


def get_blob_client() -> BlobServiceClient:
    global _client
    if _client is None:
        _client = BlobServiceClient.from_connection_string(
            settings.azure_storage_connection_string
        )
    return _client


def _ensure_container(container_name: str) -> None:
    """Create container if it doesn't exist (idempotent)."""
    client = get_blob_client()
    try:
        client.create_container(container_name)
    except Exception:
        pass  # Already exists


def upload_blob(
    container: str,
    blob_name: str,
    data: bytes,
    content_type: str = "application/octet-stream",
    overwrite: bool = True,
) -> str:
    """Upload bytes and return the blob URL."""
    _ensure_container(container)
    client = get_blob_client()
    blob = client.get_blob_client(container=container, blob=blob_name)
    blob.upload_blob(
        data,
        overwrite=overwrite,
        content_settings=ContentSettings(content_type=content_type),
    )
    return blob.url


def get_public_url(container: str, blob_name: str) -> str:
    """Return the direct URL for a blob (works for public containers or Azurite)."""
    client = get_blob_client()
    blob = client.get_blob_client(container=container, blob=blob_name)
    return blob.url


def get_signed_url(container: str, blob_name: str, expiry_seconds: int = 3600) -> str:
    """Return a time-limited SAS URL for a blob."""
    account_name = settings.azure_storage_account_name

    # Extract account key from connection string
    account_key: Optional[str] = None
    for part in settings.azure_storage_connection_string.split(";"):
        if part.startswith("AccountKey="):
            account_key = part[len("AccountKey="):]
            break

    expiry = datetime.now(timezone.utc) + timedelta(seconds=expiry_seconds)

    sas = generate_blob_sas(
        account_name=account_name,
        container_name=container,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )

    # Build URL — works for both Azurite and real Azure
    base_url = get_blob_client().url.rstrip("/")
    return f"{base_url}/{container}/{blob_name}?{sas}"


def delete_blob(container: str, blob_name: str) -> None:
    """Delete a blob (no-op if not found)."""
    try:
        client = get_blob_client()
        client.get_blob_client(container=container, blob=blob_name).delete_blob()
    except Exception:
        pass
