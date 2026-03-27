from supabase import create_client, Client
from config import settings

_client: Client | None = None


def get_supabase() -> Client:
    """Returns a singleton Supabase admin client using the service role key.
    Use this only for server-side admin operations (user creation, bulk import).
    For user-scoped queries, RLS is enforced via the JWT passed in the request.
    """
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _client


# Alias used by Phase 2 services (admin client with service role key)
get_admin_client = get_supabase
