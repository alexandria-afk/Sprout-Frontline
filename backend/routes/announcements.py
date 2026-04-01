from uuid import UUID
from fastapi import APIRouter, Depends
from dependencies import get_current_user, require_manager_or_above, paginate
from models.announcements import CreateAnnouncementRequest, UpdateAnnouncementRequest
from services.announcement_service import AnnouncementService

router = APIRouter()


@router.post("/")
async def create_announcement(
    body: CreateAnnouncementRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    created_by = current_user["sub"]
    announcement = await AnnouncementService.create(body, org_id, created_by)

    # Notify target users
    try:
        from services import notification_service as _ns
        import asyncio as _asyncio
        announcement_id = str(announcement.id)
        ann_title = announcement.title
        ann_body = (announcement.body or "")[:100] or None
        target_roles = announcement.target_roles or []
        target_locations = [str(lid) for lid in (announcement.target_location_ids or [])]

        if target_roles:
            for role in target_roles:
                if target_locations:
                    for loc_id in target_locations:
                        _asyncio.create_task(_ns.notify_role(
                            org_id=org_id,
                            role=role,
                            location_id=loc_id,
                            type="announcement",
                            title=ann_title,
                            body=ann_body,
                            entity_type="announcement",
                            entity_id=announcement_id,
                        ))
                else:
                    _asyncio.create_task(_ns.notify_role(
                        org_id=org_id,
                        role=role,
                        type="announcement",
                        title=ann_title,
                        body=ann_body,
                        entity_type="announcement",
                        entity_id=announcement_id,
                    ))
        else:
            # No role filter — notify everyone
            _asyncio.create_task(_ns.notify_role(
                org_id=org_id,
                role="staff",
                type="announcement",
                title=ann_title,
                body=ann_body,
                entity_type="announcement",
                entity_id=announcement_id,
            ))
            _asyncio.create_task(_ns.notify_role(
                org_id=org_id,
                role="manager",
                type="announcement",
                title=ann_title,
                body=ann_body,
                entity_type="announcement",
                entity_id=announcement_id,
            ))
    except Exception:
        pass

    return announcement


@router.get("/")
async def list_announcements(
    pagination: dict = Depends(paginate),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await AnnouncementService.list_for_user(
        user_id=user_id,
        org_id=org_id,
        page=pagination["page"],
        page_size=pagination["page_size"],
    )


@router.get("/{announcement_id}")
async def get_announcement(
    announcement_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await AnnouncementService.get(str(announcement_id), org_id)


@router.put("/{announcement_id}")
async def update_announcement(
    announcement_id: UUID,
    body: UpdateAnnouncementRequest,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await AnnouncementService.update(str(announcement_id), org_id, body)


@router.post("/{announcement_id}/read")
async def mark_read(
    announcement_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    return await AnnouncementService.mark_read(str(announcement_id), user_id)


@router.post("/{announcement_id}/acknowledge")
async def acknowledge(
    announcement_id: UUID,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["sub"]
    return await AnnouncementService.acknowledge(str(announcement_id), user_id)


@router.get("/{announcement_id}/receipts")
async def get_receipts(
    announcement_id: UUID,
    current_user: dict = Depends(require_manager_or_above),
):
    org_id = (current_user.get("app_metadata") or {}).get("organisation_id")
    return await AnnouncementService.get_receipts(str(announcement_id), org_id)
