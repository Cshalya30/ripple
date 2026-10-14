from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from .builder import SnapshotBuildError, build_snapshot
from .schemas import BusinessFacts, DraftResponse, FactStatus
from .validation import unresolved_questions, validate_intake_facts


@dataclass
class Draft:
    draft_id: str
    business_id: str
    start_date: object
    horizon_days: int
    source_text: str
    facts: BusinessFacts
    version: int = 1
    approved: bool = False

    def response(self) -> DraftResponse:
        questions = unresolved_questions(self.facts)
        issues = validate_intake_facts(self.facts, self.source_text)
        snapshot = None
        if not questions and not issues:
            try:
                snapshot = build_snapshot(self.facts, self.metadata()).model_dump(mode="json")
            except SnapshotBuildError as exc:
                issues.extend(exc.issues)
        return DraftResponse(
            draft_id=self.draft_id,
            draft_version=self.version,
            status="READY_FOR_REVIEW" if snapshot and not issues else "NEEDS_INPUT",
            extracted_facts=self.facts,
            evidence=self.facts.evidence,
            unresolved_questions=list(dict.fromkeys(questions)),
            validation_issues=list(dict.fromkeys(issues)),
            draft_snapshot=snapshot,
        )

    def metadata(self) -> dict:
        return {
            "business_id": self.business_id,
            "start_date": self.start_date,
            "horizon_days": self.horizon_days,
            "source_text": self.source_text,
        }


class DraftStore:
    def __init__(self) -> None:
        self._drafts: dict[str, Draft] = {}

    def create(self, request, facts: BusinessFacts) -> Draft:
        draft = Draft(str(uuid4()), request.business_id, request.start_date, request.horizon_days, request.source_text, facts)
        self._drafts[draft.draft_id] = draft
        return draft

    def get(self, draft_id: str) -> Draft:
        draft = self._drafts.get(draft_id)
        if draft is None:
            raise KeyError(draft_id)
        return draft

    def update(self, draft_id: str, facts: BusinessFacts) -> Draft:
        draft = self.get(draft_id)
        original = {item.fact_reference: item for item in draft.facts.evidence}
        confirmed = [
            item.model_copy(update={"status": FactStatus.USER_CONFIRMED})
            for item in facts.evidence
        ]
        facts.evidence = list(original.values()) + [
            item for item in confirmed if item.fact_reference not in original
        ]
        draft.facts = facts
        draft.version += 1
        draft.approved = False
        return draft
