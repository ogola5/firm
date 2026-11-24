from __future__ import annotations

from fastapi import Depends
from fastapi import APIRouter

from app.deps import current_user
from app.models import User
from app.services.access import require_roles

router = APIRouter()

@router.get("/api/v1/integrations/sap/status")
def sap_integration_status(user: User = Depends(current_user)):
    require_roles(
        user,
        "maintenance_manager", "general_manager_om", "system_administrator",
        "managing_director", "supervisor",
    )
    return {
        "integration": "SAP",
        "phase": "After operational workflow stabilizes",
        "mode": "Read-only planned; write-back disabled",
        "permitted_future_reads": ["equipment tags", "locations", "permit and work-order references"],
        "blocked_actions": ["SAP write-back", "permit modification", "work-order creation"],
        "approval_required": ["ICT", "SAP team"],
    }
