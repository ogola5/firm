from __future__ import annotations


from app.models import ProcedureReview, ProcedureUpdate, User

def procedure_update_payload(item: ProcedureUpdate, author: User | None = None, reviews: list[ProcedureReview] | None = None) -> dict:
    return {
        "id": item.id,
        "reference": item.reference,
        "fault_id": item.fault_id,
        "section": item.section,
        "author_id": item.author_id,
        "author_name": author.display_name if author else "",
        "title": item.title,
        "observed_symptom": item.observed_symptom,
        "confirmed_cause": item.confirmed_cause,
        "diagnostic_procedure": item.diagnostic_procedure,
        "corrective_action": item.corrective_action,
        "safety": item.safety,
        "version": item.version,
        "lineage_id": item.lineage_id,
        "previous_update_id": item.previous_update_id,
        "status": item.status,
        "created_at": item.created_at.isoformat(),
        "reviews": [
            {
                "decision": review.decision,
                "comments": review.comments,
                "reviewer_id": review.reviewer_id,
                "reviewer_name": review.reviewer.display_name if hasattr(review, "reviewer") and review.reviewer else review.reviewer_id,
                "created_at": review.created_at.isoformat(),
            }
            for review in (reviews or [])
        ],
    }
